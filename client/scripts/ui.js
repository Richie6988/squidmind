const ui = {
  currentSquid: null,

  async init() {
    console.log('[INTERACT] Initializing UI...');
    
    // Setup form handlers
    this.setupFormHandlers();
    
    // Load initial stats
    await this.updateStats();
    
    // Setup periodic updates
    setInterval(() => this.updateStats(), 5000);
  },

  setupFormHandlers() {
    // Squid creation form
    const form = document.getElementById('squid-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleCreateSquid(e.target);
    });
    
    // Temperature slider
    const tempSlider = form.querySelector('[name="temperature"]');
    const tempValue = form.querySelector('.range-value');
    tempSlider.addEventListener('input', (e) => {
      tempValue.textContent = e.target.value;
    });
  },

  async handleCreateSquid(form) {
    const formData = new FormData(form);
    
    const agentData = {
      name: formData.get('name'),
      type: 'worker',
      prompt: {
        system: formData.get('system_prompt'),
        context: []
      },
      llm: {
        provider: 'anthropic',
        model: formData.get('model'),
        temperature: parseFloat(formData.get('temperature')),
        max_tokens: 4000
      },
      schedule: {
        cron: formData.get('cron') || null,
        timezone: 'Europe/Paris',
        enabled: formData.get('schedule_enabled') === 'on'
      }
    };
    
    try {
      const response = await api.createAgent(agentData);
      
      if (response.success) {
        console.log('[OK] Squid created:', response.agent);
        
        // Add to aquarium
        aquarium.addSquid(response.agent);
        
        // Reset form and hide panel
        form.reset();
        this.hidePanel('creator');
        
        // Show success message
        this.showNotification(`[SQUID] ${response.agent.name} hatched!`, 'success');
      }
    } catch (error) {
      console.error('Failed to create squid:', error);
      this.showNotification(`Error: ${error.message}`, 'error');
    }
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
async function editSquid() {
  if (!ui.currentSquid) return;
  
  // Populate edit form with current squid data
  const form = document.getElementById('edit-squid-form');
  const squid = ui.currentSquid;
  
  form.elements['id'].value = squid.id;
  form.elements['name'].value = squid.name;
  form.elements['system_prompt'].value = squid.system_prompt || '';
  form.elements['model'].value = squid.model || 'claude-sonnet-4-20250514';
  form.elements['temperature'].value = squid.temperature || 0.7;
  
  // Appearance
  if (squid.appearance) {
    form.elements['body_color'].value = squid.appearance.body_color || '#E63946';
    form.elements['accent_color'].value = squid.appearance.accent_color || '#06FFA5';
    form.elements['eye_style'].value = squid.appearance.eye_style || 'normal';
    form.elements['size'].value = squid.appearance.size || 'medium';
  }
  
  // Outfit
  if (squid.outfit) {
    form.elements['hat'].value = squid.outfit.hat || '';
    form.elements['accessory'].value = squid.outfit.accessory || '';
    form.elements['tool'].value = squid.outfit.tool || '';
  }
  
  // Schedule
  form.elements['schedule_enabled'].checked = squid.schedule?.enabled || false;
  if (squid.schedule?.cron) {
    document.getElementById('cron-value').value = squid.schedule.cron;
    ui.updateSchedulePreview(squid.schedule.cron);
  }
  
  // Update range display
  const rangeValue = form.querySelector('.range-value');
  if (rangeValue) rangeValue.textContent = squid.temperature || 0.7;
  
  // Hide detail panel, show edit panel
  ui.hidePanel('detail');
  ui.showPanel('edit');
}
// Update schedule preview
ui.updateSchedulePreview = function(cron) {
  const preview = document.getElementById('schedule-preview');
  if (!preview) return;
  
  const description = ui.describeCron(cron);
  preview.innerHTML = `📅 <strong>Schedule:</strong> ${description}`;
  preview.style.display = 'block';
};

// Describe cron in human terms
ui.describeCron = function(cron) {
  if (!cron) return 'Not scheduled';
  
  const patterns = {
    '0 * * * *': 'Every hour',
    '0 9 * * *': 'Daily at 9:00 AM',
    '0 9 * * 1': 'Every Monday at 9:00 AM',
    '0 9 * * 5': 'Every Friday at 9:00 AM',
    '0 0 * * *': 'Daily at midnight',
    '0 12 * * *': 'Daily at noon'
  };
  
  return patterns[cron] || `Custom: ${cron}`;
};

// Handle edit form submission
document.addEventListener('DOMContentLoaded', () => {
  const editForm = document.getElementById('edit-squid-form');
  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const formData = new FormData(editForm);
      const agentId = formData.get('id');
      
      const updatedAgent = {
        name: formData.get('name'),
        system_prompt: formData.get('system_prompt'),
        model: formData.get('model'),
        temperature: parseFloat(formData.get('temperature')),
        appearance: {
          body_color: formData.get('body_color'),
          accent_color: formData.get('accent_color'),
          eye_style: formData.get('eye_style'),
          size: formData.get('size')
        },
        outfit: {
          hat: formData.get('hat'),
          accessory: formData.get('accessory'),
          tool: formData.get('tool')
        },
        schedule: {
          enabled: formData.get('schedule_enabled') === 'on',
          cron: document.getElementById('cron-value').value || null
        }
      };
      
      try {
        const response = await api.updateAgent(agentId, updatedAgent);
        
        if (response.success) {
          ui.showNotification('Squid updated successfully!', 'success');
          ui.hidePanel('edit');
          
          // Update squid in memory immediately
          const squid = aquarium.squids.find(s => s.id === agentId);
          if (squid) {
            squid.name = updatedAgent.name;
            squid.specialty = updatedAgent.specialty;
            squid.brain = updatedAgent.brain;
            squid.outfit = updatedAgent.outfit || squid.outfit;
            console.log('[OK] Squid updated in memory:', squid.name);
          }
          
          // Also reload from server to be safe
          await aquarium.loadSquids();
        }
      } catch (error) {
        ui.showNotification('Failed to update squid: ' + error.message, 'error');
      }
    });
  }
});
// Load model
ui.loadModel = async function(modelPath) {
  try {
    console.log('Loading model:', modelPath);
    
    const response = await fetch('/api/models/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath })
    });
    
    const data = await response.json();
    console.log('Load model response:', data);
    
    if (data.success) {
      ui.showNotification('Model loaded successfully!', 'success');
      await ui.loadModels();
    } else {
      throw new Error(data.error || 'Failed to load model');
    }
  } catch (error) {
    console.error('Load model error:', error);
    ui.showNotification('Failed to load model: ' + error.message, 'error');
  }
};

// Unload model
ui.unloadModel = async function(modelPath) {
  try {
    console.log('Unloading model:', modelPath);
    
    const response = await fetch('/api/models/unload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath })
    });
    
    const data = await response.json();
    console.log('Unload model response:', data);
    
    if (data.success) {
      ui.showNotification('Model unloaded successfully!', 'success');
      await ui.loadModels();
    } else {
      throw new Error(data.error || 'Failed to unload model');
    }
  } catch (error) {
    console.error('Unload model error:', error);
    ui.showNotification('Failed to unload model: ' + error.message, 'error');
  }
};

// Show model details
ui.showModelDetails = function(model) {
  const details = `
Model: ${model.name || model.file}
Path: ${model.full_path || model.path}
Size: ${model.size_mb} MB
Format: ${model.format}
Source: ${model.source}
${model.quantization ? 'Quantization: ' + model.quantization : ''}
${model.parameters ? 'Parameters: ' + model.parameters : ''}
  `.trim();
  
  alert(details);
};

async function deleteSquid() {
  if (!ui.currentSquid) return;
  
  const confirmed = confirm(`Delete ${ui.currentSquid.name}?`);
  if (!confirmed) return;
  
  try {
    const response = await api.deleteAgent(ui.currentSquid.id);
    
    if (response.success) {
      aquarium.removeSquid(ui.currentSquid.id);
      ui.hidePanel('detail');
      ui.showNotification('Squid deleted', 'success');
    }
  } catch (error) {
    console.error('Failed to delete squid:', error);
    ui.showNotification(`Error: ${error.message}`, 'error');
  }
}

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
ui.addPoseidonMessage = function(message, sender) {
  const messagesDiv = document.getElementById('poseidon-chat-messages');
  
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${sender}`;
  
  const header = document.createElement('div');
  header.className = 'chat-message-header';
  header.textContent = sender === 'poseidon' ? '[POSEIDON] Poseidon' : '👤 You';
  
  const content = document.createElement('div');
  content.className = 'chat-message-content';
  content.innerHTML = message.replace(/\n/g, '<br>');
  
  messageEl.appendChild(header);
  messageEl.appendChild(content);
  messagesDiv.appendChild(messageEl);
  
  // Scroll to bottom
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
};

ui.updatePoseidonSuggestions = function(suggestions) {
  const suggestionsDiv = document.getElementById('poseidon-suggestions');
  
  suggestionsDiv.innerHTML = suggestions.map(s => 
    `<div class="poseidon-suggestion" onclick="ui.usePoseidonSuggestion('${s}')">${s}</div>`
  ).join('');
};

ui.usePoseidonSuggestion = function(suggestion) {
  document.getElementById('poseidon-chat-input').value = suggestion;
  ui.sendToPoseidon();
};

// Squid Interaction Functions
ui.selectedSquid = null;
ui.showSquidContextMenu = function(squid, x, y) {
  this.selectedSquid = squid;
  
  const menu = document.getElementById('squid-menu');
  menu.classList.remove('hidden');
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
};
// Removed detail panel wrapper to fix infinite recursion
// showSquidDetails now handles panel opening directly

ui.showPanel = function(panelName) {
  const panel = document.getElementById(`${panelName}-panel`);
  if (panel) {
    // Just show the panel - no complex DOM manipulation
    panel.classList.remove('hidden');
    
    // Z-index for overlapping
    const allPanels = document.querySelectorAll('.panel:not(.hidden)');
    allPanels.forEach(p => {
      p.style.zIndex = '100';
    });
    panel.style.zIndex = '200';
    
    console.log(`📌 Panel "${panelName}" opened`);
  }
  
  if (panelName === 'poseidon') {
    // Initialize Poseidon chat if empty
    const messagesDiv = document.getElementById('poseidon-chat-messages');
    if (!messagesDiv.hasChildNodes()) {
      // Initialize Poseidon chat with greeting
      const greeting = "[OCEAN] Greetings, mortal! I am Poseidon, God of the Ocean. I command the squids of this realm. How may I assist you?";
      this.addPoseidonMessage(greeting, 'poseidon');
      this.updatePoseidonSuggestions(['Show my squids', 'Create a task', 'Help me']);
    }
    
    // Populate model dropdown
    if (typeof poseidon !== 'undefined' && poseidon.populateModelDropdown) {
      poseidon.populateModelDropdown();
    }
  }
  
  if (panelName === 'monitor') {
    // Update system monitor stats
    this.updateSystemMonitor();
  }
  
  if (panelName === 'creator' || panelName === 'edit') {
    this.loadAvailableTools();
  }
};

// Close context menu on click outside
document.addEventListener('click', (e) => {
  if (!e.target.closest('.context-menu') && !e.target.closest('canvas')) {
    document.getElementById('squid-menu').classList.add('hidden');
  }
});

console.log('[OK] Poseidon & Interaction UI loaded');

// Initialize Poseidon AI on startup
async function initializePoseidonAI() {
  try {
    console.log('[POSEIDON] Initializing Poseidon AI...');
    const poseidonReady = await poseidon.initialize();
    
    if (poseidonReady) {
      const info = poseidon.getModelInfo();
      ui.showNotification(`⚡ Poseidon AI ready! (${info.model})`, 'success');
      
      // Update Poseidon panel with model info
      const poseidonPanel = document.querySelector('.poseidon-subtitle');
      if (poseidonPanel) {
        poseidonPanel.textContent = `Supreme Dispatcher • ${info.mode}`;
      }
    } else {
      console.warn('⚠️ Poseidon running in fallback mode');
      ui.showNotification('Poseidon: Load a model for full AI power', 'warning');
    }
  } catch (error) {
    console.error('Poseidon init error:', error);
  }
}

// Call Poseidon init after DOM loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializePoseidonAI);
} else {
  initializePoseidonAI();
}

console.log('[POSEIDON] Poseidon AI module loaded');
ui._esc = function(s) {
  return String(s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
};

// Load imported models into the creator's model dropdown
ui.loadCreatorModels = async function() {
  try {
    const sel = document.getElementById('creator-model-select');
    if (!sel) return;
    const res = await fetch('/api/v2/models/library');
    const data = await res.json();
    const imported = (data.models || []).filter(m => m.imported);
    // Preserve the "(use Poseidon default)" option
    sel.innerHTML = '<option value="">(use Poseidon default)</option>' +
      imported.map(m => `<option value="${ui._esc(m.model_id)}">${ui._esc(m.model_id)} (${m.file_size_gb || '?'} GB)</option>`).join('');
    if (imported.length === 0) {
      const opt = document.createElement('option');
      opt.disabled = true;
      opt.textContent = '(no models imported - open Models panel)';
      sel.appendChild(opt);
    }
  } catch (err) {
    console.warn('Failed to load creator models:', err);
  }
};
ui.getSelectedTools = function(formElement) {
  const checkboxes = formElement.querySelectorAll('#tools-checklist input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
};

// Initialize tools and models when panels open
const originalShowPanelForTools = ui.showPanel;
ui.showPanel = function(panelName) {
  originalShowPanelForTools.call(this, panelName);
  
  if (panelName === 'creator' || panelName === 'edit') {
    ui.loadAvailableTools();
  }
  if (panelName === 'creator') {
    ui.loadCreatorModels();
  }
};

console.log('🛠️ Tool selection system loaded');

// Temple Data Room
ui.enterTemple = function(temple) {
  // REMOVED - TempleInterior.open() handles temple display now
  console.log('enterTemple deprecated - using TempleInterior.open() instead');
};

console.log('[TEMPLE] Temple UI functions loaded');

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
    ui.updateSystemMonitor();
  }
}, 2000);

console.log('[CLEAN] Clear All & Monitor system loaded');

// Model Management Functions

/**
 * Add model from file browser
 */
ui.addModelFromFile = async function(input) {
  const file = input.files[0];
  if (!file) return;
  
  const path = file.path || file.name;
  console.log('📁 Adding model from file:', path);
  
  if (file.path) {
    // Electron - has full path
    await this.addModelByPath(file.path);
  } else {
    // Web browser - show path instruction
    alert('File selected: ' + file.name + '\n\nPlease copy the full path and use "Add Model by Path" instead.\n\nExample:\n/home/user/.cache/huggingface/hub/models--TheBloke--Llama-2-7B/snapshots/abc123/' + file.name);
  }
};

/**
 * Add model by manual path
 */
ui.addModelByPath = async function(pathOverride) {
  let path = pathOverride;
  
  if (!path) {
    const input = document.getElementById('model-manual-path');
    path = input ? input.value.trim() : '';
  }
  
  if (!path) {
    alert('Please enter a model path');
    return;
  }
  
  console.log('➕ Adding model:', path);
  
  try {
    const response = await fetch('/api/models/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path })
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert('Model added successfully!');
      this.loadModels(); // Refresh list
      
      // Update Poseidon dropdown if panel is open
      if (typeof poseidon !== 'undefined' && poseidon.populateModelDropdown) {
        poseidon.populateModelDropdown();
      }
    } else {
      alert('Failed to add model: ' + data.error);
    }
  } catch (error) {
    console.error('[ERROR] Add model error:', error);
    alert('Error adding model: ' + error.message);
  }
};

/**
 * Scan for models in common locations
 */
ui.scanForModels = async function() {
  console.log('🔍 Scanning for models...');
  
  try {
    const response = await fetch('/api/models/scan');
    const data = await response.json();
    
    if (data.success) {
      const count = data.models ? data.models.length : 0;
      alert(`Found ${count} models!\n\nRefreshing model list...`);
      this.loadModels(); // Refresh list
      
      // Update Poseidon dropdown
      if (typeof poseidon !== 'undefined' && poseidon.populateModelDropdown) {
        poseidon.populateModelDropdown();
      }
    } else {
      alert('Scan failed: ' + data.error);
    }
  } catch (error) {
    console.error('[ERROR] Scan error:', error);
    alert('Error scanning: ' + error.message);
  }
};

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

// ==================== GGUF MODEL LOADING ====================

ui.availableModels = [];
ui.loadedModels = [];

ui.scanForModels = async function() {
  const statusDiv = document.getElementById('scan-status');
  const listDiv = document.getElementById('available-models-list');
  
  statusDiv.textContent = '🔍 Scanning...';
  listDiv.innerHTML = '<p class="hint">Scanning for .gguf files...</p>';
  
  try {
    const response = await fetch('/api/models/scan');
    const data = await response.json();
    
    if (data.success && data.models) {
      this.availableModels = data.models;
      statusDiv.textContent = `[OK] Found ${data.models.length} models!`;
      
      if (data.models.length === 0) {
        listDiv.innerHTML = '<p class="hint">No .gguf files found. Try manual path below.</p>';
      } else {
        listDiv.innerHTML = data.models.map(model => `
          <div class="model-item" style="margin: 8px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 4px;">
            <div style="font-size: 11px; font-weight: bold; color: var(--success);">${model.file}</div>
            <div style="font-size: 9px; color: var(--text-secondary); margin: 4px 0;">${model.name}</div>
            <div style="font-size: 8px; color: #888; font-family: monospace; margin: 4px 0; overflow-wrap: break-word;">${model.full_path}</div>
            <button onclick="ui.loadModel('${model.full_path.replace(/'/g, "\\'")}')" 
                    class="btn-primary" style="margin-top: 8px; width: 100%; font-size: 10px;">
              [LAUNCH] Load Model
            </button>
          </div>
        `).join('');
      }
    } else {
      statusDiv.textContent = '[ERROR] Scan failed';
      listDiv.innerHTML = '<p class="hint">Scan failed. Try manual path below.</p>';
    }
  } catch (error) {
    console.error('Scan error:', error);
    statusDiv.textContent = '[ERROR] Error: ' + error.message;
    listDiv.innerHTML = '<p class="hint">Error scanning. Check console.</p>';
  }
};

ui.loadModel = async function(modelPath) {
  console.log('🔄 Loading model:', modelPath);
  
  const listDiv = document.getElementById('loaded-models-list');
  listDiv.innerHTML = '<p class="hint">⏳ Loading model, please wait...</p>';
  
  try {
    const response = await fetch('/api/models/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: modelPath })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('[OK] Model loaded:', data.model);
      alert(`[OK] Model loaded successfully!\n\n${data.model.name}\n\nReady for chat with Poseidon!`);
      await this.refreshLoadedModels();
    } else {
      alert('[ERROR] Failed to load model:\n\n' + data.error);
      listDiv.innerHTML = '<p class="hint">No models loaded yet</p>';
    }
  } catch (error) {
    console.error('Load error:', error);
    alert('[ERROR] Error loading model:\n\n' + error.message);
    listDiv.innerHTML = '<p class="hint">No models loaded yet</p>';
  }
};

ui.loadModelByPath = async function() {
  const path = document.getElementById('model-manual-path').value.trim();
  if (!path) {
    alert('Please enter a model path');
    return;
  }
  
  await this.loadModel(path);
};

ui.refreshLoadedModels = async function() {
  const listDiv = document.getElementById('loaded-models-list');
  
  try {
    const response = await fetch('/api/models/loaded');
    const data = await response.json();
    
    if (data.success && data.models && data.models.length > 0) {
      this.loadedModels = data.models;
      
      listDiv.innerHTML = data.models.map(model => `
        <div class="model-item" style="margin: 8px 0; padding: 12px; background: rgba(6, 255, 165, 0.1); border: 2px solid var(--success); border-radius: 4px;">
          <div style="font-size: 11px; font-weight: bold; color: var(--success);">[OK] ${model.name}</div>
          <div style="font-size: 8px; color: #888; margin-top: 4px;">Ready for chat!</div>
          <button onclick="ui.unloadModel('${model.name.replace(/'/g, "\\'")}')" 
                  class="btn-secondary" style="margin-top: 8px; width: 100%; font-size: 10px;">
            🗑️ Unload
          </button>
        </div>
      `).join('');
    } else {
      listDiv.innerHTML = '<p class="hint">No models loaded yet</p>';
    }
  } catch (error) {
    console.error('Refresh error:', error);
    listDiv.innerHTML = '<p class="hint">Error loading list</p>';
  }
};

ui.unloadModel = async function(modelName) {
  if (!confirm(`Unload model "${modelName}"?`)) return;
  
  try {
    const response = await fetch(`/api/models/${encodeURIComponent(modelName)}`, {
      method: 'DELETE'
    });
    
    const data = await response.json();
    
    if (data.success) {
      alert(`[OK] Model "${modelName}" unloaded`);
      await this.refreshLoadedModels();
    } else {
      alert('Failed to unload: ' + data.error);
    }
  } catch (error) {
    console.error('Unload error:', error);
    alert('Error: ' + error.message);
  }
};

console.log('[OK] GGUF Model loading system ready!');

// ==================== POSEIDON PROCESS CREATION ====================

ui.createProcess = function() {
  const name = document.getElementById('process-name').value.trim();
  const description = document.getElementById('process-description').value.trim();
  const trigger = document.getElementById('process-trigger').value;
  
  if (!name) {
    alert('Process name required!');
    return;
  }
  
  const process = {
    id: 'proc_' + Date.now(),
    name,
    description,
    trigger,
    created: new Date().toISOString(),
    status: 'active'
  };
  
  console.log('[OK] Process created:', process);
  alert(`[OK] Process "${name}" created!\n\nTrigger: ${trigger}`);
  
  // Add to logs
  this.addLog('process_created', `Created process: ${name}`, process);
  
  // Clear form
  document.getElementById('process-name').value = '';
  document.getElementById('process-description').value = '';
};

// ==================== POSEIDON LOGS ====================

ui.logs = [];

ui.addLog = function(action, message, details = {}) {
  const log = {
    time: new Date().toISOString(),
    action,
    message,
    details
  };
  
  this.logs.unshift(log); // Newest first
  this.refreshLogs();
};

ui.filterLogs = function(filter) {
  this.refreshLogs(filter);
};

ui.refreshLogs = function(filter = 'all') {
  const container = document.getElementById('poseidon-logs');
  if (!container) return;
  
  let filteredLogs = this.logs;
  
  if (filter !== 'all') {
    filteredLogs = this.logs.filter(log => log.action.includes(filter));
  }
  
  if (filteredLogs.length === 0) {
    container.innerHTML = '<p class="hint">No logs for this filter</p>';
    return;
  }
  
  container.innerHTML = filteredLogs.slice(0, 20).map(log => `
    <div class="log-entry">
      <div class="log-entry-time">${new Date(log.time).toLocaleString()}</div>
      <div class="log-entry-action">${log.action.toUpperCase()}</div>
      <div class="log-entry-details">${log.message}</div>
    </div>
  `).join('');
};
console.log('[OK] Poseidon process & logs system loaded');

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
