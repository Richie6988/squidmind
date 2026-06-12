'use strict';
/**
 * TaskRunner — automatic task execution engine.
 * Polls open tasks every heartbeat tick and executes them via agent or Poseidon.
 */

const path = require('path');
const fs   = require('fs').promises;
const AQUARIUM = require('../aquarium');

class TaskRunner {
  constructor(rm, modelService, agentPool) {
    this.rm           = rm;
    this.modelService = modelService;
    this.agentPool    = agentPool;
    this._running     = new Set();
  }

  async tick() {
    let reg;
    try {
      this.rm.invalidateCache();
      reg = await this.rm.getTasksRegistry();
    } catch (e) {
      console.warn('[TaskRunner] tick read error:', e.message);
      return;
    }

    const runnable = Object.values(reg.tasks || {}).filter(t => {
      const s = t.lifecycle?.status || t.status || 'open';
      return (s === 'open' || s === 'planned' || s === 'queued') && !this._running.has(t.task_id);
    });

    for (const task of runnable) {
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

    console.log(`[TaskRunner] ▶ ${taskId}: "${task.title}"${agentId ? ' → ' + agentId : ' → poseidon'}`);

    try {
      await this._setStatus(taskId, 'in_progress', { started_at: new Date().toISOString() });

      const msg = [
        `TASK [${taskId}]: ${task.title}`,
        task.description ? `\nDetails: ${task.description}` : '',
        task.project_name ? `\nProject: ${task.project_name}` : ''
      ].join('').trim();

      let output = '';
      let failed = false;

      try {
        if (agentId && agentId !== 'poseidon_main') {
          const gen = await this.agentPool.dispatch(agentId, msg);
          for await (const ev of gen) {
            if (ev.type === 'text') output += ev.chunk;
          }
        } else {
          // Poseidon: prefix so it knows this is a background auto-task
          const posMsg = `[BACKGROUND AUTO-TASK ${taskId}]\n${msg}\n\nExecute this task now using your tools. Write a concise completion report.`;
          for await (const ev of this.modelService.chatWithPoseidon(posMsg, [])) {
            if (ev.type === 'text') output += ev.chunk;
          }
        }
      } catch (e) {
        output = `Execution error: ${e.message}`;
        failed = true;
      }

      // Only save if there's meaningful output
      if (output.trim().length > 0) {
        await this._saveOutput(taskId, output);
      }

      const finalStatus = failed ? 'failed' : 'completed';
      await this._setStatus(taskId, finalStatus, {
        completed_at: new Date().toISOString(),
        output_preview: output.slice(0, 300)
      });

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
      this.rm.invalidateCache();
      // Write to the flat registry (getTasksRegistry reads it)
      const reg = await this.rm.getTasksRegistry();
      if (!reg.tasks?.[taskId]) return;
      reg.tasks[taskId].lifecycle = { ...(reg.tasks[taskId].lifecycle || {}), status, ...extra };
      reg.tasks[taskId].status   = status;
      // Write back to flat file (AQUARIUM.resolve handles lowercase→uppercase)
      await this.rm.write('tasks/tasks_registry.json', reg);
    } catch (e) {
      console.warn(`[TaskRunner] setStatus failed for ${taskId}:`, e.message);
    }
  }

  async _saveOutput(taskId, text) {
    try {
      // Always write to the correct UPPERCASE path
      const dir = path.join(AQUARIUM.TASKS, taskId, 'results');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'output.txt'), text, 'utf8');
    } catch (e) {
      console.warn(`[TaskRunner] saveOutput failed for ${taskId}:`, e.message);
    }
  }
}

module.exports = TaskRunner;
