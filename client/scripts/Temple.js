/**
 * Temple (Project Rock) System
 * 
 * Zelda-style project entrances in the aquarium
 * - Visual rock/temple structures
 * - Click to "enter" and see project state
 * - Shows agents working in project
 * - Displays project files and status
 */

class Temple {
  constructor(project) {
    this.project = project;
    this.id = project.id;
    this.name = project.name;
    
    // Visual properties
    this.x = 0;
    this.y = 0;
    this.width = 120;
    this.height = 140;
    this.hovered = false;
    
    // Animation
    this.glowIntensity = 0;
    this.floatOffset = Math.random() * Math.PI * 2;
    
    // Agent count inside
    this.agentCount = 0;
    this.activeAgents = [];
  }

  /**
   * Set position in aquarium
   */
  setPosition(x, y) {
    this.x = x;
    this.y = y;
  }

  /**
   * Update animation
   */
  update(deltaTime, agents) {
    this.floatOffset += deltaTime * 0.001;
    
    // Update glow based on hover
    if (this.hovered) {
      this.glowIntensity = Math.min(1, this.glowIntensity + 0.1);
    } else {
      this.glowIntensity = Math.max(0, this.glowIntensity - 0.05);
    }
    
    // Count agents working in this project
    this.activeAgents = agents.filter(a => 
      a.current_project === this.project.id || 
      a.current_project === this.project.name
    );
    this.agentCount = this.activeAgents.length;
  }

  /**
   * Draw temple in aquarium
   */
  draw(ctx) {
    ctx.save();
    
    const floatY = this.y + Math.sin(this.floatOffset) * 5;
    
    ctx.translate(this.x, floatY);
    
    // Glow effect when hovered
    if (this.glowIntensity > 0) {
      const glow = ctx.createRadialGradient(
        this.width / 2, this.height / 2, 0,
        this.width / 2, this.height / 2, this.width
      );
      glow.addColorStop(0, `rgba(100, 200, 255, ${this.glowIntensity * 0.3})`);
      glow.addColorStop(1, 'rgba(100, 200, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-20, -20, this.width + 40, this.height + 40);
    }
    
    // Draw temple structure
    this.drawTempleStructure(ctx);
    
    // Draw entrance portal
    this.drawPortal(ctx);
    
    // Draw agent indicators
    this.drawAgentIndicators(ctx);
    
    ctx.restore();
    
    // Draw name below temple
    ctx.fillStyle = this.hovered ? '#64C8FF' : '#888';
    ctx.font = '10px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText(this.name, this.x + this.width / 2, floatY + this.height + 20);
    
    // Draw agent count
    if (this.agentCount > 0) {
      ctx.fillStyle = '#06FFA5';
      ctx.font = '8px "Press Start 2P"';
      ctx.fillText(`${this.agentCount} 🦑`, this.x + this.width / 2, floatY + this.height + 35);
    }
  }

  /**
   * Draw temple structure (rock/building)
   */
  drawTempleStructure(ctx) {
    // Base rock
    ctx.fillStyle = '#4A5568';
    ctx.strokeStyle = '#2D3748';
    ctx.lineWidth = 3;
    
    // Main temple body
    ctx.beginPath();
    ctx.moveTo(this.width / 2, 0);
    ctx.lineTo(this.width - 10, this.height * 0.3);
    ctx.lineTo(this.width, this.height * 0.7);
    ctx.lineTo(this.width - 15, this.height);
    ctx.lineTo(15, this.height);
    ctx.lineTo(0, this.height * 0.7);
    ctx.lineTo(10, this.height * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Temple details (stones)
    ctx.strokeStyle = '#1A202C';
    ctx.lineWidth = 2;
    
    // Horizontal stone lines
    for (let i = 0; i < 4; i++) {
      const y = this.height * 0.3 + (i * this.height * 0.15);
      ctx.beginPath();
      ctx.moveTo(10 + i * 5, y);
      ctx.lineTo(this.width - 10 - i * 5, y);
      ctx.stroke();
    }
    
    // Top ornament (triangular peak)
    ctx.fillStyle = '#718096';
    ctx.beginPath();
    ctx.moveTo(this.width / 2, 0);
    ctx.lineTo(this.width / 2 - 15, 20);
    ctx.lineTo(this.width / 2 + 15, 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  /**
   * Draw entrance portal
   */
  drawPortal(ctx) {
    const portalX = this.width / 2;
    const portalY = this.height * 0.65;
    const portalWidth = 35;
    const portalHeight = 45;
    
    // Portal glow
    const glowAmount = 0.5 + Math.sin(this.floatOffset * 3) * 0.3;
    const portalGlow = ctx.createRadialGradient(
      portalX, portalY, 0,
      portalX, portalY, portalWidth
    );
    portalGlow.addColorStop(0, `rgba(100, 200, 255, ${glowAmount})`);
    portalGlow.addColorStop(1, 'rgba(50, 100, 150, 0.3)');
    
    ctx.fillStyle = portalGlow;
    ctx.beginPath();
    ctx.arc(portalX, portalY, portalWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Portal arch
    ctx.strokeStyle = '#2D3748';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(portalX, portalY + 10, portalWidth / 2, Math.PI, 0);
    ctx.lineTo(portalX + portalWidth / 2, portalY + portalHeight);
    ctx.lineTo(portalX - portalWidth / 2, portalY + portalHeight);
    ctx.closePath();
    ctx.stroke();
    
    // Portal swirl effect
    if (this.agentCount > 0) {
      ctx.save();
      ctx.translate(portalX, portalY);
      ctx.rotate(this.floatOffset * 2);
      
      ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)';
      ctx.lineWidth = 2;
      
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 5 + i * 5, 0, Math.PI * 1.5);
        ctx.stroke();
      }
      
      ctx.restore();
    }
  }

  /**
   * Draw agent indicators (squids inside)
   */
  drawAgentIndicators(ctx) {
    if (this.agentCount === 0) return;
    
    const startX = this.width / 2 - (this.agentCount * 8);
    const y = 15;
    
    for (let i = 0; i < Math.min(this.agentCount, 5); i++) {
      ctx.fillStyle = '#06FFA5';
      ctx.font = '12px Arial';
      ctx.fillText('🦑', startX + i * 16, y);
    }
    
    if (this.agentCount > 5) {
      ctx.fillStyle = '#888';
      ctx.font = '8px "Press Start 2P"';
      ctx.fillText(`+${this.agentCount - 5}`, startX + 80, y);
    }
  }

  /**
   * Check if point is over temple
   */
  isPointOver(x, y) {
    return x >= this.x && 
           x <= this.x + this.width && 
           y >= this.y && 
           y <= this.y + this.height;
  }

  /**
   * Handle click - enter the temple!
   */
  handleClick() {
    console.log('🏛️ Entering temple:', this.name);
    
    if (typeof ui !== 'undefined') {
      ui.enterTemple(this);
      
      // ALSO show temple interior background
      this.showTempleInterior();
    }
  }

  /**
   * Show temple interior (new background/scene)
   */
  showTempleInterior() {
    console.log('🚪 Opening temple interior:', this.name);
    
    // Create interior overlay
    let interior = document.getElementById('temple-interior');
    
    if (!interior) {
      interior = document.createElement('div');
      interior.id = 'temple-interior';
      interior.className = 'temple-interior';
      document.body.appendChild(interior);
    }
    
    // Set temple-specific background
    const backgrounds = {
      'BRAIN': 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      'AQUARIUM': 'linear-gradient(135deg, #13547a 0%, #80d0c7 100%)',
      'TRADING': 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
      'NEWSROOM': 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)'
    };
    
    interior.innerHTML = `
      <div class="interior-header">
        <h1>🏛️ ${this.name} TEMPLE</h1>
        <button onclick="document.getElementById('temple-interior').classList.add('hidden')">
          ✕ Exit Temple
        </button>
      </div>
      <div class="interior-content">
        <div class="interior-left">
          <h2>📦 Project Resources</h2>
          <div class="resource-list">
            ${(this.project.files || []).map(file => `
              <div class="resource-item" onclick="templeIDE.openFile('${file.name}', '${file.path}')">
                <span class="resource-icon">📄</span>
                <span class="resource-name">${file.name}</span>
                <span class="resource-size">${file.size}</span>
              </div>
            `).join('')}
          </div>
        </div>
        
        <div class="interior-center">
          <h2>💻 IDE Workspace</h2>
          <div class="ide-container">
            <div class="ide-editor">
              <div class="editor-header">
                <span id="editor-filename">No file open</span>
                <button onclick="templeIDE.saveFile()">💾 Save</button>
              </div>
              <textarea id="temple-editor" placeholder="// Open a file or create a new project..."></textarea>
            </div>
            <div class="ide-preview">
              <div class="preview-header">
                <span>Preview</span>
                <button onclick="templeIDE.refreshPreview()">🔄 Refresh</button>
              </div>
              <iframe id="temple-preview" sandbox="allow-scripts"></iframe>
            </div>
          </div>
          
          <h2>🦑 Working Agents</h2>
          <div class="agents-workspace">
            ${this.activeAgents.map(agent => `
              <div class="agent-avatar walking">
                <div class="avatar-squid">🦑</div>
                <div class="avatar-name">${agent.name}</div>
                <div class="avatar-status">${agent.status}</div>
              </div>
            `).join('') || '<p>No agents currently working</p>'}
          </div>
        </div>
        
        <div class="interior-right">
          <h2>📋 Active Tasks</h2>
          <div class="task-board">
            ${(this.project.tasks || []).map(task => `
              <div class="task-card ${task.status}">
                <span class="task-status">${task.status === 'complete' ? '✅' : task.status === 'working' ? '⚡' : '⏳'}</span>
                <span class="task-desc">${task.description}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    
    interior.style.background = backgrounds[this.name] || backgrounds['BRAIN'];
    interior.classList.remove('hidden');
    
    // Initialize walking animation for agents
    this.initWalkingAgents();
  }

  /**
   * Initialize walking animations for agents in temple
   */
  initWalkingAgents() {
    setTimeout(() => {
      const agents = document.querySelectorAll('.agent-avatar.walking');
      agents.forEach((agent, index) => {
        // Random walking animation
        const walkDuration = 5 + Math.random() * 3;
        const walkDelay = index * 0.5;
        
        agent.style.animation = `walk ${walkDuration}s linear ${walkDelay}s infinite`;
      });
    }, 100);
  }

  /**
   * Get project state for display
   */
  getState() {
    return {
      id: this.id,
      name: this.name,
      agentCount: this.agentCount,
      activeAgents: this.activeAgents,
      files: this.project.files || [],
      tasks: this.project.tasks || [],
      status: this.project.status || 'active'
    };
  }
}

/**
 * Temple Manager
 */
class TempleManager {
  constructor() {
    this.temples = [];
  }

  /**
   * Create temple from project
   */
  createTemple(project) {
    const temple = new Temple(project);
    this.temples.push(temple);
    return temple;
  }

  /**
   * Position temples in aquarium (grid layout)
   */
  arrangeTemples(canvasWidth, canvasHeight) {
    const spacing = 160;
    const startX = canvasWidth - 150;
    const startY = 100;
    
    this.temples.forEach((temple, i) => {
      const row = Math.floor(i / 3);
      const col = i % 3;
      
      temple.setPosition(
        startX - col * spacing,
        startY + row * 180
      );
    });
  }

  /**
   * Find temple at position
   */
  findTempleAt(x, y) {
    return this.temples.find(t => t.isPointOver(x, y));
  }

  /**
   * Update all temples
   */
  update(deltaTime, agents) {
    this.temples.forEach(temple => temple.update(deltaTime, agents));
  }

  /**
   * Draw all temples
   */
  draw(ctx) {
    this.temples.forEach(temple => temple.draw(ctx));
  }
}

// Make available globally
if (typeof window !== 'undefined') {
  window.Temple = Temple;
  window.TempleManager = TempleManager;
}
