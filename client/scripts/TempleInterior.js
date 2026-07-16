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

    // Auto-start reasoning stream
    if (!this._reasoningEvtSource) {
      const _rPanel = document.getElementById('ti-reasoning-panel');
      if (_rPanel) this._startReasoningStream(_rPanel);
    }

    this._pollTimer = setInterval(() => {
      this._renderHeader();
      // Always refresh kanban and agents regardless of active tab
      this._renderKanban();
      const agSec = document.getElementById('ti-agents-always');
      if (agSec) this._renderAgentsCompact(agSec);
      // Also refresh task list in right panel if visible
      if (this._rightTab !== 'kanban') this._renderTasks();
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
    return `
<div class="ti-header">
  <span class="ti-header-title">${name}</span>
  <span class="ti-header-stat" id="ti-hdr-stat">...</span>
  <span class="ti-header-sep"></span>
  <button class="ti-hbtn" onclick="TempleInterior._newTaskModal()">+ TASK</button>
  <button class="ti-hbtn" onclick="TempleInterior._refreshAll()" title="Reload tasks, agents, files">REFRESH</button>
  <button class="ti-hbtn" onclick="TempleInterior._toggleFocus()" title="Focus mode — hide side panels (F11 toggles)" id="ti-focus-btn">⛶ FOCUS</button>
  <button class="ti-hbtn ti-hbtn-danger" onclick="TempleInterior.close()" title="Close temple (Esc)">CLOSE X</button>
</div>
<div class="ti-body">

  <!-- LEFT: files/memory tabs + poseidon chat + agents -->
  <div class="ti-left" style="display:flex;flex-direction:column;min-height:0;overflow:hidden;">
    <div class="ti-tabs">
      <button class="ti-tab" id="ti-lt-files"  onclick="TempleInterior._switchLeft('files')">FILES</button>
      <button class="ti-tab" id="ti-lt-memory" onclick="TempleInterior._switchLeft('memory')">MEMORY</button>
    </div>
    <div id="ti-left-body" style="flex:0 0 auto;min-height:0;overflow:hidden;max-height:30%;display:flex;flex-direction:column;"></div>
    <!-- Poseidon chat — just below files -->
    <div id="ti-proj-chat" style="flex-shrink:0;border-top:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;flex-direction:column;background:rgba(2,8,16,0.98);height:120px;">
      <div class="ti-sec ti-pos-instr-hdr">&#x2B21; POSEIDON INSTRUCTIONS</div>
      <div id="ti-proj-chat-log" style="flex:1;overflow-y:auto;padding:2px 6px;font-size:9px;line-height:1.4;color:var(--text-secondary);"></div>
      <div style="display:flex;gap:3px;padding:3px 5px;flex-shrink:0;">
        <textarea id="ti-proj-chat-input" rows="2"
          style="flex:1;background:rgba(15,35,64,0.9);border:1px solid rgba(79,172,254,0.25);color:var(--text-primary);border-radius:3px;padding:2px 5px;font-size:9px;resize:none;font-family:inherit;line-height:1.4;outline:none;"
          placeholder="Instructions... Ctrl+Enter"
          onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();TempleInterior._projChatSend();}"></textarea>
        <button onclick="TempleInterior._projChatSend()"
          style="flex-shrink:0;padding:2px 8px;font-size:11px;background:rgba(79,172,254,0.15);border:1px solid rgba(79,172,254,0.3);color:#4facfe;border-radius:3px;cursor:pointer;">&#9654;</button>
      </div>
    </div>
    <!-- Agents -->
    <div style="flex:1;display:flex;flex-direction:column;min-height:0;overflow:hidden;">
      <div class="ti-sec" style="flex-shrink:0;">AGENTS</div>
      <div id="ti-agents-always" style="flex:1;overflow:auto;display:flex;flex-direction:column;"></div>
    </div>
  </div>

  <!-- CENTER: reasoning live stream OR file content — flex column, no absolute hacks -->
  <div class="ti-center" style="display:flex;flex-direction:column;min-height:0;overflow:hidden;background:#020810;">
    <!-- Tab bar: file tabs left + LIVE right — always visible, flex-shrink:0 -->
    <div class="ti-ide-tabbar" id="ti-ide-tabbar"
      style="display:flex;align-items:center;gap:2px;padding:0 6px;flex-shrink:0;border-bottom:1px solid var(--border);min-height:26px;background:#030d1a;z-index:2;">
      <span class="ti-ide-notabs" id="ti-ide-notabs"
        style="font-size:8px;opacity:.3;pointer-events:none;user-select:none;">LIVE STREAM</span>
      <span style="flex:1;min-width:0;"></span>
    </div>
    <!-- File toolbar — visible only when a file is open -->
    <div class="ti-ide-toolbar" id="ti-ide-toolbar"
      style="display:none;align-items:center;flex-shrink:0;border-bottom:1px solid var(--border);background:#030d1a;padding:2px 6px;gap:6px;z-index:2;">
      <span class="ti-ide-fname" id="ti-ide-fname"
        style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#94a3b8;"></span>
      <button class="ti-tab-sm" id="ti-prev-toggle" onclick="TempleInterior._ideTogglePreview()" title="Toggle between editor and preview">PREVIEW</button>
      <button class="ti-tab-sm accent" onclick="TempleInterior._ideSave()" id="ti-ide-save-btn" title="Save (Ctrl+S)">SAVE</button>
      <button class="ti-tab-sm" onclick="TempleInterior._closeAllFiles()" title="Close all open files and return to live stream"
        style="border-color:rgba(239,68,68,0.3);color:#94a3b8;">CLOSE ALL</button>
    </div>
    <!-- Content area: flex:1 — ONE child visible at a time fills the remaining space -->
    <div id="ti-content-area" style="flex:1;min-height:0;position:relative;overflow:hidden;">
      <!-- Reasoning stream — shown when no file open -->
      <div id="ti-reasoning-panel"
        style="position:absolute;inset:0;display:block;overflow-y:auto;background:#020810;color:#00ffb4;font-family:'Courier New',monospace;font-size:12px;padding:14px;line-height:1.6;z-index:1;"></div>
      <!-- Editor — overlays reasoning when a text/code file is open.
           VS-Code-style rendering: the textarea stays the REAL editor (all
           save/dirty logic reads ed.value, untouched); a Prism-highlighted
           <pre> is layered exactly underneath with identical font metrics,
           the textarea's own text is made transparent (caret stays visible),
           and a line-number gutter sits on the left. All three scroll-sync. -->
      <div id="ti-editor-gutter" class="ti-editor-gutter" aria-hidden="true" style="display:none;"></div>
      <pre id="ti-editor-hl" class="ti-editor-hl" aria-hidden="true" style="display:none;"><code id="ti-editor-hl-code" class="language-none"></code></pre>
      <textarea id="ti-editor" class="ti-editor" spellcheck="false" wrap="off"
        oninput="TempleInterior._ideMarkDirty();TempleInterior._ideSyncHighlight()"
        onscroll="TempleInterior._ideSyncScroll()"
        onkeydown="if((event.ctrlKey||event.metaKey)&&event.key==='s'){event.preventDefault();TempleInterior._ideSave();}"
        placeholder="Open a file to edit..."
        style="display:none;position:absolute;inset:0;width:100%;height:100%;box-sizing:border-box;resize:none;border:none;outline:none;z-index:2;"></textarea>
      <!-- Preview iframe — full area for md/html/images -->
      <iframe id="ti-preview-frame" class="ti-preview-frame" sandbox="allow-scripts allow-same-origin"
        style="display:none;position:absolute;inset:0;width:100%;height:100%;border:none;background:#020810;z-index:2;"></iframe>
    </div>
    <!-- Status bar — always at bottom, flex-shrink:0 -->
    <div class="ti-ide-status" id="ti-ide-status"
      style="flex-shrink:0;font-size:8px;padding:2px 8px;background:#020d1c;border-top:1px solid var(--border);color:#475569;letter-spacing:.06em;">READY</div>
  </div>

  <!-- RIGHT: kanban -->
  <div class="ti-right">
    <div class="ti-tabs">
      <button class="ti-tab active" id="ti-rt-kanban" onclick="TempleInterior._switchRight('kanban')">KANBAN</button>
    </div>
    <div id="ti-right-body" style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;"></div>
  </div>

</div>`;
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
    ['kanban'].forEach(t => {
      const btn = document.getElementById(`ti-rt-${t}`);
      if (btn) btn.classList.toggle('active', t === this._rightTab);
    });
    const body = document.getElementById('ti-right-body');
    if (!body) return;
    this._renderKanban(body);
  },

  _renderHeader() {
    const el = document.getElementById('ti-hdr-stat');
    if (!el) return;
    // Fetch task counts for this project
    const pid = this.currentTemple?.project_id;
    window.api?._fetch('/tasks').then(r => {
      const tasks = Object.values(r?.registry?.tasks || {});
      const mine  = pid ? tasks.filter(t => t.project_id === pid || t.context?.project_id === pid) : tasks;
      const done  = mine.filter(t => ['done','completed','cancelled','archived'].includes(t.lifecycle?.status || t.status)).length;
      const prog  = mine.filter(t => ['wip','in_progress'].includes(t.lifecycle?.status || t.status)).length;
      const total = mine.length;
      el.textContent = `${prog > 0 ? `▶ ${prog} running · ` : ''}${done}/${total} done`;
    }).catch(() => { el.textContent = ''; });
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
        const hex = inside.replace('#', '');
        const r = parseInt(hex.slice(0,2), 16), g = parseInt(hex.slice(2,4), 16), b = parseInt(hex.slice(4,6), 16);
        const tint4  = `rgba(${r},${g},${b},0.04)`;
        const tint8  = `rgba(${r},${g},${b},0.08)`;
        const tint15 = `rgba(${r},${g},${b},0.15)`;
        const tint20 = `rgba(${r},${g},${b},0.20)`;
        const tint35 = `rgba(${r},${g},${b},0.35)`;
        const tint60 = `rgba(${r},${g},${b},0.60)`;

        root.style.setProperty('--ti-temple-color', inside);

        // Solid base background — always opaque to hide aquarium
        root.style.background = `#020810`;
        root.style.borderTop  = `3px solid ${inside}`;

        // Left panel — tinted with inside color
        const left = root.querySelector('.ti-left');
        if (left) {
          left.style.background = `linear-gradient(180deg, ${tint15} 0%, rgba(${r},${g},${b},0.03) 100%)`;
          left.style.borderRight = `1px solid ${tint20}`;
        }
        // Center panel — very subtle tint to not interfere with text
        const center = root.querySelector('.ti-center');
        if (center) {
          center.style.background = `linear-gradient(135deg, ${tint8} 0%, #020810 50%)`;
        }
        // Reasoning panel background tint
        const rPan = root.querySelector('#ti-reasoning-panel');
        if (rPan) rPan.style.background = `linear-gradient(180deg, rgba(${r},${g},${b},0.04) 0%, #020810 100%)`;
        // Right panel
        const right = root.querySelector('.ti-right');
        if (right) {
          right.style.background = `linear-gradient(180deg, ${tint15} 0%, rgba(${r},${g},${b},0.03) 100%)`;
          right.style.borderLeft = `1px solid ${tint20}`;
        }
        // Active tabs — use a LEGIBLE variant of the theme colour. Raw
        // `inside` can be a dark hex (a project's assigned base tone) and
        // when applied directly to tab text on a near-black background the
        // labels vanish — that's why FILES/KANBAN read as "blurry".
        // Boost each channel toward white until the perceived lightness
        // (rec.709 luma) is at least 0.65.
        const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        let textColor = inside;
        if (luma < 0.65) {
          // Blend toward white with weight based on how dark it is
          const t = Math.min(1, (0.85 - luma) / 0.85);
          const rr = Math.round(r + (255 - r) * t);
          const gg = Math.round(g + (255 - g) * t);
          const bb = Math.round(b + (255 - b) * t);
          textColor = `rgb(${rr},${gg},${bb})`;
        }
        root.querySelectorAll('.ti-tab.active, .ti-tab-sm.accent').forEach(el => {
          el.style.borderBottomColor = inside;    // border stays saturated
          el.style.color = textColor;             // text uses the legible variant
        });
        // Section headers
        root.querySelectorAll('.ti-sec').forEach(el => {
          el.style.background = tint8;
          el.style.borderBottom = `1px solid ${tint20}`;
        });
        // IDE toolbar / tabbar tint
        const toolbar = root.querySelector('#ti-ide-toolbar');
        if (toolbar) { toolbar.style.background = tint8; toolbar.style.borderBottom = `1px solid ${tint20}`; }
        const tabbar = root.querySelector('#ti-ide-tabbar');
        if (tabbar) { tabbar.style.background = tint8; }
        // Header
        const hdr = root.querySelector('.ti-header');
        if (hdr) { hdr.style.background = tint8; hdr.style.borderBottom = `2px solid ${tint35}`; }
        // Poseidon chat area
        const chat = root.querySelector('#ti-proj-chat');
        if (chat) { chat.style.background = `rgba(${r},${g},${b},0.06)`; chat.style.borderColor = tint20; }
        // LIVE button border
        const rBtn = root.querySelector('#ti-reasoning-toggle');
        if (rBtn) rBtn.style.borderColor = tint60;
      }
      if (outside) {
        // Outside color: temple card exterior only (rendered in ProjectsPanel SVG)
        // Inside the temple, outside color accents the header border
        if (!inside) {
          const hdr = root.querySelector('.ti-header');
          if (hdr) hdr.style.borderBottom = `2px solid ${outside}88`;
          root.style.borderTop = `3px solid ${outside}`;
        }
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
    window.api?._fetch('/projects').then(r => {
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
      const pr = await window.api._fetch('/projects');
      const proj = Object.values(pr.registry.projects || {}).find(p =>
        p.project_id === this.currentTemple?.project_id || p.name === this.currentTemple?.name
      );
      assignedIds = proj?.assigned_agents || [];
    } catch {}
    try { regAgents = (await window.api._fetch('/agents')).registry.agents || {}; } catch {}
    try { workers   = (await window.api._fetch('/agents/pool/status')).workers || {}; } catch {}

    const agents = assignedIds.filter(id => id && id !== 'poseidon_main').map(id => regAgents[id]).filter(Boolean);

    // ── If arena canvas already exists, only update the agent list (don't destroy animation) ──
    const existingArena = container.querySelector('#ti-arena-always');
    let listContainer   = container.querySelector('#ti-agent-list');

    if (!existingArena) {
      // First render: build full structure. Arena now takes the entire
      // section (flex:1). The old text list below was redundant — every
      // agent already appears in the arena. Click any walker to open the
      // action popover (RUN / EDIT / SEND / OUT).
      container.innerHTML = `
<div id="ti-arena-always" style="position:relative;overflow:hidden;flex:1;min-height:160px;background:linear-gradient(180deg,#07111e 0%,#04080f 100%);border-bottom:1px solid rgba(79,172,254,0.12);cursor:crosshair;">
  <canvas id="ti-arena-canvas" style="position:absolute;inset:0;width:100%;height:100%;"></canvas>
  <div id="ti-arena-empty" class="ti-arena-empty" style="display:none;">No agents assigned</div>
</div>
<div id="ti-agent-list" style="display:none;"></div>
<div style="padding:8px 10px;border-top:1px solid var(--border);flex-shrink:0;">
  <button class="ti-sec-btn ti-assign-btn" style="width:100%;text-align:center;" onclick="TempleInterior._showAssigner()">ASSIGN AGENT</button>
</div>`;
      listContainer = container.querySelector('#ti-agent-list');

      // Start arena animation (only once)
      const arena  = container.querySelector('#ti-arena-always');
      const arenaCvs = container.querySelector('#ti-arena-canvas');
      if (arena && arenaCvs) {
        setTimeout(() => {
          arenaCvs.width  = arena.clientWidth  || 260;
          arenaCvs.height = arena.clientHeight || 130;
          const aCtx = arenaCvs.getContext('2d');
          const AW = arenaCvs.width, AH = arenaCvs.height;
          if (!arena._pts) {
            arena._pts = Array.from({ length: 12 }, () => ({
              x: Math.random() * AW, y: Math.random() * AH,
              r: 0.6 + Math.random() * 1.4,
              dx: (Math.random() - 0.5) * 0.08, dy: -0.04 - Math.random() * 0.09,
              sp: 0.3 + Math.random() * 0.5, ph: Math.random() * Math.PI * 2,
              col: ['0,255,190','79,172,254','140,80,255'][Math.floor(Math.random() * 3)]
            }));
          }

          // Start arena animation loop
          const tick = () => {
            const t = Date.now() / 1000;
            aCtx.clearRect(0, 0, AW, AH);
            const bg = aCtx.createLinearGradient(0, 0, 0, AH);
            bg.addColorStop(0, '#0c1e3a'); bg.addColorStop(1, '#030c1a');
            aCtx.fillStyle = bg; aCtx.fillRect(0, 0, AW, AH);
            // Bioluminescent particles
            aCtx.save();
            for (const p of arena._pts) {
              p.x += p.dx + Math.sin(t * p.sp * 0.35 + p.ph) * 0.06;
              p.y += p.dy;
              if (p.y < -4) { p.y = AH + 4; p.x = Math.random() * AW; }
              if (p.x < 0) p.x = AW; if (p.x > AW) p.x = 0;
              const glow = 0.15 + 0.5 * Math.abs(Math.sin(t * p.sp * 0.45 + p.ph));
              aCtx.globalAlpha = glow;
              aCtx.shadowColor = `rgb(${p.col})`; aCtx.shadowBlur = p.r * 5;
              aCtx.fillStyle = `rgb(${p.col})`;
              aCtx.beginPath(); aCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2); aCtx.fill();
            }
            aCtx.shadowBlur = 0; aCtx.globalAlpha = 1; aCtx.restore();
            this._arenaRaf = requestAnimationFrame(tick);
          };
          if (this._arenaRaf) cancelAnimationFrame(this._arenaRaf);
          tick();

          // NOTE: do NOT add walkers here. The unconditional hot-add code
          // path below (`if (arenaEl && agents.length > 0)`) handles both
          // initial population AND mid-session add/remove. Adding here
          // duplicated every walker on first render, because the hot-add
          // runs synchronously while this block runs after a setTimeout.
        }, 50);
      }
    }

    // ── Always update: empty-state overlay + walker hot-add for newly assigned agents ──
    const arenaEl = container.querySelector('#ti-arena-always');
    const emptyEl = container.querySelector('#ti-arena-empty');
    if (emptyEl) emptyEl.style.display = agents.length === 0 ? 'flex' : 'none';

    // Hot-add walkers if an agent was assigned after first render. (Existing
    // walkers stay where they are; arena animation continues uninterrupted.)
    if (arenaEl && agents.length > 0) {
      const presentIds = new Set(
        Array.from(arenaEl.querySelectorAll('.ti-walker')).map(w => w.dataset.agentId)
      );
      const newAgents = agents.filter(a => !presentIds.has(a.agent_id));
      if (newAgents.length) {
        const arenaCvs = arenaEl.querySelector('#ti-arena-canvas');
        const AW = arenaCvs?.width  || 260;
        const AH = arenaCvs?.height || 160;
        newAgents.forEach((a) => {
          const squid = (window.aquarium?.squids || []).find(s => (s.agent_id || s.id) === a.agent_id)
            || { id: a.agent_id, name: a.display_name || a.agent_id, appearance: a.appearance || {} };
          const walker = document.createElement('div');
          walker.className = 'ti-walker clickable';
          walker.dataset.agentId = a.agent_id;
          walker.title = `${a.display_name || a.agent_id} — click for actions`;
          walker.onclick = (e) => { e.stopPropagation(); TempleInterior._showAgentPopover(a.agent_id, walker); };
          const cvs = document.createElement('canvas');
          cvs.width = 52; cvs.height = 58;
          const lbl = document.createElement('div');
          lbl.className = 'ti-walker-name';
          lbl.textContent = (a.display_name || a.agent_id).slice(0, 10).toUpperCase();
          arenaEl.appendChild(walker);
          walker.appendChild(cvs);
          walker.appendChild(lbl);
          this._animateSquid(walker, cvs, squid, AW, AH);
        });
      }
      // Hot-remove walkers for agents that were unassigned
      const agentIdSet = new Set(agents.map(a => a.agent_id));
      Array.from(arenaEl.querySelectorAll('.ti-walker')).forEach(w => {
        if (!agentIdSet.has(w.dataset.agentId)) w.remove();
      });
      // Update running-state badges (canvas redraws each frame so we just
      // toggle a class on the walker for any CSS-driven highlight)
      Array.from(arenaEl.querySelectorAll('.ti-walker')).forEach(w => {
        const a = agents.find(x => x.agent_id === w.dataset.agentId);
        if (!a) return;
        const wk = workers[a.agent_id] || {};
        const isRun = wk.status === 'running' || a.status === 'active';
        w.classList.toggle('running', isRun);
      });
    }
  },

  // ═══ AGENT ACTION POPOVER ═════════════════════════════════════════════════
  // Click a walker → show this popover with RUN / EDIT / SEND / OUT.
  // Closes on outside-click, Esc, or after an action fires.
  async _showAgentPopover(agentId, anchorEl) {
    // Tear down any open popover first (also acts as a toggle if same walker)
    const existing = document.getElementById('ti-agent-popover');
    if (existing) {
      const sameAnchor = existing.dataset.agentId === agentId;
      existing.remove();
      if (sameAnchor) return;
    }

    let agent = null, worker = null;
    try {
      const ar = await window.api._fetch('/agents');
      agent = ar.registry?.agents?.[agentId];
    } catch {}
    try {
      const wr = await window.api._fetch('/agents/pool/status');
      worker = wr.workers?.[agentId];
    } catch {}
    if (!agent) return;

    const isRun = worker?.status === 'running' || agent.status === 'active';
    const taskId = agent.current_task_id || '';
    const specOrTask = taskId ? `▶ ${taskId}` : (agent.specialization || 'no specialization');

    const pop = document.createElement('div');
    pop.id = 'ti-agent-popover';
    pop.className = 'ti-agent-popover';
    pop.dataset.agentId = agentId;
    pop.innerHTML = `
      <div class="ti-agent-pop-hdr">
        <span class="ti-agent-pop-dot ${isRun ? 'run' : 'idle'}"></span>
        <span class="ti-agent-pop-name">${this._esc(agent.display_name || agentId)}</span>
        <span class="ti-agent-pop-pill ${isRun ? 'run' : 'idle'}">${isRun ? 'RUN' : 'IDLE'}</span>
      </div>
      <div class="ti-agent-pop-sub">${this._esc(specOrTask)}</div>
      <div class="ti-agent-pop-actions">
        <button class="ti-pop-btn run"  onclick="TempleInterior._popAction('run','${agentId}')">RUN</button>
        <button class="ti-pop-btn edit" onclick="TempleInterior._popAction('edit','${agentId}')">EDIT</button>
        <button class="ti-pop-btn send" onclick="TempleInterior._popAction('send','${agentId}')">SEND</button>
        <button class="ti-pop-btn out"  onclick="TempleInterior._popAction('out','${agentId}')">OUT</button>
      </div>`;
    document.body.appendChild(pop);

    // Anchor near the walker — open to the right if there's room, else left.
    const r = anchorEl.getBoundingClientRect();
    const pw = 220, ph = 130;
    let left = r.right + 8;
    let top  = r.top - (ph / 2) + (r.height / 2);
    if (left + pw > window.innerWidth - 8) left = r.left - pw - 8;
    if (top < 8) top = 8;
    if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
    pop.style.left = `${Math.max(8, left)}px`;
    pop.style.top  = `${top}px`;

    // Dismiss on outside-click + Esc
    setTimeout(() => {
      const closeOutside = (e) => {
        if (!pop.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
          pop.remove();
          document.removeEventListener('mousedown', closeOutside, true);
          document.removeEventListener('keydown', closeEsc, true);
        }
      };
      const closeEsc = (e) => {
        if (e.key === 'Escape') {
          pop.remove();
          document.removeEventListener('mousedown', closeOutside, true);
          document.removeEventListener('keydown', closeEsc, true);
        }
      };
      document.addEventListener('mousedown', closeOutside, true);
      document.addEventListener('keydown', closeEsc, true);
    }, 0);
  },

  async _popAction(kind, agentId) {
    const pop = document.getElementById('ti-agent-popover');
    if (pop) pop.remove();
    switch (kind) {
      case 'run':  return this._runAgent ? this._runAgent(agentId)
                          : (typeof TaskQueueUI !== 'undefined' && TaskQueueUI._scheduleForAgent
                              ? TaskQueueUI._scheduleForAgent(agentId)
                              : SquidModal.alert('Use Send to dispatch a new task to this agent.'));
      case 'edit': return this._editAgent(agentId);
      case 'send': return this._dispatchAgent(agentId);
      case 'out':  return this.unassignSquid(agentId);
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
        const ts    = (type === 'output' && f.mtime)
          ? `<span class="ti-file-mtime" title="${f.mtime}">${this._relTime(f.mtime)}</span>` : '';
        // Task badge (output only): click opens the task modal directly.
        // Shows the review verdict/score as a color pill when Poseidon
        // graded it — cuts the mental round-trip Richard was doing.
        let taskBadge = '';
        if (type === 'output' && f.task_id) {
          const v = f.task_review?.verdict;
          const s = f.task_review?.score;
          const rev = v ? `<span class="ti-file-review ti-file-review-${(v||'').toLowerCase()}">${v}${Number.isFinite(s) ? ' ' + s : ''}</span>` : '';
          taskBadge = `<span class="ti-file-taskbadge" onclick="event.stopPropagation();TaskQueueUI.openDetail && TaskQueueUI.openDetail('${this._esc(f.task_id)}')" title="${this._esc(f.task_title||'')}">${this._esc(f.task_id)}${rev}</span>`;
        }
        // Image quick-actions — UPSCALE (2× hi-res pass) + EDIT (img2img with prompt)
        const imgActions = (isImg && type === 'output')
          ? `<button class="ti-file-imgact" title="Upscale 2×" onclick="event.stopPropagation();TempleInterior._upscaleImage('${this._esc(f.path||'')}','${ename}')">↑2×</button>
             <button class="ti-file-imgact" title="Edit with prompt (img2img)" onclick="event.stopPropagation();TempleInterior._editImage('${this._esc(f.path||'')}','${ename}')">✎</button>`
          : '';
        return `<div class="ti-file" data-task-id="${f.task_id || ''}" onmouseenter="TempleInterior._haloTask('${this._esc(f.task_id||'')}',true)" onmouseleave="TempleInterior._haloTask('${this._esc(f.task_id||'')}',false)" onclick="TempleInterior._openFile('${ename}','${this._esc(f.path||'')}','${type}','${folder}',${f.size||0})">
          ${thumb}
          <span class="ti-file-name" title="${ename}">${ename}</span>${taskBadge}${sz}${ts}
          ${imgActions}
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

  // ── Image quick actions (upscale / edit-with-prompt) ─────────────────────
  async _upscaleImage(filepath, name) {
    if (!filepath) return;
    const scale = window.confirm('Upscale ' + name + ' by 4×?  OK = 4×, Cancel = 2×') ? 4 : 2;
    this._setStatus(`Upscaling ${name} ${scale}×…`);
    try {
      // Real Lanczos resample — not a diffusion regen.
      const r = await fetch('/api/v2/models/upscale-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_image: filepath, scale }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j && j.ok === false)) {
        this._setStatus(`Upscale failed: ${(j && j.error) || r.status}`);
        return;
      }
      this._setStatus(`Upscaled ${j.from} → ${j.to}. Saved ${j.outputPath?.split('/').pop() || ''}.`);
      setTimeout(() => this._switchLeft('files'), 1500);
    } catch (e) {
      this._setStatus(`Upscale failed: ${e.message}`);
    }
  },

  async _editImage(filepath, name) {
    if (!filepath) return;
    const prompt = await SquidModal.prompt({
      title: `Edit "${name}"\nDescribe what to change (Ctrl+Enter to submit)\nStrength 0.6 = moderate rework`,
      placeholder: 'e.g. "make it night, add fog, cinematic lighting"',
      multiline: true,
    });
    if (!prompt || !prompt.trim()) return;
    this._setStatus(`Queueing edit of ${name}…`);
    try {
      const r = await fetch('/api/v2/models/generate-image', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          source_image: filepath,
          strength:     0.6,
          filename:     name.replace(/(\.[^.]+)$/, `_edit_${Date.now()}$1`),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j && j.ok === false)) {
        this._setStatus(`Edit failed: ${(j && j.error) || r.status}`);
        return;
      }
      this._setStatus(`Edit queued as ${j.task_id || 'task'} — watch the queue.`);
      setTimeout(() => this._switchLeft('files'), 3000);
    } catch (e) {
      this._setStatus(`Edit failed: ${e.message}`);
    }
  },

  async _deleteFile(folder, fileName, type) {
    const ok = await SquidModal.confirm(`Delete "${fileName}"?`);
    if (!ok) return;
    const ep = type === 'input' ? 'inputs' : 'outputs';
    const r = await fetch(`/api/v2/projects/${folder}/${ep}/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      await SquidModal.alert(`Could not delete "${fileName}": ${d.error || r.status}`);
    }
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
      const pr = await window.api._fetch('/projects');
      const proj = Object.values(pr.registry.projects || {}).find(p =>
        p.project_id === this.currentTemple?.project_id || p.name === this.currentTemple?.name
      );
      assignedIds = proj?.assigned_agents || [];
    } catch {}
    try { regAgents = (await window.api._fetch('/agents')).registry.agents || {}; } catch {}
    try { workers   = (await window.api._fetch('/agents/pool/status')).workers || {}; } catch {}

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
      const res = await window.api._fetch('/tasks', {
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
    try { regAgents = (await window.api._fetch('/agents')).registry.agents || {}; } catch {}
    try {
      const pr = await window.api._fetch('/projects');
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
    const pid    = this.currentTemple?.project_id;

    c.innerHTML = '<div style="padding:14px;">' + ['<div class="iaqua-skel iaqua-skel-line" style="width:60%;"></div>', '<div class="iaqua-skel iaqua-skel-line" style="width:85%;"></div>', '<div class="iaqua-skel iaqua-skel-line" style="width:50%;"></div>'].join('') + '</div>';

    let mem = null;
    try {
      if (pid) {
        const r = await window.api._fetch(`/projects/${pid}/memory`);
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
      await window.api._fetch(`/projects/${pid}/memory`, {
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
      const [r, ms, rl] = await Promise.all([
        window.api._fetch('/tasks'),
        window.api._fetch('/models/status').catch(() => ({})),
        // Terminal tasks (completed/failed/cancelled) are purged from the
        // live registry by RegistryManager._writeTaskDetails and persisted
        // to results_log.json. Without this fetch, the kanban DONE column
        // stays permanently empty even though tasks ARE finishing.
        window.api._fetch('/tasks/results').catch(() => ({ results: {} })),
      ]);
      const liveTasks = Object.values(r.registry?.tasks || {});
      const doneTasks = Object.values(rl.results || {});
      tasks = this._filterProjectTasks([...liveTasks, ...doneTasks]);
      brokerOwner = ms?.broker?.owner || ms?.status?.broker?.owner || '';
    } catch {
      try {
        const r = await window.api._fetch('/tasks');
        tasks = this._filterProjectTasks(Object.values(r.registry?.tasks || {}));
      } catch {}
    }

    // Extract running task_id from broker owner string (e.g. "bg_task_task_0008")
    const brokerTaskMatch = brokerOwner.match(/bg_task_(task_\w+)/);
    const brokerRunningId = brokerTaskMatch ? brokerTaskMatch[1] : null;

    const bySortOrder = (a, b) => (a.sort_order ?? 1000) - (b.sort_order ?? 1000);
    const cols = {
      todo: tasks.filter(t => {
        const s = t.lifecycle?.status || t.status || 'todo';
        if (brokerRunningId === t.task_id) return false;
        return ['todo','open','planned','queued'].includes(s);
      }).sort(bySortOrder),
      prog: tasks.filter(t => {
        const s = t.lifecycle?.status || t.status || 'todo';
        return s === 'wip' || s === 'in_progress' || brokerRunningId === t.task_id;
      }).sort(bySortOrder),
      done: tasks.filter(t => {
        const s = t.lifecycle?.status || t.status;
        return ['done','completed','failed','cancelled'].includes(s) && brokerRunningId !== t.task_id;
      }).sort(bySortOrder)
    };

    const makeCard = (task) => {
      const status = task.lifecycle?.status || task.status || 'todo';
      const isRun  = status === 'wip' || status === 'in_progress' || brokerRunningId === task.task_id;
      const isFail = status === 'failed' || status === 'cancelled' || (status === 'done' && task.outcome === 'failed');
      const isDone = status === 'completed' || (status === 'done' && task.outcome !== 'failed');
      // Awaiting Poseidon's quality verdict — visible sub-state of wip.
      const isReview = !!task.awaiting_review && (isRun || status === 'wip');
      const cls    = isRun ? 'prog' : isDone ? 'done' : isFail ? 'fail' : '';
      const agent  = task.assigned_name || task.assigned_to || '';
      // Status icon — ⭐ trumps ● when awaiting review
      const statusIcon  = isReview ? '⭐' : isRun ? '●' : isDone ? '✓' : isFail ? '✗' : '○';
      const statusColor = isReview ? '#fbbf24' : isRun ? '#06ffa5' : isDone ? '#4facfe' : isFail ? '#ef4444' : '#64748b';
      // Elapsed timer for in_progress
      let elapsed = '';
      if (isRun && task.lifecycle?.started_at) {
        const ms = Date.now() - new Date(task.lifecycle.started_at).getTime();
        if (ms > 0 && ms < 24*60*60*1000) {
          const s = Math.floor(ms / 1000);
          elapsed = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s/60)}m ${s%60}s` : `${Math.floor(s/3600)}h`;
        }
      }
      // Progress line for in_progress tasks (from task.progress field updated by TaskRunner).
      // During review, override with the review-status line so the card
      // visibly signals the awaiting-verdict state.
      const progText = isReview
        ? '⭐ Poseidon reviewing deliverable…'
        : (task.progress ? String(task.progress).slice(0, 100) : '');
      const prog   = (isRun || isReview) && progText ? `<div class="ti-kcard-prog"${isReview ? ' style="color:#fbbf24;"' : ''}>› ${this._esc(progText)}</div>` : '';
      // Result summary for done tasks
      const summary = (isDone || isFail) && task.result_summary
        ? `<div class="ti-kcard-prog">${this._esc(String(task.result_summary).slice(0, 110))}</div>` : '';
      // Output file chips for done/failed tasks — click opens the file in
      // the main preview panel (same _openFile path used by the output list).
      let outputChips = '';
      if ((isDone || isFail) && Array.isArray(task.files_written) && task.files_written.length) {
        const chips = task.files_written.slice(0, 6).map(fp => {
          const bn  = String(fp).split(/[\/\\]/).pop() || fp;
          // Detect type from the path: output/ vs work/ vs temp/. Default output.
          const ftype = /[\/\\]work[\/\\]/i.test(fp) ? 'work'
                      : /[\/\\]temp[\/\\]/i.test(fp) ? 'temp'
                      : 'output';
          const isImg = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(bn);
          const icon = isImg ? '🖼' : /\.(md|txt|log)$/i.test(bn) ? '📄'
                     : /\.(json|ya?ml|toml|csv|tsv)$/i.test(bn) ? '{}'
                     : /\.(js|ts|py|rb|go|rs|java|cpp|c|sh)$/i.test(bn) ? '</>' : '·';
          return `<span class="ti-kcard-file" onclick="event.stopPropagation();TempleInterior._openKanbanFile('${this._esc(bn)}','${this._esc(fp)}','${ftype}')" title="Open ${this._esc(bn)}">${icon} ${this._esc(bn.length > 26 ? bn.slice(0, 24) + '…' : bn)}</span>`;
        }).join('');
        const more = task.files_written.length > 6 ? `<span class="ti-kcard-file-more">+${task.files_written.length - 6}</span>` : '';
        outputChips = `<div class="ti-kcard-files">${chips}${more}</div>`;
      }
      // Progress bar (animated for running)
      const bar    = isRun ? `<div class="ti-kcard-bar"><div class="ti-kcard-bar-fill"></div></div>` : '';
      const agentBadge = agent
        ? `<span class="ti-kcard-agent${isRun ? ' running' : ''}" title="Assigned to ${this._esc(agent)}">${isRun ? '▶' : '·'} ${this._esc(agent.slice(0,14))}</span>`
        : '';
      const elapsedBadge = elapsed
        ? `<span class="ti-kcard-elapsed" style="color:#06ffa5;font-family:var(--panel-font-mono);font-size:9px;white-space:nowrap;flex-shrink:0;">${elapsed}</span>`
        : '';
      // Quick action: play (open→in_progress) or stop (in_progress→open).
      // Visible only for movable statuses so completed/failed cards stay clean.
      const st = String(task.lifecycle?.status || task.status || 'todo').toLowerCase();
      const deps = task.depends_on ? (Array.isArray(task.depends_on) ? task.depends_on : [task.depends_on]) : [];
      const depBadge = deps.length
        ? `<span class="ti-kcard-dep" title="Waits for ${this._esc(deps.join(', '))} to complete">⧗ ${this._esc(deps.length === 1 ? deps[0] : deps.length + ' deps')}</span>`
        : '';
      const quickAction = (st === 'todo' || st === 'open' || st === 'planned' || st === 'assigned' || st === 'queued')
        ? `<button class="ti-kcard-quickact play" title="Start task" onclick="event.stopPropagation();TempleInterior._quickStartTask('${task.task_id}')">▶</button>`
        : (st === 'wip' || st === 'in_progress' || st === 'running')
        ? `<button class="ti-kcard-quickact stop" title="Stop task" onclick="event.stopPropagation();TempleInterior._quickStopTask('${task.task_id}')">■</button>`
        : '';
      return `<div class="ti-kcard ${cls}" data-task-id="${task.task_id}"
          onmouseenter="TempleInterior._haloTask('${task.task_id}',true)"
          onmouseleave="TempleInterior._haloTask('${task.task_id}',false)"
          onclick="TempleInterior._openTaskDetail('${task.task_id}')"
          title="${this._esc(task.title)} — click to open, drag the ⋮⋮ handle to move">
        <span class="ti-kcard-handle" draggable="true"
              ondragstart="TempleInterior._kDragStart(event)"
              ondragend="TempleInterior._kDragEnd(event)"
              onclick="event.stopPropagation()"
              title="Drag to move / reorder">⋮⋮</span>
        <div class="ti-kcard-body">
          <div class="ti-kcard-title">
            <span style="color:${statusColor};margin-right:5px;">${statusIcon}</span>${this._esc(task.title)}
          </div>
          ${prog}${summary}${outputChips}${bar}
          <div class="ti-kcard-foot">
            ${agentBadge}
            ${depBadge}
            <span class="ti-kcard-foot-right">
              ${elapsedBadge}
              ${quickAction}
              <button class="ti-kcard-del" title="${(isDone || isFail) ? 'Dismiss from board' : 'Delete task'}" onclick="event.stopPropagation();TempleInterior.${(isDone || isFail) ? `_dismissDoneTask('${task.task_id}')` : `_deleteTask('${task.task_id}')`}">×</button>
            </span>
          </div>
        </div>
      </div>`;
    };

    const colDefs = [
      { key: 'todo', label: 'TO-DO', cls: 'todo', drop: 'todo' },
      { key: 'prog', label: 'WIP',   cls: 'prog', drop: 'wip' },
      { key: 'done', label: 'DONE',  cls: 'done', drop: 'done' }
    ];

    const emptyStateFor = (key) => {
      if (key === 'todo') return `<div class="ti-empty" style="padding:14px 8px;text-align:center;color:#475569;font-size:11px;line-height:1.6;">No tasks yet.<br><button onclick="event.stopPropagation();TempleInterior._showAddTask()" style="margin-top:8px;background:rgba(79,172,254,0.15);border:1px solid rgba(79,172,254,0.3);color:#4facfe;padding:5px 11px;font-size:10px;border-radius:5px;cursor:pointer;font-family:var(--panel-font);">+ Add task</button></div>`;
      if (key === 'prog') return `<p class="ti-empty" style="padding:10px 6px;text-align:center;font-size:10px;color:#475569;">Drag a task here<br>or wait for an agent</p>`;
      return `<p class="ti-empty" style="padding:10px 6px;text-align:center;font-size:10px;color:#475569;">Completed tasks will appear here</p>`;
    };
    c.innerHTML = `
<div class="ti-kanban-wrap">
  <div class="ti-kanban-hdr">
    <span>${tasks.length} TASK${tasks.length !== 1 ? 'S' : ''}</span>
  </div>
  <div class="ti-kanban-board">
    ${colDefs.map(col => `
    <div class="ti-kcol" id="ti-kcol-${col.key}"
      data-status="${col.drop}"
      ondragover="event.preventDefault();event.dataTransfer.dropEffect='move';TempleInterior._kDragOver(event);"
      ondragenter="event.preventDefault();TempleInterior._kColEnter(event);"
      ondragleave="TempleInterior._kColLeave(event);"
      ondrop="TempleInterior._kDrop(event,'${col.drop}');">
      <div class="ti-kcol-head ${col.cls}">
        <span>${col.label}</span>
        <span style="display:inline-flex;align-items:center;gap:6px;">
          ${col.key === 'done' && (cols.done || []).length ? `<button class="ti-kcol-clear" onclick="TempleInterior._kClearDone()" title="Clear all done/failed/cancelled tasks from this board">CLEAR</button>` : ''}
          <span class="ti-kcol-count">${(cols[col.key] || []).length}</span>
        </span>
      </div>
      <div class="ti-kcards">
        ${(cols[col.key] || []).length
          ? (cols[col.key] || []).map(makeCard).join('')
          : emptyStateFor(col.key)}
      </div>
    </div>`).join('')}
  </div>
</div>`;
  },

  _kDragStart(event) {
    const handle = event.currentTarget;
    const card   = handle.closest('.ti-kcard');
    if (!card) return;
    const id = card.dataset.taskId;
    this._dragTaskId = id;
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    // Use the card itself as the drag image (not just the handle dot)
    if (event.dataTransfer.setDragImage) {
      try { event.dataTransfer.setDragImage(card, 20, 20); } catch {}
    }
    // setTimeout because the browser snapshots the card BEFORE applying
    // classes when computing the drag image
    setTimeout(() => card.classList.add('dragging'), 0);
  },

  _kDragEnd(event) {
    // Cleanup regardless of whether drop succeeded (Escape, outside drop, etc.)
    document.querySelectorAll('.ti-kcard.dragging').forEach(c => c.classList.remove('dragging'));
    document.querySelectorAll('.ti-kcol.drag-over').forEach(c => {
      c.classList.remove('drag-over');
      c.dataset.dragDepth = '0';
    });
    document.querySelectorAll('.ti-kcard.drop-before, .ti-kcard.drop-after').forEach(c => {
      c.classList.remove('drop-before', 'drop-after');
    });
    this._dragTaskId = null;
  },

  // Counter-based dragenter/leave: HTML5 fires enter+leave each time the
  // pointer crosses a child element, causing flicker. We count nestings.
  _kColEnter(event) {
    const col = event.currentTarget;
    const depth = (parseInt(col.dataset.dragDepth, 10) || 0) + 1;
    col.dataset.dragDepth = String(depth);
    col.classList.add('drag-over');
  },
  _kColLeave(event) {
    const col = event.currentTarget;
    const depth = Math.max(0, (parseInt(col.dataset.dragDepth, 10) || 0) - 1);
    col.dataset.dragDepth = String(depth);
    if (depth === 0) col.classList.remove('drag-over');
  },

  // Insertion indicator: highlight the card the dragged one will land before
  _kDragOver(event) {
    const col = event.currentTarget;
    const cards = [...col.querySelectorAll('.ti-kcards .ti-kcard:not(.dragging)')];
    cards.forEach(c => c.classList.remove('drop-before', 'drop-after'));
    if (!cards.length) return;
    const y = event.clientY;
    let target = null, targetBefore = true;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (y < r.top + r.height / 2) { target = c; targetBefore = true; break; }
      target = c; targetBefore = false;  // remember as the last-seen below
    }
    if (target) target.classList.add(targetBefore ? 'drop-before' : 'drop-after');
  },

  async _kDrop(event, newStatus) {
    event.preventDefault();
    event.stopPropagation();
    const col = event.currentTarget;
    const taskId = event.dataTransfer.getData('text/plain') || this._dragTaskId;
    // Always clean up visual state, even on early returns
    this._kDragEnd(event);
    if (!taskId) return;

    // Detect drop position within column for reorder (cards excluding the dragged one)
    const cards = [...col.querySelectorAll('.ti-kcards .ti-kcard')].filter(c => c.dataset.taskId !== taskId);
    const dropY = event.clientY;
    let insertBeforeId = null;
    for (const c of cards) {
      const rect = c.getBoundingClientRect();
      if (dropY < rect.top + rect.height / 2) {
        insertBeforeId = c.dataset.taskId;
        break;
      }
    }

    // Optimistic UI: hide the dragged card immediately, fail-rollback by re-render
    const draggedCard = document.querySelector(`.ti-kcard[data-task-id="${taskId}"]`);
    if (draggedCard) draggedCard.style.opacity = '0.4';

    try {
      // Update status (column change). Skip if dropped in the same column AND
      // the status didn't change — saves a roundtrip and avoids lifecycle churn.
      const currentStatus = draggedCard?.classList.contains('done') ? 'done'
                          : draggedCard?.classList.contains('prog') ? 'wip'
                          : draggedCard?.classList.contains('fail') ? 'done' : 'todo';
      if (currentStatus !== newStatus) {
        const r = await window.api._fetch(`/tasks/${taskId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: newStatus })
        });
        if (!r.success) throw new Error(r.error || 'status PATCH rejected');
      }
      // Reorder within the (now-correct) column
      await this._reorderTask(taskId, insertBeforeId, newStatus);
    } catch (e) {
      console.warn('[Kanban] drop failed:', e.message);
      if (typeof SquidModal !== 'undefined') {
        SquidModal.alert(`Could not move task: ${e.message}`);
      }
    } finally {
      this._renderKanban();
    }
  },

  /**
   * Reorder a task by setting its sort_order to be just before the target.
   * If insertBeforeId is null, the task goes to the end of the column.
   * Uses fractional sort_order to avoid renumbering everything.
   */
  async _reorderTask(taskId, insertBeforeId, status) {
    try {
      const r = await window.api._fetch('/tasks');
      const tasks = Object.values(r.registry?.tasks || {});
      // Tasks in the same status, sorted by current sort_order
      const sameCol = this._filterProjectTasks(tasks)
        .filter(t => (t.lifecycle?.status || t.status) === status && t.task_id !== taskId)
        .sort((a, b) => (a.sort_order ?? 1000) - (b.sort_order ?? 1000));

      let newOrder;
      if (insertBeforeId === null) {
        // End of column
        const last = sameCol[sameCol.length - 1];
        newOrder = last ? (last.sort_order ?? 0) + 100 : 100;
      } else {
        const idx = sameCol.findIndex(t => t.task_id === insertBeforeId);
        const target = sameCol[idx];
        const prev   = idx > 0 ? sameCol[idx - 1] : null;
        const targetOrd = target?.sort_order ?? 100;
        const prevOrd   = prev?.sort_order   ?? 0;
        newOrder = (prevOrd + targetOrd) / 2;
      }

      await window.api._fetch(`/tasks/${taskId}/sort`, {
        method: 'PATCH',
        body: JSON.stringify({ sort_order: newOrder })
      });
    } catch (e) {
      console.warn('[Kanban] reorder failed:', e.message);
    }
  },

  // ═══ OUTPUT FILES TAB ════════════════════════════════════════════════════
  async _renderOutput(container) {
    const c = container || (this._rightTab === 'output' ? document.getElementById('ti-right-body') : null);
    if (!c) return;

    c.innerHTML = '<div style="padding:14px;">' + ['<div class="iaqua-skel iaqua-skel-line" style="width:60%;"></div>', '<div class="iaqua-skel iaqua-skel-line" style="width:85%;"></div>', '<div class="iaqua-skel iaqua-skel-line" style="width:50%;"></div>'].join('') + '</div>';

    try {
      const r = await window.api._fetch('/tasks');
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
        const res = await window.api._fetch('/tasks/' + taskId + '/result');
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
      const r = await window.api._fetch('/tasks');
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
        const agent  = task.assigned_name || task.assigned_to || '';
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
    await window.api._fetch('/tasks', {
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
    try { agents = Object.values((await window.api._fetch('/agents')).registry.agents || {}); } catch {}

    const modal = document.createElement('div');
    modal.className = 'modal ntm-modal';
    modal.style.zIndex = '20001';
    modal.innerHTML = `<div class="modal-content ntm-content">
      <div class="modal-header"><h2>NEW TASK — ${this._esc(pname||'')}</h2>
        <button class="btn-close" onclick="this.closest('.modal').remove()">x</button></div>
      <div class="modal-body ntm-body">
        <div class="agent-form-row">
          <label>Title *</label>
          <input id="ntm-title" type="text" placeholder="What needs to be done?">
        </div>
        <div class="agent-form-row">
          <label>Description / Instructions</label>
          <textarea id="ntm-desc" rows="5" placeholder="Detailed instructions for the agent..."></textarea>
        </div>
        <div style="display:flex;gap:14px;">
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
        <div class="agent-form-section ntm-cron-section">
          <h3>RECURRING SCHEDULE (CRON)</h3>
          <div style="display:flex;gap:14px;align-items:flex-end;">
            <div class="agent-form-row" style="flex:2;">
              <label>Cron expression <span class="ntm-hint">(leave empty for one-time)</span></label>
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
          <p class="ntm-cron-fmt">Format: minute hour day month weekday (0-6=Sun-Sat)</p>
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
      await window.api._fetch('/tasks', {
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

  // ── Task quick actions (start / stop) ────────────────────────────────────
  async _quickStartTask(taskId) {
    this._setStatus(`Starting ${taskId}…`);
    try {
      const r = await fetch(`/api/v2/tasks/${taskId}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'in_progress' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        this._setStatus(`Start failed: ${j?.error || r.status}`);
        return;
      }
      this._setStatus(`${taskId} → in_progress`);
      this._renderKanban();
    } catch (e) {
      this._setStatus(`Start failed: ${e.message}`);
    }
  },

  async _quickStopTask(taskId) {
    this._setStatus(`Stopping ${taskId}…`);
    try {
      // Two-step: flip status back to `open` so the worker's cooperative
      // status check picks it up, AND signal an abort to whichever LLM
      // instance is currently running it (agent worker or Poseidon BG).
      const r = await fetch(`/api/v2/tasks/${taskId}/status`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status: 'open', cancel_running: true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) {
        this._setStatus(`Stop failed: ${j?.error || r.status}`);
        return;
      }
      this._setStatus(`${taskId} stopped`);
      this._renderKanban();
    } catch (e) {
      this._setStatus(`Stop failed: ${e.message}`);
    }
  },

  async _deleteTask(taskId) {
    if (!window.UndoManager) {
      const ok = await SquidModal.confirm(`Delete task ${taskId}?`);
      if (!ok) return;
      await window.api._fetch(`/tasks/${taskId}`, { method: 'DELETE' });
      this._renderKanban(); this._renderTasks(); this._renderHeader();
      return;
    }
    // Optimistic remove from local cache (Kanban re-renders without it)
    const reg = await window.api._fetch('/tasks').catch(() => null);
    const task = reg?.registry?.tasks?.[taskId];
    const label = task?.title ? '"' + task.title + '"' : taskId;
    // Hide visually by re-rendering with a temporary filter
    this._deletedTaskIds = this._deletedTaskIds || new Set();
    this._deletedTaskIds.add(taskId);
    this._renderKanban(); this._renderTasks(); this._renderHeader();

    window.UndoManager.scheduleDelete({
      label: 'Task ' + label,
      delay: 6000,
      onCommit: async () => {
        try {
          await window.api._fetch(`/tasks/${taskId}`, { method: 'DELETE' });
        } catch (e) {
          this._deletedTaskIds.delete(taskId);
          this._renderKanban(); this._renderTasks(); this._renderHeader();
          throw e;
        }
      },
      onCancel: () => {
        this._deletedTaskIds.delete(taskId);
        this._renderKanban(); this._renderTasks(); this._renderHeader();
      },
    });
  },

  // ═══ IDE ═════════════════════════════════════════════════════════════════
  /**
   * _haloTask — bidirectional visual link between an output file and its
   * producing task. Hovering an output card glows the matching kanban card
   * AND every other output file that shares the same task_id, so Richard
   * can see 'these three files came out of this one task'. Empty task_id
   * = no-op. Cheap enough to call from onmouseenter/onmouseleave.
   */
  _haloTask(taskId, on) {
    if (!taskId) return;
    const cls = 'ti-halo-linked';
    document.querySelectorAll(`.ti-kcard[data-task-id="${taskId}"], .ti-file[data-task-id="${taskId}"]`).forEach(el => {
      if (on) el.classList.add(cls);
      else    el.classList.remove(cls);
    });
  },

  _openFile(name, filepath, type, folder, serverSize = 0) {
    const existing = this._openFiles.findIndex(f => f.name === name && f.folder === folder);
    if (existing >= 0) { this._ideActivate(existing); return; }

    const isImg = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(name);
    if (isImg) {
      const url = `/api/v2/projects/${folder}/${type === 'input' ? 'inputs' : 'outputs'}/${encodeURIComponent(name)}`;
      this._openFiles.push({ name, path: filepath, folder, type, content: `[IMAGE: ${name}]`, imgUrl: url, isImg: true, dirty: false });
      this._ideActivate(this._openFiles.length - 1);
      const frame = document.getElementById('ti-preview-frame');
      if (frame) {
        frame.style.display    = '';
        frame.style.visibility = 'visible';
        frame.style.zIndex     = '20';
        frame.srcdoc = `<html><body style="margin:0;background:#0a2239;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${url}" style="max-width:100%;max-height:100vh;"></body></html>`;
      }
      const ed = document.getElementById('ti-editor');
      if (ed) ed.style.display = 'none';
      return;
    }

    this._openFiles.push({ name, path: filepath, folder, type, content: '', dirty: false, loading: true, serverSize });
    const idx = this._openFiles.length - 1;
    this._ideActivate(idx);
    this._setStatus(`Loading ${name}...`);

    (async () => {
      let content = '';
      let loadError = null;
      try {
        let resp;
        if (filepath) {
          resp = await fetch('/api/files/read?path=' + encodeURIComponent(filepath));
          const isJson = (resp.headers.get('content-type') || '').includes('application/json');
          if (!resp.ok) {
            // Server returned an error — surface it instead of silently
            // turning `d.error` into an empty string.
            const errBody = isJson ? await resp.json().catch(() => ({})) : await resp.text().catch(() => '');
            const errMsg = (errBody && errBody.error) || (typeof errBody === 'string' && errBody.slice(0, 200)) || `HTTP ${resp.status}`;
            throw new Error(errMsg);
          }
          const d = isJson ? await resp.json() : { content: await resp.text() };
          if (d.error) throw new Error(d.error);
          content = typeof d.content === 'string' ? d.content : JSON.stringify(d.content ?? '', null, 2);
        } else {
          const ep = type === 'input' ? 'inputs' : 'outputs';
          resp = await fetch(`/api/v2/projects/${folder}/${ep}/${encodeURIComponent(name)}`);
          if (!resp.ok) {
            const isJson = (resp.headers.get('content-type') || '').includes('application/json');
            const errBody = isJson ? await resp.json().catch(() => ({})) : await resp.text().catch(() => '');
            const errMsg = (errBody && errBody.error) || (typeof errBody === 'string' && errBody.slice(0, 200)) || `HTTP ${resp.status}`;
            throw new Error(errMsg);
          }
          content = await resp.text();
        }
        console.info('[IDE] file loaded', name, 'bytes=' + content.length, 'via=' + (filepath ? '/api/files/read' : '/api/v2/projects/'));
      } catch (e) {
        loadError = e.message;
        content = `⚠️  Could not load ${name}\n\n**${e.message}**\n\nRequested path: ${filepath || '(from project endpoint)'}`;
        console.warn('[IDE] file load failed', name, e.message);
      }
      const f = this._openFiles[idx];
      if (f) {
        f.content = content;
        f.loading = false;
        f._loadError = loadError;
      }
      if (this._activeFileIdx === idx) {
        // Re-activate with loaded content — _ideActivate handles all file types
        this._ideActivate(idx);
        this._setStatus(loadError ? `Error: ${loadError}` : `${name} loaded (${content.length}B)`);
      }
    })();
  },

  _ideActivate(idx) {
    if (idx < 0 || idx >= this._openFiles.length) return;
    const ed = document.getElementById('ti-editor');
    // Only capture the editor's value if we are SWITCHING to a different
    // file AND the editor is actually visible. Without both guards, the
    // re-activation triggered by the async file-load completion would
    // clobber the just-loaded content with the empty textarea value —
    // that's exactly what caused "(empty file)" to show for real files.
    if (ed && ed.style.display !== 'none'
        && this._activeFileIdx >= 0
        && this._activeFileIdx !== idx
        && this._openFiles[this._activeFileIdx]) {
      this._openFiles[this._activeFileIdx].content = ed.value;
    }
    this._activeFileIdx = idx;
    const f       = this._openFiles[idx];
    const rPanel  = document.getElementById('ti-reasoning-panel');
    const frame   = document.getElementById('ti-preview-frame');
    const toolbar = document.getElementById('ti-ide-toolbar');
    const fnEl    = document.getElementById('ti-ide-fname');
    const prevBtn = document.getElementById('ti-prev-toggle');
    const status  = document.getElementById('ti-ide-status');

    const isMd   = /\.(md|markdown)$/i.test(f.name);
    const isHtml = /\.html?$/i.test(f.name);
    const isJson = /\.json$/i.test(f.name);
    const isPy   = /\.py$/i.test(f.name);
    const isJs   = /\.(js|mjs|cjs|ts)$/i.test(f.name);
    const isShell= /\.(sh|bash|zsh)$/i.test(f.name);
    const isCode = isPy || isJs || isShell ||
                   /\.(rs|go|java|cpp|c|h|css|yaml|yml|toml|ini|rb|php|swift|kt|r)$/i.test(f.name);

    // Decide DEFAULT mode: markdown/html → preview, everything else → editor.
    // Per-file override stored in f._previewMode after user toggles.
    if (typeof f._previewMode === 'undefined') {
      f._previewMode = (isMd || isHtml || f.isImg);
    }
    const showPreview = f._previewMode;

    // Reasoning panel goes BEHIND (z-index 1) so the editor/preview at z:5 is on top
    if (rPanel) {
      rPanel.style.zIndex = '1';
    }

    // Reset ALL three layers to a known hidden state before showing one.
    // Use both display AND visibility so a stale frame can't bleed through,
    // and give each layer a distinct z-index band so ordering is never
    // ambiguous (reasoning < preview < editor).
    if (rPanel) { rPanel.style.zIndex = '1'; }
    if (ed)     { ed.style.display = 'none';    ed.style.visibility = 'hidden';    ed.style.zIndex = '30'; ed.classList.remove('with-gutter'); }
    if (frame)  { frame.style.display = 'none'; frame.style.visibility = 'hidden'; frame.style.zIndex = '20'; }
    const hlEl  = document.getElementById('ti-editor-hl');
    const gutEl = document.getElementById('ti-editor-gutter');
    if (hlEl)  { hlEl.style.display = 'none'; }
    if (gutEl) { gutEl.style.display = 'none'; }

    // Wire up file metadata UI
    if (fnEl) fnEl.textContent = f.name + (f.dirty ? ' ●' : '');
    if (toolbar) toolbar.style.display = 'flex';

    // Hide PREVIEW button for images (no editing makes sense) and when no
    // alternate view exists (plain .txt has no syntax highlight branch)
    if (prevBtn) {
      prevBtn.style.display = (f.isImg ? 'none' : '');
      prevBtn.textContent = showPreview ? 'EDIT' : 'PREVIEW';
    }

    if (f.isImg) {
      // Images: preview only, with an action bar (upscale / edit) overlaid.
      if (frame) {
        frame.style.display    = 'block';
        frame.style.visibility = 'visible';
        frame.style.zIndex     = '20';
        const fp = (f.path || '').replace(/'/g, "\\'");
        const nm = (f.name || '').replace(/'/g, "\\'");
        frame.srcdoc = `<html><body style="margin:0;background:#020810;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;position:relative;">
          <img src="${f.imgUrl}" style="max-width:100%;max-height:100%;object-fit:contain;">
          <div style="position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:8px;">
            <button onclick="parent.TempleInterior._upscaleImage('${fp}','${nm}')"
              style="background:rgba(6,255,165,0.15);border:1px solid rgba(6,255,165,0.4);color:#06ffa5;border-radius:6px;padding:6px 14px;font-size:12px;font-family:sans-serif;font-weight:700;cursor:pointer;backdrop-filter:blur(4px);">↑ UPSCALE</button>
            <button onclick="parent.TempleInterior._editImage('${fp}','${nm}')"
              style="background:rgba(79,172,254,0.15);border:1px solid rgba(79,172,254,0.4);color:#4facfe;border-radius:6px;padding:6px 14px;font-size:12px;font-family:sans-serif;font-weight:700;cursor:pointer;backdrop-filter:blur(4px);">✎ EDIT</button>
          </div>
        </body></html>`;
      }
      if (status) status.textContent = f.name + ' [IMAGE]';
      return;
    }

    if (showPreview) {
      // ── PREVIEW MODE ──
      if (frame) { frame.style.display = 'block'; frame.style.visibility = 'visible'; frame.style.zIndex = '20'; }
      // Diagnostic: if server said the file was N > 0 bytes but the client
      // ended up with an empty content string, surface a specific message
      // instead of the misleading "(empty file)" placeholder.
      const emptyExplained = () => {
        if (f.loading) return '*Loading…*';
        if (f.content) return f.content;
        if (f.serverSize && f.serverSize > 0) {
          console.warn('[IDE] empty content but server reported', f.serverSize, 'bytes for', f.name);
          return `⚠️  **Empty response**\n\nServer listing says this file is **${f.serverSize} bytes**, but the loader returned zero bytes.\n\nLikely causes:\n- The read endpoint sent JSON \`{content:""}\` — check server logs for a permissions error on ${f.path || f.name}.\n- The file was deleted or renamed between listing and read.\n- Middleware stripped the body.\n\nTry the EDIT button to see the raw editor value, and check DevTools console for network errors.`;
        }
        return '*(empty file — 0 bytes on disk)*';
      };
      if (isMd) {
        this._renderMarkdownPreview(emptyExplained());
        if (status) status.textContent = f.name + ' [MARKDOWN PREVIEW]';
      } else if (isHtml) {
        if (frame) frame.srcdoc = f.loading ? '<p>Loading…</p>' : (f.content || '<p>(empty)</p>');
        if (status) status.textContent = f.name + ' [HTML PREVIEW]';
      } else if (isCode) {
        const fileLang = f.name.match(/\.(\w+)$/)?.[1] || 'text';
        this._renderCodePreview(f.loading ? '// Loading…' : (f.content || `// (empty file — server size: ${f.serverSize || 0} B)`), fileLang);
        if (status) status.textContent = f.name + ' [' + fileLang.toUpperCase() + ' SYNTAX]';
      } else {
        // Plain text fallback — render as <pre>
        if (frame) frame.srcdoc = `<html><body style="margin:0;background:#0a1628;color:#c8d8f0;padding:14px;"><pre style="font-family:'Courier New',monospace;font-size:13px;white-space:pre-wrap;word-break:break-word;">${
          (f.content || `(empty file — server size: ${f.serverSize || 0} B)`).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        }</pre></body></html>`;
        if (status) status.textContent = f.name + ' [TEXT]';
      }
    } else {
      // ── EDIT MODE ── always use the textarea
      if (frame)  { frame.style.display = 'none'; frame.style.visibility = 'hidden'; }
      if (rPanel) rPanel.style.zIndex = '0';
      if (ed) {
        ed.style.display    = 'block';
        ed.style.visibility = 'visible';
        ed.style.zIndex     = '30';
        ed.value = f.loading ? '' : (f.content || '');
        const fileLang = f.name.match(/\.(\w+)$/)?.[1] || 'text';
        ed.setAttribute('data-lang', fileLang);
        if (f.loading) ed.placeholder = 'Loading…'; else ed.placeholder = '';
        // Syntax highlight + line-number layers (VS-Code-style). Shown for
        // every text file; _ideSyncHighlight decides whether Prism colours
        // apply (known language) or the textarea stays plainly readable.
        const hlEl  = document.getElementById('ti-editor-hl');
        const gutEl = document.getElementById('ti-editor-gutter');
        if (hlEl)  hlEl.style.display  = 'block';
        if (gutEl) gutEl.style.display = 'block';
        ed.classList.add('with-gutter');
        this._ideSyncHighlight();
        setTimeout(() => {
          try {
            ed.focus();
            const r = ed.getBoundingClientRect();
            console.info('[IDE] editor shown', f.name, `${Math.round(r.width)}x${Math.round(r.height)}px`, 'val=' + ed.value.length + 'B', 'display=' + getComputedStyle(ed).display, 'vis=' + getComputedStyle(ed).visibility);
          } catch {}
        }, 0);
      }
      const langLabel = f.name.match(/\.(\w+)$/)?.[1]?.toUpperCase() || 'TEXT';
      if (status) status.textContent = f.name + ' [' + langLabel + ' EDIT]';
    }
    console.info('[IDE] activated', f.name, 'mode=' + (showPreview ? 'preview' : 'edit'), 'content=' + (f.content?.length || 0) + 'B', 'loading=' + !!f.loading);
    // Refresh the tabbar (tab underline, close buttons) — regression risk if omitted
    this._renderIdeTabs();
  },

  // Toggle between preview and editor for the current file
  _ideTogglePreview() {
    if (this._activeFileIdx < 0 || this._activeFileIdx >= this._openFiles.length) {
      console.warn('[IDE] toggle preview ignored — no active file (idx=' + this._activeFileIdx + ')');
      return;
    }
    const f = this._openFiles[this._activeFileIdx];
    if (!f) { console.warn('[IDE] toggle preview — file object missing'); return; }
    // Save current editor content before swapping out — but ONLY if the
    // editor is the visible view. In preview mode the textarea is
    // display:none and reading its (stale/empty) value here would clobber
    // the real content, which is what made the file look like it "closed"
    // / went blank when clicking EDIT.
    const ed = document.getElementById('ti-editor');
    if (ed && ed.style.display !== 'none' && !f._previewMode) {
      f.content = ed.value;
    }
    f._previewMode = !f._previewMode;
    console.info('[IDE] toggled', f.name, '→', f._previewMode ? 'preview' : 'edit', 'content=' + (f.content?.length || 0) + 'B');
    this._ideActivate(this._activeFileIdx);
  },

  _renderMarkdownPreview(md) {
    const frame = document.getElementById('ti-preview-frame');
    if (!frame) return;
    // Simple markdown → HTML renderer (no external deps)
    const html = md
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/^#{6}\s(.+)$/gm,'<h6>$1</h6>')
      .replace(/^#{5}\s(.+)$/gm,'<h5>$1</h5>')
      .replace(/^#{4}\s(.+)$/gm,'<h4>$1</h4>')
      .replace(/^#{3}\s(.+)$/gm,'<h3>$1</h3>')
      .replace(/^#{2}\s(.+)$/gm,'<h2>$1</h2>')
      .replace(/^#{1}\s(.+)$/gm,'<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`([^`]+)`/g,'<code>$1</code>')
      .replace(/^```[\w]*\n?([\s\S]*?)```/gm,'<pre><code>$1</code></pre>')
      .replace(/^- (.+)$/gm,'<li>$1</li>').replace(/(<li>.*<\/li>\n?)+/g,'<ul>$&</ul>')
      .replace(/^\d+\. (.+)$/gm,'<li>$1</li>')
      .replace(/^\|(.+)\|$/gm, row => '<tr>' + row.slice(1,-1).split('|').map(c=>`<td>${c.trim()}</td>`).join('') + '</tr>')
      .replace(/(<tr>.*<\/tr>\n?)+/g, t => `<table>${t}</table>`)
      .replace(/^---+$/gm,'<hr>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank">$1</a>')
      .replace(/\n\n+/g,'</p><p>')
      .replace(/\n/g,'<br>');
    frame.srcdoc = `<!DOCTYPE html><html><head><style>
      body{margin:0;padding:14px;background:#0a1628;color:#c8d8f0;font-family:'Segoe UI',sans-serif;font-size:12px;line-height:1.7;}
      h1,h2,h3,h4{color:#4facfe;margin:.5em 0 .3em;}
      h1{font-size:1.5em;border-bottom:1px solid #1e3a5f;padding-bottom:.2em;}
      h2{font-size:1.2em;}
      code{background:#0f2340;color:#00ffb4;padding:1px 5px;border-radius:3px;font-family:'Courier New',monospace;}
      pre{background:#0f2340;border:1px solid #1e3a5f;border-radius:5px;padding:10px;overflow-x:auto;}
      pre code{background:none;padding:0;}
      table{border-collapse:collapse;width:100%;margin:.5em 0;}
      td,th{border:1px solid #1e3a5f;padding:4px 8px;}
      tr:nth-child(even){background:#0f2340;}
      ul{padding-left:1.5em;}
      a{color:#4facfe;}
      hr{border:none;border-top:1px solid #1e3a5f;}
      p{margin:.4em 0;}
    </style></head><body><p>${html}</p></body></html>`;
  },

  _renderCodePreview(code, lang) {
    const frame = document.getElementById('ti-preview-frame');
    if (!frame) return;

    // Minimal syntax highlighting via regex
    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    const keywords = {
      py:   /\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|is|None|True|False|pass|break|continue|raise|try|except|finally|with|as|lambda|yield|async|await|self|print|len|range|type|str|int|float|list|dict|set|tuple)\b/g,
      js:   /\b(function|const|let|var|return|if|else|for|while|do|in|of|class|extends|import|export|default|new|this|typeof|instanceof|null|undefined|true|false|async|await|try|catch|finally|throw|switch|case|break|continue|=>)\b/g,
      json: /("[\w\-]+")\s*:/g,
      sh:   /\b(echo|if|then|else|fi|for|do|done|while|case|esac|function|export|local|return|source|exit)\b/g,
    };

    let highlighted = esc(code);
    const kw = keywords[lang] || keywords.py;

    // Strings
    highlighted = highlighted.replace(/(&#39;.*?&#39;|&quot;.*?&quot;|`[^`]*`)/g, '<span class="ck-str">$1</span>');
    // Comments
    if (['py','sh'].includes(lang))
      highlighted = highlighted.replace(/(#[^\n]*)/g, '<span class="ck-cmt">$1</span>');
    if (['js','ts','java','c','cpp'].includes(lang))
      highlighted = highlighted.replace(/(\/\/[^\n]*)/g, '<span class="ck-cmt">$1</span>');
    // Numbers
    highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span class="ck-num">$1</span>');
    // Keywords (applied to raw escaped text)
    highlighted = highlighted.replace(kw, '<span class="ck-kw">$&</span>');
    // Function/class names
    highlighted = highlighted.replace(/\b([a-zA-Z_]\w*)\s*(?=\()/g, '<span class="ck-fn">$1</span>');
    // Line numbers
    const lines = highlighted.split('\n');
    const numbered = lines.map((l, i) =>
      `<span class="ln">${String(i+1).padStart(4,' ')}</span>${l}`
    ).join('\n');

    frame.srcdoc = `<!DOCTYPE html><html><head><style>
      body { margin:0; background:#1e2127; color:#abb2bf; font-family:'JetBrains Mono','Fira Code','Consolas','Courier New',monospace; font-size:12px; line-height:1.7; overflow-x:auto; }
      pre  { margin:0; padding:12px 0; white-space:pre; }
      .ln  { display:inline-block; width:3em; color:#4a5568; text-align:right; padding-right:1em; margin-right:.5em; border-right:1px solid #2d3748; user-select:none; }
      .ck-kw  { color:#c678dd; font-weight:600; }
      .ck-str { color:#98c379; }
      .ck-cmt { color:#5c6370; font-style:italic; }
      .ck-num { color:#d19a66; }
      .ck-fn  { color:#61afef; }
      ::selection { background:#3d4a5f; }
    </style></head><body><pre>${numbered}</pre></body></html>`;
  },


  _renderIdeTabs() {
    const bar     = document.getElementById('ti-ide-tabbar');
    const noTabs  = document.getElementById('ti-ide-notabs');
    const toolbar = document.getElementById('ti-ide-toolbar');
    if (!bar) return;
    bar.querySelectorAll('.ti-ide-filetab').forEach(t => t.remove());

    if (!this._openFiles.length) {
      if (noTabs)  { noTabs.style.display = ''; noTabs.textContent = 'LIVE STREAM'; }
      if (toolbar) toolbar.style.display = 'none';
      // Bring reasoning back to front
      const rPanel = document.getElementById('ti-reasoning-panel');
      const ed     = document.getElementById('ti-editor');
      const frame  = document.getElementById('ti-preview-frame');
      if (rPanel) rPanel.style.zIndex = '3';
      if (ed)     ed.style.display    = 'none';
      if (frame)  frame.style.display = 'none';
      const fnEl = document.getElementById('ti-ide-fname');
      if (fnEl) fnEl.textContent = '';
      const status = document.getElementById('ti-ide-status');
      if (status) status.textContent = 'LIVE';
      return;
    }

    if (noTabs) noTabs.style.display = 'none';
    if (toolbar) toolbar.style.display = 'flex';
    // Push reasoning panel BEHIND the editor/preview (z-index 2). Without
    // this, opening a .md or any text file loaded its content into the
    // hidden frame but the reasoning panel (z-index 3 from the previous
    // "no files" state) stayed on top and covered it — the user saw
    // "nothing happens" even though the file was correctly loaded.
    const rPanel = document.getElementById('ti-reasoning-panel');
    if (rPanel) rPanel.style.zIndex = '1';

    this._openFiles.forEach((f, i) => {
      const btn = document.createElement('button');
      btn.className = `ti-ide-filetab${i === this._activeFileIdx ? ' active' : ''}${f.dirty ? ' dirty' : ''}`;
      btn.title = f.name + ' — middle-click to close';
      btn.innerHTML = `${this._esc(f.name.slice(0, 20))}${f.dirty ? ' ●' : ''} <span class="ti-ide-tabclose" onclick="event.stopPropagation();TempleInterior._ideClose(${i})">×</span>`;
      btn.onclick = () => this._ideActivate(i);
      btn.onmousedown = (e) => { if (e.button === 1) { e.preventDefault(); this._ideClose(i); } };
      bar.appendChild(btn);
    });
  },

  // ── Live reasoning panel ────────────────────────────────────────────────────
  // Show reasoning panel (default) — hide file editor
  // ── Project chatbox — send instruction to Poseidon with project context ─────
  async _projChatSend() {
    const input  = document.getElementById('ti-proj-chat-input');
    const log    = document.getElementById('ti-proj-chat-log');
    if (!input || !log) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';

    const proj = this.currentTemple?.name || '';

    // User bubble
    const userEl = document.createElement('div');
    userEl.style.cssText = 'color:#c8d8f0;margin:2px 0;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.05);';
    userEl.textContent = '› ' + text;
    log.appendChild(userEl);
    log.scrollTop = log.scrollHeight;

    // Reply bubble (streaming)
    const replyEl = document.createElement('div');
    replyEl.style.cssText = 'color:#4facfe;margin:2px 0;font-size:9px;white-space:pre-wrap;word-break:break-word;';
    replyEl.textContent = '⬡ …';
    log.appendChild(replyEl);
    log.scrollTop = log.scrollHeight;

    const ctxMsg = text;

    try {
      const res = await fetch('/api/v2/poseidon/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: ctxMsg,
          history: [],
          project: proj ? { name: proj, id: this.currentTemple?.project_id || null } : null,
        })
      });
      if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', reply = '', evName = null;
      replyEl.textContent = '⬡ ';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          // SSE: an `event:` line names the NEXT data payload. Default
          // (unnamed) events are the actual reply text; `thinking` events
          // also carry {text} and previously leaked into this log.
          if (line.startsWith('event:')) { evName = line.slice(6).trim(); continue; }
          if (!line.startsWith('data:')) continue;
          const isDefault = !evName || evName === 'message';
          const currentEv = evName; evName = null;   // event applies to this data only
          if (!isDefault) {
            if (currentEv === 'error') {
              try { const d = JSON.parse(line.slice(5).trim()); replyEl.textContent = '⬡ ✗ ' + (d.error || 'error'); } catch {}
            }
            continue;
          }
          try {
            const d = JSON.parse(line.slice(5).trim());
            if (d.text) { reply += d.text; replyEl.textContent = '⬡ ' + reply; log.scrollTop = log.scrollHeight; }
          } catch {}
        }
      }
      if (!reply) replyEl.textContent = '⬡ (no response)';
    } catch (e) {
      replyEl.style.color = '#ef4444';
      replyEl.textContent = 'Error: ' + e.message;
    }
    log.scrollTop = log.scrollHeight;
  },


  _showReasoning() {
    const editor  = document.getElementById('ti-editor');
    const preview = document.getElementById('ti-preview-frame');
    const fname   = document.getElementById('ti-ide-fname');
    const saveBtn = document.getElementById('ti-ide-save-btn');
    if (editor)  editor.style.display  = 'none';
    if (preview) preview.style.display = 'none';
    if (fname)   fname.textContent = 'AGENT REASONING';
    if (saveBtn) saveBtn.style.display = 'none';
    // Restart stream if not running
    const panel = document.getElementById('ti-reasoning-panel');
    if (panel && !this._reasoningEvtSource) this._startReasoningStream(panel);
  },

  // Show file editor — reasoning panel stays in background
  _showEditor(fileName) {
    const editor  = document.getElementById('ti-editor');
    const fname   = document.getElementById('ti-ide-fname');
    const saveBtn = document.getElementById('ti-ide-save-btn');
    if (editor)  { editor.style.display = ''; }
    if (fname)   fname.textContent = fileName || '—';
    if (saveBtn) saveBtn.style.display = '';
  },

  // Toggle SSE stream on/off — reasoning panel stays visible either way
  /**
   * Focus mode: hide left + right panels, expand center IDE.
   * Useful for reading long outputs or editing files without distraction.
   * Toggled via button or F11 key.
   */
  _toggleFocus() {
    const root = document.getElementById('temple-interior');
    if (!root) return;
    const isFocus = root.classList.toggle('ti-focus-mode');
    const btn = document.getElementById('ti-focus-btn');
    if (btn) btn.textContent = isFocus ? '⤢ EXIT FOCUS' : '⛶ FOCUS';
    // Trigger reasoning + editor resize after layout settles
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  },

  _closeAllFiles() {
    // Save current file first
    const ed = document.getElementById('ti-editor');
    if (ed && this._activeFileIdx >= 0 && this._openFiles[this._activeFileIdx]) {
      this._openFiles[this._activeFileIdx].content = ed.value;
    }
    this._openFiles = [];
    this._activeFileIdx = -1;
    this._renderIdeTabs(); // will restore reasoning to front
  },

  _toggleReasoningStream() {
    const btn = document.getElementById('ti-reasoning-toggle');
    const panel = document.getElementById('ti-reasoning-panel');
    if (!panel) return;
    if (this._reasoningEvtSource) {
      // Stop stream
      this._reasoningEvtSource.close();
      this._reasoningEvtSource = null;
      if (btn) { btn.style.background = ''; btn.style.color = '#00ffb4'; btn.style.borderColor = 'rgba(0,255,180,0.3)'; btn.textContent = '● LIVE'; }
    } else {
      // Start stream
      this._startReasoningStream(panel);
      if (btn) { btn.style.background = '#00ffb4'; btn.style.color = '#020810'; btn.style.borderColor = '#00ffb4'; btn.textContent = '⏹ STOP'; }
    }
  },

  // Legacy alias
  _toggleReasoning() { this._toggleReasoningStream(); },

  _startReasoningStream(panel) {
    if (this._reasoningEvtSource) this._reasoningEvtSource.close();

    // Rolling buffer: keep last 200 events max
    if (!this._reasoningLog) this._reasoningLog = [];
    if (!this._reasoningCollapsed) this._reasoningCollapsed = {};
    const log = this._reasoningLog;
    const self = this;

    // Toggle a task group's collapsed state (called via inline onclick)
    if (!window._tiReasonToggle) {
      window._tiReasonToggle = (tid) => {
        self._reasoningCollapsed[tid] = !self._reasoningCollapsed[tid];
        render();
      };
    }

    const renderEvent = (e) => {
      if (e.type === 'thinking_start') return `<div style="color:#7c3aed;margin-top:6px;font-size:9px;opacity:0.7;">⟨think⟩</div>`;
      if (e.type === 'thinking')       return `<span style="color:#a78bfa;white-space:pre-wrap;opacity:0.85;">${this._escR(e.chunk)}</span>`;
      if (e.type === 'thinking_end')   return `<div style="color:#7c3aed;font-size:9px;opacity:0.7;">⟨/think⟩</div>`;
      if (e.type === 'text')           return `<span style="color:#e2e8f0;white-space:pre-wrap;">${this._escR(e.chunk)}</span>`;
      if (e.type === 'tool_call')  {
        const argsStr = Object.entries(e.args || {}).map(([k,v]) => {
          const vs = typeof v === 'string' ? v : JSON.stringify(v);
          return `<span style="color:#94a3b8;">${this._escR(k)}</span>: <span style="color:#c8d8f0;">${this._escR(vs.slice(0,300))}${vs.length>300?'…':''}</span>`;
        }).join('<br>&nbsp;&nbsp;');
        return `<div style="background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:4px;padding:4px 8px;margin:3px 0;font-size:9px;">
          <div style="color:#fbbf24;font-weight:bold;margin-bottom:2px;">⚡ ${this._escR(e.name)}</div>
          ${argsStr ? `<div style="color:#64748b;border-left:2px solid rgba(245,158,11,0.2);padding-left:8px;word-break:break-all;line-height:1.5;">${argsStr}</div>` : ''}
        </div>`;
      }
      if (e.type === 'tool_result') return `<div style="color:${e.ok ? '#34d399' : '#f87171'};font-size:9px;padding:2px 8px;border-left:2px solid ${e.ok?'#34d399':'#f87171'};margin:2px 0 2px 10px;word-break:break-word;">${e.ok ? '✓' : '✗'} ${this._escR((e.summary||'').slice(0,400))}${(e.summary||'').length>400?'…':''}</div>`;
      return '';
    };

    const render = () => {
      // Do NOT bail early if display is 'none' — the caller might have hidden
      // the panel programmatically (file open, etc.) but the log should still
      // render so it's ready the moment the panel is un-hidden. We only skip
      // if the panel itself was removed from the DOM.
      if (!panel.isConnected) return;
      // Ensure the panel is visible: some paths could have set display:none
      // as a side-effect (e.g. bad CSS interaction). Enforce.
      if (panel.style.display === 'none') panel.style.display = 'block';

      // Group events by task_id with start/end markers
      const groups = [];
      let current = null;
      for (const e of log) {
        if (e.type === 'connected') continue;
        // task_lifecycle events go to notifications, not the reasoning panel
        if (e.type === 'task_lifecycle') continue;
        if (e.type === 'task_start') {
          if (current) groups.push(current);
          current = { task_id: e.task_id || 'unknown', title: e.title || e.task_id || 'task', agent: e.agent || '', events: [], ended: false };
        } else if (e.type === 'task_end') {
          if (current) { current.ended = true; groups.push(current); current = null; }
        } else if (current) {
          current.events.push(e);
        } else {
          // orphan events (no task_start) — make a default group
          current = { task_id: 'orphan', title: 'reasoning', agent: '', events: [e], ended: false };
        }
      }
      if (current) groups.push(current);

      // Render each group
      const groupsHtml = groups.map((g, i) => {
        const collapsed = this._reasoningCollapsed[g.task_id + '_' + i];
        const statusIcon = g.ended ? '✓' : '●';
        const statusColor = g.ended ? '#06ffa5' : '#fbbf24';
        const arrow = collapsed ? '▶' : '▼';
        const header = `<div onclick="window._tiReasonToggle('${g.task_id + '_' + i}')"
          style="cursor:pointer;margin-top:12px;border-top:1px solid #1e3a5f;padding:6px 0 4px;color:#4facfe;font-weight:600;display:flex;align-items:center;gap:6px;font-size:10px;">
          <span style="color:#64748b;">${arrow}</span>
          <span style="color:${statusColor};">${statusIcon}</span>
          <span style="flex:1;">${this._escR(g.title.slice(0, 60))}</span>
          ${g.agent ? `<span style="color:#94a3b8;font-size:9px;font-weight:normal;">${this._escR(g.agent)}</span>` : ''}
          <span style="color:#64748b;font-size:8px;font-weight:normal;">${g.events.length}</span>
        </div>`;
        if (collapsed) return header;
        const events = g.events.map(e => renderEvent.call(this, e)).join('');
        return header + `<div style="padding-left:6px;">${events}</div>`;
      }).join('');

      // Empty state — MUST be highly visible so the user can tell whether
      // the panel is empty because nothing has happened OR because the panel
      // itself is broken. Includes readyState + event count for diagnosis.
      const isConnected = !!this._reasoningEvtSource && this._reasoningEvtSource.readyState === 1;
      const isConnecting = !!this._reasoningEvtSource && this._reasoningEvtSource.readyState === 0;
      const dotColor = isConnected ? '#06ffa5' : (isConnecting ? '#fbbf24' : '#ef4444');
      const stateLabel = isConnected ? 'LIVE FEED CONNECTED' : (isConnecting ? 'CONNECTING…' : 'DISCONNECTED — RETRYING');
      const totalEvents = log.length;
      const empty = groups.length === 0
        ? `<div style="color:#94a3b8;padding:32px 20px;text-align:center;font-family:var(--panel-font),sans-serif;">
            <div style="display:inline-flex;align-items:center;gap:10px;margin-bottom:14px;padding:8px 16px;border:1px solid ${dotColor};border-radius:6px;background:rgba(6,255,165,0.05);">
              <span style="width:10px;height:10px;border-radius:50%;background:${dotColor};box-shadow:0 0 8px ${dotColor};display:inline-block;animation:${isConnected ? 'ti-dot-pulse 2s ease-in-out infinite' : 'none'};"></span>
              <span style="color:${dotColor};font-weight:700;font-size:12px;letter-spacing:0.06em;">${stateLabel}</span>
            </div>
            <div style="color:#e2e8f0;font-size:13px;margin-bottom:6px;">Waiting for agent activity…</div>
            <div style="color:#64748b;font-size:11px;">Agent reasoning appears here when a task runs from the kanban.</div>
            <div style="color:#475569;font-size:10px;font-family:var(--panel-font-mono);margin-top:12px;opacity:0.7;">
              events received: ${totalEvents} · readyState: ${this._reasoningEvtSource?.readyState ?? 'no-es'}
            </div>
          </div>`
        : '';

      panel.innerHTML = `<div style="min-height:100%;">${empty}${groupsHtml}<div id="ti-reason-end"></div></div>`;
      const end = panel.querySelector('#ti-reason-end');
      if (end) end.scrollIntoView({ behavior: 'smooth', block: 'end' });
    };

    // Show existing log immediately
    render();

    // Connect SSE stream
    const es = new EventSource('/api/v2/reasoning/stream');
    this._reasoningEvtSource = es;

    es.onopen = () => {
      console.info('[TempleInterior] reasoning stream connected');
      render();  // refresh the empty-state badge to "connected"
    };

    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        log.push(ev);
        if (log.length > 200) log.splice(0, log.length - 200);
        render();
      } catch (err) {
        console.warn('[TempleInterior] bad SSE payload:', e.data?.slice?.(0, 120));
      }
    };

    es.onerror = () => {
      // Browser EventSource auto-retries. Re-render so the user sees the
      // "Disconnected — retrying" state instead of a stale connected badge.
      render();
    };
  },

  _escR(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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
    if (this._activeFileIdx >= 0) {
      this._ideActivate(this._activeFileIdx);
    } else {
      // No more open files — return to reasoning view
      this._showReasoning();
    }
  },

  // Called on every keystroke in the editor textarea (oninput). This was
  // referenced in the markup but never defined — so every keystroke threw
  // "TempleInterior._ideMarkDirty is not a function". Define it: sync the
  // buffer, flag dirty, update the tab marker.
  // ── Syntax highlighting (VS-Code-style overlay) ──────────────────────────
  // The textarea remains the source of truth; #ti-editor-hl renders the same
  // text through Prism with identical font metrics, and #ti-editor-gutter
  // shows line numbers. Called on show + every input (rAF-throttled).

  _ideLangFor(name) {
    const ext = (name || '').match(/\.(\w+)$/)?.[1]?.toLowerCase() || '';
    return ({
      py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript',
      ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
      json: 'json', md: 'markdown', markdown: 'markdown',
      html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup',
      css: 'css', sh: 'bash', bash: 'bash', zsh: 'bash',
      yml: 'yaml', yaml: 'yaml',
    })[ext] || null;
  },

  _ideSyncHighlight() {
    if (this._hlRaf) return;
    this._hlRaf = requestAnimationFrame(() => {
      this._hlRaf = null;
      const ed   = document.getElementById('ti-editor');
      const hl   = document.getElementById('ti-editor-hl');
      const code = document.getElementById('ti-editor-hl-code');
      const gut  = document.getElementById('ti-editor-gutter');
      if (!ed || !hl || !code) return;
      const f    = this._openFiles[this._activeFileIdx];
      const lang = f ? this._ideLangFor(f.name) : null;
      const src  = ed.value;

      if (window.Prism && lang && Prism.languages[lang]) {
        // Trailing newline: keep the last (empty) line rendered so heights match
        const toRender = src.endsWith('\n') ? src + ' ' : src;
        code.innerHTML = Prism.highlight(toRender, Prism.languages[lang], lang);
        ed.classList.add('hl-on');       // text transparent, caret visible
      } else {
        code.textContent = '';
        ed.classList.remove('hl-on');    // plain readable textarea (txt, no Prism)
      }

      // Line numbers
      if (gut) {
        const n = src.split('\n').length;
        if (gut._lineCount !== n) {
          gut._lineCount = n;
          let out = '';
          for (let i = 1; i <= n; i++) out += i + '\n';
          gut.textContent = out;
        }
      }
      this._ideSyncScroll();
    });
  },

  _ideSyncScroll() {
    const ed  = document.getElementById('ti-editor');
    const hl  = document.getElementById('ti-editor-hl');
    const gut = document.getElementById('ti-editor-gutter');
    if (!ed) return;
    if (hl)  { hl.scrollTop = ed.scrollTop; hl.scrollLeft = ed.scrollLeft; }
    if (gut) { gut.scrollTop = ed.scrollTop; }
  },

  _ideMarkDirty() {
    if (this._activeFileIdx < 0 || !this._openFiles[this._activeFileIdx]) return;
    const f  = this._openFiles[this._activeFileIdx];
    const ed = document.getElementById('ti-editor');
    if (ed) f.content = ed.value;   // keep the buffer in sync as the user types
    if (!f.dirty) {
      f.dirty = true;
      const fnEl = document.getElementById('ti-ide-fname');
      if (fnEl) fnEl.textContent = f.name + ' ●';
      this._renderIdeTabs();
    }
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
      const r = await fetch(`/api/v2/projects/${folder}/${ep}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: f.name, content: f.content, encoding: 'utf8' })
      });
      let j = {};
      try { j = await r.json(); } catch {}
      if (!r.ok || j.success === false) {
        // Don't clear the dirty flag — the save did NOT happen.
        this._setStatus(`Save failed (${r.status}): ${j.error || 'endpoint error'}`);
        return;
      }
      f.dirty = false;
      this._renderIdeTabs();
      this._setStatus(`Saved ${f.name} (${j.size ?? f.content.length} bytes)`);
    } catch (e) { this._setStatus(`Save failed: ${e.message}`); }
  },

  _ideNewFile() {
    this._createNewFile(this._folder());
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
    const deleted = this._deletedTaskIds || new Set();
    // Always filter out tasks marked for optimistic deletion (undo pending)
    const live = tasks.filter(t => !deleted.has(t.task_id));
    // If no project context, show all tasks (global view from aquarium)
    if (!pid && !pname) return live;
    return live.filter(t =>
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

  _relTime(iso) {
    if (!iso) return '';
    if (window.Format?.relativeTime) return window.Format.relativeTime(iso);
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60)    return `${s}s ago`;
    if (s < 3600)  return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    return `${Math.floor(s/86400)}d ago`;
  },

  _fmtSize(b) {
    if (!b) return '';
    if (window.Format?.bytes) return window.Format.bytes(b);
    if (b < 1024) return `${b}B`;
    if (b < 1048576) return `${(b/1024).toFixed(0)}K`;
    return `${(b/1048576).toFixed(1)}M`;
  },

  _esc(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
  },
  _escape(s) { return this._esc(s); },

  // Open a file that was clicked on a done/failed kanban card. Routes to the
  // same _openFile the output-list uses so the preview panel takes over.
  _openKanbanFile(name, filepath, ftype) {
    // Switch to the files tab so the IDE panel is visible, then open.
    if (this._leftTab !== 'files') this._switchLeft('files');
    // type param: _openFile uses 'output' vs 'input'; treat work/temp as output-adjacent
    const type = ftype === 'input' ? 'input' : 'output';
    this._openFile(name, filepath, type, this._folder());
  },

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

  /** Dismiss ONE finished task (done/failed/cancelled) from the board.
      Terminal tasks live in results_log.json, not the live registry, so the
      regular DELETE /tasks/:id would 404 — this hits the results endpoint. */
  async _dismissDoneTask(taskId) {
    try {
      await window.api._fetch(`/tasks/results/${taskId}`, { method: 'DELETE' });
      this._renderKanban(); this._renderHeader();
    } catch (e) { SquidModal.alert('Dismiss failed: ' + e.message); }
  },

  /** Clear ALL finished tasks currently on THIS board (project-scoped —
      other projects' results are untouched). */
  async _kClearDone() {
    const cards = [...document.querySelectorAll('#ti-kcol-done .ti-kcard[data-task-id]')];
    const ids = cards.map(c => c.dataset.taskId).filter(Boolean);
    if (!ids.length) return;
    const ok = await SquidModal.confirm(`Clear ${ids.length} finished task${ids.length > 1 ? 's' : ''} from this board? This removes them from the results history.`);
    if (!ok) return;
    try {
      await Promise.all(ids.map(id =>
        window.api._fetch(`/tasks/results/${id}`, { method: 'DELETE' }).catch(() => null)));
      this._setStatus(`Cleared ${ids.length} finished tasks`);
      this._renderKanban(); this._renderHeader();
    } catch (e) { SquidModal.alert('Clear failed: ' + e.message); }
  },
  getTempleBackground()  { return ''; },
  _initLeft(t)           { this._switchLeft(t); },
  _initRight(t)          { this._switchRight(t); },

  async assignSquid(squidId) {
    const projectId = this.currentTemple?.project_id;
    if (!projectId) { await SquidModal.alert('No project_id on this temple.'); return; }
    try {
      const pr = await window.api._fetch('/projects');
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
          await window.api._fetch('/field', { method: 'PATCH', body: JSON.stringify({
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
        await window.api._fetch('/field', { method: 'PATCH', body: JSON.stringify({
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
      const pr = await window.api._fetch('/projects');
      for (const [pid, p] of Object.entries(pr.registry.projects)) {
        if ((p.project_id===this.currentTemple?.project_id||p.name===this.currentTemple?.name) && Array.isArray(p.assigned_agents) && p.assigned_agents.includes(squidId)) {
          await window.api._fetch('/field', { method:'PATCH', body: JSON.stringify({
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
