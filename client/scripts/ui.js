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
      // NEWEST AT TOP: Move panel to top of DOM
      const container = panel.parentElement;
      if (container) {
        panel.remove();
        container.insertBefore(panel, container.firstChild);
      }
      
      panel.classList.remove('hidden');
      
      // Z-index for overlapping
      const allPanels = document.querySelectorAll('.panel:not(.hidden)');
      allPanels.forEach(p => {
        p.style.zIndex = '100';
      });
      panel.style.zIndex = '200';
      
      console.log(`📌 Panel "${panelId}" at TOP of list`);
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
          
          // Reload squids
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

// Handle detail panel population when it opens
const originalShowPanelWithDetail = ui.showPanel;
ui.showPanel = function(panelName) {
  originalShowPanelWithDetail.call(this, panelName);
  
  if (panelName === 'detail' && this.currentSquid) {
    // Fill in the details
    this.showSquidDetails(this.currentSquid);
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
  const state = temple.getState();
  
  // Update panel title
  document.getElementById('temple-title').textContent = `🏛️ ${state.name}`;
  
  // Status
  document.getElementById('temple-status').innerHTML = `
    <div class="stat-item">
      <span class="stat-label">Status:</span>
      <span class="stat-value ${state.status}">${state.status}</span>
    </div>
    <div class="stat-item">
      <span class="stat-label">Agents:</span>
      <span class="stat-value">${state.agentCount}</span>
    </div>
  `;
  
  // Agents
  if (state.activeAgents.length > 0) {
    document.getElementById('temple-agents').innerHTML = state.activeAgents.map(agent => `
      <div class="agent-item">
        <span class="agent-emoji">🦑</span>
        <span class="agent-name">${agent.name}</span>
        <span class="agent-status">${agent.status}</span>
      </div>
    `).join('');
  } else {
    document.getElementById('temple-agents').innerHTML = '<p class="empty-message">No agents currently working in this temple</p>';
  }
  
  // Files
  if (state.files && state.files.length > 0) {
    document.getElementById('temple-files').innerHTML = state.files.map(file => `
      <div class="file-item">
        <span class="file-icon">📄</span>
        <span class="file-name">${file.name}</span>
        <span class="file-size">${file.size || 'N/A'}</span>
      </div>
    `).join('');
  } else {
    document.getElementById('temple-files').innerHTML = '<p class="empty-message">No files in this project yet</p>';
  }
  
  // Tasks
  if (state.tasks && state.tasks.length > 0) {
    document.getElementById('temple-tasks').innerHTML = state.tasks.map(task => `
      <div class="task-item">
        <span class="task-status">${task.status === 'complete' ? '✅' : '⏳'}</span>
        <span class="task-desc">${task.description}</span>
      </div>
    `).join('');
  } else {
    document.getElementById('temple-tasks').innerHTML = '<p class="empty-message">No active tasks</p>';
  }
  
  // Show panel
  ui.showPanel('temple');
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
