/**
 * TaskQueueUI - Live task management in the right panel
 * 
 * Add task / Cancel task / Re-prioritize
 * Reads from /api/v2/tasks, refreshes every 3 seconds.
 */

const TaskQueueUI = {
  refreshInterval: null,
  agents: [],
  projects: [],

  async init() {
    this._loadAgents();
    this._loadProjects();
    this._render();
    
    // Auto-refresh
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => this._render(), 5000);
  },

  async _loadAgents() {
    try {
      const r = await window.ApiV2.agents.list();
      this.agents = Object.values(r.registry.agents || {});
    } catch (err) {
      console.warn('[TaskQueueUI] failed loading agents:', err.message);
    }
  },

  async _loadProjects() {
    try {
      const r = await window.ApiV2.projects.list();
      this.projects = Object.values(r.registry.projects || {});
    } catch (err) {
      console.warn('[TaskQueueUI] failed loading projects:', err.message);
    }
  },

  async _render() {
    const container = document.getElementById('task-queue');
    if (!container) return;
    
    try {
      const r = await window.ApiV2.tasks.list();
      const tasks = r.registry.tasks || {};
      const open = Object.values(tasks)
        .filter(t => !['completed', 'failed', 'cancelled', 'archived'].includes(t.lifecycle?.status))
        .sort((a, b) => (b.priority?.computed_score || 0) - (a.priority?.computed_score || 0));
      
      if (open.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size: 9px; color: var(--text-secondary);">No tasks queued</p>';
        return;
      }
      
      container.innerHTML = open.map(t => `
        <div class="task-queue-item" data-task-id="${t.task_id}">
          <div class="task-queue-row1">
            <span class="task-queue-priority">P:${(t.priority?.computed_score ?? 0).toFixed(1)}</span>
            <span class="task-queue-title">${this._escape(t.title)}</span>
          </div>
          <div class="task-queue-row2">
            <span class="task-queue-status status-${t.lifecycle?.status}">${t.lifecycle?.status || '?'}</span>
            <span class="task-queue-assignee">${t.assignment?.assigned_to || 'unassigned'}</span>
            <button class="task-queue-btn task-queue-up" onclick="TaskQueueUI.changePriority('${t.task_id}', 1)" title="Bump priority">+</button>
            <button class="task-queue-btn task-queue-down" onclick="TaskQueueUI.changePriority('${t.task_id}', -1)" title="Lower priority">-</button>
            <button class="task-queue-btn task-queue-cancel" onclick="TaskQueueUI.cancelTask('${t.task_id}')" title="Cancel task">x</button>
          </div>
        </div>
      `).join('');
    } catch (err) {
      container.innerHTML = `<p class="hint" style="font-size: 9px; color: var(--danger);">Failed: ${err.message}</p>`;
    }
  },

  async addTask() {
    // Inline dialog
    const dialog = document.createElement('div');
    dialog.className = 'modal task-add-modal';
    const agentOptions = this.agents.map(a => `<option value="${a.agent_id}">${a.display_name} (${a.agent_id})</option>`).join('');
    const projectOptions = this.projects.map(p => `<option value="${p.project_id}">${p.name}</option>`).join('');
    dialog.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:520px;">
        <div class="modal-header">
          <h2>New Task</h2>
          <button class="btn-close" onclick="this.closest('.modal').remove()">x</button>
        </div>
        <div class="modal-body" style="padding:16px;">
          <div class="agent-form-row"><label>Title</label><input id="tq-title" type="text" placeholder="What needs doing?"></div>
          <div class="agent-form-row"><label>Description</label><textarea id="tq-desc" rows="3"></textarea></div>
          <div class="agent-form-row"><label>Project</label><select id="tq-project"><option value="">(none)</option>${projectOptions}</select></div>
          <div class="agent-form-row"><label>Assign to</label><select id="tq-agent"><option value="">(unassigned)</option>${agentOptions}</select></div>
          <div class="agent-form-row"><label>Urgency 1-5</label><input id="tq-urg" type="number" min="1" max="5" value="3"></div>
          <div class="agent-form-row"><label>Importance 1-5</label><input id="tq-imp" type="number" min="1" max="5" value="3"></div>
          <div class="agent-form-row"><label>Difficulty 1-5</label><input id="tq-dif" type="number" min="1" max="5" value="3"></div>
          <div class="agent-form-row"><label>Est. minutes</label><input id="tq-dur" type="number" min="5" value="30"></div>
        </div>
        <div class="agent-form-footer">
          <button class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
          <button class="btn-primary" id="tq-create">Create Task</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
    dialog.querySelector('#tq-create').addEventListener('click', async () => {
      const title = dialog.querySelector('#tq-title').value.trim();
      if (!title) { alert('Title is required'); return; }
      try {
        await window.ApiV2.tasks.create({
          title,
          description: dialog.querySelector('#tq-desc').value,
          project_id: dialog.querySelector('#tq-project').value || null,
          assigned_to: dialog.querySelector('#tq-agent').value || null,
          urgency: parseInt(dialog.querySelector('#tq-urg').value, 10),
          importance: parseInt(dialog.querySelector('#tq-imp').value, 10),
          difficulty: parseInt(dialog.querySelector('#tq-dif').value, 10),
          estimated_duration_minutes: parseInt(dialog.querySelector('#tq-dur').value, 10)
        });
        dialog.remove();
        this._render();
      } catch (err) {
        alert('Failed to create task: ' + err.message);
      }
    });
  },

  async cancelTask(taskId) {
    if (!confirm(`Cancel task ${taskId}?`)) return;
    try {
      const tasks = (await window.ApiV2.tasks.list()).registry.tasks;
      const task = tasks[taskId];
      if (!task) return;
      
      // Find the in-progress chunk if any
      const inProgressChunk = (task.chunks || []).find(c => c.status === 'in_progress' || c.status === 'awaiting_approval');
      
      if (inProgressChunk) {
        // Stop via chunk decision
        await window.ApiV2._fetch(`/tasks/${taskId}/chunks/${inProgressChunk.chunk_id}/decide`, {
          method: 'POST',
          body: JSON.stringify({ decision: 'stop_task', reason: 'cancelled by user via task queue' })
        });
      } else {
        // No active chunk - update via field PATCH to mark cancelled
        // Note: this is a workaround. Ideally we'd have a cancel endpoint.
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: 'tasks/tasks_registry.json',
            fieldPath: `tasks.${taskId}.lifecycle.status`,
            newValue: 'cancelled',
            reason: 'cancelled by user (no active chunk)'
          })
        });
      }
      this._render();
    } catch (err) {
      alert('Failed to cancel: ' + err.message);
    }
  },

  async changePriority(taskId, direction) {
    try {
      const r = await window.ApiV2.tasks.list();
      const task = r.registry.tasks[taskId];
      if (!task) return;
      
      // Bump urgency up or down
      const newUrgency = Math.max(1, Math.min(5, (task.priority.urgency || 3) + direction));
      
      // Update urgency
      await window.ApiV2._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'tasks/tasks_registry.json',
          fieldPath: `tasks.${taskId}.priority.urgency`,
          newValue: newUrgency,
          reason: 'user re-prioritized via task queue'
        })
      });
      
      // Recompute score
      const newScore = (newUrgency * 3) +
        ((task.priority.importance || 3) * 2) +
        ((task.priority.blocking_count || 0) * 5) -
        ((task.priority.difficulty || 3) * 1) -
        (((task.priority.estimated_duration_minutes || 30) / 30) * 0.5) -
        ((task.priority.resource_saturation_factor || 0) * 4);
      
      await window.ApiV2._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'tasks/tasks_registry.json',
          fieldPath: `tasks.${taskId}.priority.computed_score`,
          newValue: Math.round(newScore * 100) / 100,
          reason: 'recomputed after urgency change'
        })
      }).catch(() => {/* computed_score is read-only by design - skip silently */});
      
      this._render();
    } catch (err) {
      alert('Failed: ' + err.message);
    }
  },

  _escape(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  }
};

// Auto-init when page ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => TaskQueueUI.init());
} else {
  setTimeout(() => TaskQueueUI.init(), 500);
}

window.TaskQueueUI = TaskQueueUI;
console.log('[OK] TaskQueueUI loaded');
