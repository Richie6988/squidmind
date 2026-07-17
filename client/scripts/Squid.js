class Squid {
  constructor(data) {
    this.id = data.id;
    this.name = data.name;
    this.nickname = data.nickname || data.name;
    this.x = data.x || Math.random() * 700 + 50;
    this.y = data.y || Math.random() * 500 + 50;
    this.vx = (Math.random() - 0.5) * 3; // 1.5x speed
    this.vy = (Math.random() - 0.5) * 3;
    this.status = data.status || 'idle';
    this.current_thought = data.current_thought;
    
    // Appearance & outfit
    // Two field-name conventions are in use across the codebase:
    //   old: body_color, accent_color, glow_intensity
    //   new: primary_color, secondary_color  (no glow field)
    // Merge with defaults so downstream code never sees undefined.
    const DEFAULT_APPEARANCE = {
      body_color: '#FF6B9D',
      accent_color: '#FFE66D',
      eye_style: 'round',
      tentacle_style: 'wavy',
      size: 'medium',
      glow_intensity: 0.5
    };
    this.appearance = { ...DEFAULT_APPEARANCE, ...(data.appearance || {}) };
    
    // V2: support newer primary_color/secondary_color naming - mirror to old names
    if (this.appearance.primary_color) {
      this.appearance.body_color = this.appearance.primary_color;
    }
    if (this.appearance.secondary_color) {
      this.appearance.accent_color = this.appearance.secondary_color;
    }
    
    // Final safety: make sure body_color and accent_color are valid hex strings
    const hex6 = /^#[0-9a-fA-F]{6}$/;
    if (!hex6.test(this.appearance.body_color)) this.appearance.body_color = DEFAULT_APPEARANCE.body_color;
    if (!hex6.test(this.appearance.accent_color)) this.appearance.accent_color = DEFAULT_APPEARANCE.accent_color;
    
    // V2: accessories live under appearance.accessories - bring them up so
    // the draw loop can find them at this.accessories.{hat, glasses, outfit, eyes}
    this.accessories = data.accessories || (this.appearance && this.appearance.accessories) || null;
    
    this.outfit = data.outfit || {
      hat: null,
      accessory: null,
      tool: null,
      background_effect: null
    };
    
    // Personality & animation
    this.personality = data.personality || {
      mood: 'happy',
      energy: 100,
      affection: 50,
      animation_style: 'bouncy'
    };
    
    this.stats = data.stats || {
      level: 1,
      experience: 0
    };
    
    // XP SYSTEM (server-authoritative): agent.stats now carries xp/level/
    // pass_count/avg_score written by RegistryManager.recordAgentOutcome on
    // every task completion. When present it wins over the legacy heuristic.
    const tasksCompleted = data.stats?.tasks_done
                        ?? data.performance_summary?.tasks_completed
                        ?? data.tasks_completed
                        ?? 0;
    if (Number.isFinite(data.stats?.xp)) {
      this.stats.level      = data.stats.level || 1;
      this.stats.experience = data.stats.xp;
      this.stats.avg_score  = data.stats.avg_score ?? null;
      this.stats.pass_count = data.stats.pass_count || 0;
    } else if (tasksCompleted > 0) {
      // Legacy fallback: level from perfect squares of tasks_completed.
      this.stats.level = Math.max(1, Math.floor(Math.sqrt(tasksCompleted)) + 1);
      this.stats.experience = tasksCompleted;
    }
    this.stats.tasks_completed = tasksCompleted;
    // Tasks needed to reach next level: next_level^2 - current
    const nextLevel = this.stats.level + 1;
    this.stats.tasks_to_next = Math.max(0, ((nextLevel - 1) * (nextLevel - 1)) - tasksCompleted);
    
    // Animation state
    this.baseSize = this.getSizeMultiplier();
    this.animFrame = 0;
    this.bobOffset = Math.random() * Math.PI * 2;
    this.glowPulse = 0;
    this.isDragging = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    
    // Target position for dragging/movement
    this.targetX = this.x;
    this.targetY = this.y;
    
    // Hover state
    this.isHovered = false;
    
    // Interaction state
    this.lastPetTime = 0;
    this.heartParticles = [];
    this.clickedTime = 0;
    this.isJumping = false;
    this.jumpHeight = 0;
    
    // Idle animations
    this.idleAnimations = ['bob', 'wiggle', 'blink', 'wave'];
    this.currentIdleAnim = 'bob';
    this.idleTimer = 0;
  }

  getSizeMultiplier() {
    // V2: numeric size_scale (0.5 - 2.0) takes priority
    if (typeof this.appearance.size_scale === 'number') {
      return Math.max(0.4, Math.min(3.0, this.appearance.size_scale));
    }
    const sizes = { small: 0.8, medium: 1.0, large: 1.3 };
    return sizes[this.appearance.size] || 1.0;
  }

  update(deltaTime = 16) {
    this.animFrame += deltaTime * 0.001;
    this.glowPulse += deltaTime * 0.003;
    this.idleTimer += deltaTime;
    
    // === SLEEP STATE: if nothing happens for 20s, the squid falls asleep ===
    // The registry can also seed `status: 'sleeping'` directly - treat both
    // (status === 'sleeping') and (isSleeping flag) as equivalent.
    // Treat 'sleeping' as an idle variant for movement purposes.
    const isIdleLike = (this.status === 'idle' || this.status === 'sleeping' || !this.status);
    
    // Wakes up on any interaction (hover, click, drag) - handled elsewhere
    if (!this.isDragging && !this.isHovered && isIdleLike && !this.currentTask) {
      this.timeSinceActivity = (this.timeSinceActivity || 0) + deltaTime;
      // Honor registry-seeded sleeping immediately; otherwise need 20s of inactivity
      if (this.status === 'sleeping' || this.timeSinceActivity > 20000) {
        this.isSleeping = true;
      }
    } else {
      this.timeSinceActivity = 0;
      this.isSleeping = false;
    }
    
    // Change idle animation every 3 seconds
    if (this.idleTimer > 3000) {
      this.currentIdleAnim = this.idleAnimations[Math.floor(Math.random() * this.idleAnimations.length)];
      this.idleTimer = 0;
    }
    
    // Jump animation
    if (this.isJumping) {
      this.jumpHeight = Math.sin(this.animFrame * 10) * 20;
      if (this.animFrame * 10 > Math.PI) {
        this.isJumping = false;
        this.jumpHeight = 0;
      }
    }
    
    // Smooth movement toward target (for dragging or wandering toward a point)
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (this.isDragging) {
      // Hard lerp while dragged
      if (distance > 1) {
        this.x += dx * 0.3;
        this.y += dy * 0.3;
      } else {
        this.x = this.targetX;
        this.y = this.targetY;
      }
    } else if (this.isSleeping) {
      // Gentle drift while asleep - bob slightly
      this.x += Math.sin(this.animFrame * 0.5) * 0.1;
      this.y += Math.cos(this.animFrame * 0.4) * 0.1;
    } else if (isIdleLike) {
      // Wandering: pick a new random target periodically, then smoothly swim there
      this.wanderTimer = (this.wanderTimer || 0) + deltaTime;
      if (this.wanderTimer > 3000 + Math.random() * 3000) {
        // Pick new random target covering most of the canvas
        const canvas = this.aquarium?.canvas || (window.aquarium?.canvas);
        const w = canvas?.width || 800;
        const h = canvas?.height || 600;
        const sz = 40 * (this.baseSize || 1);
        const mx = sz + 20;   // horizontal margin — keeps squids away from panel edges
        const my = sz + 10;   // vertical margin
        this.targetX = mx + Math.random() * (w - mx * 2);
        this.targetY = my + Math.random() * (h - my * 2);
        this.wanderTimer = 0;
        // Random direction flip for variety
        if (Math.random() < 0.3) {
          this.vx = (Math.random() - 0.5) * 4;
          this.vy = (Math.random() - 0.5) * 4;
        }
      }
      
      // Smoothly swim toward target
      if (distance > 5) {
        const speed = this.personality.animation_style === 'energetic' ? 0.04 : 0.025;
        this.x += dx * speed;
        this.y += dy * speed;
      }
    }

    // ── Teleport animation to/from a temple ──────────────────────────────
    // Set by teleportToTemple / teleportFromTemple. During the swim we hard-
    // steer toward the target (overrides wander) and fade alpha on arrival.
    if (this._teleporting) {
      const tx = this._teleportTargetX;
      const ty = this._teleportTargetY;
      const tdx = tx - this.x;
      const tdy = ty - this.y;
      const tdist = Math.sqrt(tdx * tdx + tdy * tdy);
      // Aim the wander target at the temple so the existing swim code moves us
      this.targetX = tx;
      this.targetY = ty;
      if (this._teleporting === 'to') {
        // Fade OUT as we approach the temple. Full alpha until ~100px, then linear.
        const fadeStart = 120;
        if (tdist < fadeStart) this.alpha = Math.max(0, tdist / fadeStart);
        if (tdist < 8) {
          this.insideTemple    = this._teleportTempleName;
          this.currentProject  = this._teleportTempleName;
          this.alpha           = 0;
          this._teleporting    = null;
        }
      } else if (this._teleporting === 'from') {
        // Fade IN as we swim away from the temple.
        const fadeEnd = 120;
        if (tdist > this._teleportInitialDist - fadeEnd) this.alpha = 0;
        else this.alpha = Math.min(1, (this._teleportInitialDist - tdist - fadeEnd) / fadeEnd);
        if (tdist < 10 || this.alpha >= 1) {
          this._teleporting    = null;
          this.alpha           = 1;
        }
      }
      // While teleporting, skip the wander target-update block
      this.wanderTimer = 0;
    }

    // Update heart particles
    this.heartParticles = this.heartParticles.filter(p => {
      p.y -= 2;
      p.alpha -= 0.02;
      return p.alpha > 0;
    });
    // Update confetti particles
    if (this._confetti) {
      this._confetti = this._confetti.filter(p => {
        p.x  += p.vx;
        p.y  += p.vy;
        p.vy += 0.12;
        p.vx *= 0.98;
        p.rot += p.rotSpeed;
        p.life -= 0.018;
        return p.life > 0;
      });
    }
  }

  // ── Teleport toward a temple's DOM card (visible swim across canvas) ───
  // Looks up the .temple-card by data-project-name, converts its centre to
  // canvas coords, and sets a teleport target. Alpha fades near arrival.
  teleportToTemple(templeName) {
    const target = this._templeCanvasCoords(templeName);
    if (!target) {
      // Fallback: snap hidden if we can't find the DOM (temple not rendered)
      this.insideTemple = templeName; this.currentProject = templeName; this.alpha = 0;
      return;
    }
    this._teleporting        = 'to';
    this._teleportTargetX    = target.x;
    this._teleportTargetY    = target.y;
    this._teleportTempleName = templeName;
    this.alpha               = 1;
    // Wake the squid so it swims — sleep would freeze it mid-teleport
    this.isSleeping          = false;
    this.timeSinceActivity   = 0;
  }

  // Reverse teleport: appear at the temple, swim into the aquarium.
  teleportFromTemple(templeName) {
    const start = this._templeCanvasCoords(templeName);
    const canvas = this.aquarium?.canvas || (window.aquarium?.canvas);
    if (!start || !canvas) {
      this.insideTemple = null; this.currentProject = null; this.alpha = 1;
      return;
    }
    // Pick a random point IN the aquarium as our arrival
    const w  = canvas.width, h = canvas.height, sz = 40 * (this.baseSize || 1);
    const mx = sz + 40, my = sz + 20;
    const arriveX = mx + Math.random() * (w - mx * 2);
    const arriveY = my + Math.random() * (h - my * 2);
    // Position squid AT the temple, then swim toward arrival
    this.x = start.x;
    this.y = start.y;
    this.alpha = 0;
    this.insideTemple    = null;
    this.currentProject  = null;
    this._teleporting          = 'from';
    this._teleportTargetX      = arriveX;
    this._teleportTargetY      = arriveY;
    this._teleportInitialDist  = Math.sqrt((arriveX - start.x) ** 2 + (arriveY - start.y) ** 2);
    this.isSleeping            = false;
    this.timeSinceActivity     = 0;
  }

  _templeCanvasCoords(templeName) {
    const card = document.querySelector(`.temple-card[data-project-name="${CSS.escape(templeName)}"]`);
    const canvas = this.aquarium?.canvas || (window.aquarium?.canvas);
    if (!card || !canvas) return null;
    const cardR = card.getBoundingClientRect();
    const canR  = canvas.getBoundingClientRect();
    if (canR.width === 0 || canR.height === 0) return null;
    // Convert page coords to canvas coords, accounting for canvas resolution
    // vs its rendered size (CSS scale).
    const scaleX = canvas.width  / canR.width;
    const scaleY = canvas.height / canR.height;
    const x = (cardR.left + cardR.width  / 2 - canR.left) * scaleX;
    const y = (cardR.top  + cardR.height / 2 - canR.top ) * scaleY;
    // Clamp inside canvas — temples rendered outside the canvas bounds fall
    // back to the nearest edge so the squid still animates toward them.
    return {
      x: Math.max(0, Math.min(canvas.width,  x)),
      y: Math.max(0, Math.min(canvas.height, y)),
    };
  }

  draw(ctx) {
    // Skip rendering if squid is inside a temple (assigned & animated in)
    if (this.insideTemple && this.alpha === 0) return;
    
    ctx.save();
    ctx.translate(this.x, this.y - this.jumpHeight);
    
    // Apply transparency for fade animations
    if (this.alpha !== undefined && this.alpha < 1) {
      ctx.globalAlpha = Math.max(0, this.alpha);
    }
    
    const size = 40 * this.baseSize;
    
    // Background effect
    if (this.outfit.background_effect) {
      this.drawBackgroundEffect(ctx, size);
    }
    
    // Glow effect: always render so hover halo works; sleeping squids
    // get a much subtler glow (just enough to show hover when interacted with).
    this.drawGlow(ctx, size);
    
    // Shadow
    this.drawShadow(ctx, size);
    
    // Main body
    this.drawBody(ctx, size);
    
    // Tentacles
    this.drawTentacles(ctx, size);
    
    // Eyes (custom from accessories, falls back to default)
    // When asleep, draw closed eyes (horizontal lines)
    if (this.isSleeping) {
      this._drawSleepEyes(ctx, size);
    } else if (this.accessories && this.accessories.eyes && this.accessories.eyes !== 'round' && typeof SquidAccessories !== 'undefined') {
      SquidAccessories.drawEyes(ctx, this.accessories.eyes, size);
    } else {
      this.drawEyes(ctx, size);
    }
    
    // Sleep "Z" particles floating up
    if (this.isSleeping) {
      this._drawSleepZ(ctx, size);
    }
    
    // === V2 Pixel Art Accessories (from agent.appearance.accessories) ===
    if (typeof SquidAccessories !== 'undefined' && this.accessories) {
      if (this.accessories.outfit) SquidAccessories.drawOutfit(ctx, this.accessories.outfit, size, this.animFrame || 0);
      if (this.accessories.hat) SquidAccessories.drawHat(ctx, this.accessories.hat, size);
      if (this.accessories.glasses) SquidAccessories.drawGlasses(ctx, this.accessories.glasses, size);
    }

    // === XP UNLOCKS — earned headwear, only when the user hasn't set one ===
    // Lv5+ wears the crown, Lv8+ the halo. A deliberate user choice always
    // wins; the unlock only fills the empty slot. Attachment through growth.
    if (typeof SquidAccessories !== 'undefined' && !(this.accessories?.hat) && !this.outfit?.hat) {
      const lvl = this.stats?.level || 1;
      if (lvl >= 8)      SquidAccessories.drawHat(ctx, 'halo', size);
      else if (lvl >= 5) SquidAccessories.drawHat(ctx, 'crown', size);
    }
    
    // Legacy outfit accessories (older format)
    if (this.outfit.hat) this.drawHat(ctx, size);
    if (this.outfit.accessory) this.drawAccessory(ctx, size);
    if (this.outfit.tool) this.drawTool(ctx, size);
    
    // Status indicators
    this.drawStatusIndicator(ctx, size);
    
    // Name tag with level
    this.drawNameTag(ctx, size);
    
    // Heart particles (when pet)
    this.heartParticles.forEach(p => this.drawHeart(ctx, p));
    // Confetti particles (celebration)
    if (this._confetti) this._confetti.forEach(p => this._drawConfetti(ctx, p));
    
    ctx.restore();
  }

  drawBackgroundEffect(ctx, size) {
    switch (this.outfit.background_effect) {
      case 'sparkles':
        for (let i = 0; i < 5; i++) {
          const angle = (this.animFrame + i) * 2;
          const radius = size * 1.5;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          ctx.fillStyle = `rgba(255, 230, 109, ${0.5 + Math.sin(this.animFrame * 5 + i) * 0.3})`;
          ctx.beginPath();
          ctx.arc(x, y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      
      case 'flames':
        for (let i = 0; i < 3; i++) {
          const x = (Math.random() - 0.5) * size;
          const y = size + i * 10;
          ctx.fillStyle = `rgba(255, 100, 50, ${0.6 - i * 0.2})`;
          ctx.beginPath();
          ctx.arc(x, y, 8 - i * 2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      
      case 'code_rain':
        ctx.fillStyle = 'rgba(0, 255, 100, 0.3)';
        ctx.font = '10px monospace';
        for (let i = 0; i < 3; i++) {
          const x = (Math.random() - 0.5) * size * 2;
          const y = -size + (this.animFrame * 50 + i * 20) % (size * 3);
          ctx.fillText('01', x, y);
        }
        break;
    }
  }

  drawGlow(ctx, size) {
    // Validate inputs - any of these being missing/NaN would crash addColorStop
    let glowColor = this.appearance?.body_color || '#FF6B9D';
    // Make sure glowColor is a valid 6-char hex (#RRGGBB). If it's #RGB or
    // anything else, fall back to a known good default.
    if (!/^#[0-9a-fA-F]{6}$/.test(glowColor)) {
      glowColor = '#FF6B9D';
    }
    
    // Default intensity if appearance didn't set it
    let intensity = this.appearance?.glow_intensity;
    if (typeof intensity !== 'number' || isNaN(intensity)) {
      intensity = 0.5;
    }
    
    // HOVER EFFECT: Brighter glow - highest priority, overrides sleep dimming
    if (this.isHovered) {
      intensity = 1.0;
      size = size * 1.2;
    } else if (this.isSleeping || this.status === 'sleeping') {
      // Sleeping squids: very dim glow
      intensity = intensity * 0.15;
    } else if (this.status === 'thinking') {
      glowColor = '#FFD60A';
      intensity = 0.8 + Math.sin(this.glowPulse) * 0.2;
    } else if (this.status === 'working') {
      glowColor = '#06FFA5';
      intensity = 0.6 + Math.sin(this.glowPulse * 2) * 0.2;
    }
    
    // Final clamp - intensity must be a finite number in [0, 1]
    intensity = Math.max(0, Math.min(1, intensity || 0));
    
    // Build hex alpha byte. Math.floor(0..50) -> 0..50 -> '00'..'32'
    const alphaHex = Math.floor(intensity * 50).toString(16).padStart(2, '0');
    
    const gradient = ctx.createRadialGradient(0, 0, size * 0.5, 0, 0, size * 1.5);
    gradient.addColorStop(0, `${glowColor}00`);
    gradient.addColorStop(0.5, `${glowColor}${alphaHex}`);
    gradient.addColorStop(1, `${glowColor}00`);
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, size * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  drawShadow(ctx, size) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.beginPath();
    ctx.ellipse(0, size + 10, size * 0.8, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawBody(ctx, size) {
    // PIXEL ART CARTOONISH STYLE (Farming Game Inspired)
    
    // Outline stroke (black border - pixel art style)
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 3;
    
    // Main body with brighter gradient (more cartoonish)
    const gradient = ctx.createRadialGradient(0, -size * 0.3, 0, 0, 0, size);
    
    // Brighter, more saturated colors for cartoon style
    const brightColor = this.brightenColor(this.appearance.body_color, 1.2);
    gradient.addColorStop(0, brightColor);
    gradient.addColorStop(0.5, this.appearance.body_color);
    gradient.addColorStop(1, this.darkenColor(this.appearance.body_color, 0.8));
    
    ctx.fillStyle = gradient;
    
    // Round body with pixel-art bounce — freeze bob while dragging so visual center = this.x/y
    const bobAmount = this.personality.animation_style === 'bouncy' ? 10 : 5;
    const bob = this.isDragging ? 0 : Math.sin(this.animFrame * 2 + this.bobOffset) * bobAmount;
    
    // Draw body with outline
    ctx.beginPath();
    ctx.arc(0, bob, size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // Belly highlight (cartoonish shine)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.ellipse(-size * 0.1, bob, size * 0.5, size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Cute accent spots (Pokemon/farming game style)
    ctx.fillStyle = this.appearance.accent_color;
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2;
    
    const spots = [
      { x: -size * 0.35, y: bob - size * 0.2, r: size * 0.18 },
      { x: size * 0.35, y: bob + size * 0.15, r: size * 0.15 },
      { x: 0, y: bob + size * 0.4, r: size * 0.12 },
    ];
    
    spots.forEach(spot => {
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, spot.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    
    spots.forEach(spot => {
      ctx.beginPath();
      ctx.arc(spot.x, spot.y, spot.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  drawTentacles(ctx, size) {
    ctx.strokeStyle = this.appearance.body_color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    
    const tentacleCount = 6;
    for (let i = 0; i < tentacleCount; i++) {
      ctx.save();
      ctx.rotate((Math.PI * 2 / tentacleCount) * i);
      
      ctx.beginPath();
      ctx.moveTo(0, size * 0.7);
      
      if (this.appearance.tentacle_style === 'wavy') {
        // Pokemon-style wavy tentacles
        const wave = Math.sin(this.animFrame * 3 + i) * 5;
        ctx.quadraticCurveTo(
          wave, size * 1.2,
          wave * 2, size * 1.5
        );
      } else if (this.appearance.tentacle_style === 'curly') {
        ctx.bezierCurveTo(
          10, size,
          -10, size * 1.3,
          5, size * 1.6
        );
      } else {
        ctx.lineTo(0, size * 1.5);
      }
      
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawSleepEyes(ctx, size) {
    // Closed eyes = two short horizontal lines
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-size * 0.35, 0);
    ctx.lineTo(-size * 0.15, 0);
    ctx.moveTo(size * 0.15, 0);
    ctx.lineTo(size * 0.35, 0);
    ctx.stroke();
  }
  
  _drawSleepZ(ctx, size) {
    // Animated Z floating up next to head
    const t = this.animFrame * 2;
    const zCount = 2;
    for (let i = 0; i < zCount; i++) {
      const phase = ((t + i * 0.7) % 2);
      const yOffset = -size * 0.7 - phase * 25;
      const xOffset = size * 0.3 + Math.sin(phase * Math.PI) * 5;
      const alpha = phase < 1 ? 1 : (2 - phase);
      const zSize = 8 + phase * 4;
      
      ctx.save();
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2;
      ctx.font = `bold ${zSize}px monospace`;
      ctx.strokeText('Z', xOffset, yOffset);
      ctx.fillText('Z', xOffset, yOffset);
      ctx.restore();
    }
  }
  
  drawEyes(ctx, size) {
    const eyeY = this.currentIdleAnim === 'blink' && this.idleTimer < 200 ? 5 : 0;
    
    // PIXEL ART CARTOON EYES (Farming Game Style)
    
    // Eye style variations
    if (this.appearance.eye_style === 'round') {
      // White of eyes with BLACK OUTLINE (pixel art style)
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 2.5;
      
      // Left eye
      ctx.beginPath();
      ctx.arc(-size * 0.25, eyeY, size * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      // Right eye
      ctx.beginPath();
      ctx.arc(size * 0.25, eyeY, size * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      
      // Pupils (LARGER for cartoon style)
      ctx.fillStyle = '#000000';
      const pupilX = this.isDragging ? 3 : 0;
      const pupilSize = size * 0.1; // Bigger pupils = cuter!
      
      ctx.beginPath();
      ctx.arc(-size * 0.25 + pupilX, eyeY + 2, pupilSize, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(size * 0.25 + pupilX, eyeY + 2, pupilSize, 0, Math.PI * 2);
      ctx.fill();
      
      // BIG SPARKLE (anime/cartoon style)
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(-size * 0.25 + pupilX - 4, eyeY - 2, 3, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(size * 0.25 + pupilX - 4, eyeY - 2, 3, 0, Math.PI * 2);
      ctx.fill();
      
      // Small sparkle
      ctx.beginPath();
      ctx.arc(-size * 0.25 + pupilX + 3, eyeY + 4, 1.5, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.beginPath();
      ctx.arc(size * 0.25 + pupilX + 3, eyeY + 4, 1.5, 0, Math.PI * 2);
      ctx.fill();
      
    } else if (this.appearance.eye_style === 'cute') {
      // Cute ^ ^ eyes (thicker for pixel art)
      ctx.strokeStyle = '#1a1a1a';
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      
      ctx.beginPath();
      ctx.arc(-size * 0.25, eyeY, size * 0.12, 0.3, Math.PI - 0.3);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.arc(size * 0.25, eyeY, size * 0.12, 0.3, Math.PI - 0.3);
      ctx.stroke();
    }
  }

  drawHat(ctx, size) {
    ctx.save();
    ctx.translate(0, -size * 1.2);
    
    switch (this.outfit.hat) {
      case 'wizard_hat':
        // Purple wizard hat
        ctx.fillStyle = '#9B59B6';
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.5);
        ctx.lineTo(-size * 0.3, 0);
        ctx.lineTo(size * 0.3, 0);
        ctx.closePath();
        ctx.fill();
        
        // Stars
        ctx.fillStyle = '#FFD700';
        for (let i = 0; i < 3; i++) {
          this.drawStar(ctx, (i - 1) * 10, -size * 0.2 - i * 5, 4);
        }
        break;
      
      case 'crown':
        // Gold crown
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.rect(-size * 0.35, -5, size * 0.7, 10);
        ctx.fill();
        
        // Crown points
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo((i - 1) * size * 0.25, -5);
          ctx.lineTo((i - 1) * size * 0.25, -15);
          ctx.lineTo((i - 1) * size * 0.25 + 5, -5);
          ctx.fill();
        }
        break;
      
      case 'headphones':
        // Gaming headphones
        ctx.strokeStyle = '#FF1744';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.5, Math.PI, 0);
        ctx.stroke();
        
        // Ear cups
        ctx.fillStyle = '#FF1744';
        ctx.beginPath();
        ctx.arc(-size * 0.5, 0, 8, 0, Math.PI * 2);
        ctx.arc(size * 0.5, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        break;
    }
    
    ctx.restore();
  }

  drawAccessory(ctx, size) {
    switch (this.outfit.accessory) {
      case 'glasses':
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        
        // Left lens
        ctx.beginPath();
        ctx.arc(-size * 0.25, 0, size * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Right lens
        ctx.beginPath();
        ctx.arc(size * 0.25, 0, size * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Bridge
        ctx.beginPath();
        ctx.moveTo(-size * 0.07, 0);
        ctx.lineTo(size * 0.07, 0);
        ctx.stroke();
        break;
      
      case 'bowtie':
        ctx.fillStyle = '#E74C3C';
        ctx.save();
        ctx.translate(0, size * 0.6);
        
        // Bowtie
        ctx.beginPath();
        ctx.moveTo(-15, -5);
        ctx.lineTo(-20, 0);
        ctx.lineTo(-15, 5);
        ctx.lineTo(-5, 0);
        ctx.closePath();
        ctx.fill();
        
        ctx.beginPath();
        ctx.moveTo(15, -5);
        ctx.lineTo(20, 0);
        ctx.lineTo(15, 5);
        ctx.lineTo(5, 0);
        ctx.closePath();
        ctx.fill();
        
        // Center
        ctx.fillRect(-5, -3, 10, 6);
        
        ctx.restore();
        break;
    }
  }

  drawTool(ctx, size) {
    ctx.save();
    ctx.translate(size * 0.6, size * 0.3);
    
    switch (this.outfit.tool) {
      case 'wand':
        // Magic wand
        ctx.strokeStyle = '#8B4513';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(10, 20);
        ctx.stroke();
        
        // Star tip
        ctx.fillStyle = '#FFD700';
        this.drawStar(ctx, 0, 0, 6);
        
        // Sparkles
        ctx.fillStyle = 'rgba(255, 215, 0, 0.6)';
        for (let i = 0; i < 3; i++) {
          const angle = this.animFrame * 3 + i * Math.PI * 2 / 3;
          const x = Math.cos(angle) * 15;
          const y = Math.sin(angle) * 15;
          ctx.beginPath();
          ctx.arc(x, y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      
      case 'laptop':
        // Mini laptop
        ctx.fillStyle = '#34495E';
        ctx.fillRect(-12, 0, 24, 16);
        
        // Screen
        ctx.fillStyle = '#3498DB';
        ctx.fillRect(-10, 2, 20, 10);
        
        // Code lines
        ctx.strokeStyle = '#2ECC71';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.moveTo(-8, 4 + i * 3);
          ctx.lineTo(8, 4 + i * 3);
          ctx.stroke();
        }
        break;
    }
    
    ctx.restore();
  }

  drawStatusIndicator(ctx, size) {
    if (this.status === 'thinking') {
      // Thought bubbles (Pokemon-style)
      const bubbles = [
        { x: size * 0.7, y: -size * 0.8, r: 8 },
        { x: size * 0.9, y: -size * 1.1, r: 6 },
        { x: size * 1.1, y: -size * 1.4, r: 4 }
      ];
      
      ctx.fillStyle = 'rgba(255, 214, 10, 0.8)';
      bubbles.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    
    if (this.status === 'working') {
      // Loading spinner
      ctx.strokeStyle = '#06FFA5';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      ctx.save();
      ctx.translate(size, -size);
      ctx.rotate(this.animFrame * 5);
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 1.5);
      ctx.stroke();
      ctx.restore();
    }
    
    if (this.status === 'sleeping' || this.isSleeping) {
      // Zzz (Pokemon-style)
      ctx.fillStyle = 'rgba(100, 100, 200, 0.7)';
      ctx.font = 'bold 14px Arial';
      const zzz = ['Z', 'z', 'z'];
      zzz.forEach((z, i) => {
        const y = -size - 18 - i * 12 + Math.sin(this.animFrame + i) * 4;
        ctx.fillText(z, size * 0.5 + i * 8, y);
      });
    }
  }

  drawNameTag(ctx, size) {
    ctx.save();
    ctx.translate(0, size + 35);

    const hover = this.isHovered;
    const bgW = hover ? 160 : 120;
    const bgH = hover ? 30 : 24;
    const nameFont = hover ? 'bold 14px "Press Start 2P"' : 'bold 12px "Press Start 2P"';
    const levelFont = hover ? '11px "Press Start 2P"' : '10px "Press Start 2P"';

    // Background — slightly darker on hover, but NO border rectangle
    // (the blue strokeRect box on hover was visual noise — user request).
    ctx.fillStyle = hover ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(-bgW / 2, -bgH / 2, bgW, bgH);

    // Name with level
    ctx.fillStyle = '#FFFFFF';
    ctx.font = nameFont;
    ctx.textAlign = 'center';
    ctx.fillText(this.nickname, 0, -2);

    // Level indicator (server XP when available, legacy heuristic otherwise)
    ctx.fillStyle = '#FFD700';
    ctx.font = levelFont;
    const scoreBit = Number.isFinite(this.stats.avg_score) ? ` ★${this.stats.avg_score}` : '';
    ctx.fillText(`Lv.${this.stats.level} (${this.stats.tasks_completed || 0} tasks)${scoreBit}`, 0, 8);
    
    // Thinking text if available
    if (this.current_thought && this.status === 'thinking') {
      ctx.fillStyle = 'rgba(255, 214, 10, 0.9)';
      ctx.fillRect(-100, 15, 200, 40);
      
      ctx.fillStyle = '#000000';
      ctx.font = '9px Arial';
      const words = this.current_thought.split(' ');
      let line = '';
      let y = 30;
      
      words.forEach(word => {
        const testLine = line + word + ' ';
        if (ctx.measureText(testLine).width > 180 && line !== '') {
          ctx.fillText(line, 0, y);
          line = word + ' ';
          y += 12;
        } else {
          line = testLine;
        }
      });
      ctx.fillText(line, 0, y);
    }
    
    ctx.restore();
  }

  drawHeart(ctx, particle) {
    ctx.save();
    ctx.globalAlpha = particle.alpha;
    ctx.fillStyle = '#FF1744';
    ctx.translate(particle.x, particle.y);
    ctx.scale(particle.scale, particle.scale);
    
    // Heart shape
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.bezierCurveTo(-5, -2, -10, 1, 0, 10);
    ctx.bezierCurveTo(10, 1, 5, -2, 0, 3);
    ctx.fill();
    
    ctx.restore();
  }

  _drawConfetti(ctx, p) {
    // ctx is already translated to squid center (draw() did ctx.translate(this.x, this.y))
    // p.x / p.y are offsets from squid center in canvas-local space
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    ctx.fillStyle = p.color;
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    const s = p.size;
    if (p.shape === 0) {
      // Star
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * 4 * Math.PI / 5) - Math.PI / 2;
        const b = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * s, Math.sin(a) * s);
        ctx.lineTo(Math.cos(b) * s * 0.4, Math.sin(b) * s * 0.4);
      }
      ctx.closePath();
      ctx.fill();
    } else if (p.shape === 1) {
      // Circle
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Diamond
      ctx.beginPath();
      ctx.moveTo(0, -s); ctx.lineTo(s * 0.6, 0);
      ctx.lineTo(0, s);  ctx.lineTo(-s * 0.6, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawStar(ctx, x, y, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
      const x = Math.cos(angle) * size;
      const y = Math.sin(angle) * size;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  darkenColor(hex, factor) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    
    return `rgb(${Math.floor(r * factor)}, ${Math.floor(g * factor)}, ${Math.floor(b * factor)})`;
  }

  brightenColor(hex, factor) {
    const r = Math.min(255, parseInt(hex.slice(1, 3), 16) * factor);
    const g = Math.min(255, parseInt(hex.slice(3, 5), 16) * factor);
    const b = Math.min(255, parseInt(hex.slice(5, 7), 16) * factor);
    
    return `rgb(${Math.floor(r)}, ${Math.floor(g)}, ${Math.floor(b)})`;
  }

  // Interaction methods
  
  /**
   * Check if a point is over this squid
   */
  isPointOver(x, y) {
    const dx = x - this.x;
    const dy = y - (this.y - this.jumpHeight);
    const distance = Math.sqrt(dx * dx + dy * dy);
    const size = 40 * this.baseSize;
    const hitRadius = size * 1.2;
    const isOver = distance < hitRadius;
    
    // Removed verbose logging - was flooding console
    
    return isOver;
  }
  
  onClick() {
    this.clickedTime = Date.now();
    this.isJumping = true;
    this.animFrame = 0;
    
    // Increase affection
    if (this.personality.affection < 100) {
      this.personality.affection += 5;
    }
  }

  onPet() {
    this.lastPetTime = Date.now();
    
    // Spawn heart particles
    for (let i = 0; i < 3; i++) {
      this.heartParticles.push({
        x: (Math.random() - 0.5) * 40,
        y: 0,
        alpha: 1,
        scale: 0.5 + Math.random() * 0.5
      });
    }
    
    // Increase affection
    if (this.personality.affection < 100) {
      this.personality.affection += 10;
    }
    
    // Improve mood
    this.personality.mood = 'happy';
  }

  containsPoint(x, y) {
    const dx = x - this.x;
    const dy = y - (this.y - this.jumpHeight);
    const size = 40 * this.baseSize;
    return Math.sqrt(dx * dx + dy * dy) < size;
  }

  startDrag(x, y) {
    this.isDragging = true;
    this.dragOffsetX = x - this.x;
    this.dragOffsetY = y - this.y;
  }

  drag(x, y) {
    if (this.isDragging) {
      this.x = x - this.dragOffsetX;
      this.y = y - this.dragOffsetY;
    }
  }

  endDrag() {
    this.isDragging = false;
  }
}
