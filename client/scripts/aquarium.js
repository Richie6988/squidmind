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
    
    // Initialize Poseidon's position (top-left area)
    if (typeof poseidon !== 'undefined') {
      poseidon.setPosition(150, 120);
      console.log('🔱 Poseidon positioned in aquarium');
    }
    
    // Initialize Temple Manager
    if (typeof TempleManager !== 'undefined') {
      this.templeManager = new TempleManager();
      await this.loadTemples();
      console.log('🏛️ Temples initialized');
    }
    
    // Initialize interaction system
    if (typeof SquidInteractionSystem !== 'undefined') {
      this.interactionSystem = new SquidInteractionSystem(this);
      console.log('🎮 Interaction system initialized');
    }
    
    // Load agents and create squids
    await this.loadSquids();
    
    // Start animation loop
    this.animate();
    
    // Poll for updates every 2 seconds
    setInterval(() => this.updateSquidsStatus(), 2000);
    
    console.log('🌊 Aquarium initialized');
  },

  async loadTemples() {
    // For now, create example temples
    // TODO: Load from actual projects
    const exampleProjects = [
      { id: 1, name: 'WebApp', status: 'active', files: [], tasks: [] },
      { id: 2, name: 'API', status: 'active', files: [], tasks: [] },
      { id: 3, name: 'Docs', status: 'active', files: [], tasks: [] }
    ];
    
    exampleProjects.forEach(project => {
      this.templeManager.createTemple(project);
    });
    
    // Arrange temples in aquarium
    this.templeManager.arrangeTemples(this.canvas.width, this.canvas.height);
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
        this.squids = response.agents.map(agent => new Squid(agent, this.canvas));
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
