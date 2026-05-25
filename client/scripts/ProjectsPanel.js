/**
 * ProjectsPanel - HTML-based project temple cards
 * 
 * Replaces the canvas-rendered temples. Each project from V2 registry
 * becomes a draggable card showing:
 *   - SVG temple at correct color and shape
 *   - Project name
 *   - Assigned agent count
 *   - Status
 * 
 * Features:
 *   - Drag-drop reorder (persisted to project_registry.metadata.display_order)
 *   - Drop target for squids (drag squid from canvas onto card -> assign)
 *   - Right-click -> Color & Shape modal (live updates the SVG)
 *   - Click -> open Temple Interior
 */

const ProjectsPanel = {
  projects: [],
  draggingProjectId: null,
  
  async refresh() {
    try {
      const res = await window.ApiV2._fetch('/projects');
      const projects = Object.values(res.registry.projects || {});
      // Sort by display_order if set, else by project_id
      this.projects = projects.sort((a, b) => 
        (a.display_order ?? 999) - (b.display_order ?? 999) ||
        (a.project_id || '').localeCompare(b.project_id || '')
      );
      this.render();
    } catch (err) {
      console.warn('[ProjectsPanel] refresh failed:', err.message);
      const list = document.getElementById('temple-cards-list');
      if (list) list.innerHTML = '<p class="hint" style="font-size:9px; padding:8px; color:var(--danger);">Failed: ' + this._esc(err.message) + '</p>';
    }
  },
  
  render() {
    const list = document.getElementById('temple-cards-list');
    if (!list) return;
    
    if (this.projects.length === 0) {
      list.innerHTML = '<p class="hint" style="font-size:9px; padding:8px; color:var(--text-secondary); text-align:center;">No projects yet. Click + New Project.</p>';
      return;
    }
    
    list.innerHTML = this.projects.map(p => this._renderCard(p)).join('');
    
    // Wire drag events
    list.querySelectorAll('.temple-card').forEach(card => {
      card.addEventListener('dragstart', e => this._onDragStart(e, card));
      card.addEventListener('dragover', e => this._onDragOver(e, card));
      card.addEventListener('drop', e => this._onDrop(e, card));
      card.addEventListener('dragend', e => this._onDragEnd(e, card));
      card.addEventListener('dragleave', e => card.classList.remove('drag-over'));
    });
  },
  
  _renderCard(p) {
    const colors = p.colors || { outside: '#457B9D', inside: '#1D3557' };
    const shape = p.temple_shape || 'classic';
    const agentCount = (p.assigned_agents || []).length;
    const tasksDone = p.metrics?.tasks_completed ?? 0;
    const tasksPending = p.metrics?.tasks_pending ?? 0;
    const completion = p.metrics?.completion_percent ?? 0;
    
    return `
      <div class="temple-card" 
           data-project-id="${this._esc(p.project_id)}"
           data-project-name="${this._esc(p.name)}"
           draggable="true">
        <div class="temple-card-svg-wrap" onclick="ProjectsPanel.enterTemple('${this._esc(p.name)}')">
          ${this._renderTempleSvg(shape, colors)}
        </div>
        <div class="temple-card-info">
          <div class="temple-card-name">${this._esc(p.name)}</div>
          <div class="temple-card-stats">
            ${agentCount} agent${agentCount === 1 ? '' : 's'} | ${tasksDone}/${tasksDone + tasksPending} tasks
          </div>
          ${completion > 0 ? `<div class="temple-card-progress"><div class="temple-card-progress-fill" style="width:${completion}%"></div></div>` : ''}
        </div>
        <div class="temple-card-actions">
          <button class="temple-card-btn" title="Color & Shape" onclick="event.stopPropagation(); ProjectsPanel.editAppearance('${this._esc(p.name)}')">edit</button>
        </div>
      </div>
    `;
  },
  
  /**
   * Render a small pixel-art temple SVG with given shape and colors.
   * 24x32 viewBox - small enough for card thumbnail.
   */
  _renderTempleSvg(shape, colors) {
    const outside = colors.outside || '#457B9D';
    const inside = colors.inside || '#1D3557';
    const darker = this._darken(outside, 0.7);
    
    const shapes = {
      // Classic Greek temple (pediment + 3 columns + base)
      classic: `
        <polygon points="12,2 4,8 20,8" fill="${outside}"/>
        <rect x="3" y="8" width="18" height="2" fill="${darker}"/>
        <rect x="4" y="10" width="2" height="14" fill="${outside}"/>
        <rect x="11" y="10" width="2" height="14" fill="${outside}"/>
        <rect x="18" y="10" width="2" height="14" fill="${outside}"/>
        <rect x="6" y="14" width="5" height="10" fill="${inside}"/>
        <rect x="13" y="14" width="5" height="10" fill="${inside}"/>
        <rect x="2" y="24" width="20" height="3" fill="${darker}"/>
        <rect x="1" y="27" width="22" height="2" fill="${outside}"/>
      `,
      // Round dome
      round: `
        <ellipse cx="12" cy="14" rx="10" ry="8" fill="${outside}"/>
        <ellipse cx="12" cy="14" rx="6" ry="5" fill="${inside}"/>
        <rect x="2" y="14" width="20" height="13" fill="${outside}"/>
        <rect x="9" y="18" width="6" height="9" fill="${inside}"/>
        <rect x="1" y="27" width="22" height="2" fill="${darker}"/>
        <circle cx="12" cy="4" r="1.5" fill="${darker}"/>
      `,
      // Tall tower
      tall: `
        <polygon points="12,1 7,5 17,5" fill="${darker}"/>
        <rect x="6" y="5" width="12" height="3" fill="${outside}"/>
        <rect x="7" y="8" width="10" height="18" fill="${outside}"/>
        <rect x="10" y="12" width="4" height="4" fill="${inside}"/>
        <rect x="10" y="18" width="4" height="6" fill="${inside}"/>
        <rect x="6" y="26" width="12" height="3" fill="${darker}"/>
      `,
      // Wide pavilion
      wide: `
        <polygon points="12,4 2,10 22,10" fill="${outside}"/>
        <rect x="1" y="10" width="22" height="2" fill="${darker}"/>
        <rect x="3" y="12" width="2" height="13" fill="${outside}"/>
        <rect x="19" y="12" width="2" height="13" fill="${outside}"/>
        <rect x="11" y="12" width="2" height="13" fill="${outside}"/>
        <rect x="5" y="16" width="6" height="9" fill="${inside}"/>
        <rect x="13" y="16" width="6" height="9" fill="${inside}"/>
        <rect x="1" y="25" width="22" height="4" fill="${darker}"/>
      `,
      // Pyramid
      pyramid: `
        <polygon points="12,2 3,26 21,26" fill="${outside}"/>
        <polygon points="12,2 21,26 17,26" fill="${darker}"/>
        <rect x="10" y="18" width="4" height="8" fill="${inside}"/>
        <rect x="1" y="26" width="22" height="3" fill="${darker}"/>
      `
    };
    
    const shapeBody = shapes[shape] || shapes.classic;
    
    return `<svg viewBox="0 0 24 30" class="temple-card-svg" shape-rendering="crispEdges">${shapeBody}</svg>`;
  },
  
  _darken(hex, factor) {
    const h = hex.replace('#', '');
    const r = Math.floor(parseInt(h.slice(0, 2), 16) * factor);
    const g = Math.floor(parseInt(h.slice(2, 4), 16) * factor);
    const b = Math.floor(parseInt(h.slice(4, 6), 16) * factor);
    return `#${[r, g, b].map(x => x.toString(16).padStart(2, '0')).join('')}`;
  },
  
  // === DRAG REORDER ===
  
  _onDragStart(e, card) {
    this.draggingProjectId = card.dataset.projectId;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', card.dataset.projectId);
  },
  
  _onDragOver(e, card) {
    if (this.draggingProjectId && this.draggingProjectId !== card.dataset.projectId) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    }
  },
  
  async _onDrop(e, card) {
    e.preventDefault();
    card.classList.remove('drag-over');
    const draggedId = this.draggingProjectId;
    const targetId = card.dataset.projectId;
    if (!draggedId || draggedId === targetId) return;
    
    // Reorder local array
    const draggedIdx = this.projects.findIndex(p => p.project_id === draggedId);
    const targetIdx = this.projects.findIndex(p => p.project_id === targetId);
    if (draggedIdx < 0 || targetIdx < 0) return;
    
    const [dragged] = this.projects.splice(draggedIdx, 1);
    this.projects.splice(targetIdx, 0, dragged);
    
    // Re-render immediately
    this.render();
    
    // Persist new order
    await this._persistOrder();
  },
  
  _onDragEnd(e, card) {
    card.classList.remove('dragging');
    this.draggingProjectId = null;
    document.querySelectorAll('.temple-card.drag-over').forEach(c => c.classList.remove('drag-over'));
  },
  
  async _persistOrder() {
    // Save display_order to each project's registry entry
    for (let i = 0; i < this.projects.length; i++) {
      const p = this.projects[i];
      try {
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: 'projects/project_registry.json',
            fieldPath: `projects.${p.project_id}.display_order`,
            newValue: i,
            reason: 'user reordered temples'
          })
        });
      } catch (err) {
        console.warn('[ProjectsPanel] persist order failed:', err.message);
      }
    }
  },
  
  // === ACTIONS ===
  
  enterTemple(projectName) {
    if (typeof TempleInterior !== 'undefined') {
      // Create a temple-like object for TempleInterior
      const p = this.projects.find(x => x.name === projectName);
      const fakeTemple = {
        name: projectName,
        project_id: p?.project_id,
        files: [],
        tasks: []
      };
      TempleInterior.open(fakeTemple);
    }
  },
  
  editAppearance(projectName) {
    if (typeof SquidInteractionSystem !== 'undefined') {
      SquidInteractionSystem.customizeTempleAppearance(projectName);
    }
  },
  
  /**
   * Called by SquidInteractionSystem after a successful squid drop on a temple card.
   * Currently the SVG card itself is the drop target via getBoundingClientRect.
   */
  highlightDropTarget(projectName, on = true) {
    const card = document.querySelector(`.temple-card[data-project-name="${projectName}"]`);
    if (card) card.classList.toggle('squid-drop-target', on);
  },
  
  /**
   * Find which temple card (if any) contains the given page coordinate.
   * Called by SquidInteractionSystem on mouseup to detect squid->temple assignment.
   */
  findCardAtPoint(pageX, pageY) {
    const cards = document.querySelectorAll('.temple-card');
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (pageX >= r.left && pageX <= r.right && pageY >= r.top && pageY <= r.bottom) {
        return {
          projectId: card.dataset.projectId,
          projectName: card.dataset.projectName,
          rect: r
        };
      }
    }
    return null;
  },
  
  _esc(s) {
    return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  }
};

// Auto-init
async function _initProjectsPanel() {
  await ProjectsPanel.refresh();
  // Refresh every 30s
  setInterval(() => ProjectsPanel.refresh(), 30000);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(_initProjectsPanel, 1200));
} else {
  setTimeout(_initProjectsPanel, 1200);
}

window.ProjectsPanel = ProjectsPanel;
console.log('[OK] ProjectsPanel loaded');
