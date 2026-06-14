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

    // ── Layer 1: Rich abyss gradient with depth zones ──────────────────────
    const grad = cx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0,    '#0b1d3a');   // surface — deep teal-blue
    grad.addColorStop(0.25, '#071528');   // mid zone
    grad.addColorStop(0.65, '#040e1c');   // deeper
    grad.addColorStop(1,    '#020810');   // abyss
    cx.fillStyle = grad;
    cx.fillRect(0, 0, W, H);

    // ── Layer 2: Caustic light shimmer on walls/floor ──────────────────────
    cx.save();
    cx.globalCompositeOperation = 'screen';
    for (let c = 0; c < 12; c++) {
      const cx2 = W * (0.05 + (c / 12) * 0.9) + Math.sin(t * 0.22 + c * 0.8) * 28;
      const cy2 = H * 0.25 + Math.sin(t * 0.17 + c * 1.1) * H * 0.35;
      const cr  = 22 + Math.sin(t * 0.27 + c) * 12;
      const ca  = 0.07 + 0.04 * Math.sin(t * 0.31 + c * 0.9);
      const cg  = cx.createRadialGradient(cx2, cy2, 0, cx2, cy2, cr);
      cg.addColorStop(0, `rgba(100,200,255,${ca})`);
      cg.addColorStop(0.4, `rgba(60,140,230,${ca * 0.5})`);
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      cx.fillStyle = cg;
      cx.beginPath(); cx.arc(cx2, cy2, cr, 0, Math.PI * 2); cx.fill();
    }
    cx.globalCompositeOperation = 'source-over';
    cx.restore();

    // ── Layer 3: Volumetric god-rays from surface ──────────────────────────
    cx.save();
    cx.globalCompositeOperation = 'screen';
    for (let r = 0; r < 7; r++) {
      const ox   = W * (0.08 + r * 0.145) + Math.sin(t * 0.055 + r * 2.3) * 45;
      const rayL = H * (0.55 + 0.18 * Math.sin(t * 0.07 + r * 0.6));
      const rayW = 18 + r * 12 + Math.sin(t * 0.1 + r) * 14;
      const alp  = 0.035 + 0.018 * Math.sin(t * 0.12 + r * 1.1);
      const sg   = cx.createLinearGradient(ox, 0, ox, rayL);
      sg.addColorStop(0,   `rgba(100,190,255,${alp * 3.5})`);
      sg.addColorStop(0.3, `rgba(60,150,255,${alp * 1.2})`);
      sg.addColorStop(0.7, `rgba(40,100,220,${alp * 0.4})`);
      sg.addColorStop(1,   'rgba(20,60,180,0)');
      cx.fillStyle = sg;
      cx.beginPath();
      cx.moveTo(ox - 4, 0); cx.lineTo(ox + 4, 0);
      cx.lineTo(ox + rayW, rayL); cx.lineTo(ox - rayW, rayL);
      cx.closePath(); cx.fill();
    }
    cx.globalCompositeOperation = 'source-over';
    cx.restore();

    // ── Layer 4: Hex grid floor ────────────────────────────────────────────
    this._bgHexGrid(W, H, t);

    // ── Layer 5: Seaweed silhouettes ──────────────────────────────────────
    this._bgSeaweed(W, H, t);

    // ── Layer 6: Jellyfish / large bioluminescent forms ───────────────────
    if (!this._bgJelly) this._bgJelly = Array.from({ length: 4 }, (_, i) => ({
      x: 0.15 + i * 0.25, y: 0.3 + Math.random() * 0.4,
      r: 18 + Math.random() * 22, sp: 0.00015 + Math.random() * 0.0001,
      ph: Math.random() * Math.PI * 2,
      hue: [190, 150, 260, 210][i]
    }));
    cx.save();
    for (const j of this._bgJelly) {
      j.y -= j.sp;
      if (j.y < -0.08) { j.y = 1.1; j.x = 0.05 + Math.random() * 0.9; }
      j.ph += 0.005;
      const jx = j.x * W + Math.sin(j.ph) * 12;
      const jy = j.y * H;
      const pulse = 0.5 + 0.5 * Math.sin(j.ph * 2.3);
      const rr = j.r + pulse * 6;
      // Bell
      const jg = cx.createRadialGradient(jx, jy, 0, jx, jy, rr);
      jg.addColorStop(0,   `hsla(${j.hue},100%,80%,0.12)`);
      jg.addColorStop(0.6, `hsla(${j.hue},90%,60%,0.06)`);
      jg.addColorStop(1,   'hsla(0,0%,0%,0)');
      cx.fillStyle = jg;
      cx.beginPath(); cx.arc(jx, jy, rr, 0, Math.PI * 2); cx.fill();
      // Tentacle trails
      cx.strokeStyle = `hsla(${j.hue},90%,75%,0.08)`;
      cx.lineWidth = 0.8;
      for (let k = 0; k < 5; k++) {
        const tx = jx + (k - 2) * rr * 0.35;
        cx.beginPath(); cx.moveTo(tx, jy + rr * 0.6);
        cx.quadraticCurveTo(tx + Math.sin(j.ph + k) * 8, jy + rr * 1.4, tx + Math.sin(j.ph * 1.3 + k) * 5, jy + rr * 2.2);
        cx.stroke();
      }
    }
    cx.restore();

    // ── Layer 7: Vivid bioluminescent particles ────────────────────────────
    if (!this._bgParts) this._bgParts = Array.from({ length: 80 }, () => ({
      x: Math.random(), y: Math.random(),
      r: 0.4 + Math.random() * 2,
      dx: (Math.random() - 0.5) * 0.00010,
      dy: -0.00005 - Math.random() * 0.00012,
      ph: Math.random() * Math.PI * 2,
      sp: 0.25 + Math.random() * 0.6,
      // Mix of cyan, electric blue, green, purple
      col: ['0,255,200', '79,172,254', '150,80,255', '0,255,150', '40,180,255'][Math.floor(Math.random() * 5)]
    }));
    cx.save();
    for (const p of this._bgParts) {
      p.x += p.dx + Math.sin(t * p.sp * 0.28 + p.ph) * 0.00009;
      p.y += p.dy;
      if (p.y < -0.02) { p.y = 1.02; p.x = Math.random(); }
      if (p.x < 0) p.x = 1; if (p.x > 1) p.x = 0;
      const glow = 0.15 + 0.55 * Math.abs(Math.sin(t * p.sp * 0.5 + p.ph));
      cx.globalAlpha = glow;
      cx.shadowColor = `rgb(${p.col})`;
      cx.shadowBlur  = p.r * 6;
      cx.fillStyle   = `rgb(${p.col})`;
      cx.beginPath();
      cx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2);
      cx.fill();
    }
    cx.shadowBlur = 0;
    cx.globalAlpha = 1;
    cx.restore();

    // ── Layer 8: Crisp rising bubbles ─────────────────────────────────────
    if (!this._bgBubs) this._bgBubs = Array.from({ length: 28 }, () => ({
      x: Math.random(), y: 0.4 + Math.random() * 0.7,
      r: 0.8 + Math.random() * 2.5,
      sp: 0.00022 + Math.random() * 0.00065,
      wb: Math.random() * Math.PI * 2,
      ws: 0.008 + Math.random() * 0.012,
      al: 0.15 + Math.random() * 0.35
    }));
    cx.save();
    for (const b of this._bgBubs) {
      b.y  -= b.sp;
      b.wb += b.ws;
      b.x  += Math.sin(b.wb) * 0.00025;
      if (b.y < -0.02) { b.y = 1.02; b.x = Math.random(); }
      const fade = Math.max(0, Math.min(1, b.y * 4));
      cx.globalAlpha = b.al * fade;
      // Bubble body
      cx.strokeStyle = 'rgba(140,220,255,0.9)';
      cx.lineWidth   = 0.8;
      cx.beginPath(); cx.arc(b.x * W, b.y * H, b.r, 0, Math.PI * 2); cx.stroke();
      // Specular highlight
      cx.fillStyle = 'rgba(220,245,255,0.7)';
      cx.beginPath(); cx.arc(b.x * W - b.r * 0.32, b.y * H - b.r * 0.32, b.r * 0.3, 0, Math.PI * 2); cx.fill();
    }
    cx.globalAlpha = 1;
    cx.restore();

    // ── Layer 9: Animated surface ripple ──────────────────────────────────
    cx.save();
    cx.globalAlpha = 0.25;
    cx.strokeStyle = 'rgba(100,180,255,0.6)';
    cx.lineWidth   = 1.5;
    cx.shadowColor = 'rgba(80,160,255,0.5)';
    cx.shadowBlur  = 4;
    cx.beginPath();
    for (let x = 0; x <= W; x += 2) {
      const y = 1.8 + Math.sin(x * 0.018 + t * 1.1) * 2.2
                    + Math.sin(x * 0.031 + t * 0.7) * 1.3
                    + Math.sin(x * 0.009 + t * 0.4) * 0.8;
      x === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y);
    }
    cx.stroke();
    cx.shadowBlur = 0;
    cx.globalAlpha = 1;
    cx.restore();

    // ── Layer 10: Edge vignette ────────────────────────────────────────────
    const vig = cx.createRadialGradient(W / 2, H * 0.5, H * 0.2, W / 2, H * 0.5, H * 0.9);
    vig.addColorStop(0,   'rgba(0,0,0,0)');
    vig.addColorStop(0.7, 'rgba(0,0,0,0.08)');
    vig.addColorStop(1,   'rgba(1,3,8,0.65)');
    cx.fillStyle = vig;
    cx.fillRect(0, 0, W, H);
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

  _bgSeaweed(W, H, t) {
    const cx = this.ctx;
    const xpos = [0.02, 0.07, 0.13, 0.18, 0.82, 0.88, 0.93, 0.98];
    cx.save();
    xpos.forEach((xr, i) => {
      const x0 = W * xr;
      const h  = 45 + Math.sin(i * 2.1) * 22;
      const segs = 11;
      const rgb = i % 3 === 0 ? '6,200,130' : i % 3 === 1 ? '20,150,200' : '80,100,255';
      const al  = 0.18 + Math.sin(i * 0.9) * 0.07;
      cx.beginPath();
      for (let s = segs; s >= 0; s--) {
        const py   = H - (s / segs) * h;
        const wave = Math.sin(t * 0.9 + i * 0.8 + s * 0.38) * (s / segs) * 9;
        const px   = x0 + wave;
        s === segs ? cx.moveTo(px, py) : cx.lineTo(px, py);
      }
      cx.shadowColor = `rgba(${rgb},0.4)`;
      cx.shadowBlur  = 6;
      cx.strokeStyle = `rgba(${rgb},${al})`;
      cx.lineWidth   = 3.5 - (i % 3) * 0.8;
      cx.lineCap     = 'round';
      cx.stroke();
      cx.shadowBlur  = 0;
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
