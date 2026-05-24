/**
 * Temple Interior Management
 * Handles project workspace, resources, agents, tasks
 */

const TempleInterior = {
  currentTemple: null,
  currentFile: null,
  
  /**
   * Open temple with proper structure
   */
  open(temple) {
    this.currentTemple = temple;
    console.log('🏛️ Opening temple:', temple.name);
    
    // Create or get interior container
    let interior = document.getElementById('temple-interior');
    if (!interior) {
      interior = document.createElement('div');
      interior.id = 'temple-interior';
      interior.className = 'temple-interior';
      document.body.appendChild(interior);
    }
    
    // Build interior HTML
    interior.innerHTML = this.buildInteriorHTML(temple);
    interior.classList.remove('hidden');
    
    // Populate dynamic content
    this.populateResources(temple);
    this.populateWorkingAgents(temple);
    this.populateKanban(temple);
    this.populateCronTasks(temple);
  },
  
  /**
   * Build temple interior HTML structure
   */
  buildInteriorHTML(temple) {
    const bg = this.getTempleBackground(temple.name);
    
    return `
      <div class="interior-header">
        <h1>🏛️ ${temple.name} TEMPLE</h1>
        <button onclick="TempleInterior.close()">✕ Exit</button>
      </div>
      <div class="interior-content">
        <!-- LEFT: Resources & Memory -->
        <div class="interior-left">
          <h2>📥 PROJECT RESOURCES (INPUT)</h2>
          <p class="section-desc">Files provided by humans</p>
          <div class="resource-list input-resources" id="input-resources"></div>
          
          <hr class="section-divider">
          
          <h2>📤 PROJECT CREATION (OUTPUT)</h2>
          <p class="section-desc">Files created by agents</p>
          <div class="resource-list output-resources" id="output-resources"></div>
          
          <hr class="section-divider">
          
          <h2>🧠 project_memory.json</h2>
          <p class="section-desc">Vision, tasks, progress - editable by all agents</p>
          <button class="btn-memory" onclick="TempleInterior.openProjectMemory()">
            📝 View/Edit Memory
          </button>
          <p class="hint">Main collaboration hub for all squids</p>
        </div>
        
        <!-- CENTER: Working Agents & IDE -->
        <div class="interior-center">
          <h2>🦑 WORKING AGENTS</h2>
          <p class="section-desc">Real squids assigned to this project</p>
          <div class="agents-workspace" id="working-agents"></div>
          <button class="btn-assign" onclick="TempleInterior.showSquidAssigner()">
            ➕ Assign Squids
          </button>
          
          <hr class="section-divider">
          
          <h2>💻 IDE WORKSPACE</h2>
          <div class="ide-container">
            <div class="ide-editor">
              <div class="editor-header">
                <span id="editor-filename">No file open</span>
                <button onclick="TempleInterior.saveFile()">💾 Save</button>
              </div>
              <textarea id="temple-editor" placeholder="Click a file to open..."></textarea>
            </div>
            <div class="ide-preview">
              <div class="preview-header">
                <span>Preview</span>
                <button onclick="TempleInterior.refreshPreview()">🔄</button>
              </div>
              <iframe id="temple-preview" sandbox="allow-scripts"></iframe>
            </div>
          </div>
        </div>
        
        <!-- RIGHT: KANBAN & Cron -->
        <div class="interior-right">
          <h2>📋 KANBAN BOARD</h2>
          <div class="kanban-board">
            <div class="kanban-column">
              <h3>📝 TODO</h3>
              <div class="kanban-cards" id="kanban-todo"></div>
            </div>
            <div class="kanban-column">
              <h3>⚡ IN PROGRESS</h3>
              <div class="kanban-cards" id="kanban-progress"></div>
            </div>
            <div class="kanban-column">
              <h3>✅ DONE</h3>
              <div class="kanban-cards" id="kanban-done"></div>
            </div>
          </div>
          
          <hr class="section-divider">
          
          <h2>🔄 RECURRENT TASKS</h2>
          <button class="btn-add-cron" onclick="TempleInterior.openCronBuilder()">
            ➕ Create Task
          </button>
          <div class="recurrent-tasks" id="cron-tasks"></div>
        </div>
      </div>
    `;
  },
  
  /**
   * Populate input/output resources
   */
  populateResources(temple) {
    const inputContainer = document.getElementById('input-resources');
    const outputContainer = document.getElementById('output-resources');
    
    // Input resources (human-provided)
    const inputFiles = temple.project?.files || [];
    if (inputFiles.length > 0) {
      inputContainer.innerHTML = inputFiles.map(file => `
        <div class="resource-item" onclick="TempleInterior.openFile('${file.name}', '${file.path}', 'input')">
          <span class="resource-icon">📄</span>
          <span class="resource-name">${file.name}</span>
          <span class="resource-size">${file.size || ''}</span>
        </div>
      `).join('');
    } else {
      inputContainer.innerHTML = '<p class="empty-state">No input files yet<br>Upload files to get started</p>';
    }
    
    // Output resources (agent-created)
    const outputFiles = temple.project?.outputs || [];
    if (outputFiles.length > 0) {
      outputContainer.innerHTML = outputFiles.map(file => `
        <div class="resource-item output-item" onclick="TempleInterior.openFile('${file.name}', '${file.path}', 'output')">
          <span class="resource-icon">✨</span>
          <span class="resource-name">${file.name}</span>
          <span class="resource-agent">by ${file.creator || 'Agent'}</span>
        </div>
      `).join('');
    } else {
      outputContainer.innerHTML = '<p class="empty-state">No outputs yet<br>Agents will create files here</p>';
    }
  },
  
  /**
   * Populate working agents (REAL squids from aquarium)
   */
  populateWorkingAgents(temple) {
    const container = document.getElementById('working-agents');
    
    // Get REAL squids from aquarium
    const allSquids = window.aquarium?.squids || [];
    const assignedSquids = allSquids.filter(squid => 
      squid.currentProject === temple.name
    );
    
    if (assignedSquids.length > 0) {
      container.innerHTML = assignedSquids.map(squid => `
        <div class="agent-avatar walking" data-squid-id="${squid.id}">
          <div class="avatar-squid" style="filter: hue-rotate(${squid.color}deg)">🦑</div>
          <div class="avatar-name">${squid.name}</div>
          <div class="avatar-specialty">${squid.specialty || squid.role}</div>
          <div class="avatar-status">${squid.status || 'idle'}</div>
          <button class="btn-config-squid" onclick="TempleInterior.configureSquid('${squid.id}')">
            ⚙️ Configure
          </button>
        </div>
      `).join('');
    } else {
      container.innerHTML = `
        <p class="empty-state">
          No agents assigned yet<br>
          Click "Assign Squids" to add workers
        </p>
      `;
    }
  },
  
  /**
   * Populate KANBAN board
   */
  populateKanban(temple) {
    const tasks = temple.project?.tasks || [];
    
    const todo = tasks.filter(t => t.status === 'pending');
    const progress = tasks.filter(t => t.status === 'working');
    const done = tasks.filter(t => t.status === 'complete');
    
    document.getElementById('kanban-todo').innerHTML = todo.length > 0 ?
      todo.map(task => `
        <div class="kanban-card" draggable="true" data-task-id="${task.id}">
          <span class="task-desc">${task.description}</span>
          <span class="task-assigned">${task.assignedTo || 'Unassigned'}</span>
        </div>
      `).join('') :
      '<p class="empty-column">No tasks</p>';
    
    document.getElementById('kanban-progress').innerHTML = progress.length > 0 ?
      progress.map(task => `
        <div class="kanban-card working" draggable="true" data-task-id="${task.id}">
          <span class="task-desc">${task.description}</span>
          <span class="task-assigned">${task.assignedTo || 'Unassigned'}</span>
        </div>
      `).join('') :
      '<p class="empty-column">No tasks</p>';
    
    document.getElementById('kanban-done').innerHTML = done.length > 0 ?
      done.map(task => `
        <div class="kanban-card complete" draggable="true" data-task-id="${task.id}">
          <span class="task-desc">${task.description}</span>
          <span class="task-assigned">${task.assignedTo || 'Unassigned'}</span>
        </div>
      `).join('') :
      '<p class="empty-column">No tasks</p>';
  },
  
  /**
   * Populate cron tasks
   */
  populateCronTasks(temple) {
    const container = document.getElementById('cron-tasks');
    const cronTasks = temple.project?.cronTasks || [];
    
    if (cronTasks.length > 0) {
      container.innerHTML = cronTasks.map(task => `
        <div class="cron-task">
          <span class="cron-schedule">${this.humanizeCron(task.schedule)}</span>
          <span class="cron-desc">${task.description}</span>
          <button class="btn-edit-cron" onclick="TempleInterior.editCron('${task.id}')">✏️</button>
        </div>
      `).join('');
    } else {
      container.innerHTML = '<p class="empty-state">No scheduled tasks</p>';
    }
  },
  
  /**
   * Open file in IDE
   */
  openFile(filename, filepath, type) {
    console.log('📂 Opening file:', filename, 'Type:', type);
    
    this.currentFile = { filename, filepath, type };
    document.getElementById('editor-filename').textContent = filename;
    
    // Load file content
    fetch(`/api/files/read?path=${encodeURIComponent(filepath)}`)
      .then(res => {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return res.json();
        } else {
          return res.text().then(text => ({ content: text }));
        }
      })
      .then(data => {
        const content = data.content || data;
        document.getElementById('temple-editor').value = content;
        
        // Auto-preview if HTML
        if (filename.endsWith('.html')) {
          this.refreshPreview();
        }
      })
      .catch(err => {
        console.error('Failed to load file:', err);
        document.getElementById('temple-editor').value = 
          `// Failed to load file: ${err.message}\n// File API might not be implemented yet`;
      });
  },
  
  /**
   * Open project_memory.json
   */
  openProjectMemory() {
    console.log('🧠 Opening project memory');
    
    const memoryPath = `/projects/${this.currentTemple.name}/project_memory.json`;
    this.openFile('project_memory.json', memoryPath, 'memory');
  },
  
  /**
   * Open visual cron builder (HUMAN INTUITIVE)
   */
  openCronBuilder() {
    console.log('🔄 Opening cron builder');
    
    const modal = document.createElement('div');
    modal.className = 'cron-builder-modal';
    modal.innerHTML = `
      <div class="cron-builder">
        <h2>Create Scheduled Task</h2>
        <p class="hint">Build your schedule visually - no cron syntax needed!</p>
        
        <div class="form-section">
          <label>Task Name:</label>
          <input type="text" id="cron-name" placeholder="e.g., Daily backup">
        </div>
        
        <div class="form-section">
          <label>Description:</label>
          <textarea id="cron-desc" placeholder="What should this task do?"></textarea>
        </div>
        
        <div class="form-section">
          <label>Frequency:</label>
          <select id="cron-frequency" onchange="TempleInterior.updateCronPreview()">
            <option value="hourly">Every Hour</option>
            <option value="daily">Every Day</option>
            <option value="weekly">Every Week</option>
            <option value="monthly">Every Month</option>
            <option value="custom">Custom...</option>
          </select>
        </div>
        
        <div class="form-section" id="cron-time-section">
          <label>Time:</label>
          <input type="time" id="cron-time" value="09:00" onchange="TempleInterior.updateCronPreview()">
        </div>
        
        <div class="form-section">
          <label>Preview:</label>
          <div id="cron-preview" class="cron-preview">Every day at 9:00 AM</div>
        </div>
        
        <div class="form-actions">
          <button onclick="TempleInterior.saveCronTask()">✅ Create Task</button>
          <button onclick="this.closest('.cron-builder-modal').remove()">❌ Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  },
  
  /**
   * Show squid assigner (assign real squids to project)
   */
  showSquidAssigner() {
    console.log('🦑 Opening squid assigner');
    
    const allSquids = window.aquarium?.squids || [];
    const availableSquids = allSquids.filter(s => !s.currentProject || s.currentProject === this.currentTemple.name);
    
    const modal = document.createElement('div');
    modal.className = 'squid-assigner-modal';
    modal.innerHTML = `
      <div class="squid-assigner">
        <h2>Assign Squids to ${this.currentTemple.name}</h2>
        <p class="hint">Select squids to work on this project</p>
        
        <div class="squid-grid">
          ${availableSquids.map(squid => `
            <div class="squid-card">
              <div class="squid-icon" style="filter: hue-rotate(${squid.color}deg)">🦑</div>
              <div class="squid-info">
                <div class="squid-name">${squid.name}</div>
                <div class="squid-specialty">${squid.specialty || squid.role}</div>
              </div>
              <button onclick="TempleInterior.assignSquid('${squid.id}')">
                ${squid.currentProject === this.currentTemple.name ? '✅ Assigned' : '➕ Assign'}
              </button>
            </div>
          `).join('')}
        </div>
        
        <button class="btn-close" onclick="this.closest('.squid-assigner-modal').remove()">
          Done
        </button>
      </div>
    `;
    
    document.body.appendChild(modal);
  },
  
  /**
   * Configure squid (FORM-BASED PROMPT BUILDER)
   */
  configureSquid(squidId) {
    console.log('⚙️ Configuring squid:', squidId);
    
    const squid = window.aquarium?.squids.find(s => s.id === squidId);
    if (!squid) return;
    
    const modal = document.createElement('div');
    modal.className = 'squid-config-modal';
    modal.innerHTML = `
      <div class="squid-config">
        <h2>Configure ${squid.name}</h2>
        <p class="hint">Assemble your agent's behavior like building blocks</p>
        
        <div class="config-section">
          <h3>🎯 Role & Specialty</h3>
          <select id="config-role">
            <option>Developer</option>
            <option>Designer</option>
            <option>Writer</option>
            <option>Analyst</option>
            <option>QA Tester</option>
          </select>
        </div>
        
        <div class="config-section">
          <h3>🧠 Working Style</h3>
          <label>
            <input type="checkbox" checked> Thorough & Detail-Oriented
          </label>
          <label>
            <input type="checkbox"> Fast & Iterative
          </label>
          <label>
            <input type="checkbox"> Creative & Experimental
          </label>
        </div>
        
        <div class="config-section">
          <h3>📋 Task Focus</h3>
          <label>
            <input type="radio" name="focus" checked> Coding & Implementation
          </label>
          <label>
            <input type="radio" name="focus"> Documentation & Planning
          </label>
          <label>
            <input type="radio" name="focus"> Testing & Quality
          </label>
        </div>
        
        <div class="config-section">
          <h3>💬 Communication</h3>
          <select>
            <option>Verbose (explain everything)</option>
            <option selected>Balanced (explain key decisions)</option>
            <option>Concise (just the results)</option>
          </select>
        </div>
        
        <div class="config-preview">
          <h4>Agent Prompt Preview:</h4>
          <div class="prompt-preview">
            You are a <strong>Developer</strong> agent working on the ${this.currentTemple.name} project.
            Your working style is <strong>thorough and detail-oriented</strong>.
            Focus on <strong>coding & implementation</strong> tasks.
            Communicate in a <strong>balanced</strong> manner.
          </div>
        </div>
        
        <div class="form-actions">
          <button onclick="TempleInterior.saveSquidConfig('${squidId}')">💾 Save Config</button>
          <button onclick="this.closest('.squid-config-modal').remove()">Cancel</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
  },
  
  /**
   * Helper: Get temple background
   */
  getTempleBackground(name) {
    const backgrounds = {
      'BRAIN': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'AQUARIUM': 'linear-gradient(135deg, #13547a 0%, #80d0c7 100%)',
      'TRADING': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'NEWSROOM': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
    };
    return backgrounds[name] || backgrounds['BRAIN'];
  },
  
  /**
   * Helper: Humanize cron expression
   */
  humanizeCron(cron) {
    const patterns = {
      '0 9 * * *': 'Every day at 9am',
      '*/30 * * * *': 'Every 30 minutes',
      '0 0 * * 0': 'Every Sunday at midnight',
      '0 0 1 * *': 'First day of every month'
    };
    return patterns[cron] || cron;
  },
  
  /**
   * Update cron preview
   */
  updateCronPreview() {
    const freq = document.getElementById('cron-frequency')?.value;
    const time = document.getElementById('cron-time')?.value || '09:00';
    const preview = document.getElementById('cron-preview');
    
    if (!preview) return;
    
    const texts = {
      'hourly': 'Every hour',
      'daily': `Every day at ${time}`,
      'weekly': `Every week on Monday at ${time}`,
      'monthly': `First day of every month at ${time}`
    };
    
    preview.textContent = texts[freq] || 'Custom schedule';
  },
  
  /**
   * Save file
   */
  saveFile() {
    if (!this.currentFile) {
      alert('No file open');
      return;
    }
    
    const content = document.getElementById('temple-editor').value;
    console.log('💾 Saving file:', this.currentFile.filename);
    
    // TODO: Implement save endpoint
    alert('Save functionality coming soon!\nFile: ' + this.currentFile.filename);
  },
  
  /**
   * Refresh preview
   */
  refreshPreview() {
    const content = document.getElementById('temple-editor').value;
    const preview = document.getElementById('temple-preview');
    
    if (preview) {
      const blob = new Blob([content], { type: 'text/html' });
      preview.src = URL.createObjectURL(blob);
    }
  },
  
  /**
   * Close temple
   */
  close() {
    const interior = document.getElementById('temple-interior');
    if (interior) {
      interior.classList.add('hidden');
    }
  },
  
  /**
   * Assign squid to project
   */
  assignSquid(squidId) {
    console.log('➕ Assigning squid:', squidId, 'to', this.currentTemple.name);
    
    // TODO: Update squid's currentProject
    const squid = window.aquarium?.squids.find(s => s.id === squidId);
    if (squid) {
      squid.currentProject = this.currentTemple.name;
      this.populateWorkingAgents(this.currentTemple);
      alert(`${squid.name} assigned to ${this.currentTemple.name}!`);
    }
  },
  
  /**
   * Save squid configuration
   */
  saveSquidConfig(squidId) {
    console.log('💾 Saving squid config:', squidId);
    alert('Configuration saved!');
    document.querySelector('.squid-config-modal')?.remove();
  },
  
  /**
   * Save cron task
   */
  saveCronTask() {
    const name = document.getElementById('cron-name')?.value;
    const desc = document.getElementById('cron-desc')?.value;
    
    if (!name || !desc) {
      alert('Please fill in all fields');
      return;
    }
    
    console.log('💾 Creating cron task:', name);
    alert('Task created!');
    document.querySelector('.cron-builder-modal')?.remove();
  }
};

// Make available globally
window.TempleInterior = TempleInterior;
console.log('🏛️ TempleInterior module loaded');
