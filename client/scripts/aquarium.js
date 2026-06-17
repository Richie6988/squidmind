const aquarium = {
  canvas: null,
  ctx: null,
  squids: [],
  lastTime: 0,
  selectedSquid: null,
  interactionSystem: null,
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
  _fallbackProjects() {
    // Empty fallback - the registry IS the source of truth.
    // If V2 endpoint fails completely, no temples shown rather than fake ones.
    console.warn('[TEMPLE] Fallback called - registry was empty or unreachable. No temples will render.');
    return [];
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
        {const _e = document.getElementById("agent-count"); if(_e) _e.textContent = `${this.squids.length} Squids`;}
        
        // Restore project assignments from project registry
        try {
          const pr = await fetch('/api/v2/projects').then(r => r.json());
          const projects = Object.values(pr.registry?.projects || {});
          for (const proj of projects) {
            for (const agentId of (proj.assigned_agents || [])) {
              const squid = this.squids.find(s => (s.agent_id || s.id) === agentId);
              if (squid) {
                squid.currentProject = proj.name;
                squid.insideTemple   = proj.name;
                squid.alpha          = 0; // hide from aquarium - they're inside temple
              }
            }
          }
        } catch {}
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
    {const _e = document.getElementById("agent-count"); if(_e) _e.textContent = `${this.squids.length} Squids`;}
    console.log(`Added squid: ${agentData.name}`);
  },

  removeSquid(agentId) {
    this.squids = this.squids.filter(s => s.id !== agentId);
    if (this.selectedSquid?.id === agentId) {
      this.selectedSquid = null;
    }
    {const _e = document.getElementById("agent-count"); if(_e) _e.textContent = `${this.squids.length} Squids`;}
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
    
    // Temples are HTML cards in .projects-container - no canvas updates or drawing.
    // (Temple manager is kept around only for legacy interaction code paths.)
    
    // Update and draw squids. Each in its own try/catch so a single bad
    // squid (e.g. malformed appearance data) can't kill the animation
    // loop for everyone.
    for (const squid of this.squids) {
      try {
        // Squids assigned to a project live inside their temple — don't draw in aquarium
        if (squid.insideTemple || squid.currentProject) continue;
        squid.update(deltaTime);
        squid.draw(this.ctx);
      } catch (err) {
        console.warn(`[SQUID] Error rendering ${squid.id || squid.name}:`, err.message);
      }
    }
    
    // Update and draw Poseidon (the mighty god!)
    if (typeof poseidon !== 'undefined' && poseidon.visible) {
      try {
        poseidon.update(deltaTime);
        poseidon.draw(this.ctx, this.canvas);
      } catch (err) {
        console.warn('[POSEIDON] Error rendering:', err.message);
      }
    }
    
    // Continue loop
    requestAnimationFrame((time) => this.animate(time));
  },

  drawBackground() {
    const W = this.canvas.width, H = this.canvas.height;
    const t = Date.now() / 1000;
    const cx = this.ctx;

    // Deep ocean gradient
    const grad = cx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,    '#0c1e38');
    grad.addColorStop(0.5,  '#071528');
    grad.addColorStop(1,    '#030c1a');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, W, H);

    // Depth-layered colorful bubbles (replace seaweed)
    this._bgBubbles(W, H, t);

    // Subtle vignette
    const vig = cx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(1,4,10,0.55)');
    cx.fillStyle = vig; cx.fillRect(0, 0, W, H);
  },

  _bgHexGrid(W, H, t) {
    const cx = this.ctx;
    const sz = 28, rw = sz * 2, rh = Math.sqrt(3) * sz;
    const floorY = H * 0.55;
    const rows = Math.ceil((H - floorY) / rh) + 2;
    const cols = Math.ceil(W / (rw * 0.75)) + 2;
    cx.save();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const hx = col * rw * 0.75 - rw * 0.4;
        const hy = floorY + row * rh + (col % 2 === 0 ? 0 : rh / 2);
        const d  = Math.sqrt((hx - W * 0.5) ** 2 + (hy - H * 0.88) ** 2);
        const pulse = Math.sin(t * 0.38 + d * 0.006 + col * 0.3 + row * 0.5);
        const al  = Math.max(0, 0.04 + 0.035 * pulse);
        cx.strokeStyle = `rgba(79,172,254,${al})`;
        cx.lineWidth   = 0.65;
        cx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const px = hx + sz * Math.cos(a), py = hy + sz * Math.sin(a);
          i === 0 ? cx.moveTo(px, py) : cx.lineTo(px, py);
        }
        cx.closePath(); cx.stroke();
        // Bright pulse nodes
        if (pulse > 0.85) {
          cx.shadowColor = 'rgba(79,172,254,0.8)';
          cx.shadowBlur  = 8;
          const ng = cx.createRadialGradient(hx, hy, 0, hx, hy, 7);
          ng.addColorStop(0, `rgba(120,200,255,${0.35 + 0.2 * pulse})`);
          ng.addColorStop(1, 'rgba(79,172,254,0)');
          cx.fillStyle = ng;
          cx.beginPath(); cx.arc(hx, hy, 7, 0, Math.PI * 2); cx.fill();
          cx.shadowBlur = 0;
        }
      }
    }
    cx.restore();
  },

  _bgBubbles(W, H, t) {
    const cx = this.ctx;
    if (!this._depthBubs) {
      // Three depth layers: far (small, slow, dim), mid, near (large, fast, bright)
      const layer = (n, rMin, rMax, spMin, spMax, alMin, alMax) =>
        Array.from({ length: n }, () => ({
          x: Math.random(), y: Math.random(),
          r: rMin + Math.random() * (rMax - rMin),
          sp: spMin + Math.random() * (spMax - spMin),
          wb: Math.random() * Math.PI * 2,
          ws: 0.004 + Math.random() * 0.012,
          al: alMin + Math.random() * (alMax - alMin),
          hue: Math.floor(Math.random() * 6), // 0=cyan 1=blue 2=violet 3=teal 4=aqua 5=green
          wobbleAmp: 0.0001 + Math.random() * 0.0003,
          phase: Math.random() * Math.PI * 2
        }));
      this._depthBubs = {
        far:  layer(22, 0.4, 1.1, 0.00008, 0.00018, 0.04, 0.10),
        mid:  layer(14, 1.2, 2.6, 0.00018, 0.00040, 0.10, 0.22),
        near: layer(7,  3.0, 5.5, 0.00040, 0.00080, 0.18, 0.35),
      };
    }
    const PALETTES = [
      [160, 220, 255], // cyan
      [ 79, 172, 254], // blue
      [168, 130, 255], // violet
      [  0, 210, 180], // teal
      [ 80, 240, 220], // aqua
      [ 60, 200, 130], // green
    ];
    cx.save();
    for (const [layerKey, blur, glow] of [['far',0,false],['mid',1,false],['near',2.5,true]]) {
      for (const b of this._depthBubs[layerKey]) {
        b.y -= b.sp;
        b.wb += b.ws;
        b.x += Math.sin(b.wb + b.phase) * b.wobbleAmp;
        if (b.y < -0.04) { b.y = 1.03; b.x = Math.random(); b.phase = Math.random() * Math.PI * 2; }
        if (b.x < -0.02) b.x = 1.02;
        if (b.x >  1.02) b.x = -0.02;

        const px = b.x * W, py = b.y * H;
        const r  = b.r;
        const [cr, cg, cb] = PALETTES[b.hue];
        // Depth fade (more visible near top of screen)
        const depthFade = Math.max(0, Math.min(1, (1 - b.y) * 0.7 + 0.3));
        const al = b.al * depthFade;

        if (glow) { cx.shadowColor = `rgba(${cr},${cg},${cb},0.5)`; cx.shadowBlur = blur * 4; }

        // Bubble body
        const grad = cx.createRadialGradient(px - r*0.3, py - r*0.3, r*0.1, px, py, r);
        grad.addColorStop(0, `rgba(${cr},${cg},${cb},${(al * 0.25).toFixed(3)})`);
        grad.addColorStop(0.6, `rgba(${cr},${cg},${cb},${(al * 0.08).toFixed(3)})`);
        grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        cx.fillStyle = grad;
        cx.beginPath(); cx.arc(px, py, r, 0, Math.PI * 2); cx.fill();

        // Rim stroke
        cx.strokeStyle = `rgba(${cr},${cg},${cb},${(al * 0.55).toFixed(3)})`;
        cx.lineWidth = layerKey === 'far' ? 0.4 : layerKey === 'mid' ? 0.65 : 1;
        cx.beginPath(); cx.arc(px, py, r, 0, Math.PI * 2); cx.stroke();

        // Specular highlight (top-left glint)
        cx.fillStyle = `rgba(230,245,255,${(al * 0.7).toFixed(3)})`;
        cx.beginPath(); cx.arc(px - r*0.35, py - r*0.38, r * 0.22, 0, Math.PI * 2); cx.fill();

        // Secondary tiny glint
        if (layerKey !== 'far') {
          cx.fillStyle = `rgba(255,255,255,${(al * 0.4).toFixed(3)})`;
          cx.beginPath(); cx.arc(px + r*0.2, py - r*0.15, r * 0.09, 0, Math.PI * 2); cx.fill();
        }

        if (glow) { cx.shadowBlur = 0; cx.shadowColor = 'transparent'; }
      }
    }
    cx.globalAlpha = 1;
    cx.restore();
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

// Globalize so window.aquarium.loadSquids() works from AgentForm/PoseidonChat
window.aquarium = aquarium;
