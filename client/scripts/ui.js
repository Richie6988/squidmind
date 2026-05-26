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
    if (panel) {
      // NEWEST AT TOP: Move panel to top of DOM (but after Clear All)
      const container = panel.parentElement;
      if (container) {
        panel.remove();
        
        // Find Clear All panel
        const clearAllPanel = document.getElementById('clear-all-panel');
        
        // Insert after Clear All panel (so Clear All stays on top)
        if (clearAllPanel && clearAllPanel.nextSibling) {
          container.insertBefore(panel, clearAllPanel.nextSibling);
        } else {
          container.insertBefore(panel, container.firstChild);
        }
      }
      
      panel.classList.remove('hidden');
      
      // Z-index for overlapping
      const allPanels = document.querySelectorAll('.panel:not(.hidden)');
      allPanels.forEach(p => {
        p.style.zIndex = '100';
      });
      panel.style.zIndex = '200';
      
      console.log(`📌 Panel "${panelId}" at TOP of list (below Clear All)`);
    }
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

async function loadLogs() {
  try {
    const agentFilter = document.getElementById('log-agent-filter').value;
    const statusFilter = document.getElementById('log-status-filter').value;
    
    const filters = {};
    if (agentFilter) filters.agent_id = agentFilter;
    if (statusFilter) filters.status = statusFilter;
    
    const response = await api.getLogs(filters);
    
    if (response.success) {
      const logList = document.getElementById('log-list');
      logList.innerHTML = '';
      
      if (response.logs.length === 0) {
        logList.innerHTML = '<p style="text-align: center; color: var(--text-secondary);">No logs found</p>';
        return;
      }
      
      response.logs.forEach(log => {
        const entry = document.createElement('div');
        entry.className = `log-entry ${log.status}`;
        entry.innerHTML = `
          <div class="log-timestamp">${new Date(log.timestamp).toLocaleString()}</div>
          <div class="log-agent">${log.agent_name} (${log.agent_id})</div>
          <div class="log-message">${log.output || log.error || 'No output'}</div>
          ${log.duration_ms ? `<div style="font-size: 8px; color: var(--text-secondary); margin-top: 4px;">Duration: ${log.duration_ms}ms</div>` : ''}
        `;
        logList.appendChild(entry);
      });
    }
  } catch (error) {
    console.error('Failed to load logs:', error);
  }
}
// Squid Interaction Functions
ui.selectedSquid = null;// Removed detail panel wrapper to fix infinite recursion
// showSquidDetails now handles panel opening directly

ui.showPanel = function(panelName) {
  const panel = document.getElementById(`${panelName}-panel`);
  if (panel) {
    panel.classList.remove('hidden');
    
    // Z-index for overlapping
    const allPanels = document.querySelectorAll('.panel:not(.hidden)');
    allPanels.forEach(p => { p.style.zIndex = '100'; });
    panel.style.zIndex = '200';
    
    console.log(`📌 Panel "${panelName}" opened`);
  }
};

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
    alert('Project name is required!');
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
      alert(`[OK] Project "${name}" created successfully!`);
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
      alert('Failed to create project: ' + data.error);
    }
  } catch (error) {
    console.error('[ERROR] Create project error:', error);
    alert('Error creating project: ' + error.message);
  }
};

// ==================== SQUID DETAIL MODAL ====================

ui.currentSquidForEdit = null;

ui.openSquidDetailModal = function(squid) {
  // V2: always redirect to AgentForm (the proper modal). Old #squid-detail-modal is deprecated.
  if (typeof AgentForm !== 'undefined' && squid?.id) {
    AgentForm.open(squid.id).catch(err => {
      console.error('AgentForm.open failed:', err);
      alert('Could not open agent: ' + err.message);
    });
    return;
  }
  console.warn('AgentForm not loaded, cannot open squid editor');
};
console.log('[OK] UI module with modals loaded');

// ==================== MODEL BROWSER (V2) ====================
// Old file browser removed - use ModelLoader.open() for V2 library workflow
ui.openFileBrowser = function() {
  if (typeof ModelLoader !== 'undefined') ModelLoader.open();
  else alert('ModelLoader not loaded yet');
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
      e.target.closest('#right-panel') ||           // right panel is permanent
      e.target.closest('.projects-container') ||    // projects container (incl temple cards)
      e.target.closest('canvas')) {                 // clicking aquarium itself
    return;
  }
  
  // SPECIAL: clicking the modal backdrop (i.e. .modal itself, not its content) closes it
  // Just hide (do not remove) so the module's cached ref stays valid
  if (e.target.classList && e.target.classList.contains('modal')) {
    e.target.classList.add('hidden');
    return;
  }
  
  // Skip if click is INSIDE any panel/modal/dropdown content - these manage themselves
  if (e.target.closest('.panel') ||
      e.target.closest('.modal-content') ||
      e.target.closest('.modal') ||                // covers all dynamically built modals
      e.target.closest('.context-menu') ||
      e.target.closest('[data-modal]')) {
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
