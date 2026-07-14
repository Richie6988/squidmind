/**
 * Scheduler - Create recurring/scheduled tasks without going through Poseidon.
 * 
 * Stored in tasks_registry.json with extra `schedule` metadata:
 *   - cron-like trigger (e.g. "every 30 min", "daily 9am", "once at 2026-01-15T10:00")
 *   - target agent
 * 
 * Backend executes them via the heartbeat tick (when due, creates a new task instance).
 */

const Scheduler = {
  modal: null,
  schedules: [],
  agents: [],
  projects: [],
  
  async open() {
    this._build();
    await this._loadOptions();
    await this._refresh();
  },
  
  _build() {
    if (this.modal && !document.body.contains(this.modal)) {
      this.modal = null;
    }
    if (this.modal) { this.modal.classList.remove('hidden'); return; }
    this.modal = document.createElement('div');
    this.modal.className = 'modal scheduler-modal';
    this.modal.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:680px; max-height:85vh; display:flex; flex-direction:column;">
        <div class="modal-header">
          <h2>Task Scheduler</h2>
          <button class="btn-close" onclick="Scheduler.close()">x</button>
        </div>
        <div class="modal-body" style="flex:1; overflow-y:auto; padding:16px;">
          <p class="hint" style="font-size:9px; color:var(--text-secondary); margin-bottom:12px;">
            Schedule tasks to run later or repeatedly, without asking Poseidon. Stored in tasks_registry.json with schedule metadata.
          </p>
          <div id="scheduler-list"></div>
          <div style="margin-top:16px; border-top:1px solid var(--border); padding-top:16px;">
            <h3 style="font-size:11px; color:var(--accent); margin-bottom:10px;">+ New Scheduled Task</h3>
            <div class="agent-form-row"><label>Title</label><input id="sch-title" type="text"></div>
            <div class="agent-form-row"><label>Description</label><textarea id="sch-desc" rows="2"></textarea></div>
            <div class="agent-form-row"><label>Project</label><select id="sch-project"><option value="">(none)</option></select></div>
            <div class="agent-form-row"><label>Assign to</label><select id="sch-agent"><option value="">(unassigned)</option></select></div>
            <div class="agent-form-row"><label>Run when</label>
              <select id="sch-when">
                <option value="once">Once at specific time</option>
                <option value="interval">Every N minutes</option>
                <option value="daily">Daily at time</option>
                <option value="weekly">Weekly on day at time</option>
              </select>
            </div>
            <div class="agent-form-row" id="sch-row-datetime" style="display:none;"><label>Date &amp; time</label><input id="sch-datetime" type="datetime-local"></div>
            <div class="agent-form-row" id="sch-row-interval" style="display:none;"><label>Every N minutes</label><input id="sch-interval" type="number" min="1" value="60"></div>
            <div class="agent-form-row" id="sch-row-time" style="display:none;"><label>At time</label><input id="sch-time" type="time" value="09:00"></div>
            <div class="agent-form-row" id="sch-row-day" style="display:none;"><label>Day of week</label>
              <select id="sch-day"><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3" selected>Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select>
            </div>
            <div class="agent-form-row"><label>Urgency 1-5</label><input id="sch-urg" type="number" min="1" max="5" value="3"></div>
            <div class="agent-form-row"><label>Est. minutes</label><input id="sch-dur" type="number" min="5" value="30"></div>
            <button class="btn-primary" id="sch-create" style="margin-top:8px;">Schedule</button>
            <span id="sch-status" class="agent-form-status" style="margin-left:8px;"></span>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
    
    // Wire conditional fields
    const whenSel = this.modal.querySelector('#sch-when');
    const refreshConditional = () => {
      const v = whenSel.value;
      const show = (id, when) => this.modal.querySelector(id).style.display = when ? '' : 'none';
      show('#sch-row-datetime', v === 'once');
      show('#sch-row-interval', v === 'interval');
      show('#sch-row-time', v === 'daily' || v === 'weekly');
      show('#sch-row-day', v === 'weekly');
    };
    whenSel.addEventListener('change', refreshConditional);
    refreshConditional();
    
    this.modal.querySelector('#sch-create').addEventListener('click', () => this._submit());
  },
  
  async _loadOptions() {
    try {
      const [agRes, prRes] = await Promise.all([
        window.api._fetch('/agents'),
        window.api._fetch('/projects')
      ]);
      this.agents = Object.values(agRes.registry.agents || {});
      this.projects = Object.values(prRes.registry.projects || {});
      
      const agSel = this.modal.querySelector('#sch-agent');
      agSel.innerHTML = '<option value="">(unassigned)</option>' + this.agents.map(a => `<option value="${a.agent_id}">${this._esc(a.display_name)} - ${this._esc(a.specialization || 'general')}</option>`).join('');
      
      const prSel = this.modal.querySelector('#sch-project');
      prSel.innerHTML = '<option value="">(none)</option>' + this.projects.map(p => `<option value="${p.project_id}">${this._esc(p.name)}</option>`).join('');
    } catch (err) {
      console.warn('[Scheduler] load options:', err.message);
    }
  },
  
  async _refresh() {
    try {
      const r = await window.api._fetch('/tasks');
      this.schedules = Object.values(r.registry.tasks || {}).filter(t => t.schedule);
      this._renderList();
    } catch (err) {
      const el = this.modal.querySelector('#scheduler-list');
      if (el) el.innerHTML = `<p style="color:var(--danger); font-size:10px;">Failed to load: ${err.message}</p>`;
    }
  },
  
  _renderList() {
    const el = this.modal.querySelector('#scheduler-list');
    // Show active schedules as a compact list without section header
    if (this.schedules.length === 0) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = this.schedules.map(t => `
      <div class="task-queue-item">
        <div class="task-queue-row1">
          <strong>${this._esc(t.title)}</strong>
        </div>
        <div class="task-queue-row2" style="margin:4px 0;">
          <span style="font-size:8px; color:var(--accent);">${this._describeSchedule(t.schedule)}</span>
          <span style="font-size:8px; color:var(--text-secondary);">→ ${t.assigned_to || 'unassigned'}</span>
        </div>
        <button class="task-queue-btn task-queue-cancel" onclick="Scheduler.cancel('${t.task_id}')">x Cancel</button>
      </div>
    `).join('');
  },
  
  _describeSchedule(s) {
    if (!s) return '';
    if (s.type === 'once') return `Once at ${new Date(s.run_at).toLocaleString()}`;
    if (s.type === 'interval') return `Every ${s.minutes} min`;
    if (s.type === 'daily') return `Daily at ${s.time}`;
    if (s.type === 'weekly') return `Weekly ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][s.day]} at ${s.time}`;
    return JSON.stringify(s);
  },
  
  async _submit() {
    const status = this.modal.querySelector('#sch-status');
    const title = this.modal.querySelector('#sch-title').value.trim();
    if (!title) { status.textContent = 'Title required'; status.className = 'agent-form-status error'; return; }
    
    const when = this.modal.querySelector('#sch-when').value;
    const schedule = { type: when, created_at: new Date().toISOString() };
    if (when === 'once') schedule.run_at = this.modal.querySelector('#sch-datetime').value;
    else if (when === 'interval') schedule.minutes = parseInt(this.modal.querySelector('#sch-interval').value, 10);
    else if (when === 'daily') schedule.time = this.modal.querySelector('#sch-time').value;
    else if (when === 'weekly') { schedule.time = this.modal.querySelector('#sch-time').value; schedule.day = parseInt(this.modal.querySelector('#sch-day').value, 10); }
    
    try {
      // Create task with schedule embedded
      const res = await window.api._fetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title,
          description: this.modal.querySelector('#sch-desc').value,
          project_id: this.modal.querySelector('#sch-project').value || null,
          assigned_to: this.modal.querySelector('#sch-agent').value || null,
          urgency: parseInt(this.modal.querySelector('#sch-urg').value, 10),
          importance: 3, difficulty: 3,
          estimated_duration_minutes: parseInt(this.modal.querySelector('#sch-dur').value, 10)
        })
      });
      
      // Patch schedule onto the task
      if (res.task?.task_id) {
        await window.api._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: 'TASKS/tasks_registry.json',
            fieldPath: `tasks.${res.task.task_id}.schedule`,
            newValue: schedule,
            reason: 'scheduler UI'
          })
        });
      }
      status.textContent = 'Scheduled';
      status.className = 'agent-form-status success';
      await this._refresh();
      this.modal.querySelector('#sch-title').value = '';
      this.modal.querySelector('#sch-desc').value = '';
    } catch (err) {
      status.textContent = 'Failed: ' + err.message;
      status.className = 'agent-form-status error';
    }
  },
  
  async cancel(taskId) {
    if (!await SquidModal.confirm('Remove this scheduled task?')) return;
    try {
      await window.api._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'TASKS/tasks_registry.json',
          fieldPath: `tasks.${taskId}.lifecycle.status`,
          newValue: 'cancelled',
          reason: 'cancelled scheduled task'
        })
      });
      await this._refresh();
    } catch (err) { await SquidModal.alert('Cancel failed: ' + err.message); }
  },
  
  close() { if (this.modal) this.modal.classList.add('hidden'); },
  
  _esc(s) { return String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]); }
};

// Update scheduler count in right panel
async function updateSchedulerCount() {
  const el = document.getElementById('scheduler-count');
  if (!el) return;
  try {
    const r = await window.api._fetch('/tasks');
    const count = Object.values(r.registry.tasks || {}).filter(t => t.schedule && !['cancelled','completed','done'].includes(t.lifecycle?.status)).length;
    el.textContent = count;
  } catch {}
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { setTimeout(updateSchedulerCount, 1500); setInterval(updateSchedulerCount, 10000); });
} else { setTimeout(updateSchedulerCount, 1500); setInterval(updateSchedulerCount, 10000); }

window.Scheduler = Scheduler;
console.log('[OK] Scheduler loaded');
