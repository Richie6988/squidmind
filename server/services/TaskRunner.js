'use strict';
const { PRIORITY } = require('./ModelBroker');
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
      console.log(`[TaskRunner] Loaded ${this._done.size} completed tasks from _done.json`);
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
      console.warn('[TaskRunner] _saveDone failed:', e.message);
    }
  }

  /** Add task to _done and persist */
  /** Called when a task is hard-deleted from the UI — prevents TaskRunner from ever running it */
  markDeleted(taskId) {
    this._done.add(taskId);
    this._running.delete(taskId);
    this._failCounts.delete(taskId);
    this._retryAfter.delete(taskId);
    // Persist so it survives restart
    this._markDone(taskId).catch(() => {});
    console.log(`[TaskRunner] Task ${taskId} marked as deleted (will not run)`);
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
      // Block BG tasks while user is actively chatting
      this._chatOpenUntil = Date.now() + 30_000;
    } else {
      // Chat closed — allow BG tasks after a short grace period (session cleanup)
      this._chatOpenUntil = Date.now() + 3_000;
    }
  }

  async tick() {
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
      console.warn('[TaskRunner] tick read error:', e.message);
      return;
    }

    const now = Date.now();
    const allTasks = Object.values(reg.tasks || {});

    // ── Cron tasks: check if any scheduled task is due ─────────────────────
    for (const task of allTasks) {
      if (!task.cron_schedule) continue;
      const cronStr = task.cron_schedule;
      const lastRun = this._lastCronRun.get(task.task_id) || 0;
      if (this._isCronDue(cronStr, lastRun, now)) {
        this._lastCronRun.set(task.task_id, now);
        console.log(`[TaskRunner] Cron task due: ${task.task_id} "${task.title}"`);
        // Spawn a FRESH task so each cron run is independently tracked.
        // The original task stays in registry as the cron template.
        try {
          const reg = await this.rm.read('tasks/tasks_registry.json');
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
            cron_schedule: null, // fresh run — no re-cron
            cron_parent: task.task_id,
          };
          reg.metadata = reg.metadata || {};
          reg.metadata.next_id = nextId + 1;
          await this.rm.write('tasks/tasks_registry.json', reg);
          // Run the fresh task
          const freshTask = reg.tasks[cronTaskId];
          this._runTask(freshTask).catch(e =>
            console.error(`[TaskRunner] Cron task ${cronTaskId} error:`, e.message)
          );
        } catch (e) {
          console.error(`[TaskRunner] Failed to create cron instance for ${task.task_id}:`, e.message);
        }
        return; // one task per tick
      }
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
        console.log(`[TaskRunner] Resetting stale in_progress task ${t.task_id} → planned`);
        this._setStatus(t.task_id, 'planned').catch(() => {});
      }
      // Failed with 0 counted retries = set externally (session crash, manual) — retry it
      if (s === 'failed' && fails === 0 && !this._done.has(t.task_id)) {
        console.log(`[TaskRunner] Resetting externally-failed ${t.task_id} → planned (fails=${fails})`);
        this._setStatus(t.task_id, 'planned').catch(() => {});
      }
      // If a task has been retried MAX_RETRIES times, mark done so it stops blocking
      if (s === 'failed' && fails >= this.MAX_RETRIES) {
        console.log(`[TaskRunner] Permanently failed ${t.task_id} — adding to done set`);
        this._done.add(t.task_id);
        this._markDone(t.task_id).catch(() => {});
      }
    }

    const runnable = allTasks
      .filter(t => {
        const s = t.lifecycle?.status || t.status || 'open';
        const tooManyFails = (this._failCounts.get(t.task_id) || 0) >= this.MAX_RETRIES;
        const retryDelay = this._retryAfter.get(t.task_id) || 0;
        return !TERMINAL.has(s)
          && !this._running.has(t.task_id)
          && !this._done.has(t.task_id)
          && !tooManyFails
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
      console.error(`[TaskRunner] Task ${task.task_id} error:`, e.message)
    );
  }

  /**
   * Very simple cron check: parse '* * * * *' and see if it's due.
   * Checks against last-run timestamp to avoid double-firing.
   */
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
    const agentId = task.assignment?.assigned_to || null;
    this._running.add(taskId);

    console.log(`[TaskRunner] ▶ ${taskId}: "${task.title}"${agentId ? ' → ' + agentId : ' → poseidon'}`);

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

      // Trim components to prevent context overflow on small models (16k ctx)
      const titleLine  = `TASK [${taskId}]: ${task.title}`;
      const descLine   = descPart  ? descPart.slice(0, 400)   : '';
      const projLine   = projectPart;
      const memLine    = projectMemoryPart ? projectMemoryPart.slice(0, 400) : '';
      const progLine   = progressPart ? progressPart.slice(0, 200) : '';
      const msg = [
        titleLine, descLine, projLine, memLine, progLine,
        '\n---\nUse your tools. Update progress after each step. When done, call update_project_memory to log achievements. End with a summary.'
      ].join('').trim().slice(0, 1400);  // raised cap slightly for memory

      let output = '';
      let failed = false;

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

          console.log(`[TaskRunner] Image gen ${taskId}: model="${reqModelId}" prompt="${prompt.slice(0,60)}"`);

          const result = await this.modelService.generateImage({
            modelId:        reqModelId,
            model_id:       reqModelId,
            prompt,
            negativePrompt: negPrompt,
            outputPath:     null,
            task_id:        taskId,
            width, height, steps, cfg, seed
          });

          resolvedModelId = result?.resolvedModelId || reqModelId;

          if (result?.ok && result.outputPath) {
            imageServeUrl = `/api/files/read?path=${encodeURIComponent(result.outputPath)}`;
            output = `Image saved: ${result.outputPath}`;
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
          console.warn(`[TaskRunner] ✗ image ${taskId} (attempt ${attempt}/${this.MAX_RETRIES}) — retry in ${backoff/1000}s`);
        } else {
          await this._markDone(taskId);
          if (failed) { this._failCounts.set(taskId, this.MAX_RETRIES); }
          const extra = {
            result_summary: output.slice(0, 500),
            completed_at:   new Date().toISOString(),
            ...(imageServeUrl ? { output_preview: imageServeUrl } : {})
          };
          await this._setStatus(taskId, status, extra);
          console.log(`[TaskRunner] ${failed ? '✗✗' : '✓'} image ${taskId} ${status}`);

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
              console.log(`[TaskRunner] Updated generate_image skill with model: ${resolvedModelId}`);
            } catch {}
          }

          await this._notify(`[IAQUA] ${failed ? 'Image FAILED' : 'Image done'}: "${task.title.slice(0,60)}"\n${imageServeUrl ? imageServeUrl : output.slice(0,200)}`);
        }
        this._running.delete(taskId);
        return;
      }

      try {
        // ALL tasks go through Poseidon (single model, single sequence).
        // If assigned to an agent, inject its personality as a role prefix so
        // Poseidon adopts the sub-personality for this task.
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
            posEntry.sessionTurns = 0;
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
                const brain = await this.rm.read(`agents/${agentEntry.brain_file}`);
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
              console.warn(`[TaskRunner] Could not load agent brain for ${agentId}:`, e.message);
            }
          }

          const posMsg = `[BACKGROUND AUTO-TASK ${taskId}]\n${agentPrefix}${msg}`;
          // Preemption: abort BG inference the moment a CHAT request is queued.
          // The task will retry on the next tick once Poseidon is free.
          let preempted = false;
          const bus = global.ReasoningBus;
          if (bus) bus.push({ type: 'task_start', task_id: taskId, title: task.title, agent: agentId || 'poseidon', project: task.project_name });
          for await (const ev of this.modelService.chatWithPoseidon(posMsg, [], { _skipBroker: true, _bgMode: true })) {
            if (ev.type === 'text')          { output += ev.chunk; bus?.push({ type: 'text', task_id: taskId, chunk: ev.chunk }); }
            if (ev.type === 'thinking')      bus?.push({ type: 'thinking', task_id: taskId, chunk: ev.chunk });
            if (ev.type === 'thinking_start') bus?.push({ type: 'thinking_start', task_id: taskId });
            if (ev.type === 'thinking_end')   bus?.push({ type: 'thinking_end', task_id: taskId });
            if (ev.type === 'tool_call')      bus?.push({ type: 'tool_call', task_id: taskId, name: ev.name, args: ev.args });
            if (ev.type === 'tool_result')    bus?.push({ type: 'tool_result', task_id: taskId, name: ev.name, ok: ev.result?.ok !== false, summary: String(ev.result?.message || '').slice(0, 200) });
            if (this.modelService.broker.hasHighPriorityWaiting()) {
              preempted = true;
              this.modelService.abortCurrentGeneration?.();
              break;
            }
          }
          if (bus) bus.push({ type: 'task_end', task_id: taskId });
          if (preempted) {
            console.log(`[TaskRunner] BG task ${taskId} preempted by CHAT — will retry`);
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
            posEnt.sessionTurns = 0;
            await new Promise(r => setTimeout(r, 500));  // ensure llama.cpp frees the slot
          }
          this.modelService.broker.release(bgToken);
        }
      } catch (e) {
        if (e.message === 'PREEMPTED_BY_CHAT') {
          // Not a real failure — task will retry next tick after CHAT finishes
          this._running.delete(taskId);
          return;
        }
        output = `Execution error: ${e.message}`;
        failed = true;
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
          console.warn(`[TaskRunner] ✗✗ ${taskId} hit ${this.MAX_RETRIES} failures (${errType}) — permanently failed`);
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
          console.warn(`[TaskRunner] ✗ ${taskId} ${label} — retry in ${Math.round(backoffMs/1000)}s`);
          await this._setStatus(taskId, 'planned', {
            output_preview: `${label}: retry in ${Math.round(backoffMs/1000)}s`
          });
        }
      } else {
        this._failCounts.delete(taskId);
        this._retryAfter.delete(taskId);
        await this._markDone(taskId);  // persist: never re-run even after restart
        await this._setStatus(taskId, 'completed', {
          completed_at: new Date().toISOString(),
          output_preview: output.slice(0, 300),
          result_summary: output.slice(0, 500)
        });
        await this._updateProgressField(taskId, 'completed — ' + output.slice(0, 120));
        await this._notify(`[IAQUA] Task done: "${task.title}"\n${output.slice(0, 200)}`);
        // Update project memory if task belongs to a project
        await this._updateProjectMemoryForTask(task, 'completed', output);
      }

      const finalStatus = failed ? 'failed' : 'completed';

      await this.rm.log({
        event_type: 'task_completed', severity: failed ? 'warning' : 'info',
        actor: { type: 'system', id: agentId || 'poseidon_main' },
        subject: { type: 'task', id: taskId },
        action: `Task ${finalStatus}: "${task.title}"`,
        context: { output_chars: output.length, agent: agentId || 'poseidon' }
      }).catch(() => {});

      console.log(`[TaskRunner] ${failed?'✗':'✓'} ${taskId} ${finalStatus} (${output.length} chars)`);
    } finally {
      // Put agent back to sleep
      if (agentId && agentId !== 'poseidon_main') {
        try { await this.rm.updateAgentStatus(agentId, 'sleeping'); } catch {}
      }
      this._running.delete(taskId);
    }
  }

  async _setStatus(taskId, status, extra = {}) {
    try {
      let task = await this.rm._readTaskDetails(taskId);
      if (!task) { console.warn(`[TaskRunner] _setStatus: task ${taskId} not found`); return; }

      task.status    = status;
      task.lifecycle = { ...(task.lifecycle || {}), status };
      if (extra.result_summary !== undefined) task.result_summary = extra.result_summary;
      if (extra.result_file    !== undefined) task.result_file    = extra.result_file;
      if (extra.completed_at   !== undefined) { task.completed_at = extra.completed_at; task.lifecycle.completed_at = extra.completed_at; }
      if (extra.started_at     !== undefined) task.lifecycle.started_at = extra.started_at;

      await this.rm._writeTaskDetails(taskId, task);
    } catch (e) {
      console.warn(`[TaskRunner] setStatus failed for ${taskId}:`, e.message);
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
            outputPath = require('path').join(projOutDir, `${taskId}.txt`);
          }
        } catch {}
      }

      if (!outputPath) {
        await fs.mkdir(AQUARIUM.OUTPUT, { recursive: true });
        const isJson = text.trim().startsWith('{') || text.trim().startsWith('[');
        outputPath = require('path').join(AQUARIUM.OUTPUT, `${taskId}.${isJson ? 'json' : 'txt'}`);
      }

      await fs.writeFile(outputPath, text, 'utf8');

      if (task) {
        task.result_file    = outputPath;
        task.result_summary = text.slice(0, 500);
        await this.rm._writeTaskDetails(taskId, task);
      }
    } catch (e) {
      console.warn(`[TaskRunner] saveOutput failed for ${taskId}:`, e.message);
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
        const reg = await this.rm.read('projects/project_registry.json').catch(() => ({ projects: {} }));
        if (reg.projects[projectId]) proj = { id: projectId, entry: reg.projects[projectId] };
      }
      if (!proj && projectName) {
        proj = await this.rm.resolveProjectByNameOrId(projectName);
      }
      if (!proj) return; // task has no project — nothing to update

      const pid = proj.id;
      const by  = task.assignment?.assigned_name || task.assignment?.assigned_to || 'poseidon';

      if (status === 'completed') {
        // Add to recent achievements
        await this.rm.updateProjectMemory(pid, 'achievement',
          `[${task.task_id}] ${task.title}`, by);

        // Agent sync message
        if (task.assignment?.assigned_to && task.assignment.assigned_to !== 'poseidon_main') {
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

      console.log(`[TaskRunner] Updated project memory for ${pid}: ${done}/${allProjectTasks.length} tasks done`);
    } catch (e) {
      console.warn('[TaskRunner] _updateProjectMemoryForTask failed:', e.message);
    }
  }
}

module.exports = TaskRunner;
