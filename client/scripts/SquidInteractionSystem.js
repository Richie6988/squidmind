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
    
    // Mouse move (hover)
    canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    
    // Mouse down (start drag)
    canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    
    // Mouse up (end drag, click)
    canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    
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
   * Handle mouse up
   */
  handleMouseUp(e) {
    if (e.button !== 0) return; // Only left click
    
    const pos = this.getMousePos(e);
    
    
    // Check for click (not drag) - mouse must NOT have moved
    const wasDragging = this.mouseMoved;
    
    
    if (this.draggedSquid) {
      if (wasDragging) {
        // Check if dropped on a temple for assignment
        const templeAtDrop = this.findEntityAt(pos.x, pos.y);
        if (templeAtDrop && templeAtDrop.type === 'temple') {
          const squid = this.draggedSquid;
          const temple = templeAtDrop.entity;
          
          // Assign squid to temple
          if (!temple.assignedSquids) {
            temple.assignedSquids = [];
          }
          
          if (!temple.assignedSquids.includes(squid.id)) {
            temple.assignedSquids.push(squid.id);
            console.log(`[OK] Assigned ${squid.name} to ${temple.name} temple`);
            
            // Visual feedback - move squid inside temple
            squid.x = temple.x;
            squid.y = temple.y;
            squid.targetX = temple.x;
            squid.targetY = temple.y;
            
            // Log the assignment
            if (window.ui && window.ui.addLog) {
              window.ui.addLog('squid_assigned', `Assigned ${squid.name} to ${temple.name}`);
            }
          } else {
            console.log(`[INFO] ${squid.name} already assigned to ${temple.name}`);
          }
        }
      }
      
      // Reset squid drag state completely
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
            // Double click - quick action
            console.log('   → DOUBLE CLICK - Celebrate!');
            this.handleSquidDoubleClick(squid);
          } else {
            // Single click - show details
            console.log('   → SINGLE CLICK - Show details');
            this.handleSquidClick(squid);
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
    console.log('   Opening detail panel...');
    
    // Visual feedback - bounce animation
    const originalY = squid.targetY;
    const bounceHeight = 30;
    const bounceSpeed = 0.3;
    
    // Bounce up
    squid.targetY = originalY - bounceHeight;
    setTimeout(() => {
      // Bounce down
      squid.targetY = originalY;
    }, bounceSpeed * 1000);
    
    // Show details in CENTER MODAL!
    if (typeof window.ui !== 'undefined') {
      window.ui.openSquidDetailModal(squid); // Center modal!
      console.log('   [OK] Detail modal opened!');
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
      <button onclick="SquidInteractionSystem.openProjectEditor('${temple.name}')" style="width: 100%; padding: 6px; margin: 2px 0; font-size: 9px; background: var(--success); color: black; border: none; cursor: pointer;">
        Edit Project (V2 JSON)
      </button>
      <button onclick="SquidInteractionSystem.customizeTempleColors('${temple.name}')" style="width: 100%; padding: 6px; margin: 2px 0; font-size: 9px; background: var(--accent); color: black; border: none; cursor: pointer;">
        Quick: Colors only
      </button>
      <button onclick="TempleInterior.open('${temple.name}')" style="width: 100%; padding: 6px; margin: 2px 0; font-size: 9px; background: var(--ocean-mid); color: white; border: 1px solid var(--border); cursor: pointer;">
        [TEMPLE] Enter Temple
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

  static customizeTempleColors(templeName) {
    const outsideColor = prompt('Temple outside color (hex):', '#457B9D');
    if (!outsideColor) return;
    
    const insideColor = prompt('Temple inside color (hex):', '#1D3557');
    if (!insideColor) return;
    
    // Update backend
    fetch(`/api/projects/${templeName}/colors`, {
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
        alert(`[OK] Temple colors updated!`);
        // Reload temples
        if (window.aquarium && window.aquarium.loadTemples) {
          window.aquarium.loadTemples();
        }
      } else {
        alert('[ERROR] Failed: ' + data.error);
      }
    })
    .catch(error => alert('[ERROR] Error: ' + error.message));
  }
}

// Enable context menu
window.SquidInteractionSystem = SquidInteractionSystem;

console.log('[OK] Temple context menu enabled');
