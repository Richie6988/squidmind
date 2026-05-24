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
      panel.classList.remove('hidden');
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
  form.elements['cron'].value = squid.schedule?.cron || '';
  form.elements['schedule_enabled'].checked = squid.schedule?.enabled || false;
  
  // Update range display
  const rangeValue = form.querySelector('.range-value');
  if (rangeValue) rangeValue.textContent = squid.temperature || 0.7;
  
  // Hide detail panel, show edit panel
  ui.hidePanel('detail');
  ui.showPanel('edit');
}

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
        schedule: {
          enabled: formData.get('schedule_enabled') === 'on',
          cron: formData.get('cron') || null
        }
      };
      
      try {
        const response = await api.updateAgent(agentId, updatedAgent);
        
        if (response.success) {
          ui.showNotification('Squid updated successfully!', 'success');
          ui.hidePanel('edit');
          
          // Reload agents
          await aquarium.loadAgents();
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
    const response = await fetch('/api/models/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath })
    });
    
    const data = await response.json();
    if (data.success) {
      ui.showNotification('Model loaded successfully!', 'success');
      await ui.loadModels();
    }
  } catch (error) {
    ui.showNotification('Failed to load model: ' + error.message, 'error');
  }
};

// Unload model
ui.unloadModel = async function(modelPath) {
  try {
    const response = await fetch('/api/models/unload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ modelPath })
    });
    
    const data = await response.json();
    if (data.success) {
      ui.showNotification('Model unloaded successfully!', 'success');
      await ui.loadModels();
    }
  } catch (error) {
    ui.showNotification('Failed to unload model: ' + error.message, 'error');
  }
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
