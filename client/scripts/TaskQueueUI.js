/**
 * TaskQueueUI - Live task queue with drag-and-drop reorder + inline assign.
 */

const TaskQueueUI = {
  refreshInterval: null,
  agents: [],
  projects: [],
  _tasks: [],        // current ordered task list (managed locally for drag-drop)
  _dragging: null,   // task_id being dragged
  _workerStatuses: {},   // agentId → { status, model_id }
  _runTimers: {},        // taskId → { start, elapsed interval }

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
      // Await worker statuses so progress bars don't flicker/disappear between renders
      try {
        const ws = await window.ApiV2._fetch('/agents/pool/status');
        this._workerStatuses = ws.workers || {};
      } catch {}

      const r = await window.ApiV2.tasks.list();
      const tasks = r.registry.tasks || {};
      const allTasks = Object.values(tasks);

      // Active queue: not completed/failed/cancelled/archived
      this._tasks = allTasks
        .filter(t => !['completed', 'failed', 'cancelled', 'archived'].includes(t.lifecycle?.status || t.status))
        .sort((a, b) => (b.sort_order || 0) - (a.sort_order || 0));

      // Completed tasks (last 10, most recent first) — for results view
      const doneTasks = allTasks
        .filter(t => ['completed', 'failed'].includes(t.lifecycle?.status || t.status))
        .sort((a, b) => new Date(b.lifecycle?.completed_at || b.created_at || 0) - new Date(a.lifecycle?.completed_at || a.created_at || 0))
        .slice(0, 10);

      container.innerHTML = '';

      if (this._tasks.length === 0 && doneTasks.length === 0) {
        container.innerHTML = '<p class="hint" style="font-size:9px;color:var(--text-secondary);">No tasks queued — create tasks and assign agents to auto-run them.</p>';
        return;
      }

      this._tasks.forEach((t, idx) => container.appendChild(this._makeItem(t, idx)));

      // ── Completed / results section ──
      if (doneTasks.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'tq-done-section';
        sep.innerHTML = `<div class="tq-done-header">
          <span>✅ Recent results (${doneTasks.length})</span>
          <button class="tq-done-toggle" onclick="this.closest('.tq-done-section').classList.toggle('tq-done-collapsed')">▾</button>
        </div>
        <div class="tq-done-list">${doneTasks.map(t => this._makeDoneItem(t)).join('')}</div>`;
        container.appendChild(sep);
      }
    } catch (err) {
      container.innerHTML = `<p class="hint" style="font-size:9px;color:var(--danger);">Failed: ${this._esc(err.message)}</p>`;
    }
  },

  _makeDoneItem(t) {
    const ok      = t.lifecycle?.status === 'completed';
    const icon    = ok ? '✅' : '❌';
    const agent   = t.assignment?.assigned_name || t.assignment?.assigned_to || '—';
    const when    = t.lifecycle?.completed_at ? this._elapsed(t.lifecycle.completed_at) : '';
    const summary = t.result_summary ? this._esc(t.result_summary.slice(0, 120)) + (t.result_summary.length > 120 ? '…' : '') : '<em style="opacity:.5">No result saved</em>';
    return `
      <div class="tq-done-item" style="position:relative;">
        <button onclick="event.stopPropagation();TaskQueueUI.deleteTask('${t.task_id}')" title="Delete" style="position:absolute;top:4px;right:4px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);color:#ef4444;border-radius:4px;padding:0 5px;font-size:8px;cursor:pointer;">🗑</button>
        <div style="cursor:pointer" onclick="TaskQueueUI.openTaskDetail('${t.task_id}')">
        <div class="tq-done-row1">
          <span class="tq-done-icon">${icon}</span>
          <span class="tq-done-title">${this._esc(t.title)}</span>
          <span class="tq-done-when">${when}</span>
        </div>
        <div class="tq-done-agent">${this._esc(agent)}</div>
        <div class="tq-done-summary">${summary}</div>
        </div>
      </div>`;
  },

  _makeItem(t, idx) {
    const el = document.createElement('div');
    el.className = 'task-queue-item';
    el.dataset.taskId = t.task_id;
    el.draggable = true;

    const status = t.lifecycle?.status || t.status || 'open';
    const assignee = t.assignment?.assigned_to || null;
    const agentName = assignee
      ? (this.agents.find(a => a.agent_id === assignee)?.display_name || t.assignment?.assigned_name || assignee)
      : '+ assign';

    const workerStatus = assignee ? (this._workerStatuses[assignee]?.status || 'idle') : null;
    const isRunning   = status === 'in_progress' || workerStatus === 'running';
    const canRun      = false;  // tasks auto-run — manual run removed
    const isCron      = !!t.cron_schedule;
    const projectName = t.project_name || t.context?.project_id || null;

    // Task type badge
    let typeBadge = '';
    if (isCron) {
      typeBadge = `<span class="tq-type-badge tq-type-cron" title="Recurring: ${this._esc(t.cron_schedule)}">⏱ CRON</span>`;
    } else if (projectName) {
      typeBadge = `<span class="tq-type-badge tq-type-project" title="Part of project: ${this._esc(projectName)}">📁 ${this._esc(projectName)}</span>`;
    } else {
      typeBadge = `<span class="tq-type-badge tq-type-oneshot" title="One-time task">◈ ONE-TIME</span>`;
    }

    // Status dot + label
    const statusDot = {
      'open':        { cls: 'tq-dot-open',    label: 'queued' },
      'planned':     { cls: 'tq-dot-planned',  label: 'ready' },
      'assigned':    { cls: 'tq-dot-planned',  label: 'assigned' },
      'in_progress': { cls: 'tq-dot-running',  label: 'running' },
      'paused':      { cls: 'tq-dot-paused',   label: 'paused' },
    }[status] || { cls: 'tq-dot-open', label: status };

    el.innerHTML = `
      <div class="tq-drag-handle" title="Drag to reorder">⠿</div>
      <div class="tq-body">
        <div class="tq-row1">
          <span class="tq-rank">#${idx + 1}</span>
          <span class="tq-dot ${statusDot.cls} ${isRunning ? 'tq-dot-pulse' : ''}" title="${statusDot.label}">⬤</span>
          <span class="tq-title tq-title-link" title="Click to view/edit details">${this._esc(t.title)}</span>
          ${canRun ? `<button class="tq-run-btn" onclick="TaskQueueUI.runTask('${t.task_id}')" title="▶ Run now">▶</button>` : ''}
          <button class="tq-cancel" onclick="TaskQueueUI.cancelTask('${t.task_id}')" title="Cancel">✕</button>
          <button class="tq-delete" onclick="TaskQueueUI.deleteTask('${t.task_id}')" title="Delete permanently" style="background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#ef4444;border-radius:4px;padding:0 5px;font-size:9px;cursor:pointer;margin-left:2px;">🗑</button>
        </div>
        <div class="tq-row2">
          ${typeBadge}
          <span class="tq-status-label">${statusDot.label}</span>
          <button class="tq-assignee ${assignee ? 'tq-assigned' : 'tq-unassigned'}"
                  onclick="TaskQueueUI.openAssignPicker('${t.task_id}', this)"
                  title="Click to assign agent">${this._esc(agentName)}</button>
        </div>
        ${isRunning ? `<div class="tq-progress-bar"><div class="tq-progress-fill"></div></div>` : ''}
        ${isRunning ? `<div class="tq-running-meta">⚡ Running${t.lifecycle?.started_at ? ' · ' + TaskQueueUI._elapsed(t.lifecycle.started_at) : ''}</div>` : ''}
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

    // Click on title → open detail popup
    el.querySelector('.tq-title')?.addEventListener('click', e => {
      e.stopPropagation();
      TaskQueueUI.openTaskDetail(t.task_id);
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
          fieldPath: `tasks.${taskId}.sort_order`,
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

  // ── Run task directly ────────────────────────────────────────────────────────

  async runTask(taskId) {
    const task = this._tasks.find(t => t.task_id === taskId);
    if (!task) return;
    const agentId = task.assignment?.assigned_to;
    if (!agentId) return await SquidModal.alert('Assign an agent first.');

    // Build task message from title + description
    const msg = task.description
      ? `${task.title}

${task.description}`
      : task.title;

    try {
      // Mark in_progress immediately (optimistic)
      await window.ApiV2._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'tasks/tasks_registry.json',
          fieldPath: `tasks.${taskId}.lifecycle.status`,
          newValue: 'in_progress',
          reason: 'manually started from task queue'
        })
      });
      await window.ApiV2._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'tasks/tasks_registry.json',
          fieldPath: `tasks.${taskId}.lifecycle.started_at`,
          newValue: new Date().toISOString(),
          reason: 'task started'
        })
      });

      // Fire POST to agent run endpoint (SSE, fire-and-forget here — results logged server-side)
      fetch(`/api/v2/agents/${agentId}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, task_id: taskId })
      }).then(res => {
        if (!res.ok) console.warn('[TaskQueueUI] Agent run HTTP error:', res.status);
        // Drain SSE stream (needed so server doesn't hang)
        const reader = res.body?.getReader();
        if (!reader) return;
        const drain = () => reader.read().then(({ done }) => { if (!done) drain(); }).catch(() => {});
        drain();
      }).catch(err => console.warn('[TaskQueueUI] Agent run failed:', err));

      await this._render();
    } catch (err) {
      await SquidModal.alert('Failed to start task: ' + err.message);
    }
  },

  // ── Task detail popup ──────────────────────────────────────────────────────

  async openTaskDetail(taskId) {
    // Fetch fresh task data
    let task;
    try {
      const r = await window.ApiV2.tasks.list();
      task = r.registry.tasks?.[taskId];
    } catch (err) {
      return SquidModal.alert('Could not load task: ' + err.message);
    }
    if (!task) return SquidModal.alert('Task not found.');

    const modal = document.createElement('div');
    modal.className = 'modal tq-detail-modal';

    const statusOptions = ['open','planned','in_progress','completed','failed','cancelled','archived']
      .map(s => `<option value="${s}" ${(task.lifecycle?.status||'open')===s?'selected':''}>${s}</option>`).join('');
    const currentPriority = typeof task.priority === 'object' ? (task.priority?.label || 'medium') : (task.priority || 'medium');
    const priorityOptions = ['critical','high','medium','low']
      .map(p => `<option value="${p}" ${currentPriority===p?'selected':''}>${p}</option>`).join('');
    const agentOptions = '<option value="">— unassigned —</option>' +
      this.agents.map(a => `<option value="${a.agent_id}" ${task.assignment?.assigned_to===a.agent_id?'selected':''}>${this._esc(a.display_name)} (${a.agent_id})</option>`).join('');

    modal.innerHTML = `
      <div class="modal-content tq-detail-content">
        <div class="modal-header">
          <div class="tq-detail-title-row">
            <span class="tq-detail-status-badge status-${task.lifecycle?.status||'open'}">${task.lifecycle?.status||'open'}</span>
            <span class="tq-detail-tid">${this._esc(task.task_id)}</span>
          </div>
          <button class="btn-close" onclick="this.closest('.modal').remove()">x</button>
        </div>
        <div class="tq-detail-body">
          <div class="tq-detail-field">
            <label>Title</label>
            <input id="tqd-title" type="text" value="${this._esc(task.title || '')}">
          </div>
          <div class="tq-detail-field">
            <label>Description</label>
            <textarea id="tqd-desc" rows="4">${this._esc(task.description || '')}</textarea>
          </div>
          <div class="tq-detail-field">
            <label>Cron schedule <span style="font-size:7px;font-family:monospace;opacity:.6">(optional — e.g. 0 8 * * * for 8am daily)</span></label>
            <div style="display:flex;gap:6px;align-items:center;">
              <input id="tqd-cron" type="text" style="font-family:monospace;" placeholder="0 8 * * *" value="${this._esc(task.cron_schedule||'')}">
              <a href="https://crontab.guru" target="_blank" style="font-size:8px;color:var(--accent);white-space:nowrap;text-decoration:none;" title="Open crontab.guru">🕐 help</a>
            </div>
            ${task.cron_schedule ? `<p class="comms-hint">Next run: ${TaskQueueUI._nextCron(task.cron_schedule)}</p>` : ''}
          </div>
          <div class="tq-detail-row2">
            <div class="tq-detail-field">
              <label>Status</label>
              <select id="tqd-status">${statusOptions}</select>
            </div>
            <div class="tq-detail-field">
              <label>Priority</label>
              <select id="tqd-priority">${priorityOptions}</select>
            </div>
            <div class="tq-detail-field">
              <label>Assigned agent</label>
              <select id="tqd-agent">${agentOptions}</select>
            </div>
          </div>
          ${task.lifecycle?.started_at ? `<div class="tq-detail-meta">Started: ${new Date(task.lifecycle.started_at).toLocaleString()}</div>` : ''}
          ${task.result_summary || task.result_file ? `
          <div class="tq-detail-field">
            <div class="tq-detail-result-header">
              <label>Result</label>
              ${task.result_file ? `<button class="btn-secondary" style="font-size:8px;padding:2px 8px;" id="tqd-load-result">📄 Load full result</button>` : ''}
            </div>
            <div class="tq-detail-result" id="tqd-result-box">${task.result_summary ? this._esc(task.result_summary) : '<em style="opacity:.5">Click to load full result</em>'}</div>
          </div>` : ''}
          ${task.created_at ? `<div class="tq-detail-meta">Created: ${new Date(task.created_at).toLocaleString()} by ${this._esc(task.created_by||'?')}</div>` : ''}
        </div>
        <div class="agent-form-footer">
          <span id="tqd-status-msg" class="agent-form-status"></span>
          <button class="btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
          <button class="btn-primary" id="tqd-save">Save changes</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    modal.querySelector('#tqd-save').addEventListener('click', async () => {
      const msg = modal.querySelector('#tqd-status-msg');
      const title    = modal.querySelector('#tqd-title').value.trim();
      const desc     = modal.querySelector('#tqd-desc').value.trim();
      const status   = modal.querySelector('#tqd-status').value;
      const priority = modal.querySelector('#tqd-priority').value;
      const agentId  = modal.querySelector('#tqd-agent').value || null;
      const agentEntry = agentId ? this.agents.find(a => a.agent_id === agentId) : null;

      msg.textContent = 'Saving...';
      msg.className = 'agent-form-status';

      const patches = [
        { fieldPath: `tasks.${taskId}.title`,                     newValue: title },
        { fieldPath: `tasks.${taskId}.description`,               newValue: desc },
        { fieldPath: `tasks.${taskId}.lifecycle.status`,          newValue: status },
        { fieldPath: `tasks.${taskId}.priority.label`,             newValue: priority },
        { fieldPath: `tasks.${taskId}.sort_order`,    newValue: priority === 'critical' ? 20 : priority === 'high' ? 15 : priority === 'low' ? 5 : 10 },
        { fieldPath: `tasks.${taskId}.assignment.assigned_to`,    newValue: agentId },
        { fieldPath: `tasks.${taskId}.assignment.assigned_name`,  newValue: agentEntry?.display_name || null },
        { fieldPath: `tasks.${taskId}.cron_schedule`,              newValue: modal.querySelector('#tqd-cron').value.trim() || null },
      ];

      let failed = 0;
      for (const p of patches) {
        try {
          await window.ApiV2._fetch('/field', {
            method: 'PATCH',
            body: JSON.stringify({ filePath: 'tasks/tasks_registry.json', ...p, reason: 'manual edit' })
          });
        } catch { failed++; }
      }

      if (failed) {
        msg.textContent = `${failed} fields failed to save`;
        msg.className = 'agent-form-status error';
      } else {
        msg.textContent = 'Saved';
        msg.className = 'agent-form-status success';
        await this._render();
        setTimeout(() => modal.remove(), 600);
      }
    });

    // Wire load-full-result button
    modal.querySelector('#tqd-load-result')?.addEventListener('click', async () => {
      const btn = modal.querySelector('#tqd-load-result');
      const box = modal.querySelector('#tqd-result-box');
      if (!btn || !box) return;
      btn.textContent = 'Loading...';
      btn.disabled = true;
      try {
        const data = await window.ApiV2._fetch(`/tasks/${taskId}/result`);
        if (data.result) {
          box.style.whiteSpace = 'pre-wrap';
          box.style.maxHeight  = '300px';
          box.textContent = data.result;
          btn.textContent = '✅ Loaded';
        } else {
          box.textContent = 'No result file found.';
          btn.textContent = '—';
        }
      } catch (err) {
        box.textContent = 'Error loading result: ' + err.message;
        btn.disabled = false;
        btn.textContent = '📄 Retry';
      }
    });
  },

  // ── Helpers ───────────────────────────────────────────────────────────────

  _elapsed(isoStr) {
    if (!isoStr) return '';
    const secs = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
    if (secs < 60) return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs/60)}m ago`;
    return `${Math.floor(secs/3600)}h ago`;
  },

  _nextCron(expr) {
    // Very light human-readable description — no full parser needed
    if (!expr) return '';
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) return expr;
    const [min, hr, dom, mon, dow] = parts;
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    if (dom === '*' && mon === '*') {
      const timeStr = (min !== '*' && hr !== '*') ? `${hr.padStart(2,'0')}:${min.padStart(2,'0')}` : `${hr}:${min}`;
      if (dow === '*') return `Every day at ${timeStr}`;
      if (/^[0-6]$/.test(dow)) return `Every ${days[+dow]} at ${timeStr}`;
      if (dow === '1-5') return `Weekdays at ${timeStr}`;
    }
    return expr; // fallback: show raw
  },

  // ── Delete (hard) ──────────────────────────────────────────────────────────

  async deleteTask(taskId) {
    const task = this._tasks.find(t => t.task_id === taskId);
    const label = task?.title ? '"' + task.title + '"' : taskId;
    if (!await SquidModal.confirm('Permanently delete task ' + label + '? This cannot be undone.')) return;
    try {
      await window.ApiV2._fetch('/tasks/' + taskId, { method: 'DELETE' });
      await this._render();
    } catch (err) {
      await SquidModal.alert('Delete failed: ' + err.message);
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
