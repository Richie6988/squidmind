const ui = {
  currentSquid: null,

  async init() {
    console.log('🎮 Initializing UI...');
    
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
        console.log('✅ Squid created:', response.agent);
        
        // Add to aquarium
        aquarium.addSquid(response.agent);
        
        // Reset form and hide panel
        form.reset();
        this.hidePanel('creator');
        
        // Show success message
        this.showNotification(`🦑 ${response.agent.name} hatched!`, 'success');
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
        document.getElementById('detail-title').textContent = `🦑 ${agent.name}`;
        
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
      // Get health
      const health = await api.getHealth();
      const apiStatus = document.getElementById('api-status');
      apiStatus.style.color = health.api_connected ? '#06FFA5' : '#E63946';
      
      // Get task count
      const tasks = await api.getTaskStatus();
      document.getElementById('task-count').textContent = `${tasks.total_jobs} Tasks`;
      
    } catch (error) {
      console.error('Failed to update stats:', error);
    }
  },

  showNotification(message, type = 'info') {
    // Simple console notification for now
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    console.log(`${icon} ${message}`);
    
    // TODO: Implement toast notification UI
  }
};

// CRITICAL: Export to window IMMEDIATELY so onclick handlers work
window.ui = ui;
console.log('✅ UI exported to window');

// Global functions called from HTML
async function executeSquid() {
  if (!ui.currentSquid) return;
  
  try {
    ui.showNotification('Executing squid...', 'info');
    
    // Update squid status
    aquarium.updateSquidStatus(ui.currentSquid.id, 'working');
    
    const response = await api.executeAgent(ui.currentSquid.id);
    
    if (response.success) {
      ui.showNotification('Execution completed!', 'success');
      console.log('Output:', response.output);
    } else {
      ui.showNotification(`Error: ${response.error}`, 'error');
    }
    
    // Reset status
    setTimeout(() => {
      aquarium.updateSquidStatus(ui.currentSquid.id, 'idle');
    }, 2000);
    
  } catch (error) {
    console.error('Execution failed:', error);
    ui.showNotification(`Error: ${error.message}`, 'error');
    aquarium.updateSquidStatus(ui.currentSquid.id, 'idle');
  }
}

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

// Set schedule with intuitive presets
ui.setSchedule = function(preset) {
  let cron = '';
  let description = '';
  
  switch (preset) {
    case 'hourly':
      cron = '0 * * * *';
      description = 'Every hour on the hour';
      break;
    case 'daily':
      cron = '0 9 * * *';
      description = 'Every day at 9:00 AM';
      break;
    case 'weekly':
      cron = '0 9 * * 1';
      description = 'Every Monday at 9:00 AM';
      break;
    case 'custom':
      const time = prompt('Enter time (HH:MM in 24h format):', '09:00');
      if (!time) return;
      const [hour, minute] = time.split(':');
      cron = `${minute} ${hour} * * *`;
      description = `Every day at ${time}`;
      break;
  }
  
  document.getElementById('cron-value').value = cron;
  document.querySelector('[name="schedule_enabled"]').checked = true;
  ui.updateSchedulePreview(cron);
};

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
            console.log('✅ Squid updated in memory:', squid.name);
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

// Load teams
ui.loadTeams = async function() {
  try {
    const response = await fetch('/api/teams');
    const teams = await response.json();
    
    const teamsList = document.getElementById('teams-list');
    if (!teamsList) return;
    
    if (!teams || teams.length === 0) {
      teamsList.innerHTML = '<p class="empty-message">No teams yet. Create your first team!</p>';
      return;
    }
    
    teamsList.innerHTML = teams.map(team => `
      <div class="list-item" onclick="ui.showTeamDetails('${team.id}')">
        <div class="list-item-header">
          <strong>${team.name}</strong>
          <span class="badge badge-${team.status}">${team.status}</span>
        </div>
        <div class="list-item-meta">
          ${team.members} members ${team.workflow ? `• ${team.workflow}` : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load teams:', error);
  }
};

// Show create team modal (simple version for now)
ui.showCreateTeam = async function() {
  const teamName = prompt('Enter team name:');
  if (!teamName) return;
  
  const agents = await api.getAgents();
  if (!agents.agents || agents.agents.length === 0) {
    alert('Create some squids first!');
    return;
  }
  
  // Simple team creation
  try {
    const response = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: teamName,
        leader_id: agents.agents[0].id,
        members: agents.agents.slice(0, 3).map(a => a.id),
        auto_assign_roles: true
      })
    });
    
    if (response.ok) {
      ui.showNotification('Team created!', 'success');
      await ui.loadTeams();
    }
  } catch (error) {
    ui.showNotification('Failed to create team', 'error');
  }
};

// Load models
ui.loadModels = async function() {
  try {
    const response = await fetch('/api/models');
    const data = await response.json();
    const models = data.models || [];
    
    const modelsList = document.getElementById('models-list');
    if (!modelsList) return;
    
    if (models.length === 0) {
      modelsList.innerHTML = '<p class="empty-message">No models found. Download GGUF models to data/models/</p>';
      return;
    }
    
    modelsList.innerHTML = models.map(model => `
      <div class="list-item">
        <div class="list-item-header">
          <strong>${model.name || model.file}</strong>
          ${model.loaded ? '<span class="badge badge-success">Loaded</span>' : '<span class="badge badge-idle">Not Loaded</span>'}
        </div>
        <div class="list-item-meta">
          ${model.size_mb ? `${model.size_mb} MB` : ''} • ${model.source}
        </div>
        <div class="list-item-actions">
          ${!model.loaded ? `<button class="btn-small" onclick="ui.loadModel('${model.file}')">Load</button>` : ''}
          ${model.loaded ? `<button class="btn-small" onclick="ui.unloadModel('${model.file}')">Unload</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    console.error('Failed to load models:', error);
  }
};

// Load scheduler status
ui.loadSchedulerStatus = async function() {
  try {
    const response = await fetch('/api/scheduler/status');
    const data = await response.json();
    
    const statusDiv = document.getElementById('scheduler-status');
    if (!statusDiv) return;
    
    const queues = data.queues || {};
    const resources = data.resources || {};
    const stats = data.stats || {};
    
    statusDiv.innerHTML = `
      <div class="status-section">
        <h3>Queue Status</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">VIP</div>
            <div class="stat-value">${queues.vip || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">High</div>
            <div class="stat-value">${queues.high || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Normal</div>
            <div class="stat-value">${queues.normal || 0}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">Low</div>
            <div class="stat-value">${queues.low || 0}</div>
          </div>
        </div>
      </div>
      
      <div class="status-section">
        <h3>Resources</h3>
        <div class="resource-bar">
          <div class="resource-label">GPU VRAM</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${resources.gpu ? (resources.gpu.in_use ? 100 : 0) : 0}%"></div>
          </div>
          <div class="resource-info">${resources.gpu ? `${resources.gpu.available_vram.toFixed(1)}GB / ${resources.gpu.total_vram.toFixed(1)}GB` : 'N/A'}</div>
        </div>
        
        <div class="resource-bar">
          <div class="resource-label">CPU</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${resources.cpu ? resources.cpu.utilization : 0}%"></div>
          </div>
          <div class="resource-info">${resources.cpu ? `${resources.cpu.utilization}% utilization` : 'N/A'}</div>
        </div>
      </div>
      
      <div class="status-section">
        <h3>Statistics</h3>
        <div class="stats-list">
          <div class="stat-row">
            <span>Total Scheduled:</span>
            <strong>${stats.total_scheduled || 0}</strong>
          </div>
          <div class="stat-row">
            <span>Completed:</span>
            <strong>${stats.total_completed || 0}</strong>
          </div>
          <div class="stat-row">
            <span>Failed:</span>
            <strong>${stats.total_failed || 0}</strong>
          </div>
          <div class="stat-row">
            <span>Avg Wait Time:</span>
            <strong>${stats.avg_wait_time_ms ? (stats.avg_wait_time_ms / 1000).toFixed(1) + 's' : 'N/A'}</strong>
          </div>
        </div>
      </div>
    `;
  } catch (error) {
    console.error('Failed to load scheduler status:', error);
  }
};

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

// Poseidon Chat Functions
ui.sendToPoseidon = async function() {
  const input = document.getElementById('poseidon-chat-input');
  const message = input.value.trim();
  
  if (!message) return;
  
  // Clear input
  input.value = '';
  
  // Add user message to chat
  this.addPoseidonMessage(message, 'user');
  
  // Get context
  const agents = await api.getAgents();
  const context = {
    agents: agents.agents || [],
    systemStatus: {}
  };
  
  // Get Poseidon response
  const response = await poseidon.respond(message, context);
  
  // Add Poseidon response
  this.addPoseidonMessage(response.message, 'poseidon');
  
  // Update suggestions
  this.updatePoseidonSuggestions(response.suggestions);
};

ui.addPoseidonMessage = function(message, sender) {
  const messagesDiv = document.getElementById('poseidon-chat-messages');
  
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${sender}`;
  
  const header = document.createElement('div');
  header.className = 'chat-message-header';
  header.textContent = sender === 'poseidon' ? '🔱 Poseidon' : '👤 You';
  
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

ui.interactWithSquid = function(action) {
  if (!this.selectedSquid) return;
  
  const squid = this.selectedSquid;
  
  switch (action) {
    case 'feed':
      squid.feed();
      this.showNotification('🍕 Fed the squid!', 'success');
      break;
    case 'play':
      squid.play();
      this.showNotification('🎮 Playing with squid!', 'success');
      break;
    case 'sleep':
      squid.sleep();
      this.showNotification('💤 Squid is resting!', 'success');
      break;
    case 'celebrate':
      squid.celebrate();
      this.showNotification('🎉 Celebration time!', 'success');
      break;
    case 'details':
      this.showSquidDetails(squid);
      break;
  }
  
  // Hide menu
  document.getElementById('squid-menu').classList.add('hidden');
};

ui.showSquidContextMenu = function(squid, x, y) {
  this.selectedSquid = squid;
  
  const menu = document.getElementById('squid-menu');
  menu.classList.remove('hidden');
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
};

ui.showSquidDetails = function(squid) {
  console.log('📋 Showing squid details:', squid.name);
  this.currentSquid = squid;
  
  // Populate detail panel
  document.getElementById('squid-name-display').textContent = squid.name;
  document.getElementById('squid-specialty-display').textContent = squid.specialty || 'General Agent';
  document.getElementById('squid-status-display').textContent = squid.status || 'idle';
  document.getElementById('squid-thought-display').textContent = squid.current_thought || 'Resting...';
  
  // Stats
  const stats = squid.stats || {};
  document.getElementById('squid-level').textContent = stats.level || 1;
  document.getElementById('squid-xp').textContent = `${stats.xp || 0} / ${stats.xpToNext || 100}`;
  document.getElementById('squid-tasks').textContent = stats.tasksCompleted || 0;
  
  // Energy bar
  const energy = squid.energy || 100;
  const energyBar = document.querySelector('#detail-panel .stat-bar-fill');
  if (energyBar) {
    energyBar.style.width = `${energy}%`;
  }
  
  // Brain info
  const brainInfo = document.getElementById('squid-brain-info');
  if (brainInfo && squid.brain) {
    brainInfo.innerHTML = `
      <div class="brain-detail">
        <strong>Model:</strong> ${squid.brain.model || 'claude-sonnet-4'}
      </div>
      <div class="brain-detail">
        <strong>Prompt:</strong> ${squid.brain.system_prompt || 'N/A'}
      </div>
      <div class="brain-detail">
        <strong>Tools:</strong> ${squid.brain.available_tools ? squid.brain.available_tools.length : 0}
      </div>
    `;
  }
  
  this.showPanel('detail');
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
      const greeting = "🌊 Greetings, mortal! I am Poseidon, God of the Ocean. I command the squids of this realm. How may I assist you?";
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

console.log('✅ Poseidon & Interaction UI loaded');

// Initialize Poseidon AI on startup
async function initializePoseidonAI() {
  try {
    console.log('🔱 Initializing Poseidon AI...');
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

console.log('🔱 Poseidon AI module loaded');

// Tool Selection for Squids
ui.loadAvailableTools = async function() {
  try {
    const response = await fetch('/api/tools');
    const data = await response.json();
    
    // Handle different response formats
    const tools = Array.isArray(data) ? data : (data.tools || []);
    
    if (!Array.isArray(tools)) {
      console.error('Tools is not an array:', tools);
      return;
    }
    
    // Populate tools checklist in both forms
    const checklistCreate = document.querySelector('#creator-panel #tools-checklist');
    const checklistEdit = document.querySelector('#edit-panel #tools-checklist');
    
    const toolsHTML = tools.map(tool => `
      <label class="tool-item">
        <input type="checkbox" name="tool_${tool.name}" value="${tool.name}" checked>
        <span class="tool-name">${tool.name}</span>
        <span class="tool-desc">${tool.description || ''}</span>
      </label>
    `).join('');
    
    if (checklistCreate) checklistCreate.innerHTML = toolsHTML;
    if (checklistEdit) checklistEdit.innerHTML = toolsHTML;
    
  } catch (error) {
    console.error('Failed to load tools:', error);
  }
};

ui.toggleAllTools = function(enabled) {
  const checkboxes = document.querySelectorAll('#tools-checklist input[type="checkbox"]');
  checkboxes.forEach(cb => cb.checked = enabled);
};

ui.getSelectedTools = function(formElement) {
  const checkboxes = formElement.querySelectorAll('#tools-checklist input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
};

// Initialize tools when panels open
const originalShowPanelForTools = ui.showPanel;
ui.showPanel = function(panelName) {
  originalShowPanelForTools.call(this, panelName);
  
  if (panelName === 'creator' || panelName === 'edit') {
    ui.loadAvailableTools();
  }
};

console.log('🛠️ Tool selection system loaded');

// Temple Data Room
ui.enterTemple = function(temple) {
  // REMOVED - TempleInterior.open() handles temple display now
  console.log('enterTemple deprecated - using TempleInterior.open() instead');
};

console.log('🏛️ Temple UI functions loaded');

// Clear All Panels
ui.clearAllPanels = function() {
  console.log('🧹 Clearing all panels');
  
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
  
  console.log(`✅ Closed ${panels.length} panels`);
};

// Update System Monitor Stats
ui.updateSystemMonitor = async function() {
  if (!aquarium || !aquarium.squids) return;
  
  const squids = aquarium.squids;
  
  // Squad stats
  document.getElementById('monitor-total-squids').textContent = squids.length;
  document.getElementById('monitor-active-squids').textContent = 
    squids.filter(s => s.status !== 'sleeping').length;
  document.getElementById('monitor-idle-squids').textContent = 
    squids.filter(s => s.status === 'idle').length;
  document.getElementById('monitor-working-squids').textContent = 
    squids.filter(s => s.status === 'working').length;
  
  // Fetch system stats (CPU/Memory)
  try {
    const response = await fetch('/api/system/monitor');
    const data = await response.json();
    
    if (data.success && data.system) {
      const cpuUsage = parseFloat(data.system.cpu_usage || 0);
      const memUsage = parseFloat(data.system.memory_usage || 0);
      
      const cpuBar = document.getElementById('monitor-cpu-bar');
      const cpuValue = document.getElementById('monitor-cpu-value');
      const memBar = document.getElementById('monitor-mem-bar');
      const memValue = document.getElementById('monitor-mem-value');
      
      if (cpuBar) cpuBar.style.width = `${cpuUsage}%`;
      if (cpuValue) cpuValue.textContent = `${cpuUsage.toFixed(1)}%`;
      if (memBar) memBar.style.width = `${memUsage}%`;
      if (memValue) memValue.textContent = `${memUsage.toFixed(1)}%`;
    }
  } catch (error) {
    console.log('System monitor API not available:', error.message);
  }
  
  // Poseidon status
  if (typeof poseidon !== 'undefined') {
    const info = poseidon.getModelInfo();
    document.getElementById('monitor-poseidon-model').textContent = 
      info.loaded ? 'Yes' : 'No';
    document.getElementById('monitor-poseidon-mode').textContent = info.mode;
  }
  
  // Count agents in projects
  if (aquarium.templeManager) {
    let totalAgentsInProjects = 0;
    aquarium.templeManager.temples.forEach(temple => {
      totalAgentsInProjects += temple.agentCount;
    });
    document.getElementById('monitor-project-agents').textContent = totalAgentsInProjects;
  }
};

// Auto-update monitor every 2 seconds
setInterval(() => {
  const monitorPanel = document.getElementById('monitor-panel');
  if (monitorPanel && !monitorPanel.classList.contains('hidden')) {
    ui.updateSystemMonitor();
  }
}, 2000);

console.log('🧹 Clear All & Monitor system loaded');

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
    console.error('❌ Add model error:', error);
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
    console.error('❌ Scan error:', error);
    alert('Error scanning: ' + error.message);
  }
};

console.log('📦 Model management functions loaded');

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
      alert(`✅ Project "${name}" created successfully!`);
      this.closeNewProjectModal();
      
      // Refresh temples
      if (typeof aquarium !== 'undefined' && aquarium.loadTemples) {
        await aquarium.loadTemples();
      }
      
      // Clear form
      document.getElementById('new-project-name').value = '';
      document.getElementById('new-project-vision').value = '';
    } else {
      alert('Failed to create project: ' + data.error);
    }
  } catch (error) {
    console.error('❌ Create project error:', error);
    alert('Error creating project: ' + error.message);
  }
};

// ==================== SQUID DETAIL MODAL ====================

ui.currentSquidForEdit = null;

ui.openSquidDetailModal = function(squid) {
  this.currentSquidForEdit = squid;
  
  const modal = document.getElementById('squid-detail-modal');
  if (!modal) return;
  
  // Populate fields
  document.getElementById('squid-detail-title').textContent = `Edit ${squid.name}`;
  document.getElementById('squid-name').value = squid.name || '';
  document.getElementById('squid-specialty').value = squid.specialty || '';
  document.getElementById('squid-mission').value = squid.mission || '';
  document.getElementById('squid-model').value = squid.brain?.model || '';
  document.getElementById('squid-temperature').value = squid.brain?.temperature || 0.7;
  document.getElementById('squid-body-color').value = squid.appearance?.body_color || '#FF6B9D';
  
  modal.classList.remove('hidden');
};

ui.closeSquidDetailModal = function() {
  const modal = document.getElementById('squid-detail-modal');
  if (modal) {
    modal.classList.add('hidden');
  }
  this.currentSquidForEdit = null;
};

ui.saveSquidDetails = async function() {
  if (!this.currentSquidForEdit) return;
  
  const squid = this.currentSquidForEdit;
  
  // Get values from form
  const name = document.getElementById('squid-name').value.trim();
  const specialty = document.getElementById('squid-specialty').value.trim();
  const mission = document.getElementById('squid-mission').value.trim();
  const model = document.getElementById('squid-model').value.trim();
  const temperature = parseFloat(document.getElementById('squid-temperature').value);
  const bodyColor = document.getElementById('squid-body-color').value;
  
  // Update squid object IMMEDIATELY (visual update)
  squid.name = name;
  squid.specialty = specialty;
  squid.mission = mission;
  if (!squid.brain) squid.brain = {};
  squid.brain.model = model;
  squid.brain.temperature = temperature;
  if (!squid.appearance) squid.appearance = {};
  squid.appearance.body_color = bodyColor;
  
  console.log('✅ Squid updated visually:', name);
  
  // Save to backend
  try {
    const response = await fetch(`/api/agents/${squid.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        specialty,
        mission,
        brain: {
          model,
          temperature,
          system_prompt: squid.brain.system_prompt || ''
        },
        appearance: {
          body_color: bodyColor,
          accent_color: squid.appearance.accent_color || '#FFE66D',
          eye_style: squid.appearance.eye_style || 'round',
          tentacle_style: squid.appearance.tentacle_style || 'wavy',
          size: squid.appearance.size || 'medium',
          glow_intensity: squid.appearance.glow_intensity || 0.5
        }
      })
    });
    
    const data = await response.json();
    
    if (data.success) {
      console.log('✅ Squid saved to backend:', name);
      this.closeSquidDetailModal();
    } else {
      alert('Failed to save: ' + data.error);
    }
  } catch (error) {
    console.error('❌ Save squid error:', error);
    alert('Error saving squid (changes applied locally): ' + error.message);
  }
};

console.log('✅ UI module with modals loaded');

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
      statusDiv.textContent = `✅ Found ${data.models.length} models!`;
      
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
              🚀 Load Model
            </button>
          </div>
        `).join('');
      }
    } else {
      statusDiv.textContent = '❌ Scan failed';
      listDiv.innerHTML = '<p class="hint">Scan failed. Try manual path below.</p>';
    }
  } catch (error) {
    console.error('Scan error:', error);
    statusDiv.textContent = '❌ Error: ' + error.message;
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
      console.log('✅ Model loaded:', data.model);
      alert(`✅ Model loaded successfully!\n\n${data.model.name}\n\nReady for chat with Poseidon!`);
      await this.refreshLoadedModels();
    } else {
      alert('❌ Failed to load model:\n\n' + data.error);
      listDiv.innerHTML = '<p class="hint">No models loaded yet</p>';
    }
  } catch (error) {
    console.error('Load error:', error);
    alert('❌ Error loading model:\n\n' + error.message);
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
          <div style="font-size: 11px; font-weight: bold; color: var(--success);">✅ ${model.name}</div>
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
      alert(`✅ Model "${modelName}" unloaded`);
      await this.refreshLoadedModels();
    } else {
      alert('Failed to unload: ' + data.error);
    }
  } catch (error) {
    console.error('Unload error:', error);
    alert('Error: ' + error.message);
  }
};

console.log('✅ GGUF Model loading system ready!');

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
  
  console.log('✅ Process created:', process);
  alert(`✅ Process "${name}" created!\n\nTrigger: ${trigger}`);
  
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

ui.switchPoseidonModel = function(modelName) {
  if (!modelName) return;
  console.log('Switching to model:', modelName);
  this.addLog('model_switch', `Switched to model: ${modelName}`);
};

console.log('✅ Poseidon process & logs system loaded');
