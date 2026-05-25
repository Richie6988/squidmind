/**
 * Enhanced Squid Interactions System
 * 
 * Features:
 * - Hover (highlights, thought bubbles)
 * - Click (actions, details)
 * - Drag & Drop (move squids around)
 * - Double click (quick actions)
 * - Right click (context menu)
 */

class SquidInteractionSystem {
  constructor(aquarium) {
    this.aquarium = aquarium;
    this.hoveredSquid = null;
    this.draggedSquid = null;
    this.dragOffset = { x: 0, y: 0 };
    this.lastClickTime = 0;
    this.doubleClickDelay = 300;
    
    // Track mouse movement for drag detection
    this.mouseDownPos = null;
    this.mouseMoved = false;
    this.dragThreshold = 5; // pixels moved before considering it a drag
    
    this.setupEventListeners();
  }

  /**
   * Setup mouse event listeners
   */
  setupEventListeners() {
    const canvas = this.aquarium.canvas;
    
    // Mouse move (hover) - canvas only normally
    canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    
    // Mouse down (start drag)
    canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    
    // Mouse up (end drag, click) - on canvas
    canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    
    // Also listen on document so dragged squid drops on HTML temple cards work
    document.addEventListener('mousemove', (e) => {
      if (this.draggedSquid) this.handleMouseMove(e);
    });
    document.addEventListener('mouseup', (e) => {
      if (this.draggedSquid) this.handleMouseUp(e);
    });
    
    // Context menu (right click)
    canvas.addEventListener('contextmenu', (e) => this.handleContextMenu(e));
    
    // Mouse leave (cleanup)
    canvas.addEventListener('mouseleave', () => this.handleMouseLeave());
    
    // Update cursor
    canvas.style.cursor = 'default';
  }

  /**
   * Get mouse position relative to canvas
   */
  getMousePos(e) {
    const rect = this.aquarium.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }

  /**
   * Find entity at position (Poseidon, Temple, or Squid)
   */
  findEntityAt(x, y) {
    // Check Poseidon first (he's special)
    if (poseidon && poseidon.visible && poseidon.isPointOver(x, y)) {
      return { type: 'poseidon', entity: poseidon };
    }
    
    // Check temples
    if (this.aquarium.templeManager) {
      const temple = this.aquarium.templeManager.findTempleAt(x, y);
      if (temple) {
        return { type: 'temple', entity: temple };
      }
    }
    
    // Check squids (removed verbose logging)
    for (const squid of this.aquarium.squids) {
      if (!squid.isPointOver) continue;
      
      const isOver = squid.isPointOver(x, y);
      if (isOver) {
        return { type: 'squid', entity: squid };
      }
    }
    
    return null;
  }

  /**
   * Handle mouse move
   */
  handleMouseMove(e) {
    const pos = this.getMousePos(e);
    
    // Check if mouse actually moved (for drag detection)
    if (this.mouseDownPos && !this.mouseMoved) {
      const dx = Math.abs(pos.x - this.mouseDownPos.x);
      const dy = Math.abs(pos.y - this.mouseDownPos.y);
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > this.dragThreshold) {
        this.mouseMoved = true;
      }
    }
    
    // Handle dragging squid
    if (this.draggedSquid) {
      this.draggedSquid.targetX = pos.x - this.dragOffset.x;
      this.draggedSquid.targetY = pos.y - this.dragOffset.y;
      this.aquarium.canvas.style.cursor = 'grabbing';
      
      // Live highlight HTML temple card we're hovering over
      if (typeof ProjectsPanel !== 'undefined') {
        document.querySelectorAll('.temple-card.squid-drop-target').forEach(c => c.classList.remove('squid-drop-target'));
        const card = ProjectsPanel.findCardAtPoint(e.pageX, e.pageY);
        if (card) {
          ProjectsPanel.highlightDropTarget(card.projectName, true);
        }
      }
      return;
    }
    
    // Handle dragging Poseidon
    if (this.draggedPoseidon) {
      this.draggedPoseidon.x = pos.x - this.dragOffset.x;
      this.draggedPoseidon.y = pos.y - this.dragOffset.y;
      this.aquarium.canvas.style.cursor = 'grabbing';
      return;
    }
    
    // Handle hovering
    const result = this.findEntityAt(pos.x, pos.y);
    
    if (result) {
      // Hovering over something
      if (result.type === 'poseidon') {
        poseidon.hovered = true;
        this.aquarium.canvas.style.cursor = 'pointer';
      } else if (result.type === 'temple') {
        const temple = result.entity;
        temple.hovered = true;
        this.aquarium.canvas.style.cursor = 'pointer';
      } else if (result.type === 'squid') {
        const squid = result.entity;
        
        // Clear previous hover
        if (this.hoveredSquid && this.hoveredSquid !== squid) {
          this.hoveredSquid.isHovered = false;
          if (this.hoveredSquid.hideThoughtBubble) {
            this.hoveredSquid.hideThoughtBubble();
          }
        }
        
        // Set new hover
        squid.isHovered = true;
        this.hoveredSquid = squid;
        
        // Show thought bubble
        if (squid.showThoughtBubble) {
          squid.showThoughtBubble();
        }
        
        this.aquarium.canvas.style.cursor = 'grab';
      }
    } else {
      // Not hovering over anything
      if (poseidon) {
        poseidon.hovered = false;
      }
      
      // Clear temple hovers
      if (this.aquarium.templeManager) {
        this.aquarium.templeManager.temples.forEach(t => t.hovered = false);
      }
      
      if (this.hoveredSquid) {
        this.hoveredSquid.isHovered = false;
        if (this.hoveredSquid.hideThoughtBubble) {
          this.hoveredSquid.hideThoughtBubble();
        }
        this.hoveredSquid = null;
      }
      
      this.aquarium.canvas.style.cursor = 'default';
    }
  }

  /**
   * Handle mouse down
   */
  handleMouseDown(e) {
    if (e.button !== 0) return; // Only left click
    
    const pos = this.getMousePos(e);
    this.mouseDownPos = { x: pos.x, y: pos.y };
    this.mouseMoved = false;
    
    const result = this.findEntityAt(pos.x, pos.y);
    
    if (result && result.type === 'squid') {
      const squid = result.entity;
      
      // Prepare for potential drag
      this.draggedSquid = squid;
      this.dragOffset.x = pos.x - squid.x;
      this.dragOffset.y = pos.y - squid.y;
      
      e.preventDefault();
    } else if (result && result.type === 'poseidon') {
      // Prepare to drag Poseidon
      this.draggedPoseidon = result.entity;
      this.dragOffset.x = pos.x - result.entity.x;
      this.dragOffset.y = pos.y - result.entity.y;
      
      e.preventDefault();
    }
  }

  /**
   * Animate squid entering a temple: shrink + glide in + hide.
   * Visible again when the temple is opened (or squid reassigned out).
   */
  _animateSquidEnterTemple(squid, temple) {
    const startScale = squid.baseSize || 1.0;
    const startX = squid.x;
    const startY = squid.y;
    const targetX = temple.x;
    const targetY = temple.y;
    const duration = 700;
    const start = Date.now();
    
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      
      squid.x = startX + (targetX - startX) * eased;
      squid.y = startY + (targetY - startY) * eased;
      squid.targetX = squid.x;
      squid.targetY = squid.y;
      squid.baseSize = startScale * (1 - eased * 0.85);
      squid.alpha = 1 - eased;
      
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        squid.insideTemple = temple.name;
        squid.alpha = 0;
        squid.baseSize = startScale;
      }
    };
    requestAnimationFrame(step);
  }
  
  /**
   * Persist a squid-to-project assignment via V2 API.
   * Updates project_registry.metadata.assigned_agents.
   */
  async _persistSquidAssignment(squid, projectId, projectName) {
    if (!projectId || !window.ApiV2) return;
    try {
      // Get current assigned_agents
      const r = await window.ApiV2._fetch('/projects');
      const project = r.registry.projects[projectId];
      if (!project) return;
      const assigned = project.assigned_agents || [];
      const agentRef = squid.agent_id || squid.id;
      if (assigned.includes(agentRef)) return; // already there
      assigned.push(agentRef);
      
      await window.ApiV2._fetch('/field', {
        method: 'PATCH',
        body: JSON.stringify({
          filePath: 'projects/project_registry.json',
          fieldPath: `projects.${projectId}.assigned_agents`,
          newValue: assigned,
          reason: 'squid dragged onto temple card'
        })
      });
    } catch (err) {
      console.warn('[Drop] persist assignment failed:', err.message);
    }
  }
  
  /**
   * Handle mouse up
   */
  handleMouseUp(e) {
    if (e.button !== 0) return; // Only left click
    
    const pos = this.getMousePos(e);
    
    
    // Check for click (not drag) - mouse must NOT have moved
    const wasDragging = this.mouseMoved;
    
    
    if (this.draggedSquid) {
      if (wasDragging) {
        const squid = this.draggedSquid;
        let assigned = false;
        
        // NEW: check if dropped on an HTML temple card in projects-container
        if (typeof ProjectsPanel !== 'undefined') {
          const card = ProjectsPanel.findCardAtPoint(e.pageX, e.pageY);
          if (card) {
            squid.currentProject = card.projectName;
            console.log(`[OK] Assigned ${squid.name} to ${card.projectName} (HTML card)`);
            
            // Create a virtual temple object pointing at the card position
            // so the entry animation glides toward the card center
            const fakeTemple = {
              name: card.projectName,
              x: card.rect.left + card.rect.width / 2 - this.aquarium.canvas.getBoundingClientRect().left,
              y: card.rect.top + card.rect.height / 2 - this.aquarium.canvas.getBoundingClientRect().top
            };
            this._animateSquidEnterTemple(squid, fakeTemple);
            
            // Persist assignment in V2 registries via API (best-effort)
            this._persistSquidAssignment(squid, card.projectId, card.projectName);
            
            if (window.ui?.addLog) window.ui.addLog('squid_assigned', `Assigned ${squid.name} to ${card.projectName}`);
            assigned = true;
            
            // Refresh projects panel to show new agent count
            setTimeout(() => ProjectsPanel.refresh(), 800);
          }
        }
        
        // LEGACY: also check canvas temple (in case temples-on-canvas is re-enabled)
        if (!assigned) {
          const templeAtDrop = this.findEntityAt(pos.x, pos.y);
          if (templeAtDrop && templeAtDrop.type === 'temple') {
            const temple = templeAtDrop.entity;
            if (!temple.assignedSquids) temple.assignedSquids = [];
            if (!temple.assignedSquids.includes(squid.id)) {
              temple.assignedSquids.push(squid.id);
              squid.currentProject = temple.name;
              this._animateSquidEnterTemple(squid, temple);
              if (window.ui?.addLog) window.ui.addLog('squid_assigned', `Assigned ${squid.name} to ${temple.name}`);
            }
          }
        }
      }
      
      // Reset squid drag state
      this.draggedSquid.isDragging = false;
      this.draggedSquid = null;
      this.aquarium.canvas.style.cursor = 'default';
    }
    
    // Reset Poseidon drag
    if (this.draggedPoseidon) {
      this.draggedPoseidon = null;
      this.aquarium.canvas.style.cursor = 'default';
    }
    
    // Reset tracking
    this.mouseDownPos = null;
    this.mouseMoved = false;
    
    // Handle click (if NOT dragging)
    if (!wasDragging) {
      const result = this.findEntityAt(pos.x, pos.y);
      
      
      if (result) {
        const now = Date.now();
        const isDoubleClick = (now - this.lastClickTime) < this.doubleClickDelay;
        this.lastClickTime = now;
        
        console.log('   Double click:', isDoubleClick);
        
        if (result.type === 'poseidon') {
          // Click on Poseidon
          console.log('   → Clicked Poseidon');
          if (poseidon.handleClick) {
            poseidon.handleClick();
          }
        } else if (result.type === 'temple') {
          // Click on Temple
          const temple = result.entity;
          console.log('   → Clicked Temple:', temple.name);
          if (temple.handleClick) {
            temple.handleClick();
          }
        } else if (result.type === 'squid') {
          const squid = result.entity;
          console.log('   → Clicked Squid:', squid.name);
          
          if (isDoubleClick) {
            // Double click - cancel pending single-click and run animation
            console.log('   → DOUBLE CLICK - Celebrate!');
            if (this.pendingSingleClick) {
              clearTimeout(this.pendingSingleClick);
              this.pendingSingleClick = null;
            }
            this.handleSquidDoubleClick(squid);
          } else {
            // Schedule single-click - may be canceled by a follow-up double-click
            if (this.pendingSingleClick) clearTimeout(this.pendingSingleClick);
            this.pendingSingleClick = setTimeout(() => {
              console.log('   → SINGLE CLICK - Show details');
              this.handleSquidClick(squid);
              this.pendingSingleClick = null;
            }, this.doubleClickDelay + 20);
          }
        }
      } else {
        
      }
    } else {
      
    }
  }

  /**
   * Handle context menu (right click)
   */
  handleContextMenu(e) {
    e.preventDefault();
    
    const pos = this.getMousePos(e);
    const result = this.findEntityAt(pos.x, pos.y);
    
    if (result && result.type === 'squid') {
      const squid = result.entity;
      
      // Show context menu
      if (typeof ui !== 'undefined') {
        ui.selectedSquid = squid;
        ui.showSquidContextMenu(squid, e.clientX, e.clientY);
      }
    }
  }

  /**
   * Handle mouse leave
   */
  handleMouseLeave() {
    // Clear all hovers
    if (poseidon) {
      poseidon.hovered = false;
    }
    
    if (this.hoveredSquid) {
      this.hoveredSquid.isHovered = false;
      if (this.hoveredSquid.hideThoughtBubble) {
        this.hoveredSquid.hideThoughtBubble();
      }
      this.hoveredSquid = null;
    }
    
    // End drag
    this.draggedSquid = null;
    
    this.aquarium.canvas.style.cursor = 'default';
  }

  /**
   * Handle single click on squid
   */
  handleSquidClick(squid) {
    console.log('[SQUID] CLICKED SQUID:', squid.name);
    
    // Bounce visual feedback
    const originalY = squid.targetY;
    squid.targetY = originalY - 30;
    setTimeout(() => { squid.targetY = originalY; }, 300);
    
    // Prefer V2 AgentForm if the squid has a registered agent_id
    const agentId = squid.agent_id || squid.agentId;
    if (agentId && typeof AgentForm !== 'undefined') {
      AgentForm.open(agentId).catch(err => {
        console.warn('[SQUID] AgentForm failed, falling back:', err.message);
        if (window.ui?.openSquidDetailModal) window.ui.openSquidDetailModal(squid);
      });
      return;
    }
    
    // Fall back to legacy detail modal
    if (typeof window.ui !== 'undefined' && window.ui.openSquidDetailModal) {
      window.ui.openSquidDetailModal(squid);
    } else {
      console.error('   [ERROR] UI not loaded yet - check script order in index.html');
    }
  }

  /**
   * Handle double click on squid
   */
  handleSquidDoubleClick(squid) {
    console.log('🎉 Double clicked squid:', squid.name);
    
    // Cycle through fun animations
    const animations = ['celebrate', 'loop', 'figure8', 'spin', 'jump'];
    const randomAnim = animations[Math.floor(Math.random() * animations.length)];
    
    console.log(`   → Playing animation: ${randomAnim}`);
    
    switch(randomAnim) {
      case 'celebrate':
        if (squid.celebrate) squid.celebrate();
        break;
        
      case 'loop':
        // Move in a looping circle
        this.animateLoop(squid);
        break;
        
      case 'figure8':
        // Move in figure-8 pattern
        this.animateFigure8(squid);
        break;
        
      case 'spin':
        // Spin in place
        this.animateSpin(squid);
        break;
        
      case 'jump':
        // Multiple jumps
        this.animateMultiJump(squid);
        break;
    }
  }
  
  animateLoop(squid) {
    const startX = squid.x;
    const startY = squid.y;
    const radius = 80;
    let angle = 0;
    
    const loopInterval = setInterval(() => {
      angle += 0.1;
      squid.targetX = startX + Math.cos(angle) * radius;
      squid.targetY = startY + Math.sin(angle) * radius;
      
      if (angle >= Math.PI * 2) {
        clearInterval(loopInterval);
        squid.targetX = startX;
        squid.targetY = startY;
      }
    }, 30);
  }
  
  animateFigure8(squid) {
    const startX = squid.x;
    const startY = squid.y;
    const width = 100;
    const height = 60;
    let t = 0;
    
    const fig8Interval = setInterval(() => {
      t += 0.05;
      squid.targetX = startX + Math.sin(t) * width;
      squid.targetY = startY + Math.sin(t * 2) * height;
      
      if (t >= Math.PI * 2) {
        clearInterval(fig8Interval);
        squid.targetX = startX;
        squid.targetY = startY;
      }
    }, 30);
  }
  
  animateSpin(squid) {
    let spins = 0;
    const spinInterval = setInterval(() => {
      squid.direction = (squid.direction + 15) % 360;
      spins++;
      
      if (spins >= 24) { // 360 degrees
        clearInterval(spinInterval);
      }
    }, 30);
  }
  
  animateMultiJump(squid) {
    let jumps = 0;
    const originalY = squid.targetY;
    
    const jumpInterval = setInterval(() => {
      if (jumps % 2 === 0) {
        squid.targetY = originalY - 50;
      } else {
        squid.targetY = originalY;
        jumps++;
      }
      
      if (jumps >= 6) { // 3 jumps
        clearInterval(jumpInterval);
        squid.targetY = originalY;
      }
    }, 200);
  }

  /**
   * Handle context menu (right-click)
   */
  handleContextMenu(e) {
    e.preventDefault();
    
    const pos = this.getMousePos(e);
    const result = this.findEntityAt(pos.x, pos.y);
    
    if (result && result.type === 'temple') {
      const temple = result.entity;
      this.showTempleContextMenu(temple, pos.x, pos.y);
    }
  }
  
  /**
   * Show temple context menu
   */
  showTempleContextMenu(temple, x, y) {
    // Remove existing menu
    const existing = document.getElementById('temple-context-menu');
    if (existing) existing.remove();
    
    // Create context menu
    const menu = document.createElement('div');
    menu.id = 'temple-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      background: var(--ocean-deep);
      border: 2px solid var(--border);
      border-radius: 4px;
      padding: 8px;
      z-index: 10000;
      box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    `;
    
    menu.innerHTML = `
      <div style="font-size: 10px; color: var(--accent); margin-bottom: 8px;">${temple.name}</div>
      <button onclick="SquidInteractionSystem.customizeTempleAppearance('${temple.name}')" style="width: 100%; padding: 6px; margin: 2px 0; font-size: 9px; background: var(--accent); color: black; border: none; cursor: pointer;">
        Color &amp; Shape
      </button>
      <button onclick="TempleInterior.open('${temple.name}')" style="width: 100%; padding: 6px; margin: 2px 0; font-size: 9px; background: var(--success); color: black; border: none; cursor: pointer;">
        Enter Temple
      </button>
    `;
    
    document.body.appendChild(menu);
    
    // Close on click outside
    setTimeout(() => {
      document.addEventListener('click', function closeMenu() {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }, { once: true });
    }, 100);
  }
  
  /**
   * Customize temple colors
   */
  /**
   * Open V2 JSON editor for the project this temple represents
   */
  static openProjectEditor(templeName) {
    const PROJECT_MAP = {
      'AQUARIUM': 1,
      'TRADING': 2,
      'BRAIN': 3,
      'NEWSROOM': 4
    };
    const projectNum = PROJECT_MAP[templeName.toUpperCase()];
    if (!projectNum) {
      alert(`No V2 project mapping for temple: ${templeName}`);
      return;
    }
    if (typeof EditorBrowser !== 'undefined') {
      EditorBrowser.openProject(projectNum);
    } else {
      alert('EditorBrowser not loaded yet');
    }
  }

  static async customizeTempleAppearance(templeName) {
    // First, try to get current values from V2 project registry (source of truth)
    let currentOutside = '#457B9D';
    let currentInside = '#1D3557';
    let currentShape = 'classic';
    let temple = null;
    
    try {
      const r = await window.ApiV2._fetch('/projects');
      const project = Object.values(r.registry.projects).find(p => p.name === templeName);
      if (project) {
        if (project.colors) {
          currentOutside = project.colors.outside || currentOutside;
          currentInside = project.colors.inside || currentInside;
        }
        if (project.temple_shape) currentShape = project.temple_shape;
      }
    } catch {}
    
    // Also check canvas temple for legacy fallback
    temple = (window.aquarium?.temples || []).find(t => t.name === templeName);
    if (temple && !currentOutside) {
      currentOutside = temple.colors?.outside || currentOutside;
      currentInside = temple.colors?.inside || currentInside;
      currentShape = temple.shape || currentShape;
    }
    
    const modal = document.createElement('div');
    modal.className = 'modal temple-appearance-modal';
    modal.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:480px;">
        <div class="modal-header">
          <h2>${templeName}: Color &amp; Shape</h2>
          <button class="btn-close" onclick="this.closest('.modal').remove()">x</button>
        </div>
        <div class="modal-body" style="padding:16px;">
          <div class="agent-form-row"><label>Outside color</label>
            <div class="agent-form-color-wrap">
              <input id="t-outside" type="color" value="${currentOutside}">
              <input id="t-outside-text" type="text" value="${currentOutside}">
            </div>
          </div>
          <div class="agent-form-row"><label>Inside color</label>
            <div class="agent-form-color-wrap">
              <input id="t-inside" type="color" value="${currentInside}">
              <input id="t-inside-text" type="text" value="${currentInside}">
            </div>
          </div>
          <div class="agent-form-row"><label>Shape</label>
            <select id="t-shape">
              <option value="classic" ${currentShape==='classic'?'selected':''}>Classic Greek</option>
              <option value="round" ${currentShape==='round'?'selected':''}>Round Dome</option>
              <option value="tall" ${currentShape==='tall'?'selected':''}>Tall Tower</option>
              <option value="wide" ${currentShape==='wide'?'selected':''}>Wide Pavilion</option>
              <option value="pyramid" ${currentShape==='pyramid'?'selected':''}>Pyramid</option>
            </select>
          </div>
        </div>
        <div class="agent-form-footer">
          <span id="t-status" class="agent-form-status"></span>
          <button class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
          <button class="btn-primary" id="t-save">Apply</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Wire color picker <-> text input sync
    const oPick = modal.querySelector('#t-outside');
    const oText = modal.querySelector('#t-outside-text');
    const iPick = modal.querySelector('#t-inside');
    const iText = modal.querySelector('#t-inside-text');
    oPick.addEventListener('input', () => oText.value = oPick.value);
    oText.addEventListener('input', () => { if (/^#[0-9A-Fa-f]{6}$/.test(oText.value)) oPick.value = oText.value; });
    iPick.addEventListener('input', () => iText.value = iPick.value);
    iText.addEventListener('input', () => { if (/^#[0-9A-Fa-f]{6}$/.test(iText.value)) iPick.value = iText.value; });
    
    modal.querySelector('#t-save').addEventListener('click', async () => {
      const status = modal.querySelector('#t-status');
      const outside = oText.value;
      const inside = iText.value;
      const shape = modal.querySelector('#t-shape').value;
      try {
        status.textContent = 'Saving...';
        
        // 1. Save to project_memory.json (legacy compat)
        await fetch(`/api/projects/${templeName}/colors`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outside, inside })
        }).catch(() => {/* memory file might not exist for new projects */});
        
        // 2. Find project_id in registry from name
        const regRes = await window.ApiV2._fetch('/projects');
        const project = Object.values(regRes.registry.projects).find(p => p.name === templeName);
        if (!project) throw new Error(`Project not found in registry: ${templeName}`);
        
        // 3. Save BOTH colors and temple_shape to PROJECT_REGISTRY entry
        //    (this is where ProjectsPanel reads from)
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: 'projects/project_registry.json',
            fieldPath: `projects.${project.project_id}.colors`,
            newValue: { outside, inside },
            reason: 'temple appearance edit'
          })
        });
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: 'projects/project_registry.json',
            fieldPath: `projects.${project.project_id}.temple_shape`,
            newValue: shape,
            reason: 'temple appearance edit'
          })
        });
        
        // 4. Refresh the HTML projects panel so cards re-render with new look
        if (typeof ProjectsPanel !== 'undefined') {
          await ProjectsPanel.refresh();
        }
        // 5. Update canvas temple too (if still used elsewhere)
        if (temple) {
          temple.colors = { outside, inside };
          temple.shape = shape;
        }
        
        status.textContent = 'Applied';
        status.className = 'agent-form-status success';
        setTimeout(() => modal.remove(), 700);
      } catch (err) {
        status.textContent = 'Failed: ' + err.message;
        status.className = 'agent-form-status error';
      }
    });
  }
  
  static customizeTempleColors(templeName) {
    // Legacy alias - redirect
    return this.customizeTempleAppearance(templeName);
  }
}

// Enable context menu
window.SquidInteractionSystem = SquidInteractionSystem;

console.log('[OK] Temple context menu enabled');
