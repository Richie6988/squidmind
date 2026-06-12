'use strict';
/**
 * TaskRunner — automatic task execution engine.
 *
 * Runs on a heartbeat tick. Finds open/planned tasks that have an assigned
 * agent (or falls back to Poseidon) and executes them automatically.
 *
 * Rules:
 *  - Only runs one task per agent at a time (agent already running → skip)
 *  - Poseidon tasks run via chatWithPoseidon (he orchestrates himself)
 *  - Marks task in_progress before starting, completed/failed after
 *  - Drains the full SSE/generator output and saves result to TASKS/<id>/results/output.txt
 */

const path = require('path');
const fs   = require('fs').promises;
const AQUARIUM = require('../aquarium');

class TaskRunner {
  constructor(rm, modelService, agentPool) {
    this.rm         = rm;
    this.modelService = modelService;
    this.agentPool  = agentPool;
    this._running   = new Set(); // task_ids currently executing
  }

  /**
   * Called by HeartbeatService every tick.
   * Finds runnable tasks and fires them off (non-blocking).
   */
  async tick() {
    let reg;
    try {
      this.rm.invalidateCache();
      reg = await this.rm.getTasksRegistry().catch(() => this.rm.read('tasks/tasks_registry.json').catch(() => ({ tasks: {} })));
    } catch { return; }

    const tasks = Object.values(reg.tasks || {});
    const runnable = tasks.filter(t => {
      const s = t.lifecycle?.status || t.status || 'open';
      return (s === 'open' || s === 'planned' || s === 'queued') && !this._running.has(t.task_id);
    });

    for (const task of runnable) {
      // Don't start more than 3 tasks at once across all agents
      if (this._running.size >= 3) break;
      this._runTask(task).catch(e =>
        console.error(`[TaskRunner] Task ${task.task_id} error:`, e.message)
      );
    }
  }

  async _runTask(task) {
    const taskId  = task.task_id;
    const agentId = task.assignment?.assigned_to || null;
    this._running.add(taskId);

    console.log(`[TaskRunner] Starting task ${taskId}: "${task.title}"${agentId ? ' → ' + agentId : ' → poseidon'}`);

    try {
      // Mark in_progress
      await this._setStatus(taskId, 'in_progress', { started_at: new Date().toISOString() });

      // Build message
      const msg = [
        `TASK: ${task.title}`,
        task.description ? `\n${task.description}` : '',
        task.project_name ? `\nProject: ${task.project_name}` : ''
      ].join('').trim();

      let output = '';

      if (agentId && agentId !== 'poseidon_main') {
        // Run via AgentWorkerPool
        try {
          const gen = await this.agentPool.dispatch(agentId, msg);
          for await (const ev of gen) {
            if (ev.type === 'text') output += ev.chunk;
          }
        } catch (e) {
          output = `Error: ${e.message}`;
          await this._setStatus(taskId, 'failed', { completed_at: new Date().toISOString(), error: e.message });
          return;
        }
      } else {
        // Run via Poseidon (chatWithPoseidon)
        try {
          const poseidonMsg = `[AUTO TASK ${taskId}] ${msg}`;
          for await (const ev of this.modelService.chatWithPoseidon(poseidonMsg, [])) {
            if (ev.type === 'text') output += ev.chunk;
          }
        } catch (e) {
          output = `Error: ${e.message}`;
          await this._setStatus(taskId, 'failed', { completed_at: new Date().toISOString(), error: e.message });
          return;
        }
      }

      // Save output
      await this._saveOutput(taskId, output);

      // Mark completed
      await this._setStatus(taskId, 'completed', {
        completed_at: new Date().toISOString(),
        output_preview: output.slice(0, 200)
      });

      await this.rm.log({
        event_type: 'task_completed', severity: 'info',
        actor: { type: 'system', id: agentId || 'poseidon_main' },
        subject: { type: 'task', id: taskId },
        action: `Auto-completed task: "${task.title}"`,
        context: { output_chars: output.length }
      });

      console.log(`[TaskRunner] ✓ Task ${taskId} completed (${output.length} chars output)`);

    } finally {
      this._running.delete(taskId);
    }
  }

  async _setStatus(taskId, status, extra = {}) {
    try {
      this.rm.invalidateCache();
      const reg = await this.rm.read('tasks/tasks_registry.json');
      if (!reg.tasks?.[taskId]) return;
      reg.tasks[taskId].lifecycle = { ...(reg.tasks[taskId].lifecycle || {}), status, ...extra };
      // Also mirror status at top level for UI compatibility
      reg.tasks[taskId].status = status;
      await this.rm.write('tasks/tasks_registry.json', reg);
    } catch (e) {
      console.warn(`[TaskRunner] setStatus failed for ${taskId}:`, e.message);
    }
  }

  async _saveOutput(taskId, text) {
    try {
      const dir = path.join(AQUARIUM.TASKS, taskId, 'results');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'output.txt'), text, 'utf8');
    } catch {}
  }
}

module.exports = TaskRunner;
