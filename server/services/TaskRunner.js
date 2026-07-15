'use strict';
const { PRIORITY } = require('./ModelBroker');
const log = require('../utils/logger').createLogger('TaskRunner');
/**
 * TaskRunner — automatic task execution engine.
 * Polls open/planned tasks every heartbeat tick and executes them.
 * Sequential: only 1 task at a time to avoid sequences:1 deadlock.
 */

const path = require('path');
const fs   = require('fs').promises;
const fsSync = require('fs');
const AQUARIUM = require('../aquarium');

// Retry backoff delays per attempt (ms)
const RETRY_BACKOFF = [0, 30_000, 120_000, 300_000]; // attempt 1: immediate, 2: 30s, 3: 2min, 4: 5min

// Error categories for smarter retry decisions
function classifyError(msg) {
  if (!msg) return 'unknown';
  const m = msg.toLowerCase();
  if (m.startsWith('honesty gate')) return 'honesty';
  if (m.includes('out of memory') || m.includes('oom') || m.includes('vram') || m.includes('no context')) return 'oom';
  if (m.includes('no sequences left') || m.includes('sequences left') || m.includes('sequence') && m.includes('left')) return 'sequence';
  if (m.includes('preempted')) return 'preempted';
  if (m.includes('hallucin') || m.includes('invalid tool') || m.includes('tool not found')) return 'tool_error';
  if (m.includes('timeout') || m.includes('timed out')) return 'timeout';
  return 'unknown';
}

const DONE_FILE = path.join(AQUARIUM.TASKS, '_done.json');

/**
 * CANONICAL TASK STATUSES: todo / wip / done.
 * Everything else is legacy and normalized ON READ. Writes use ONLY the
 * canonical three. A permanently-failed task is done with outcome:'failed'.
 */
function normStatus(s) {
  s = String(s || 'todo').toLowerCase();
  if (s === 'todo' || s === 'wip' || s === 'done') return s;
  if (['open', 'planned', 'queued', 'assigned', 'pending', 'to-do'].includes(s)) return 'todo';
  if (['in_progress', 'running'].includes(s)) return 'wip';
  if (['completed', 'failed', 'cancelled', 'archived'].includes(s)) return 'done';
  return 'todo';
}

class TaskRunner {
  constructor(rm, modelService, agentPool, botService = null) {
    this.rm           = rm;
    this.modelService = modelService;
    this.agentPool    = agentPool;
    this.botService   = botService;   // BotService for Telegram/Discord notifications
    this._running       = new Set();
    this._ticking       = false;
    this._done          = new Set();  // persistent: tasks completed (never re-run)
    this._lastCronRun   = new Map();
    this._failCounts    = new Map();
    this._retryAfter    = new Map();  // taskId → epoch ms when next retry is allowed
    this.MAX_RETRIES    = 3;
    this._chatOpenUntil = 0;
    this._doneLoaded    = false;
  }

  /** Load persisted _done set from disk (called once at startup) */
  async loadDone() {
    try {
      await fs.mkdir(AQUARIUM.TASKS, { recursive: true });
      const raw = await fs.readFile(DONE_FILE, 'utf8');
      const ids = JSON.parse(raw);
      if (Array.isArray(ids)) ids.forEach(id => this._done.add(id));
      log.info(`Loaded ${this._done.size} completed tasks from _done.json`);
    } catch { /* file doesn't exist yet — start fresh */ }

    // Also pre-populate from flat registry tasks already in terminal state
    // (handles tasks created before per-folder migration)
    try {
      const TERMINAL_STATUSES = new Set(['done','completed','failed','cancelled','archived']);
      const flatPath = require('path').join(AQUARIUM.TASKS, 'tasks_registry.json');
      const raw = await fs.readFile(flatPath, 'utf8');
      const reg = JSON.parse(raw);
      for (const [id, task] of Object.entries(reg.tasks || {})) {
        const s = task.lifecycle?.status || task.status || '';
        if (TERMINAL_STATUSES.has(s)) this._done.add(id);
      }
    } catch {}

    this._doneLoaded = true;
  }

  /** Persist _done set to disk */
  async _saveDone() {
    try {
      await fs.mkdir(AQUARIUM.TASKS, { recursive: true });
      await fs.writeFile(DONE_FILE, JSON.stringify([...this._done]), 'utf8');
    } catch (e) {
      log.warn(' _saveDone failed:', e.message);
    }
  }

  /** Add task to _done and persist */
  /** Called when a task is hard-deleted from the UI — prevents TaskRunner from ever running it */
  markDeleted(taskId) {
    this._done.add(taskId);
    this._running.delete(taskId);
    this._runningMeta?.delete(taskId);
      if (global.__ACTIVE_TASK_ID === taskId) global.__ACTIVE_TASK_ID = null;
      global.__TASK_WRITES?.delete(taskId);
    this._failCounts.delete(taskId);
    this._retryAfter.delete(taskId);
    // Persist so it survives restart
    this._markDone(taskId).catch(() => {});
    log.info(`Task ${taskId} marked as deleted (will not run)`);
  }

  async _markDone(taskId) {
    this._done.add(taskId);
    await this._saveDone();
  }

  /** Send Telegram/Discord notification if BotService is available */
  async _notify(text) {
    if (!this.botService) return;
    try { await this.botService.notify(text); } catch {}
  }

  /** Called by route when chat modal opens or closes */
  setChatActive(isOpen) {
    if (isOpen) {
      // Richard's rule: BG tasks start only when the chat is closed OR after
      // 5 minutes without chat activity. Refreshed on every chat turn.
      this._chatOpenUntil = Date.now() + 5 * 60_000;
    } else {
      // Turn finished — keep BG paused long enough for the user to read the
      // reply and start their next message (was 3s, too short — the
      // heartbeat would grab Poseidon while the user was still typing).
      this._chatOpenUntil = Date.now() + 25_000;
    }
  }

  async tick() {
    // Re-entrancy guard: tick() is async and has many awaits between the
    // "is anything running?" check and the point where _runTask adds the
    // task to _running. Without a synchronous lock, a second tick fired by
    // the heartbeat could slip through that window and launch a SECOND task
    // for the same (or another) agent — which is exactly the "concurrent
    // tasks running" the user saw. Bail immediately if a tick is in flight.
    if (this._ticking) return;
    this._ticking = true;
    try {
      await this._tickInner();
    } finally {
      this._ticking = false;
    }
  }

  async _tickInner() {
    if (this._running.size > 0) return;
    if (!this._doneLoaded) return;
    if (this.modelService.loaded.size === 0) return;
    if (Date.now() < this._chatOpenUntil) return;
    const brokerState = this.modelService.broker.getState();
    if (brokerState.state !== 'IDLE') return;
    if (this.modelService.broker.hasHighPriorityWaiting()) return;

    let reg;
    try {
      this.rm.invalidateCache();
      reg = await this.rm.getTasksRegistry();
    } catch (e) {
      log.warn(' tick read error:', e.message);
      return;
    }

    const now = Date.now();
    const allTasks = Object.values(reg.tasks || {});

    // ── Cron tasks: check if any scheduled task is due ─────────────────────
    for (const task of allTasks) {
      // Two schedule syntaxes coexist:
      //  - task.cron_schedule: crontab string (created by Poseidon/tools)
      //  - task.schedule: object from the Scheduler UI
      //    { type: 'once'|'interval'|'daily'|'weekly', run_at?, minutes?, time?, day?, last_run_at? }
      // Historically only cron_schedule was honoured, so UI-scheduled tasks
      // ran ONCE (picked up as plain open tasks) and never recurred.
      const hasCron = !!task.cron_schedule;
      const hasSched = !!(task.schedule && task.schedule.type);
      if (!hasCron && !hasSched) continue;

      let due = false;
      if (hasCron) {
        const lastRun = this._lastCronRun.get(task.task_id) || 0;
        due = this._isCronDue(task.cron_schedule, lastRun, now);
        if (due) this._lastCronRun.set(task.task_id, now);
      } else {
        due = this._isScheduleDue(task.schedule, now);
      }
      if (!due) continue;

      log.info(`Scheduled task due: ${task.task_id} "${task.title}"`);
      // Spawn a FRESH task so each run is independently tracked.
      // The original task stays in registry as the template.
      try {
        const reg = await this.rm.read('TASKS/tasks_registry.json');
        const nextId = reg.metadata?.next_id || 1;
        const cronTaskId = `task_${String(nextId).padStart(4, '0')}_cron_${Date.now()}`;
        reg.tasks = reg.tasks || {};
        reg.tasks[cronTaskId] = {
          ...task,
          task_id: cronTaskId,
          title: task.title,
          description: task.description || '',
          status: 'todo',
          lifecycle: { status: 'todo' },
          created_at: new Date().toISOString(),
          cron_schedule: null,   // fresh run — no re-cron
          schedule: null,        // fresh run — instance, not template
          cron_parent: task.task_id,
        };
        // Persist last_run_at ON THE TEMPLATE (survives restarts — the old
        // in-memory-only tracking re-fired interval tasks on every reboot).
        if (hasSched && reg.tasks[task.task_id]) {
          reg.tasks[task.task_id].schedule = { ...task.schedule, last_run_at: new Date().toISOString() };
          // 'once' templates are consumed after their single spawn
          if (task.schedule.type === 'once') {
            reg.tasks[task.task_id].lifecycle = { ...(reg.tasks[task.task_id].lifecycle || {}), status: 'done' };
            reg.tasks[task.task_id].status = 'done';
          }
        }
        reg.metadata = reg.metadata || {};
        reg.metadata.next_id = nextId + 1;
        await this.rm.write('TASKS/tasks_registry.json', reg);
        // Run the fresh task
        const freshTask = reg.tasks[cronTaskId];
        this._runTask(freshTask).catch(e =>
          log.error(`Scheduled task ${cronTaskId} error:`, e.message)
        );
      } catch (e) {
        log.error(`Failed to create scheduled instance for ${task.task_id}:`, e.message);
      }
      return; // one task per tick
    }

    // ── One-shot tasks: pick the oldest runnable todo ──────────────────────
    // Canonical statuses: a task is runnable iff normStatus(s) === 'todo'.
    // wip = currently held (or stale from a crash — reset below); done = never again.

    // Reset stale wip tasks (stuck from previous server run, not in _running)
    // Also clean up orphaned failed tasks whose disk entry was deleted
    for (const t of allTasks) {
      const raw = t.lifecycle?.status || t.status;
      const s   = normStatus(raw);
      const fails = this._failCounts.get(t.task_id) || 0;
      if (s === 'wip' && !this._running.has(t.task_id) && !this._done.has(t.task_id)) {
        log.info(`Resetting stale wip task ${t.task_id} → todo`);
        this._setStatus(t.task_id, 'todo').catch(() => {});
      }
      // Legacy 'failed' with 0 counted retries = set externally (session
      // crash, manual) — retry it. Checked on RAW status: canonical writes
      // never produce 'failed' in the live registry anymore.
      if (raw === 'failed' && fails === 0 && !this._done.has(t.task_id)) {
        log.info(`Resetting externally-failed ${t.task_id} → todo (fails=${fails})`);
        this._setStatus(t.task_id, 'todo').catch(() => {});
      }
      // If a task has been retried MAX_RETRIES times, mark done so it stops blocking
      if (raw === 'failed' && fails >= this.MAX_RETRIES) {
        log.info(`Permanently failed ${t.task_id} — adding to done set`);
        this._done.add(t.task_id);
        this._markDone(t.task_id).catch(() => {});
      }
    }

    // Build set of agentIds already running a task (in _running)
    const agentsRunning = new Set();
    for (const tid of this._running) {
      // Find the task in allTasks to get its assigned_to
      const rt = allTasks.find(t => t.task_id === tid);
      if (rt?.assigned_to) agentsRunning.add(rt.assigned_to);
    }

    // Live task ids — used for dependency resolution. Completed/failed/
    // cancelled tasks are PURGED from the registry into results_log, so
    // "dependency id still present in the registry" == "not finished yet".
    const liveIds = new Set(allTasks.map(t => t.task_id));

    const runnable = allTasks
      .filter(t => {
        const s = normStatus(t.lifecycle?.status || t.status);
        const tooManyFails = (this._failCounts.get(t.task_id) || 0) >= this.MAX_RETRIES;
        const retryDelay = this._retryAfter.get(t.task_id) || 0;
        const agentId = t.assigned_to;
        // Block if this agent already has a running task
        const agentBusy = agentId && agentId !== 'poseidon_main' && agentsRunning.has(agentId);
        // Dependencies: depends_on can be a task id string or an array of ids.
        // A dependency blocks while it still exists in the live registry
        // (i.e. hasn't completed). Missing/unknown ids don't block — a
        // deleted dependency should not deadlock its dependents forever.
        const deps = t.depends_on
          ? (Array.isArray(t.depends_on) ? t.depends_on : [t.depends_on])
          : [];
        const depsPending = deps.some(d => d && d !== t.task_id && liveIds.has(d));
        // Schedule TEMPLATES never run directly — instances are spawned by
        // the due-check above. Without this, a template with status 'open'
        // was picked up as a plain task, ran once, completed → purged, and
        // the recurrence was lost ("repetitive tasks only run once").
        const isScheduleTemplate = !!(t.schedule && t.schedule.type) || !!t.cron_schedule;
        return s === 'todo'
          && !isScheduleTemplate
          && !this._running.has(t.task_id)
          && !this._done.has(t.task_id)
          && !tooManyFails
          && !agentBusy
          && !depsPending
          && Date.now() >= retryDelay;
      })
      // Queue order: PRIORITY first (critical > high > medium > low),
      // then explicit sort_order bump, then chronological by created_at
      // (falls back to task_id). Fixes the case where a newer high-priority
      // task started while an older high-priority task waited at the
      // top of the visible queue.
      .sort((a, b) => {
        const P = { critical: 4, high: 3, medium: 2, low: 1 };
        const priorityDiff = (P[b.priority] || 2) - (P[a.priority] || 2);
        if (priorityDiff !== 0) return priorityDiff;
        const pDiff = (b.sort_order || 0) - (a.sort_order || 0);
        if (pDiff !== 0) return pDiff;
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (aTime && bTime && aTime !== bTime) return aTime - bTime;
        return (a.task_id || '').localeCompare(b.task_id || '');
      });

    if (runnable.length === 0) return;
    const task = runnable[0];
    this._runTask(task).catch(e =>
      log.error(`Task ${task.task_id} error:`, e.message)
    );
  }

  /**
   * Very simple cron check: parse '* * * * *' and see if it's due.
   * Checks against last-run timestamp to avoid double-firing.
   */
  /**
   * _isScheduleDue — evaluates the Scheduler-UI schedule object.
   * last_run_at is persisted on the template, so recurrence survives
   * restarts (the in-memory cron map does not).
   */
  _isScheduleDue(schedule, nowMs) {
    try {
      const lastRun = schedule.last_run_at ? Date.parse(schedule.last_run_at) : 0;
      switch (schedule.type) {
        case 'once': {
          if (lastRun) return false;                    // already consumed
          const at = Date.parse(schedule.run_at || '');
          return Number.isFinite(at) && nowMs >= at;
        }
        case 'interval': {
          const mins = Number(schedule.minutes) || 0;
          if (mins <= 0) return false;
          return (nowMs - lastRun) >= mins * 60_000;
        }
        case 'daily':
        case 'weekly': {
          const [hh, mm] = String(schedule.time || '09:00').split(':').map(n => parseInt(n, 10) || 0);
          const occ = new Date(nowMs);
          occ.setHours(hh, mm, 0, 0);
          if (schedule.type === 'weekly') {
            const targetDay = Number(schedule.day) || 0;   // 0=Sunday
            // Walk back to the most recent occurrence on the target weekday
            while (occ.getDay() !== targetDay || occ.getTime() > nowMs) {
              occ.setDate(occ.getDate() - 1);
              occ.setHours(hh, mm, 0, 0);
            }
          } else if (occ.getTime() > nowMs) {
            occ.setDate(occ.getDate() - 1);               // today's slot not reached → yesterday's
          }
          return nowMs >= occ.getTime() && lastRun < occ.getTime();
        }
        default: return false;
      }
    } catch { return false; }
  }

  _isCronDue(cronExpr, lastRunMs, nowMs) {
    try {
      const parts = cronExpr.trim().split(/\s+/);
      if (parts.length !== 5) return false;
      const [min, hr, dom, mon, dow] = parts;
      const d = new Date(nowMs);
      const matches = (field, val) => {
        if (field === '*') return true;
        const v = parseInt(field, 10);
        return !isNaN(v) && v === val;
      };
      const isDue = matches(min, d.getMinutes()) &&
                    matches(hr,  d.getHours()) &&
                    matches(dom, d.getDate()) &&
                    matches(mon, d.getMonth() + 1) &&
                    matches(dow, d.getDay());
      if (!isDue) return false;
      // Don't fire twice within the same minute
      const minuteAgo = nowMs - 60_000;
      return lastRunMs < minuteAgo;
    } catch { return false; }
  }

  async _runTask(task) {
    const taskId  = task.task_id;
    const agentId = task.assigned_to || null;
    // Hard guards against concurrency, checked synchronously right before we
    // commit to running. Belt-and-braces with the tick lock: even if two
    // code paths reach here, only the first wins.
    if (this._running.has(taskId)) return;               // already running this task
    if (this._running.size > 0) return;                  // single-flight: one task at a time (single llama.cpp sequence)
    if (agentId && agentId !== 'poseidon_main') {
      // Is this agent already busy with another running task?
      for (const tid of this._running) {
        const rt = this._runningMeta?.get(tid);
        if (rt?.agentId === agentId) return;
      }
    }
    this._running.add(taskId);
    this._runningMeta = this._runningMeta || new Map();
    this._runningMeta.set(taskId, { agentId, startedAt: Date.now() });
    // Ground-truth deliverable tracking: FilesystemTools records every real
    // write under this id while the task runs (single-flight → one id).
    global.__ACTIVE_TASK_ID = taskId;

    log.info(`▶ ${taskId}: "${task.title}"${agentId ? ' → ' + agentId : ' → poseidon'}`);

    try {
      await this._setStatus(taskId, 'wip', { started_at: new Date().toISOString() });

      // Wake the assigned agent
      if (agentId && agentId !== 'poseidon_main') {
        try { await this.rm.updateAgentStatus(agentId, 'active', { task_id: taskId, reason: `Running task: ${task.title}` }); } catch {}
      }

      // Build rich task message including project context and progress state
      const projectId   = task.context?.project_id || task.project_id || null;
      const projectName = task.context?.project_name || task.project_name || null;
      const projectPart = projectId || projectName
        ? `\nProject: ${projectName || projectId}`
        : '';

      // Inject live project memory so agent knows current state
      let projectMemoryPart = '';
      if (projectId || projectName) {
        try {
          let pid = projectId;
          if (!pid && projectName) {
            const proj = await this.rm.resolveProjectByNameOrId(projectName);
            pid = proj?.id;
          }
          if (pid) {
            const mem = await this.rm.getProjectMemory(pid);
            if (mem) {
              const lines = [`\n[PROJECT MEMORY: ${mem.name}]`];
              if (mem.vision) lines.push(`Vision: ${mem.vision}`);
              if (mem.progress?.completion) lines.push(`Progress: ${mem.progress.completion}`);
              if (mem.progress?.blockers?.length) lines.push(`Blockers: ${mem.progress.blockers.slice(0,2).map(b=>b.text||b).join('; ')}`);
              if (mem.progress?.next_steps?.length) lines.push(`Next steps: ${(mem.progress.next_steps||[]).slice(0,3).join('; ')}`);
              if (mem.progress?.recent_achievements?.length) lines.push(`Last done: ${mem.progress.recent_achievements[0]?.text || ''}`);
              lines.push('[END PROJECT MEMORY]');
              projectMemoryPart = lines.join('\n');
            }
          }
        } catch {}
      }
      const progressPart = task.progress
        ? `\nPrevious progress: ${task.progress}\n(Resume from where you left off — do NOT redo completed steps)`
        : '';
      const descPart = task.description ? `\nDetails: ${task.description}` : '';
      // The contract the quality review will judge the deliverable against.
      const critPart = task.acceptance_criteria
        ? `\nACCEPTANCE CRITERIA (your deliverable is judged against these):\n${String(task.acceptance_criteria).slice(0, 400)}`
        : '';
      // Prior deliverables + inputs in the same project — the agent can
      // read BOTH by default (Richard's rule): build ON them, don't restart.
      let priorPart = '';
      if (task.project_name) {
        try {
          const RegistryManager = require('./RegistryManager');
          const pbase = path.join(AQUARIUM.PROJECTS, RegistryManager.projectFolder({ name: task.project_name }));
          const outFiles = (await fs.readdir(path.join(pbase, 'output')).catch(() => [])).slice(-8);
          const inFiles  = (await fs.readdir(path.join(pbase, 'input')).catch(() => [])).slice(-8);
          const parts = [];
          if (inFiles.length)  parts.push(`input/: ${inFiles.join(', ')}`);
          if (outFiles.length) parts.push(`output/: ${outFiles.join(', ')}`);
          if (parts.length) priorPart = `\nProject files you can read with read_file — ${parts.join(' | ')} (extend, don't duplicate)`;
        } catch {}
      }

      // Trim components to prevent context overflow on small models (16k ctx)
      const titleLine  = `TASK [${taskId}]: ${task.title}`;
      // Pure-executor doctrine: the plan is Poseidon's job; the agent's job
      // is tool calls. Without this, agents spent their turn re-analyzing
      // the task ("thinking about what to do") instead of doing it.
      const execLine   = 'EXECUTE MODE: the plan is already decided — do NOT restate, re-plan or analyze this task. Start calling tools IMMEDIATELY and produce the deliverable. Thinking out loud is not work; only tool calls and the written output count.';
      const descLine   = descPart  ? descPart.slice(0, 400)   : '';
      const projLine   = projectPart;
      const memLine    = projectMemoryPart ? projectMemoryPart.slice(0, 400) : '';
      const progLine   = progressPart ? progressPart.slice(0, 200) : '';
      const msg = [
        titleLine, execLine, descLine, critPart, priorPart, projLine, memLine, progLine,
        '\n---\nUse your tools. Update progress after each step. ' +
        'FILES: write ONLY final deliverables to output/, intermediate files to work/. ' +
        'Do NOT create other folders. Do NOT save thoughts/notes/plans as files — condense them into ' +
        'update_project_memory (sections: decision, notes, achievement). When done, log the achievement and end with a summary.'
      ].join('').trim().slice(0, 1600);  // cap covers the files contract

      let output = '';
      let failed = false;
      let toolCalls = -1;  // -1 = unknown (AgentWorker path); counted on the BG-Poseidon path

      // ── IMAGE GEN TASK ────────────────────────────────────────────────────
      // Detect by task_type first (most reliable), then by title pattern
      const isImageTask = (task.task_type === 'image_gen')
        || /image[_\s]gen/i.test(task.task_type || '')
        || /^generate[: ]/i.test(task.title)
        || /^image[: ]/i.test(task.title)           // "Image: ..." format
        || /^draw[: ]/i.test(task.title)
        || /^illustrate[: ]/i.test(task.title)
        || /^render[: ]/i.test(task.title)
        || !!(task.image_params);                   // has explicit image params

      if (isImageTask) {
        let imageServeUrl = null;
        let resolvedModelId = null;
        try {
          // Read structured image_params (set by Poseidon generate_image tool)
          // or fall back to parsing description / title
          let ip = task.image_params || null;
          if (!ip && task.description) {
            try { ip = JSON.parse(task.description); } catch {}
          }

          const prompt       = ip?.prompt || task.description || task.title.replace(/^generate[: ]*/i, '');
          const negPrompt    = ip?.negative_prompt || '';
          const width        = ip?.width  || 512;
          const height       = ip?.height || 512;
          const steps        = ip?.steps  || 6;
          const cfg          = ip?.cfg_scale ?? 1.0;
          const seed         = ip?.seed ?? -1;
          const filename     = ip?.filename || `image_${Date.now()}.png`;
          const reqModelId   = ip?.model_id || null;

          log.info(`Image gen ${taskId}: model="${reqModelId}" prompt="${prompt.slice(0,60)}"`);

          const result = await this.modelService.generateImage({
            modelId:        reqModelId,
            model_id:       reqModelId,
            prompt,
            negativePrompt: negPrompt,
            outputPath:     null,
            task_id:        taskId,
            width, height, steps, cfg, seed,
            initImage:      ip?.init_image || null,
            strength:       ip?.strength ?? 0.75,
          });

          resolvedModelId = result?.resolvedModelId || reqModelId;

          if (result?.ok && result.outputPath) {
            imageServeUrl = `/api/files/read?path=${encodeURIComponent(result.outputPath)}`;
            output = `Image saved: ${result.outputPath}`;

            // Optional second-wave upscale (hi-res fix). Uses the just-generated
            // image as init-img at doubled dimensions with low strength so the
            // final image gains detail rather than diverging from wave 1.
            const upscale = Number(ip?.upscale || 0);
            if (upscale >= 2) {
              const path2 = require('path');
              const upscaledPath = result.outputPath.replace(/\.(png|jpe?g)$/i, '_x' + upscale + '.$1');
              log.info(`Image gen ${taskId}: running upscale pass x${upscale} → ${path2.basename(upscaledPath)}`);
              const up = await this.modelService.generateImage({
                modelId:        reqModelId,
                model_id:       reqModelId,
                prompt,
                negativePrompt: negPrompt,
                outputPath:     upscaledPath,
                task_id:        taskId + '_upscale',
                width:          width  * upscale,
                height:         height * upscale,
                // Fewer steps in the refinement pass — details, not composition
                steps:          Math.min(steps, 6),
                cfg,
                seed,
                initImage:      result.outputPath,
                strength:       0.35,   // mostly preserve the wave-1 image
              });
              if (up?.ok && up.outputPath) {
                imageServeUrl = `/api/files/read?path=${encodeURIComponent(up.outputPath)}`;
                output += `\nUpscale x${upscale} saved: ${up.outputPath}`;
              } else {
                output += `\nUpscale x${upscale} FAILED: ${up?.error || 'unknown'}`;
              }
            }
          } else {
            // Include full error detail so it's visible in the task output
            const errDetail = result?.error || result?.stderr || JSON.stringify(result);
            output = `Image gen failed [model: ${resolvedModelId || reqModelId || 'unknown'}]: ${errDetail}`;
            failed = true;
          }
        } catch (e) {
          output = `Image gen failed: ${e.message}`;
          failed = true;
        }

        // Persist completion
        const prevFails = this._failCounts.get(taskId) || 0;
        if (failed && prevFails + 1 < this.MAX_RETRIES) {
          const attempt = prevFails + 1;
          this._failCounts.set(taskId, attempt);
          const backoff = RETRY_BACKOFF[attempt] || RETRY_BACKOFF[RETRY_BACKOFF.length - 1];
          this._retryAfter.set(taskId, Date.now() + backoff);
          await this._setStatus(taskId, 'todo');
          log.warn(`✗ image ${taskId} (attempt ${attempt}/${this.MAX_RETRIES}) — retry in ${backoff/1000}s`);
        } else {
          await this._markDone(taskId);
          if (failed) { this._failCounts.set(taskId, this.MAX_RETRIES); }
          const extra = {
            outcome:        failed ? 'failed' : 'passed',
            result_summary: output.slice(0, 500),
            completed_at:   new Date().toISOString(),
            ...(imageServeUrl ? { output_preview: imageServeUrl } : {})
          };
          await this._setStatus(taskId, 'done', extra);
          log.info(`${failed ? '✗✗' : '✓'} image ${taskId} done${failed ? ' (failed)' : ''}`);

          if (!failed && resolvedModelId) {
            // Auto-update Poseidon's generate_image skill with the confirmed working model id
            try {
              const skillPath = require('path').join(require('../aquarium').SKILLS, 'generate_image.json');
              const fs = require('fs');
              let skill = {};
              try { skill = JSON.parse(fs.readFileSync(skillPath, 'utf8')); } catch {}
              skill.skill_id   = skill.skill_id || 'generate_image';
              skill.name       = skill.name || 'Generate Image';
              skill.version    = (skill.version || 0) + 1;
              skill.updated_at = new Date().toISOString();
              skill.notes      = (skill.notes || '') + `\n[${new Date().toISOString().slice(0,10)}] Confirmed working model: ${resolvedModelId}`;
              skill.confirmed_image_model = resolvedModelId;
              fs.writeFileSync(skillPath, JSON.stringify(skill, null, 2), 'utf8');
              log.info(`Updated generate_image skill with model: ${resolvedModelId}`);
            } catch {}
          }

          await this._notify(`[IAQUA] ${failed ? 'Image FAILED' : 'Image done'}: "${task.title.slice(0,60)}"\n${imageServeUrl ? imageServeUrl : output.slice(0,200)}`);
        }
        this._running.delete(taskId);
        this._runningMeta?.delete(taskId);
      if (global.__ACTIVE_TASK_ID === taskId) global.__ACTIVE_TASK_ID = null;
      global.__TASK_WRITES?.delete(taskId);
        return;
      }

      // ── ROUTING DECISION ──────────────────────────────────────────────────
      // If the assigned agent has a DIFFERENT preferred_model_id than Poseidon,
      // route through AgentWorkerPool (own model, own session, own skills).
      // Otherwise route through Poseidon BG (same model, sequence-shared, faster).
      //
      // AgentWorkerPool handles VRAM safely: broker is acquired BEFORE any eviction,
      // so no other inference can race into a half-evicted state.
      let usedAgentWorker = false;
      if (agentId && agentId !== 'poseidon_main' && this.agentPool) {
        try {
          const agentReg = await this.rm.getAgentRegistry();
          const agentEntry = agentReg.agents?.[agentId];
          if (agentEntry) {
            const brain = await this.rm.read(`AGENTS/${agentEntry.brain_file}`).catch(() => null);
            const preferredModel = brain?.brain_config?.model_binding?.preferred_model_id || null;
            const poseidonModel  = this.modelService.poseidonModelId;
            // Only route to AgentWorkerPool if agent explicitly has a DIFFERENT model configured
            const needsOwnModel  = preferredModel && preferredModel !== poseidonModel;

            if (needsOwnModel) {
              log.info(`▶ ${taskId} → AgentWorkerPool (agent model: ${preferredModel})`);
              usedAgentWorker = true;
              toolCalls = 0;  // count real tool activity for the honesty gate
              const gen = await this.agentPool.dispatch(agentId, msg);
              for await (const ev of gen) {
                if (ev.type === 'text')           output += ev.chunk;
                if (ev.type === 'error')          { output += `\nError: ${ev.error}`; failed = true; }
                if (ev.type === 'tool_call')      toolCalls++;
                const bus = global.ReasoningBus;
                if (bus) {
                  if (ev.type === 'text')          bus.push({ type: 'text',          task_id: taskId, chunk: ev.chunk });
                  if (ev.type === 'thinking')      bus.push({ type: 'thinking',      task_id: taskId, chunk: ev.chunk });
                  if (ev.type === 'thinking_start') bus.push({ type: 'thinking_start', task_id: taskId });
                  if (ev.type === 'thinking_end')   bus.push({ type: 'thinking_end',   task_id: taskId });
                  if (ev.type === 'tool_call')      bus.push({ type: 'tool_call',    task_id: taskId, name: ev.name, args: ev.args });
                  if (ev.type === 'tool_result')    bus.push({ type: 'tool_result',  task_id: taskId, name: ev.name, ok: ev.result?.ok !== false, summary: String(ev.result?.message || '').slice(0, 200) });
                }
              }
            }
          }
        } catch (agentErr) {
          log.warn(`AgentWorkerPool dispatch failed for ${taskId}, falling back to Poseidon BG:`, agentErr.message);
          usedAgentWorker = false; // fall through to Poseidon BG path
        }
      }

      if (!usedAgentWorker) {
      try {
        // Broker holder id uses the AGENT display name (fallback: id) so the
        // log line reads e.g. "MEDIA_MONITOR-task_0131" instead of the
        // anonymous "bg_task_task_0131" — makes it obvious which agent is
        // running when several are queued.
        let holderId = `bg_task_${taskId}`;
        try {
          const areg = await this.rm.getAgentRegistry();
          const ae = agentId ? areg.agents?.[agentId] : null;
          if (ae) {
            const rawName = ae.display_name || ae.agent_id || agentId;
            const slug = String(rawName).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 24);
            holderId = `${slug}-${taskId}`;
          }
        } catch {}
        // Poseidon BG path: same model, inject agent persona as prefix.
        // Agent-assigned tasks run at AGENT priority (2) — above POSEIDON_BG,
        // below CHAT/IMAGE. Matches the broker doctrine: CHAT > AGENT > BG.
        const bgToken = await this.modelService.broker.acquire(
          PRIORITY.AGENT, holderId,
          { timeoutMs: 10 * 60 * 1000 }
        );
        // Declared ONCE at the top of the hold — referencing it inside the
        // phase-swap block below used to hit the temporal dead zone
        // ("Cannot access 'bus' before initialization") and abort the swap
        // halfway, leaving the agent on the chat-regime context.
        const bus = global.ReasoningBus;
        try {
          // ═══ PHASE SWAP: AGENT ═══════════════════════════════════════════
          // Each phase gets its own resident model + context regime. Agent
          // work runs on the project's assigned_model_id (or Poseidon as
          // fallback) with a tight ctx (6144) — no chat KV leaks in, no
          // agent KV leaks out.
          //
          // QUIESCE FIRST: if a force-release handed us the broker while a
          // generation is still in flight (observed), swapping/disposing
          // under it crashes with "Object is disposed". Abort + wait.
          await this.modelService.quiesceGeneration?.(15000);
          try {
            const projEntry = task.project_name
              ? (await this.rm.resolveProjectByNameOrId(task.project_name))?.entry
              : null;
            await this.modelService.ensureLoadedFor('agent', projEntry);
            // Stamp WHAT this phase is doing on the entry — the tower reads
            // this to show "AGENT · task_0128 · NEWSROOM · agent_0006" live.
            const poseidonId = this.modelService.poseidonModelId;
            const currentModelId = projEntry?.assigned_model_id || poseidonId;
            const currentEntry = this.modelService.loaded.get(currentModelId);
            if (currentEntry) {
              currentEntry._phaseTaskId = taskId;
              currentEntry._phaseProject = task.project_name || null;
              currentEntry._phaseAgent = agentId || null;
              currentEntry._phaseAgentName = task.assigned_name || null;
            }
            if (bus) bus.push({ type: 'phase', phase: 'agent', task_id: taskId, project: task.project_name });
          } catch (swapErr) {
            log.warn(`Phase swap to agent failed: ${swapErr.message} — continuing on current model`);
          }
          // Dispose Poseidon session AND sequence before the agent turn —
          // frees the single slot. ONLY safe because we quiesced above; if
          // a generation somehow survived the quiesce window, skip the
          // dispose entirely (a slow turn beats a native crash).
          const poseidonId = this.modelService.poseidonModelId;
          const posEntry = poseidonId ? this.modelService.loaded.get(poseidonId) : null;
          if (posEntry && !posEntry.generating) {
            if (posEntry.session) {
              try { await posEntry.session.dispose?.(); } catch {}
              posEntry.session = null;
            }
            if (posEntry._currentSequence) {
              try { await posEntry._currentSequence.dispose?.(); } catch {}
              posEntry._currentSequence = null;
            }
            posEntry.sessionTurns      = 0;
            posEntry.contextPct        = 0;
            posEntry.contextUsedTokens = 0;
            // Wait for llama.cpp native release — dispose() is async but
            // the native slot release can lag; 500ms is safe on most hardware.
            await new Promise(r => setTimeout(r, 500));
          }

          // Build agent persona prefix if task is assigned to a named agent
          let agentPrefix = '';
          if (agentId && agentId !== 'poseidon_main') {
            try {
              const registry = await this.rm.getAgentRegistry();
              const agentEntry = registry.agents?.[agentId];
              if (agentEntry) {
                const brain = await this.rm.read(`AGENTS/${agentEntry.brain_file}`);
                const name  = brain?.identity?.display_name || brain?.identity?.nickname
                           || agentEntry.display_name || agentId;
                const role  = brain?.identity?.role || agentEntry.specialization || '';

                // Read system_prompt from all known schema locations
                const persona =
                  brain?.brain_config?.system_prompt ||
                  brain?.personality?.description    ||
                  brain?.system_prompt               ||
                  (role ? `You are ${name}, an AI agent specializing in: ${role}.` : '');

                // Skills are SHARED across the platform (see AgentForm) —
                // no per-agent whitelist. The agent discovers skills via the
                // execute_skill tool at runtime; enumerating them here would
                // just be prompt bloat.
                const modelPref = brain?.brain_config?.model_binding?.preferred_model_id
                  ? `\nPreferred model: ${brain.brain_config.model_binding.preferred_model_id}`
                  : '';

                agentPrefix = `[AGENT: ${name}]\n`;
                if (persona) agentPrefix += `${persona.slice(0, 500)}\n`;
                if (role && persona && !persona.includes(role)) agentPrefix += `Role: ${role}\n`;
                agentPrefix += modelPref + `---\n`;
              }
            } catch (e) {
              log.warn(`Could not load agent brain for ${agentId}:`, e.message);
            }
          }

          const posMsg = `[BACKGROUND AUTO-TASK ${taskId}]\n${agentPrefix}${msg}`;
          // Preemption: abort BG inference the moment a CHAT request is queued.
          // The task will retry on the next tick once Poseidon is free.
          let preempted = false;
          toolCalls = 0;  // count real tool activity for the honesty gate
          if (bus) bus.push({ type: 'task_start', task_id: taskId, title: task.title, agent: agentId || 'poseidon', project: task.project_name });
          // Per-agent sampling: an artist runs hot, an analyst runs cold.
          // brain_config.inference_params existed in every brain file but
          // was never applied at generation until now.
          let _genParams = null;
          if (agentId) {
            try {
              const areg2 = await this.rm.getAgentRegistry();
              const ae2 = areg2.agents?.[agentId];
              const abrain = ae2?.brain_file ? await this.rm.read(`AGENTS/${ae2.brain_file}`) : null;
              const ip = abrain?.brain_config?.inference_params;
              if (ip && Number.isFinite(ip.temperature)) {
                _genParams = { temperature: ip.temperature, topP: ip.top_p, topK: ip.top_k };
                log.info(`  sampling for ${agentId}: T=${ip.temperature}${ip.top_p ? ` topP=${ip.top_p}` : ''}`);
              }
            } catch {}
          }
          // AGENT ISOLATION — the agent gets a compact mission-only prompt:
          // its identity, the execution doctrine, honesty rules and tool
          // protocol. No aquarium vision, no orchestration doctrine, no
          // project-management rules (~500 tok vs ~4800 for the full prompt).
          let _agentPrompt = null;
          if (agentId) {
            try {
              const areg3 = await this.rm.getAgentRegistry();
              const ae3 = areg3.agents?.[agentId];
              const abrain3 = ae3?.brain_file ? await this.rm.read(`AGENTS/${ae3.brain_file}`).catch(() => null) : null;
              const aname = abrain3?.identity?.nickname || ae3?.display_name || agentId;
              const arole = abrain3?.identity?.role || ae3?.specialization || 'general worker';
              _agentPrompt = [
                `You are ${aname}, a ${arole}. You execute ONE task, alone, unattended.`,
                '',
                '# EXECUTION',
                'The plan is already decided. Do NOT restate, re-plan or analyze the task — start calling tools immediately and produce the deliverable.',
                'Write every deliverable file under output/ with write_file. A reply without a written file is NOT a completed task (unless the task explicitly asks for analysis only).',
                'NOBODY is present: never ask questions. Decide everything yourself; open with one short "Assumptions:" line if you made choices.',
                '',
                '# TOOLS — CALL THEM, NEVER WRITE THEM',
                'Your tools are real functions injected by the runtime. Call them through the function-calling mechanism, ONE at a time, wait for each real result.',
                'NEVER write tool syntax as text ("||tool(...)", JSON blobs, pseudo-calls in code fences) — text that looks like a call does NOTHING.',
                '',
                '# HONESTY',
                'Never state that something was done unless YOU called the tool this turn and saw its real result. Your output is verified against the actual files written.',
              ].join('\n');
            } catch {}
          }
          let _lastTouch = 0;
          for await (const ev of this.modelService.chatWithPoseidon(posMsg, [], { _skipBroker: true, _bgMode: true, _genParams, _agentPrompt })) {
            // Keepalive on the OUTER TaskRunner token — a long BG generation
            // must not expire as a dead holder mid-run.
            if (Date.now() - _lastTouch > 10_000) { _lastTouch = Date.now(); this.modelService.broker.touch(bgToken); }
            if (ev.type === 'text')          { output += ev.chunk; bus?.push({ type: 'text', task_id: taskId, chunk: ev.chunk }); }
            if (ev.type === 'error')         { failed = true; output += `\nExecution error: ${ev.error}`; bus?.push({ type: 'tool_result', task_id: taskId, name: 'generation', ok: false, summary: String(ev.error).slice(0, 200) }); }
            if (ev.type === 'thinking')      bus?.push({ type: 'thinking', task_id: taskId, chunk: ev.chunk });
            if (ev.type === 'thinking_start') bus?.push({ type: 'thinking_start', task_id: taskId });
            if (ev.type === 'thinking_end')   bus?.push({ type: 'thinking_end', task_id: taskId });
            if (ev.type === 'tool_call')      { toolCalls++; bus?.push({ type: 'tool_call', task_id: taskId, name: ev.name, args: ev.args }); }
            if (ev.type === 'tool_result')    bus?.push({ type: 'tool_result', task_id: taskId, name: ev.name, ok: ev.result?.ok !== false, summary: String(ev.result?.message || '').slice(0, 200) });
            if (this.modelService.broker.hasHighPriorityWaiting()) {
              preempted = true;
              this.modelService.abortGeneration?.();
              break;
            }
          }
          if (bus) bus.push({ type: 'task_end', task_id: taskId });
          if (preempted) {
            log.info(`BG task ${taskId} preempted by CHAT — will retry`);
            throw new Error('PREEMPTED_BY_CHAT');
          }
        } finally {
          // Dispose session AND sequence independently before releasing broker.
          // CHAT acquires immediately on release — sequence must be free first.
          // Quiesce first: never dispose under a live generation.
          await this.modelService.quiesceGeneration?.(10000);
          const posId  = this.modelService.poseidonModelId;
          const posEnt = posId ? this.modelService.loaded.get(posId) : null;
          if (posEnt && !posEnt.generating) {
            if (posEnt.session) {
              try { await posEnt.session.dispose?.(); } catch {}
              posEnt.session = null;
            }
            if (posEnt._currentSequence) {
              try { await posEnt._currentSequence.dispose?.(); } catch {}
              posEnt._currentSequence = null;
            }
            posEnt.sessionTurns      = 0;
            posEnt.contextPct        = 0;
            posEnt.contextUsedTokens = 0;
            await new Promise(r => setTimeout(r, 500));  // ensure llama.cpp frees the slot
          }
          this.modelService.broker.release(bgToken);
        }
      } catch (e) {
        if (e.message === 'PREEMPTED_BY_CHAT') {
          // Not a real failure — task will retry next tick after CHAT finishes
          this._running.delete(taskId);
          this._runningMeta?.delete(taskId);
      if (global.__ACTIVE_TASK_ID === taskId) global.__ACTIVE_TASK_ID = null;
      global.__TASK_WRITES?.delete(taskId);
          return;
        }
        output = `Execution error: ${e.message}`;
        failed = true;
      }
      } // end if (!usedAgentWorker)

      // Empty output = nothing happened. Never a success.
      if (!failed && output.trim().length === 0) {
        failed = true;
        output = 'Execution error: generation produced no output';
      }

      // ── COMPLETION HONESTY GATE ─────────────────────────────────────────
      // A small model can end with a confident summary while having done
      // nothing. Two VERIFIABLE lies (checked against the tool-write ledger,
      // not against what the model claims):
      //  1. The reply says a file was written/created/saved but zero
      //     write_file/edit_file calls happened this task → hallucinated
      //     deliverable, previously accepted as 'completed'.
      //  2. Near-empty reply with zero tool calls → nothing happened at all.
      // Failing here feeds the teaching text into the retry's progress field,
      // so attempt 2 knows exactly what to fix.
      if (!failed && output.trim().length > 0) {
        const ledger = global.__TASK_WRITES?.get(taskId) || [];
        const claimsFile =
          /\b(sav|wrot|writ|creat|generat|export)\w*\b[^.\n]{0,80}\.(md|txt|json|csv|html|png|jpg|docx|pptx|xlsx|pdf)\b/i.test(output)
          || /\boutput\/[\w.-]+/i.test(output);
        if (claimsFile && ledger.length === 0) {
          failed = true;
          output = `HONESTY GATE: the reply claims a file was written but NO write_file/edit_file call happened during this task. Actually CREATE the deliverable with write_file (path under output/) — do not describe it. Claimed reply was: ${output.slice(0, 300)}`;
        } else if (/\|\|\s*[a-z_]{3,}\s*\(/i.test(output)) {
          // Pseudo tool-calls written as TEXT ("||create_task({...})" in a
          // code fence) — the model narrated the syntax instead of calling
          // the function. Nothing executed. Detectable, teachable.
          failed = true;
          output = `HONESTY GATE: the reply contains tool-call SYNTAX written as text ("||tool(...)"). Text that looks like a call does NOTHING — no task was created, no memory updated. CALL the functions through the function-calling mechanism, one at a time, and wait for each real result. Reply was: ${output.slice(0, 300)}`;
        } else if (ledger.length === 0 && toolCalls === 0 && output.trim().length < 200) {
          failed = true;
          output = `HONESTY GATE: task ended after ${output.trim().length} chars with ZERO tool calls and ZERO files. Do the actual work with your tools, then summarize. Reply was: ${output.slice(0, 200)}`;
        }
        if (failed) {
          await this.rm.log({
            event_type: 'honesty_gate', severity: 'warning',
            actor: { type: 'system', id: agentId || 'poseidon_main' },
            subject: { type: 'task', id: taskId },
            action: `Honesty gate rejected completion of "${task.title}"`,
            context: { reason: output.slice(0, 200), tool_calls: toolCalls, files_written: ledger.length }
          }).catch(() => {});
          log.warn(`⚖ honesty gate rejected ${taskId} (tools=${toolCalls}, writes=${ledger.length})`);
          // Reputation: strikes accumulate on the agent even when the task
          // goes on to succeed on retry — Poseidon sees them in its agent
          // roster and can route critical work to agents that don't fabricate.
          if (agentId && agentId !== 'poseidon_main') {
            try {
              const areg = await this.rm.getAgentRegistry();
              const ag = areg.agents?.[agentId];
              if (ag) {
                ag.performance_summary = ag.performance_summary || {};
                ag.performance_summary.honesty_strikes = (ag.performance_summary.honesty_strikes || 0) + 1;
                await this.rm.write('AGENTS/agent_registry.json', areg);
              }
            } catch {}
          }
        }
      }

      if (output.trim().length > 0 && !output.startsWith('Execution error:')) {
        await this._saveOutput(taskId, output);
      }

      if (failed) {
        const errType = classifyError(output);

        // Resource contention errors (sequence slot, OOM) are NEVER permanent failures —
        // they're transient and should retry indefinitely with long backoff.
        const isResourceError = errType === 'sequence' || errType === 'oom';

        const prevFails = (this._failCounts.get(taskId) || 0) + 1;
        if (!isResourceError) {
          this._failCounts.set(taskId, prevFails);
        }
        // Only non-resource errors count toward permanent failure
        const effectiveFails = isResourceError ? 0 : prevFails;

        if (!isResourceError && effectiveFails >= this.MAX_RETRIES) {
          log.warn(`✗✗ ${taskId} hit ${this.MAX_RETRIES} failures (${errType}) — permanently failed`);
          await this._markDone(taskId);
          await this._setStatus(taskId, 'done', {
            outcome: 'failed',
            completed_at: new Date().toISOString(),
            output_preview: `Failed after ${prevFails} attempts [${errType}]. Last: ${output.slice(0, 200)}`
          });
          await this._notify(`[IAQUA] Task FAILED: "${task.title}"\n[${errType}] ${output.slice(0, 200)}`);
          task._disposition = 'permanently failed';
        } else {
          const backoffMs = isResourceError
            ? 60_000 + Math.random() * 30_000   // 60-90s jitter for resource errors
            : errType === 'oom'
              ? (RETRY_BACKOFF[prevFails] || 300_000) * 2
              : (RETRY_BACKOFF[prevFails] || 30_000);
          this._retryAfter.set(taskId, Date.now() + backoffMs);
          const label = isResourceError ? `[${errType}] resource contention` : `attempt ${prevFails}/${this.MAX_RETRIES} [${errType}]`;
          log.warn(`✗ ${taskId} ${label} — retry in ${Math.round(backoffMs/1000)}s`);
          await this._setStatus(taskId, 'todo', {
            output_preview: `${label}: retry in ${Math.round(backoffMs/1000)}s`
          });
          task._disposition = `back to todo — retry in ${Math.round(backoffMs/1000)}s`;
          // Learning retry: the next attempt's prompt includes task.progress
          // ("Previous progress: … Resume from where you left off"). Feed the
          // failure reason into it so the agent doesn't repeat the same
          // mistake blind. Resource errors (oom/sequence) are NOT the agent's
          // fault — keep progress clean for those.
          if (!isResourceError) {
            await this._updateProgressField(taskId,
              `attempt ${prevFails} FAILED [${errType}]: ${String(output).slice(0, 180)} — fix this specific problem, don't redo completed steps`);
          }
        }
      } else {
        // ═══ PHASE REVIEW — Poseidon judges BEFORE anything is finalized ═══
        // Mark the task as awaiting_review NOW so the Control Tower / Kanban
        // shows a distinct macaron for the ~30-60s window between the agent
        // finishing and Poseidon's verdict landing. Without this the UI
        // shows plain "wip" while the model is actually stopped, which
        // makes the review phase invisible to the user.
        try {
          const reg0 = await this.rm.getTasksRegistry().catch(() => null);
          if (reg0?.tasks?.[taskId]) {
            reg0.tasks[taskId].awaiting_review = true;
            await this.rm._writeTaskDetails(taskId, reg0.tasks[taskId]);
          }
        } catch {}
        // The workflow: agent done → agent context gone → Poseidon loaded
        // with review as its FIRST priority action. Verdict decides:
        //   PASS   → done (+stats, +project memory), next task in queue
        //   REVISE → description upgraded, back to todo (same agent reruns)
        // Previously the task was marked completed AND purged to results_log
        // BEFORE the review ran, so a REVISE verdict landed on a purged task
        // blocked by _done — it could never re-run. Review also ran with
        // _skipBroker AFTER the broker release, so a chat could steal the
        // model mid-review. Both fixed: review-first, under its own token.
        // Unparseable verdicts default to PASS so a sloppy reviewer can
        // never loop a task forever. Max 1 revision per task.
        let verdict = 'PASS', fixes = '', score = null;
        if ((task.revisions || 0) < 1) {
          let reviewToken = null;
          try {
            reviewToken = await this.modelService.broker.acquire(
              PRIORITY.AGENT, `review-${taskId}`, { timeoutMs: 10 * 60 * 1000 }
            );
            // ═══ PHASE SWAP: REVIEW — fresh model + fresh 10k ctx dedicated
            // to judging this one deliverable. The agent KV is gone. Clean
            // judgement. Quiesce first — never swap under a live generation.
            await this.modelService.quiesceGeneration?.(10000);
            try {
              const projEntry = task.project_name
                ? (await this.rm.resolveProjectByNameOrId(task.project_name))?.entry
                : null;
              await this.modelService.ensureLoadedFor('review', projEntry);
            } catch (swapErr) {
              log.warn(`Phase swap to review failed: ${swapErr.message}`);
            }
            const ledger2 = global.__TASK_WRITES?.get(taskId) || [];
            // Review the actual deliverable file when one was written, else the reply.
            let deliverable = output;
            if (ledger2.length) {
              const rel = ledger2[ledger2.length - 1].path || String(ledger2[ledger2.length - 1]);
              const candidates = [
                rel,
                path.join(AQUARIUM.ROOT || path.dirname(AQUARIUM.TASKS), rel),
                task.project_name ? path.join(AQUARIUM.PROJECTS, require('./RegistryManager').projectFolder({ name: task.project_name }), rel) : null,
              ].filter(Boolean);
              for (const cand of candidates) {
                try { deliverable = await fs.readFile(cand, 'utf8'); break; } catch {}
              }
            }
            const crit = task.acceptance_criteria
              ? `ACCEPTANCE CRITERIA:\n${String(task.acceptance_criteria).slice(0, 400)}`
              : 'No explicit criteria — judge on: does it fully accomplish the task title, is it concrete (no filler/placeholders), is it usable as-is.';
            const reviewPrompt =
              `[QUALITY REVIEW — reply with the verdict ONLY, no tools]\n` +
              `Task: ${task.title}\n${crit}\n\nDELIVERABLE (may be truncated):\n${String(deliverable).slice(0, 2800)}\n\n` +
              `Reply EXACTLY in this format:\nSCORE: <1-10>\nVERDICT: <PASS|REVISE>\nFIXES: <if REVISE: 2 concrete, specific fixes; if PASS: ->`;
            let review = '';
            let _revTouch = 0;
            for await (const ev of this.modelService.chatWithPoseidon(reviewPrompt, [], { _skipBroker: true, _bgMode: true })) {
              if (Date.now() - _revTouch > 10_000) { _revTouch = Date.now(); this.modelService.broker.touch(reviewToken); }
              if (ev.type === 'text') review += ev.chunk;
              if (review.length > 1200) break;
            }
            score   = parseInt((review.match(/SCORE:\s*(\d{1,2})/i) || [])[1], 10);
            verdict = /VERDICT:\s*REVISE/i.test(review) ? 'REVISE' : 'PASS';
            fixes   = ((review.match(/FIXES:\s*([\s\S]{0,400})/i) || [])[1] || '').trim();
            log.info(`⭐ quality review ${taskId}: ${verdict}${Number.isFinite(score) ? ` (${score}/10)` : ''}`);
          } catch (revErr) {
            log.warn(`quality review skipped for ${taskId}: ${revErr.message}`);
            verdict = 'PASS';
          } finally {
            // Same discipline as the agent phase: free the slot cleanly.
            await this.modelService.quiesceGeneration?.(10000);
            const posId2  = this.modelService.poseidonModelId;
            const posEnt2 = posId2 ? this.modelService.loaded.get(posId2) : null;
            if (posEnt2 && !posEnt2.generating) {
              if (posEnt2.session) { try { await posEnt2.session.dispose?.(); } catch {} posEnt2.session = null; }
              if (posEnt2._currentSequence) { try { await posEnt2._currentSequence.dispose?.(); } catch {} posEnt2._currentSequence = null; }
              posEnt2.sessionTurns = 0; posEnt2.contextPct = 0; posEnt2.contextUsedTokens = 0;
              await new Promise(r => setTimeout(r, 500));
            }
            if (reviewToken) this.modelService.broker.release(reviewToken);
          }
        }

        task.review = { score: Number.isFinite(score) ? score : null, verdict, at: new Date().toISOString() };

        if (verdict === 'REVISE' && fixes) {
          // Back to todo with an UPGRADED DESCRIPTION — the revision
          // requirements drive the re-run prompt fully; progress carries the
          // teaching. Nothing was finalized: no _markDone, no stats, no
          // results_log entry. The assigned agent picks it up next tick.
          const upgradedDesc = `${task.description || ''}\n\nREVISION REQUIREMENTS (validation, attempt ${(task.revisions || 0) + 1}): ${fixes}`.slice(0, 1200);
          await this._setStatus(taskId, 'todo', {
            revisions: (task.revisions || 0) + 1,
            review: task.review,
            description: upgradedDesc,
            awaiting_review: false,
            progress: `QUALITY REVIEW${Number.isFinite(score) ? ` (${score}/10)` : ''} — the previous deliverable needs these SPECIFIC fixes before it is acceptable: ${fixes}. Revise the existing deliverable (read it first), do not start from scratch.`
          });
          await this.rm.log({
            event_type: 'quality_review', severity: 'info',
            actor: { type: 'system', id: 'quality_review' },
            subject: { type: 'task', id: taskId },
            action: `Review sent "${task.title}" back for revision${Number.isFinite(score) ? ` (${score}/10)` : ''}`,
            context: { fixes: fixes.slice(0, 300) }
          }).catch(() => {});
          return; // not final — the task re-runs with the fixes
        }

        // ── PASS → finalize ───────────────────────────────────────────────
        this._failCounts.delete(taskId);
        this._retryAfter.delete(taskId);
        await this._markDone(taskId);  // persist: never re-run even after restart
        // Verified deliverables — what the tools ACTUALLY wrote during this
        // task, independent of what the model claims in its summary.
        const writes = global.__TASK_WRITES?.get(taskId) || [];
        const filesWritten = writes.map(w => w.path).slice(0, 20);
        await this._setStatus(taskId, 'done', {
          outcome: 'passed',
          review: task.review,
          awaiting_review: false,
          completed_at: new Date().toISOString(),
          output_preview: output.slice(0, 300),
          result_summary: output.slice(0, 500),
          ...(filesWritten.length ? { files_written: filesWritten } : {})
        });
        await this._notify(`[IAQUA] Task done: "${task.title}"\n${output.slice(0, 200)}`);
        // Update project memory if task belongs to a project
        await this._updateProjectMemoryForTask(task, 'done', output);
      }

      const finalStatus = failed ? (task._disposition || 'failed') : 'done (review passed)';

      await this.rm.log({
        event_type: 'task_completed', severity: failed ? 'warning' : 'info',
        actor: { type: 'system', id: agentId || 'poseidon_main' },
        subject: { type: 'task', id: taskId },
        action: `Task ${finalStatus}: "${task.title}"`,
        context: { output_chars: output.length, agent: agentId || 'poseidon' }
      }).catch(() => {});

      log.info(`${failed?'✗':'✓'} ${taskId} ${finalStatus} (${output.length} chars)`);
    } finally {
      // Put agent back to sleep
      if (agentId && agentId !== 'poseidon_main') {
        try { await this.rm.updateAgentStatus(agentId, 'sleeping'); } catch {}
      }
      this._running.delete(taskId);
      this._runningMeta?.delete(taskId);
      if (global.__ACTIVE_TASK_ID === taskId) global.__ACTIVE_TASK_ID = null;
      global.__TASK_WRITES?.delete(taskId);
      // Clear phase meta on the loaded entry when this task's phase ends —
      // otherwise the tower would keep showing "AGENT · task_0128" after
      // the task returned to chat phase.
      const poseidonId = this.modelService.poseidonModelId;
      const posEntry = poseidonId ? this.modelService.loaded.get(poseidonId) : null;
      if (posEntry && posEntry._phaseTaskId === taskId) {
        posEntry._phaseTaskId = null;
        posEntry._phaseProject = null;
        posEntry._phaseAgent = null;
        posEntry._phaseAgentName = null;
      }
    }
  }

  async _setStatus(taskId, status, extra = {}) {
    try {
      let task = await this.rm._readTaskDetails(taskId);
      if (!task) { log.warn(`_setStatus: task ${taskId} not found`); return; }

      task.status    = status;
      task.lifecycle = { ...(task.lifecycle || {}), status };
      if (extra.result_summary !== undefined) task.result_summary = extra.result_summary;
      if (extra.result_file    !== undefined) task.result_file    = extra.result_file;
      if (extra.completed_at   !== undefined) { task.completed_at = extra.completed_at; task.lifecycle.completed_at = extra.completed_at; }
      if (extra.started_at     !== undefined) task.lifecycle.started_at = extra.started_at;
      // Generic pass-through for retry/review machinery (progress carries
      // teaching text into the next attempt's prompt; revisions caps the
      // quality-review loop; review stores the verdict for the UI).
      if (extra.progress  !== undefined) task.progress  = extra.progress;
      if (extra.revisions !== undefined) task.revisions = extra.revisions;
      if (extra.review    !== undefined) task.review    = extra.review;
      if (extra.description !== undefined) task.description = extra.description;
      if (extra.outcome   !== undefined) task.outcome   = extra.outcome;
      if (extra.awaiting_review !== undefined) task.awaiting_review = extra.awaiting_review;

      // Canonical terminal status is 'done' (+ outcome passed|failed).
      // results_log and the cascade keep the legacy completed/failed
      // vocabulary — it's an archive read by the client RESULTS pane and
      // by cascadeTaskClosure's stats counters.
      const TERMINAL_FOR_LOG = new Set(['done', 'completed', 'failed', 'cancelled']);
      const archiveStatus = status === 'done'
        ? (task.outcome === 'failed' ? 'failed' : 'completed')
        : status;
      if (TERMINAL_FOR_LOG.has(status)) {
        try {
          const AQUARIUM = require('../aquarium');
          const fsp      = require('fs').promises;
          let rlog = { results: {} };
          try { rlog = JSON.parse(await fsp.readFile(AQUARIUM.RESULTS_LOG, 'utf8')); } catch {}
          rlog.results[taskId] = {
            task_id:        taskId,
            title:          task.title,
            task_type:      task.task_type || 'text',
            status:         archiveStatus,
            outcome:        task.outcome || null,
            review:         task.review  || null,
            result_summary: task.result_summary || extra.result_summary || null,
            result_file:    task.result_file    || extra.result_file    || null,
            output_preview: task.output_preview  || extra.output_preview || null,
            files_written:  task.files_written  || extra.files_written  || null,
            started_at:     task.lifecycle?.started_at || null,
            completed_at:   task.completed_at   || extra.completed_at   || new Date().toISOString(),
            duration_ms:    task.lifecycle?.started_at
              ? (Date.parse(task.completed_at || extra.completed_at || Date.now()) - Date.parse(task.lifecycle.started_at)) || null
              : null,
            assigned_name:  task.assigned_name  || task.assigned_to || null,
            project_name:   task.project_name   || task.context?.project_name   || null,
            project_id:     task.project_id     || task.context?.project_id     || null,
          };
          await fsp.writeFile(AQUARIUM.RESULTS_LOG, JSON.stringify(rlog, null, 2), 'utf8');
        } catch (re) { log.warn(`results_log write failed for ${taskId}:`, re.message); }
      }

      await this.rm._writeTaskDetails(taskId, task);

      // Update agent performance + project metrics (cascade)
      if (TERMINAL_FOR_LOG.has(status)) {
        try {
          await this.rm.cascadeTaskClosure(taskId, task, archiveStatus);
        } catch (ce) { log.warn(`cascade failed for ${taskId}:`, ce.message); }

        // Broadcast lifecycle event for instant client notification (no 5s poll lag)
        try {
          global.ReasoningBus?.push({
            type:           'task_lifecycle',
            task_id:        taskId,
            status,
            title:          task.title,
            assigned_name:  task.assigned_to || null,
            project_name:   task.project_name || null,
            result_summary: task.result_summary || null,
            result_file:    task.result_file    || null,
            timestamp:      Date.now(),
          });
        } catch {}
      }
    } catch (e) {
      log.warn(`setStatus failed for ${taskId}:`, e.message);
    }
  }

  async _updateProgressField(taskId, progressText) {
    try {
      const task = await this.rm._readTaskDetails(taskId);
      if (!task) return;
      task.progress = progressText;
      await this.rm._writeTaskDetails(taskId, task);
    } catch {}
  }

  async _saveOutput(taskId, text) {
    try {
      const task = await this.rm._readTaskDetails(taskId);

      // Resolve output path: project folder if task belongs to one, else TASKS/OUTPUT/
      let outputPath;
      const projectId   = task?.project_id || task?.context?.project_id || null;
      const projectName = task?.project_name || task?.context?.project_name || null;

      if (projectId || projectName) {
        try {
          const proj = await this.rm.resolveProjectByNameOrId(projectId || projectName);
          if (proj?.entry?.folder) {
            const projOutDir = require('path').join(AQUARIUM.PROJECTS, proj.entry.folder, 'output');
            await fs.mkdir(projOutDir, { recursive: true });
            outputPath = require('path').join(projOutDir, `${taskId}.md`);
          }
        } catch {}
      }

      if (!outputPath) {
        await fs.mkdir(AQUARIUM.OUTPUT, { recursive: true });
        const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
        outputPath = require('path').join(AQUARIUM.OUTPUT, `${taskId}.${isJson ? 'json' : 'md'}`);
      }

      await fs.writeFile(outputPath, text, 'utf8');

      if (task) {
        task.result_file    = outputPath;
        task.result_summary = text.slice(0, 500);
        await this.rm._writeTaskDetails(taskId, task);
      }
    } catch (e) {
      log.warn(`saveOutput failed for ${taskId}:`, e.message);
    }
  }

  /**
   * Auto-update project_memory.json when a task completes or fails.
   * This is the core project memory maintenance loop.
   */
  async _updateProjectMemoryForTask(task, status, output) {
    try {
      // Resolve project from task
      const projectId = task?.context?.project_id || task?.project_id || null;
      const projectName = task?.context?.project_name || task?.project_name || null;

      let proj = null;
      if (projectId) {
        const reg = await this.rm.read('PROJECTS/project_registry.json').catch(() => ({ projects: {} }));
        if (reg.projects[projectId]) proj = { id: projectId, entry: reg.projects[projectId] };
      }
      if (!proj && projectName) {
        proj = await this.rm.resolveProjectByNameOrId(projectName);
      }
      if (!proj) return; // task has no project — nothing to update

      const pid = proj.id;
      const by  = task.assigned_name || task.assigned_to || 'poseidon';
      const ok  = (status === 'done' && task.outcome !== 'failed') || status === 'completed';
      const ko  = (status === 'done' && task.outcome === 'failed') || status === 'failed';

      if (ok) {
        // Add to recent achievements
        await this.rm.updateProjectMemory(pid, 'achievement',
          `[${task.task_id}] ${task.title}`, by);

        // Agent sync message
        if ((task.assigned_to) && (task.assigned_to) !== 'poseidon_main') {
          await this.rm.updateProjectMemory(pid, 'agent_sync',
            `${by} completed: "${task.title}" — ${output.slice(0, 200)}`, by);
        }
      } else if (ko) {
        await this.rm.updateProjectMemory(pid, 'blocker',
          `[${task.task_id}] ${task.title} — FAILED`, by);
      }

      // Recompute project completion %
      const reg2 = await this.rm.getTasksRegistry().catch(() => ({ tasks: {} }));
      const allProjectTasks = Object.values(reg2.tasks || {}).filter(t =>
        t.context?.project_id === pid || t.project_id === pid
      );
      const isDone = t => normStatus(t.lifecycle?.status || t.status) === 'done';
      const done   = allProjectTasks.filter(t => isDone(t) && t.outcome !== 'failed').length;
      const failed = allProjectTasks.filter(t => isDone(t) && t.outcome === 'failed').length;
      await this.rm.updateProjectMemory(pid, 'progress', {
        total: allProjectTasks.length,
        done:  done + failed,
        failed
      }, by);

      log.info(`Updated project memory for ${pid}: ${done}/${allProjectTasks.length} tasks done`);
    } catch (e) {
      log.warn(' _updateProjectMemoryForTask failed:', e.message);
    }
  }
}

module.exports = TaskRunner;
