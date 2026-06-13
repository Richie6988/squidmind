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
    const cx = this.ctx;

    // ── Layer 1: Deep abyss gradient ──────────────────────────────────────
    const grad = cx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,    '#060e1c');
    grad.addColorStop(0.3,  '#040c18');
    grad.addColorStop(0.75, '#020a12');
    grad.addColorStop(1,    '#01060c');
    cx.fillStyle = grad;
    cx.fillRect(0, 0, W, H);

    // ── Layer 2: Hex grid floor (signature element) ────────────────────
    this._bgHexGrid(W, H, t);

    // ── Layer 3: Volumetric light shafts, screen-blended ──────────────
    cx.save();
    cx.globalCompositeOperation = 'screen';
    for (let r = 0; r < 5; r++) {
      const ox  = W * (0.1 + r * 0.21) + Math.sin(t * 0.06 + r * 2.1) * 28;
      const spd = 55 + r * 18 + Math.sin(t * 0.09 + r * 0.7) * 10;
      const len = H * (0.5 + 0.12 * Math.sin(t * 0.07 + r * 0.9));
      const alp = 0.025 + 0.01 * Math.sin(t * 0.14 + r);
      const sg  = cx.createLinearGradient(ox, 0, ox, len);
      sg.addColorStop(0,   `rgba(80,160,255,${alp * 3})`);
      sg.addColorStop(0.4, `rgba(80,160,255,${alp})`);
      sg.addColorStop(1,   'rgba(80,160,255,0)');
      cx.fillStyle = sg;
      cx.beginPath();
      cx.moveTo(ox - 6, 0);
      cx.lineTo(ox + 6, 0);
      cx.lineTo(ox + spd, len);
      cx.lineTo(ox - spd, len);
      cx.closePath();
      cx.fill();
    }
    cx.globalCompositeOperation = 'source-over';
    cx.restore();

    // ── Layer 4: Seaweed silhouettes at floor edges ────────────────────
    this._bgSeaweed(W, H, t);

    // ── Layer 5: Bioluminescent particles ─────────────────────────────
    if (!this._bgParts) this._bgParts = Array.from({ length: 60 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.5 + Math.random() * 1.5,
      dx: (Math.random() - 0.5) * 0.00012,
      dy: -0.00006 - Math.random() * 0.0001,
      ph: Math.random() * Math.PI * 2,
      sp: 0.3 + Math.random() * 0.5,
      col: [Math.random() > 0.6 ? '6,255,165' : Math.random() > 0.5 ? '79,172,254' : '160,100,255']
    }));
    cx.save();
    for (const p of this._bgParts) {
      p.x += p.dx + Math.sin(t * p.sp * 0.3 + p.ph) * 0.00008;
      p.y += p.dy;
      if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0;
      const fade = 0.05 + 0.2 * Math.abs(Math.sin(t * p.sp * 0.4 + p.ph));
      cx.globalAlpha = fade;
      cx.fillStyle = `rgb(${p.col})`;
      cx.beginPath();
      cx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
      cx.fill();
    }
    cx.globalAlpha = 1;
    cx.restore();

    // ── Layer 6: Rising bubbles ───────────────────────────────────────
    if (!this._bgBubs) this._bgBubs = Array.from({ length: 24 }, () => ({
      x: Math.random(), y: 0.5 + Math.random() * 0.6,
      r: 0.6 + Math.random() * 1.8,
      sp: 0.00025 + Math.random() * 0.0006,
      wb: Math.random() * Math.PI * 2,
      ws: 0.01 + Math.random() * 0.015,
      al: 0.08 + Math.random() * 0.18
    }));
    cx.save();
    for (const b of this._bgBubs) {
      b.y  -= b.sp;
      b.wb += b.ws;
      b.x  += Math.sin(b.wb) * 0.0003;
      if (b.y < -0.02) { b.y = 1.02; b.x = Math.random(); }
      const fade = Math.max(0, b.y * 3);
      cx.globalAlpha = b.al * Math.min(1, fade);
      cx.strokeStyle = 'rgba(130,210,255,0.8)';
      cx.lineWidth   = 0.7;
      cx.beginPath();
      cx.arc(b.x * W, b.y * H, b.r, 0, Math.PI * 2);
      cx.stroke();
      cx.fillStyle = 'rgba(210,240,255,0.45)';
      cx.beginPath();
      cx.arc(b.x * W - b.r * 0.3, b.y * H - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
      cx.fill();
    }
    cx.globalAlpha = 1;
    cx.restore();

    // ── Layer 7: Animated surface shimmer ─────────────────────────────
    cx.save();
    cx.strokeStyle = 'rgba(90,170,255,0.18)';
    cx.lineWidth = 1.2;
    cx.beginPath();
    for (let x = 0; x <= W; x += 3) {
      const y = 1.5 + Math.sin(x * 0.016 + t * 0.9) * 1.8 + Math.sin(x * 0.027 + t * 0.6) * 1.1;
      x === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y);
    }
    cx.stroke();
    cx.restore();

    // ── Layer 8: Radial vignette ─────────────────────────────────────
    const vig = cx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(1,4,10,0.5)');
    cx.fillStyle = vig;
    cx.fillRect(0, 0, W, H);
  },

  _bgHexGrid(W, H, t) {
    const cx = this.ctx;
    const sz = 26, rw = sz * 2, rh = Math.sqrt(3) * sz;
    const floorY = H * 0.58;
    const rows = Math.ceil((H - floorY) / rh) + 2;
    const cols = Math.ceil(W / (rw * 0.75)) + 2;
    cx.save();
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const hx = col * rw * 0.75 - rw * 0.4;
        const hy = floorY + row * rh + (col % 2 === 0 ? 0 : rh / 2);
        const d  = Math.sqrt((hx - W * 0.5) ** 2 + (hy - H * 0.9) ** 2);
        const pulse = Math.sin(t * 0.35 + d * 0.007 + col * 0.25 + row * 0.4);
        const al  = 0.022 + 0.015 * pulse;
        cx.strokeStyle = `rgba(79,172,254,${Math.max(0, al)})`;
        cx.lineWidth = 0.55;
        cx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const px = hx + sz * Math.cos(a), py = hy + sz * Math.sin(a);
          i === 0 ? cx.moveTo(px, py) : cx.lineTo(px, py);
        }
        cx.closePath();
        cx.stroke();
        if (pulse > 0.9) {
          const g = cx.createRadialGradient(hx, hy, 0, hx, hy, 5);
          g.addColorStop(0, `rgba(79,172,254,${0.1 + 0.07 * pulse})`);
          g.addColorStop(1, 'rgba(79,172,254,0)');
          cx.fillStyle = g; cx.beginPath(); cx.arc(hx, hy, 5, 0, Math.PI * 2); cx.fill();
        }
      }
    }
    cx.restore();
  },

  _bgSeaweed(W, H, t) {
    const cx = this.ctx;
    const xpos = [0.03, 0.08, 0.14, 0.84, 0.91, 0.97];
    cx.save();
    xpos.forEach((xr, i) => {
      const x0 = W * xr;
      const h  = 32 + Math.sin(i * 1.9) * 16;
      const segs = 9;
      const rgb = i % 2 === 0 ? '8,200,140' : '20,130,190';
      cx.beginPath();
      for (let s = segs; s >= 0; s--) {
        const py   = H - (s / segs) * h;
        const wave = Math.sin(t * 0.85 + i * 0.7 + s * 0.32) * (s / segs) * 6;
        const px   = x0 + wave;
        s === segs ? cx.moveTo(px, py) : cx.lineTo(px, py);
      }
      cx.strokeStyle = `rgba(${rgb},0.13)`;
      cx.lineWidth   = 3 - i % 2;
      cx.lineCap     = 'round';
      cx.stroke();
    });
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
