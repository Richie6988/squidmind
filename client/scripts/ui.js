const ui = {
  currentSquid: null,

  async init() {
    console.log('[INTERACT] Initializing UI...');
    
    // Load initial stats
    await this.updateStats();
    
    // Setup periodic updates
    setInterval(() => this.updateStats(), 5000);
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
      const response = await api.getAgent(squid.id);
      
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
      
      // Get task count (top-right header element was removed; ControlTowerLive handles it now)
      const taskCountEl = document.getElementById('task-count');
      if (taskCountEl) {
        const tasks = await api.getTaskStatus();
        taskCountEl.textContent = `${tasks.total_jobs} Tasks`;
      }
    } catch (error) {
      // silent - non-critical
    }
  },

  showNotification(message, type = 'info') {
    // Simple console notification for now
    const icon = type === 'success' ? '[OK]' : type === 'error' ? '[ERROR]' : '[INFO]';
    console.log(`${icon} ${message}`);
    
    // TODO: Implement toast notification UI
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

ui._allLogs    = [];   // raw entries from server
ui._logFilter  = 'all';

ui.openLogsModal = async function() {
  const modal = document.getElementById('logs-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.getElementById('lm-list').innerHTML = '<div class="lm-empty">Loading...</div>';
  try {
    const data = await window.ApiV2._fetch('/logs?limit=200');
    // newest first
    ui._allLogs = (data.entries || []).slice().reverse();
    ui.filterLogs();
  } catch (e) {
    document.getElementById('lm-list').innerHTML =
      `<div class="lm-empty lm-empty-err">Failed: ${ui._esc(e.message)}</div>`;
  }
};

ui.setLogFilter = function(btn, cat) {
  document.querySelectorAll('.lm-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  ui._logFilter = cat;
  ui.filterLogs();
};

ui.setSevFilter = function(btn, sev) {
  ui._sevFilter = sev;
  document.querySelectorAll('.lm-sev-btn').forEach(b => b.classList.remove('lm-sev-active'));
  if (sev) btn.classList.add('lm-sev-active');
  ui.filterLogs();
};
ui._sevFilter = '';

ui.filterLogs = function() {
  const search = (document.getElementById('lm-search')?.value || '').toLowerCase();
  const cat    = ui._logFilter  || 'all';
  const sev    = ui._sevFilter  || '';

  const catMatches = (e) => {
    const et = (e.event_type || '').toLowerCase();
    const at = (e.actor?.type || '').toLowerCase();
    if (cat === 'all')      return true;
    if (cat === 'poseidon') return et.startsWith('poseidon_') || et === 'user_input';
    if (cat === 'agent')    return et.startsWith('agent_') || at === 'agent';
    if (cat === 'task')     return et.startsWith('task_') || et === 'task_completed' || et === 'task_failed';
    if (cat === 'project')  return et.startsWith('project_');
    if (cat === 'model')    return et.startsWith('model_') || et.includes('model');
    if (cat === 'error')    return e.severity === 'error' || e.severity === 'warning' || et.includes('fail') || et.includes('error');
    if (cat === 'system')   return at === 'system' || et.startsWith('system_') || et === 'registry_repaired' || et === 'checkpoint_created';
    return true;
  };

  const sevMatches = (e) => {
    if (!sev) return true;
    return (e.severity || 'info') === sev;
  };

  const filtered = (ui._allLogs || []).filter(e => {
    if (!catMatches(e)) return false;
    if (!sevMatches(e)) return false;
    if (search) {
      const hay = [e.event_type, e.action, e.actor?.id, e.subject?.id, e.actor?.type].join(' ').toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  const countEl = document.getElementById('lm-count');
  if (countEl) countEl.textContent = filtered.length + ' entries';

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
  const time = ts.toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const date = ts.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' });
  const et   = e.event_type || 'unknown';
  const sev  = e.severity   || 'info';

  // Icon + colour per event type
  const MAP = {
    system_startup:       ['⚡','lm-ev-system'],
    system_shutdown:      ['⏹','lm-ev-system'],
    model_loaded:         ['📦','lm-ev-model'],
    model_unloaded:       ['🗑','lm-ev-model'],
    model_overloaded:     ['💥','lm-ev-err'],
    agent_created:        ['🤖','lm-ev-agent'],
    agent_woken:          ['👁','lm-ev-agent'],
    agent_slept:          ['💤','lm-ev-agent'],
    agent_archived:       ['📦','lm-ev-agent'],
    task_created:         ['✦','lm-ev-task'],
    task_assigned:        ['→','lm-ev-task'],
    task_started:         ['▶','lm-ev-task'],
    task_completed:       ['✓','lm-ev-ok'],
    task_failed:          ['✗','lm-ev-err'],
    task_cancelled:       ['⊘','lm-ev-warn'],
    task_chunk_completed: ['◈','lm-ev-task'],
    project_created:      ['📁','lm-ev-proj'],
    project_updated:      ['✏','lm-ev-proj'],
    project_archived:     ['📦','lm-ev-proj'],
    user_input:           ['💬','lm-ev-poseidon'],
    poseidon_decision:    ['🔱','lm-ev-poseidon'],
    tool_invoked:         ['⚙','lm-ev-tool'],
    tool_failed:          ['⚠','lm-ev-err'],
    json_update:          ['📝','lm-ev-system'],
    registry_repaired:    ['🔧','lm-ev-warn'],
    checkpoint_created:   ['💾','lm-ev-system'],
  };
  const [icon, cls] = MAP[et] || ['◉', sev === 'error' ? 'lm-ev-err' : 'lm-ev-system'];
  const sevCls = sev === 'error' ? 'lm-sev-err' : sev === 'warning' ? 'lm-sev-warn' : '';
  const actor  = e.actor?.id  !== 'poseidon_main' ? (e.actor?.id || '') : '';
  const subj   = e.subject?.id || '';

  const actionText = e.action || '';
  const preview = actionText.length > 180 ? actionText.slice(0, 180) + '…' : actionText;

  return `<div class="lm-entry ${sevCls}" title="${ui._esc(actionText)}">
    <div class="lm-entry-left">
      <span class="lm-ev-icon ${cls}">${icon}</span>
    </div>
    <div class="lm-entry-body">
      <div class="lm-entry-top">
        <span class="lm-ev-type">${ui._esc(et)}</span>
        ${actor ? `<span class="lm-ev-actor">${ui._esc(actor)}</span>` : ''}
        ${subj  ? `<span class="lm-ev-subj">→ ${ui._esc(subj)}</span>` : ''}
        <span class="lm-time lm-time-inline">${date} ${time}</span>
      </div>
      <div class="lm-action">${ui._esc(preview)}</div>
    </div>
  </div>`;
};

// legacy shim kept for safety
async function loadLogs() { ui.openLogsModal(); }
// Squid Interaction Functions
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
      
      // Refresh canvas temples (legacy)
      if (typeof aquarium !== 'undefined' && aquarium.loadTemples) {
        await aquarium.loadTemples();
      }
      
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
  // Skip if clicking on something that OPENS panels (these have their own toggle)
  if (e.target.closest('.header-nav') || 
      e.target.closest('.btn-new-project') ||
      e.target.closest('.btn-new-project-card') ||
      e.target.closest('#right-panel') ||
      e.target.closest('.projects-container') ||
      e.target.closest('canvas')) {
    return;
  }

  // Skip if click is INSIDE any panel/modal/dropdown content
  if (e.target.closest('.panel') ||
      e.target.closest('.modal-content') ||
      e.target.closest('.modal') ||
      e.target.closest('.context-menu') ||
      e.target.closest('[data-modal]')) {
    // ONLY close if the exact target is the .modal backdrop (not a child element)
    // This prevents accidental closes when clicking inside modal-content
    if (e.target.classList && e.target.classList.contains('modal')) {
      // Verify this is a true backdrop click: no modal-content ancestor
      if (!e.target.querySelector(':scope > .modal-content')?.contains(e.target)) {
        e.target.classList.add('hidden');
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
