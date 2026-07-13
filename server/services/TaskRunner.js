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
      const TERMINAL_STATUSES = new Set(['completed','failed','cancelled','archived']);
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
      // Block BG tasks while user is actively chatting. Refreshed on every
      // chat turn, so this window only matters after the last message.
      this._chatOpenUntil = Date.now() + 60_000;
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
          status: 'open',
          lifecycle: { status: 'open' },
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
            reg.tasks[task.task_id].lifecycle = { ...(reg.tasks[task.task_id].lifecycle || {}), status: 'completed' };
            reg.tasks[task.task_id].status = 'completed';
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

    // ── One-shot tasks: pick highest priority open/planned task ───────────
    // TERMINAL = statuses that are NEVER retried.
    // NOTE: 'failed' is NOT terminal here — only permanently failed (fails >= MAX_RETRIES) tasks
    // are excluded via the tooManyFails check below. This allows tasks set to 'failed' by
    // external code (session crash, manual set) to be retried if fail count is still low.
    const TERMINAL = new Set(['completed','cancelled','archived','in_progress']);

    // Reset stale in_progress tasks (stuck from previous server run, not in _running)
    // Also clean up orphaned failed tasks whose disk entry was deleted
    for (const t of allTasks) {
      const s = t.lifecycle?.status || t.status;
      const fails = this._failCounts.get(t.task_id) || 0;
      if (s === 'in_progress' && !this._running.has(t.task_id) && !this._done.has(t.task_id)) {
        log.info(`Resetting stale in_progress task ${t.task_id} → planned`);
        this._setStatus(t.task_id, 'planned').catch(() => {});
      }
      // Failed with 0 counted retries = set externally (session crash, manual) — retry it
      if (s === 'failed' && fails === 0 && !this._done.has(t.task_id)) {
        log.info(`Resetting externally-failed ${t.task_id} → planned (fails=${fails})`);
        this._setStatus(t.task_id, 'planned').catch(() => {});
      }
      // If a task has been retried MAX_RETRIES times, mark done so it stops blocking
      if (s === 'failed' && fails >= this.MAX_RETRIES) {
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
        const s = t.lifecycle?.status || t.status || 'open';
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
        return !TERMINAL.has(s)
          && !isScheduleTemplate
          && !this._running.has(t.task_id)
          && !this._done.has(t.task_id)
          && !tooManyFails
          && !agentBusy
          && !depsPending
          && Date.now() >= retryDelay;
      })
      // Queue order: explicit sort_order bump (image/urgent tasks) then FIFO by task_id
      .sort((a, b) => {
        const pDiff = (b.sort_order || 0) - (a.sort_order || 0);
        if (pDiff !== 0) return pDiff;
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
      await this._setStatus(taskId, 'in_progress', { started_at: new Date().toISOString() });

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
      // Prior deliverables in the same project — build ON them, don't restart.
      let priorPart = '';
      if (task.project_name) {
        try {
          const RegistryManager = require('./RegistryManager');
          const pdir = path.join(AQUARIUM.PROJECTS, RegistryManager.projectFolder({ name: task.project_name }), 'output');
          const files = (await fs.readdir(pdir).catch(() => [])).slice(-8);
          if (files.length) priorPart = `\nExisting project deliverables in output/: ${files.join(', ')} (read them with read_file if relevant — extend, don't duplicate)`;
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
        const status = failed ? 'failed' : 'completed';
        const prevFails = this._failCounts.get(taskId) || 0;
        if (failed && prevFails + 1 < this.MAX_RETRIES) {
          const attempt = prevFails + 1;
          this._failCounts.set(taskId, attempt);
          const backoff = RETRY_BACKOFF[attempt] || RETRY_BACKOFF[RETRY_BACKOFF.length - 1];
          this._retryAfter.set(taskId, Date.now() + backoff);
          await this._setStatus(taskId, 'open');
          log.warn(`✗ image ${taskId} (attempt ${attempt}/${this.MAX_RETRIES}) — retry in ${backoff/1000}s`);
        } else {
          await this._markDone(taskId);
          if (failed) { this._failCounts.set(taskId, this.MAX_RETRIES); }
          const extra = {
            result_summary: output.slice(0, 500),
            completed_at:   new Date().toISOString(),
            ...(imageServeUrl ? { output_preview: imageServeUrl } : {})
          };
          await this._setStatus(taskId, status, extra);
          log.info(`${failed ? '✗✗' : '✓'} image ${taskId} ${status}`);

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
              const gen = await this.agentPool.dispatch(agentId, msg);
              for await (const ev of gen) {
                if (ev.type === 'text')           output += ev.chunk;
                if (ev.type === 'error')          { output += `\nError: ${ev.error}`; failed = true; }
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
        // Poseidon BG path: same model, inject agent persona as prefix.
        const bgToken = await this.modelService.broker.acquire(
          PRIORITY.POSEIDON_BG, `bg_task_${taskId}`,
          { timeoutMs: 10 * 60 * 1000 }
        );
        try {
          // Dispose Poseidon session AND sequence before BG task — frees the single slot.
          // Check both independently: session may be null but sequence still alive.
          const poseidonId = this.modelService.poseidonModelId;
          const posEntry = poseidonId ? this.modelService.loaded.get(poseidonId) : null;
          if (posEntry) {
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

                // Include capability skills if defined
                const caps = brain?.capabilities?.skills
                  ? Object.keys(brain.capabilities.skills).join(', ')
                  : '';
                const modelPref = brain?.brain_config?.model_binding?.preferred_model_id
                  ? `\nPreferred model: ${brain.brain_config.model_binding.preferred_model_id}`
                  : '';

                agentPrefix = `[AGENT: ${name}]\n`;
                if (persona) agentPrefix += `${persona.slice(0, 500)}\n`;
                if (role && persona && !persona.includes(role)) agentPrefix += `Role: ${role}\n`;
                if (caps) agentPrefix += `Agent skills: ${caps}\n`;
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
          const bus = global.ReasoningBus;
          if (bus) bus.push({ type: 'task_start', task_id: taskId, title: task.title, agent: agentId || 'poseidon', project: task.project_name });
          let _lastTouch = 0;
          for await (const ev of this.modelService.chatWithPoseidon(posMsg, [], { _skipBroker: true, _bgMode: true })) {
            // Keepalive on the OUTER TaskRunner token — a long BG generation
            // must not expire as a dead holder mid-run.
            if (Date.now() - _lastTouch > 10_000) { _lastTouch = Date.now(); this.modelService.broker.touch(bgToken); }
            if (ev.type === 'text')          { output += ev.chunk; bus?.push({ type: 'text', task_id: taskId, chunk: ev.chunk }); }
            if (ev.type === 'thinking')      bus?.push({ type: 'thinking', task_id: taskId, chunk: ev.chunk });
            if (ev.type === 'thinking_start') bus?.push({ type: 'thinking_start', task_id: taskId });
            if (ev.type === 'thinking_end')   bus?.push({ type: 'thinking_end', task_id: taskId });
            if (ev.type === 'tool_call')      { toolCalls++; bus?.push({ type: 'tool_call', task_id: taskId, name: ev.name, args: ev.args }); }
            if (ev.type === 'tool_result')    bus?.push({ type: 'tool_result', task_id: taskId, name: ev.name, ok: ev.result?.ok !== false, summary: String(ev.result?.message || '').slice(0, 200) });
            if (this.modelService.broker.hasHighPriorityWaiting()) {
              preempted = true;
              this.modelService.abortCurrentGeneration?.();
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
          const posId  = this.modelService.poseidonModelId;
          const posEnt = posId ? this.modelService.loaded.get(posId) : null;
          if (posEnt) {
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
          await this._setStatus(taskId, 'failed', {
            completed_at: new Date().toISOString(),
            output_preview: `Failed after ${prevFails} attempts [${errType}]. Last: ${output.slice(0, 200)}`
          });
          await this._notify(`[IAQUA] Task FAILED: "${task.title}"\n[${errType}] ${output.slice(0, 200)}`);
        } else {
          const backoffMs = isResourceError
            ? 60_000 + Math.random() * 30_000   // 60-90s jitter for resource errors
            : errType === 'oom'
              ? (RETRY_BACKOFF[prevFails] || 300_000) * 2
              : (RETRY_BACKOFF[prevFails] || 30_000);
          this._retryAfter.set(taskId, Date.now() + backoffMs);
          const label = isResourceError ? `[${errType}] resource contention` : `attempt ${prevFails}/${this.MAX_RETRIES} [${errType}]`;
          log.warn(`✗ ${taskId} ${label} — retry in ${Math.round(backoffMs/1000)}s`);
          await this._setStatus(taskId, 'planned', {
            output_preview: `${label}: retry in ${Math.round(backoffMs/1000)}s`
          });
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
        this._failCounts.delete(taskId);
        this._retryAfter.delete(taskId);
        await this._markDone(taskId);  // persist: never re-run even after restart
        // Verified deliverables — what the tools ACTUALLY wrote during this
        // task, independent of what the model claims in its summary.
        const writes = global.__TASK_WRITES?.get(taskId) || [];
        const filesWritten = writes.map(w => w.path).slice(0, 20);
        await this._setStatus(taskId, 'completed', {
          completed_at: new Date().toISOString(),
          output_preview: output.slice(0, 300),
          result_summary: output.slice(0, 500),
          ...(filesWritten.length ? { files_written: filesWritten } : {})
        });
        await this._updateProgressField(taskId, 'completed — ' + output.slice(0, 120));
        await this._notify(`[IAQUA] Task done: "${task.title}"\n${output.slice(0, 200)}`);
        // Update project memory if task belongs to a project
        await this._updateProjectMemoryForTask(task, 'completed', output);
      }

      // ── QUALITY REVIEW (draft → critique → revise, max 1 revision) ──────
      // One-shot output from a small model is mediocre; a revision pass
      // against explicit acceptance criteria is the single biggest quality
      // lever available on local hardware. Short prompt (~1k tok), text-only
      // verdict — cheap even on slow models. Unparseable verdicts default to
      // PASS so a sloppy reviewer can never loop a task forever.
      if (!failed && output.trim().length > 0 && (task.revisions || 0) < 1) {
        try {
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
          for await (const ev of this.modelService.chatWithPoseidon(reviewPrompt, [], { _skipBroker: true, _bgMode: true })) {
            if (ev.type === 'text') review += ev.chunk;
            if (review.length > 1200) break;
          }
          const score   = parseInt((review.match(/SCORE:\s*(\d{1,2})/i) || [])[1], 10);
          const verdict = /VERDICT:\s*REVISE/i.test(review) ? 'REVISE' : 'PASS';
          const fixes   = ((review.match(/FIXES:\s*([\s\S]{0,400})/i) || [])[1] || '').trim();
          task.review = { score: Number.isFinite(score) ? score : null, verdict, at: new Date().toISOString() };
          log.info(`⭐ quality review ${taskId}: ${verdict}${Number.isFinite(score) ? ` (${score}/10)` : ''}`);
          if (verdict === 'REVISE' && fixes) {
            // Poseidon validation loop: the task restarts with a BETTER
            // DESCRIPTION, not just a note — the revision requirements are
            // appended to the description itself (drives the re-run prompt
            // fully; progress is sliced to 200 chars) plus the progress
            // teaching for continuity.
            const upgradedDesc = `${task.description || ''}\n\nREVISION REQUIREMENTS (validation, attempt ${(task.revisions || 0) + 1}): ${fixes}`.slice(0, 1200);
            await this._setStatus(taskId, 'open', {
              revisions: (task.revisions || 0) + 1,
              review: task.review,
              description: upgradedDesc,
              progress: `QUALITY REVIEW${Number.isFinite(score) ? ` (${score}/10)` : ''} — the previous deliverable needs these SPECIFIC fixes before it is acceptable: ${fixes}. Revise the existing deliverable (read it first), do not start from scratch.`
            });
            await this.rm.log({
              event_type: 'quality_review', severity: 'info',
              actor: { type: 'system', id: 'quality_review' },
              subject: { type: 'task', id: taskId },
              action: `Review sent "${task.title}" back for revision${Number.isFinite(score) ? ` (${score}/10)` : ''}`,
              context: { fixes: fixes.slice(0, 300) }
            }).catch(() => {});
            return; // not final — the task will re-run with the fixes
          }
        } catch (revErr) {
          log.warn(`quality review skipped for ${taskId}: ${revErr.message}`);
        }
      }

      const finalStatus = failed ? 'failed' : 'completed';

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

      // Write to results_log BEFORE _writeTaskDetails purges terminal tasks
      const TERMINAL_FOR_LOG = new Set(['completed', 'failed', 'cancelled']);
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
            status,
            result_summary: task.result_summary || extra.result_summary || null,
            result_file:    task.result_file    || extra.result_file    || null,
            output_preview: task.output_preview  || extra.output_preview || null,
            files_written:  task.files_written  || extra.files_written  || null,
            started_at:     task.lifecycle?.started_at || null,
            completed_at:   task.completed_at   || extra.completed_at   || new Date().toISOString(),
            duration_ms:    task.lifecycle?.started_at
              ? (Date.parse(task.completed_at || extra.completed_at || Date.now()) - Date.parse(task.lifecycle.started_at)) || null
              : null,
            assigned_name:  task.assigned_to    || task.assigned_to || null,
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
          await this.rm.cascadeTaskClosure(taskId, task, status);
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

      if (status === 'completed') {
        // Add to recent achievements
        await this.rm.updateProjectMemory(pid, 'achievement',
          `[${task.task_id}] ${task.title}`, by);

        // Agent sync message
        if ((task.assigned_to) && (task.assigned_to) !== 'poseidon_main') {
          await this.rm.updateProjectMemory(pid, 'agent_sync',
            `${by} completed: "${task.title}" — ${output.slice(0, 200)}`, by);
        }
      } else if (status === 'failed') {
        await this.rm.updateProjectMemory(pid, 'blocker',
          `[${task.task_id}] ${task.title} — FAILED`, by);
      }

      // Recompute project completion %
      const reg2 = await this.rm.getTasksRegistry().catch(() => ({ tasks: {} }));
      const allProjectTasks = Object.values(reg2.tasks || {}).filter(t =>
        t.context?.project_id === pid || t.project_id === pid
      );
      const done   = allProjectTasks.filter(t => t.lifecycle?.status === 'completed' || t.status === 'completed').length;
      const failed = allProjectTasks.filter(t => t.lifecycle?.status === 'failed' || t.status === 'failed').length;
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
