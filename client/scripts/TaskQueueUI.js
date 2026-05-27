/**
 * TaskQueueUI - Live task queue with drag-and-drop reorder + inline assign.
 */

const TaskQueueUI = {
  refreshInterval: null,
  agents: [],
  projects: [],
  _tasks: [],        // current ordered task list (managed locally for drag-drop)
  _dragging: null,   // task_id being dragged

  async init() {
    await Promise.all([this._loadAgents(), this._loadProjects()]);
    await this._render();
    if (this.refreshInterval) clearInterval(this.refreshInterval);
    this.refreshInterval = setInterval(() => this._render(), 6000);
  },

  async _loadAgents() {
    try {
      const r = await window.ApiV2.agents.list();
      this.agents = Object.values(r.registry.agents || {});
    } catch {}
  },

  async _loadProjects() {
    try {
      const r = await window.ApiV2.projects.list();
      this.projects = Object.values(r.registry.projects || {});
    } catch {}
  },

  // ── Render ─────────────────────────────────────────────────────────────────

  async _render() {
    const container = document.getElementById('task-queue');
    if (!container) return;
    try {
      const r = await window.ApiV2.tasks.list();
      const tasks = r.registry.tasks || {};
      this._tasks = Object.values(tasks)
        .filter(t => !['completed', 'failed', 'cancelled', 'archived'].includes(t.lifecycle?.status))
        .sort((a, b) => (b.priority?.computed_score || 0) - (a.priority?.computed_score || 0));

      if (this._tasks.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:9px;color:var(--text-secondary);">No tasks queued</p>';
        return;
      }

      container.innerHTML = '';
      this._tasks.forEach((t, idx) => container.appendChild(this._makeItem(t, idx)));
    } catch (err) {
      container.innerHTML = `<p class="hint" style="font-size:9px;color:var(--danger);">Failed: ${this._esc(err.message)}</p>`;
    }
  },

  _makeItem(t, idx) {
    const el = document.createElement('div');
    el.className = 'task-queue-item';
    el.dataset.taskId = t.task_id;
    el.draggable = true;

    const status = t.lifecycle?.status || '?';
    const assignee = t.assignment?.assigned_to || null;
    const agentName = assignee
      ? (this.agents.find(a => a.agent_id === assignee)?.display_name || assignee)
      : '+ assign';

    el.innerHTML = `
      <div class="tq-drag-handle" title="Drag to reorder">⠿</div>
      <div class="tq-body">
        <div class="tq-row1">
          <span class="tq-rank">#${idx + 1}</span>
          <span class="tq-title">${this._esc(t.title)}</span>
          <button class="tq-cancel" onclick="TaskQueueUI.cancelTask('${t.task_id}')" title="Cancel">✕</button>
        </div>
        <div class="tq-row2">
          <span class="tq-status status-${status}">${status}</span>
          <button class="tq-assignee ${assignee ? 'tq-assigned' : 'tq-unassigned'}"
                  onclick="TaskQueueUI.openAssignPicker('${t.task_id}', this)"
                  title="Click to assign agent">${this._esc(agentName)}</button>
        </div>
      </div>
    `;

    // ── Drag-and-drop ──────────────────────────────────────────────────────
    el.addEventListener('dragstart', e => {
      this._dragging = t.task_id;
      el.classList.add('tq-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', t.task_id);
    });

    el.addEventListener('dragend', () => {
      this._dragging = null;
      el.classList.remove('tq-dragging');
      document.querySelectorAll('.tq-drag-over').forEach(x => x.classList.remove('tq-drag-over'));
    });

    el.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (this._dragging && this._dragging !== t.task_id) {
        el.classList.add('tq-drag-over');
      }
    });

    el.addEventListener('dragleave', () => el.classList.remove('tq-drag-over'));

    el.addEventListener('drop', e => {
      e.preventDefault();
      el.classList.remove('tq-drag-over');
      if (!this._dragging || this._dragging === t.task_id) return;
      this._reorder(this._dragging, t.task_id);
    });

    return el;
  },

  // ── Drag reorder ────────────────────────────────────────────────────────────
  // Move dragged task to just before the drop target, then persist scores.

  async _reorder(draggedId, targetId) {
    const list = [...this._tasks];
    const fromIdx = list.findIndex(t => t.task_id === draggedId);
    const toIdx   = list.findIndex(t => t.task_id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;

    // Splice dragged item to new position
    const [item] = list.splice(fromIdx, 1);
    const insertAt = fromIdx < toIdx ? toIdx : toIdx;
    list.splice(insertAt, 0, item);
    this._tasks = list;

    // Optimistic re-render with new ranks
    const container = document.getElementById('task-queue');
    if (container) {
      container.innerHTML = '';
      list.forEach((t, idx) => container.appendChild(this._makeItem(t, idx)));
    }

    // Persist by writing computed_score = list.length - idx (highest = first)
    const updates = list.map((t, idx) => ({
      taskId: t.task_id,
      score: list.length - idx
    }));

    await Promise.all(updates.map(({ taskId, score }) =>
      window.ApiV2._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'tasks/tasks_registry.json',
          fieldPath: `tasks.${taskId}.priority.computed_score`,
          newValue: score,
          reason: 'reordered via drag-drop'
        })
      }).catch(() => {})
    ));
  },

  // ── Assign picker ───────────────────────────────────────────────────────────

  openAssignPicker(taskId, btn) {
    // Close any existing picker
    document.querySelectorAll('.tq-assign-picker').forEach(p => p.remove());

    const picker = document.createElement('div');
    picker.className = 'tq-assign-picker';

    const rows = [{ label: '— unassign —', id: '' }, ...this.agents.map(a => ({
      label: `${a.display_name} (${a.specialization || 'general'})`,
      id: a.agent_id
    }))];

    picker.innerHTML = rows.map(r =>
      `<div class="tq-pick-row" data-agent-id="${this._esc(r.id)}">${this._esc(r.label)}</div>`
    ).join('');

    // Position below the button
    const rect = btn.getBoundingClientRect();
    picker.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;z-index:20000;`;

    document.body.appendChild(picker);

    picker.querySelectorAll('.tq-pick-row').forEach(row => {
      row.addEventListener('click', async () => {
        picker.remove();
        const agentId = row.dataset.agentId || null;
        await this._assignTask(taskId, agentId || null);
      });
    });

    // Click outside closes
    const onOutside = e => {
      if (!picker.contains(e.target) && e.target !== btn) {
        picker.remove();
        document.removeEventListener('click', onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', onOutside, true), 50);
  },

  async _assignTask(taskId, agentId) {
    try {
      await window.ApiV2._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'tasks/tasks_registry.json',
          fieldPath: `tasks.${taskId}.assignment.assigned_to`,
          newValue: agentId,
          reason: 'assigned via task queue UI'
        })
      });
      await this._render();
    } catch (err) {
      await SquidModal.alert('Assign failed: ' + err.message);
    }
  },

  // ── Cancel ──────────────────────────────────────────────────────────────────

  async cancelTask(taskId) {
    if (!await SquidModal.confirm(`Cancel task ${taskId}?`)) return;
    try {
      const tasks = (await window.ApiV2.tasks.list()).registry.tasks;
      const task = tasks[taskId];
      if (!task) return;
      const inProgress = (task.chunks || []).find(c => ['in_progress','awaiting_approval'].includes(c.status));
      if (inProgress) {
        await window.ApiV2._fetch(`/tasks/${taskId}/chunks/${inProgress.chunk_id}/decide`, {
          method: 'POST',
          body: JSON.stringify({ decision: 'stop_task', reason: 'cancelled by user' })
        });
      } else {
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: 'tasks/tasks_registry.json',
            fieldPath: `tasks.${taskId}.lifecycle.status`,
            newValue: 'cancelled',
            reason: 'cancelled by user'
          })
        });
      }
      await this._render();
    } catch (err) {
      await SquidModal.alert('Failed to cancel: ' + err.message);
    }
  },

  // ── New task modal (unchanged logic) ────────────────────────────────────────

  async addTask() {
    await Promise.all([this._loadAgents(), this._loadProjects()]);
    const dialog = document.createElement('div');
    dialog.className = 'modal task-add-modal';
    const agentOpts = this.agents.length
      ? this.agents.map(a => `<option value="${a.agent_id}">${this._esc(a.display_name)} (${a.agent_id})</option>`).join('')
      : '<option disabled>No agents</option>';
    const projOpts = this.projects.map(p => `<option value="${p.project_id}">${this._esc(p.name)}</option>`).join('');
    dialog.innerHTML = `
      <div class="modal-content" style="width:90vw;max-width:520px;">
        <div class="modal-header"><h2>New Task</h2>
          <button class="btn-close" onclick="this.closest('.modal').remove()">x</button></div>
        <div class="modal-body" style="padding:16px;">
          <div class="agent-form-row"><label>Title</label><input id="tq-title" type="text" placeholder="What needs doing?"></div>
          <div class="agent-form-row"><label>Description</label><textarea id="tq-desc" rows="3"></textarea></div>
          <div class="agent-form-row"><label>Project</label><select id="tq-project"><option value="">(none)</option>${projOpts}</select></div>
          <div class="agent-form-row"><label>Assign to</label><select id="tq-agent"><option value="">(unassigned)</option>${agentOpts}</select></div>
          <div class="agent-form-row"><label>Urgency 1-5</label><input id="tq-urg" type="number" min="1" max="5" value="3"></div>
          <div class="agent-form-row"><label>Importance 1-5</label><input id="tq-imp" type="number" min="1" max="5" value="3"></div>
          <div class="agent-form-row"><label>Difficulty 1-5</label><input id="tq-dif" type="number" min="1" max="5" value="3"></div>
          <div class="agent-form-row"><label>Est. minutes</label><input id="tq-dur" type="number" min="5" value="30"></div>
        </div>
        <div class="agent-form-footer">
          <button class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
          <button class="btn-primary" id="tq-create">Create Task</button>
        </div>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('#tq-create').addEventListener('click', async () => {
      const title = dialog.querySelector('#tq-title').value.trim();
      if (!title) { await SquidModal.alert('Title is required'); return; }
      try {
        await window.ApiV2.tasks.create({
          title, description: dialog.querySelector('#tq-desc').value,
          project_id: dialog.querySelector('#tq-project').value || null,
          assigned_to: dialog.querySelector('#tq-agent').value || null,
          urgency: +dialog.querySelector('#tq-urg').value,
          importance: +dialog.querySelector('#tq-imp').value,
          difficulty: +dialog.querySelector('#tq-dif').value,
          estimated_duration_minutes: +dialog.querySelector('#tq-dur').value
        });
        dialog.remove(); this._render();
      } catch (err) { await SquidModal.alert('Failed: ' + err.message); }
    });
  },

  _esc(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => TaskQueueUI.init());
} else {
  setTimeout(() => TaskQueueUI.init(), 500);
}
window.TaskQueueUI = TaskQueueUI;
console.log('[OK] TaskQueueUI loaded');
