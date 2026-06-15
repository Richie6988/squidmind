/**
 * TempleInterior v4 — Project workspace cockpit
 * Design: IAQUA ocean palette + Press Start 2P + Courier New
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
      // Always refresh kanban and agents regardless of active tab
      this._renderKanban();
      const agSec = document.getElementById('ti-agents-always');
      if (agSec) this._renderAgentsCompact(agSec);
      // Also refresh task list in right panel if visible
      if (this._rightTab !== 'kanban' && this._rightTab !== 'output') this._renderTasks();
    }, 3000);
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
      <button class="ti-tab active" id="ti-rt-kanban" onclick="TempleInterior._switchRight('kanban')">KANBAN</button>
      <button class="ti-tab" id="ti-rt-output" onclick="TempleInterior._switchRight('output')">OUTPUT</button>
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

  _switchRight(tab) {
    this._rightTab = tab || 'kanban';
    // Update tab button states
    ['kanban','output'].forEach(t => {
      const btn = document.getElementById(`ti-rt-${t}`);
      if (btn) btn.classList.toggle('active', t === this._rightTab);
    });
    const body = document.getElementById('ti-right-body');
    if (!body) return;
    if (this._rightTab === 'output') {
      this._renderOutput(body);
    } else {
      this._renderKanban(body);
    }
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
    // Try inline colors first, then re-fetch from registry for accuracy
    const applyColors = (inside, outside) => {
      if (inside) {
        root.style.setProperty('--ti-temple-color', inside);
        // Solid backgrounds — no transparency so aquarium never bleeds through
        root.style.background = `var(--ocean-deep)`;
        const left = root.querySelector('.ti-left');
        if (left) left.style.background = `var(--ocean-deep)`;
        const right = root.querySelector('.ti-right');
        if (right) right.style.background = `var(--ocean-deep)`;
        // Accent: top border only
        root.style.borderTop = `3px solid ${inside}`;
      }
      if (outside) {
        const hdr = root.querySelector('.ti-header');
        if (hdr) {
          hdr.style.borderBottom = `2px solid ${outside}88`;
          hdr.style.background = `var(--ocean-deep)`;
        }
        if (!inside) root.style.borderTop = `3px solid ${outside}`;
      }
    };

    const inside  = temple?.colors?.inside  || temple?.color || null;
    const outside = temple?.colors?.outside || null;
    if (inside || outside) {
      applyColors(inside, outside);
      return;
    }
    // No inline colors — fetch from project registry
    const pid = temple?.project_id || this.currentTemple?.project_id;
    if (!pid) return;
    window.ApiV2?._fetch('/projects').then(r => {
      const proj = r?.registry?.projects?.[pid] ||
        Object.values(r?.registry?.projects || {}).find(p => p.project_id === pid || p.name === temple?.name);
      if (proj?.colors) applyColors(proj.colors.inside, proj.colors.outside);
    }).catch(() => {});
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

    const agents = assignedIds.filter(id => id && id !== 'poseidon_main').map(id => regAgents[id]).filter(Boolean);

    // ── Arena: animated canvas aquarium for agents ─────────────────────
    container.innerHTML = `
<div id="ti-arena-always" style="position:relative;overflow:hidden;height:130px;background:linear-gradient(180deg,#07111e 0%,#04080f 100%);border-bottom:1px solid rgba(79,172,254,0.12);flex-shrink:0;cursor:crosshair;">
  <canvas id="ti-arena-canvas" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>
</div>
<div style="flex:1;overflow-y:auto;">
  ${agents.length === 0
    ? '<p class=\"ti-empty\" style=\"font-size:8px;padding:10px 8px;\">No agents assigned</p>'
    : agents.map(a => {
        const w     = workers[a.agent_id] || {};
        const isRun = w.status === 'running' || a.status === 'active';
        const taskId = a.current_task_id || '';
        const dotPulse = isRun ? 'animation:ti-dot-pulse .9s ease-in-out infinite;' : '';
        return `<div class=\"ti-agent-row ${isRun ? 'running' : ''}\">
          <div class=\"ti-agent-dot ${isRun ? 'run' : 'idle'}\" style=\"${dotPulse}\"></div>
          <div style=\"flex:1;min-width:0;\">
            <div class=\"ti-agent-name\">${this._esc(a.display_name || a.agent_id)}</div>
            <div class=\"ti-agent-spec\">${taskId ? '<span style=\"color:var(--ui-accent2);\">▶ ' + this._esc(taskId) + '</span>' : this._esc(a.specialization || '')}</div>
          </div>
          <span class=\"ti-agent-badge ${isRun ? 'run' : 'idle'}\">${isRun ? 'RUN' : 'IDLE'}</span>
          <button class=\"ti-sec-btn\" onclick=\"TempleInterior._editAgent('${a.agent_id}')\" style=\"font-size:6px;padding:2px 5px;border-color:rgba(79,172,254,0.4);color:#4facfe;\">EDIT</button>
          <button class=\"ti-sec-btn\" onclick=\"TempleInterior._dispatchAgent('${a.agent_id}')\" style=\"font-size:6px;padding:2px 5px;\">SEND</button>
          <button class=\"ti-sec-btn\" onclick=\"TempleInterior.unassignSquid('${a.agent_id}')\" style=\"font-size:6px;padding:2px 5px;border-color:var(--danger);color:var(--danger);\">OUT</button>
        </div>`;
      }).join('')}
</div>
<div style="padding:5px;border-top:1px solid var(--border);flex-shrink:0;">
  <button class="ti-sec-btn" style="width:100%;text-align:center;" onclick="TempleInterior._showAssigner()">ASSIGN AGENT</button>
</div>`;

    // ── Arena: continuous animated canvas ─────────────────────────────
    const arena = container.querySelector('#ti-arena-always');
    const arenaCvs = container.querySelector('#ti-arena-canvas');
    if (arena && arenaCvs) {
      setTimeout(() => {
        arenaCvs.width  = arena.clientWidth  || 260;
        arenaCvs.height = arena.clientHeight || 130;
        const AW = arenaCvs.width, AH = arenaCvs.height;
        const aCtx = arenaCvs.getContext('2d');

        // Cancel previous loop if any
        if (this._arenaRaf) { cancelAnimationFrame(this._arenaRaf); this._arenaRaf = null; }
        // Init arena particles once
        if (!arena._pts) arena._pts = Array.from({ length: 20 }, () => ({
          x: Math.random() * AW, y: Math.random() * AH,
          r: 0.5 + Math.random() * 1.2,
          dy: -0.04 - Math.random() * 0.07,
          dx: (Math.random() - 0.5) * 0.03,
          ph: Math.random() * Math.PI * 2,
          sp: 0.3 + Math.random() * 0.5,
          col: Math.random() > 0.5 ? '79,172,254' : '6,255,165'
        }));

        // Spawn agent walkers
        const W = AW, H = AH;
        agents.forEach(a => {
          const squid = (window.aquarium?.squids || []).find(s => (s.agent_id || s.id) === a.agent_id)
            || { id: a.agent_id, name: a.display_name || a.agent_id, appearance: a.appearance || {} };
          const walker = document.createElement('div');
          walker.className = 'ti-walker';
          const cvs = document.createElement('canvas');
          cvs.width = 54; cvs.height = 60;
          const lbl = document.createElement('div');
          lbl.className = 'ti-walker-name';
          lbl.textContent = (a.display_name || a.agent_id).slice(0, 10).toUpperCase();
          const wkr = workers[a.agent_id] || {};
          if (wkr.status === 'running' || a.status === 'active') {
            const badge = document.createElement('div');
            badge.className = 'ti-walker-badge';
            badge.textContent = 'RUN';
            walker.appendChild(badge);
          }
          walker.appendChild(cvs);
          walker.appendChild(lbl);
          arena.appendChild(walker);
          this._animateSquid(walker, cvs, squid, W, H);
        });

        // Continuous arena background loop
        const tick = () => {
          const t = Date.now() / 1000;
          aCtx.clearRect(0, 0, AW, AH);

          // Rich deep-ocean gradient
          const bg = aCtx.createLinearGradient(0, 0, 0, AH);
          bg.addColorStop(0,   '#0c1e3a');
          bg.addColorStop(0.5, '#071528');
          bg.addColorStop(1,   '#030c1a');
          aCtx.fillStyle = bg; aCtx.fillRect(0, 0, AW, AH);

          // Caustic light blobs (screen blend)
          aCtx.save();
          aCtx.globalCompositeOperation = 'screen';
          for (let c2 = 0; c2 < 6; c2++) {
            const cx2 = AW * (0.1 + c2 * 0.17) + Math.sin(t * 0.2 + c2 * 0.9) * 18;
            const cy2 = AH * 0.3 + Math.sin(t * 0.15 + c2 * 1.1) * AH * 0.3;
            const cr  = 14 + Math.sin(t * 0.25 + c2) * 8;
            const ca  = 0.08 + 0.04 * Math.sin(t * 0.3 + c2);
            const cg2 = aCtx.createRadialGradient(cx2, cy2, 0, cx2, cy2, cr);
            cg2.addColorStop(0, `rgba(100,200,255,${ca})`);
            cg2.addColorStop(1, 'rgba(0,0,0,0)');
            aCtx.fillStyle = cg2;
            aCtx.beginPath(); aCtx.arc(cx2, cy2, cr, 0, Math.PI * 2); aCtx.fill();
          }
          aCtx.globalCompositeOperation = 'source-over';
          aCtx.restore();

          // Light shaft from top-center
          aCtx.save();
          aCtx.globalCompositeOperation = 'screen';
          for (let r2 = 0; r2 < 3; r2++) {
            const rx = AW * (0.25 + r2 * 0.28) + Math.sin(t * 0.06 + r2) * 20;
            const rlen = AH * 0.85;
            const rw2 = 10 + r2 * 15;
            const alp2 = 0.04 + 0.02 * Math.sin(t * 0.11 + r2);
            const rg = aCtx.createLinearGradient(rx, 0, rx, rlen);
            rg.addColorStop(0,   `rgba(100,190,255,${alp2 * 3})`);
            rg.addColorStop(0.5, `rgba(60,140,240,${alp2})`);
            rg.addColorStop(1,   'rgba(40,100,200,0)');
            aCtx.fillStyle = rg;
            aCtx.beginPath();
            aCtx.moveTo(rx - 3, 0); aCtx.lineTo(rx + 3, 0);
            aCtx.lineTo(rx + rw2, rlen); aCtx.lineTo(rx - rw2, rlen);
            aCtx.fill();
          }
          aCtx.globalCompositeOperation = 'source-over';
          aCtx.restore();

          // Animated hex grid
          aCtx.save();
          const sz = 18, rw = sz * 2, rh = Math.sqrt(3) * sz;
          const ncols = Math.ceil(AW / (rw * 0.75)) + 2;
          const nrows = Math.ceil(AH / rh) + 2;
          for (let row = 0; row < nrows; row++) {
            for (let col = 0; col < ncols; col++) {
              const hx = col * rw * 0.75 - rw * 0.3;
              const hy = row * rh + (col % 2 === 0 ? 0 : rh / 2) - rh * 0.3;
              const d  = Math.sqrt((hx - AW / 2) ** 2 + (hy - AH) ** 2);
              const pulse = Math.sin(t * 0.4 + d * 0.012 + col * 0.3);
              const al = Math.max(0, 0.03 + 0.025 * pulse);
              aCtx.strokeStyle = `rgba(79,172,254,${al})`;
              aCtx.lineWidth = 0.55;
              aCtx.beginPath();
              for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i - Math.PI / 6;
                const px = hx + sz * Math.cos(a), py = hy + sz * Math.sin(a);
                i === 0 ? aCtx.moveTo(px, py) : aCtx.lineTo(px, py);
              }
              aCtx.closePath(); aCtx.stroke();
              if (pulse > 0.82) {
                aCtx.shadowColor = 'rgba(79,172,254,0.9)';
                aCtx.shadowBlur  = 6;
                const ng = aCtx.createRadialGradient(hx, hy, 0, hx, hy, 5);
                ng.addColorStop(0, `rgba(120,200,255,0.5)`);
                ng.addColorStop(1, 'rgba(79,172,254,0)');
                aCtx.fillStyle = ng;
                aCtx.beginPath(); aCtx.arc(hx, hy, 5, 0, Math.PI * 2); aCtx.fill();
                aCtx.shadowBlur = 0;
              }
            }
          }
          aCtx.restore();

          // Floating bioluminescent particles
          aCtx.save();
          for (const p of arena._pts) {
            p.x += p.dx + Math.sin(t * p.sp * 0.35 + p.ph) * 0.06;
            p.y += p.dy;
            if (p.y < -4) { p.y = AH + 4; p.x = Math.random() * AW; }
            if (p.x < 0) p.x = AW; if (p.x > AW) p.x = 0;
            const glow = 0.15 + 0.5 * Math.abs(Math.sin(t * p.sp * 0.45 + p.ph));
            aCtx.globalAlpha = glow;
            aCtx.shadowColor = `rgb(${p.col})`;
            aCtx.shadowBlur  = p.r * 5;
            aCtx.fillStyle   = `rgb(${p.col})`;
            aCtx.beginPath(); aCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2); aCtx.fill();
          }
          aCtx.shadowBlur = 0;
          aCtx.globalAlpha = 1;
          aCtx.restore();

          // Edge vignette + floor
          const fl = aCtx.createLinearGradient(0, AH * 0.65, 0, AH);
          fl.addColorStop(0, 'rgba(0,0,0,0)'); fl.addColorStop(1, 'rgba(2,6,16,0.7)');
          aCtx.fillStyle = fl; aCtx.fillRect(0, AH * 0.65, AW, AH * 0.35);

          // Side edge glow
          for (const [ex, ey] of [[0, AH/2], [AW, AH/2]]) {
            const eg = aCtx.createRadialGradient(ex, ey, 0, ex, ey, AW * 0.25);
            eg.addColorStop(0, 'rgba(79,172,254,0.05)');
            eg.addColorStop(1, 'rgba(0,0,0,0)');
            aCtx.fillStyle = eg; aCtx.fillRect(0, 0, AW, AH);
          }

          this._arenaRaf = requestAnimationFrame(tick);
        };
        tick();
      }, 80);
    }
  },

  _drawArenaBg() { /* superseded by inline tick loop in _renderAgentsCompact */ },

  async _editAgent(agentId) {
    // Open AgentForm in edit mode for this agent
    if (typeof AgentForm !== 'undefined' && AgentForm.openEdit) {
      await AgentForm.openEdit(agentId);
    } else if (typeof AgentForm !== 'undefined' && AgentForm.open) {
      await AgentForm.open(agentId);
    } else {
      await SquidModal.alert('AgentForm not available');
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

    const agents = assignedIds.filter(id => id && id !== 'poseidon_main').map(id => regAgents[id]).filter(Boolean);

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
  // ═══ MEMORY TAB ════════════════════════════════════════════════════════
  async _renderMemory(container) {
    const c = container || document.getElementById('ti-left-body');
    if (!c) return;
    const folder = this._folder();
    const pid    = this.currentTemple?.project_id;

    c.innerHTML = '<div style="padding:8px;font-family:\'Press Start 2P\',monospace;font-size:7px;color:#475569;">LOADING...</div>';

    let mem = null;
    try {
      if (pid) {
        const r = await window.ApiV2._fetch(`/projects/${pid}/memory`);
        mem = r.memory;
      }
    } catch {}

    // Build structured display
    const fmt = (v) => this._esc(typeof v === 'object' ? JSON.stringify(v) : String(v || ''));
    const listItems = (arr, maxLen = 60) => (arr || []).slice(0,10).map(item => {
      const text = typeof item === 'object' ? (item.text || item.message || JSON.stringify(item)) : item;
      const by   = item.by  ? ` <span style="color:#334155;">— ${item.by}</span>` : '';
      const at   = item.at  ? ` <span style="color:#1e293b;font-size:6px;">${item.at.slice(0,10)}</span>` : '';
      return `<div class="ti-mem-item">${this._esc(String(text).slice(0, maxLen))}${by}${at}</div>`;
    }).join('') || '<div class="ti-mem-item" style="color:#334155;">none</div>';

    c.innerHTML = `
<div class="ti-mem-wrap">
  <div class="ti-mem-header">
    <span>PROJECT MEMORY</span>
    <span class="ti-mem-progress">${mem?.progress?.completion || '0%'}</span>
  </div>

  <div class="ti-mem-section">
    <div class="ti-mem-label">VISION</div>
    <div class="ti-mem-value">${fmt(mem?.vision || 'Not set')}</div>
  </div>

  <div class="ti-mem-section">
    <div class="ti-mem-label">PROGRESS
      <span style="color:#475569;font-size:6px;margin-left:8px;">${mem?.progress?.tasks_done||0}/${mem?.progress?.tasks_total||0} tasks</span>
    </div>
    <div class="ti-mem-progress-bar">
      <div class="ti-mem-progress-fill" style="width:${mem?.progress?.completion||'0%'}"></div>
    </div>
  </div>

  ${mem?.progress?.blockers?.length ? `<div class="ti-mem-section ti-mem-warn">
    <div class="ti-mem-label">BLOCKERS</div>
    ${listItems(mem.progress.blockers, 80)}
  </div>` : ''}

  <div class="ti-mem-section">
    <div class="ti-mem-label">NEXT STEPS</div>
    ${(mem?.progress?.next_steps||[]).length
      ? (mem.progress.next_steps||[]).slice(0,5).map((s,i) => `<div class="ti-mem-item"><span style="color:#4facfe;margin-right:6px;">${i+1}.</span>${this._esc(String(s).slice(0,70))}</div>`).join('')
      : '<div class="ti-mem-item" style="color:#334155;">none defined</div>'}
  </div>

  <div class="ti-mem-section">
    <div class="ti-mem-label">RECENT ACHIEVEMENTS</div>
    ${listItems(mem?.progress?.recent_achievements, 70)}
  </div>

  <div class="ti-mem-section">
    <div class="ti-mem-label">DECISIONS</div>
    ${listItems(mem?.decisions, 80)}
  </div>

  <div class="ti-mem-section">
    <div class="ti-mem-label">AGENT COMMS</div>
    ${listItems(mem?.agents_communication, 80)}
  </div>

  <div class="ti-mem-section" style="gap:4px;">
    <div class="ti-mem-label">ADD NOTE</div>
    <select id="ti-mem-section-sel" style="font-family:\'Courier New\',monospace;font-size:9px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:3px 5px;">
      <option value="decision">Decision</option>
      <option value="achievement">Achievement</option>
      <option value="blocker">Blocker</option>
      <option value="resolve_blocker">Resolve Blocker</option>
      <option value="next_steps">Next Steps</option>
      <option value="agent_sync">Agent Sync</option>
    </select>
    <input id="ti-mem-note" type="text" placeholder="Enter note..." style="font-family:\'Courier New\',monospace;font-size:9px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:4px 8px;outline:none;">
    <button class="ti-sec-btn" onclick="TempleInterior._addMemoryNote('${pid}')">ADD</button>
  </div>
</div>`;
  },

  async _addMemoryNote(pid) {
    const section = document.getElementById('ti-mem-section-sel')?.value;
    const content = document.getElementById('ti-mem-note')?.value.trim();
    if (!pid || !section || !content) return;
    try {
      await window.ApiV2._fetch(`/projects/${pid}/memory`, {
        method: 'PATCH',
        body: JSON.stringify({ section, content, by: 'human_user' })
      });
      this._renderMemory();
    } catch (e) { console.warn('Memory note failed:', e.message); }
  },

  async _saveMemory(folder) {
    // Legacy: kept for compat
    this._renderMemory();
  },

  // ═══ KANBAN ══════════════════════════════════════════════════════════════
  async _renderKanban(container) {
    const c = container || (this._rightTab === 'kanban' ? document.getElementById('ti-right-body') : null);
    if (!c) return;

    let tasks = [];
    let brokerOwner = '';  // e.g. "bg_task_task_0008"
    try {
      const [r, ms] = await Promise.all([
        window.ApiV2._fetch('/tasks'),
        window.ApiV2._fetch('/models/status').catch(() => ({}))
      ]);
      tasks = this._filterProjectTasks(Object.values(r.registry?.tasks || {}));
      brokerOwner = ms?.broker?.owner || ms?.status?.broker?.owner || '';
    } catch {
      try {
        const r = await window.ApiV2._fetch('/tasks');
        tasks = this._filterProjectTasks(Object.values(r.registry?.tasks || {}));
      } catch {}
    }

    // Extract running task_id from broker owner string (e.g. "bg_task_task_0008")
    const brokerTaskMatch = brokerOwner.match(/bg_task_(task_\w+)/);
    const brokerRunningId = brokerTaskMatch ? brokerTaskMatch[1] : null;

    const cols = {
      todo: tasks.filter(t => {
        const s = t.lifecycle?.status || t.status || 'open';
        // If broker is actively running this task, move it visually to PROGRESS even if status hasn't flushed yet
        if (brokerRunningId === t.task_id) return false;
        return ['open','planned','queued'].includes(s);
      }),
      prog: tasks.filter(t => {
        const s = t.lifecycle?.status || t.status || 'open';
        return s === 'in_progress' || brokerRunningId === t.task_id;
      }),
      done: tasks.filter(t => {
        const s = t.lifecycle?.status || t.status;
        return ['completed','failed','cancelled'].includes(s) && brokerRunningId !== t.task_id;
      })
    };

    const makeCard = (task) => {
      const status = task.lifecycle?.status || task.status || 'open';
      // Consider broker-running state even if status hasn't updated yet
      const isRun  = status === 'in_progress' || brokerRunningId === task.task_id;
      const isFail = status === 'failed' || status === 'cancelled';
      const isDone = status === 'completed';
      const cls    = isRun ? 'prog' : isDone ? 'done' : isFail ? 'fail' : '';
      const agent  = task.assignment?.assigned_name || task.assignment?.assigned_to || '';
      // Progress line: show for in_progress tasks
      const progText = task.progress ? String(task.progress).slice(0, 80) : '';
      const prog   = isRun && progText ? `<div class="ti-kcard-prog">&gt; ${this._esc(progText)}</div>` : '';
      // Result summary for done tasks
      const summary = (isDone || isFail) && task.result_summary
        ? `<div class="ti-kcard-prog">${this._esc(String(task.result_summary).slice(0, 100))}</div>` : '';
      const bar    = isRun ? `<div class="ti-kcard-bar"><div class="ti-kcard-bar-fill"></div></div>` : '';
      const agentBadge = agent
        ? `<span class="ti-kcard-agent${isRun ? ' running' : ''}">${isRun ? '⚡' : '>'} ${this._esc(agent.slice(0,14))}</span>`
        : '';
      return `<div class="ti-kcard ${cls}" draggable="true" data-task-id="${task.task_id}"
          ondragstart="TempleInterior._kDragStart(event)"
          ondragover="event.preventDefault();event.currentTarget.classList.add('drag-over')"
          ondragleave="event.currentTarget.classList.remove('drag-over')"
          onclick="TempleInterior._openTaskDetail('${task.task_id}')">
        <div class="ti-kcard-title">${this._esc(task.title)}</div>
        ${prog}${summary}${bar}
        <div class="ti-kcard-foot">
          ${agentBadge}
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
    const el = event.currentTarget;
    if (!el) return;
    const id = el.dataset.taskId;
    this._dragTaskId = id;
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    // Capture element ref before setTimeout — event.currentTarget is null after handler returns
    setTimeout(() => el.classList.add('dragging'), 0);
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

  // ═══ OUTPUT FILES TAB ════════════════════════════════════════════════════
  async _renderOutput(container) {
    const c = container || (this._rightTab === 'output' ? document.getElementById('ti-right-body') : null);
    if (!c) return;

    c.innerHTML = '<div style="padding:12px;font-family:\'Press Start 2P\',monospace;font-size:8px;color:#475569;">LOADING...</div>';

    try {
      const r = await window.ApiV2._fetch('/tasks');
      const allTasks = this._filterProjectTasks(Object.values(r.registry?.tasks || {}));

      const doneTasks = allTasks.filter(t => {
        const s = t.lifecycle?.status || t.status;
        return s === 'completed' || s === 'failed';
      }).sort((a, b) => {
        const ta = a.lifecycle?.completed_at || a.created_at || '';
        const tb = b.lifecycle?.completed_at || b.created_at || '';
        return tb.localeCompare(ta);
      });

      const runningTasks = allTasks.filter(t => (t.lifecycle?.status || t.status) === 'in_progress');

      if (!doneTasks.length && !runningTasks.length) {
        c.innerHTML = '<div style="padding:20px;font-family:\'Press Start 2P\',monospace;font-size:8px;color:#334155;text-align:center;">NO OUTPUT YET</div>';
        return;
      }

      const self = this;
      const renderRow = (t, isRunning) => {
        const s = t.lifecycle?.status || t.status;
        const isFail = s === 'failed';
        const ts = (t.lifecycle?.completed_at || t.lifecycle?.started_at || t.created_at || '').slice(0, 16).replace('T', ' ');
        const icon = isRunning ? '>' : (isFail ? '!' : '+');
        const cls  = isRunning ? 'ti-out-running' : (isFail ? 'ti-out-fail' : '');
        return `<div class="ti-out-row ${cls}" onclick="TempleInterior._viewOutput('${t.task_id}', ${isRunning})">
          <div class="ti-out-row-top">
            <span class="ti-out-status${isRunning ? ' ti-out-status-run' : ''}">${icon}</span>
            <span class="ti-out-title">${self._esc(t.title)}</span>
            ${isRunning ? '<span class="ti-out-live">LIVE</span>' : ''}
          </div>
          <div class="ti-out-row-bot">
            <span class="ti-out-ts">${ts}</span>
            ${t.result_summary ? `<span class="ti-out-preview">${self._esc(String(t.result_summary).slice(0, 60))}</span>` : ''}
          </div>
        </div>`;
      };

      c.innerHTML = `<div class="ti-output-wrap">
  <div class="ti-output-list" id="ti-out-list">
    ${runningTasks.map(t => renderRow(t, true)).join('')}
    ${doneTasks.map(t => renderRow(t, false)).join('')}
  </div>
  <div class="ti-out-viewer" id="ti-out-viewer" style="display:none;flex-direction:column;flex:1;min-height:0;padding:6px;">
    <div class="ti-out-viewer-hdr">
      <span id="ti-out-viewer-title"></span>
      <button onclick="TempleInterior._closeOutputViewer()" style="font-family:'Press Start 2P',monospace;font-size:6px;background:none;border:1px solid rgba(255,255,255,0.1);color:#94a3b8;padding:3px 8px;cursor:pointer;">BACK</button>
    </div>
    <pre id="ti-out-viewer-body" class="ti-out-pre"></pre>
  </div>
</div>`;
    } catch (e) {
      c.innerHTML = `<div style="padding:12px;color:#ef4444;font-size:9px;font-family:'Courier New',monospace;">Error: ${this._esc(e.message)}</div>`;
    }
  },

  _closeOutputViewer() {
    const list   = document.getElementById('ti-out-list');
    const viewer = document.getElementById('ti-out-viewer');
    if (this._outSse) { try { this._outSse.close(); } catch {} this._outSse = null; }
    if (list)   list.style.display   = 'flex';
    if (viewer) viewer.style.display = 'none';
  },

  async _viewOutput(taskId, isLive) {
    const list   = document.getElementById('ti-out-list');
    const viewer = document.getElementById('ti-out-viewer');
    const title  = document.getElementById('ti-out-viewer-title');
    const body   = document.getElementById('ti-out-viewer-body');
    if (!viewer || !body) return;
    if (this._outSse) { try { this._outSse.close(); } catch {} this._outSse = null; }
    body.textContent = 'Loading...';
    if (list) list.style.display = 'none';
    viewer.style.display = 'flex';
    if (isLive) {
      title.textContent = taskId + ' [LIVE]';
      body.textContent = '';
      const sse = new EventSource('/api/v2/tasks/' + taskId + '/stream');
      this._outSse = sse;
      sse.addEventListener('chunk', e => {
        const d = JSON.parse(e.data);
        body.textContent += d.text || '';
        body.scrollTop = body.scrollHeight;
      });
      sse.addEventListener('done', e => {
        const d = JSON.parse(e.data);
        title.textContent = taskId + ' [' + (d.status || 'done').toUpperCase() + ']';
        sse.close(); this._outSse = null;
        setTimeout(() => this._renderOutput(), 1500);
      });
      sse.onerror = () => { sse.close(); this._outSse = null; };
    } else {
      try {
        const res = await window.ApiV2._fetch('/tasks/' + taskId + '/result');
        title.textContent = taskId;
        body.textContent = res.content || res.result || '(empty)';
      } catch (err) {
        body.textContent = 'Error: ' + err.message;
      }
    }
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
    const CW   = cvs.width, CH = cvs.height;
    // Scale size with canvas height — bigger arena = bigger squids
    const size = Math.max(14, Math.min(22, CH * 0.28));
    const app  = squid.appearance || {};
    const primary = app.primary_color || app.body_color || '#4facfe';
    const accent  = app.secondary_color || app.accent_color || '#06ffa5';
    const dk  = (hex, f) => { try { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgb(${Math.floor(r*f)},${Math.floor(g*f)},${Math.floor(b*f)})`; } catch { return hex; } };
    const br  = (hex, f) => { try { const r=Math.min(255,parseInt(hex.slice(1,3),16)*f),g=Math.min(255,parseInt(hex.slice(3,5),16)*f),b=Math.min(255,parseInt(hex.slice(5,7),16)*f); return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`; } catch { return hex; } };
    const hexToRgb = (hex) => { try { return `${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)}`; } catch { return '79,172,254'; } };
    const mg  = size + 6;
    let px = mg + Math.random()*(cW-mg*2), py = mg + Math.random()*(cH-mg*2);
    let vx = (Math.random()-.5)*0.25, vy = (Math.random()-.5)*0.12;
    let frame = 0, idle = 0, nextIdle = 120 + Math.floor(Math.random()*180);
    const stride = 55;
    const loop = () => {
      frame++;
      if (idle > 0) { idle--; vx *= .87; vy *= .87; }
      else {
        nextIdle--;
        if (nextIdle <= 0) { idle = 40 + Math.floor(Math.random()*60); nextIdle = 90 + Math.floor(Math.random()*130); }
        vx += (Math.random()-.5)*.11; vy += (Math.random()-.5)*.07;
        vx *= .97; vy *= .97;
        const spd = Math.sqrt(vx*vx+vy*vy);
        if (spd > .22) { vx *= .22/spd; vy *= .22/spd; }
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
      const bob = isIdle ? Math.sin(frame*.04)*1.6 : Math.sin(wp*2)*2;
      ctx.clearRect(0, 0, CW, CH);

      // ── Glow halo underneath ────────────────────────────────────────
      const glowPulse = 0.12 + 0.06 * Math.sin(frame * 0.04);
      const glowR = size * 1.8;
      const shadowX = CW/2, shadowY = CH/2 + size * 0.9;
      const shadowGrad = ctx.createRadialGradient(shadowX, shadowY, 0, shadowX, shadowY, glowR);
      shadowGrad.addColorStop(0,   `rgba(${hexToRgb(primary)},${glowPulse})`);
      shadowGrad.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = shadowGrad;
      ctx.beginPath(); ctx.ellipse(shadowX, shadowY, glowR, glowR * 0.35, 0, 0, Math.PI * 2); ctx.fill();

      // ── Squid body ──────────────────────────────────────────────────
      // Cache one Squid instance per walker to avoid per-frame allocation
      if (!ctx.__cachedSq && typeof Squid !== 'undefined') {
        try {
          ctx.__cachedSq = new Squid({ id:'__tw__', name:'', status:'idle', appearance:{...app}, x:CW/2, y:CW/2 });
          ctx.__cachedSq.isDragging = true; ctx.__cachedSq.isSleeping = false;
          ctx.__cachedSq.isHovered = false; ctx.__cachedSq.insideTemple = null;
          ctx.__cachedSq.jumpHeight = 0; ctx.__cachedSq.heartParticles = [];
          ctx.__cachedSq._confetti = null; ctx.__cachedSq.baseSize = size / 40;
          ctx.__cachedSq.alpha = 1;
        } catch { ctx.__cachedSq = null; }
      }
      if (ctx.__cachedSq) {
        try {
          const sq = ctx.__cachedSq;
          sq.x = CW/2; sq.y = CH/2 - 2 + bob;
          sq.animFrame = wp; sq.bobOffset = 0;
          ctx.save();
          ctx.shadowColor = primary; ctx.shadowBlur = 8 + glowPulse * 18;
          if (!fR) { ctx.translate(CW, 0); ctx.scale(-1, 1); sq.x = CW - sq.x; }
          sq.draw(ctx);
          ctx.restore();
          this._rafMap[sqid] = requestAnimationFrame(loop);
          return;
        } catch { ctx.__cachedSq = null; }
      }
      // Fallback: hand-drawn squid with glow
      ctx.save();
      ctx.shadowColor = primary;
      ctx.shadowBlur = 10 + glowPulse * 16;
      ctx.translate(CW/2, CH/2-2+bob);
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
    // Use the actual folder name from registry (set by project creation)
    // NOT the project_id (which is PROJECT_001 etc.) — they differ!
    return (this.currentTemple?.folder || this.currentTemple?.project_id || 'PROJECT_001').toUpperCase().replace(/^project_/i, 'PROJECT_');
  },

  _filterProjectTasks(tasks) {
    const pid   = this.currentTemple?.project_id;
    const pname = this.currentTemple?.name;
    // If no project context, show all tasks (global view from aquarium)
    if (!pid && !pname) return tasks;
    return tasks.filter(t =>
      t.context?.project_id === pid ||
      t.project_id          === pid ||
      t.context?.project_name === pname ||
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
      const allProjects = pr.registry.projects;

      // Check if agent is already assigned to another project
      for (const [pid, p] of Object.entries(allProjects)) {
        if (pid === projectId) continue;
        if (Array.isArray(p.assigned_agents) && p.assigned_agents.includes(squidId)) {
          const confirmed = await SquidModal.confirm(
            `Agent is already assigned to "${p.name}".\nMove to "${this.currentTemple?.name}"?`
          );
          if (!confirmed) return;
          // Remove from previous project
          await window.ApiV2._fetch('/field', { method: 'PATCH', body: JSON.stringify({
            filePath: 'projects/project_registry.json',
            fieldPath: `projects.${pid}.assigned_agents`,
            newValue: p.assigned_agents.filter(a => a !== squidId),
            reason: 'moved to another project'
          })});
          break;
        }
      }

      const proj = allProjects[projectId];
      if (!proj) throw new Error('Project not found: ' + projectId);
      const assigned = [...(proj.assigned_agents || [])];
      if (!assigned.includes(squidId)) {
        assigned.push(squidId);
        await window.ApiV2._fetch('/field', { method: 'PATCH', body: JSON.stringify({
          filePath: 'projects/project_registry.json',
          fieldPath: `projects.${projectId}.assigned_agents`,
          newValue: assigned, reason: 'assigned via temple'
        })});
      }
      const squid = window.aquarium?.squids?.find(s => (s.agent_id || s.id) === squidId);
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
