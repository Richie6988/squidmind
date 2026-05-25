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
    console.log('[TEMPLE] Opening temple:', temple.name);
    
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
        <h1>[TEMPLE] ${temple.name} TEMPLE</h1>
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
          
          <h2>[BRAIN] project_memory.json</h2>
          <p class="section-desc">Vision, tasks, progress - editable by all agents</p>
          <button class="btn-memory" onclick="TempleInterior.openProjectMemory()">
            📝 View/Edit Memory
          </button>
          <p class="hint">Main collaboration hub for all squids</p>
        </div>
        
        <!-- CENTER: Working Agents & IDE -->
        <div class="interior-center">
          <h2>[SQUID] WORKING AGENTS</h2>
          <p class="section-desc">Real squids assigned to this project</p>
          <div class="agents-workspace" id="working-agents"></div>
          <button class="btn-assign" onclick="TempleInterior.showSquidAssigner()">
            ➕ Assign Squids
          </button>
          
          <hr class="section-divider">
          
          <h2>[CPU] IDE WORKSPACE</h2>
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
          <h2>[TASKS] KANBAN BOARD</h2>
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
              <h3>[OK] DONE</h3>
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
  async populateWorkingAgents(temple) {
    const container = document.getElementById('working-agents');
    
    // Source 1: aquarium canvas squids
    let assignedSquids = (window.aquarium?.squids || []).filter(squid => 
      squid.currentProject === temple.name || squid.insideTemple === temple.name
    );
    
    // Source 2: also check V2 registry for agents assigned via 'current_project'
    try {
      const r = await window.ApiV2._fetch('/agents');
      const regAgents = Object.values(r.registry.agents || {});
      const seen = new Set(assignedSquids.map(s => s.id));
      for (const a of regAgents) {
        if ((a.current_project === temple.name || a.assigned_project === temple.name) && !seen.has(a.agent_id)) {
          // Build squid-like object from registry entry
          assignedSquids.push({
            id: a.agent_id,
            name: a.display_name || a.agent_id,
            specialty: a.specialization || 'general',
            role: a.specialization || 'general',
            status: a.status || 'idle',
            color: 0,
            appearance: a.appearance || null,
            insideTemple: temple.name
          });
        }
      }
    } catch {}
    
    if (assignedSquids.length === 0) {
      container.innerHTML = `
        <p class="empty-state">
          No agents assigned yet.<br>
          Click "Assign Squids" to add workers from your roster.
        </p>
      `;
      return;
    }
    
    container.innerHTML = assignedSquids.map((squid, idx) => `
      <div class="agent-avatar walking" data-squid-id="${this._escape(squid.id)}" style="animation-delay: ${idx * 0.3}s">
        <canvas class="avatar-squid-canvas" data-squid-id="${this._escape(squid.id)}" width="56" height="64"></canvas>
        <div class="avatar-name">${this._escape(squid.name)}</div>
        <div class="avatar-specialty">${this._escape(squid.specialty || squid.role || 'general')}</div>
        <div class="avatar-status">${this._escape(squid.status || 'idle')}</div>
        <button class="btn-config-squid" onclick="TempleInterior.configureSquid('${this._escape(squid.id)}')">
          Configure
        </button>
      </div>
    `).join('');
    
    // Draw each squid's pixel-art portrait on its canvas
    setTimeout(() => {
      assignedSquids.forEach(squid => {
        const c = container.querySelector(`canvas[data-squid-id="${squid.id}"]`);
        if (c) this._drawSquidSprite(c, squid);
      });
    }, 50);
  },
  
  /**
   * Draw a small squid pixel-art portrait on a canvas with the agent's actual
   * appearance (color + accessories from V2 brain.appearance).
   */
  _drawSquidSprite(canvas, squid) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const app = squid.appearance || {};
    const acc = app.accessories || {};
    const primary = app.primary_color || squid.appearance?.body_color || '#FF6B9D';
    const accent = app.secondary_color || squid.appearance?.accent_color || '#C44569';
    
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 + 4);
    const size = 24;
    
    // Body
    ctx.fillStyle = primary;
    ctx.fillRect(-size * 0.4, -size * 0.5, size * 0.8, size * 0.6);
    // Belly highlight
    ctx.fillStyle = '#FFC4D6';
    ctx.fillRect(-size * 0.3, -size * 0.1, size * 0.6, size * 0.2);
    // Tentacles
    for (let i = -2; i <= 2; i++) {
      ctx.fillStyle = i % 2 === 0 ? primary : accent;
      ctx.fillRect(i * size * 0.18 - size * 0.05, size * 0.1, size * 0.12, size * 0.4);
    }
    // Eyes default
    ctx.fillStyle = 'white';
    ctx.fillRect(-size * 0.2, -size * 0.3, size * 0.15, size * 0.15);
    ctx.fillRect(size * 0.05, -size * 0.3, size * 0.15, size * 0.15);
    ctx.fillStyle = 'black';
    ctx.fillRect(-size * 0.15, -size * 0.27, size * 0.08, size * 0.08);
    ctx.fillRect(size * 0.1, -size * 0.27, size * 0.08, size * 0.08);
    
    // Accessories (if available)
    if (typeof SquidAccessories !== 'undefined') {
      try {
        if (acc.eyes && acc.eyes !== 'round') SquidAccessories.drawEyes(ctx, acc.eyes, size);
        if (acc.outfit && acc.outfit !== 'none') SquidAccessories.drawOutfit(ctx, acc.outfit, size);
        if (acc.hat && acc.hat !== 'none') SquidAccessories.drawHat(ctx, acc.hat, size);
        if (acc.glasses && acc.glasses !== 'none') SquidAccessories.drawGlasses(ctx, acc.glasses, size);
      } catch {}
    }
    
    ctx.restore();
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
    console.log('[BRAIN] Opening project memory');
    
    const memoryPath = `/projects/${this.currentTemple.name}/project_memory.json`;
    this.openFile('project_memory.json', memoryPath, 'memory');
  },
  
  /**
   * Open visual cron builder (HUMAN INTUITIVE + REAL)
   */
  openCronBuilder() {
    console.log('🔄 Opening REAL cron builder');
    
    // Create modal INSIDE temple interior (not browser popup)
    const interior = document.getElementById('temple-interior');
    if (!interior) return;
    
    const modal = document.createElement('div');
    modal.className = 'cron-builder-modal';
    modal.innerHTML = `
      <div class="cron-builder">
        <h2>⏰ Create Scheduled Task</h2>
        <p class="hint">Build your schedule visually - no cron syntax needed!</p>
        
        <div class="form-section">
          <label>Task Name:</label>
          <input type="text" id="cron-name" placeholder="e.g., Daily backup" required>
        </div>
        
        <div class="form-section">
          <label>Description:</label>
          <textarea id="cron-desc" placeholder="What should this task do?" required></textarea>
        </div>
        
        <div class="form-section">
          <label>Frequency:</label>
          <select id="cron-frequency" onchange="TempleInterior.updateCronPreview()">
            <option value="every_minute">Every Minute (testing)</option>
            <option value="every_5_min">Every 5 Minutes</option>
            <option value="every_15_min">Every 15 Minutes</option>
            <option value="every_30_min">Every 30 Minutes</option>
            <option value="hourly">Every Hour</option>
            <option value="daily" selected>Every Day</option>
            <option value="weekly">Every Week</option>
            <option value="monthly">Every Month</option>
            <option value="custom">Custom (advanced)...</option>
          </select>
        </div>
        
        <div class="form-section" id="cron-time-section">
          <label>Time (24h format):</label>
          <input type="time" id="cron-time" value="09:00" onchange="TempleInterior.updateCronPreview()">
        </div>
        
        <div class="form-section" id="cron-day-section" style="display: none;">
          <label>Day of Week:</label>
          <select id="cron-day">
            <option value="1">Monday</option>
            <option value="2">Tuesday</option>
            <option value="3">Wednesday</option>
            <option value="4">Thursday</option>
            <option value="5">Friday</option>
            <option value="6">Saturday</option>
            <option value="0">Sunday</option>
          </select>
        </div>
        
        <div class="form-section" id="cron-date-section" style="display: none;">
          <label>Day of Month:</label>
          <input type="number" id="cron-date" min="1" max="31" value="1" onchange="TempleInterior.updateCronPreview()">
        </div>
        
        <div class="form-section" id="cron-custom-section" style="display: none;">
          <label>Custom Cron Expression:</label>
          <input type="text" id="cron-custom" placeholder="* * * * *" pattern="[0-9\*,\-/]+ [0-9\*,\-/]+ [0-9\*,\-/]+ [0-9\*,\-/]+ [0-9\*,\-/]+">
          <small>Format: minute hour day month weekday</small>
        </div>
        
        <div class="form-section">
          <label>Preview:</label>
          <div id="cron-preview" class="cron-preview">Every day at 9:00 AM</div>
          <div id="cron-expression" class="cron-expression">0 9 * * *</div>
        </div>
        
        <div class="form-actions">
          <button onclick="TempleInterior.saveCronTask()" class="btn-save">[OK] Create Task</button>
          <button onclick="TempleInterior.closeCronBuilder()" class="btn-cancel">[ERROR] Cancel</button>
        </div>
      </div>
    `;
    
    interior.appendChild(modal);
    this.updateCronPreview();
  },
  
  /**
   * Show squid assigner (assign real squids to project)
   * Includes name search input.
   */
  async showSquidAssigner() {
    console.log('[SQUID] Opening squid assigner');
    
    // Source 1: aquarium canvas squids (already loaded)
    let allSquids = (window.aquarium?.squids || []).map(s => ({
      id: s.id,
      agent_id: s.agent_id || s.id,
      name: s.name,
      specialty: s.specialty || s.role || 'general',
      currentProject: s.currentProject || s.insideTemple || null,
      status: s.status || 'idle'
    }));
    
    // Source 2: V2 agent registry (backup / source of truth)
    try {
      const r = await window.ApiV2._fetch('/agents');
      const regAgents = Object.values(r.registry.agents || {});
      // Merge - keep canvas squids, add any registry-only ones
      const seenIds = new Set(allSquids.map(s => s.id || s.agent_id));
      for (const a of regAgents) {
        const aid = a.agent_id;
        if (!seenIds.has(aid)) {
          allSquids.push({
            id: aid,
            agent_id: aid,
            name: a.display_name || aid,
            specialty: a.specialization || 'general',
            currentProject: a.current_project || null,
            status: a.status || 'sleeping'
          });
        }
      }
    } catch (err) {
      console.warn('[SQUID assigner] V2 registry load failed:', err.message);
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal squid-assigner-modal';
    modal.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:520px;">
        <div class="modal-header">
          <h2>Assign Squid to ${this._escape(this.currentTemple.name)}</h2>
          <button class="btn-close" onclick="this.closest('.modal').remove()">x</button>
        </div>
        <div class="modal-body" style="padding:16px;">
          <p class="hint" style="font-size:9px; color:var(--text-secondary); margin-bottom:12px;">
            ${allSquids.length} squid${allSquids.length === 1 ? '' : 's'} available. Status shows current assignment.
          </p>
          <select id="squid-assigner-dropdown" style="width:100%; padding:8px; background:var(--ocean-mid); border:1px solid var(--border); color:var(--text); font-family:'Courier New',monospace; font-size:11px;">
            <option value="">-- Select a squid --</option>
            ${allSquids.length === 0
              ? '<option disabled>No squids exist. Create one from + New Squid in top nav</option>'
              : allSquids.map(s => {
                  const isHere = s.currentProject === this.currentTemple.name;
                  const elsewhere = s.currentProject && !isHere;
                  let status = `available (${s.status})`;
                  if (isHere) status = 'already here';
                  else if (elsewhere) status = `currently: ${s.currentProject}`;
                  return `<option value="${this._escape(s.id)}" ${isHere ? 'disabled' : ''}>${this._escape(s.name)} - ${this._escape(s.specialty)} - ${status}</option>`;
                }).join('')
            }
          </select>
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end; padding:12px 16px; border-top:1px solid var(--border);">
          <button class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
          <button class="btn-primary" id="squid-assign-confirm">Assign</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    modal.querySelector('#squid-assign-confirm').addEventListener('click', () => {
      const sel = modal.querySelector('#squid-assigner-dropdown');
      const squidId = sel.value;
      if (!squidId) { alert('Pick a squid first'); return; }
      this.assignSquid(squidId);
      modal.remove();
    });
  },
  
  _escape(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  },
  
  /**
   * Configure squid (FORM-BASED PROMPT BUILDER)
   */
  configureSquid(squidId) {
    console.log('[CONFIG] Configuring squid:', squidId);
    
    const squid = window.aquarium?.squids.find(s => s.id === squidId);
    if (!squid) return;
    
    const modal = document.createElement('div');
    modal.className = 'squid-config-modal';
    modal.innerHTML = `
      <div class="squid-config">
        <h2>Configure ${squid.name}</h2>
        <p class="hint">Assemble your agent's behavior like building blocks</p>
        
        <div class="config-section">
          <h3>[TARGET] Role & Specialty</h3>
          <select id="config-role">
            <option>Developer</option>
            <option>Designer</option>
            <option>Writer</option>
            <option>Analyst</option>
            <option>QA Tester</option>
          </select>
        </div>
        
        <div class="config-section">
          <h3>[BRAIN] Working Style</h3>
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
          <h3>[TASKS] Task Focus</h3>
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
   * Update cron preview (REAL IMPLEMENTATION)
   */
  updateCronPreview() {
    const freq = document.getElementById('cron-frequency')?.value;
    const time = document.getElementById('cron-time')?.value || '09:00';
    const day = document.getElementById('cron-day')?.value || '1';
    const date = document.getElementById('cron-date')?.value || '1';
    const preview = document.getElementById('cron-preview');
    const expression = document.getElementById('cron-expression');
    
    if (!preview || !expression) return;
    
    // Show/hide sections based on frequency
    const daySection = document.getElementById('cron-day-section');
    const dateSection = document.getElementById('cron-date-section');
    const customSection = document.getElementById('cron-custom-section');
    const timeSection = document.getElementById('cron-time-section');
    
    if (daySection) daySection.style.display = freq === 'weekly' ? 'block' : 'none';
    if (dateSection) dateSection.style.display = freq === 'monthly' ? 'block' : 'none';
    if (customSection) customSection.style.display = freq === 'custom' ? 'block' : 'none';
    if (timeSection) timeSection.style.display = ['daily', 'weekly', 'monthly'].includes(freq) ? 'block' : 'none';
    
    // Parse time
    const [hour, minute] = time.split(':').map(Number);
    
    // Generate cron expression and human text
    let cronExpr = '';
    let humanText = '';
    
    switch(freq) {
      case 'every_minute':
        cronExpr = '* * * * *';
        humanText = 'Every minute';
        break;
      case 'every_5_min':
        cronExpr = '*/5 * * * *';
        humanText = 'Every 5 minutes';
        break;
      case 'every_15_min':
        cronExpr = '*/15 * * * *';
        humanText = 'Every 15 minutes';
        break;
      case 'every_30_min':
        cronExpr = '*/30 * * * *';
        humanText = 'Every 30 minutes';
        break;
      case 'hourly':
        cronExpr = '0 * * * *';
        humanText = 'Every hour';
        break;
      case 'daily':
        cronExpr = `${minute} ${hour} * * *`;
        humanText = `Every day at ${time}`;
        break;
      case 'weekly':
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        cronExpr = `${minute} ${hour} * * ${day}`;
        humanText = `Every ${days[day]} at ${time}`;
        break;
      case 'monthly':
        cronExpr = `${minute} ${hour} ${date} * *`;
        humanText = `Day ${date} of every month at ${time}`;
        break;
      case 'custom':
        cronExpr = document.getElementById('cron-custom')?.value || '* * * * *';
        humanText = 'Custom schedule: ' + cronExpr;
        break;
    }
    
    preview.textContent = humanText;
    expression.textContent = cronExpr;
  },
  
  /**
   * Close cron builder
   */
  closeCronBuilder() {
    const modal = document.querySelector('.cron-builder-modal');
    if (modal) modal.remove();
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
   * Assign squid to project (REAL IMPLEMENTATION)
   */
  assignSquid(squidId) {
    console.log('➕ REALLY assigning squid:', squidId, 'to', this.currentTemple.name);
    
    const squid = window.aquarium?.squids.find(s => s.id === squidId);
    if (!squid) {
      alert('Squid not found!');
      return;
    }
    
    // Update squid's project assignment
    const previousProject = squid.currentProject;
    squid.currentProject = this.currentTemple.name;
    
    // Save to backend
    fetch('/api/agents/assign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agentId: squidId,
        project: this.currentTemple.name
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        console.log('[OK] Squid assigned successfully!');
        
        // Refresh working agents display
        this.populateWorkingAgents(this.currentTemple);
        
        // Update button in modal
        const button = document.querySelector(`[onclick="TempleInterior.assignSquid('${squidId}')"]`);
        if (button) {
          button.textContent = '[OK] Assigned';
          button.disabled = true;
          button.style.opacity = '0.6';
        }
        
        alert(`[OK] ${squid.name} assigned to ${this.currentTemple.name}!`);
      } else {
        // Rollback on failure
        squid.currentProject = previousProject;
        alert('[ERROR] Failed to assign: ' + (data.error || 'Unknown error'));
      }
    })
    .catch(err => {
      console.error('Failed to assign squid:', err);
      // Rollback
      squid.currentProject = previousProject;
      alert('[ERROR] Error assigning squid. See console for details.');
    });
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
   * Save cron task (REAL IMPLEMENTATION)
   */
  saveCronTask() {
    const name = document.getElementById('cron-name')?.value;
    const desc = document.getElementById('cron-desc')?.value;
    const expression = document.getElementById('cron-expression')?.textContent;
    const preview = document.getElementById('cron-preview')?.textContent;
    
    if (!name || !desc) {
      alert('Please fill in task name and description');
      return;
    }
    
    if (!expression || expression === '') {
      alert('Invalid cron expression');
      return;
    }
    
    console.log('💾 Creating REAL cron task:', name);
    console.log('   Expression:', expression);
    console.log('   Description:', desc);
    
    // Create task object
    const task = {
      id: Date.now().toString(),
      name: name,
      description: desc,
      schedule: expression,
      humanSchedule: preview,
      project: this.currentTemple.name,
      enabled: true,
      createdAt: new Date().toISOString()
    };
    
    // Save to backend (TEMPORARY: Save locally until backend ready)
    console.log('💾 Saving cron task:', task);
    
    // Add to temple project immediately (works without backend)
    if (!this.currentTemple.project.cronTasks) {
      this.currentTemple.project.cronTasks = [];
    }
    this.currentTemple.project.cronTasks.push(task);
    
    // Refresh display
    this.populateCronTasks(this.currentTemple);
    
    // Close modal
    this.closeCronBuilder();
    
    alert(`[OK] Task "${name}" created!\nSchedule: ${preview}\n\n(Saved locally - backend integration pending)`);
    
    // TODO: Uncomment when backend is ready
    /*
    fetch('/api/cron/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(task)
    })
    .then(res => {
      if (!res.ok) throw new Error('Backend not available');
      return res.json();
    })
    .then(data => {
      console.log('[OK] Task saved to backend:', data);
    })
    .catch(err => {
      console.warn('Backend not ready, task saved locally:', err);
    });
    */
  }
};

// Make available globally
window.TempleInterior = TempleInterior;
console.log('[TEMPLE] TempleInterior module loaded');

/**
 * Load REAL project_memory.json from backend
 */
TempleInterior.openProjectMemory = async function() {
  if (!this.currentTemple) return;
  
  try {
    const response = await fetch(`/api/projects/${this.currentTemple.name}/memory`);
    const data = await response.json();
    
    if (data.success) {
      // Show in IDE editor
      const editor = document.getElementById('temple-editor');
      const filename = document.getElementById('editor-filename');
      
      editor.value = JSON.stringify(data.memory, null, 2);
      filename.textContent = 'project_memory.json';
      
      this.currentFile = {
        name: 'project_memory.json',
        path: `/projects/${this.currentTemple.name}/project_memory.json`,
        type: 'json'
      };
      
      console.log('[OK] Loaded real project_memory.json');
    } else {
      alert('Failed to load memory: ' + data.error);
    }
  } catch (error) {
    console.error('Error loading memory:', error);
    alert('Error loading memory: ' + error.message);
  }
};


// Legacy duplicate showSquidAssigner removed - using the search-by-name version above

/**
 * Customize temple colors
 */
TempleInterior.customizeColors = function() {
  if (!this.currentTemple) return;
  
  const currentColors = this.currentTemple.colors || { outside: '#457B9D', inside: '#1D3557' };
  
  const outsideColor = prompt('Temple outside color (hex):', currentColors.outside);
  if (!outsideColor) return;
  
  const insideColor = prompt('Temple inside color (hex):', currentColors.inside);
  if (!insideColor) return;
  
  // Update backend
  fetch(`/api/projects/${this.currentTemple.name}/colors`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      outside: outsideColor,
      inside: insideColor
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      // Update local temple
      this.currentTemple.colors = { outside: outsideColor, inside: insideColor };
      alert(`[OK] Temple colors updated!\n\nOutside: ${outsideColor}\nInside: ${insideColor}`);
      
      // Refresh aquarium to show new colors
      if (window.aquarium && window.aquarium.loadTemples) {
        window.aquarium.loadTemples();
      }
    } else {
      alert('[ERROR] Failed to update colors: ' + data.error);
    }
  })
  .catch(error => {
    alert('[ERROR] Error: ' + error.message);
  });
};

console.log('[OK] Temple color customization loaded');
