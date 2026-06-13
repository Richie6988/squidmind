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

    // ── Deep ocean gradient ────────────────────────────────────────────────
    const grad = this.ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,   '#0a1628');
    grad.addColorStop(0.4, '#071322');
    grad.addColorStop(1,   '#04080f');
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, W, H);

    // ── Volumetric light rays from top ─────────────────────────────────────
    this.ctx.save();
    for (let r = 0; r < 6; r++) {
      const angle  = -0.18 + r * 0.08 + Math.sin(t * 0.12 + r) * 0.04;
      const originX = W * (0.25 + r * 0.1) + Math.sin(t * 0.07 + r * 1.3) * 40;
      const rayLen  = H * (0.55 + Math.sin(t * 0.09 + r) * 0.12);
      const rayW    = 28 + r * 8 + Math.sin(t * 0.11 + r) * 10;
      const alpha   = 0.022 + Math.sin(t * 0.13 + r) * 0.008;

      const rg = this.ctx.createLinearGradient(
        originX, -10,
        originX + Math.sin(angle) * rayLen, rayLen
      );
      rg.addColorStop(0,   `rgba(79,172,254,${alpha * 2.5})`);
      rg.addColorStop(0.4, `rgba(79,172,254,${alpha})`);
      rg.addColorStop(1,   'rgba(79,172,254,0)');
      this.ctx.fillStyle = rg;
      this.ctx.beginPath();
      this.ctx.moveTo(originX - rayW * 0.3, -10);
      this.ctx.lineTo(originX + rayW * 0.3, -10);
      this.ctx.lineTo(originX + Math.sin(angle) * rayLen + rayW, rayLen);
      this.ctx.lineTo(originX + Math.sin(angle) * rayLen - rayW, rayLen);
      this.ctx.closePath();
      this.ctx.fill();
    }
    this.ctx.restore();

    // ── Caustic light patterns on floor ────────────────────────────────────
    this.ctx.save();
    this.ctx.globalAlpha = 0.06;
    for (let c = 0; c < 8; c++) {
      const cx = (W * 0.1 + c * W * 0.12 + Math.sin(t * 0.17 + c * 0.9) * 35) % W;
      const cy = H * 0.72 + Math.sin(t * 0.13 + c * 1.1) * 18;
      const cr = 18 + Math.sin(t * 0.2 + c) * 10;
      const cg = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, cr);
      cg.addColorStop(0,   'rgba(79,172,254,0.9)');
      cg.addColorStop(0.5, 'rgba(79,172,254,0.3)');
      cg.addColorStop(1,   'rgba(79,172,254,0)');
      this.ctx.fillStyle = cg;
      this.ctx.beginPath();
      this.ctx.arc(cx, cy, cr, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();

    // ── Rising micro-bubbles ───────────────────────────────────────────────
    if (!this._bubbles) {
      this._bubbles = Array.from({ length: 35 }, (_, i) => ({
        x: Math.random() * W,
        y: H + Math.random() * H,
        r: 0.8 + Math.random() * 2.2,
        speed: 0.3 + Math.random() * 0.8,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.015 + Math.random() * 0.025,
        alpha: 0.15 + Math.random() * 0.3,
        phase: Math.random() * Math.PI * 2
      }));
    }
    this.ctx.save();
    for (const b of this._bubbles) {
      b.y   -= b.speed;
      b.wobble += b.wobbleSpeed;
      b.x   += Math.sin(b.wobble) * 0.4;
      if (b.y < -10) {
        b.y = H + 10;
        b.x = Math.random() * W;
      }
      const fadeTop = Math.max(0, Math.min(1, b.y / (H * 0.3)));
      this.ctx.globalAlpha = b.alpha * fadeTop;
      this.ctx.strokeStyle = 'rgba(120,200,255,0.8)';
      this.ctx.lineWidth = 0.7;
      this.ctx.beginPath();
      this.ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      this.ctx.stroke();
      // Bubble shine
      this.ctx.fillStyle = 'rgba(200,240,255,0.6)';
      this.ctx.beginPath();
      this.ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();

    // ── Depth particles (distant plankton) ─────────────────────────────────
    if (!this._plankton) {
      this._plankton = Array.from({ length: 18 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.5 + Math.random(),
        dx: (Math.random() - 0.5) * 0.15,
        dy: (Math.random() - 0.5) * 0.08,
        phase: Math.random() * Math.PI * 2,
        color: Math.random() > 0.5 ? '6,255,165' : '79,172,254'
      }));
    }
    this.ctx.save();
    for (const p of this._plankton) {
      p.x += p.dx + Math.sin(t * 0.3 + p.phase) * 0.1;
      p.y += p.dy + Math.cos(t * 0.2 + p.phase) * 0.06;
      if (p.x < 0) p.x = W; if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
      const pa = 0.1 + 0.2 * Math.abs(Math.sin(t * 0.4 + p.phase));
      this.ctx.globalAlpha = pa;
      this.ctx.fillStyle = `rgb(${p.color})`;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();

    // ── Subtle floor gradient ──────────────────────────────────────────────
    const floorGrad = this.ctx.createLinearGradient(0, H * 0.8, 0, H);
    floorGrad.addColorStop(0, 'rgba(4,12,24,0)');
    floorGrad.addColorStop(1, 'rgba(4,12,24,0.6)');
    this.ctx.fillStyle = floorGrad;
    this.ctx.fillRect(0, H * 0.8, W, H * 0.2);
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
