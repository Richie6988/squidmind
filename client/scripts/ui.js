const ui = {
  currentSquid: null,

  async init() {
    console.log('[INTERACT] Initializing UI...');
    
    // Load initial stats
    await this.updateStats();
    
    // Setup periodic updates
    setInterval(() => this.updateStats(), 5000);

    // Morning brief: shown at most once per calendar day, only if the dream
    // cycle produced one since the last time we showed it.
    this._maybeShowMorningBrief().catch(() => {});
  },

  async _maybeShowMorningBrief() {
    const today = new Date().toISOString().slice(0, 10);
    // Per-day guard persisted in the URL-scoped storage the app already uses.
    if ((window.localStorage?.getItem('iaqua_brief_seen') || '') === today) return;
    const r = await fetch('/api/v2/brief').then(x => x.json()).catch(() => null);
    const b = r?.brief;
    if (!b || !b.generated_at) return;
    // Only show briefs generated in the last 20h — a stale brief from three
    // days ago is noise, not news.
    if (Date.now() - Date.parse(b.generated_at) > 20 * 3600_000) return;
    try { window.localStorage?.setItem('iaqua_brief_seen', today); } catch {}
    const esc = s => String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
    const doneRows = (b.tasks_done_24h || []).slice(0, 6).map(t =>
      `<div style="padding:2px 0;">✓ ${esc(t.title)}${t.agent ? ` <span style="opacity:.6">· ${esc(t.agent)}</span>` : ''}${t.review?.unverified ? ' <span style="color:#f59e0b" title="review defaulted — no parseable verdict">👻</span>' : (Number.isFinite(t.review?.score) ? ` <span style="opacity:.6">${t.review.score}/10</span>` : '')}</div>`
    ).join('') || '<div style="opacity:.6">Nothing finished in the last 24h.</div>';
    const blockRows = (b.blockers || []).slice(0, 4).map(t =>
      `<div style="padding:2px 0;color:#f87171;">⚠ ${esc(t.title)}</div>`).join('');
    const suggRows = (b.suggestions || []).map(s =>
      `<div style="padding:2px 0;color:#4facfe;">→ ${esc(s)}</div>`).join('');
    const schedRows = (b.schedules || []).map(s =>
      `<div style="padding:2px 0;color:${s.fired_24h ? '#06ffa5' : 'var(--ui-muted,#8899aa)'};">⏰ ${esc(s.title)} <span style="opacity:.6">· ${esc(s.expr)}${s.fired_24h ? ' · fired' : ''}</span></div>`).join('');
    const missionRows = (b.missions || []).map(m => {
      const col = m.status === 'achieved' ? '#06ffa5' : m.status === 'active' ? '#4facfe' : '#f59e0b';
      return `<div style="padding:2px 0;color:${col};">⚑ ${esc(m.mission_id)} [${esc(m.status)}] ${esc(m.goal)} <span style="opacity:.6">· iter ${esc(m.iteration)} · tasks ${esc(m.tasks)}</span></div>`;
    }).join('');
    const html = `
      <div style="font-family:'Courier New',monospace;font-size:11px;line-height:1.5;max-width:420px;">
        <div style="font-family:'Press Start 2P',monospace;font-size:10px;margin-bottom:10px;">☀ MORNING BRIEF</div>
        <div style="margin-bottom:8px;"><b>Done (24h)</b> — ${(b.tasks_done_24h || []).length} task(s)</div>
        ${doneRows}
        ${blockRows ? `<div style="margin-top:8px;"><b>Blockers</b></div>${blockRows}` : ''}
        ${b.unverified_reviews ? `<div style="margin-top:8px;color:#f59e0b;">👻 ${b.unverified_reviews} review(s) passed by default — worth a manual check</div>` : ''}
        ${missionRows ? `<div style="margin-top:8px;"><b>Missions</b></div>${missionRows}` : ''}
        ${schedRows ? `<div style="margin-top:8px;"><b>Scheduled</b></div>${schedRows}` : ''}
        ${suggRows ? `<div style="margin-top:8px;"><b>Suggestions</b></div>${suggRows}` : ''}
        <div style="margin-top:8px;opacity:.5;">${(b.open_count ?? 0)} task(s) still open</div>
      </div>`;
    if (window.SquidModal?.custom) SquidModal.custom(html, { okLabel: 'Let\'s go' });
    else if (window.SquidModal?.alert) SquidModal.alert(html.replace(/<[^>]+>/g, ' '));
  },

  showPanel(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;
    
    // Don't reparent the permanent control tower - it has a fixed slot
    if (!panel.classList.contains('right-panel-permanent')) {
      const container = panel.parentElement;
      if (container) {
        panel.remove();
        const clearAllPanel = document.getElementById('clear-all-panel');
        if (clearAllPanel && clearAllPanel.nextSibling) {
          container.insertBefore(panel, clearAllPanel.nextSibling);
        } else {
          container.insertBefore(panel, container.firstChild);
        }
      }
    }
    
    panel.classList.remove('hidden');
    
    // Z-index for overlapping (only toggleable panels, not the right panel)
    document.querySelectorAll('.panel:not(.hidden):not(.right-panel-permanent)').forEach(p => {
      p.style.zIndex = '100';
    });
    panel.style.zIndex = '200';
    
    console.log(`📌 Panel "${panelId}" opened`);
  },

  hidePanel(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (panel) {
      panel.classList.add('hidden');
    }
  },

  async showSquidDetail(squid) {
    this.currentSquid = squid;
    // Fetch full agent data
    try {
      const response = await api.agents.get(squid.id);
      
      if (response.success) {
        const agent = response.agent;
        
        // Update panel title
        document.getElementById('detail-title').textContent = `[SQUID] ${agent.name}`;
        
        // Build detail content
        const content = document.getElementById('detail-content');
        content.innerHTML = `
          <div class="agent-detail">
            <p><strong>ID:</strong> ${agent.id}</p>
            <p><strong>Type:</strong> ${agent.type}</p>
            <p><strong>Status:</strong> <span class="status-${agent.status}">${agent.status}</span></p>
            <p><strong>Created:</strong> ${new Date(agent.created_at).toLocaleDateString()}</p>
            
            <h3 style="margin-top: 16px;">System Prompt</h3>
            <pre style="background: var(--ocean-deep); padding: 8px; overflow-x: auto; font-size: 9px;">${agent.prompt.system}</pre>
            
            <h3 style="margin-top: 16px;">Configuration</h3>
            <p><strong>Model:</strong> ${agent.llm.model}</p>
            <p><strong>Temperature:</strong> ${agent.llm.temperature}</p>
            
            ${agent.schedule.cron ? `
              <h3 style="margin-top: 16px;">Schedule</h3>
              <p><strong>Cron:</strong> ${agent.schedule.cron}</p>
              <p><strong>Enabled:</strong> ${agent.schedule.enabled ? 'Yes' : 'No'}</p>
            ` : ''}
          </div>
        `;
        
        this.showPanel('detail');
      }
    } catch (error) {
      console.error('Failed to load agent details:', error);
    }
  },

  async updateStats() {
    try {
      // Status indicator (top-right): GREEN if a model is loaded for Poseidon,
      // RED if no model loaded or no model assigned. The user wanted
      // model-loaded status here, not just API-connected.
      const apiStatus = document.getElementById('api-status');
      if (apiStatus) {
        try {
          const res = await fetch('/api/v2/models/status', { cache: 'no-store' });
          const status = res.ok ? await res.json() : {};
          const hasLoaded = status.poseidon_model_id && status.loaded_models?.some(m => m.model_id === status.poseidon_model_id);
          apiStatus.style.color = hasLoaded ? '#06FFA5' : '#E63946';
          apiStatus.title = hasLoaded
            ? `Model loaded: ${status.poseidon_model_id}`
            : (status.poseidon_model_id ? `Model assigned but not loaded: ${status.poseidon_model_id}` : 'No model assigned to Poseidon');
        } catch {
          apiStatus.style.color = '#E63946';
          apiStatus.title = 'Server unreachable';
        }
      }
      
    } catch (error) {
      // silent - non-critical
    }
  },

  showNotification(message, type = 'info') {
    // Bridge to ToastManager when available; fall back to console.
    if (window.ToastManager) {
      window.ToastManager.show({ type, title: String(message).slice(0, 80), duration: 4000 });
    } else {
      const icon = type === 'success' ? '[OK]' : type === 'error' ? '[ERROR]' : '[INFO]';
      console.log(`${icon} ${message}`);
    }
  }
};

// CRITICAL: Export to window IMMEDIATELY so onclick handlers work
window.ui = ui;
console.log('[OK] UI exported to window');
// Update schedule preview

// Describe cron in human terms

// ══════════════════════════════════════════════════════════
// LOGS PANEL
// ══════════════════════════════════════════════════════════

ui._allLogs   = [];
ui._logFilter = 'all';
ui._sevFilter = '';
ui._liveTimer = null;

ui.closeLogsModal = function() {
  document.getElementById('logs-modal').classList.add('hidden');
  clearInterval(ui._liveTimer);
  ui._liveTimer = null;
};

// ── Custom dropdown helpers ──────────────────────────────────────────────────
ui._lmToggleDrop = function(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const isOpen = wrap.classList.contains('lm-drop-open');
  // Close all first
  document.querySelectorAll('.lm-drop-wrap').forEach(w => w.classList.remove('lm-drop-open'));
  if (!isOpen) wrap.classList.add('lm-drop-open');
};

ui._lmPickDrop = function(wrapId, hiddenId, item, label, reload) {
  const wrap   = document.getElementById(wrapId);
  const hidden = document.getElementById(hiddenId);
  if (!wrap || !hidden) return;
  // Update active state
  wrap.querySelectorAll('.lm-drop-item').forEach(i => i.classList.remove('active'));
  item.classList.add('active');
  // Update label + hidden value
  const valEl = wrap.querySelector('.lm-drop-val');
  if (valEl) valEl.textContent = label;
  hidden.value = item.dataset.val || '';
  wrap.classList.remove('lm-drop-open');
  if (reload) ui.reloadLogs(); else ui.filterLogs();
};

// Close dropdowns on outside click
document.addEventListener('click', function(e) {
  const t = e.target;
  const el = (t && typeof t.closest === 'function') ? t : (t && t.parentElement);
  if (!el) return;
  if (!el.closest('.lm-drop-wrap')) {
    document.querySelectorAll('.lm-drop-wrap').forEach(w => w.classList.remove('lm-drop-open'));
  }
});
// ── End custom dropdown helpers ──────────────────────────────────────────────

ui.toggleLiveLog = function(cb) {
  clearInterval(ui._liveTimer);
  if (cb.checked) ui._liveTimer = setInterval(() => ui.reloadLogs(), 5000);
};

ui.reloadLogs = async function() {
  const limit = document.getElementById('lm-limit')?.value || 200;
  try {
    const data = await window.api._fetch('/logs?limit=' + limit);
    ui._allLogs = (data.entries || []).slice().reverse();
    ui.filterLogs();
  } catch (e) {
    const list = document.getElementById('lm-list');
    if (list) list.innerHTML = `<div class="lm-empty lm-empty-err">Failed: ${ui._esc(e.message)}</div>`;
  }
};

ui.openLogsModal = async function() {
  const modal = document.getElementById('logs-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('lm-list').innerHTML = '<div style="padding:12px;">' + ['<div class="iaqua-skel iaqua-skel-line" style="width:80%;"></div>', '<div class="iaqua-skel iaqua-skel-line" style="width:60%;"></div>', '<div class="iaqua-skel iaqua-skel-line" style="width:75%;"></div>', '<div class="iaqua-skel iaqua-skel-line" style="width:50%;"></div>'].join('') + '</div>';
  await ui.reloadLogs();
};

ui.setLogFilter = function(btn, cat) {
  document.querySelectorAll('.lm-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ui._logFilter = cat;
  ui.filterLogs();
};

ui.filterLogs = function() {
  const search = (document.getElementById('lm-search')?.value || '').toLowerCase();
  const cat    = ui._logFilter || 'all';
  const sev    = document.getElementById('lm-sev')?.value   || '';
  const actor  = document.getElementById('lm-actor')?.value || '';

  const catMatches = (e) => {
    const et = (e.event_type || '').toLowerCase();
    const at = (e.actor?.type || '').toLowerCase();
    const ai = (e.actor?.id   || '').toLowerCase();
    if (cat === 'all')      return true;
    if (cat === 'dream')    return et === 'poseidon_dream' || ai === 'poseidon_dream';
    if (cat === 'poseidon') return et.startsWith('poseidon_') || et === 'user_input';
    if (cat === 'agent')    return et.startsWith('agent_') || at === 'agent';
    if (cat === 'task')     return et.startsWith('task_') || et === 'task_completed' || et === 'task_failed';
    if (cat === 'project')  return et.startsWith('project_');
    if (cat === 'model')    return et.startsWith('model_') || et.includes('model');
    if (cat === 'error')    return e.severity === 'error' || e.severity === 'warning' || et.includes('fail') || et.includes('error');
    if (cat === 'system')   return at === 'system' || et.startsWith('system_') || et === 'registry_repaired' || et === 'checkpoint_created';
    return true;
  };

  const filtered = (ui._allLogs || []).filter(e => {
    if (!catMatches(e)) return false;
    if (sev   && (e.severity || 'info') !== sev) return false;
    if (actor && (e.actor?.id || '') !== actor)   return false;
    if (search) {
      const hay = [e.event_type, e.action, e.actor?.id, e.subject?.id, e.context?.full_dream].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const countEl = document.getElementById('lm-count');
  if (countEl) countEl.textContent = filtered.length + ' / ' + ui._allLogs.length;

  const list = document.getElementById('lm-list');
  if (!list) return;
  if (filtered.length === 0) {
    list.innerHTML = '<div class="lm-empty">No matching entries</div>';
    return;
  }
  list.innerHTML = filtered.map(e => ui._renderLogEntry(e)).join('');
};

ui._renderLogEntry = function(e) {
  const ts   = new Date(e.timestamp);
  const now  = Date.now();
  const ago  = Math.floor((now - ts) / 1000);
  const rel  = ago < 60  ? ago + 's ago'
             : ago < 3600 ? Math.floor(ago/60) + 'm ago'
             : ago < 86400 ? Math.floor(ago/3600) + 'h ago'
             : ts.toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit'});
  const timeStr = ts.toLocaleTimeString('fr-FR', {hour:'2-digit',minute:'2-digit',second:'2-digit'});

  const et  = e.event_type || 'unknown';
  const sev = e.severity   || 'info';

  const PI = window.PixelIcons;
  const ic = (name, fb) => PI?.inline(name, 11) || fb;
  const MAP = {
    system_startup:       [ic('launch','⚡'),    'lm-ev-system'],
    system_shutdown:      ['⏹',                  'lm-ev-system'],
    model_loaded:         [ic('models','◈'),      'lm-ev-model'],
    model_unloaded:       [ic('clean','◇'),       'lm-ev-model'],
    model_overloaded:     [ic('error','✗'),       'lm-ev-err'],
    agent_created:        [ic('squid','◉'),       'lm-ev-agent'],
    agent_woken:          [ic('bolt','▶'),        'lm-ev-agent'],
    agent_slept:          [ic('moon','~'),        'lm-ev-agent'],
    agent_archived:       [ic('data','◈'),        'lm-ev-agent'],
    task_created:         ['✦',                   'lm-ev-task'],
    task_assigned:        ['→',                   'lm-ev-task'],
    task_started:         [ic('launch','▶'),      'lm-ev-task'],
    task_completed:       [ic('ok','✓'),          'lm-ev-ok'],
    task_failed:          [ic('error','✗'),       'lm-ev-err'],
    task_cancelled:       ['⊘',                   'lm-ev-warn'],
    project_created:      [ic('temple','◈'),      'lm-ev-proj'],
    project_updated:      [ic('config','✏'),      'lm-ev-proj'],
    project_archived:     [ic('data','◈'),        'lm-ev-proj'],
    user_input:           [ic('interact','💬'),   'lm-ev-poseidon'],
    poseidon_decision:    [ic('poseidon','⬡'),    'lm-ev-poseidon'],
    poseidon_dream:       [ic('brain','~'),       'lm-ev-dream'],
    tool_invoked:         [ic('tools','⚙'),       'lm-ev-tool'],
    tool_failed:          ['⚠',                   'lm-ev-err'],
    json_update:          [ic('data','◈'),        'lm-ev-system'],
    registry_repaired:    [ic('config','⚙'),      'lm-ev-warn'],
    checkpoint_created:   [ic('stats','◈'),       'lm-ev-system'],
    file_modified:        [ic('logs','◈'),        'lm-ev-system'],
  };
  const [icon, cls] = MAP[et] || ['◉', sev === 'error' ? 'lm-ev-err' : 'lm-ev-system'];
  const sevCls = sev === 'error' ? 'lm-sev-err' : sev === 'warning' ? 'lm-sev-warn' : '';
  const actorId = (e.actor?.id || '');
  const subj    = e.subject?.id || '';
  const isDream = et === 'poseidon_dream';

  const actionText = e.action || '';
  const preview = actionText.length > 200 ? actionText.slice(0, 200) + '…' : actionText;

  // Dream entries: show full content expandable
  const fullContent = isDream && e.context?.full_dream
    ? `<div class="lm-dream-full" style="display:none"><pre class="lm-dream-pre">${ui._esc(e.context.full_dream)}</pre></div>`
    : (e.context?.full_dream ? `<div class="lm-dream-full" style="display:none"><pre class="lm-dream-pre">${ui._esc(e.context.full_dream)}</pre></div>` : '');
  const expandBtn = (fullContent || actionText.length > 200)
    ? `<button class="lm-expand-btn" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none';this.textContent=this.textContent==='▶'?'▼':'▶'">▶</button>`
    : '';
  const expandFull = fullContent || (actionText.length > 200
    ? `<div class="lm-dream-full" style="display:none"><pre class="lm-dream-pre">${ui._esc(actionText)}</pre></div>` : '');

  const uid = 'lm_' + Math.random().toString(36).slice(2);

  return `<div class="lm-entry ${sevCls} ${isDream ? 'lm-entry-dream' : ''}" title="${ui._esc(timeStr)}">
    <div class="lm-entry-left">
      <span class="lm-ev-icon ${cls}">${icon}</span>
    </div>
    <div class="lm-entry-body">
      <div class="lm-entry-top">
        <span class="lm-ev-type">${ui._esc(et)}</span>
        ${actorId && actorId !== 'poseidon_main' ? `<span class="lm-ev-actor">${ui._esc(actorId)}</span>` : ''}
        ${subj ? `<span class="lm-ev-subj">→ ${ui._esc(subj)}</span>` : ''}
        <span class="lm-time lm-time-inline" title="${ui._esc(timeStr)}">${rel}</span>
      </div>
      <div class="lm-action">${ui._esc(preview)} ${expandBtn}${expandFull}</div>
    </div>
  </div>`;
};


ui.selectedSquid = null;

console.log('[OK] UI panel manager loaded');

ui._esc = function(s) {
  return String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
};

console.log('[OK] UI panel manager loaded');

// Clear All Panels
ui.clearAllPanels = function() {
  console.log('[CLEAN] Clearing all panels');
  
  // Get all panels
  const panels = document.querySelectorAll('.panel:not(.hidden)');
  
  panels.forEach(panel => {
    panel.classList.add('hidden');
  });
  
  // Also close temple interior if open
  const interior = document.getElementById('temple-interior');
  if (interior) {
    interior.classList.add('hidden');
  }
  
  // Close model selector if open
  const modelSelector = document.getElementById('model-selector-panel');
  if (modelSelector) {
    modelSelector.classList.add('hidden');
  }
  
  console.log(`[OK] Closed ${panels.length} panels`);
};
// Auto-update monitor every 2 seconds
setInterval(() => {
  const monitorPanel = document.getElementById('monitor-panel');
  if (monitorPanel && !monitorPanel.classList.contains('hidden')) {
  }
}, 2000);

console.log('[CLEAN] Clear All & Monitor system loaded');

// Model Management Functions
/**
 * Scan for models in common locations
 */

console.log('[MODELS] Model management functions loaded');

// ==================== NEW PROJECT MODAL ====================

ui.openNewProjectModal = function() {
  const modal = document.getElementById('new-project-modal');
  if (modal) {
    modal.classList.remove('hidden');
  }
};

ui.closeNewProjectModal = function() {
  const modal = document.getElementById('new-project-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
};

ui.createNewProject = async function() {
  const name = document.getElementById('new-project-name').value.trim();
  const vision = document.getElementById('new-project-vision').value.trim();
  const colorOutside = document.getElementById('new-project-color-outside').value;
  const colorInside = document.getElementById('new-project-color-inside').value;
  
  if (!name) {
    await SquidModal.alert('Project name is required!');
    return;
  }
  
  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        vision,
        colors: {
          outside: colorOutside,
          inside: colorInside
        }
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      await SquidModal.alert(`[OK] Project "${name}" created successfully!`);
      this.closeNewProjectModal();
      
      // Refresh HTML temple cards (the new projects-container)
      if (typeof ProjectsPanel !== 'undefined') {
        await ProjectsPanel.refresh();
      }
      
      // Clear form
      document.getElementById('new-project-name').value = '';
      document.getElementById('new-project-vision').value = '';
    } else {
      await SquidModal.alert('Failed to create project: ' + data.error);
    }
  } catch (error) {
    console.error('[ERROR] Create project error:', error);
    await SquidModal.alert('Error creating project: ' + error.message);
  }
};

// ==================== SQUID DETAIL MODAL ====================

ui.currentSquidForEdit = null;

ui.openSquidDetailModal = function(squid) {
  // V2: always redirect to AgentForm (the proper modal). Old #squid-detail-modal is deprecated.
  if (typeof AgentForm !== 'undefined' && squid?.id) {
    AgentForm.open(squid.id).catch(async err => {
      console.error('AgentForm.open failed:', err);
      await SquidModal.alert('Could not open agent: ' + err.message);
    });
    return;
  }
  console.warn('AgentForm not loaded, cannot open squid editor');
};
console.log('[OK] UI module with modals loaded');

// ==================== MODEL BROWSER (V2) ====================
// Old file browser removed - use ModelLoader.open() for V2 library workflow
ui.openFileBrowser = async function() {
  if (typeof ModelLoader !== 'undefined') ModelLoader.open();
  else await SquidModal.alert('ModelLoader not loaded yet');
};
console.log('[OK] ui.openFileBrowser redirects to ModelLoader');

// ==================== CLICK OUTSIDE TO CLOSE PANELS ====================
// Uses .hidden only (never removes DOM nodes) so cached modal references in
// ModelLoader / AgentForm / PoseidonChat / Scheduler stay valid for next open().

function _smCloseAllVisiblePanels() {
  document.querySelectorAll('.panel:not(.hidden):not(.right-panel-permanent)').forEach(p => {
    p.classList.add('hidden');
  });
  document.querySelectorAll('.modal:not(.hidden)').forEach(m => {
    m.classList.add('hidden');
  });
}

document.addEventListener('mousedown', function(e) {
  // e.target can be a Text node, Document, or Window depending on where
  // the mousedown lands (SVG text, scrollbar, iframe boundary…). Those
  // don't expose .closest and would throw the whole listener. Coalesce
  // to the nearest Element ancestor before dispatching the panel logic.
  const t = e.target;
  const el = (t && typeof t.closest === 'function')
    ? t
    : (t && t.parentElement)              // Text node → parent Element
      || (t && t.nodeType === 9 && t.documentElement)  // Document → root
      || null;
  if (!el || typeof el.closest !== 'function') return;

  // Skip if clicking on something that OPENS panels (these have their own toggle)
  if (el.closest('.header-nav') || 
      el.closest('.btn-new-project') ||
      el.closest('.btn-new-project-card') ||
      el.closest('#right-panel') ||
      el.closest('.projects-container') ||
      el.closest('canvas')) {
    return;
  }

  // Skip if click is INSIDE any panel/modal/dropdown content
  if (el.closest('.panel') ||
      el.closest('.modal-content') ||
      el.closest('.modal') ||
      el.closest('.context-menu') ||
      el.closest('[data-modal]')) {
    // ONLY close if the exact target is the .modal backdrop (not a child element)
    // This prevents accidental closes when clicking inside modal-content
    if (el.classList && el.classList.contains('modal')) {
      // Skip modals that explicitly opt out of backdrop-close (e.g. ModelLoader panel)
      if (el.dataset && el.dataset.noBackdropClose) return;
      // Verify this is a true backdrop click: no modal-content ancestor
      if (!el.querySelector?.(':scope > .modal-content')?.contains(el)) {
        el.classList.add('hidden');
      }
    }
    return;
  }
  
  // Click was truly outside - close everything visible
  _smCloseAllVisiblePanels();
});

// ESC key also closes everything
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') _smCloseAllVisiblePanels();
});

console.log('[OK] Click outside + ESC to close panels enabled');

console.log('[OK] Click outside to close panels enabled');

// ==================== HEARTBEAT (keeps server alive while webapp open) ====================
// Server auto-shuts-down 60s after last heartbeat. Client pings every 10s.
(function setupHeartbeat() {
  let consecutiveFailures = 0;
  const ping = async () => {
    try {
      await fetch('/api/v2/heartbeat', { method: 'POST' });
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures++;
      if (consecutiveFailures > 6) {
        console.warn('[heartbeat] Server unreachable - it may have shut down.');
      }
    }
  };
  // First ping immediately, then every 10s
  ping();
  setInterval(ping, 10000);
})();
console.log('[OK] Server heartbeat active (every 10s)');
