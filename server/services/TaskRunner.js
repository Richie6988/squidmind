'use strict';
/**
 * TaskRunner — automatic task execution engine.
 * Polls open/planned tasks every heartbeat tick and executes them.
 * Sequential: only 1 task at a time to avoid sequences:1 deadlock.
 */

const path = require('path');
const fs   = require('fs').promises;
const fsSync = require('fs');
const AQUARIUM = require('../aquarium');

class TaskRunner {
  constructor(rm, modelService, agentPool) {
    this.rm           = rm;
    this.modelService = modelService;
    this.agentPool    = agentPool;
    this._running     = new Set();
    this._lastCronRun = new Map(); // taskId → last run timestamp
  }

  async tick() {
    // Sequential: if any task is already running, skip this tick
    if (this._running.size > 0) return;

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
        console.log(`[TaskRunner] ⏱ Cron task due: ${task.task_id} "${task.title}"`);
        // Create a fresh run of this task
        const freshTask = { ...task, lifecycle: { ...task.lifecycle, status: 'open' } };
        this._runTask(freshTask).catch(e =>
          console.error(`[TaskRunner] Cron task ${task.task_id} error:`, e.message)
        );
        return; // one task per tick
      }
    }

    // ── One-shot tasks: pick highest priority open/planned task ───────────
    const runnable = allTasks
      .filter(t => {
        const s = t.lifecycle?.status || t.status || 'open';
        return (s === 'open' || s === 'planned' || s === 'queued') && !this._running.has(t.task_id);
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

      // Build rich task message including project context and progress state
      const projectPart = task.context?.project_id
        ? `\nProject: ${task.context.project_id}`
        : (task.project_name ? `\nProject: ${task.project_name}` : '');
      const progressPart = task.progress
        ? `\nPrevious progress: ${task.progress}\n(Resume from where you left off — do NOT redo completed steps)`
        : '';
      const descPart = task.description ? `\nDetails: ${task.description}` : '';

      const msg = [
        `TASK [${taskId}]: ${task.title}`,
        descPart,
        projectPart,
        progressPart,
        '\n---',
        'Execute this task using your tools. Update progress field after each step.',
        'End with a clear completion summary.'
      ].join('').trim();

      let output = '';
      let failed = false;

      try {
        if (agentId && agentId !== 'poseidon_main') {
          const gen = await this.agentPool.dispatch(agentId, msg);
          for await (const ev of gen) {
            if (ev.type === 'text') output += ev.chunk;
            if (ev.type === 'error') { failed = true; output += '\nERROR: ' + ev.error; }
          }
        } else {
          // Poseidon handles it — inject as background auto-task
          const posMsg = `[BACKGROUND AUTO-TASK ${taskId}]\n${msg}`;
          for await (const ev of this.modelService.chatWithPoseidon(posMsg, [])) {
            if (ev.type === 'text') output += ev.chunk;
          }
        }
      } catch (e) {
        output = `Execution error: ${e.message}`;
        failed = true;
      }

      if (output.trim().length > 0) {
        await this._saveOutput(taskId, output);
      }

      const finalStatus = failed ? 'failed' : 'completed';
      await this._setStatus(taskId, finalStatus, {
        completed_at: new Date().toISOString(),
        output_preview: output.slice(0, 300)
      });

      // Update progress field with completion note
      if (!failed) {
        await this._updateProgressField(taskId, 'completed — ' + output.slice(0, 120));
      }

      await this.rm.log({
        event_type: 'task_completed', severity: failed ? 'warning' : 'info',
        actor: { type: 'system', id: agentId || 'poseidon_main' },
        subject: { type: 'task', id: taskId },
        action: `Task ${finalStatus}: "${task.title}"`,
        context: { output_chars: output.length, agent: agentId || 'poseidon' }
      }).catch(() => {});

      console.log(`[TaskRunner] ${failed?'✗':'✓'} ${taskId} ${finalStatus} (${output.length} chars)`);
    } finally {
      this._running.delete(taskId);
    }
  }

  async _setStatus(taskId, status, extra = {}) {
    try {
      // Use _readTaskDetails / _writeTaskDetails — avoids flat-registry path bug
      const task = await this.rm._readTaskDetails(taskId);
      if (!task) return;
      task.lifecycle = { ...(task.lifecycle || {}), status, ...extra };
      task.status    = status;
      await this.rm._writeTaskDetails(taskId, task);
      this.rm.invalidateCache();
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
      const dir = path.join(AQUARIUM.TASKS, taskId, 'results');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'output.txt'), text, 'utf8');
    } catch (e) {
      console.warn(`[TaskRunner] saveOutput failed for ${taskId}:`, e.message);
    }
  }
}

module.exports = TaskRunner;
