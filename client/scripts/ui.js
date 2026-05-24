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

function editSquid() {
  // TODO: Implement edit functionality
  console.log('Edit squid:', ui.currentSquid);
}

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
