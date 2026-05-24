/**
 * Advanced Squid Animation System
 * Multiple animation modes: swimming, walking, working, celebrating, sleeping
 * Smooth direction changes when dragged
 * Gamification and personality
 */

class SquidAnimator {
  constructor(squid) {
    this.squid = squid;
    this.mode = 'swimming'; // swimming, walking, working, celebrating, sleeping, thinking
    this.direction = 0; // degrees (0 = right, 90 = down, 180 = left, 270 = up)
    this.targetDirection = 0;
    this.speed = 0.5;
    this.tentacleWave = 0;
    this.bodyBob = 0;
    this.eyeBlink = 0;
    this.particles = [];
    
    // Personality traits
    this.energy = 100; // 0-100
    this.happiness = 80; // 0-100
    this.focus = 50; // 0-100
  }
  
  /**
   * Update squid position and direction based on drag
   */
  updateFromDrag(newX, newY) {
    const dx = newX - this.squid.x;
    const dy = newY - this.squid.y;
    
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      // Calculate direction (in degrees)
      this.targetDirection = Math.atan2(dy, dx) * (180 / Math.PI);
      
      // Smooth rotation towards target
      const diff = this.targetDirection - this.direction;
      const normalizedDiff = ((diff + 180) % 360) - 180;
      this.direction += normalizedDiff * 0.1;
      
      // Switch to swimming mode when moving
      if (this.mode !== 'swimming') {
        this.setMode('swimming');
      }
      
      // Add water particles
      this.addWaterParticle();
    }
  }
  
  /**
   * Set animation mode
   */
  setMode(mode) {
    console.log(`[SQUID] ${this.squid.name} switching to ${mode} mode`);
    this.mode = mode;
    this.squid.animationMode = mode;
  }
  
  /**
   * Update animation frame
   */
  update(deltaTime) {
    this.tentacleWave += deltaTime * 5;
    this.bodyBob += deltaTime * 3;
    
    // Random eye blink
    if (Math.random() < 0.01) {
      this.eyeBlink = 1;
    } else {
      this.eyeBlink *= 0.9;
    }
    
    // Update based on mode
    switch(this.mode) {
      case 'swimming':
        this.updateSwimming(deltaTime);
        break;
      case 'walking':
        this.updateWalking(deltaTime);
        break;
      case 'working':
        this.updateWorking(deltaTime);
        break;
      case 'celebrating':
        this.updateCelebrating(deltaTime);
        break;
      case 'sleeping':
        this.updateSleeping(deltaTime);
        break;
      case 'thinking':
        this.updateThinking(deltaTime);
        break;
    }
    
    // Update particles
    this.updateParticles(deltaTime);
    
    // Energy/happiness decay
    this.energy = Math.max(0, this.energy - deltaTime * 0.1);
    if (this.energy < 30) {
      this.happiness = Math.max(0, this.happiness - deltaTime * 0.2);
    }
  }
  
  /**
   * Swimming animation - smooth fluid motion
   */
  updateSwimming(deltaTime) {
    const wave = Math.sin(this.tentacleWave);
    this.squid.tentacleOffset = wave * 10;
    
    const bob = Math.sin(this.bodyBob);
    this.squid.bodyBob = bob * 3;
    
    // Add subtle trail effect
    if (Math.random() < 0.1) {
      this.addWaterParticle();
    }
  }
  
  /**
   * Walking animation - bouncy step motion
   */
  updateWalking(deltaTime) {
    const step = Math.abs(Math.sin(this.tentacleWave * 1.5));
    this.squid.tentacleOffset = step * 15;
    
    const bounce = Math.abs(Math.sin(this.bodyBob * 2));
    this.squid.bodyBob = bounce * 8;
    
    // Footstep particles
    if (step > 0.95 && Math.random() < 0.3) {
      this.addFootstepParticle();
    }
  }
  
  /**
   * Working animation - focused, minimal movement
   */
  updateWorking(deltaTime) {
    const subtle = Math.sin(this.tentacleWave * 0.5);
    this.squid.tentacleOffset = subtle * 3;
    this.squid.bodyBob = 0;
    
    // Typing particles
    if (Math.random() < 0.05) {
      this.addCodeParticle();
    }
    
    // Increase focus
    this.focus = Math.min(100, this.focus + deltaTime * 0.5);
  }
  
  /**
   * Celebrating animation - excited bouncing
   */
  updateCelebrating(deltaTime) {
    const excitement = Math.sin(this.tentacleWave * 3);
    this.squid.tentacleOffset = excitement * 20;
    
    const jump = Math.abs(Math.sin(this.bodyBob * 4));
    this.squid.bodyBob = jump * 25;
    
    // Confetti particles!
    if (Math.random() < 0.2) {
      this.addConfettiParticle();
    }
    
    // Boost happiness
    this.happiness = Math.min(100, this.happiness + deltaTime * 2);
  }
  
  /**
   * Sleeping animation - slow breathing
   */
  updateSleeping(deltaTime) {
    const breath = Math.sin(this.tentacleWave * 0.3);
    this.squid.bodyBob = breath * 2;
    this.squid.tentacleOffset = 0;
    
    // Z particles
    if (Math.random() < 0.02) {
      this.addSleepParticle();
    }
    
    // Restore energy
    this.energy = Math.min(100, this.energy + deltaTime * 1);
  }
  
  /**
   * Thinking animation - head tilted, pondering
   */
  updateThinking(deltaTime) {
    const ponder = Math.sin(this.tentacleWave * 0.8);
    this.squid.tentacleOffset = ponder * 5;
    this.squid.bodyBob = ponder * 2;
    
    // Thought bubble particles
    if (Math.random() < 0.03) {
      this.addThoughtParticle();
    }
  }
  
  /**
   * Add water splash particle
   */
  addWaterParticle() {
    this.particles.push({
      type: 'water',
      x: this.squid.x,
      y: this.squid.y,
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      life: 1.0,
      color: 'rgba(100, 200, 255, 0.6)'
    });
  }
  
  /**
   * Add footstep particle
   */
  addFootstepParticle() {
    this.particles.push({
      type: 'footstep',
      x: this.squid.x,
      y: this.squid.y + 20,
      vx: 0,
      vy: 0,
      life: 0.5,
      color: 'rgba(200, 200, 200, 0.4)'
    });
  }
  
  /**
   * Add code/typing particle
   */
  addCodeParticle() {
    const chars = ['<', '>', '{', '}', '(', ')', ';', '=', '+', '-'];
    this.particles.push({
      type: 'code',
      x: this.squid.x + (Math.random() - 0.5) * 30,
      y: this.squid.y - 30,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -1,
      life: 1.0,
      char: chars[Math.floor(Math.random() * chars.length)],
      color: '#4facfe'
    });
  }
  
  /**
   * Add confetti particle
   */
  addConfettiParticle() {
    const colors = ['#ff6b6b', '#4ecdc4', '#ffe66d', '#a8e6cf', '#ff8b94'];
    this.particles.push({
      type: 'confetti',
      x: this.squid.x,
      y: this.squid.y - 40,
      vx: (Math.random() - 0.5) * 3,
      vy: -Math.random() * 3,
      life: 1.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360
    });
  }
  
  /**
   * Add sleep Z particle
   */
  addSleepParticle() {
    this.particles.push({
      type: 'sleep',
      x: this.squid.x + 30,
      y: this.squid.y - 30,
      vx: 0.2,
      vy: -0.5,
      life: 2.0,
      color: 'rgba(200, 200, 200, 0.7)'
    });
  }
  
  /**
   * Add thought bubble particle
   */
  addThoughtParticle() {
    this.particles.push({
      type: 'thought',
      x: this.squid.x + 35,
      y: this.squid.y - 35,
      vx: 0,
      vy: -0.3,
      life: 1.5,
      size: 3 + Math.random() * 3,
      color: 'rgba(255, 255, 255, 0.6)'
    });
  }
  
  /**
   * Update particles
   */
  updateParticles(deltaTime) {
    this.particles = this.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= deltaTime;
      
      // Gravity for confetti
      if (p.type === 'confetti') {
        p.vy += deltaTime * 2;
      }
      
      return p.life > 0;
    });
  }
  
  /**
   * Render particles
   */
  renderParticles(ctx) {
    this.particles.forEach(p => {
      ctx.save();
      
      switch(p.type) {
        case 'water':
        case 'footstep':
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3 * p.life, 0, Math.PI * 2);
          ctx.fill();
          break;
          
        case 'code':
          ctx.fillStyle = p.color;
          ctx.font = '12px monospace';
          ctx.globalAlpha = p.life;
          ctx.fillText(p.char, p.x, p.y);
          break;
          
        case 'confetti':
          ctx.fillStyle = p.color;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation * Math.PI / 180);
          ctx.fillRect(-2, -2, 4, 4);
          break;
          
        case 'sleep':
          ctx.fillStyle = p.color;
          ctx.font = 'bold 16px Arial';
          ctx.globalAlpha = p.life / 2;
          ctx.fillText('Z', p.x, p.y);
          break;
          
        case 'thought':
          ctx.fillStyle = p.color;
          ctx.globalAlpha = p.life / 1.5;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
          break;
      }
      
      ctx.restore();
    });
  }
  
  /**
   * Get personality status emoji
   */
  getStatusEmoji() {
    if (this.energy < 20) return '😴';
    if (this.happiness > 90) return '😄';
    if (this.happiness < 30) return '😔';
    if (this.focus > 80) return '🤓';
    return '😊';
  }
}

// Export
window.SquidAnimator = SquidAnimator;
console.log('[OK] SquidAnimator loaded - Advanced animations ready!');
