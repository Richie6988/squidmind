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
   * Find entity at position (Poseidon or Squid)
   */
  findEntityAt(x, y) {
    // Check Poseidon first (he's special)
    if (poseidon && poseidon.visible && poseidon.isPointOver(x, y)) {
      return { type: 'poseidon', entity: poseidon };
    }
    
    // Check squids
    for (const squid of this.aquarium.squids) {
      if (squid.isPointOver && squid.isPointOver(x, y)) {
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
    
    // Handle dragging
    if (this.draggedSquid) {
      this.draggedSquid.targetX = pos.x - this.dragOffset.x;
      this.draggedSquid.targetY = pos.y - this.dragOffset.y;
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
    const result = this.findEntityAt(pos.x, pos.y);
    
    if (result && result.type === 'squid') {
      const squid = result.entity;
      
      // Start dragging
      this.draggedSquid = squid;
      this.dragOffset.x = pos.x - squid.x;
      this.dragOffset.y = pos.y - squid.y;
      
      this.aquarium.canvas.style.cursor = 'grabbing';
      
      e.preventDefault();
    }
  }

  /**
   * Handle mouse up
   */
  handleMouseUp(e) {
    if (e.button !== 0) return; // Only left click
    
    const pos = this.getMousePos(e);
    
    // Check for click (not drag)
    const wasDragging = this.draggedSquid !== null;
    
    if (this.draggedSquid) {
      // End drag
      this.draggedSquid = null;
      this.aquarium.canvas.style.cursor = 'grab';
    }
    
    // Handle click (if not dragging)
    if (!wasDragging) {
      const result = this.findEntityAt(pos.x, pos.y);
      
      if (result) {
        const now = Date.now();
        const isDoubleClick = (now - this.lastClickTime) < this.doubleClickDelay;
        this.lastClickTime = now;
        
        if (result.type === 'poseidon') {
          // Click on Poseidon
          if (poseidon.handleClick) {
            poseidon.handleClick();
          }
        } else if (result.type === 'squid') {
          const squid = result.entity;
          
          if (isDoubleClick) {
            // Double click - quick action
            this.handleSquidDoubleClick(squid);
          } else {
            // Single click - show details
            this.handleSquidClick(squid);
          }
        }
      }
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
    console.log('Clicked squid:', squid.name);
    
    // Show details panel
    if (typeof ui !== 'undefined') {
      ui.currentSquid = squid;
      ui.showPanel('detail');
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
