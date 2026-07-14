/**
 * CommandPalette — Ctrl+K / Cmd+K global search across agents, projects, tasks, models, skills.
 *
 * Type to fuzzy-filter. ↑↓ navigate. Enter activates. Esc closes.
 *
 * Sources:
 *   - Agents (/api/v2/agents)        → opens AgentForm in edit mode
 *   - Projects (/api/v2/projects)    → opens TempleInterior
 *   - Tasks (/api/v2/tasks)          → opens task detail
 *   - Skills (/api/v2/skills)        → opens SkillsPanel
 *   - Models (/api/v2/models/library)→ opens ModelLoader
 *   - Built-in actions: New agent, New project, Open Poseidon, Models, Logs, Comms, Skills
 *
 * Data fetched once on open (with stale-while-revalidate on subsequent opens).
 */
(function () {
  const PALETTE_ID = 'iaqua-cmd-palette';
  let cachedItems = null;
  let cacheTime   = 0;
  const CACHE_TTL = 30_000;

  let overlayEl, inputEl, listEl;
  let selectedIdx = 0;
  let filtered    = [];

  function open() {
    if (overlayEl) { inputEl.focus(); return; }
    build();
    refresh().then(() => render());
  }

  function close() {
    if (!overlayEl) return;
    overlayEl.remove();
    overlayEl = null;
    inputEl   = null;
    listEl    = null;
    selectedIdx = 0;
    filtered  = [];
  }

  function build() {
    overlayEl = document.createElement('div');
    overlayEl.id = PALETTE_ID;
    overlayEl.style.cssText =
      'position:fixed;inset:0;background:rgba(2,8,16,0.6);z-index:99997;' +
      'display:flex;justify-content:center;align-items:flex-start;padding-top:14vh;' +
      'font-family:system-ui,sans-serif;backdrop-filter:blur(2px);';
    overlayEl.innerHTML =
      '<div style="width:min(560px,92vw);background:#0f2236;border:1px solid rgba(79,172,254,0.25);' +
        'border-radius:8px;box-shadow:0 12px 40px rgba(0,0,0,0.6);overflow:hidden;display:flex;flex-direction:column;max-height:70vh;">' +
        '<div style="padding:10px 14px;border-bottom:1px solid rgba(79,172,254,0.15);display:flex;align-items:center;gap:8px;">' +
          '<span style="color:#4facfe;font-size:13px;">⌕</span>' +
          '<input id="iaqua-cmd-input" type="text" placeholder="Jump to agent, project, task… (Esc to close)" ' +
            'style="flex:1;background:transparent;border:none;outline:none;color:#dce8f5;font-size:14px;font-family:system-ui,sans-serif;">' +
          '<span style="color:#64748b;font-size:10px;font-family:var(--panel-font-mono,monospace);background:rgba(255,255,255,0.05);padding:2px 6px;border-radius:3px;">ESC</span>' +
        '</div>' +
        '<div id="iaqua-cmd-list" style="overflow-y:auto;flex:1;"></div>' +
      '</div>';
    document.body.appendChild(overlayEl);

    inputEl = overlayEl.querySelector('#iaqua-cmd-input');
    listEl  = overlayEl.querySelector('#iaqua-cmd-list');

    overlayEl.addEventListener('click', (ev) => {
      if (ev.target === overlayEl) close();
    });
    inputEl.addEventListener('input', () => { selectedIdx = 0; render(); });
    inputEl.addEventListener('keydown', onKey);
    setTimeout(() => inputEl.focus(), 0);
  }

  function onKey(ev) {
    if (ev.key === 'Escape') { close(); ev.preventDefault(); return; }
    if (ev.key === 'ArrowDown' || (ev.ctrlKey && ev.key === 'n')) {
      selectedIdx = Math.min(filtered.length - 1, selectedIdx + 1);
      render(); ev.preventDefault(); return;
    }
    if (ev.key === 'ArrowUp' || (ev.ctrlKey && ev.key === 'p')) {
      selectedIdx = Math.max(0, selectedIdx - 1);
      render(); ev.preventDefault(); return;
    }
    if (ev.key === 'Enter') {
      const item = filtered[selectedIdx];
      if (item) { close(); setTimeout(() => activate(item), 50); }
      ev.preventDefault();
    }
  }

  async function refresh() {
    const now = Date.now();
    if (cachedItems && (now - cacheTime) < CACHE_TTL) return;

    const items = [];

    // Static actions — always available
    items.push(
      { kind: 'action', label: 'Open Poseidon chat', icon: '◆', detail: 'Talk to Poseidon', onActivate: () => window.PoseidonChat?.open() },
      { kind: 'action', label: 'New agent',           icon: '+', detail: 'Create a new agent',  onActivate: () => window.AgentForm?.openNew() },
      { kind: 'action', label: 'New project',         icon: '+', detail: 'Create a new project', onActivate: () => window.ui?.openNewProjectModal() },
      { kind: 'action', label: 'Models library',      icon: '▣', detail: 'Browse GGUF models', onActivate: () => window.ModelLoader?.open() },
      { kind: 'action', label: 'Skills',              icon: '◇', detail: 'Manage skills',     onActivate: () => window.SkillsPanel?.open() },
      { kind: 'action', label: 'Logs',                icon: '≡', detail: 'System event log',  onActivate: () => window.ui?.openLogsModal() },
      { kind: 'action', label: 'Comms',               icon: '◊', detail: 'Telegram / voice settings', onActivate: () => window.CommsPanel?.open() },
    );

    // Dynamic — fetch in parallel
    const r = await Promise.allSettled([
      fetch('/api/v2/agents').then(r => r.ok ? r.json() : null),
      fetch('/api/v2/projects').then(r => r.ok ? r.json() : null),
      fetch('/api/v2/tasks').then(r => r.ok ? r.json() : null),
      fetch('/api/v2/skills').then(r => r.ok ? r.json() : null),
      fetch('/api/v2/models/library').then(r => r.ok ? r.json() : null),
    ]);

    // Agents
    try {
      const data = r[0].value;
      const agents = data?.agents || data?.registry?.agents || (Array.isArray(data) ? data : {});
      const arr = Array.isArray(agents) ? agents : Object.values(agents);
      for (const a of arr) {
        items.push({
          kind: 'agent', icon: '◉',
          label: a.display_name || a.agent_id || a.id,
          detail: 'Agent · ' + (a.status || 'sleeping') + (a.specialization ? ' · ' + a.specialization : ''),
          onActivate: () => window.AgentForm?.openEdit(a.agent_id || a.id),
        });
      }
    } catch {}

    // Projects
    try {
      const data = r[1].value;
      const projects = data?.projects || data?.registry?.projects || (Array.isArray(data) ? data : {});
      const arr = Array.isArray(projects) ? projects : Object.values(projects);
      for (const p of arr) {
        items.push({
          kind: 'project', icon: '▲',
          label: p.name || p.project_id,
          detail: 'Project · ' + (p.metrics?.tasks_completed || 0) + ' done',
          onActivate: () => window.TempleInterior?.open(p),
        });
      }
    } catch {}

    // Tasks (only open ones — completed go to results elsewhere)
    try {
      const data = r[2].value;
      const tasks = data?.tasks || data?.registry?.tasks || {};
      for (const t of Object.values(tasks)) {
        const status = t.lifecycle?.status || t.status || 'open';
        items.push({
          kind: 'task', icon: ['wip','in_progress'].includes(status) ? '●' : '○',
          label: t.title,
          detail: 'Task · ' + status + (t.assigned_to ? ' · ' + t.assigned_to : ''),
          onActivate: () => window.TaskQueueUI?.openTaskDetail?.(t.task_id),
        });
      }
    } catch {}

    // Skills
    try {
      const data = r[3].value;
      const skills = data?.skills || data || {};
      const arr = Array.isArray(skills) ? skills : Object.values(skills);
      for (const s of arr) {
        items.push({
          kind: 'skill', icon: '◇',
          label: s.name || s.skill_id,
          detail: 'Skill · v' + (s.version || 1),
          onActivate: () => window.SkillsPanel?.open(),
        });
      }
    } catch {}

    // Models
    try {
      const data = r[4].value;
      const models = data?.models || data?.library || (Array.isArray(data) ? data : []);
      const arr = Array.isArray(models) ? models : Object.values(models);
      for (const m of arr) {
        items.push({
          kind: 'model', icon: '▣',
          label: m.display_name || m.model_id || m.file_name,
          detail: 'Model · ' + (m.model_type || 'text') + (m.is_loaded ? ' · loaded' : ''),
          onActivate: () => window.ModelLoader?.open(),
        });
      }
    } catch {}

    cachedItems = items;
    cacheTime   = now;
  }

  function fuzzyMatch(needle, hay) {
    if (!needle) return { score: 0, hits: [] };
    needle = needle.toLowerCase();
    hay    = hay.toLowerCase();
    // Substring match → high score
    const idx = hay.indexOf(needle);
    if (idx !== -1) return { score: 1000 - idx };
    // Subsequence match
    let ni = 0, score = 0, lastHit = -1;
    for (let i = 0; i < hay.length && ni < needle.length; i++) {
      if (hay[i] === needle[ni]) {
        score += (lastHit === i - 1) ? 5 : 1;
        lastHit = i;
        ni++;
      }
    }
    if (ni < needle.length) return null;
    return { score };
  }

  function render() {
    if (!listEl) return;
    const q = (inputEl?.value || '').trim();
    if (!q) {
      filtered = (cachedItems || []).slice(0, 30);
    } else {
      filtered = (cachedItems || [])
        .map(it => {
          const m = fuzzyMatch(q, it.label + ' ' + it.detail);
          return m ? { ...it, _score: m.score } : null;
        })
        .filter(Boolean)
        .sort((a, b) => b._score - a._score)
        .slice(0, 30);
    }
    if (selectedIdx >= filtered.length) selectedIdx = Math.max(0, filtered.length - 1);

    if (!filtered.length) {
      listEl.innerHTML = '<div style="padding:14px;text-align:center;color:#64748b;font-size:12px;">No results — try a different search</div>';
      return;
    }

    const KIND_COLORS = { agent:'#06ffa5', project:'#a78bfa', task:'#4facfe', skill:'#f59e0b', model:'#34d399', action:'#94a3b8' };
    listEl.innerHTML = filtered.map((it, i) => {
      const sel = i === selectedIdx;
      return '<div data-idx="' + i + '" style="padding:8px 14px;cursor:pointer;display:flex;gap:10px;align-items:center;border-left:2px solid ' + (sel ? '#4facfe' : 'transparent') + ';background:' + (sel ? 'rgba(79,172,254,0.08)' : 'transparent') + ';">' +
        '<span style="color:' + (KIND_COLORS[it.kind] || '#94a3b8') + ';font-size:14px;width:18px;text-align:center;flex-shrink:0;">' + it.icon + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="color:#dce8f5;font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(it.label) + '</div>' +
          '<div style="color:#94a3b8;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escape(it.detail) + '</div>' +
        '</div>' +
        (sel ? '<span style="color:#64748b;font-size:9px;flex-shrink:0;">↵</span>' : '') +
      '</div>';
    }).join('');

    // Wire click
    listEl.querySelectorAll('[data-idx]').forEach(el => {
      el.addEventListener('mouseenter', () => { selectedIdx = parseInt(el.dataset.idx); render(); });
      el.addEventListener('click', () => {
        const item = filtered[parseInt(el.dataset.idx)];
        if (item) { close(); setTimeout(() => activate(item), 50); }
      });
    });

    // Keep selected in view
    const sel = listEl.querySelector('[data-idx="' + selectedIdx + '"]');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }

  function activate(item) {
    try { item.onActivate?.(); }
    catch (e) { console.warn('[CmdPalette] activate failed:', e); }
  }

  function escape(s) {
    return String(s || '').replace(/[<>&"']/g, c => ({
      '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  // Global hotkey: Ctrl+K / Cmd+K
  document.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) {
      ev.preventDefault();
      if (overlayEl) close(); else open();
    }
  });

  window.CommandPalette = { open, close };
  console.log('[OK] CommandPalette ready (Ctrl+K)');
})();
