const dashboard = {
  updateInterval: null,

  async init() {
    console.log('[STATS] Initializing dashboard...');
    this.createDashboardHTML();
    await this.update();
    
    // Auto-update every 2 seconds
    this.updateInterval = setInterval(() => this.update(), 2000);
  },

  createDashboardHTML() {
    const container = document.querySelector('.panels-container');
    
    const dashboardPanel = document.createElement('div');
    dashboardPanel.id = 'dashboard-panel';
    dashboardPanel.className = 'panel';
    dashboardPanel.innerHTML = `
      <div class="panel-header">
        <h2>[STATS] System Monitor</h2>
        <button class="btn-close" onclick="dashboard.toggle()">−</button>
      </div>
      <div class="panel-content">
        <!-- System Stats -->
        <div class="dashboard-section">
          <h3>System</h3>
          <div class="stat-grid">
            <div class="stat-item">
              <span class="stat-label">CPU</span>
              <div class="stat-bar">
                <div id="cpu-bar" class="stat-fill"></div>
              </div>
              <span id="cpu-value" class="stat-value">0%</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Memory</span>
              <div class="stat-bar">
                <div id="mem-bar" class="stat-fill"></div>
              </div>
              <span id="mem-value" class="stat-value">0%</span>
            </div>
          </div>
        </div>

        <!-- Agent States -->
        <div class="dashboard-section">
          <h3>Agents</h3>
          <div class="state-grid">
            <div class="state-item">
              <span class="state-dot idle"></span>
              <span id="agents-idle">0</span> Idle
            </div>
            <div class="state-item">
              <span class="state-dot working"></span>
              <span id="agents-working">0</span> Working
            </div>
            <div class="state-item">
              <span class="state-dot thinking"></span>
              <span id="agents-thinking">0</span> Thinking
            </div>
            <div class="state-item">
              <span class="state-dot sleeping"></span>
              <span id="agents-sleeping">0</span> Sleeping
            </div>
            <div class="state-item">
              <span class="state-dot error"></span>
              <span id="agents-error">0</span> Error
            </div>
          </div>
        </div>

        <!-- Active Tasks -->
        <div class="dashboard-section">
          <h3>Active Tasks</h3>
          <div id="active-tasks" class="task-list"></div>
        </div>

        <!-- Groups -->
        <div class="dashboard-section">
          <h3>Groups</h3>
          <div class="stat-simple">
            <span id="groups-total">0</span> Total
            <span style="margin-left: 16px;">
              <span id="groups-active">0</span> Active
            </span>
          </div>
        </div>
      </div>
    `;
    
    container.insertBefore(dashboardPanel, container.firstChild);
    this.addDashboardStyles();
  },

  addDashboardStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .dashboard-section {
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--border);
      }
      
      .dashboard-section:last-child {
        border-bottom: none;
      }
      
      .dashboard-section h3 {
        font-size: 10px;
        color: var(--squid-worker-1);
        margin-bottom: 12px;
      }
      
      .stat-grid {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      
      .stat-item {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .stat-label {
        width: 60px;
        font-size: 9px;
        color: var(--text-secondary);
      }
      
      .stat-bar {
        flex: 1;
        height: 12px;
        background: var(--ocean-deep);
        border: 2px solid var(--border);
        position: relative;
        overflow: hidden;
      }
      
      .stat-fill {
        height: 100%;
        background: var(--squid-worker-1);
        transition: width 0.3s;
      }
      
      .stat-value {
        width: 40px;
        text-align: right;
        font-size: 9px;
        color: var(--squid-worker-1);
      }
      
      .state-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        font-size: 9px;
      }
      
      .state-item {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      
      .state-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        display: inline-block;
      }
      
      .state-dot.idle { background: var(--text-secondary); }
      .state-dot.working { background: var(--squid-worker-1); }
      .state-dot.thinking { background: var(--squid-worker-2); }
      .state-dot.sleeping { background: var(--bubble); }
      .state-dot.error { background: var(--error); }
      
      .task-list {
        max-height: 150px;
        overflow-y: auto;
        font-size: 8px;
        color: var(--text-secondary);
      }
      
      .task-item {
        padding: 6px;
        margin-bottom: 6px;
        background: var(--ocean-deep);
        border-left: 2px solid var(--squid-worker-2);
      }
      
      .stat-simple {
        font-size: 9px;
        color: var(--text-secondary);
      }
    `;
    document.head.appendChild(style);
  },

  async update() {
    try {
      const response = await fetch('/api/system/monitor');
      const data = await response.json();
      
      if (!data.success) return;
      
      // Update system stats
      const cpuUsage = parseFloat(data.system.cpu_usage);
      const memUsage = parseFloat(data.system.memory_usage);
      
      document.getElementById('cpu-bar').style.width = `${cpuUsage}%`;
      document.getElementById('cpu-value').textContent = `${cpuUsage.toFixed(1)}%`;
      
      document.getElementById('mem-bar').style.width = `${memUsage}%`;
      document.getElementById('mem-value').textContent = `${memUsage.toFixed(1)}%`;
      
      // Update agent states
      document.getElementById('agents-idle').textContent = data.agents.states.idle;
      document.getElementById('agents-working').textContent = data.agents.states.working;
      document.getElementById('agents-thinking').textContent = data.agents.states.thinking;
      document.getElementById('agents-sleeping').textContent = data.agents.states.sleeping;
      document.getElementById('agents-error').textContent = data.agents.states.error;
      
      // Update active tasks
      const taskList = document.getElementById('active-tasks');
      if (data.tasks.active.length === 0) {
        taskList.innerHTML = '<p style="text-align: center; padding: 20px;">No active tasks</p>';
      } else {
        taskList.innerHTML = data.tasks.active.map(agent => `
          <div class="task-item">
            <strong>${agent.agent_name}</strong><br>
            ${agent.tasks.length} task(s) in progress
          </div>
        `).join('');
      }
      
      // Update groups
      document.getElementById('groups-total').textContent = data.groups.total;
      document.getElementById('groups-active').textContent = data.groups.active;
      
    } catch (error) {
      console.error('Dashboard update failed:', error);
    }
  },

  toggle() {
    const panel = document.getElementById('dashboard-panel');
    panel.classList.toggle('hidden');
  },

  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
  }
};
