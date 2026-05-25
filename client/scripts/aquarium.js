const aquarium = {
  canvas: null,
  ctx: null,
  squids: [],
  lastTime: 0,
  selectedSquid: null,
  interactionSystem: null,
  templeManager: null,

  async init() {
    this.canvas = document.getElementById('aquarium');
    this.ctx = this.canvas.getContext('2d');
    
    // Set canvas size
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Initialize Poseidon's position (only if not already set)
    if (typeof poseidon !== 'undefined') {
      if (!poseidon.x || !poseidon.y) {
        poseidon.setPosition(150, 120);
        console.log('[POSEIDON] Poseidon positioned in aquarium (initial)');
      } else {
        console.log('[POSEIDON] Poseidon position restored:', poseidon.x, poseidon.y);
      }
    }
    
    // Initialize Temple Manager
    if (typeof TempleManager !== 'undefined') {
      this.templeManager = new TempleManager();
      await this.loadTemples();
      console.log('[TEMPLE] Temples initialized');
    }
    
    // Initialize interaction system
    if (typeof SquidInteractionSystem !== 'undefined') {
      this.interactionSystem = new SquidInteractionSystem(this);
      console.log('[INTERACT] Interaction system initialized');
    }
    
    // Load agents and create squids
    await this.loadSquids();
    
    // Start animation loop
    this.animate();
    
    // Poll for updates every 2 seconds
    setInterval(() => this.updateSquidsStatus(), 2000);
    
    console.log('[OCEAN] Aquarium initialized');
  },

  async loadTemples() {
    // Clear existing temples (in case of re-load)
    this.templeManager.temples = [];
    
    // FIRST: try to load from real V2 project_registry.json
    let projects = [];
    try {
      const res = await fetch('/api/v2/projects');
      const data = await res.json();
      if (data.success && data.registry?.projects) {
        projects = Object.values(data.registry.projects).map(p => ({
          id: p.project_id,
          name: p.name,
          status: p.status || 'active',
          colors: p.colors || null,
          shape: p.temple_shape || 'classic',
          files: [],
          tasks: [],
          // Pass through useful fields
          project_id: p.project_id,
          assigned_agents: p.assigned_agents || [],
          metrics: p.metrics || {}
        }));
        console.log(`[TEMPLE] Loaded ${projects.length} projects from V2 registry`);
      }
    } catch (err) {
      console.warn('[TEMPLE] V2 project registry unavailable, using fallback:', err.message);
    }
    
    // FALLBACK: only if V2 failed
    if (projects.length === 0) {
      console.warn('[TEMPLE] Using hardcoded fallback (V2 registry empty or unreachable)');
      projects = this._fallbackProjects();
    }
    
    projects.forEach(project => {
      this.templeManager.createTemple(project);
    });
    
    this.templeManager.arrangeTemples(this.canvas.width, this.canvas.height);
    console.log(`[TEMPLE] Created ${projects.length} project temples: ${projects.map(p => p.name).join(', ')}`);
  },
  
  _fallbackProjects() {
    return [
      { 
        id: 'brain', 
        name: 'BRAIN', 
        status: 'active', 
        files: [
          { name: 'neural_network.py', size: '45KB' },
          { name: 'training_data.json', size: '2.3MB' }
        ], 
        tasks: [
          { description: 'Train model on new data', status: 'working' },
          { description: 'Optimize inference speed', status: 'pending' }
        ]
      },
      { 
        id: 'aquarium', 
        name: 'AQUARIUM', 
        status: 'active', 
        files: [
          { name: 'Squid.js', size: '12KB' },
          { name: 'aquarium.js', size: '8KB' }
        ], 
        tasks: [
          { description: 'Enhance squid AI', status: 'working' },
          { description: 'Add new animations', status: 'complete' }
        ]
      },
      { 
        id: 'trading', 
        name: 'TRADING', 
        status: 'active', 
        files: [
          { name: 'market_analyzer.py', size: '28KB' },
          { name: 'strategies.json', size: '156KB' }
        ], 
        tasks: [
          { description: 'Backtest new strategy', status: 'pending' },
          { description: 'Monitor live trades', status: 'working' }
        ]
      },
      { 
        id: 'newsroom', 
        name: 'NEWSROOM', 
        status: 'active', 
        files: [
          { name: 'news_scraper.js', size: '15KB' },
          { name: 'articles.db', size: '4.5MB' }
        ], 
        tasks: [
          { description: 'Aggregate latest news', status: 'working' },
          { description: 'Analyze sentiment', status: 'pending' }
        ]
      }
    ];
  },

  async updateSquidsStatus() {
    try {
      const response = await api.getAgents();
      
      if (response.success) {
        // Update existing squids with fresh data
        response.agents.forEach(agentData => {
          const squid = this.squids.find(s => s.id === agentData.id);
          if (squid) {
            squid.status = agentData.status;
            squid.current_thought = agentData.current_thought;
          }
        });
      }
    } catch (error) {
      console.error('Failed to update squid status:', error);
    }
  },

  resizeCanvas() {
    const wrapper = this.canvas.parentElement;
    this.canvas.width = wrapper.clientWidth;
    this.canvas.height = wrapper.clientHeight;
    
    console.log(`Canvas resized to ${this.canvas.width}x${this.canvas.height}`);
  },

  async loadSquids() {
    try {
      const response = await api.getAgents();
      
      if (response.success) {
        this.squids = response.agents.map(agent => {
          const squid = new Squid(agent, this.canvas);
          // Enhance with interactions
          if (typeof SquidInteractions !== 'undefined') {
            SquidInteractions.enhance(squid);
          }
          return squid;
        });
        console.log(`Loaded ${this.squids.length} squids`);
        
        // Update header count
        document.getElementById('agent-count').textContent = `${this.squids.length} Squids`;
      }
    } catch (error) {
      console.error('Failed to load squids:', error);
    }
  },

  addSquid(agentData) {
    const squid = new Squid(agentData, this.canvas);
    // Enhance with interactions
    if (typeof SquidInteractions !== 'undefined') {
      SquidInteractions.enhance(squid);
    }
    this.squids.push(squid);
    document.getElementById('agent-count').textContent = `${this.squids.length} Squids`;
    console.log(`Added squid: ${agentData.name}`);
  },

  removeSquid(agentId) {
    this.squids = this.squids.filter(s => s.id !== agentId);
    if (this.selectedSquid?.id === agentId) {
      this.selectedSquid = null;
    }
    document.getElementById('agent-count').textContent = `${this.squids.length} Squids`;
  },

  updateSquidStatus(agentId, status) {
    const squid = this.squids.find(s => s.id === agentId);
    if (squid) {
      squid.updateStatus(status);
    }
  },

  animate(currentTime = 0) {
    const deltaTime = currentTime - this.lastTime;
    this.lastTime = currentTime;
    
    // Clear canvas
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw ocean gradient background
    this.drawBackground();
    
    // Update and draw temples (background layer)
    if (this.templeManager) {
      this.templeManager.update(deltaTime, this.squids);
      this.templeManager.draw(this.ctx);
    }
    
    // Update and draw squids
    for (const squid of this.squids) {
      squid.update(deltaTime);
      squid.draw(this.ctx);
    }
    
    // Update and draw Poseidon (the mighty god!)
    if (typeof poseidon !== 'undefined' && poseidon.visible) {
      poseidon.update(deltaTime);
      poseidon.draw(this.ctx, this.canvas);
    }
    
    // Continue loop
    requestAnimationFrame((time) => this.animate(time));
  },

  drawBackground() {
    // Gradient
    const gradient = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    gradient.addColorStop(0, '#1D3557');
    gradient.addColorStop(1, '#0A2239');
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Bubbles (simple particles)
    this.ctx.fillStyle = 'rgba(168, 218, 220, 0.3)';
    const bubbleCount = 20;
    for (let i = 0; i < bubbleCount; i++) {
      const x = (Date.now() / 50 + i * 50) % this.canvas.width;
      const y = (Date.now() / 30 + i * 30) % this.canvas.height;
      const size = 2 + Math.sin(Date.now() / 500 + i) * 2;
      
      this.ctx.beginPath();
      this.ctx.arc(x, y, size, 0, Math.PI * 2);
      this.ctx.fill();
    }
  },

  onMouseMove(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Check hover on squids
    let hoveredSquid = null;
    for (const squid of this.squids) {
      const isHovered = squid.containsPoint(x, y);
      squid.isHovered = isHovered;
      if (isHovered) {
        hoveredSquid = squid;
      }
    }
    
    // Update cursor
    this.canvas.style.cursor = hoveredSquid ? 'pointer' : 'crosshair';
  },

  onClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Find clicked squid
    for (const squid of this.squids) {
      if (squid.containsPoint(x, y)) {
        this.selectSquid(squid);
        return;
      }
    }
    
    // Deselect if clicked empty space
    if (this.selectedSquid) {
      this.selectedSquid.isSelected = false;
      this.selectedSquid = null;
      ui.hidePanel('detail');
    }
  },

  selectSquid(squid) {
    // Deselect previous
    if (this.selectedSquid) {
      this.selectedSquid.isSelected = false;
    }
    
    // Select new
    this.selectedSquid = squid;
    squid.isSelected = true;
    
    // Show detail panel
    ui.showSquidDetail(squid);
  }
};
