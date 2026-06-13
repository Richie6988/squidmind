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
      this._chatOpenUntil = Date.now() + 30_000;
    } else {
      this._chatOpenUntil = Date.now() + 30_000;
    }
  }

  async tick() {
    // Sequential: if any task is already running, skip this tick
    if (this._running.size > 0) return;
    // Wait for _done to be loaded from disk before running any task
    if (!this._doneLoaded) return;
    // Wait for model to be loaded before running any task
    if (this.modelService.loaded.size === 0) return;
    // Don't start BG tasks if chat modal is open or recently closed
    if (Date.now() < this._chatOpenUntil) return;
    // Don't start BG tasks if CHAT is active or waiting — user interaction takes priority
    const brokerState = this.modelService.broker.getState();
    if (brokerState.state !== 'IDLE') return;  // someone holds the broker
    if (this.modelService.broker.hasHighPriorityWaiting()) return;  // CHAT or IMAGE queued

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
    const TERMINAL = new Set(['completed','failed','cancelled','archived','in_progress']);
    const runnable = allTasks
      .filter(t => {
        const s = t.lifecycle?.status || t.status || 'open';
        const tooManyFails = (this._failCounts.get(t.task_id) || 0) >= this.MAX_RETRIES;
        const retryDelay = this._retryAfter.get(t.task_id) || 0;
        return !TERMINAL.has(s)
          && !this._running.has(t.task_id)
          && !this._done.has(t.task_id)   // never re-run completed tasks
          && !tooManyFails
          && Date.now() >= retryDelay;    // exponential backoff
      })
      .sort((a, b) => (b.sort_order || 0) - (a.sort_order || 0)); // highest sort_order first

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
        try { await this.rm.updateAgentStatus(agentId, 'active'); } catch {}
      }

      // Build rich task message including project context and progress state
      const projectPart = task.context?.project_id
        ? `\nProject: ${task.context.project_id}`
        : (task.project_name ? `\nProject: ${task.project_name}` : '');
      const progressPart = task.progress
        ? `\nPrevious progress: ${task.progress}\n(Resume from where you left off — do NOT redo completed steps)`
        : '';
      const descPart = task.description ? `\nDetails: ${task.description}` : '';

      // Trim components to prevent context overflow on small models (16k ctx)
      const titleLine  = `TASK [${taskId}]: ${task.title}`;
      const descLine   = descPart  ? descPart.slice(0, 400)   : '';
      const projLine   = projectPart;
      const progLine   = progressPart ? progressPart.slice(0, 300) : '';
      const msg = [
        titleLine, descLine, projLine, progLine,
        '\n---\nUse your tools. Update progress after each step. End with a summary.'
      ].join('').trim().slice(0, 1200);  // hard cap: ~300 tokens

      let output = '';
      let failed = false;

      // ── IMAGE GEN TASK ────────────────────────────────────────────────────
      const isImageTask = (task.task_type === 'image_gen') ||
        /^generate[: ]/i.test(task.title) ||
        /image[_\s]gen/i.test(task.task_type || '');

      if (isImageTask) {
        try {
          const prompt = task.description || task.title.replace(/^generate[: ]*/i, '');
          console.log(`[TaskRunner] 🎨 Image gen task ${taskId}: "${prompt.slice(0, 60)}"`);
          const result = await this.modelService.generateImage({ prompt, task_id: taskId });
          output = result?.image_path ? `Image saved: ${result.image_path}` : JSON.stringify(result);
        } catch (e) {
          output = `Image gen failed: ${e.message}`;
          failed = true;
        }
        // Skip normal task flow
        const status = failed ? 'failed' : 'completed';
        const prevFails = this._failCounts.get(taskId) || 0;
        if (failed && prevFails + 1 < this.MAX_RETRIES) {
          const attempt = prevFails + 1;
          this._failCounts.set(taskId, attempt);
          const backoff = RETRY_BACKOFF[attempt] || RETRY_BACKOFF[RETRY_BACKOFF.length - 1];
          this._retryAfter.set(taskId, Date.now() + backoff);
          await this._setStatus(taskId, 'open');
          console.warn(`[TaskRunner] ✗ ${taskId} failed (attempt ${attempt}/${this.MAX_RETRIES}) — retry in ${backoff/1000}s`);
        } else {
          await this._markDone(taskId);
          if (failed) { this._failCounts.set(taskId, this.MAX_RETRIES); }
          await this._setStatus(taskId, status, { result_summary: output.slice(0, 500), completed_at: new Date().toISOString() });
          console.log(`[TaskRunner] ${failed ? '✗✗' : '✓'} ${taskId} ${status} (${output.length} chars)`);
          if (failed) {
            await this._notify(`[IAQUA] Task FAILED: "${task.title}"\n${output.slice(0, 300)}`);
          } else {
            await this._notify(`[IAQUA] Task done: "${task.title}"\n${output.slice(0, 200)}`);
          }
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
            // Small delay — llama.cpp sequence release is not always synchronous
            await new Promise(r => setTimeout(r, 150));
          }

          // Build agent persona prefix if task is assigned to a named agent
          let agentPrefix = '';
          if (agentId && agentId !== 'poseidon_main') {
            try {
              const registry = await this.rm.getAgentRegistry();
              const agentEntry = registry.agents?.[agentId];
              if (agentEntry) {
                const brain = await this.rm.read(`agents/${agentEntry.brain_file}`);
                const persona = brain?.personality?.description || brain?.system_prompt || '';
                const name    = brain?.name || agentEntry.name || agentId;
                if (persona) {
                  agentPrefix = `[AGENT ROLE: ${name}]\n${persona.slice(0, 400)}\n---\n`;
                } else {
                  agentPrefix = `[AGENT ROLE: ${name}]\n---\n`;
                }
              }
            } catch {}
          }

          const posMsg = `[BACKGROUND AUTO-TASK ${taskId}]\n${agentPrefix}${msg}`;
          // Preemption: abort BG inference the moment a CHAT request is queued.
          // The task will retry on the next tick once Poseidon is free.
          let preempted = false;
          for await (const ev of this.modelService.chatWithPoseidon(posMsg, [], { _skipBroker: true, _bgMode: true })) {
            if (ev.type === 'text') output += ev.chunk;
            if (this.modelService.broker.hasHighPriorityWaiting()) {
              preempted = true;
              this.modelService.abortCurrentGeneration?.();
              break;
            }
          }
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
            await new Promise(r => setTimeout(r, 200));  // ensure llama.cpp frees the slot
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

      if (output.trim().length > 0) {
        await this._saveOutput(taskId, output);
      }

      if (failed) {
        const prevFails = (this._failCounts.get(taskId) || 0) + 1;
        this._failCounts.set(taskId, prevFails);
        const errType = classifyError(output);
        if (prevFails >= this.MAX_RETRIES) {
          console.warn(`[TaskRunner] ✗✗ ${taskId} hit ${this.MAX_RETRIES} failures (${errType}) — permanently failed`);
          await this._markDone(taskId);  // persist: stop retrying after restart too
          await this._setStatus(taskId, 'failed', {
            completed_at: new Date().toISOString(),
            output_preview: `Failed after ${prevFails} attempts [${errType}]. Last: ${output.slice(0, 200)}`
          });
          await this._notify(`[IAQUA] Task FAILED permanently: "${task.title}"\nError type: ${errType}\n${output.slice(0, 300)}`);
        } else {
          // Exponential backoff: skip if OOM (longer wait), shorter for tool errors
          const backoffMs = errType === 'oom'
            ? (RETRY_BACKOFF[prevFails] || 300_000) * 2
            : (RETRY_BACKOFF[prevFails] || 30_000);
          this._retryAfter.set(taskId, Date.now() + backoffMs);
          console.warn(`[TaskRunner] ✗ ${taskId} failed (attempt ${prevFails}/${this.MAX_RETRIES}, ${errType}) — retry in ${backoffMs/1000}s`);
          await this._setStatus(taskId, 'planned', {
            output_preview: `Attempt ${prevFails} failed [${errType}]: ${output.slice(0, 150)}`
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
      // Try per-folder details.json first
      let task = await this.rm._readTaskDetails(taskId);

      // FALLBACK: task may still be in flat tasks_registry.json (created before migration)
      if (!task) {
        try {
          const flatReg = await this.rm.read('tasks/tasks_registry.json');
          task = flatReg.tasks?.[taskId] || null;
        } catch {}
      }

      if (!task) {
        console.warn(`[TaskRunner] _setStatus: task ${taskId} not found anywhere — skipping`);
        return;
      }

      task.lifecycle = { ...(task.lifecycle || {}), status, ...extra };
      task.status    = status;

      // Always write per-folder (migrates flat-registry tasks on first update)
      await this.rm._writeTaskDetails(taskId, task);

      // If task was in flat registry, remove it from there to avoid duplication
      try {
        const flatReg = await this.rm.read('tasks/tasks_registry.json');
        if (flatReg.tasks?.[taskId]) {
          delete flatReg.tasks[taskId];
          await this.rm.write('tasks/tasks_registry.json', flatReg);
        }
      } catch {}

      this.rm.invalidateCache();
    } catch (e) {
      console.warn(`[TaskRunner] setStatus failed for ${taskId}:`, e.message);
    }
  }

  async _updateProgressField(taskId, progressText) {
    try {
      let task = await this.rm._readTaskDetails(taskId);
      if (!task) {
        try {
          const flatReg = await this.rm.read('tasks/tasks_registry.json');
          task = flatReg.tasks?.[taskId] || null;
        } catch {}
      }
      if (!task) return;
      task.progress = progressText;
      await this.rm._writeTaskDetails(taskId, task);
    } catch {}
  }

  async _saveOutput(taskId, text) {
    try {
      // Resolve task (per-folder first, then flat registry fallback)
      let task = await this.rm._readTaskDetails(taskId);
      if (!task) {
        try {
          const flatReg = await this.rm.read('tasks/tasks_registry.json');
          task = flatReg.tasks?.[taskId] || null;
        } catch {}
      }
      const projectId = task?.context?.project_id || task?.project_id || null;

      let outputPath;
      if (projectId) {
        try {
          const reg = await this.rm.read('projects/project_registry.json').catch(() => ({ projects: {} }));
          const proj = reg.projects?.[projectId];
          const folder = proj?.folder || projectId;
          const projOutDir = path.join(AQUARIUM.PROJECTS, folder, 'output');
          await fs.mkdir(projOutDir, { recursive: true });
          outputPath = path.join(projOutDir, `${taskId}.txt`);
        } catch {}
      }

      if (!outputPath) {
        const taskDir = path.join(AQUARIUM.TASKS, taskId);
        await fs.mkdir(taskDir, { recursive: true });
        outputPath = path.join(taskDir, 'output.txt');
      }

      await fs.writeFile(outputPath, text, 'utf8');

      // Always write updated task with result_file to per-folder details.json
      if (task) {
        task.result_file    = outputPath;
        task.result_summary = text.slice(0, 500);
        await this.rm._writeTaskDetails(taskId, task);
        // Remove from flat registry if it was there
        try {
          const flatReg = await this.rm.read('tasks/tasks_registry.json');
          if (flatReg.tasks?.[taskId]) {
            delete flatReg.tasks[taskId];
            await this.rm.write('tasks/tasks_registry.json', flatReg);
          }
        } catch {}
        this.rm.invalidateCache();
      }
    } catch (e) {
      console.warn(`[TaskRunner] saveOutput failed for ${taskId}:`, e.message);
    }
  }
}

module.exports = TaskRunner;
