/**
 * TempleInterior v4 — Project workspace cockpit
 * Design: SquidMind ocean palette + Press Start 2P + Courier New
 * No emojis, no browser popups — pure SquidModal + pixel.css tokens
 */

const TempleInterior = {
  currentTemple:   null,
  _openFiles:      [],
  _activeFileIdx:  -1,
  _leftTab:        'files',
  _rightTab:       'kanban',
  _pollTimer:      null,
  _rafMap:         {},
  _dragTaskId:     null,

  // ═══ OPEN / CLOSE ════════════════════════════════════════════════════════
  open(temple) {
    this.currentTemple   = temple;
    this._openFiles      = [];
    this._activeFileIdx  = -1;
    this._leftTab        = 'files';
    this._rightTab       = 'kanban';
    Object.values(this._rafMap).forEach(id => cancelAnimationFrame(id));
    this._rafMap = {};
    clearInterval(this._pollTimer);

    let root = document.getElementById('temple-interior');
    if (!root) {
      root = document.createElement('div');
      root.id = 'temple-interior';
      document.body.appendChild(root);
    }
    root.className = 'temple-interior';
    root.style.display = '';
    root.innerHTML = this._buildShell(temple);

    this._switchLeft('files');
    this._switchRight('kanban');
    this._renderHeader();
    // Apply temple accent color from project appearance
    this._applyTempleColor(temple);
    // Render always-visible agents section
    const agentSection = document.getElementById('ti-agents-always');
    if (agentSection) this._renderAgentsCompact(agentSection);

    this._pollTimer = setInterval(() => {
      this._renderHeader();
      this._renderKanban();
      const agSec = document.getElementById('ti-agents-always');
      if (agSec) this._renderAgentsCompact(agSec);
    }, 5000);
  },

  close() {
    clearInterval(this._pollTimer);
    Object.values(this._rafMap).forEach(id => cancelAnimationFrame(id));
    this._rafMap = {};
    const root = document.getElementById('temple-interior');
    if (root) { root.style.display = 'none'; }
  },

  // ═══ SHELL ═══════════════════════════════════════════════════════════════
  _buildShell(temple) {
    const name = this._esc(temple.name || 'PROJECT');
    const pid  = this._esc(temple.project_id || '');
    return `
<div class="ti-header">
  <span class="ti-header-title">${name}</span>
  <span style="font-family:'Courier New',monospace;font-size:9px;color:var(--ui-muted);margin-left:8px;">${pid}</span>
  <span class="ti-header-stat" id="ti-hdr-stat">...</span>
  <span class="ti-header-sep"></span>
  <button class="ti-hbtn ti-hbtn-accent" onclick="TempleInterior._askPoseidon()">ASK POSEIDON</button>
  <button class="ti-hbtn" onclick="TempleInterior._newTaskModal()">+ TASK</button>
  <button class="ti-hbtn" onclick="TempleInterior._refreshAll()">REFRESH</button>
  <button class="ti-hbtn ti-hbtn-danger" onclick="TempleInterior.close()">CLOSE X</button>
</div>
<div class="ti-body">

  <div class="ti-left">
    <!-- FILES tab with AGENTS always visible below, MEMORY tab -->
    <div class="ti-tabs">
      <button class="ti-tab" id="ti-lt-files"   onclick="TempleInterior._switchLeft('files')">FILES</button>
      <button class="ti-tab" id="ti-lt-memory"  onclick="TempleInterior._switchLeft('memory')">MEMORY</button>
    </div>
    <!-- Files or Memory content (top 38%) -->
    <div id="ti-left-body" style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;max-height:38%;"></div>
    <!-- Agents — always visible (bottom 62%) -->
    <div style="border-top:2px solid var(--border);flex-shrink:0;display:flex;flex-direction:column;height:62%;min-height:0;overflow:hidden;">
      <div class="ti-sec" style="flex-shrink:0;">AGENTS</div>
      <div id="ti-agents-always" style="flex:1;overflow:hidden;display:flex;flex-direction:column;"></div>
    </div>
  </div>

  <div class="ti-center">
    <div class="ti-ide-wrap" id="ti-ide-root">
      <div class="ti-ide-tabbar" id="ti-ide-tabbar">
        <span class="ti-ide-notabs" id="ti-ide-notabs">OPEN A FILE FROM THE FILES PANEL</span>
      </div>
      <div class="ti-ide-toolbar">
        <span class="ti-ide-fname" id="ti-ide-fname">—</span>
        <button class="ti-tab-sm accent" onclick="TempleInterior._ideSave()">SAVE</button>
        <button class="ti-tab-sm" onclick="TempleInterior._ideTogglePreview()" id="ti-prev-toggle" style="display:none;">PREVIEW</button>
      </div>
      <div class="ti-ide-main">
        <textarea id="ti-editor" class="ti-editor"
          placeholder="Open a file to start editing..."
          oninput="TempleInterior._ideMarkDirty()" spellcheck="false"></textarea>
        <iframe id="ti-preview-frame" class="ti-preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>
      </div>
      <div class="ti-ide-status" id="ti-ide-status">READY</div>
    </div>
  </div>

  <div class="ti-right">
    <div class="ti-tabs">
      <button class="ti-tab active" id="ti-rt-kanban">KANBAN</button>
    </div>
    <div id="ti-right-body" style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;"></div>
  </div>

</div>`;
  },

  // ═══ HEADER STATS ════════════════════════════════════════════════════════
  async _renderHeader() {
    const el = document.getElementById('ti-hdr-stat');
    if (!el) return;
    try {
      const [tr, wr] = await Promise.all([
        window.ApiV2._fetch('/tasks').catch(() => ({ registry: { tasks: {} } })),
        window.ApiV2._fetch('/agents/pool/status').catch(() => ({ workers: {} }))
      ]);
      const tasks  = this._filterProjectTasks(Object.values(tr.registry?.tasks || {}));
      const open   = tasks.filter(t => !['completed','failed','cancelled','archived'].includes(t.lifecycle?.status || t.status)).length;
      const done   = tasks.filter(t => t.lifecycle?.status === 'completed' || t.status === 'completed').length;
      const active = Object.values(wr.workers || {}).filter(w => w.status === 'running').length;
      el.innerHTML = `<b>${open}</b> open · <b>${done}</b> done · <b>${active}</b> running`;
    } catch {}
  },

  // ═══ TAB SWITCHING ═══════════════════════════════════════════════════════
  _switchLeft(tab) {
    this._leftTab = tab;
    ['files','memory'].forEach(t => {
      document.getElementById(`ti-lt-${t}`)?.classList.toggle('active', t === tab);
    });
    const body = document.getElementById('ti-left-body');
    if (body) {
      if (tab === 'files')  this._renderFiles(body);
      if (tab === 'memory') this._renderMemory(body);
    }
    // Agents section is always rendered
    const agentSection = document.getElementById('ti-agents-always');
    if (agentSection) this._renderAgentsCompact(agentSection);
  },

  _switchRight(_tab) {
    this._rightTab = 'kanban';
    const body = document.getElementById('ti-right-body');
    if (body) this._renderKanban(body);
  },

  _refreshAll() {
    this._renderHeader();
    this._switchLeft(this._leftTab);
    this._renderKanban();
    const agSec = document.getElementById('ti-agents-always');
    if (agSec) this._renderAgentsCompact(agSec);
  },

  // ═══ TEMPLE COLOR ════════════════════════════════════════════════════════
  _applyTempleColor(temple) {
    const root = document.getElementById('temple-interior');
    if (!root) return;
    const inside  = temple?.colors?.inside  || temple?.color || null;
    const outside = temple?.colors?.outside || null;
    if (inside) {
      root.style.setProperty('--ti-temple-color', inside);
      root.style.background = `linear-gradient(160deg, ${inside}25 0%, var(--ocean-deep) 45%)`;
      const left = root.querySelector('.ti-left');
      if (left) left.style.background = `${inside}14`;
    }
    if (outside) {
      root.style.borderTop = `4px solid ${outside}`;
      const hdr = root.querySelector('.ti-header');
      if (hdr) hdr.style.borderBottom = `2px solid ${outside}`;
    }
  },

  // ═══ AGENTS (always-visible compact section) ═════════════════════════════
  async _renderAgentsCompact(container) {
    if (!container) return;

    let assignedIds = [], regAgents = {}, workers = {};
    try {
      const pr = await window.ApiV2._fetch('/projects');
      const proj = Object.values(pr.registry.projects || {}).find(p =>
        p.project_id === this.currentTemple?.project_id || p.name === this.currentTemple?.name
      );
      assignedIds = proj?.assigned_agents || [];
    } catch {}
    try { regAgents = (await window.ApiV2._fetch('/agents')).registry.agents || {}; } catch {}
    try { workers   = (await window.ApiV2._fetch('/agents/pool/status')).workers || {}; } catch {}

    const agents = assignedIds.map(id => regAgents[id]).filter(Boolean);

    // Arena + compact list
    container.innerHTML = `
<div id="ti-arena-always" style="position:relative;overflow:hidden;height:80px;background:radial-gradient(ellipse at center,rgba(79,172,254,0.04),transparent 70%);border-bottom:1px solid var(--border);flex-shrink:0;"></div>
<div style="flex:1;overflow-y:auto;">
  ${agents.length === 0
    ? '<p class="ti-empty" style="font-size:8px;">No agents assigned</p>'
    : agents.map(a => {
        const w     = workers[a.agent_id] || {};
        const isRun = w.status === 'running';
        return `<div class="ti-agent-row ${isRun ? 'running' : ''}">
          <div class="ti-agent-dot ${isRun ? 'run' : 'idle'}"></div>
          <div style="flex:1;min-width:0;">
            <div class="ti-agent-name">${this._esc(a.display_name || a.agent_id)}</div>
            <div class="ti-agent-spec">${this._esc(a.specialization || '')}</div>
          </div>
          <span class="ti-agent-badge ${isRun ? 'run' : 'idle'}">${isRun ? 'RUN' : 'IDLE'}</span>
          <button class="ti-sec-btn" onclick="TempleInterior._dispatchAgent('${a.agent_id}')" style="font-size:6px;padding:2px 5px;">SEND</button>
          <button class="ti-sec-btn" onclick="TempleInterior.unassignSquid('${a.agent_id}')" style="font-size:6px;padding:2px 5px;border-color:var(--danger);color:var(--danger);">OUT</button>
        </div>`;
      }).join('')}
</div>
<div style="padding:5px;border-top:1px solid var(--border);flex-shrink:0;">
  <button class="ti-sec-btn" style="width:100%;text-align:center;" onclick="TempleInterior._showAssigner()">ASSIGN AGENT</button>
</div>`;

    // Spawn walkers in arena
    const arena = container.querySelector('#ti-arena-always');
    if (arena && agents.length > 0) {
      setTimeout(() => {
        const W = arena.clientWidth || 260, H = arena.clientHeight || 80;
        agents.forEach(a => {
          const squid = (window.aquarium?.squids || []).find(s => (s.agent_id || s.id) === a.agent_id)
            || { id: a.agent_id, name: a.display_name || a.agent_id, appearance: a.appearance || {} };
          const walker = document.createElement('div');
          walker.className = 'ti-walker';
          const cvs = document.createElement('canvas');
          cvs.width = 40; cvs.height = 44;
          const lbl = document.createElement('div');
          lbl.className = 'ti-walker-name';
          lbl.textContent = (a.display_name || a.agent_id).slice(0, 8).toUpperCase();
          walker.appendChild(cvs); walker.appendChild(lbl);
          arena.appendChild(walker);
          this._animateSquid(walker, cvs, squid, W, H);
        });
      }, 60);
    }
  },

  // ═══ FILES TAB ═══════════════════════════════════════════════════════════
  _renderFiles(container) {
    const c = container || document.getElementById('ti-left-body');
    if (!c) return;
    const folder = this._folder();
    c.innerHTML = `
<div class="ti-sec">INPUT FILES
  <label class="ti-sec-btn" style="cursor:pointer;">
    + ADD
    <input type="file" multiple style="display:none" onchange="TempleInterior._handleUpload(event,'${folder}','input')">
  </label>
</div>
<div id="ti-input-list" style="overflow-y:auto;max-height:38%;min-height:48px;">
  <div class="ti-dropzone" id="ti-drop-input"
    ondragover="event.preventDefault();this.classList.add('drag-over')"
    ondragleave="this.classList.remove('drag-over')"
    ondrop="TempleInterior._handleDrop(event,'${folder}','input')"
    onclick="this.nextElementSibling.click()">
    DROP FILES HERE OR CLICK
  </div>
  <input type="file" multiple style="display:none" onchange="TempleInterior._handleUpload(event,'${folder}','input')">
</div>
<div class="ti-sec" style="margin-top:6px;">OUTPUT FILES</div>
<div id="ti-output-list" class="ti-scroll" style="flex:1;min-height:48px;"></div>`;
    this._loadFileList(folder, 'input',  document.getElementById('ti-input-list'));
    this._loadFileList(folder, 'output', document.getElementById('ti-output-list'));
  },

  async _loadFileList(folder, type, container) {
    if (!container) return;
    try {
      const ep   = type === 'input' ? 'inputs' : 'outputs';
      const res  = await fetch(`/api/v2/projects/${folder}/${ep}`);
      const data = await res.json();
      const files = data.files || [];
      if (files.length === 0) {
        if (type === 'output') container.innerHTML = `<p class="ti-empty">No output files yet</p>`;
        return;
      }
      const html = files.map(f => {
        const isImg = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name);
        const thumb = isImg
          ? `<img class="ti-file-thumb" src="/api/v2/projects/${folder}/${ep}/${encodeURIComponent(f.name)}" onerror="this.style.display='none'">`
          : `<span class="ti-file-icon">${this._ficon(f.name)}</span>`;
        const ename = this._esc(f.name);
        const sz    = f.size ? `<span class="ti-file-size">${this._fmtSize(f.size)}</span>` : '';
        return `<div class="ti-file" onclick="TempleInterior._openFile('${ename}','${this._esc(f.path||'')}','${type}','${folder}')">
          ${thumb}
          <span class="ti-file-name" title="${ename}">${ename}</span>${sz}
          <button class="ti-file-del" onclick="event.stopPropagation();TempleInterior._deleteFile('${folder}','${ename}','${type}')">X</button>
        </div>`;
      }).join('');
      // Insert after drop zone for input type
      if (type === 'input') {
        let fl = container.querySelector('.ti-files-list');
        if (!fl) { fl = document.createElement('div'); fl.className = 'ti-files-list'; container.appendChild(fl); }
        fl.innerHTML = html;
      } else {
        container.innerHTML = html;
      }
    } catch (e) {
      container.innerHTML = `<p class="ti-empty" style="color:var(--danger)">${this._esc(e.message)}</p>`;
    }
  },

  async _handleUpload(event, folder, type) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    this._setStatus(`Uploading ${files.length} file(s)...`);
    await this._uploadFiles(folder, files, type);
    this._setStatus(`Uploaded ${files.length} file(s)`);
    this._loadFileList(folder, type, document.getElementById(type === 'input' ? 'ti-input-list' : 'ti-output-list'));
  },

  async _handleDrop(event, folder, type) {
    event.preventDefault();
    event.target.classList.remove('drag-over');
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    await this._uploadFiles(folder, files, type);
    this._loadFileList(folder, type, document.getElementById(type === 'input' ? 'ti-input-list' : 'ti-output-list'));
  },

  async _uploadFiles(folder, files, type) {
    const ep = type === 'input' ? 'inputs' : 'outputs';
    for (const file of files) {
      try {
        const isText = /\.(txt|md|json|csv|js|ts|py|html|css|xml|yaml|yml|sh|c|cpp|h|java|rs|go|rb|php|jsx|tsx|vue|svg)$/i.test(file.name);
        let content, encoding;
        if (isText || file.type.startsWith('text/')) {
          content = await file.text(); encoding = 'utf8';
        } else {
          content = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result.split(',')[1]);
            r.onerror = rej;
            r.readAsDataURL(file);
          });
          encoding = 'base64';
        }
        await fetch(`/api/v2/projects/${folder}/${ep}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, content, encoding })
        });
      } catch (e) { console.warn('[Temple] upload failed:', file.name, e.message); }
    }
  },

  async _deleteFile(folder, fileName, type) {
    const ok = await SquidModal.confirm(`Delete "${fileName}"?`);
    if (!ok) return;
    const ep = type === 'input' ? 'inputs' : 'outputs';
    await fetch(`/api/v2/projects/${folder}/${ep}/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
    this._loadFileList(folder, type, document.getElementById(type === 'input' ? 'ti-input-list' : 'ti-output-list'));
  },

  async _createNewFile(folder) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.zIndex = '20001';
    modal.innerHTML = `<div class="modal-content" style="width:360px;">
      <div class="modal-header"><h2>NEW FILE</h2>
        <button class="btn-close" onclick="this.closest('.modal').remove()">x</button></div>
      <div class="modal-body">
        <div class="agent-form-row"><label>File name</label>
          <input id="nf-name" type="text" placeholder="e.g. notes.md, script.py"></div>
      </div>
      <div class="agent-form-footer">
        <button class="btn-secondary" onclick="this.closest('.modal').remove()">CANCEL</button>
        <button class="btn-primary" onclick="TempleInterior._createFileDo('${folder}',this.closest('.modal'))">CREATE</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => modal.querySelector('#nf-name')?.focus(), 40);
  },

  async _createFileDo(folder, modal) {
    const name = modal.querySelector('#nf-name')?.value.trim();
    if (!name) { await SquidModal.alert('File name is required'); return; }
    modal.remove();
    await fetch(`/api/v2/projects/${folder}/inputs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: name, content: '', encoding: 'utf8' })
    });
    this._loadFileList(folder, 'input', document.getElementById('ti-input-list'));
    this._openFile(name, '', 'input', folder);
  },

  // ═══ AGENTS TAB ══════════════════════════════════════════════════════════
  async _renderAgents(container) {
    const c = container || (this._leftTab === 'agents' ? document.getElementById('ti-left-body') : null);
    if (!c) return;

    let assignedIds = [], regAgents = {}, workers = {};
    try {
      const pr = await window.ApiV2._fetch('/projects');
      const proj = Object.values(pr.registry.projects || {}).find(p =>
        p.project_id === this.currentTemple?.project_id || p.name === this.currentTemple?.name
      );
      assignedIds = proj?.assigned_agents || [];
    } catch {}
    try { regAgents = (await window.ApiV2._fetch('/agents')).registry.agents || {}; } catch {}
    try { workers   = (await window.ApiV2._fetch('/agents/pool/status')).workers || {}; } catch {}

    const agents = assignedIds.map(id => regAgents[id]).filter(Boolean);

    c.innerHTML = `
<div class="ti-arena" id="ti-arena"></div>
<div style="flex:1;overflow-y:auto;">
  ${agents.length === 0
    ? `<p class="ti-empty">No agents assigned to this project.<br>Click ASSIGN below to add one.</p>`
    : agents.map(a => {
        const w    = workers[a.agent_id] || {};
        const isRun = w.status === 'running';
        return `<div class="ti-agent-row ${isRun ? 'running' : ''}">
          <div class="ti-agent-dot ${isRun ? 'run' : 'idle'}"></div>
          <div style="flex:1;min-width:0;">
            <div class="ti-agent-name">${this._esc(a.display_name || a.agent_id)}</div>
            <div class="ti-agent-spec">${this._esc(a.specialization || 'general')}</div>
          </div>
          <span class="ti-agent-badge ${isRun ? 'run' : 'idle'}">${isRun ? 'RUNNING' : 'IDLE'}</span>
          <button class="ti-sec-btn" onclick="TempleInterior._dispatchAgent('${a.agent_id}')" style="font-size:6px;padding:3px 6px;">SEND</button>
          <button class="ti-sec-btn" onclick="window.AgentForm?.open('${a.agent_id}')" style="font-size:6px;padding:3px 6px;">EDIT</button>
          <button class="ti-sec-btn" onclick="TempleInterior.unassignSquid('${a.agent_id}')" style="font-size:6px;padding:3px 6px;border-color:var(--danger);color:var(--danger);">OUT</button>
        </div>`;
      }).join('')}
</div>
<div style="padding:7px;border-top:2px solid var(--border);flex-shrink:0;">
  <button class="ti-hbtn" style="width:100%;text-align:center;justify-content:center;" onclick="TempleInterior._showAssigner()">ASSIGN AGENT</button>
</div>`;

    // Squid arena
    const arena = document.getElementById('ti-arena');
    if (arena && agents.length > 0) {
      setTimeout(() => {
        const W = arena.clientWidth || 280, H = arena.clientHeight || 100;
        agents.forEach(a => {
          const squid = (window.aquarium?.squids || []).find(s => (s.agent_id || s.id) === a.agent_id)
            || { id: a.agent_id, name: a.display_name || a.agent_id, appearance: a.appearance || {} };
          const walker = document.createElement('div');
          walker.className = 'ti-walker';
          const cvs = document.createElement('canvas');
          cvs.width = 44; cvs.height = 48;
          const lbl = document.createElement('div');
          lbl.className = 'ti-walker-name';
          lbl.textContent = (a.display_name || a.agent_id).slice(0, 8).toUpperCase();
          walker.appendChild(cvs); walker.appendChild(lbl);
          arena.appendChild(walker);
          this._animateSquid(walker, cvs, squid, W, H);
        });
      }, 80);
    }
  },

  async _dispatchAgent(agentId) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.zIndex = '20001';
    modal.innerHTML = `<div class="modal-content" style="width:420px;">
      <div class="modal-header"><h2>DISPATCH TASK</h2>
        <button class="btn-close" onclick="this.closest('.modal').remove()">x</button></div>
      <div class="modal-body">
        <div class="agent-form-row"><label>Task instructions</label>
          <textarea id="disp-msg" rows="4" placeholder="Describe what the agent should do..."></textarea></div>
      </div>
      <div class="agent-form-footer">
        <button class="btn-secondary" onclick="this.closest('.modal').remove()">CANCEL</button>
        <button class="btn-primary" onclick="TempleInterior._dispatchDo('${agentId}',this.closest('.modal'))">DISPATCH</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => modal.querySelector('#disp-msg')?.focus(), 40);
  },

  async _dispatchDo(agentId, modal) {
    const msg = modal.querySelector('#disp-msg')?.value.trim();
    if (!msg) { await SquidModal.alert('Task description is required'); return; }
    modal.remove();
    const pid = this.currentTemple?.project_id;
    const pname = this.currentTemple?.name;
    try {
      const res = await window.ApiV2._fetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: msg.slice(0, 80),
          description: msg,
          project_id: pid,
          project_name: pname,
          assigned_to: agentId
        })
      });
      await SquidModal.alert(`Task created — agent will pick it up automatically`);
      if (this._rightTab === 'kanban') this._renderKanban();
      if (this._rightTab === 'tasks')  this._renderTasks();
      this._renderHeader();
    } catch (e) { await SquidModal.alert(`Failed: ${e.message}`); }
  },

  async _showAssigner() {
    let regAgents = {}, assignedIds = [];
    try { regAgents = (await window.ApiV2._fetch('/agents')).registry.agents || {}; } catch {}
    try {
      const pr = await window.ApiV2._fetch('/projects');
      const proj = Object.values(pr.registry.projects || {}).find(p =>
        p.project_id === this.currentTemple?.project_id || p.name === this.currentTemple?.name
      );
      assignedIds = proj?.assigned_agents || [];
    } catch {}

    const all = Object.values(regAgents);
    if (!all.length) { await SquidModal.alert('No agents in registry. Create one first.'); return; }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.zIndex = '20001';
    modal.innerHTML = `<div class="modal-content" style="width:380px;">
      <div class="modal-header"><h2>ASSIGN AGENT — ${this._esc(this.currentTemple?.name || '')}</h2>
        <button class="btn-close" onclick="this.closest('.modal').remove()">x</button></div>
      <div class="modal-body" style="display:flex;flex-direction:column;gap:5px;">
        ${all.map(a => {
          const here = assignedIds.includes(a.agent_id);
          return `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--ui-surface);border-left:3px solid ${here ? 'var(--success)' : 'transparent'};">
            <span style="flex:1;font-family:'Press Start 2P',monospace;font-size:8px;color:var(--text-primary);">${this._esc(a.display_name || a.agent_id)}<br><span style="font-family:'Courier New',monospace;font-size:9px;color:var(--ui-muted);">${this._esc(a.specialization||'')}</span></span>
            ${here
              ? `<button class="btn-secondary" style="font-size:8px;padding:5px 10px;border-color:var(--danger);color:var(--danger);" onclick="TempleInterior.unassignSquid('${a.agent_id}');this.closest('.modal').remove()">REMOVE</button>`
              : `<button class="btn-primary" style="font-size:8px;padding:5px 10px;" onclick="TempleInterior.assignSquid('${a.agent_id}');this.closest('.modal').remove()">ASSIGN</button>`
            }
          </div>`;
        }).join('')}
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  },

  // ═══ MEMORY TAB ══════════════════════════════════════════════════════════
  async _renderMemory(container) {
    const c = container || document.getElementById('ti-left-body');
    if (!c) return;
    const folder = this._folder();
    c.innerHTML = `
<div class="ti-sec">PROJECT MEMORY
  <button class="ti-sec-btn" onclick="TempleInterior._saveMemory('${folder}')">SAVE</button>
</div>
<div style="flex:1;display:flex;flex-direction:column;padding:6px;min-height:0;gap:5px;">
  <textarea id="ti-mem-editor" class="ti-mem" placeholder="Loading..."></textarea>
  <p class="ti-mem-hint">Shared context for all agents. JSON or free text. Persisted to project_memory.json.</p>
</div>`;
    try {
      const res  = await fetch(`/api/files/read?path=${encodeURIComponent(`PROJECTS/${folder}/project_memory.json`)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const ed   = document.getElementById('ti-mem-editor');
      if (ed) ed.value = typeof data.content === 'string' ? data.content : JSON.stringify(data.content || {}, null, 2);
    } catch {
      const ed = document.getElementById('ti-mem-editor');
      if (ed) ed.value = JSON.stringify({
        project: this.currentTemple?.name || '',
        notes: '',
        goals: [],
        key_decisions: [],
        sources: []
      }, null, 2);
    }
  },

  async _saveMemory(folder) {
    const ed = document.getElementById('ti-mem-editor');
    if (!ed) return;
    await fetch(`/api/v2/projects/${folder}/inputs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'project_memory.json', content: ed.value, encoding: 'utf8' })
    });
    this._setStatus('Memory saved');
  },

  // ═══ KANBAN ══════════════════════════════════════════════════════════════
  async _renderKanban(container) {
    const c = container || (this._rightTab === 'kanban' ? document.getElementById('ti-right-body') : null);
    if (!c) return;

    let tasks = [];
    try {
      const r = await window.ApiV2._fetch('/tasks');
      tasks = this._filterProjectTasks(Object.values(r.registry?.tasks || {}));
    } catch {}

    const cols = {
      todo: tasks.filter(t => ['open','planned','queued'].includes(t.lifecycle?.status || t.status || 'open')),
      prog: tasks.filter(t => (t.lifecycle?.status || t.status) === 'in_progress'),
      done: tasks.filter(t => ['completed','failed','cancelled'].includes(t.lifecycle?.status || t.status))
    };

    const makeCard = (task) => {
      const status = task.lifecycle?.status || task.status || 'open';
      const isRun  = status === 'in_progress';
      const isFail = status === 'failed' || status === 'cancelled';
      const isDone = status === 'completed';
      const cls    = isRun ? 'prog' : isDone ? 'done' : isFail ? 'fail' : '';
      const agent  = task.assignment?.assigned_name || task.assignment?.assigned_to || '';
      const prog   = task.progress ? `<div class="ti-kcard-prog">&gt; ${this._esc(String(task.progress).slice(0,60))}</div>` : '';
      const bar    = isRun ? `<div class="ti-kcard-bar"><div class="ti-kcard-bar-fill"></div></div>` : '';
      return `<div class="ti-kcard ${cls}" draggable="true" data-task-id="${task.task_id}"
          ondragstart="TempleInterior._kDragStart(event)"
          ondragover="event.preventDefault();event.currentTarget.classList.add('drag-over')"
          ondragleave="event.currentTarget.classList.remove('drag-over')"
          onclick="TempleInterior._openTaskDetail('${task.task_id}')">
        <div class="ti-kcard-title">${this._esc(task.title)}</div>
        ${prog}${bar}
        <div class="ti-kcard-foot">
          <span class="ti-kcard-agent">${agent ? '&gt; ' + this._esc(agent.slice(0,16)) : ''}</span>
          <button class="ti-kcard-del" onclick="event.stopPropagation();TempleInterior._deleteTask('${task.task_id}')">X</button>
        </div>
      </div>`;
    };

    const colDefs = [
      { key: 'todo', label: 'TODO',     cls: 'todo', drop: 'open' },
      { key: 'prog', label: 'PROGRESS', cls: 'prog', drop: 'in_progress' },
      { key: 'done', label: 'DONE',     cls: 'done', drop: 'completed' }
    ];

    c.innerHTML = `
<div class="ti-kanban-wrap">
  <div class="ti-kanban-hdr">
    <span>${tasks.length} TASK${tasks.length !== 1 ? 'S' : ''}</span>
  </div>
  <div class="ti-kanban-board">
    ${colDefs.map(col => `
    <div class="ti-kcol" id="ti-kcol-${col.key}"
      ondragover="event.preventDefault();event.currentTarget.classList.add('drag-over')"
      ondragleave="event.currentTarget.classList.remove('drag-over')"
      ondrop="TempleInterior._kDrop(event,'${col.drop}')">
      <div class="ti-kcol-head ${col.cls}">
        <span>${col.label}</span>
        <span class="ti-kcol-count">${(cols[col.key] || []).length}</span>
      </div>
      <div class="ti-kcards">
        ${(cols[col.key] || []).length
          ? (cols[col.key] || []).map(makeCard).join('')
          : `<p class="ti-empty" style="padding:8px 6px;font-size:8px;">DROP HERE</p>`}
      </div>
    </div>`).join('')}
  </div>
</div>`;
  },

  _kDragStart(event) {
    const id = event.currentTarget.dataset.taskId;
    this._dragTaskId = id;
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    setTimeout(() => event.currentTarget.classList.add('dragging'), 0);
  },

  async _kDrop(event, newStatus) {
    event.preventDefault();
    document.querySelectorAll('.ti-kcol').forEach(c => c.classList.remove('drag-over'));
    const taskId = event.dataTransfer.getData('text/plain') || this._dragTaskId;
    this._dragTaskId = null;
    if (!taskId) return;
    try {
      await window.ApiV2._fetch(`/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
    } catch (e) { console.warn('[Kanban] drop status update failed:', e.message); }
    this._renderKanban();
  },

  // ═══ TASKS LIST ══════════════════════════════════════════════════════════
  async _renderTasks(container) {
    const c = container || (this._rightTab === 'tasks' ? document.getElementById('ti-right-body') : null);
    if (!c) return;

    let tasks = [];
    try {
      const r = await window.ApiV2._fetch('/tasks');
      tasks = this._filterProjectTasks(Object.values(r.registry?.tasks || {}))
        .sort((a, b) => {
          const rank = s => ({'in_progress':0,'planned':1,'open':2,'queued':2})[s] ?? 3;
          return rank(a.lifecycle?.status||a.status) - rank(b.lifecycle?.status||b.status);
        });
    } catch {}

    const sIcon  = { in_progress:'>', completed:'+', failed:'!', cancelled:'-', planned:'~', open:'~', queued:'~' };
    const sColor = { in_progress:'var(--ui-accent)', completed:'var(--success)', failed:'var(--danger)', cancelled:'var(--ui-muted)', planned:'var(--warning)', open:'var(--ui-muted)' };

    c.innerHTML = `
<div class="ti-tasklist" style="flex:1;overflow-y:auto;">
  ${tasks.length === 0
    ? '<p class="ti-empty">No tasks for this project yet.<br>Click + TASK to create one.</p>'
    : tasks.map(task => {
        const status = task.lifecycle?.status || task.status || 'open';
        const isRun  = status === 'in_progress';
        const agent  = task.assignment?.assigned_name || task.assignment?.assigned_to || '';
        const prog   = task.progress ? `<div class="ti-taskrow-sub">&gt; ${this._esc(String(task.progress).slice(0,90))}</div>` : '';
        const bar    = isRun ? `<div class="ti-task-bar"><div class="ti-task-bar-fill"></div></div>` : '';
        const aline  = agent ? `<div class="ti-taskrow-sub" style="color:var(--ui-accent);">&gt; ${this._esc(agent)}</div>` : '';
        return `<div class="ti-taskrow" onclick="TempleInterior._openTaskDetail('${task.task_id}')">
          <span class="ti-taskrow-ico" style="color:${sColor[status]||'var(--ui-muted)'};">[${sIcon[status]||'~'}]</span>
          <div class="ti-taskrow-info">
            <div class="ti-taskrow-title">${this._esc(task.title)}</div>
            ${prog}${aline}${bar}
          </div>
          <button class="ti-taskrow-del" onclick="event.stopPropagation();TempleInterior._deleteTask('${task.task_id}')">X</button>
        </div>`;
      }).join('')}
</div>
<div class="ti-quickadd">
  <input id="ti-qadd" type="text" placeholder="QUICK ADD TASK... (ENTER)"
    onkeydown="if(event.key==='Enter')TempleInterior._quickAdd(this.value)">
</div>`;
  },

  async _quickAdd(title) {
    if (!title?.trim()) return;
    document.getElementById('ti-qadd').value = '';
    await window.ApiV2._fetch('/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), project_id: this.currentTemple?.project_id, project_name: this.currentTemple?.name })
    });
    this._renderTasks(); this._renderKanban(); this._renderHeader();
  },

  // ═══ NEW TASK MODAL (full cron + agent + priority) ════════════════════════
  async _newTaskModal() {
    const pid   = this.currentTemple?.project_id;
    const pname = this.currentTemple?.name;
    let agents = [];
    try { agents = Object.values((await window.ApiV2._fetch('/agents')).registry.agents || {}); } catch {}

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.style.zIndex = '20001';
    modal.innerHTML = `<div class="modal-content" style="width:520px;">
      <div class="modal-header"><h2>NEW TASK — ${this._esc(pname||'')}</h2>
        <button class="btn-close" onclick="this.closest('.modal').remove()">x</button></div>
      <div class="modal-body">
        <div class="agent-form-row">
          <label>Title *</label>
          <input id="ntm-title" type="text" placeholder="What needs to be done?">
        </div>
        <div class="agent-form-row">
          <label>Description / Instructions</label>
          <textarea id="ntm-desc" rows="4" placeholder="Detailed instructions for the agent..."></textarea>
        </div>
        <div style="display:flex;gap:12px;">
          <div class="agent-form-row" style="flex:1;">
            <label>Assign to agent</label>
            <select id="ntm-agent">
              <option value="">— unassigned (Poseidon) —</option>
              ${agents.map(a => `<option value="${a.agent_id}">${this._esc(a.display_name||a.agent_id)}</option>`).join('')}
            </select>
          </div>
          <div class="agent-form-row" style="flex:1;">
            <label>Priority</label>
            <select id="ntm-priority">
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
              <option value="low">Low</option>
            </select>
          </div>
        </div>
        <div class="agent-form-section" style="margin-top:8px;">
          <h3>RECURRING SCHEDULE (CRON)</h3>
          <div style="display:flex;gap:12px;align-items:flex-end;">
            <div class="agent-form-row" style="flex:2;">
              <label>Cron expression <span style="font-size:8px;color:var(--ui-muted);">(leave empty for one-time)</span></label>
              <input id="ntm-cron" type="text" placeholder="e.g. 0 8 * * * — daily at 8am" style="font-family:'Courier New',monospace;">
            </div>
            <div class="agent-form-row" style="flex:1;">
              <label>Quick presets</label>
              <select id="ntm-cron-preset" onchange="document.getElementById('ntm-cron').value=this.value;this.value='';">
                <option value="">— select —</option>
                <option value="0 8 * * *">Daily at 8am</option>
                <option value="0 8 * * 1">Weekly Mon 8am</option>
                <option value="0 */4 * * *">Every 4 hours</option>
                <option value="0 9 1 * *">Monthly 1st</option>
                <option value="*/30 * * * *">Every 30 min</option>
              </select>
            </div>
          </div>
          <p style="font-family:'Courier New',monospace;font-size:9px;color:var(--ui-muted);margin-top:4px;">Format: minute hour day month weekday (0-6=Sun-Sat)</p>
        </div>
      </div>
      <div class="agent-form-footer">
        <button class="btn-secondary" onclick="this.closest('.modal').remove()">CANCEL</button>
        <button class="btn-primary" onclick="TempleInterior._createTask(this.closest('.modal'))">CREATE TASK</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => modal.querySelector('#ntm-title')?.focus(), 40);
  },

  async _createTask(modal) {
    const title = modal.querySelector('#ntm-title')?.value.trim();
    const desc  = modal.querySelector('#ntm-desc')?.value.trim();
    const agent = modal.querySelector('#ntm-agent')?.value || null;
    const cron  = modal.querySelector('#ntm-cron')?.value.trim() || null;
    if (!title) { await SquidModal.alert('Title is required'); return; }
    try {
      await window.ApiV2._fetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title, description: desc,
          project_id: this.currentTemple?.project_id,
          project_name: this.currentTemple?.name,
          assigned_to: agent || undefined,
          cron_schedule: cron || undefined
        })
      });
      modal.remove();
      this._renderKanban(); this._renderTasks(); this._renderHeader();
    } catch (e) { await SquidModal.alert(`Failed: ${e.message}`); }
  },

  async _openTaskDetail(taskId) {
    if (typeof TaskQueueUI !== 'undefined') TaskQueueUI.openTaskDetail(taskId);
  },

  async _deleteTask(taskId) {
    const ok = await SquidModal.confirm(`Delete task ${taskId}? This cannot be undone.`);
    if (!ok) return;
    await window.ApiV2._fetch(`/tasks/${taskId}`, { method: 'DELETE' });
    this._renderKanban(); this._renderTasks(); this._renderHeader();
  },

  // ═══ IDE ═════════════════════════════════════════════════════════════════
  _openFile(name, filepath, type, folder) {
    const existing = this._openFiles.findIndex(f => f.name === name && f.folder === folder);
    if (existing >= 0) { this._ideActivate(existing); return; }

    const isImg = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(name);
    if (isImg) {
      const url = `/api/v2/projects/${folder}/${type === 'input' ? 'inputs' : 'outputs'}/${encodeURIComponent(name)}`;
      this._openFiles.push({ name, path: filepath, folder, type, content: `[IMAGE: ${name}]`, imgUrl: url, isImg: true, dirty: false });
      this._ideActivate(this._openFiles.length - 1);
      const frame = document.getElementById('ti-preview-frame');
      if (frame) {
        frame.style.display = '';
        frame.srcdoc = `<html><body style="margin:0;background:#0a2239;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${url}" style="max-width:100%;max-height:100vh;"></body></html>`;
      }
      const ed = document.getElementById('ti-editor');
      if (ed) ed.style.display = 'none';
      return;
    }

    this._openFiles.push({ name, path: filepath, folder, type, content: '', dirty: false, loading: true });
    const idx = this._openFiles.length - 1;
    this._ideActivate(idx);
    this._setStatus(`Loading ${name}...`);

    (async () => {
      let content = '';
      try {
        if (filepath) {
          const d = await (await fetch('/api/files/read?path=' + encodeURIComponent(filepath))).json();
          content = typeof d.content === 'string' ? d.content : JSON.stringify(d.content || '', null, 2);
        } else {
          const ep = type === 'input' ? 'inputs' : 'outputs';
          content  = await (await fetch(`/api/v2/projects/${folder}/${ep}/${encodeURIComponent(name)}`)).text();
        }
      } catch (e) { content = `// Error loading: ${e.message}`; }
      const f = this._openFiles[idx];
      if (f) { f.content = content; f.loading = false; }
      if (this._activeFileIdx === idx) {
        const ed = document.getElementById('ti-editor');
        if (ed) ed.value = content;
        this._setStatus(`${name} — ${content.length} chars`);
      }
    })();
  },

  _ideActivate(idx) {
    if (idx < 0 || idx >= this._openFiles.length) return;
    const ed = document.getElementById('ti-editor');
    if (ed && this._activeFileIdx >= 0 && this._openFiles[this._activeFileIdx]) {
      this._openFiles[this._activeFileIdx].content = ed.value;
    }
    this._activeFileIdx = idx;
    const f = this._openFiles[idx];

    const frame = document.getElementById('ti-preview-frame');
    if (ed) ed.style.display = '';
    if (frame) frame.style.display = 'none';

    if (f.isImg) {
      if (ed) ed.style.display = 'none';
      if (frame) {
        frame.style.display = '';
        frame.srcdoc = `<html><body style="margin:0;background:#0a2239;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${f.imgUrl}" style="max-width:100%;max-height:100vh;"></body></html>`;
      }
    } else if (ed) {
      ed.value = f.loading ? 'Loading...' : (f.content || '');
    }

    const fnEl = document.getElementById('ti-ide-fname');
    if (fnEl) fnEl.textContent = f.name + (f.type ? ` [${f.type.toUpperCase()}]` : '');
    // Show PREVIEW button only for HTML files
    const prevBtn = document.getElementById('ti-prev-toggle');
    if (prevBtn) prevBtn.style.display = /\.html?$/i.test(f.name) ? '' : 'none';
    this._renderIdeTabs();
  },

  _renderIdeTabs() {
    const bar    = document.getElementById('ti-ide-tabbar');
    const noTabs = document.getElementById('ti-ide-notabs');
    if (!bar) return;
    bar.querySelectorAll('.ti-ide-filetab').forEach(t => t.remove());
    if (!this._openFiles.length) { if (noTabs) noTabs.style.display = ''; return; }
    if (noTabs) noTabs.style.display = 'none';
    this._openFiles.forEach((f, i) => {
      const btn = document.createElement('button');
      btn.className = `ti-ide-filetab${i === this._activeFileIdx ? ' active' : ''}${f.dirty ? ' dirty' : ''}`;
      btn.innerHTML = `${this._esc(f.name.slice(0,18))} <span class="ti-ide-tabclose" onclick="event.stopPropagation();TempleInterior._ideClose(${i})">x</span>`;
      btn.onclick = () => this._ideActivate(i);
      bar.appendChild(btn);
    });
  },

  _ideMarkDirty() {
    if (this._activeFileIdx < 0 || !this._openFiles[this._activeFileIdx]) return;
    this._openFiles[this._activeFileIdx].dirty = true;
    this._renderIdeTabs();
  },

  async _ideClose(idx) {
    const f = this._openFiles[idx];
    if (f?.dirty) {
      const ok = await SquidModal.confirm(`"${f.name}" has unsaved changes. Close anyway?`);
      if (!ok) return;
    }
    this._openFiles.splice(idx, 1);
    if (this._activeFileIdx >= this._openFiles.length) this._activeFileIdx = this._openFiles.length - 1;
    this._renderIdeTabs();
    if (this._activeFileIdx >= 0) this._ideActivate(this._activeFileIdx);
    else { const ed = document.getElementById('ti-editor'); if (ed) ed.value = ''; }
  },

  async _ideSave() {
    if (this._activeFileIdx < 0 || !this._openFiles[this._activeFileIdx]) return;
    const f  = this._openFiles[this._activeFileIdx];
    const ed = document.getElementById('ti-editor');
    if (ed) f.content = ed.value;
    const folder = f.folder || this._folder();
    const ep = f.type === 'output' ? 'outputs' : 'inputs';
    this._setStatus('Saving...');
    try {
      await fetch(`/api/v2/projects/${folder}/${ep}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: f.name, content: f.content, encoding: 'utf8' })
      });
      f.dirty = false;
      this._renderIdeTabs();
      this._setStatus(`Saved ${f.name}`);
    } catch (e) { this._setStatus(`Save failed: ${e.message}`); }
  },

  _ideNewFile() {
    this._createNewFile(this._folder());
  },

  _ideTogglePreview() {
    const frame = document.getElementById('ti-preview-frame');
    const ed    = document.getElementById('ti-editor');
    if (!frame) return;
    if (frame.style.display === 'none' || !frame.style.display) {
      const blob = new Blob([ed?.value || ''], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      frame.src = url;
      frame.style.display = '';
      frame.onload = () => { URL.revokeObjectURL(url); frame.onload = null; };
    } else {
      frame.style.display = 'none';
    }
  },

  _setStatus(msg) {
    const el = document.getElementById('ti-ide-status');
    if (el) el.textContent = msg.toUpperCase();
  },

  // ═══ ASK POSEIDON ════════════════════════════════════════════════════════
  _askPoseidon() {
    const name = this.currentTemple?.name || '';
    const pid  = this.currentTemple?.project_id || '';
    const chatIn = document.querySelector('#poseidon-input, .pc-input textarea, [data-poseidon-input]');
    if (chatIn) {
      chatIn.value = `About project "${name}" (${pid}): `;
      chatIn.focus();
      chatIn.dispatchEvent(new Event('input'));
    }
    const posTab = document.querySelector('[data-panel="poseidon"], .tab-btn[onclick*="poseidon"], [onclick*="PoseidonChat"]');
    if (posTab) posTab.click();
    this.close();
  },

  // ═══ SQUID ANIMATION ═════════════════════════════════════════════════════
  _animateSquid(walkerDiv, cvs, squid, cW, cH) {
    const sqid = squid.id || squid.agent_id || Math.random().toString(36).slice(2);
    if (this._rafMap[sqid]) cancelAnimationFrame(this._rafMap[sqid]);
    const ctx  = cvs.getContext('2d');
    const CW   = cvs.width, CH = cvs.height, size = 14;
    const app  = squid.appearance || {};
    const primary = app.primary_color || app.body_color || '#4facfe';
    const dk  = (hex, f) => { try { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgb(${Math.floor(r*f)},${Math.floor(g*f)},${Math.floor(b*f)})`; } catch { return hex; } };
    const br  = (hex, f) => { try { const r=Math.min(255,parseInt(hex.slice(1,3),16)*f),g=Math.min(255,parseInt(hex.slice(3,5),16)*f),b=Math.min(255,parseInt(hex.slice(5,7),16)*f); return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`; } catch { return hex; } };
    const mg  = size + 4;
    let px = mg + Math.random()*(cW-mg*2), py = mg + Math.random()*(cH-mg*2);
    let vx = (Math.random()-.5)*.8, vy = (Math.random()-.5)*.4;
    let frame = 0, idle = 0, nextIdle = 80 + Math.floor(Math.random()*100);
    const stride = 28;
    const loop = () => {
      frame++;
      if (idle > 0) { idle--; vx *= .87; vy *= .87; }
      else {
        nextIdle--;
        if (nextIdle <= 0) { idle = 40 + Math.floor(Math.random()*60); nextIdle = 90 + Math.floor(Math.random()*130); }
        vx += (Math.random()-.5)*.11; vy += (Math.random()-.5)*.07;
        vx *= .97; vy *= .97;
        const spd = Math.sqrt(vx*vx+vy*vy);
        if (spd > .85) { vx *= .85/spd; vy *= .85/spd; }
        if (spd < .12) { vx += (Math.random()-.5)*.28; vy += (Math.random()-.5)*.15; }
      }
      px += vx; py += vy;
      if (px < mg) { px = mg; vx = Math.abs(vx)*.7; }
      if (px > cW-mg) { px = cW-mg; vx = -Math.abs(vx)*.7; }
      if (py < mg) { py = mg; vy = Math.abs(vy)*.7; }
      if (py > cH-mg) { py = cH-mg; vy = -Math.abs(vy)*.7; }
      walkerDiv.style.left = (px-CW/2)+'px';
      walkerDiv.style.top  = (py-CH/2)+'px';
      const isIdle = idle > 0, fR = vx >= 0;
      const wp  = (frame/stride)*Math.PI*2;
      const bob = isIdle ? Math.sin(frame*.04)*1.2 : Math.sin(wp*2)*1.4;
      ctx.clearRect(0, 0, CW, CH);
      // Try using the real Squid class first
      if (typeof Squid !== 'undefined') {
        try {
          const sq = new Squid({ id:'__tw__', name:'', status:'idle', appearance:{...app}, x:CW/2, y:CH/2-2+bob });
          sq.animFrame = wp; sq.bobOffset = 0; sq.isDragging = true; sq.isSleeping = false;
          sq.isHovered = false; sq.alpha = 1; sq.insideTemple = null; sq.jumpHeight = 0;
          sq.heartParticles = []; sq._confetti = null; sq.baseSize = size/40;
          if (!fR) {
            ctx.save(); ctx.translate(CW,0); ctx.scale(-1,1); sq.x = CW - sq.x;
            sq.draw(ctx); ctx.restore();
          } else { sq.draw(ctx); }
          this._rafMap[sqid] = requestAnimationFrame(loop);
          return;
        } catch(e) {}
      }
      // Fallback: hand-drawn squid
      ctx.save(); ctx.translate(CW/2, CH/2-2+bob);
      if (!fR) ctx.scale(-1,1);
      const grad = ctx.createRadialGradient(-size*.15,-size*.2,0,0,0,size);
      grad.addColorStop(0, br(primary,1.25)); grad.addColorStop(.6, primary); grad.addColorStop(1, dk(primary,.75));
      ctx.fillStyle = grad; ctx.strokeStyle = '#0a2239'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0,0,size,0,Math.PI*2); ctx.fill(); ctx.stroke();
      // Eyes
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.arc(-size*.28,-size*.15,size*.16,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( size*.28,-size*.15,size*.16,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#0a2239';
      ctx.beginPath(); ctx.arc(-size*.26,-size*.14,size*.08,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( size*.30,-size*.14,size*.08,0,Math.PI*2); ctx.fill();
      // Tentacles
      ctx.lineCap = 'round';
      for (let i = 0; i < 6; i++) {
        const lx  = (i-2.5)*size*.28;
        const ph  = wp + (i%2===0?0:Math.PI);
        const sw  = isIdle ? Math.sin(frame*.05+i)*2 : Math.sin(ph)*5;
        const lf  = isIdle ? 0 : Math.max(0,Math.sin(ph))*2.5;
        const bY  = size * Math.sqrt(Math.max(0,1-Math.pow(lx/(size*.82),2)));
        ctx.strokeStyle = i%2===0 ? primary : dk(primary,.8); ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(lx, bY);
        ctx.quadraticCurveTo(lx+sw*.5, bY+size*.38-lf, lx+sw, bY+size*.82-lf*.5);
        ctx.stroke();
      }
      ctx.restore();
      this._rafMap[sqid] = requestAnimationFrame(loop);
    };
    this._rafMap[sqid] = requestAnimationFrame(loop);
  },

  // ═══ HELPERS ═════════════════════════════════════════════════════════════
  _folder() {
    return (this.currentTemple?.project_id || 'PROJECT_001').toUpperCase().replace(/^project_/i, 'PROJECT_');
  },

  _filterProjectTasks(tasks) {
    const pid   = this.currentTemple?.project_id;
    const pname = this.currentTemple?.name;
    return tasks.filter(t =>
      t.context?.project_id === pid ||
      t.project_id          === pid ||
      t.project_name        === pname
    );
  },

  _ficon(name) {
    const ext = (name.split('.').pop()||'').toLowerCase();
    return ({ js:'JS',ts:'TS',jsx:'JSX',tsx:'TSX',py:'PY',json:'{}',yaml:'YML',yml:'YML',
      md:'MD',txt:'TXT',html:'HTM',css:'CSS',csv:'CSV',sh:'SH',
      pdf:'PDF',zip:'ZIP',mp4:'MP4',mp3:'MP3' })[ext] || '??';
  },

  _fmtSize(b) {
    if (!b) return '';
    if (b < 1024) return `${b}B`;
    if (b < 1048576) return `${(b/1024).toFixed(0)}K`;
    return `${(b/1048576).toFixed(1)}M`;
  },

  _esc(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
  },
  _escape(s) { return this._esc(s); },

  // ═══ LEGACY COMPAT ═══════════════════════════════════════════════════════
  populateResources()    { this._switchLeft('files'); },
  populateWorkingAgents(){ if (this._leftTab==='agents') this._renderAgents(); },
  populateKanban()       { if (this._rightTab==='kanban') this._renderKanban(); },
  populateCronTasks(t)   { this.populateProjectTasks(t); },
  populateProjectTasks() { this._switchRight('tasks'); },
  openProjectMemory()    { this._switchLeft('memory'); },
  openFile(n,p,t)        { this._openFile(n,p,t,this._folder()); },
  saveFile()             { this._ideSave(); },
  refreshPreview()       { this._ideTogglePreview(); },
  humanizeCron(c)        { return c||''; },
  updateCronPreview()    {},
  openCronBuilder()      { this._newTaskModal(); },
  closeCronBuilder()     { document.querySelector('.cron-builder-modal')?.remove(); },
  _deleteProjectTask(id) { this._deleteTask(id); },
  getTempleBackground()  { return ''; },
  _initLeft(t)           { this._switchLeft(t); },
  _initRight(t)          { this._switchRight(t); },

  async assignSquid(squidId) {
    const projectId = this.currentTemple?.project_id;
    if (!projectId) { await SquidModal.alert('No project_id on this temple.'); return; }
    try {
      const pr = await window.ApiV2._fetch('/projects');
      const proj = pr.registry.projects[projectId];
      if (!proj) throw new Error('Project not found: ' + projectId);
      const assigned = [...(proj.assigned_agents||[])];
      if (!assigned.includes(squidId)) {
        assigned.push(squidId);
        await window.ApiV2._fetch('/field', { method:'PATCH', body: JSON.stringify({
          filePath: 'projects/project_registry.json',
          fieldPath: `projects.${projectId}.assigned_agents`,
          newValue: assigned, reason: 'assigned via temple'
        })});
      }
      const squid = window.aquarium?.squids?.find(s => (s.agent_id||s.id) === squidId);
      if (squid) { squid.currentProject = this.currentTemple?.name; squid.insideTemple = this.currentTemple?.name; }
      this._switchLeft('agents');
    } catch (e) { await SquidModal.alert('Failed: ' + e.message); }
  },

  async unassignSquid(squidId) {
    const ok = await SquidModal.confirm('Remove this agent from the project?');
    if (!ok) return;
    const squid = window.aquarium?.squids?.find(s => (s.agent_id||s.id) === squidId);
    if (squid) { squid.currentProject = null; squid.insideTemple = null; }
    try {
      const pr = await window.ApiV2._fetch('/projects');
      for (const [pid, p] of Object.entries(pr.registry.projects)) {
        if ((p.project_id===this.currentTemple?.project_id||p.name===this.currentTemple?.name) && Array.isArray(p.assigned_agents) && p.assigned_agents.includes(squidId)) {
          await window.ApiV2._fetch('/field', { method:'PATCH', body: JSON.stringify({
            filePath: 'projects/project_registry.json',
            fieldPath: `projects.${pid}.assigned_agents`,
            newValue: p.assigned_agents.filter(a=>a!==squidId), reason: 'unassigned'
          })});
          break;
        }
      }
    } catch {}
    this._switchLeft('agents');
  }
};

window.TempleInterior = TempleInterior;
console.log('[TEMPLE] TempleInterior v4 loaded');
