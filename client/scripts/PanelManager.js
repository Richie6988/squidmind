/**
 * Panel Manager - Handles panel ordering and display
 * NEWEST PANEL AT TOP OF LIST
 */

class PanelManager {
  constructor() {
    this.panelStack = [];
  }

  /**
   * Show panel and bring to top of stack
   */
  showAndBringToTop(panelId) {
    const panel = document.getElementById(`${panelId}-panel`);
    if (!panel) return;
    
    // Remove from current position in DOM
    const container = panel.parentElement;
    panel.remove();
    
    // Add to TOP (first child)
    container.insertBefore(panel, container.firstChild);
    
    // Show panel
    panel.classList.remove('hidden');
    
    console.log(`📌 Panel "${panelId}" moved to top of list`);
  }
}

// Global instance
const panelManager = new PanelManager();

if (typeof window !== 'undefined') {
  window.panelManager = panelManager;
}

console.log('📋 PanelManager loaded');
