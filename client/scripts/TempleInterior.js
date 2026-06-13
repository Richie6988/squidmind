/**
 * TempleInterior v3 — Project workspace cockpit
 * Full rewrite: proper CSS, live kanban, working IDE, agent sync
 */

/* ─── CSS injection (once) ─────────────────────────────────────────────── */
(function injectCSS() {
  if (document.getElementById('ti-styles')) return;
  const s = document.createElement('style');
  s.id = 'ti-styles';
  s.textContent = `
/* ── Layout ── */
.ti-root {
  position:fixed;inset:0;z-index:9999;
  display:flex;flex-direction:column;
  background:#070d17;
  font-family:'Courier New',monospace;
  color:#c8d6e5;
  animation:ti-fade .18s ease;
}
@keyframes ti-fade{from{opacity:0}to{opacity:1}}

/* ── Header ── */
.ti-hdr {
  display:flex;align-items:center;gap:10px;
  height:44px;min-height:44px;
  padding:0 14px;
  background:rgba(15,25,40,.95);
  border-bottom:1px solid rgba(79,172,254,.18);
  flex-shrink:0;
}
.ti-hdr-title {
  font-size:11px;font-weight:700;color:#e2e8f0;letter-spacing:.5px;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px;
}
.ti-hdr-id { font-size:8px;color:#475569;margin-left:6px; }
.ti-hdr-sep { flex:1; }
.ti-hdr-stat {
  font-size:8px;color:#64748b;
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.07);
  border-radius:5px;padding:2px 8px;white-space:nowrap;
}
.ti-hdr-stat b { color:#4facfe; }
.ti-hdr-btn {
  height:28px;padding:0 10px;border-radius:5px;border:1px solid rgba(255,255,255,.12);
  background:rgba(255,255,255,.05);color:#94a3b8;font-size:9px;cursor:pointer;
  display:flex;align-items:center;gap:4px;white-space:nowrap;
  transition:background .12s,color .12s;
}
.ti-hdr-btn:hover{background:rgba(79,172,254,.12);color:#4facfe;border-color:rgba(79,172,254,.3);}
.ti-hdr-btn-danger{border-color:rgba(239,68,68,.25);color:#f87171;}
.ti-hdr-btn-danger:hover{background:rgba(239,68,68,.12);color:#ef4444;border-color:rgba(239,68,68,.4);}
.ti-hdr-btn-accent{background:linear-gradient(135deg,rgba(79,172,254,.2),rgba(37,99,235,.2));border-color:rgba(79,172,254,.35);color:#4facfe;}
.ti-hdr-btn-accent:hover{background:linear-gradient(135deg,rgba(79,172,254,.3),rgba(37,99,235,.3));}

/* ── Body ── */
.ti-body {
  display:flex;flex:1;min-height:0;overflow:hidden;
}

/* ── Left panel ── */
.ti-left {
  width:272px;min-width:272px;display:flex;flex-direction:column;
  border-right:1px solid rgba(255,255,255,.06);
  background:rgba(8,16,28,.6);flex-shrink:0;overflow:hidden;
}

/* ── Center panel (IDE) ── */
.ti-center {
  flex:1;min-width:0;display:flex;flex-direction:column;
  border-right:1px solid rgba(255,255,255,.06);
  overflow:hidden;
}

/* ── Right panel ── */
.ti-right {
  width:304px;min-width:304px;display:flex;flex-direction:column;
  background:rgba(8,16,28,.6);flex-shrink:0;overflow:hidden;
}

/* ── Tab bars ── */
.ti-tabs {
  display:flex;align-items:center;
  height:36px;min-height:36px;
  padding:0 8px;gap:2px;
  background:rgba(0,0,0,.25);
  border-bottom:1px solid rgba(255,255,255,.06);
  flex-shrink:0;
}
.ti-tab {
  height:24px;padding:0 10px;border-radius:4px;border:none;
  background:transparent;color:#64748b;font-size:8.5px;cursor:pointer;
  font-family:inherit;transition:all .1s;white-space:nowrap;
}
.ti-tab:hover{color:#94a3b8;background:rgba(255,255,255,.05);}
.ti-tab.active{background:rgba(79,172,254,.12);color:#4facfe;border-bottom:2px solid #4facfe;}
.ti-tabs-right { margin-left:auto;display:flex;align-items:center;gap:4px; }
.ti-tab-sm {
  height:22px;padding:0 8px;border-radius:4px;border:1px solid rgba(255,255,255,.1);
  background:rgba(255,255,255,.04);color:#64748b;font-size:8px;cursor:pointer;
  font-family:inherit;transition:all .1s;
}
.ti-tab-sm:hover{background:rgba(79,172,254,.1);color:#4facfe;border-color:rgba(79,172,254,.25);}
.ti-tab-sm.green{border-color:rgba(34,197,94,.25);color:#22c55e;}
.ti-tab-sm.green:hover{background:rgba(34,197,94,.1);}

/* ── Scrollable content areas ── */
.ti-scroll { flex:1;overflow-y:auto;padding:8px; }
.ti-scroll::-webkit-scrollbar{width:4px;}
.ti-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px;}

/* ── Section heads inside panels ── */
.ti-sec-head {
  display:flex;align-items:center;justify-content:space-between;
  padding:8px 8px 4px;font-size:8px;color:#475569;letter-spacing:.8px;text-transform:uppercase;
}
.ti-sec-head-btn {
  height:20px;padding:0 7px;border-radius:3px;border:1px solid rgba(255,255,255,.1);
  background:rgba(255,255,255,.04);color:#64748b;font-size:8px;cursor:pointer;font-family:inherit;
}
.ti-sec-head-btn:hover{background:rgba(79,172,254,.1);color:#4facfe;}

/* ── File items ── */
.ti-file {
  display:flex;align-items:center;gap:6px;
  padding:5px 8px;border-radius:5px;cursor:pointer;
  transition:background .1s;min-width:0;
}
.ti-file:hover{background:rgba(79,172,254,.07);}
.ti-file.active{background:rgba(79,172,254,.12);border-left:2px solid #4facfe;}
.ti-file-icon{font-size:12px;flex-shrink:0;width:18px;text-align:center;}
.ti-file-thumb{width:28px;height:28px;object-fit:cover;border-radius:3px;flex-shrink:0;}
.ti-file-name{font-size:9px;color:#c8d6e5;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ti-file-size{font-size:7.5px;color:#475569;flex-shrink:0;}
.ti-file-del{
  width:18px;height:18px;border-radius:3px;border:none;
  background:transparent;color:#475569;font-size:9px;cursor:pointer;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .1s;
}
.ti-file:hover .ti-file-del{opacity:1;}
.ti-file-del:hover{background:rgba(239,68,68,.15);color:#ef4444;}

/* ── Drop zone ── */
.ti-drop-zone {
  border:1.5px dashed rgba(79,172,254,.2);border-radius:6px;
  padding:12px 8px;text-align:center;font-size:8.5px;color:#475569;
  margin:4px;transition:all .15s;cursor:pointer;
}
.ti-drop-zone:hover,.ti-drop-zone.drag-over{
  border-color:rgba(79,172,254,.5);background:rgba(79,172,254,.05);color:#4facfe;
}

/* ── Empty states ── */
.ti-empty{font-size:8.5px;color:#475569;padding:12px 8px;text-align:center;line-height:1.6;}

/* ── Agent rows ── */
.ti-agent-row {
  display:flex;align-items:center;gap:7px;
  padding:7px 8px;border-radius:6px;
  background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);
  margin-bottom:5px;transition:border-color .1s;
}
.ti-agent-row:hover{border-color:rgba(79,172,254,.2);}
.ti-agent-dot {
  width:7px;height:7px;border-radius:50%;flex-shrink:0;
}
.ti-agent-dot.run{background:#22c55e;box-shadow:0 0 6px #22c55e;}
.ti-agent-dot.idle{background:#475569;}
.ti-agent-dot.run.pulse{animation:ti-pulse 1.4s infinite;}
@keyframes ti-pulse{0%,100%{opacity:1}50%{opacity:.4}}
.ti-agent-name{font-size:9px;color:#c8d6e5;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ti-agent-spec{font-size:7.5px;color:#475569;}
.ti-agent-badge{font-size:7px;padding:1px 5px;border-radius:3px;border:1px solid;flex-shrink:0;}
.ti-agent-badge.run{color:#22c55e;border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.08);}
.ti-agent-badge.idle{color:#475569;border-color:rgba(71,85,105,.3);}
.ti-agent-dispatch{
  height:20px;padding:0 7px;border-radius:3px;border:1px solid rgba(79,172,254,.25);
  background:rgba(79,172,254,.08);color:#4facfe;font-size:7.5px;cursor:pointer;font-family:inherit;
  transition:all .1s;
}
.ti-agent-dispatch:hover{background:rgba(79,172,254,.18);}

/* ── Squid arena ── */
.ti-arena {
  position:relative;overflow:hidden;
  height:90px;margin:6px;border-radius:6px;
  background:rgba(79,172,254,.03);border:1px solid rgba(79,172,254,.08);
}
.ti-walker {
  position:absolute;pointer-events:none;
}
.ti-walker-name{
  font-size:7px;color:#64748b;text-align:center;margin-top:-2px;
  white-space:nowrap;font-family:inherit;
}

/* ── Memory editor ── */
.ti-mem-editor {
  flex:1;width:100%;min-height:200px;resize:none;
  background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.08);
  border-radius:5px;color:#c8d6e5;font-size:9px;padding:8px;
  font-family:'Courier New',monospace;line-height:1.5;box-sizing:border-box;
}
.ti-mem-editor:focus{outline:none;border-color:rgba(79,172,254,.3);}

/* ── IDE ── */
.ti-ide-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;}
.ti-ide-tabbar {
  display:flex;align-items:center;min-height:34px;
  background:rgba(0,0,0,.3);border-bottom:1px solid rgba(255,255,255,.06);
  padding:0 6px;gap:1px;flex-shrink:0;overflow-x:auto;overflow-y:hidden;
}
.ti-ide-tabbar::-webkit-scrollbar{height:0;}
.ti-ide-filetab {
  display:flex;align-items:center;gap:5px;
  height:26px;padding:0 10px;border-radius:4px 4px 0 0;
  border:1px solid transparent;border-bottom:none;
  background:rgba(255,255,255,.03);color:#64748b;font-size:9px;cursor:pointer;
  white-space:nowrap;flex-shrink:0;font-family:inherit;transition:all .1s;
}
.ti-ide-filetab:hover{background:rgba(255,255,255,.06);color:#94a3b8;}
.ti-ide-filetab.active{
  background:rgba(7,13,23,1);color:#e2e8f0;
  border-color:rgba(255,255,255,.08);
  border-bottom-color:rgba(7,13,23,1);
}
.ti-ide-filetab.dirty::before{content:'●';color:#f59e0b;margin-right:3px;font-size:8px;}
.ti-ide-close{
  width:14px;height:14px;border-radius:2px;border:none;
  background:transparent;color:#475569;font-size:9px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
}
.ti-ide-close:hover{background:rgba(239,68,68,.15);color:#ef4444;}
.ti-ide-notabs{font-size:8.5px;color:#475569;padding:0 8px;white-space:nowrap;}
.ti-ide-toolbar {
  display:flex;align-items:center;gap:6px;
  height:32px;padding:0 10px;
  background:rgba(0,0,0,.2);border-bottom:1px solid rgba(255,255,255,.05);
  flex-shrink:0;
}
.ti-ide-fname{font-size:8.5px;color:#64748b;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ti-ide-main{flex:1;min-height:0;display:flex;overflow:hidden;}
.ti-editor {
  flex:1;resize:none;
  background:transparent;border:none;
  color:#c8d6e5;font-size:11px;font-family:'Courier New',monospace;
  line-height:1.6;padding:12px 14px;
  tab-size:2;
}
.ti-editor:focus{outline:none;}
.ti-preview-frame {
  flex:1;border:none;background:#fff;
}
.ti-ide-status{
  height:22px;display:flex;align-items:center;padding:0 10px;
  font-size:8px;color:#475569;background:rgba(0,0,0,.3);
  border-top:1px solid rgba(255,255,255,.04);flex-shrink:0;
}

/* ── Kanban ── */
.ti-kanban-wrap{display:flex;flex-direction:column;height:100%;overflow:hidden;}
.ti-kanban-header{
  display:flex;align-items:center;justify-content:space-between;
  padding:6px 8px;flex-shrink:0;
  border-bottom:1px solid rgba(255,255,255,.05);
  font-size:8.5px;color:#64748b;
}
.ti-kanban-board{
  flex:1;display:flex;gap:0;min-height:0;overflow:hidden;
}
.ti-kanban-col{
  flex:1;display:flex;flex-direction:column;min-width:0;
  border-right:1px solid rgba(255,255,255,.04);overflow:hidden;
}
.ti-kanban-col:last-child{border-right:none;}
.ti-kanban-col-head {
  display:flex;align-items:center;justify-content:space-between;
  padding:5px 8px;font-size:8px;color:#64748b;letter-spacing:.5px;
  background:rgba(0,0,0,.15);border-bottom:1px solid rgba(255,255,255,.04);
  flex-shrink:0;
}
.ti-kanban-col-count{
  font-size:7.5px;padding:1px 5px;border-radius:10px;
  background:rgba(255,255,255,.06);color:#475569;
}
.ti-kanban-cards {
  flex:1;overflow-y:auto;padding:5px;display:flex;flex-direction:column;gap:4px;
}
.ti-kanban-cards::-webkit-scrollbar{width:3px;}
.ti-kanban-cards::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px;}
.ti-kanban-col.drag-over .ti-kanban-cards{background:rgba(79,172,254,.05);}

/* ── Kanban cards ── */
.ti-kcard {
  background:rgba(255,255,255,.04);
  border:1px solid rgba(255,255,255,.07);
  border-radius:5px;padding:7px 8px;cursor:pointer;
  transition:border-color .12s,transform .1s;
  position:relative;
}
.ti-kcard:hover{border-color:rgba(79,172,254,.25);transform:translateY(-1px);}
.ti-kcard.dragging{opacity:.4;transform:scale(.97);}
.ti-kcard.drag-over-top{border-top:2px solid #4facfe;}
.ti-kcard.drag-over-bot{border-bottom:2px solid #4facfe;}
.ti-kcard-title{font-size:9px;color:#c8d6e5;line-height:1.4;margin-bottom:4px;}
.ti-kcard-prog{font-size:7.5px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:3px;}
.ti-kcard-foot{display:flex;align-items:center;justify-content:space-between;margin-top:2px;}
.ti-kcard-agent{font-size:7.5px;color:#475569;}
.ti-kcard-del{
  width:16px;height:16px;border-radius:3px;border:none;
  background:transparent;color:#475569;font-size:8px;cursor:pointer;
  opacity:0;transition:opacity .1s;display:flex;align-items:center;justify-content:center;
}
.ti-kcard:hover .ti-kcard-del{opacity:1;}
.ti-kcard-del:hover{background:rgba(239,68,68,.15);color:#ef4444;}
.ti-kcard-bar{height:2px;border-radius:1px;background:rgba(79,172,254,.15);margin-top:5px;overflow:hidden;}
.ti-kcard-bar-fill{height:100%;background:linear-gradient(90deg,#4facfe,#2563eb);animation:ti-progress 2s linear infinite;}
@keyframes ti-progress{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
.ti-kcard-status{
  font-size:7px;padding:1px 5px;border-radius:3px;flex-shrink:0;
}
.ti-kcard-status.todo{background:rgba(71,85,105,.2);color:#64748b;}
.ti-kcard-status.running{background:rgba(79,172,254,.1);color:#4facfe;}
.ti-kcard-status.done{background:rgba(34,197,94,.1);color:#22c55e;}
.ti-kcard-status.failed{background:rgba(239,68,68,.1);color:#ef4444;}

/* ── Task list (right panel tasks tab) ── */
.ti-tasklist{padding:5px;}
.ti-task-row{
  display:flex;align-items:flex-start;gap:7px;
  padding:6px 8px;border-radius:5px;border:1px solid rgba(255,255,255,.05);
  background:rgba(255,255,255,.02);margin-bottom:4px;cursor:pointer;
  transition:border-color .1s;
}
.ti-task-row:hover{border-color:rgba(79,172,254,.2);}
.ti-task-sicon{font-size:10px;flex-shrink:0;margin-top:1px;}
.ti-task-info{flex:1;min-width:0;}
.ti-task-title{font-size:9px;color:#c8d6e5;line-height:1.3;}
.ti-task-sub{font-size:7.5px;color:#475569;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.ti-task-del{
  width:18px;height:18px;border-radius:3px;border:none;
  background:transparent;color:#475569;font-size:9px;cursor:pointer;
  flex-shrink:0;opacity:0;transition:opacity .1s;
}
.ti-task-row:hover .ti-task-del{opacity:1;}
.ti-task-del:hover{background:rgba(239,68,68,.15);color:#ef4444;}
.ti-task-bar{height:2px;border-radius:1px;background:rgba(79,172,254,.15);margin-top:4px;overflow:hidden;}
.ti-task-bar-fill{height:100%;background:linear-gradient(90deg,#4facfe,#2563eb);animation:ti-progress 2s linear infinite;}

/* ── New task quick form ── */
.ti-newtask{
  padding:8px;border-top:1px solid rgba(255,255,255,.05);flex-shrink:0;
}
.ti-newtask input{
  width:100%;box-sizing:border-box;background:rgba(0,0,0,.3);
  border:1px solid rgba(255,255,255,.1);border-radius:5px;
  color:#c8d6e5;font-size:9px;padding:6px 10px;font-family:inherit;
}
.ti-newtask input:focus{outline:none;border-color:rgba(79,172,254,.35);}
.ti-newtask input::placeholder{color:#475569;}

/* ── Utilities ── */
.ti-divider{height:1px;background:rgba(255,255,255,.05);margin:6px 0;}
.ti-chip{
  display:inline-flex;align-items:center;gap:3px;
  font-size:7.5px;padding:1px 6px;border-radius:10px;
  border:1px solid rgba(255,255,255,.1);color:#64748b;
  background:rgba(255,255,255,.04);
}
`;
  document.head.appendChild(s);
})();

/* ─── Main object ───────────────────────────────────────────────────────── */
const TempleInterior = {
  currentTemple: null,
  _openFiles:    [],
  _activeFileIdx: -1,
  _leftTab:  'files',
  _rightTab: 'kanban',
  _pollTimer: null,
  _rafMap:   {},
  _dragTaskId: null,

  // ═══ OPEN / CLOSE ════════════════════════════════════════════════════════
  open(temple) {
    this.currentTemple  = temple;
    this._openFiles     = [];
    this._activeFileIdx = -1;
    this._leftTab       = 'files';
    this._rightTab      = 'kanban';
    Object.values(this._rafMap).forEach(id => cancelAnimationFrame(id));
    this._rafMap = {};
    clearInterval(this._pollTimer);

    let root = document.getElementById('temple-interior');
    if (!root) {
      root = document.createElement('div');
      root.id = 'temple-interior';
      document.body.appendChild(root);
    }
    root.className = 'ti-root';
    root.style.display = 'flex';
    root.innerHTML = this._buildShell(temple);

    this._switchLeft('files');
    this._switchRight('kanban');
    this._renderHeader();

    // Live poll: kanban + agents + header stats every 4s
    this._pollTimer = setInterval(() => {
      this._renderHeader();
      if (this._leftTab  === 'agents') this._renderAgents();
      if (this._rightTab === 'kanban') this._renderKanban();
      if (this._rightTab === 'tasks')  this._renderTasks();
    }, 4000);
  },

  close() {
    clearInterval(this._pollTimer);
    Object.values(this._rafMap).forEach(id => cancelAnimationFrame(id));
    this._rafMap = {};
    const root = document.getElementById('temple-interior');
    if (root) root.style.display = 'none';
  },

  // ═══ SHELL HTML ══════════════════════════════════════════════════════════
  _buildShell(temple) {
    const name = this._esc(temple.name || 'PROJECT');
    const pid  = this._esc(temple.project_id || '');
    return `
<div class="ti-hdr" id="ti-hdr">
  <span class="ti-hdr-title">🏛 ${name}</span>
  <span class="ti-hdr-id">${pid}</span>
  <span class="ti-hdr-stat" id="ti-hdr-stat">…</span>
  <span class="ti-hdr-sep"></span>
  <button class="ti-hdr-btn ti-hdr-btn-accent" onclick="TempleInterior._askPoseidon()">🔱 Ask</button>
  <button class="ti-hdr-btn" onclick="TempleInterior._newTaskModal()">+ Task</button>
  <button class="ti-hdr-btn" onclick="TempleInterior._refreshAll()">↻ Refresh</button>
  <button class="ti-hdr-btn ti-hdr-btn-danger" onclick="TempleInterior.close()">✕ Close</button>
</div>
<div class="ti-body">
  <div class="ti-left">
    <div class="ti-tabs">
      <button class="ti-tab" id="ti-ltab-files"   onclick="TempleInterior._switchLeft('files')">📁 Files</button>
      <button class="ti-tab" id="ti-ltab-agents"  onclick="TempleInterior._switchLeft('agents')">🦑 Agents</button>
      <button class="ti-tab" id="ti-ltab-memory"  onclick="TempleInterior._switchLeft('memory')">🧠 Memory</button>
    </div>
    <div id="ti-left-body" style="display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;"></div>
  </div>
  <div class="ti-center">
    <div class="ti-ide-wrap" id="ti-ide-wrap">
      <div class="ti-ide-tabbar" id="ti-ide-tabbar">
        <span class="ti-ide-notabs" id="ti-ide-notabs">← open a file from Files tab</span>
      </div>
      <div class="ti-ide-toolbar">
        <span class="ti-ide-fname" id="ti-ide-fname">—</span>
        <button class="ti-tab-sm" onclick="TempleInterior._ideNewFile()">+ New</button>
        <button class="ti-tab-sm green" onclick="TempleInterior._ideSave()">💾 Save</button>
        <button class="ti-tab-sm" onclick="TempleInterior._ideTogglePreview()" id="ti-preview-toggle">👁 Preview</button>
      </div>
      <div class="ti-ide-main">
        <textarea id="ti-editor" class="ti-editor"
          placeholder="Open a file from the Files panel to start editing…"
          oninput="TempleInterior._ideMarkDirty()" spellcheck="false"></textarea>
        <iframe id="ti-preview-frame" class="ti-preview-frame" style="display:none;" sandbox="allow-scripts allow-same-origin"></iframe>
      </div>
      <div class="ti-ide-status" id="ti-ide-status">Ready</div>
    </div>
  </div>
  <div class="ti-right">
    <div class="ti-tabs">
      <button class="ti-tab" id="ti-rtab-kanban" onclick="TempleInterior._switchRight('kanban')">📋 Kanban</button>
      <button class="ti-tab" id="ti-rtab-tasks"  onclick="TempleInterior._switchRight('tasks')">⚡ Tasks</button>
      <div class="ti-tabs-right">
        <button class="ti-tab-sm" onclick="TempleInterior._newTaskModal()">+ Task</button>
      </div>
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
      const [taskRes, agentRes] = await Promise.all([
        window.ApiV2._fetch('/tasks').catch(() => ({ registry: { tasks: {} } })),
        window.ApiV2._fetch('/agents/pool/status').catch(() => ({ workers: {} }))
      ]);
      const pid   = this.currentTemple?.project_id;
      const pname = this.currentTemple?.name;
      const tasks = Object.values(taskRes.registry?.tasks || {}).filter(t =>
        t.context?.project_id === pid || t.project_id === pid || t.project_name === pname
      );
      const running = Object.values(agentRes.workers || {}).filter(w => w.status === 'running').length;
      const open = tasks.filter(t => !['completed','failed','cancelled','archived'].includes(t.lifecycle?.status || t.status)).length;
      const done = tasks.filter(t => ['completed'].includes(t.lifecycle?.status || t.status)).length;
      el.innerHTML = `<b>${open}</b> open · <b>${done}</b> done · <b>${running}</b> running`;
    } catch {}
  },

  // ═══ TAB SWITCHING ═══════════════════════════════════════════════════════
  _switchLeft(tab) {
    this._leftTab = tab;
    ['files','agents','memory'].forEach(t => {
      document.getElementById(`ti-ltab-${t}`)?.classList.toggle('active', t === tab);
    });
    const body = document.getElementById('ti-left-body');
    if (!body) return;
    if (tab === 'files')  this._renderFiles(body);
    if (tab === 'agents') this._renderAgents(body);
    if (tab === 'memory') this._renderMemory(body);
  },

  _switchRight(tab) {
    this._rightTab = tab;
    ['kanban','tasks'].forEach(t => {
      document.getElementById(`ti-rtab-${t}`)?.classList.toggle('active', t === tab);
    });
    const body = document.getElementById('ti-right-body');
    if (!body) return;
    if (tab === 'kanban') this._renderKanban(body);
    if (tab === 'tasks')  this._renderTasks(body);
  },

  _refreshAll() { this._switchLeft(this._leftTab); this._switchRight(this._rightTab); this._renderHeader(); },

  // ═══ FILES TAB ═══════════════════════════════════════════════════════════
  _renderFiles(container) {
    const c = container || document.getElementById('ti-left-body');
    if (!c) return;
    const folder = this._folder();
    c.innerHTML = `
<div class="ti-sec-head">INPUT FILES
  <label class="ti-sec-head-btn" title="Upload files">
    + Upload
    <input type="file" multiple style="display:none" onchange="TempleInterior._handleUpload(event,'${folder}','input')">
  </label>
</div>
<div id="ti-input-list" class="ti-scroll" style="max-height:35%;min-height:60px;flex:none;">
  <div class="ti-drop-zone" id="ti-drop-input"
    ondragover="event.preventDefault();this.classList.add('drag-over')"
    ondragleave="this.classList.remove('drag-over')"
    ondrop="TempleInterior._handleDrop(event,'${folder}','input')"
    onclick="this.querySelector('input').click()">
    🗂 Drop files here or click
    <input type="file" multiple style="display:none" onchange="TempleInterior._handleUpload(event,'${folder}','input')">
  </div>
</div>
<div class="ti-divider"></div>
<div class="ti-sec-head">OUTPUT FILES
  <button class="ti-sec-head-btn" onclick="TempleInterior._createNewFile('${folder}')">+ New</button>
</div>
<div id="ti-output-list" class="ti-scroll" style="flex:1;min-height:60px;"></div>`;
    this._loadFileList(folder, 'input',  document.getElementById('ti-input-list'));
    this._loadFileList(folder, 'output', document.getElementById('ti-output-list'));
  },

  async _loadFileList(folder, type, container) {
    if (!container) return;
    const dropZone = type === 'input' ? document.getElementById('ti-drop-input') : null;
    try {
      const ep  = type === 'input' ? 'inputs' : 'outputs';
      const res = await fetch(`/api/v2/projects/${folder}/${ep}`);
      const data = await res.json();
      const files = data.files || [];
      if (files.length === 0) {
        if (dropZone) return; // drop zone already shown
        container.innerHTML = `<p class="ti-empty">${type === 'output' ? 'No output files yet' : ''}</p>`;
        return;
      }
      const html = files.map(f => {
        const isImg = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name);
        const icon  = isImg ? '' : `<span class="ti-file-icon">${this._fileIcon(f.name)}</span>`;
        const imgTag = isImg
          ? `<img class="ti-file-thumb" src="/api/v2/projects/${folder}/${type === 'input' ? 'inputs' : 'outputs'}/${encodeURIComponent(f.name)}" onerror="this.style.display='none'">`
          : '';
        const ename = this._esc(f.name);
        const epath = this._esc(f.path || '');
        const sz    = f.size ? `<span class="ti-file-size">${this._fmtSize(f.size)}</span>` : '';
        const del   = `<button class="ti-file-del" onclick="event.stopPropagation();TempleInterior._deleteFile('${folder}','${ename}','${type}')" title="Delete">✕</button>`;
        return `<div class="ti-file" onclick="TempleInterior._openFile('${ename}','${epath}','${type}','${folder}')">
          ${imgTag}${icon}
          <span class="ti-file-name" title="${ename}">${ename}</span>${sz}${del}
        </div>`;
      }).join('');
      // Insert after drop zone if it exists
      if (dropZone) {
        const existing = container.querySelector('.ti-files-html');
        if (existing) existing.innerHTML = html;
        else {
          const div = document.createElement('div');
          div.className = 'ti-files-html';
          div.innerHTML = html;
          container.appendChild(div);
        }
      } else {
        container.innerHTML = html;
      }
    } catch (e) {
      container.innerHTML = `<p class="ti-empty" style="color:#ef4444;">Error: ${this._esc(e.message)}</p>`;
    }
  },

  async _handleUpload(event, folder, type) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const status = document.getElementById('ti-ide-status');
    if (status) status.textContent = `Uploading ${files.length} file(s)…`;
    await this._uploadFiles(folder, files, type);
    if (status) status.textContent = `✓ Uploaded ${files.length} file(s)`;
    this._loadFileList(folder, type, document.getElementById(type === 'input' ? 'ti-input-list' : 'ti-output-list'));
  },

  async _handleDrop(event, folder, type) {
    event.preventDefault();
    event.target.classList?.remove('drag-over');
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
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, content, encoding })
        });
      } catch (e) { console.warn('[Temple] upload failed:', file.name, e.message); }
    }
  },

  async _deleteFile(folder, fileName, type) {
    if (!confirm(`Delete "${fileName}"?`)) return;
    const ep = type === 'input' ? 'inputs' : 'outputs';
    await fetch(`/api/v2/projects/${folder}/${ep}/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
    this._loadFileList(folder, type, document.getElementById(type === 'input' ? 'ti-input-list' : 'ti-output-list'));
  },

  async _createNewFile(folder) {
    const name = prompt('New file name (e.g. notes.md, script.py, data.json):');
    if (!name?.trim()) return;
    await fetch(`/api/v2/projects/${folder}/inputs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: name.trim(), content: '', encoding: 'utf8' })
    });
    this._loadFileList(folder, 'input', document.getElementById('ti-input-list'));
    this._openFile(name.trim(), '', 'input', folder);
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
    try { const ar = await window.ApiV2._fetch('/agents'); regAgents = ar.registry.agents || {}; } catch {}
    try { const ws = await window.ApiV2._fetch('/agents/pool/status'); workers = ws.workers || {}; } catch {}

    const agents = assignedIds.map(id => regAgents[id]).filter(Boolean);

    // Build HTML
    c.innerHTML = `
<div class="ti-arena" id="ti-arena"></div>
<div class="ti-scroll" style="flex:1;">
  ${agents.length === 0
    ? `<p class="ti-empty">No agents assigned.<br>Click below to assign one.</p>`
    : agents.map(a => {
        const w = workers[a.agent_id] || {};
        const isRun = w.status === 'running';
        return `<div class="ti-agent-row">
          <div class="ti-agent-dot ${isRun ? 'run pulse' : 'idle'}"></div>
          <div style="flex:1;min-width:0;">
            <div class="ti-agent-name">${this._esc(a.display_name || a.agent_id)}</div>
            <div class="ti-agent-spec">${this._esc(a.specialization || 'general')}</div>
          </div>
          <span class="ti-agent-badge ${isRun ? 'run' : 'idle'}">${isRun ? '⚡ running' : 'idle'}</span>
          <button class="ti-agent-dispatch" onclick="TempleInterior._dispatchAgent('${a.agent_id}')" title="Send task">▶ Send</button>
          <button class="ti-tab-sm" onclick="window.AgentForm?.open('${a.agent_id}')" title="Edit">✏️</button>
          <button class="ti-tab-sm" onclick="TempleInterior.unassignSquid('${a.agent_id}')" title="Remove">↩</button>
        </div>`;
      }).join('')}
</div>
<div style="padding:6px;border-top:1px solid rgba(255,255,255,.05);flex-shrink:0;">
  <button class="ti-hdr-btn" style="width:100%;justify-content:center;" onclick="TempleInterior._showAssigner()">+ Assign Agent</button>
</div>`;

    // Spawn squid walkers in arena
    const arena = document.getElementById('ti-arena');
    if (arena && agents.length > 0) {
      setTimeout(() => {
        const W = arena.clientWidth || 260, H = arena.clientHeight || 90;
        agents.forEach(a => {
          const squid = (window.aquarium?.squids || []).find(s => (s.agent_id || s.id) === a.agent_id)
            || { id: a.agent_id, name: a.display_name, appearance: a.appearance || {} };
          const walker = document.createElement('div');
          walker.className = 'ti-walker';
          const cvs = document.createElement('canvas');
          cvs.width = 42; cvs.height = 46;
          const lbl = document.createElement('div');
          lbl.className = 'ti-walker-name';
          lbl.textContent = (a.display_name || a.agent_id).slice(0, 10);
          walker.appendChild(cvs); walker.appendChild(lbl);
          arena.appendChild(walker);
          this._animateTempleSquid(walker, cvs, squid, W, H);
        });
      }, 80);
    }
  },

  async _dispatchAgent(agentId) {
    const msg = prompt(`Send task to agent ${agentId}:`);
    if (!msg?.trim()) return;
    const pid = this.currentTemple?.project_id;
    const pname = this.currentTemple?.name;
    // Create task and dispatch
    try {
      const taskRes = await window.ApiV2._fetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          title: msg.trim().slice(0, 80),
          description: msg.trim(),
          project_id: pid,
          project_name: pname,
          assigned_to: agentId
        })
      });
      const taskId = taskRes.task?.task_id;
      // Dispatch via orchestrator dispatch_to_agent tool is handled by TaskRunner
      alert(`Task created${taskId ? ` (${taskId})` : ''} — agent will pick it up automatically`);
      if (this._rightTab === 'kanban') this._renderKanban();
      if (this._rightTab === 'tasks')  this._renderTasks();
      this._renderHeader();
    } catch (e) { alert('Failed: ' + e.message); }
  },

  async _showAssigner() {
    let regAgents = {}, assignedIds = [];
    try { const ar = await window.ApiV2._fetch('/agents'); regAgents = ar.registry.agents || {}; } catch {}
    try {
      const pr = await window.ApiV2._fetch('/projects');
      const proj = Object.values(pr.registry.projects || {}).find(p =>
        p.project_id === this.currentTemple?.project_id || p.name === this.currentTemple?.name
      );
      assignedIds = proj?.assigned_agents || [];
    } catch {}

    const all = Object.values(regAgents);
    if (all.length === 0) { alert('No agents in registry. Create one first.'); return; }

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content" style="width:360px;">
      <div class="modal-header"><strong>Assign Agent — ${this._esc(this.currentTemple?.name || '')}</strong>
        <button class="btn-close" onclick="this.closest('.modal').remove()">✕</button></div>
      <div style="padding:10px;display:flex;flex-direction:column;gap:5px;">
        ${all.map(a => {
          const here = assignedIds.includes(a.agent_id);
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:6px;">
            <span style="flex:1;font-size:9px;color:#c8d6e5;">${this._esc(a.display_name || a.agent_id)}<span style="opacity:.5;font-size:8px;margin-left:6px;">${this._esc(a.specialization||'')}</span></span>
            ${here
              ? `<button class="ti-tab-sm" style="color:#ef4444;border-color:rgba(239,68,68,.25);" onclick="TempleInterior.unassignSquid('${a.agent_id}');this.closest('.modal').remove()">Remove</button>`
              : `<button class="ti-tab-sm" onclick="TempleInterior.assignSquid('${a.agent_id}');this.closest('.modal').remove()">+ Assign</button>`
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
<div class="ti-sec-head">🧠 PROJECT MEMORY
  <button class="ti-sec-head-btn" onclick="TempleInterior._saveMemory('${folder}')">💾 Save</button>
</div>
<div style="flex:1;display:flex;flex-direction:column;padding:6px;min-height:0;">
  <textarea id="ti-mem-editor" class="ti-mem-editor" placeholder="Loading…" spellcheck="false"></textarea>
  <p style="font-size:7.5px;color:#475569;margin-top:4px;line-height:1.5;">Shared context for all agents on this project. JSON or free text.</p>
</div>`;
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(`aquarium/PROJECTS/${folder}/project_memory.json`)}`);
      const data = await res.json();
      const ed = document.getElementById('ti-mem-editor');
      if (ed) ed.value = typeof data.content === 'string' ? data.content : JSON.stringify(data.content || {}, null, 2);
    } catch {
      const ed = document.getElementById('ti-mem-editor');
      if (ed) ed.value = JSON.stringify({ project: this.currentTemple?.name || '', notes: '', goals: [], key_decisions: [] }, null, 2);
    }
  },

  async _saveMemory(folder) {
    const ed = document.getElementById('ti-mem-editor');
    if (!ed) return;
    await fetch(`/api/v2/projects/${folder}/inputs`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: 'project_memory.json', content: ed.value, encoding: 'utf8' })
    });
    const status = document.getElementById('ti-ide-status');
    if (status) status.textContent = '✓ Memory saved';
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
      todo:        tasks.filter(t => ['open','planned','queued'].includes(t.lifecycle?.status || t.status || 'open')),
      in_progress: tasks.filter(t => (t.lifecycle?.status || t.status) === 'in_progress'),
      done:        tasks.filter(t => ['completed','failed','cancelled'].includes(t.lifecycle?.status || t.status))
    };

    const makeCard = (task) => {
      const status = task.lifecycle?.status || task.status || 'open';
      const isRun  = status === 'in_progress';
      const agent  = task.assignment?.assigned_name || task.assignment?.assigned_to || '';
      const prog   = task.progress ? `<div class="ti-kcard-prog">📍 ${this._esc(String(task.progress).slice(0, 55))}</div>` : '';
      const bar    = isRun ? `<div class="ti-kcard-bar"><div class="ti-kcard-bar-fill"></div></div>` : '';
      const scls   = isRun ? 'running' : (status === 'completed' ? 'done' : status === 'failed' ? 'failed' : 'todo');
      return `<div class="ti-kcard" draggable="true" data-task-id="${task.task_id}"
          ondragstart="TempleInterior._kanbanDragStart(event)"
          ondragover="event.preventDefault();event.currentTarget.classList.add('drag-over-top')"
          ondragleave="event.currentTarget.classList.remove('drag-over-top','drag-over-bot')"
          onclick="TempleInterior._openTaskDetail('${task.task_id}')">
        <div class="ti-kcard-title">${this._esc(task.title)}</div>
        ${prog}
        ${bar}
        <div class="ti-kcard-foot">
          <span class="ti-kcard-agent">${agent ? '→ ' + this._esc(agent.slice(0,16)) : ''}</span>
          <span class="ti-kcard-status ${scls}">${status.replace('_',' ')}</span>
          <button class="ti-kcard-del" onclick="event.stopPropagation();TempleInterior._deleteTask('${task.task_id}')">🗑</button>
        </div>
      </div>`;
    };

    const colDefs = [
      { key: 'todo',        label: '📝 TODO',       dropStatus: 'open' },
      { key: 'in_progress', label: '⚡ PROGRESS',   dropStatus: 'in_progress' },
      { key: 'done',        label: '✅ DONE',        dropStatus: 'completed' }
    ];

    c.innerHTML = `
<div class="ti-kanban-wrap">
  <div class="ti-kanban-header">
    <span>Kanban · ${tasks.length} task${tasks.length !== 1 ? 's' : ''}</span>
    <button class="ti-tab-sm" onclick="TempleInterior._newTaskModal()">+ New</button>
  </div>
  <div class="ti-kanban-board">
    ${colDefs.map(col => `
    <div class="ti-kanban-col" id="ti-kcol-${col.key}"
      ondragover="event.preventDefault();event.currentTarget.classList.add('drag-over')"
      ondragleave="event.currentTarget.classList.remove('drag-over')"
      ondrop="TempleInterior._kanbanDrop(event,'${col.dropStatus}')">
      <div class="ti-kanban-col-head">
        <span>${col.label}</span>
        <span class="ti-kanban-col-count">${(cols[col.key] || []).length}</span>
      </div>
      <div class="ti-kanban-cards" id="ti-kcards-${col.key}">
        ${(cols[col.key] || []).length
          ? (cols[col.key] || []).map(makeCard).join('')
          : `<p class="ti-empty">drop here</p>`}
      </div>
    </div>`).join('')}
  </div>
</div>`;
  },

  _kanbanDragStart(event) {
    const id = event.currentTarget.dataset.taskId;
    this._dragTaskId = id;
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    setTimeout(() => event.currentTarget.classList.add('dragging'), 0);
  },

  async _kanbanDrop(event, newStatus) {
    event.preventDefault();
    document.querySelectorAll('.ti-kanban-col').forEach(c => c.classList.remove('drag-over'));
    const taskId = event.dataTransfer.getData('text/plain') || this._dragTaskId;
    this._dragTaskId = null;
    if (!taskId) return;
    try {
      // Use _writeTaskDetails via the correct API
      await window.ApiV2._fetch(`/tasks/${taskId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      }).catch(() =>
        // Fallback: PATCH field endpoint
        window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: `tasks/${taskId}/details.json`,
            fieldPath: 'lifecycle.status',
            newValue: newStatus,
            reason: 'kanban drag-drop'
          })
        })
      );
    } catch (e) { console.warn('[Kanban] drop failed:', e.message); }
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

    const sIcon  = { in_progress:'⚡', completed:'✅', failed:'❌', cancelled:'⊘', planned:'📋', open:'○', queued:'○' };
    const sColor = { in_progress:'#4facfe', completed:'#22c55e', failed:'#ef4444', cancelled:'#94a3b8', planned:'#f59e0b', open:'#94a3b8' };

    c.innerHTML = `
<div class="ti-tasklist" style="flex:1;overflow-y:auto;">
  ${tasks.length === 0
    ? '<p class="ti-empty">No tasks for this project yet.</p>'
    : tasks.map(task => {
        const status = task.lifecycle?.status || task.status || 'open';
        const isRun  = status === 'in_progress';
        const agent  = task.assignment?.assigned_name || task.assignment?.assigned_to || '';
        const prog   = task.progress ? `<div class="ti-task-sub">📍 ${this._esc(String(task.progress).slice(0,80))}</div>` : '';
        const bar    = isRun ? `<div class="ti-task-bar"><div class="ti-task-bar-fill"></div></div>` : '';
        return `<div class="ti-task-row" onclick="TempleInterior._openTaskDetail('${task.task_id}')">
          <span class="ti-task-sicon" style="color:${sColor[status]||'#64748b'}">${sIcon[status]||'○'}</span>
          <div class="ti-task-info">
            <div class="ti-task-title">${this._esc(task.title)}</div>
            ${prog}
            ${agent ? `<div class="ti-task-sub" style="color:#4facfe;">→ ${this._esc(agent)}</div>` : ''}
            ${bar}
          </div>
          <button class="ti-task-del" onclick="event.stopPropagation();TempleInterior._deleteTask('${task.task_id}')" title="Delete">🗑</button>
        </div>`;
      }).join('')}
</div>
<div class="ti-newtask">
  <input id="ti-quick-task" type="text" placeholder="Quick add task… (Enter to create)"
    onkeydown="if(event.key==='Enter')TempleInterior._quickAddTask(this.value)">
</div>`;
  },

  async _quickAddTask(title) {
    if (!title?.trim()) return;
    const input = document.getElementById('ti-quick-task');
    if (input) input.value = '';
    const pid = this.currentTemple?.project_id;
    const pname = this.currentTemple?.name;
    await window.ApiV2._fetch('/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: title.trim(), project_id: pid, project_name: pname })
    });
    this._renderTasks();
    this._renderKanban();
    this._renderHeader();
  },

  // ═══ TASK MODALS ═════════════════════════════════════════════════════════
  async _newTaskModal() {
    const pid = this.currentTemple?.project_id;
    const pname = this.currentTemple?.name;

    let agents = [];
    try { agents = Object.values((await window.ApiV2._fetch('/agents')).registry.agents || {}); } catch {}

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `<div class="modal-content" style="width:420px;">
      <div class="modal-header"><strong>New Task — ${this._esc(pname || '')}</strong>
        <button class="btn-close" onclick="this.closest('.modal').remove()">✕</button></div>
      <div style="padding:14px;display:flex;flex-direction:column;gap:10px;">
        <div><label style="font-size:8.5px;color:#64748b;display:block;margin-bottom:4px;">Title *</label>
          <input id="ntm-title" type="text" placeholder="What needs to be done?"
            style="width:100%;box-sizing:border-box;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:5px;color:#e2e8f0;font-size:10px;padding:7px 10px;font-family:inherit;"></div>
        <div><label style="font-size:8.5px;color:#64748b;display:block;margin-bottom:4px;">Description</label>
          <textarea id="ntm-desc" rows="3"
            style="width:100%;box-sizing:border-box;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:5px;color:#e2e8f0;font-size:10px;padding:7px 10px;font-family:inherit;resize:vertical;"></textarea></div>
        <div style="display:flex;gap:10px;">
          <div style="flex:1;"><label style="font-size:8.5px;color:#64748b;display:block;margin-bottom:4px;">Assign to</label>
            <select id="ntm-agent" style="width:100%;background:rgba(0,0,0,.4);border:1px solid rgba(255,255,255,.1);border-radius:5px;color:#e2e8f0;font-size:9px;padding:6px;font-family:inherit;">
              <option value="">— unassigned —</option>
              ${agents.map(a => `<option value="${a.agent_id}">${this._esc(a.display_name||a.agent_id)}</option>`).join('')}
            </select></div>
          <div style="flex:1;"><label style="font-size:8.5px;color:#64748b;display:block;margin-bottom:4px;">Schedule (cron)</label>
            <input id="ntm-cron" type="text" placeholder="0 9 * * * (optional)"
              style="width:100%;box-sizing:border-box;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.1);border-radius:5px;color:#e2e8f0;font-size:9px;padding:7px 10px;font-family:monospace;"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
          <button class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
          <button class="btn-primary" onclick="TempleInterior._createTask(this.closest('.modal'))">Create Task</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    setTimeout(() => modal.querySelector('#ntm-title')?.focus(), 50);
  },

  async _createTask(modal) {
    const title  = modal.querySelector('#ntm-title')?.value.trim();
    const desc   = modal.querySelector('#ntm-desc')?.value.trim();
    const agent  = modal.querySelector('#ntm-agent')?.value || null;
    const cron   = modal.querySelector('#ntm-cron')?.value.trim() || null;
    if (!title) { alert('Title is required'); return; }
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
      this._renderKanban();
      this._renderTasks();
      this._renderHeader();
    } catch (e) { alert('Failed: ' + e.message); }
  },

  async _openTaskDetail(taskId) {
    if (typeof TaskQueueUI !== 'undefined') TaskQueueUI.openTaskDetail(taskId);
  },

  async _deleteTask(taskId) {
    if (!confirm(`Delete task ${taskId}?`)) return;
    await window.ApiV2._fetch(`/tasks/${taskId}`, { method: 'DELETE' });
    this._renderKanban();
    this._renderTasks();
    this._renderHeader();
  },

  // ═══ IDE ═════════════════════════════════════════════════════════════════
  _openFile(name, filepath, type, folder) {
    const existing = this._openFiles.findIndex(f => f.name === name && f.folder === folder && f.type === type);
    if (existing >= 0) { this._ideActivate(existing); return; }

    const isImg = /\.(png|jpg|jpeg|gif|webp|svg|bmp|ico)$/i.test(name);
    if (isImg) {
      const imgUrl = `/api/v2/projects/${folder}/${type === 'input' ? 'inputs' : 'outputs'}/${encodeURIComponent(name)}`;
      this._openFiles.push({ name, path: filepath, folder, type, content: `[Image: ${name}]`, imgUrl, isImg: true, dirty: false });
      this._ideActivate(this._openFiles.length - 1);
      const frame = document.getElementById('ti-preview-frame');
      if (frame) {
        frame.style.display = '';
        frame.srcdoc = `<html><body style="margin:0;background:#070d17;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${imgUrl}" style="max-width:100%;max-height:100vh;border-radius:4px;"></body></html>`;
      }
      const editor = document.getElementById('ti-editor');
      if (editor) editor.style.display = 'none';
      return;
    }

    // Load text file
    this._openFiles.push({ name, path: filepath, folder, type, content: '', dirty: false, loading: true });
    const idx = this._openFiles.length - 1;
    this._ideActivate(idx);
    const status = document.getElementById('ti-ide-status');
    if (status) status.textContent = `Loading ${name}…`;

    const load = async () => {
      let content = '';
      try {
        if (filepath) {
          const res = await fetch('/api/files/read?path=' + encodeURIComponent(filepath));
          const data = await res.json();
          content = typeof data.content === 'string' ? data.content : JSON.stringify(data.content || '', null, 2);
        } else {
          const ep = type === 'input' ? 'inputs' : 'outputs';
          const res = await fetch(`/api/v2/projects/${folder}/${ep}/${encodeURIComponent(name)}`);
          content = await res.text();
        }
      } catch (e) { content = `// Error loading: ${e.message}`; }
      const file = this._openFiles[idx];
      if (file) { file.content = content; file.loading = false; }
      if (this._activeFileIdx === idx) {
        const ed = document.getElementById('ti-editor');
        if (ed) ed.value = content;
        if (status) status.textContent = `${name} — ${content.length} chars`;
      }
    };
    load();
  },

  _ideActivate(idx) {
    if (idx < 0 || idx >= this._openFiles.length) return;
    // Persist current editor content
    const editor = document.getElementById('ti-editor');
    if (editor && this._activeFileIdx >= 0 && this._openFiles[this._activeFileIdx]) {
      this._openFiles[this._activeFileIdx].content = editor.value;
    }
    this._activeFileIdx = idx;
    const file = this._openFiles[idx];

    // Reset view
    const frame = document.getElementById('ti-preview-frame');
    if (editor) editor.style.display = '';
    if (frame) frame.style.display = 'none';

    if (file.isImg) {
      if (editor) editor.style.display = 'none';
      if (frame) {
        frame.style.display = '';
        frame.srcdoc = `<html><body style="margin:0;background:#070d17;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${file.imgUrl}" style="max-width:100%;max-height:100vh;"></body></html>`;
      }
    } else if (editor) {
      editor.value = file.loading ? 'Loading…' : (file.content || '');
    }

    const fnEl = document.getElementById('ti-ide-fname');
    if (fnEl) fnEl.textContent = `${file.name}${file.type ? ` (${file.type})` : ''}`;
    this._renderIdeTabs();
  },

  _renderIdeTabs() {
    const bar = document.getElementById('ti-ide-tabbar');
    if (!bar) return;
    const noTabs = document.getElementById('ti-ide-notabs');
    bar.querySelectorAll('.ti-ide-filetab').forEach(t => t.remove());
    if (this._openFiles.length === 0) { if (noTabs) noTabs.style.display = ''; return; }
    if (noTabs) noTabs.style.display = 'none';
    this._openFiles.forEach((f, i) => {
      const btn = document.createElement('button');
      btn.className = `ti-ide-filetab${i === this._activeFileIdx ? ' active' : ''}${f.dirty ? ' dirty' : ''}`;
      btn.innerHTML = `${this._esc(f.name.slice(0, 16))}<span class="ti-ide-close" onclick="event.stopPropagation();TempleInterior._ideCloseTab(${i})">✕</span>`;
      btn.onclick = () => this._ideActivate(i);
      bar.appendChild(btn);
    });
  },

  _ideMarkDirty() {
    if (this._activeFileIdx < 0 || !this._openFiles[this._activeFileIdx]) return;
    this._openFiles[this._activeFileIdx].dirty = true;
    this._renderIdeTabs();
  },

  _ideCloseTab(idx) {
    const file = this._openFiles[idx];
    if (file?.dirty && !confirm(`"${file.name}" has unsaved changes. Close?`)) return;
    this._openFiles.splice(idx, 1);
    if (this._activeFileIdx >= this._openFiles.length) this._activeFileIdx = this._openFiles.length - 1;
    this._renderIdeTabs();
    if (this._activeFileIdx >= 0) this._ideActivate(this._activeFileIdx);
    else { const ed = document.getElementById('ti-editor'); if (ed) ed.value = ''; }
  },

  async _ideSave() {
    if (this._activeFileIdx < 0 || !this._openFiles[this._activeFileIdx]) return;
    const file = this._openFiles[this._activeFileIdx];
    const ed   = document.getElementById('ti-editor');
    const status = document.getElementById('ti-ide-status');
    if (ed) file.content = ed.value;
    const folder = file.folder || this._folder();
    const ep = file.type === 'output' ? 'outputs' : 'inputs';
    if (status) status.textContent = 'Saving…';
    try {
      await fetch(`/api/v2/projects/${folder}/${ep}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: file.name, content: file.content, encoding: 'utf8' })
      });
      file.dirty = false;
      this._renderIdeTabs();
      if (status) status.textContent = `✓ Saved ${file.name} — ${new Date().toLocaleTimeString()}`;
    } catch (e) { if (status) status.textContent = `✗ Save failed: ${e.message}`; }
  },

  _ideNewFile() {
    const name = prompt('New file name (e.g. notes.md, data.json, script.py):');
    if (!name?.trim()) return;
    this._openFiles.push({ name: name.trim(), path: null, folder: this._folder(), type: 'input', content: '', dirty: true });
    this._activeFileIdx = this._openFiles.length - 1;
    this._renderIdeTabs();
    this._ideActivate(this._activeFileIdx);
  },

  _ideTogglePreview() {
    const frame  = document.getElementById('ti-preview-frame');
    const editor = document.getElementById('ti-editor');
    if (!frame) return;
    if (frame.style.display === 'none') {
      const content = editor?.value || '';
      const blob = new Blob([content], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      frame.src = url;
      frame.style.display = '';
      // Revoke after load to avoid leak
      frame.onload = () => { URL.revokeObjectURL(url); frame.onload = null; };
    } else {
      frame.style.display = 'none';
    }
  },

  // ═══ POSEIDON ASK ════════════════════════════════════════════════════════
  _askPoseidon() {
    const name = this.currentTemple?.name || '';
    const pid  = this.currentTemple?.project_id || '';
    // Try to find Poseidon chat input
    const chatInput = document.querySelector('#poseidon-input, .pc-input textarea, [data-poseidon-input]');
    if (chatInput) {
      chatInput.value = `About project "${name}" (${pid}): `;
      chatInput.focus();
      chatInput.dispatchEvent(new Event('input'));
    }
    // Switch to Poseidon panel
    const posTab = document.querySelector('[data-panel="poseidon"], .tab-btn[onclick*="poseidon"], [onclick*="PoseidonChat"]');
    if (posTab) posTab.click();
    this.close();
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
      t.project_id === pid ||
      t.project_name === pname
    );
  },

  _fileIcon(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return ({ js:'📜',ts:'📜',jsx:'📜',tsx:'📜',mjs:'📜',
      py:'🐍',rb:'💎',rs:'🦀',go:'🔷',
      json:'📋',yaml:'📋',yml:'📋',toml:'📋',
      md:'📝',txt:'📄',
      html:'🌐',css:'🎨',scss:'🎨',
      csv:'📊',xls:'📊',xlsx:'📊',
      sh:'⚙️',bash:'⚙️',
      pdf:'📕',zip:'📦',tar:'📦',gz:'📦',
      mp4:'🎬',mp3:'🎵',wav:'🎵',
    })[ext] || '📄';
  },

  _fmtSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1048576) return `${(bytes/1024).toFixed(0)}K`;
    return `${(bytes/1048576).toFixed(1)}M`;
  },

  _esc(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
  },
  _escape(s) { return this._esc(s); },

  // ═══ SQUID ANIMATION (kept from v2) ══════════════════════════════════════
  _animateTempleSquid(walkerDiv, cvs, squid, cW, cH) {
    if (!TempleInterior._rafMap) TempleInterior._rafMap = {};
    const sqid = squid.id || squid.agent_id || Math.random();
    if (TempleInterior._rafMap[sqid]) cancelAnimationFrame(TempleInterior._rafMap[sqid]);
    const ctx = cvs.getContext('2d');
    const CW = cvs.width, CH = cvs.height, size = 13;
    const app = squid.appearance || {};
    const primary = app.primary_color || app.body_color || '#4facfe';
    const darken = (hex, f) => { try { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgb(${Math.floor(r*f)},${Math.floor(g*f)},${Math.floor(b*f)})`; } catch { return hex; } };
    const brighten = (hex, f) => { try { const r=Math.min(255,parseInt(hex.slice(1,3),16)*f),g=Math.min(255,parseInt(hex.slice(3,5),16)*f),b=Math.min(255,parseInt(hex.slice(5,7),16)*f); return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`; } catch { return hex; } };
    const margin = size+4;
    let px = margin+Math.random()*(cW-margin*2), py = margin+Math.random()*(cH-margin*2);
    let vx = (Math.random()-.5)*.7, vy = (Math.random()-.5)*.35;
    let frame = 0, idleF = 0, nextIdle = 80+Math.floor(Math.random()*100);
    const stride = 28;
    const loop = () => {
      frame++;
      if (idleF > 0) { idleF--; vx *= .88; vy *= .88; }
      else {
        nextIdle--;
        if (nextIdle <= 0) { idleF = 35+Math.floor(Math.random()*55); nextIdle = 90+Math.floor(Math.random()*130); }
        vx += (Math.random()-.5)*.1; vy += (Math.random()-.5)*.06;
        vx *= .97; vy *= .97;
        const spd = Math.sqrt(vx*vx+vy*vy);
        if (spd > .8) { vx *= .8/spd; vy *= .8/spd; }
        if (spd < .12) { vx += (Math.random()-.5)*.25; vy += (Math.random()-.5)*.12; }
      }
      px += vx; py += vy;
      if (px < margin) { px = margin; vx = Math.abs(vx)*.7; }
      if (px > cW-margin) { px = cW-margin; vx = -Math.abs(vx)*.7; }
      if (py < margin) { py = margin; vy = Math.abs(vy)*.7; }
      if (py > cH-margin) { py = cH-margin; vy = -Math.abs(vy)*.7; }
      walkerDiv.style.left = (px-CW/2)+'px'; walkerDiv.style.top = (py-CH/2)+'px';
      const isIdle = idleF > 0, facingRight = vx >= 0;
      const wp = (frame/stride)*Math.PI*2;
      const bob = isIdle ? Math.sin(frame*.04)*1.1 : Math.sin(wp*2)*1.3;
      ctx.clearRect(0,0,CW,CH);
      if (typeof Squid !== 'undefined') {
        try {
          const sq = new Squid({id:'__tw__',name:'',status:'idle',appearance:{...app},x:CW/2,y:CH/2-1+bob});
          sq.animFrame=wp; sq.bobOffset=0; sq.isDragging=true; sq.isSleeping=false;
          sq.isHovered=false; sq.alpha=1; sq.insideTemple=null; sq.jumpHeight=0;
          sq.heartParticles=[]; sq._confetti=null; sq.baseSize=size/40;
          if (!facingRight) { ctx.save(); ctx.translate(CW,0); ctx.scale(-1,1); sq.x=CW-sq.x; sq.draw(ctx); ctx.restore(); }
          else sq.draw(ctx);
          TempleInterior._rafMap[sqid] = requestAnimationFrame(loop); return;
        } catch(e) {}
      }
      ctx.save(); ctx.translate(CW/2,CH/2-1+bob);
      if (!facingRight) ctx.scale(-1,1);
      const grad = ctx.createRadialGradient(-size*.15,-size*.2,0,0,0,size);
      grad.addColorStop(0,brighten(primary,1.25)); grad.addColorStop(.6,primary); grad.addColorStop(1,darken(primary,.75));
      ctx.fillStyle=grad; ctx.strokeStyle='#1a1a1a'; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(0,0,size,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='white'; ctx.beginPath(); ctx.arc(-size*.28,-size*.15,size*.15,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(size*.28,-size*.15,size*.15,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(-size*.26,-size*.14,size*.07,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(size*.30,-size*.14,size*.07,0,Math.PI*2); ctx.fill();
      for(let i=0;i<6;i++){
        const lx=(i-2.5)*size*.26; const ph=wp+(i%2===0?0:Math.PI);
        const sw=isIdle?Math.sin(frame*.05+i)*1.8:Math.sin(ph)*4.5;
        const lf=isIdle?0:Math.max(0,Math.sin(ph))*2.2;
        const bY=size*Math.sqrt(Math.max(0,1-Math.pow(lx/(size*.8),2)));
        ctx.strokeStyle=i%2===0?primary:darken(primary,.8); ctx.lineWidth=2; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(lx,bY); ctx.quadraticCurveTo(lx+sw*.5,bY+size*.38-lf,lx+sw,bY+size*.82-lf*.5); ctx.stroke();
      }
      ctx.restore();
      TempleInterior._rafMap[sqid] = requestAnimationFrame(loop);
    };
    TempleInterior._rafMap[sqid] = requestAnimationFrame(loop);
  },

  // ═══ LEGACY COMPAT ═══════════════════════════════════════════════════════
  populateResources(temple)    { this._switchLeft('files'); },
  populateWorkingAgents(t)     { if (this._leftTab === 'agents') this._renderAgents(); },
  populateKanban(t)            { if (this._rightTab === 'kanban') this._renderKanban(); },
  populateCronTasks(t)         { this.populateProjectTasks(t); },
  populateProjectTasks(t)      { this._switchRight('tasks'); },
  openProjectMemory()          { this._switchLeft('memory'); },
  openFile(name, p, type)      { this._openFile(name, p, type, this._folder()); },
  saveFile()                   { this._ideSave(); },
  refreshPreview()             { this._ideTogglePreview(); },
  humanizeCron(c)              { return c || ''; },
  updateCronPreview()          {},
  openCronBuilder()            { this._newTaskModal(); },
  closeCronBuilder()           { document.querySelector('.cron-builder-modal')?.remove(); },
  _deleteProjectTask(id)       { this._deleteTask(id); },

  // ═══ ASSIGN / UNASSIGN (kept intact) ═════════════════════════════════════
  async assignSquid(squidId) {
    const projectId = this.currentTemple?.project_id;
    if (!projectId) { alert('No project_id on this temple.'); return; }
    try {
      const pr = await window.ApiV2._fetch('/projects');
      const proj = pr.registry.projects[projectId];
      if (!proj) throw new Error('Project not found: ' + projectId);
      const assigned = [...(proj.assigned_agents || [])];
      const agentRef = squidId;
      if (!assigned.includes(agentRef)) {
        assigned.push(agentRef);
        await window.ApiV2._fetch('/field', { method: 'PATCH', body: JSON.stringify({
          filePath: 'projects/project_registry.json',
          fieldPath: `projects.${projectId}.assigned_agents`,
          newValue: assigned, reason: 'assigned via temple'
        })});
      }
      const squid = window.aquarium?.squids?.find(s => (s.agent_id || s.id) === squidId);
      if (squid) { squid.currentProject = this.currentTemple?.name; squid.insideTemple = this.currentTemple?.name; }
      this._switchLeft('agents');
    } catch (err) { alert('Failed: ' + err.message); }
  },

  async unassignSquid(squidId) {
    if (!confirm('Remove this agent from the project?')) return;
    const squid = window.aquarium?.squids?.find(s => (s.agent_id || s.id) === squidId);
    if (squid) { squid.currentProject = null; squid.insideTemple = null; }
    try {
      const pr = await window.ApiV2._fetch('/projects');
      for (const [pid, p] of Object.entries(pr.registry.projects)) {
        if ((p.project_id === this.currentTemple?.project_id || p.name === this.currentTemple?.name) && Array.isArray(p.assigned_agents) && p.assigned_agents.includes(squidId)) {
          await window.ApiV2._fetch('/field', { method: 'PATCH', body: JSON.stringify({
            filePath: 'projects/project_registry.json',
            fieldPath: `projects.${pid}.assigned_agents`,
            newValue: p.assigned_agents.filter(a => a !== squidId), reason: 'unassigned'
          })});
          break;
        }
      }
    } catch {}
    this._switchLeft('agents');
  },

  getTempleBackground() { return ''; },
  _initLeft(tab)  { this._switchLeft(tab); },
  _initRight(tab) { this._switchRight(tab); }
};

window.TempleInterior = TempleInterior;
console.log('[TEMPLE] TempleInterior v3 loaded');
