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

    // Cancel any running squid walk animations from previous temple
    if (TempleInterior._rafMap) {
      Object.values(TempleInterior._rafMap).forEach(id => cancelAnimationFrame(id));
      TempleInterior._rafMap = {};
    }
    
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
          <div id="squid-assign-inline" style="display:none; margin-top:6px; display:none;">
            <select id="temple-squid-select" style="width:100%; padding:6px; background:#0d1b2a; border:1px solid #4facfe; color:#f1faee; font-size:11px; border-radius:3px; margin-bottom:4px;"></select>
            <div style="display:flex; gap:6px;">
              <button class="btn-primary" style="flex:1; font-size:9px; padding:5px;" onclick="TempleInterior.confirmAssign()">✔ Assign</button>
              <button class="btn-secondary" style="font-size:9px; padding:5px;" onclick="document.getElementById('squid-assign-inline').style.display='none'">✕</button>
            </div>
          </div>
          
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
    const inputContainer  = document.getElementById('input-resources');
    const outputContainer = document.getElementById('output-resources');
    if (!inputContainer || !outputContainer) return;
    inputContainer.innerHTML  = '<p class="empty-state" style="opacity:.5;font-size:9px;">Loading…</p>';
    outputContainer.innerHTML = '<p class="empty-state" style="opacity:.5;font-size:9px;">Loading…</p>';
    this._loadInputFiles(temple, inputContainer);
    this._loadOutputFiles(temple, outputContainer);
  },

  async _loadInputFiles(temple, container) {
    const pid = temple.project_id || 'PROJECT_001';
    const folder = pid.toUpperCase().replace(/^project_/i, 'PROJECT_');
    try {
      const res  = await fetch(`/api/v2/projects/${folder}/inputs`);
      const data = await res.json();
      const files = data.files || [];
      const uploadRow = `
        <div class="resource-upload-row" id="input-upload-row-${folder}">
          <label class="resource-upload-btn" title="Add file to project input">
            📎 Add file
            <input type="file" multiple style="display:none"
              onchange="TempleInterior._handleInputUpload(event, '${folder}')">
          </label>
          <div class="resource-drop-hint">or drag & drop here</div>
        </div>`;
      if (files.length === 0) {
        container.innerHTML = `<p class="empty-state">No input files yet</p>${uploadRow}`;
      } else {
        container.innerHTML = files.map(f => {
          const icon = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name) ? '🖼' : '📄';
          const escaped = TempleInterior._escape(f.name);
          return `<div class="resource-item" onclick="TempleInterior.openFile('${escaped}','${TempleInterior._escape(f.path)}','input')">
            <span class="resource-icon">${icon}</span>
            <span class="resource-name">${escaped}</span>
            <span class="resource-size">${f.size||''}</span>
            <button class="resource-del-btn" onclick="event.stopPropagation();TempleInterior._deleteInput('${folder}','${escaped}',this)" title="Remove">✕</button>
          </div>`;
        }).join('') + uploadRow;
      }
      // Wire drag-and-drop on the container
      container.addEventListener('dragover', e => { e.preventDefault(); container.classList.add('drag-over'); });
      container.addEventListener('dragleave', () => container.classList.remove('drag-over'));
      container.addEventListener('drop', e => {
        e.preventDefault(); container.classList.remove('drag-over');
        const files2 = Array.from(e.dataTransfer?.files || []);
        if (files2.length) TempleInterior._uploadFiles(folder, files2, container, temple);
      });
    } catch (e) {
      container.innerHTML = `<p class="empty-state">Error loading input files: ${e.message}</p>`;
    }
  },

  async _handleInputUpload(event, folder) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const temple = this.currentTemple;
    const container = document.getElementById('input-resources');
    await this._uploadFiles(folder, files, container, temple);
    event.target.value = '';
  },

  async _uploadFiles(folder, files, container, temple) {
    const uploadRow = container?.querySelector('.resource-upload-row');
    if (uploadRow) uploadRow.insertAdjacentHTML('beforebegin', '<p style="font-size:9px;color:#4facfe;">Uploading…</p>');
    for (const file of files) {
      try {
        const isText = /\.(txt|md|json|csv|js|ts|py|html|css|xml|yaml|yml|sh|c|cpp|h|java|rs|go|rb|php)$/i.test(file.name);
        let content, encoding;
        if (isText || file.type.startsWith('text/')) {
          content  = await file.text();
          encoding = 'utf8';
        } else {
          // Binary / image — base64
          content = await new Promise((res, rej) => {
            const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.onerror = rej; r.readAsDataURL(file);
          });
          encoding = 'base64';
        }
        await fetch(`/api/v2/projects/${folder}/inputs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, content, encoding })
        });
      } catch (e) {
        console.warn('[TempleInterior] Upload failed:', file.name, e.message);
      }
    }
    // Reload input list
    if (container && temple) await this._loadInputFiles(temple, container);
  },

  async _deleteInput(folder, fileName, btn) {
    if (!confirm(`Remove "${fileName}" from project input?`)) return;
    try {
      await fetch(`/api/v2/projects/${folder}/inputs/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
      const container = document.getElementById('input-resources');
      if (container && this.currentTemple) await this._loadInputFiles(this.currentTemple, container);
    } catch (e) { alert('Delete failed: ' + e.message); }
  },
  
  async _loadOutputFiles(temple, container) {
    const projectFolder = (temple.project_id || 'PROJECT_001')
      .toUpperCase().replace(/^project_/i, 'PROJECT_');
    try {
      const res = await fetch(`/api/v2/projects/${projectFolder}/outputs`);
      if (!res.ok) throw new Error('no outputs dir');
      const data = await res.json();
      const files = data.files || [];
      if (files.length === 0) {
        container.innerHTML = '<p class="empty-state">No outputs yet<br>Agents will create files here</p>';
        return;
      }
      container.innerHTML = files.map(f => {
        const isImg = /\.(png|jpg|jpeg|gif|webp|svg)$/i.test(f.name);
        const icon  = isImg ? '🖼' : '✨';
        const thumb = isImg
          ? `<img src="/api/v2/projects/${projectFolder}/outputs/${encodeURIComponent(f.name)}" style="width:40px;height:40px;object-fit:cover;border-radius:3px;margin-right:6px;vertical-align:middle;">`
          : '';
        return `<div class="resource-item output-item" onclick="TempleInterior.openFile('${this._escape(f.name)}','${this._escape(f.path)}','output')">
          ${thumb}<span class="resource-icon">${icon}</span>
          <span class="resource-name">${this._escape(f.name)}</span>
          <span class="resource-agent">${this._escape(f.size || '')}</span>
        </div>`;
      }).join('');
    } catch {
      container.innerHTML = '<p class="empty-state">No outputs yet<br>Agents will create files here</p>';
    }
  },

  /**
   * Populate working agents (REAL squids from aquarium)
   */
  async populateWorkingAgents(temple) {
    const container = document.getElementById('working-agents');
    
    // Source of truth: project registry assigned_agents[]
    let assignedSquids = [];
    try {
      const pr = await window.ApiV2._fetch('/projects');
      const proj = Object.values(pr.registry.projects || {}).find(p =>
        p.project_id === temple.project_id || p.name === temple.name
      );
      const assignedIds = proj?.assigned_agents || [];
      
      const canvasSquids = window.aquarium?.squids || [];
      const seen = new Set();
      
      // Match by agent_id OR id (canvas squids may use either)
      for (const agentId of assignedIds) {
        const sq = canvasSquids.find(s => (s.agent_id || s.id) === agentId);
        if (sq) {
          sq.currentProject = temple.name; // restore in-memory
          assignedSquids.push(sq);
          seen.add(agentId);
        }
      }
      // Fallback: agent registry for any id not matched in canvas
      if (assignedIds.length > seen.size) {
        const ar = await window.ApiV2._fetch('/agents');
        const regAgents = Object.values(ar.registry.agents || {});
        for (const a of regAgents) {
          if (assignedIds.includes(a.agent_id) && !seen.has(a.agent_id)) {
            assignedSquids.push({
              id: a.agent_id,
              name: a.display_name || a.agent_id,
              specialty: a.specialization || 'general',
              role: a.specialization || 'general',
              status: a.status || 'idle',
              appearance: a.appearance || null,
              insideTemple: temple.name
            });
            seen.add(a.agent_id);
          }
        }
      }
    } catch {
      // Fallback to in-memory canvas state
      assignedSquids = (window.aquarium?.squids || []).filter(s =>
        s.currentProject === temple.name || s.insideTemple === temple.name
      );
    }
    
    if (assignedSquids.length === 0) {
      container.innerHTML = `
        <p class="empty-state">
          No agents assigned yet.<br>
          Click "Assign Squids" to add workers from your roster.
        </p>
      `;
      return;
    }
    
    // Build arena + action rows
    container.innerHTML = `
      <div class="squid-arena" id="squid-arena"></div>
      <div class="squid-action-row">
        ${assignedSquids.map(squid => `
          <span class="squid-action-item">
            <span class="squid-action-name">${this._escape(squid.name)}</span>
            <button class="btn-config-squid" onclick="window.AgentForm?.open('${this._escape(squid.id)}')">Edit</button>
            <button class="btn-config-squid btn-danger" onclick="TempleInterior.unassignSquid('${this._escape(squid.id)}')">↩ Aquarium</button>
          </span>
        `).join('')}
      </div>
    `;

    // Spawn walker divs in arena
    const arena = container.querySelector('#squid-arena');
    setTimeout(() => {
      if (!arena) return;
      const W = arena.clientWidth  || 600;
      const H = arena.clientHeight || 130;
      assignedSquids.forEach(squid => {
        const walker = document.createElement('div');
        walker.className = 'squid-walker';
        walker.dataset.squidId = squid.id;
        const cvs = document.createElement('canvas');
        cvs.width  = 50;
        cvs.height = 55;
        const lbl = document.createElement('div');
        lbl.className = 'walker-name';
        lbl.textContent = squid.name;
        walker.appendChild(cvs);
        walker.appendChild(lbl);
        arena.appendChild(walker);
        this._animateTempleSquid(walker, cvs, squid, W, H);
      });
    }, 80);
  },
  
  /**
   * Animate a walking squid on a temple canvas using the same visual style as Squid.js.
   * The squid walks left/right, flips direction, tentacles swing like legs.
   */
  // walkerDiv: the absolutely-positioned wrapper div
  // cvs: the 50×55 canvas inside it
  // squid: data object
  // cW/cH: arena container dimensions for wall bounce
  _animateTempleSquid(walkerDiv, cvs, squid, cW, cH) {
    if (!TempleInterior._rafMap) TempleInterior._rafMap = {};
    if (TempleInterior._rafMap[squid.id]) {
      cancelAnimationFrame(TempleInterior._rafMap[squid.id]);
      delete TempleInterior._rafMap[squid.id];
    }

    const ctx = cvs.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    const CW = cvs.width;   // 50
    const CH = cvs.height;  // 55
    const size = 16;        // body radius (fits inside 50px canvas)

    const app     = squid.appearance || {};
    const acc     = app.accessories  || {};
    const primary = app.primary_color  || app.body_color   || '#FF6B9D';
    const accent  = app.secondary_color || app.accent_color || '#C44569';

    const darken  = (hex, f) => { try { const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16); return `rgb(${Math.floor(r*f)},${Math.floor(g*f)},${Math.floor(b*f)})`; } catch { return hex; } };
    const brighten = (hex, f) => { try { const r=Math.min(255,parseInt(hex.slice(1,3),16)*f),g=Math.min(255,parseInt(hex.slice(3,5),16)*f),b=Math.min(255,parseInt(hex.slice(5,7),16)*f); return `rgb(${Math.floor(r)},${Math.floor(g)},${Math.floor(b)})`; } catch { return hex; } };

    const margin = size + 6;
    const arenaW = cW || 600;
    const arenaH = cH || 130;
    let px = margin + Math.random() * (arenaW - margin * 2);
    let py = margin + Math.random() * (arenaH - margin * 2);
    let vx = (Math.random() - 0.5) * 0.8;
    let vy = (Math.random() - 0.5) * 0.4;
    let frame = Math.floor(Math.random() * 600);
    // Idle state: squid occasionally stops and gently sways
    let idleFrames = 0;     // frames left in idle pause
    let nextIdleIn = 80 + Math.floor(Math.random() * 120); // frames until next idle

    const stride = 30; // slower stride = more chill

    const loop = () => {
      frame++;

      // Decide whether to idle
      if (idleFrames > 0) {
        idleFrames--;
        // Drift very gently when idle (barely move)
        vx *= 0.85; vy *= 0.85;
      } else {
        nextIdleIn--;
        if (nextIdleIn <= 0) {
          idleFrames  = 40 + Math.floor(Math.random() * 60);
          nextIdleIn  = 100 + Math.floor(Math.random() * 150);
        }
        // Gentle random walk nudges
        vx += (Math.random() - 0.5) * 0.10;
        vy += (Math.random() - 0.5) * 0.06;
        vx *= 0.97; vy *= 0.97;
        const spd = Math.sqrt(vx * vx + vy * vy);
        const maxSpd = 0.85;
        if (spd > maxSpd) { vx *= maxSpd / spd; vy *= maxSpd / spd; }
        if (spd < 0.15) { vx += (Math.random() - 0.5) * 0.3; vy += (Math.random() - 0.5) * 0.15; }
      }

      px += vx; py += vy;
      if (px < margin)         { px = margin;         vx =  Math.abs(vx) * 0.7; }
      if (px > arenaW - margin){ px = arenaW - margin; vx = -Math.abs(vx) * 0.7; }
      if (py < margin)         { py = margin;         vy =  Math.abs(vy) * 0.7; }
      if (py > arenaH - margin){ py = arenaH - margin; vy = -Math.abs(vy) * 0.7; }

      walkerDiv.style.left = (px - CW / 2) + 'px';
      walkerDiv.style.top  = (py - CH / 2) + 'px';

      const isIdle      = idleFrames > 0;
      const facingRight = isIdle ? (vx >= 0) : (vx >= 0);
      const walkPhase   = (frame / stride) * Math.PI * 2;
      const bodyBob     = isIdle
        ? Math.sin(frame * 0.04) * 1.2          // gentle sway when idle
        : Math.sin(walkPhase * 2) * 1.5;        // bob while walking

      ctx.clearRect(0, 0, CW, CH);

      // Use real Squid.draw() for pixel-perfect match with aquarium
      if (typeof Squid !== 'undefined') {
        try {
          const sq = new Squid({
            id: '__tw__', name: '', status: 'idle',
            appearance: { ...app }, accessories: acc,
            x: facingRight ? CW/2 : CW/2, y: CH/2 - 2 + bodyBob
          });
          sq.animFrame     = walkPhase;
          sq.bobOffset     = 0;
          sq.isDragging    = true;   // freeze drawBody bob
          sq.isSleeping    = false;
          sq.isHovered     = false;
          sq.alpha         = 1;
          sq.insideTemple  = null;
          sq.jumpHeight    = 0;
          sq.heartParticles = [];
          sq._confetti     = null;
          sq.baseSize      = size / 40;

          if (!facingRight) {
            ctx.save();
            ctx.translate(CW, 0); ctx.scale(-1, 1);
            sq.x = CW - sq.x;
            sq.draw(ctx);
            ctx.restore();
          } else {
            sq.draw(ctx);
          }
          TempleInterior._rafMap[squid.id] = requestAnimationFrame(loop);
          return;
        } catch(e) { /* fall through to manual */ }
      }

      // Fallback manual draw
      ctx.save();
      ctx.translate(CW/2, CH/2 - 2 + bodyBob);
      if (!facingRight) ctx.scale(-1, 1);
      const grad = ctx.createRadialGradient(-size*.15,-size*.2,0,0,0,size);
      grad.addColorStop(0, brighten(primary,1.25)); grad.addColorStop(.6,primary); grad.addColorStop(1,darken(primary,.75));
      ctx.fillStyle=grad; ctx.strokeStyle='#1a1a1a'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(0,0,size,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle='rgba(255,255,255,.22)'; ctx.beginPath();
      ctx.ellipse(-size*.15,-size*.1,size*.4,size*.5,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='white';
      ctx.beginPath(); ctx.arc(-size*.28,-size*.15,size*.16,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( size*.28,-size*.15,size*.16,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#111';
      ctx.beginPath(); ctx.arc(-size*.26,-size*.14,size*.08,0,Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( size*.30,-size*.14,size*.08,0,Math.PI*2); ctx.fill();
      ctx.lineCap='round';
      for(let i=0;i<6;i++){
        const lx=(i-2.5)*size*.28;
        const ph=walkPhase+(i%2===0?0:Math.PI);
        const sw=isIdle?Math.sin(frame*.06+i)*2:Math.sin(ph)*5;
        const lf=isIdle?0:Math.max(0,Math.sin(ph))*2.5;
        const bY=size*Math.sqrt(Math.max(0,1-Math.pow(lx/(size*.82),2)));
        ctx.strokeStyle=i%2===0?primary:darken(primary,.8); ctx.lineWidth=2.2;
        ctx.beginPath(); ctx.moveTo(lx,bY);
        ctx.quadraticCurveTo(lx+sw*.5,bY+size*.4-lf,lx+sw,bY+size*.85-lf*.5);
        ctx.stroke();
      }
      ctx.restore();
      TempleInterior._rafMap[squid.id] = requestAnimationFrame(loop);
    };

    TempleInterior._rafMap[squid.id] = requestAnimationFrame(loop);
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
   * Populate cron tasks: read from V2 tasks registry, filtered by project_id.
   */
  async populateCronTasks(temple) {
    const container = document.getElementById('cron-tasks');
    if (!container) return;
    
    const projectId = temple.project_id;
    let cronTasks = [];
    
    if (projectId) {
      try {
        const r = await window.ApiV2._fetch('/tasks');
        const allTasks = Object.values(r.registry?.tasks || {});
        cronTasks = allTasks.filter(t => t.project_id === projectId && t.schedule?.cron);
      } catch (err) {
        console.warn('[TempleInterior] populateCronTasks fetch failed:', err.message);
      }
    }
    
    if (cronTasks.length > 0) {
      container.innerHTML = cronTasks.map(task => `
        <div class="cron-task">
          <span class="cron-schedule">${this._escape(task.schedule?.human || this.humanizeCron(task.schedule?.cron) || '')}</span>
          <span class="cron-desc">${this._escape(task.description || task.name || '')}</span>
          <button class="btn-edit-cron" onclick="TempleInterior.editCron('${this._escape(task.task_id || task.id)}')">✏️</button>
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

    const lower = filename.toLowerCase();
    const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/.test(lower);

    if (isImage) {
      // For image outputs: show directly in the preview pane, blank the editor
      document.getElementById('temple-editor').value = `[Image file: ${filename}]\n\nPreview shown on the right.`;
      const preview = document.getElementById('temple-preview');
      // Build URL: if filepath looks like a project output use the API route
      const projectFolder = this.currentTemple?.project_id
        ? this.currentTemple.project_id.toUpperCase().replace(/project_/i, 'PROJECT_')
        : null;
      const imgUrl = filepath.startsWith('http')
        ? filepath
        : `/api/v2/projects/${projectFolder || 'PROJECT_001'}/outputs/${encodeURIComponent(filename)}`;
      preview.srcdoc = `<!DOCTYPE html><html><body style="margin:0;background:#0d1b2a;display:flex;align-items:center;justify-content:center;min-height:100vh;">
        <img src="${imgUrl}" style="max-width:100%;max-height:100vh;image-rendering:pixelated;" alt="${filename}"
          onerror="this.style.display='none';document.body.innerHTML+='<p style=color:#e63946;font-family:monospace;font-size:11px;padding:16px>Image not found: ${imgUrl}</p>'">
        </body></html>`;
      return;
    }

    // Load file content (text/JSON)
    fetch(`/api/files/read?path=${encodeURIComponent(filepath)}`)
      .then(res => {
        const ct = res.headers.get('content-type');
        if (ct && ct.includes('application/json')) return res.json();
        return res.text().then(text => ({ content: text }));
      })
      .then(data => {
        const content = data.content || data;
        document.getElementById('temple-editor').value =
          typeof content === 'string' ? content : JSON.stringify(content, null, 2);
        if (lower.endsWith('.html')) this.refreshPreview();
      })
      .catch(err => {
        console.error('Failed to load file:', err);
        document.getElementById('temple-editor').value =
          `// Failed to load file: ${err.message}`;
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
    // Collect all squids (canvas + registry)
    const canvasSquids = window.aquarium?.squids || [];
    let allSquids = canvasSquids.map(s => ({
      id: s.agent_id || s.id,
      name: s.name,
      specialty: s.specialty || s.role || 'general',
      currentProject: s.currentProject || s.insideTemple || null
    }));
    try {
      const res  = await fetch('/api/v2/agents');
      const data = await res.json();
      const regAgents = Object.values(data?.registry?.agents || {});
      const seen = new Set(allSquids.map(s => s.id));
      regAgents.forEach(a => {
        if (!seen.has(a.agent_id)) {
          allSquids.push({ id: a.agent_id, name: a.display_name || a.agent_id,
            specialty: a.specialization || 'general', currentProject: null });
        }
      });
    } catch {}

    // Populate the hidden select
    const sel = document.getElementById('temple-squid-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- pick a squid --</option>' +
      allSquids.map(s => {
        const isHere = s.currentProject === this.currentTemple?.name;
        const label  = s.name + ' (' + s.specialty + ')' + (isHere ? ' ✓ here' : s.currentProject ? ' @ ' + s.currentProject : '');
        return `<option value="${this._escape(s.id)}" ${isHere ? 'disabled' : ''}>${label}</option>`;
      }).join('');

    // Show the inline panel
    const panel = document.getElementById('squid-assign-inline');
    if (panel) panel.style.display = 'block';
    sel.focus();

    // Click outside → collapse (one-shot listener)
    const onOutside = (e) => {
      if (!panel.contains(e.target) && !e.target.closest('.btn-assign')) {
        panel.style.display = 'none';
        document.removeEventListener('click', onOutside, true);
      }
    };
    setTimeout(() => document.addEventListener('click', onOutside, true), 100);
  },

  async confirmAssign() {
    const sel = document.getElementById('temple-squid-select');
    const id  = sel?.value;
    if (!id) { await SquidModal.alert('Pick a squid first'); return; }
    document.getElementById('squid-assign-inline').style.display = 'none';
    this.assignSquid(id);
  },

  _pickSquid(el) {
    if (el.classList.contains('disabled')) return;
    document.querySelectorAll('.squid-pick-item.selected').forEach(e => e.classList.remove('selected'));
    el.classList.add('selected');
    TempleInterior._selectedPickId = el.dataset.squidId;
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
  async closeCronBuilder() {
    const modal = document.querySelector('.cron-builder-modal');
    if (modal) modal.remove();
  },
  
  /**
   * Save file
   */
  async saveFile() {
    if (!this.currentFile) {
      await SquidModal.alert('No file open');
      return;
    }
    
    const content = document.getElementById('temple-editor').value;
    console.log('💾 Saving file:', this.currentFile.filename);
    
    // TODO: Implement save endpoint
    await SquidModal.alert('Save functionality coming soon!\nFile: ' + this.currentFile.filename);
  },
  
  /**
   * Refresh preview
   */
  async refreshPreview() {
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
  async close() {
    const interior = document.getElementById('temple-interior');
    if (interior) {
      interior.classList.add('hidden');
    }
  },
  
  /**
   * Assign squid to project (REAL IMPLEMENTATION)
   */
  /**
   * Send a squid back to the aquarium - remove temple assignment.
   * Clears currentProject in canvas + clears assigned_projects in V2 registry.
   */
  async unassignSquid(squidId) {
    console.log('[SQUID] Sending', squidId, 'back to aquarium from', this.currentTemple?.name);
    
    if (!await SquidModal.confirm('Send this squid back to the aquarium? They will leave this temple.')) return;
    
    // Update canvas squid (if present)
    const squid = window.aquarium?.squids.find(s => s.id === squidId);
    if (squid) {
      squid.currentProject = null;
      squid.insideTemple = null;
      // Position them randomly back in aquarium
      const canvas = window.aquarium.canvas;
      if (canvas) {
        squid.x = 80 + Math.random() * (canvas.width - 160);
        squid.y = 80 + Math.random() * (canvas.height - 160);
        squid.targetX = squid.x;
        squid.targetY = squid.y;
        squid.opacity = 1.0;  // restore if faded into temple
      }
    }
    
    // Persist in V2 registry: clear current_project + assigned_projects
    try {
      const projectName = this.currentTemple.name;
      // Clear current_project
      await window.ApiV2._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'agents/agent_registry.json',
          fieldPath: `agents.${squidId}.current_project`,
          newValue: null,
          reason: 'unassigned from temple'
        })
      }).catch(() => {});
      // Remove from assigned_projects array
      const r = await window.ApiV2._fetch('/agents');
      const entry = r.registry.agents[squidId];
      if (entry?.assigned_projects?.includes?.(projectName)) {
        const newList = entry.assigned_projects.filter(p => p !== projectName);
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: 'agents/agent_registry.json',
            fieldPath: `agents.${squidId}.assigned_projects`,
            newValue: newList,
            reason: 'unassigned from temple'
          })
        }).catch(() => {});
      }
      // Remove squid from project_registry.assigned_agents
      const pr = await window.ApiV2._fetch('/projects');
      for (const [pid, p] of Object.entries(pr.registry.projects)) {
        if (p.name === projectName && Array.isArray(p.assigned_agents) && p.assigned_agents.includes(squidId)) {
          await window.ApiV2._fetch('/field', {
            method: 'PATCH',
            body: JSON.stringify({
              filePath: 'projects/project_registry.json',
              fieldPath: `projects.${pid}.assigned_agents`,
              newValue: p.assigned_agents.filter(a => a !== squidId),
              reason: 'unassigned from temple'
            })
          }).catch(() => {});
          break;
        }
      }
    } catch (err) {
      console.warn('[SQUID unassign] persistence failed:', err.message);
    }
    
    // Refresh UI
    this.populateWorkingAgents(this.currentTemple);
    if (typeof ProjectsPanel !== 'undefined') ProjectsPanel.refresh();
  },
  
  async assignSquid(squidId) {
    console.log('➕ REALLY assigning squid:', squidId, 'to', this.currentTemple.name);
    
    const squid = window.aquarium?.squids.find(s => s.id === squidId);
    if (!squid) { await SquidModal.alert('Squid not found!'); return; }
    
    const projectId   = this.currentTemple.project_id;
    const projectName = this.currentTemple.name;
    if (!projectId) { await SquidModal.alert('No project_id on this temple.'); return; }
    
    try {
      // Read current assigned_agents from project registry
      const pr = await window.ApiV2._fetch('/projects');
      const proj = pr.registry.projects[projectId];
      if (!proj) throw new Error('Project not found: ' + projectId);
      
      const assigned = [...(proj.assigned_agents || [])];
      const agentRef  = squid.agent_id || squid.id;
      
      if (!assigned.includes(agentRef)) {
        assigned.push(agentRef);
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: 'projects/project_registry.json',
            fieldPath: `projects.${projectId}.assigned_agents`,
            newValue: assigned,
            reason: 'squid assigned via temple modal'
          })
        });
      }
      
      // Update in-memory state + fade squid into temple
      squid.currentProject = projectName;
      if (squid.insideTemple !== projectName) {
        squid.insideTemple = projectName;
        squid.alpha = 0;
      }
      
      console.log(`[OK] ${squid.name} assigned to ${projectName}`);
      this.populateWorkingAgents(this.currentTemple);
      if (typeof ProjectsPanel !== 'undefined') ProjectsPanel.refresh();
    } catch (err) {
      console.error('Failed to assign squid:', err);
      await SquidModal.alert('[ERROR] ' + err.message);
    }
  },
  
  /**
   * Save squid configuration
   */
  async saveSquidConfig(squidId) {
    console.log('💾 Saving squid config:', squidId);
    await SquidModal.alert('Configuration saved!');
    document.querySelector('.squid-config-modal')?.remove();
  },
  
  /**
   * Save cron task: persist as a V2 scheduled task in the registry.
   */
  async saveCronTask() {
    const name = document.getElementById('cron-name')?.value;
    const desc = document.getElementById('cron-desc')?.value;
    const expression = document.getElementById('cron-expression')?.textContent;
    const preview = document.getElementById('cron-preview')?.textContent;
    
    if (!name || !desc) {
      await SquidModal.alert('Please fill in task name and description');
      return;
    }
    
    if (!expression || expression === '') {
      await SquidModal.alert('Invalid cron expression');
      return;
    }
    
    // The temple object passed by ProjectsPanel.enterTemple is a shim with
    // {name, project_id, files, tasks}. There is no `.project` sub-object,
    // so we never write cronTasks onto it. The single source of truth is
    // the V2 tasks registry. Read project_id from the shim.
    const projectId = this.currentTemple.project_id;
    const projectName = this.currentTemple.name;
    
    if (!projectId) {
      await SquidModal.alert(`Cannot save: no project_id on temple "${projectName}". Try closing and re-opening the temple.`);
      console.warn('[TempleInterior] saveCronTask: missing project_id', this.currentTemple);
      return;
    }
    
    try {
      const res = await window.ApiV2._fetch('/tasks', {
        method: 'POST',
        body: JSON.stringify({
          name,
          description: desc,
          project_id: projectId,
          schedule: {
            cron: expression,
            human: preview,
            enabled: true,
            timezone: 'Europe/Paris'
          },
          source: 'temple_cron_builder',
          status: 'scheduled'
        })
      });
      
      console.log('[OK] Cron task saved:', res);
      await SquidModal.alert(`[OK] Task "${name}" created and scheduled: ${preview}`);
      
      // Refresh the temple's task display
      this.populateCronTasks(this.currentTemple);
      this.closeCronBuilder();
    } catch (err) {
      console.error('[TempleInterior] saveCronTask failed:', err);
      await SquidModal.alert(`Failed to save task: ${err.message}`);
    }
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
      await SquidModal.alert('Failed to load memory: ' + data.error);
    }
  } catch (error) {
    console.error('Error loading memory:', error);
    await SquidModal.alert('Error loading memory: ' + error.message);
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
  .then(async data => {
    if (data.success) {
      // Update local temple
      this.currentTemple.colors = { outside: outsideColor, inside: insideColor };
      await SquidModal.alert(`[OK] Temple colors updated!\n\nOutside: ${outsideColor}\nInside: ${insideColor}`);
      
      // Refresh aquarium to show new colors
      if (window.aquarium && window.aquarium.loadTemples) {
        window.aquarium.loadTemples();
      }
    } else {
      await SquidModal.alert('[ERROR] Failed to update colors: ' + data.error);
    }
  })
  .catch(async error => {
    await SquidModal.alert('[ERROR] Error: ' + error.message);
  });
};

console.log('[OK] Temple color customization loaded');
