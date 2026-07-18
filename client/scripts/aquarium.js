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
    this._pollSystemState();
    setInterval(() => this._pollSystemState(), 5000);
    
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
      const agents = await api.agents.flat();
      // Delta detection: squids created by Poseidon (via chat tool call) are
      // written to the registry but nothing on the client tells the aquarium
      // to reload — the poll below only mutated existing squids' status, so
      // new agents stayed invisible until a full page refresh. Compare id sets
      // and full-reload on mismatch (add OR remove).
      const registryIds = new Set(agents.map(a => a.agent_id || a.id));
      const currentIds  = new Set(this.squids.map(s => s.agent_id || s.id));
      let mismatch = registryIds.size !== currentIds.size;
      if (!mismatch) {
        for (const id of registryIds) { if (!currentIds.has(id)) { mismatch = true; break; } }
      }
      if (mismatch) {
        console.log('[OCEAN] squid set changed — reloading aquarium');
        await this.loadSquids();
      } else {
        // Update existing squids with fresh data
        agents.forEach(agentData => {
          const squid = this.squids.find(s => s.id === (agentData.agent_id || agentData.id));
          if (squid) {
            squid.status = agentData.status;
            squid.current_thought = agentData.current_thought;
          }
        });
      }
      // Reset error guard on success — next outage will log once again.
      this._statusErrLogged = false;
    } catch (error) {
      // Polling tick failures (network blip, server restart) used to spam
      // the console every interval. Log only on the first failure of an
      // outage; subsequent failures are silent until a successful poll.
      if (!this._statusErrLogged) {
        console.warn('Squid status polling paused:', error.message);
        this._statusErrLogged = true;
      }
    }
  },

  resizeCanvas() {
    const wrapper = this.canvas.parentElement;
    this.canvas.width = wrapper.clientWidth;
    this.canvas.height = wrapper.clientHeight;
    
    console.log(`Canvas resized to ${this.canvas.width}x${this.canvas.height}`);
  },

  // Optimistic remove for UndoManager — visual only, no server call.
  // Call loadSquids() to restore from registry.
  hideSquid(agentId) {
    if (!this.squids) return;
    this.squids = this.squids.filter(s => s.id !== agentId && s.agent?.agent_id !== agentId);
  },

  async loadSquids() {
    try {
      const agents = await api.agents.flat();
      // Capture prior assignment state per agent BEFORE recreating squids —
      // we need it to decide whether to animate (transition) or snap (first
      // load). Map: agentId → templeName they were inside, or null.
      // ALSO capture position/animation state: loadSquids can fire multiple
      // times in quick succession (tool_result hooks + 2s poll) and naively
      // recreating Squid objects teleports everyone to random spawn points
      // and kills in-flight teleport animations.
      const priorAssignments = new Map();
      const priorState = new Map();
      for (const s of (this.squids || [])) {
        const aid = s.agent_id || s.id;
        if (!aid) continue;
        priorAssignments.set(aid, s.insideTemple || null);
        priorState.set(aid, {
          x: s.x, y: s.y, targetX: s.targetX, targetY: s.targetY, alpha: s.alpha,
          _teleporting: s._teleporting, _teleportTargetX: s._teleportTargetX,
          _teleportTargetY: s._teleportTargetY, _teleportTempleName: s._teleportTempleName,
          _teleportInitialDist: s._teleportInitialDist,
        });
      }
      const isInitialLoad = !this._loadedOnce;
      this._loadedOnce = true;

      this.squids = agents.map(agent => {
        const squid = new Squid(agent, this.canvas);
        // Enhance with interactions
        if (typeof SquidInteractions !== 'undefined') {
          SquidInteractions.enhance(squid);
        }
        // Restore continuity: same position and any in-flight teleport.
        const prev = priorState.get(agent.agent_id || agent.id);
        if (prev) Object.assign(squid, prev);
        return squid;
      });
      console.log(`Loaded ${this.squids.length} squids`);

      // Update header count
      {const _e = document.getElementById("agent-count"); if(_e) _e.textContent = `${this.squids.length} Squids`;}

      // First-time onboarding: show welcome overlay if no agents
      if (window.Onboarding) window.Onboarding.maybeShow(this.squids.length);

      // Restore project assignments from project registry AND from active
      // task assignments (an agent assigned to a task in project X should
      // physically be inside temple X, even if proj.assigned_agents doesn't
      // list them). This makes the UI reflect Richard's request: "when an
      // agent is assigned to a task in a temple it shall automatically be
      // teleported there".
      try {
        const [pr, tr] = await Promise.all([
          fetch('/api/v2/projects').then(r => r.json()).catch(() => ({ registry: {} })),
          fetch('/api/v2/tasks').then(r => r.json()).catch(() => ({ registry: {} })),
        ]);
        const projects = Object.values(pr.registry?.projects || {});
        const projectByName = new Map(projects.map(p => [p.name, p]));
        // Build agent → templeName map for the CURRENT state.
        const currentAssignments = new Map();
        for (const proj of projects) {
          for (const agentId of (proj.assigned_agents || [])) {
            currentAssignments.set(agentId, proj.name);
          }
        }
        // Overlay task-level assignments: an agent working an active task in
        // project X → in temple X. Active = todo/wip/in_progress (not done).
        const tasks = Object.values(tr.registry?.tasks || {});
        for (const t of tasks) {
          const status = t.lifecycle?.status || t.status;
          if (['done', 'completed', 'failed', 'cancelled', 'archived'].includes(status)) continue;
          const agentId = t.assigned_to;
          if (!agentId) continue;
          // Resolve project name from t.project_id / t.context?.project_id
          const projName = t.project_name
            || (projects.find(p => p.project_id === (t.project_id || t.context?.project_id))?.name)
            || null;
          if (projName && projectByName.has(projName)) {
            // Task-level assignment wins if agent isn't already in a temple;
            // if already there, it's the same temple usually — keep it.
            if (!currentAssignments.has(agentId)) currentAssignments.set(agentId, projName);
          }
        }
        for (const squid of this.squids) {
          const aid = squid.agent_id || squid.id;
          const nowTemple  = currentAssignments.get(aid) || null;
          const wasTemple  = priorAssignments.get(aid) || null;

          if (nowTemple) {
            squid.currentProject = nowTemple;
            if (isInitialLoad || wasTemple === nowTemple) {
              // Initial page load OR already inside this temple → snap hidden.
              squid.insideTemple = nowTemple;
              squid.alpha        = 0;
            } else {
              // Assignment changed to a new temple → animate the swim.
              // Don't set insideTemple yet — the teleport method sets it on
              // arrival so the squid stays visible during the swim.
              if (typeof squid.teleportToTemple === 'function') {
                squid.teleportToTemple(nowTemple);
              } else {
                squid.insideTemple = nowTemple;
                squid.alpha        = 0;
              }
            }
          } else if (wasTemple) {
            // Unassigned — squid should reappear at the temple and swim out.
            if (typeof squid.teleportFromTemple === 'function') {
              squid.teleportFromTemple(wasTemple);
            }
            // Otherwise the default constructor already places them at a
            // random canvas spot with alpha=1 — nothing to do.
          }
        }
      } catch {}
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
    
    // Temples are HTML cards in .projects-container — no canvas updates or drawing.
    
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

    // Deep ocean gradient, tinted by real time of day. The aquarium lives
    // in your timezone: warm dawn, clear day, purple dusk, deep night.
    // During the dream cycle the water darkens further and moon rays appear.
    const hour = new Date().getHours() + new Date().getMinutes() / 60;
    const dreaming = this._sysState?.dreaming;
    let top = '#0c1e38', mid = '#071528', bot = '#030c1a';
    if (dreaming)                    { top = '#060a1e'; mid = '#04071a'; bot = '#020411'; }
    else if (hour >= 6 && hour < 9)  { top = '#1a2a44'; mid = '#0d1a30'; bot = '#04101f'; }   // dawn
    else if (hour >= 9 && hour < 18) { top = '#0e2242'; mid = '#08182e'; bot = '#030e1e'; }   // day
    else if (hour >= 18 && hour < 22){ top = '#141c3e'; mid = '#0a122c'; bot = '#040918'; }   // dusk
    else                             { top = '#080f26'; mid = '#050a1c'; bot = '#020610'; }   // night
    const grad = cx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, top);
    grad.addColorStop(0.5, mid);
    grad.addColorStop(1, bot);
    cx.fillStyle = grad;
    cx.fillRect(0, 0, W, H);

    // God rays — slow-swaying translucent light shafts from the surface.
    // Moonlight (cooler, dimmer) at night or while dreaming.
    this._bgLightRays(W, H, t, dreaming || hour < 6 || hour >= 22);

    // Depth-layered colorful bubbles
    this._bgBubbles(W, H, t);

    // Subtle vignette
    const vig = cx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.85);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(1,4,10,0.55)');
    cx.fillStyle = vig; cx.fillRect(0, 0, W, H);
  },

  _bgLightRays(W, H, t, moonlight) {
    const cx = this.ctx;
    cx.save();
    cx.globalCompositeOperation = 'lighter';
    const color = moonlight ? '190,210,255' : '120,190,255';
    const baseAl = moonlight ? 0.030 : 0.045;
    for (let i = 0; i < 4; i++) {
      const seed = i * 1.7;
      const x0 = W * (0.12 + i * 0.24) + Math.sin(t * 0.07 + seed) * W * 0.04;
      const sway = Math.sin(t * 0.11 + seed * 2) * W * 0.10;
      const wTop = W * 0.015, wBot = W * (0.06 + 0.02 * Math.sin(t * 0.05 + seed));
      const al = baseAl * (0.7 + 0.3 * Math.sin(t * 0.23 + seed * 3));
      const g = cx.createLinearGradient(0, 0, 0, H * 0.9);
      g.addColorStop(0, `rgba(${color},${al})`);
      g.addColorStop(1, `rgba(${color},0)`);
      cx.fillStyle = g;
      cx.beginPath();
      cx.moveTo(x0 - wTop, 0);
      cx.lineTo(x0 + wTop, 0);
      cx.lineTo(x0 + sway + wBot, H * 0.9);
      cx.lineTo(x0 + sway - wBot, H * 0.9);
      cx.closePath();
      cx.fill();
    }
    cx.restore();
  },

  // System-state poll (5s) — feeds Poseidon's ambient reactivity and the
  // day/night dream tint. One poll, shared: Poseidon reads window.aquarium.
  async _pollSystemState() {
    try {
      const ms = await window.api._fetch('/models/status');
      const m = (ms?.loaded_models || [])[0] || null;
      this._sysState = {
        loaded:     !!m,
        generating: !!m?.generating,
        phase:      m?.phase || 'idle',
        dreaming:   /dream/i.test(ms?.broker?.owner || ''),
        ctx_pct:    m?.context_pct || 0,
      };
    } catch { this._sysState = null; }
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




  // clientX/getBoundingClientRect are VISUAL viewport px, but canvas
  // internal coordinates (canvas.width = wrapper.clientWidth) are LAYOUT
  // px — under html{zoom:130%} every click landed 1.3× off the sprite.
  _mouseXY(e) {
    const zEl = document.documentElement;
    const z = (typeof zEl.currentCSSZoom === 'number' && zEl.currentCSSZoom > 0)
      ? zEl.currentCSSZoom
      : (parseFloat(getComputedStyle(zEl).zoom) || 1);
    const rect = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / z, y: (e.clientY - rect.top) / z };
  },

  onMouseMove(e) {
    const { x, y } = this._mouseXY(e);
    
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
    const { x, y } = this._mouseXY(e);
    
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
    
    // Left click = SELECT only (highlight ring). Edition / detail lives in
    // the right-click menu — opening a panel on every left click was
    // redundant and annoying (user request).
  }
};

// Globalize so window.aquarium.loadSquids() works from AgentForm/PoseidonChat
window.aquarium = aquarium;
