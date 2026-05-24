/**
 * Panel Resize System - PRODUCTION LEVEL
 * Allows dragging panel edges to resize
 */

const PanelResize = {
  activePanel: null,
  resizeHandle: null,
  startX: 0,
  startY: 0,
  startWidth: 0,
  startHeight: 0,
  
  /**
   * Initialize resize handlers for all panels
   */
  init() {
    console.log('🔧 Initializing panel resize system...');
    
    // Add resize handles to all panels
    const panels = document.querySelectorAll('.panel:not(#clear-all-panel)');
    panels.forEach(panel => this.addResizeHandles(panel));
    
    console.log(`✅ Added resize handles to ${panels.length} panels`);
  },
  
  /**
   * Add resize handles to a panel
   */
  addResizeHandles(panel) {
    // Create resize handles for all edges
    const handles = [
      { class: 'resize-handle-e', cursor: 'ew-resize', edge: 'right' },
      { class: 'resize-handle-s', cursor: 'ns-resize', edge: 'bottom' },
      { class: 'resize-handle-se', cursor: 'nwse-resize', edge: 'corner' }
    ];
    
    handles.forEach(h => {
      const handle = document.createElement('div');
      handle.className = `resize-handle ${h.class}`;
      handle.style.cursor = h.cursor;
      handle.dataset.edge = h.edge;
      
      handle.addEventListener('mousedown', (e) => this.startResize(e, panel, h.edge));
      
      panel.appendChild(handle);
    });
  },
  
  /**
   * Start resizing
   */
  startResize(e, panel, edge) {
    e.preventDefault();
    e.stopPropagation();
    
    this.activePanel = panel;
    this.edge = edge;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startWidth = panel.offsetWidth;
    this.startHeight = panel.offsetHeight;
    
    // Add global listeners
    document.addEventListener('mousemove', this.handleResize);
    document.addEventListener('mouseup', this.stopResize);
    
    // Visual feedback
    document.body.style.cursor = e.target.style.cursor;
    panel.classList.add('resizing');
  },
  
  /**
   * Handle resize dragging
   */
  handleResize: function(e) {
    if (!PanelResize.activePanel) return;
    
    const dx = e.clientX - PanelResize.startX;
    const dy = e.clientY - PanelResize.startY;
    
    const panel = PanelResize.activePanel;
    const edge = PanelResize.edge;
    
    // Calculate new dimensions
    let newWidth = PanelResize.startWidth;
    let newHeight = PanelResize.startHeight;
    
    if (edge === 'right' || edge === 'corner') {
      newWidth = Math.max(250, PanelResize.startWidth + dx);
    }
    
    if (edge === 'bottom' || edge === 'corner') {
      newHeight = Math.max(200, PanelResize.startHeight + dy);
    }
    
    // Apply new dimensions
    panel.style.width = newWidth + 'px';
    panel.style.height = newHeight + 'px';
  },
  
  /**
   * Stop resizing
   */
  stopResize: function() {
    if (PanelResize.activePanel) {
      PanelResize.activePanel.classList.remove('resizing');
      PanelResize.activePanel = null;
    }
    
    document.body.style.cursor = '';
    document.removeEventListener('mousemove', PanelResize.handleResize);
    document.removeEventListener('mouseup', PanelResize.stopResize);
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => PanelResize.init());
} else {
  PanelResize.init();
}

// Export
window.PanelResize = PanelResize;
console.log('✅ PanelResize module loaded');
