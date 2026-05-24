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
        // console.log('   🚀 Mouse MOVED - starting drag'); // Removed verbose log
      }
    }
    
    // Handle dragging (as soon as draggedSquid is set, move it!)
    if (this.draggedSquid) {
      this.draggedSquid.targetX = pos.x - this.dragOffset.x;
      this.draggedSquid.targetY = pos.y - this.dragOffset.y;
      this.aquarium.canvas.style.cursor = 'grabbing';
      console.log(`🎯 Dragging ${this.draggedSquid.name} to (${this.draggedSquid.targetX.toFixed(0)}, ${this.draggedSquid.targetY.toFixed(0)})`);
      return; // Skip hover detection while dragging
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
      
      console.log(`🖱️ Mouse DOWN on squid: ${squid.name} at (${squid.x.toFixed(0)}, ${squid.y.toFixed(0)})`);
      
      // Prepare for potential drag (but don't commit yet)
      this.draggedSquid = squid;
      this.dragOffset.x = pos.x - squid.x;
      this.dragOffset.y = pos.y - squid.y;
      
      console.log(`   Ready to drag! Offset: (${this.dragOffset.x.toFixed(0)}, ${this.dragOffset.y.toFixed(0)})`);
      
      e.preventDefault();
    } else {
      console.log(`🖱️ Mouse DOWN on empty space`);
    }
  }

  /**
   * Handle mouse up
   */
  handleMouseUp(e) {
    if (e.button !== 0) return; // Only left click
    
    const pos = this.getMousePos(e);
    console.log('🖱️ Mouse UP at:', pos.x, pos.y);
    
    // Check for click (not drag) - mouse must NOT have moved
    const wasDragging = this.mouseMoved;
    console.log('   Was dragging:', wasDragging);
    
    if (this.draggedSquid) {
      if (wasDragging) {
        // End drag
        console.log('   Ending drag:', this.draggedSquid.name);
      }
      this.draggedSquid = null;
      this.aquarium.canvas.style.cursor = 'default';
    }
    
    // Reset tracking
    this.mouseDownPos = null;
    this.mouseMoved = false;
    
    // Handle click (if NOT dragging)
    if (!wasDragging) {
      const result = this.findEntityAt(pos.x, pos.y);
      console.log('   Entity at click:', result ? result.type : 'none');
      
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
        console.log('   → Clicked empty space');
      }
    } else {
      console.log('   → Was dragging, not a click');
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
    console.log('🦑 CLICKED SQUID:', squid.name);
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
      console.log('   ✅ Detail modal opened!');
    } else {
      console.error('   ❌ UI not loaded yet - check script order in index.html');
    }
  }

  /**
   * Handle double click on squid
   */
  handleSquidDoubleClick(squid) {
    console.log('Double clicked squid:', squid.name);
    
    // Quick action - celebrate!
    if (squid.celebrate) {
      squid.celebrate();
    }
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.SquidInteractionSystem = SquidInteractionSystem;
}
