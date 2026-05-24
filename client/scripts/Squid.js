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
    this.appearance = data.appearance || {
      body_color: '#FF6B9D',
      accent_color: '#FFE66D',
      eye_style: 'round',
      tentacle_style: 'wavy',
      size: 'medium',
      glow_intensity: 0.5
    };
    
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
    const sizes = { small: 0.8, medium: 1.0, large: 1.3 };
    return sizes[this.appearance.size] || 1.0;
  }

  update(deltaTime = 16) {
    this.animFrame += deltaTime * 0.001;
    this.glowPulse += deltaTime * 0.003;
    this.idleTimer += deltaTime;
    
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
    
    // Smooth movement toward target (for dragging)
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 1) {
      // Lerp toward target (smooth following)
      this.x += dx * 0.3; // 30% of distance per frame = smooth
      this.y += dy * 0.3;
    } else {
      // Close enough, snap to target
      this.x = this.targetX;
      this.y = this.targetY;
    }
    
    // Movement (good swimming speed) - only when idle
    if (!this.isDragging && this.status === 'idle' && distance < 1) {
      const speed = this.personality.animation_style === 'energetic' ? 1.3 : 1.0; // Slower: 1.3x/1.0x
      this.x += this.vx * speed;
      this.y += this.vy * speed;
      
      // Update target to follow
      this.targetX = this.x;
      this.targetY = this.y;
      
      // Bounce off edges
      if (this.x < 50 || this.x > 750) this.vx *= -1;
      if (this.y < 50 || this.y > 550) this.vy *= -1;
      
      // Random direction changes
      if (Math.random() < 0.015) {
        this.vx = (Math.random() - 0.5) * 3; // 1.5x
        this.vy = (Math.random() - 0.5) * 3;
      }
    }
    
    // Update heart particles
    this.heartParticles = this.heartParticles.filter(p => {
      p.y -= 2;
      p.alpha -= 0.02;
      return p.alpha > 0;
    });
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y - this.jumpHeight);
    
    const size = 40 * this.baseSize;
    
    // Background effect
    if (this.outfit.background_effect) {
      this.drawBackgroundEffect(ctx, size);
    }
    
    // Glow effect
    if (this.status !== 'sleeping') {
      this.drawGlow(ctx, size);
    }
    
    // Shadow
    this.drawShadow(ctx, size);
    
    // Main body
    this.drawBody(ctx, size);
    
    // Tentacles
    this.drawTentacles(ctx, size);
    
    // Eyes (custom from accessories, falls back to default)
    if (this.accessories && this.accessories.eyes && this.accessories.eyes !== 'round' && typeof SquidAccessories !== 'undefined') {
      SquidAccessories.drawEyes(ctx, this.accessories.eyes, size);
    } else {
      this.drawEyes(ctx, size);
    }
    
    // === V2 Pixel Art Accessories (from agent.appearance.accessories) ===
    if (typeof SquidAccessories !== 'undefined' && this.accessories) {
      if (this.accessories.outfit) SquidAccessories.drawOutfit(ctx, this.accessories.outfit, size);
      if (this.accessories.hat) SquidAccessories.drawHat(ctx, this.accessories.hat, size);
      if (this.accessories.glasses) SquidAccessories.drawGlasses(ctx, this.accessories.glasses, size);
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
    let glowColor = this.appearance.body_color;
    let intensity = this.appearance.glow_intensity;
    
    // HOVER EFFECT: Brighter glow!
    if (this.isHovered) {
      intensity = 1.0; // Max brightness!
      size = size * 1.2; // Bigger!
    } else if (this.status === 'thinking') {
      glowColor = '#FFD60A';
      intensity = 0.8 + Math.sin(this.glowPulse) * 0.2;
    } else if (this.status === 'working') {
      glowColor = '#06FFA5';
      intensity = 0.6 + Math.sin(this.glowPulse * 2) * 0.2;
    }
    
    const gradient = ctx.createRadialGradient(0, 0, size * 0.5, 0, 0, size * 1.5);
    gradient.addColorStop(0, `${glowColor}00`);
    gradient.addColorStop(0.5, `${glowColor}${Math.floor(intensity * 50).toString(16).padStart(2, '0')}`);
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
    
    // Round body with pixel-art bounce
    const bobAmount = this.personality.animation_style === 'bouncy' ? 10 : 5;
    const bob = Math.sin(this.animFrame * 2 + this.bobOffset) * bobAmount;
    
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
    
    if (this.status === 'sleeping') {
      // Zzz (Pokemon-style)
      ctx.fillStyle = 'rgba(100, 100, 200, 0.6)';
      ctx.font = 'bold 16px Arial';
      const zzz = ['Z', 'z', 'z'];
      zzz.forEach((z, i) => {
        const y = -size - 20 - i * 15 + Math.sin(this.animFrame + i) * 5;
        ctx.fillText(z, size * 0.5 + i * 10, y);
      });
    }
  }

  drawNameTag(ctx, size) {
    ctx.save();
    ctx.translate(0, size + 35);
    
    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(-60, -12, 120, 24);
    
    // Name with level
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 12px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText(this.nickname, 0, -2);
    
    // Level indicator
    ctx.fillStyle = '#FFD700';
    ctx.font = '10px "Press Start 2P"';
    ctx.fillText(`Lv.${this.stats.level}`, 0, 8);
    
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
