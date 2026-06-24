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
    this.doubleClickDelay = 250;
    
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
    
    // Mouse up (end drag, click) - on canvas only
    canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    
    // Document-level listeners ONLY when mouse is outside canvas during drag
    // (prevents double-firing when mouseup happens on canvas)
    document.addEventListener('mousemove', (e) => {
      if (!this.draggedSquid) return;
      if (e.target === canvas) return; // canvas listener handles this
      this.handleMouseMove(e);
    });
    document.addEventListener('mouseup', (e) => {
      if (!this.draggedSquid) return;
      if (e.target === canvas) return; // canvas listener handles this
      this.handleMouseUp(e);
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
    
    // Temples are now HTML cards in projects-container (not canvas) -
    // squid drop detection happens via ProjectsPanel.findCardAtPoint in mouseup
    
    // Check squids
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
    
    // Handle dragging squid — set position directly (no lerp lag), clamp to canvas
    if (this.draggedSquid) {
      const squid  = this.draggedSquid;
      const canvas = this.aquarium.canvas;
      const sz     = 40 * (squid.baseSize || 1);
      const margin = sz + 4;
      const rawX   = pos.x - this.dragOffset.x;
      const rawY   = pos.y - this.dragOffset.y;
      const clampX = Math.max(margin, Math.min(canvas.width  - margin, rawX));
      const clampY = Math.max(margin, Math.min(canvas.height - margin, rawY));
      // Set position directly — no lerp, cursor tracks squid 1:1
      squid.x       = clampX;
      squid.y       = clampY;
      squid.targetX = clampX;
      squid.targetY = clampY;
      this.aquarium.canvas.style.cursor = 'grabbing';
      
      // Live highlight HTML temple card we're hovering over
      if (typeof ProjectsPanel !== 'undefined') {
        document.querySelectorAll('.temple-card.squid-drop-target').forEach(c => c.classList.remove('squid-drop-target'));
        const card = ProjectsPanel.findCardAtPoint(e.pageX, e.pageY);
        if (card) ProjectsPanel.highlightDropTarget(card.projectName, true);
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
        
        // Set new hover. Hovering also wakes a sleeping squid (registry-seeded
        // or auto-slept) so the user gets the halo + cursor feedback.
        squid.isHovered = true;
        if (squid.isSleeping || squid.status === 'sleeping') {
          squid.isSleeping = false;
          if (squid.status === 'sleeping') squid.status = 'idle';
        }
        squid.timeSinceActivity = 0;
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
      
      // Wake from sleep on interaction. Two flags can keep an agent sleeping:
      // - isSleeping (set by update() after inactivity)
      // - status === 'sleeping' (seeded from registry)
      // Clear BOTH so the agent actually starts swimming.
      if (squid.isSleeping || squid.status === 'sleeping') {
        squid.isSleeping = false;
        if (squid.status === 'sleeping') squid.status = 'idle';
        console.log(`[SQUID] ${squid.name} woke up`);
      }
      squid.idleAccumulated = 0;
      squid.lastInteractedAt = Date.now();
      squid.timeSinceActivity = 0;
      
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
   * Persist an agent-to-project assignment via V2 API.
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
    // Clear all hovers (canvas-relative)
    if (poseidon) poseidon.hovered = false;
    
    if (this.hoveredSquid) {
      this.hoveredSquid.isHovered = false;
      if (this.hoveredSquid.hideThoughtBubble) {
        this.hoveredSquid.hideThoughtBubble();
      }
      this.hoveredSquid = null;
    }
    
    // IMPORTANT: do NOT clear draggedSquid here. We want drag to continue
    // while mouse is over the projects panel so drop on temple cards works.
    // The document-level mouseup handler will clear it when drag actually ends.
    
    this.aquarium.canvas.style.cursor = 'default';
  }

  /**
   * Handle single click on squid
   */
  handleSquidClick(squid) {
    console.log('[SQUID] CLICKED SQUID:', squid.name, 'id=', squid.id);
    
    // Bounce visual feedback
    const originalY = squid.targetY;
    squid.targetY = originalY - 30;
    setTimeout(() => { squid.targetY = originalY; }, 300);
    
    // V2 AgentForm is the canonical edit UI. squid.id is the agent_id from registry.
    const agentId = squid.id || squid.agent_id || squid.agentId;
    if (agentId && typeof AgentForm !== 'undefined' && agentId.startsWith?.('agent_')) {
      AgentForm.open(agentId).catch(err => {
        console.warn('[SQUID] AgentForm failed:', err.message);
        // Don't fall back to legacy - that's the old broken UI
        alert('Could not open agent: ' + err.message);
      });
      return;
    }
    
    // Squid has a legacy ID (squid_TIMESTAMP) - it's an old V1 agent
    console.warn('[SQUID] Legacy agent id, cannot edit:', agentId);
    alert('This squid uses the old format and cannot be edited. Delete it and create a new one via "+ New Agent".');
  }

  /**
  /**
   * Handle double click on squid
   */
  handleSquidDoubleClick(squid) {
    if (squid._celebratingUntil && squid._celebratingUntil > Date.now()) return;
    squid._celebratingUntil = Date.now() + 3000;

    const startX = squid.x, startY = squid.y;
    const t0      = Date.now();
    const dur     = 2600;

    const step = () => {
      const t = (Date.now() - t0) / dur;
      if (t >= 1) {
        squid.targetX = startX; squid.targetY = startY;
        squid.jumpHeight = 0; squid.isJumping = false;
        squid._celebratingUntil = 0;
        return;
      }
      // 5 bounces, each one a bit lower
      const phase = (t * 5) % 1;
      const decay = Math.pow(1 - t, 0.6);
      squid.jumpHeight = Math.sin(phase * Math.PI) * 55 * decay;
      squid.isJumping  = true;
      // Tight spin-sway: body stays near start, quick left-right
      squid.x       = startX + Math.sin(t * Math.PI * 8) * 12;
      squid.targetX = squid.x;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    // Big confetti burst — 30 particles in a full 360° explosion
    const colors = ['#FF6B9D','#FFD700','#06FFA5','#4FACFE','#FF4757','#A855F7','#FFA500','#00E5FF','#FF69B4','#7DF9FF'];
    if (!squid._confetti) squid._confetti = [];
    const N = 30;
    for (let i = 0; i < N; i++) {
      // Fan upward: bias angle toward top hemisphere for visual drama
      const baseAngle = (i / N) * Math.PI * 2;
      const angle  = baseAngle + (Math.random() - 0.5) * 0.4;
      const spd    = 3.5 + Math.random() * 4.5;   // faster burst
      squid._confetti.push({
        x:  (Math.random() - 0.5) * 20,  // spread slightly around body center
        y: -10 - Math.random() * 15,      // start just above body top
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd - 4.5, // extra upward kick
        color: colors[i % colors.length],
        shape: i % 3,
        life: 1.0 + Math.random() * 0.3, // stagger fade-out
        size: 5 + Math.random() * 5,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.3
      });
    }
  }
  
  // Legacy animation methods kept as no-ops (removed jankiness)
  animateLoop(squid) {}
  animateFigure8(squid) {}
  animateSpin(squid) {}
  animateMultiJump(squid) {}
  
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
          <button class="btn-secondary t-delete-discrete" id="t-delete">🗑</button>
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

    // ── Delete project ──────────────────────────────────────────────────
    modal.querySelector('#t-delete').addEventListener('click', async () => {
      const status = modal.querySelector('#t-status');
      try {
        // Get project_id from registry
        const regRes = await window.ApiV2._fetch('/projects');
        const project = Object.values(regRes.registry.projects).find(p => p.name === templeName);
        if (!project) throw new Error('Project not found');

        const agentCount = (project.assigned_agents || []).length;

        if (!window.UndoManager) {
          const ok = await SquidModal.confirm(
            `Delete project "${templeName}"?` +
            (agentCount > 0 ? ` ${agentCount} assigned agent${agentCount > 1 ? 's' : ''} will be freed.` : '')
          );
          if (!ok) return;
          status.textContent = 'Deleting...';
          await window.ApiV2._fetch(`/projects/${project.project_id}`, { method: 'DELETE' });
          status.textContent = `Deleted. ${agentCount} agent${agentCount !== 1 ? 's' : ''} freed.`;
          status.className = 'agent-form-status success';
          if (typeof ProjectsPanel !== 'undefined') await ProjectsPanel.refresh();
          if (window.aquarium?.loadSquids) window.aquarium.loadSquids();
          setTimeout(() => modal.remove(), 900);
          return;
        }

        // Soft delete with 10s undo (projects are very destructive)
        modal.remove();
        if (typeof ProjectsPanel !== 'undefined') await ProjectsPanel.refresh();
        window.UndoManager.scheduleDelete({
          label: `Project "${templeName}"` + (agentCount > 0 ? ` (${agentCount} agent${agentCount > 1 ? 's' : ''} freed)` : ''),
          delay: 10000,
          onCommit: async () => {
            await window.ApiV2._fetch(`/projects/${project.project_id}`, { method: 'DELETE' });
            if (typeof ProjectsPanel !== 'undefined') await ProjectsPanel.refresh();
            if (window.aquarium?.loadSquids) await window.aquarium.loadSquids();
          },
          onCancel: async () => {
            if (typeof ProjectsPanel !== 'undefined') await ProjectsPanel.refresh();
          },
        });
        return;
      } catch (err) {
        status.textContent = 'Delete failed: ' + err.message;
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
