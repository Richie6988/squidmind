/**
 * Enhanced Squid Interactions
 * 
 * Features:
 * - Feed squids
 * - Play with squids
 * - Put to sleep
 * - Celebrate achievements
 * - Thought bubbles with chain of thought
 * - Advanced animations (spin, backflip, confetti)
 */

const SquidInteractions = {
  /**
   * Add interaction handlers to squid
   */
  enhance(squid) {
    // Interaction state
    squid.isHovered = false;
    squid.isPetting = false;
    squid.isEating = false;
    squid.thoughtBubble = null;
    
    // Add methods
    squid.showThoughtBubble = this.showThoughtBubble.bind(squid);
    squid.hideThoughtBubble = this.hideThoughtBubble.bind(squid);
    squid.doSpin = this.doSpin.bind(squid);
    squid.doBackflip = this.doBackflip.bind(squid);
    squid.showConfetti = this.showConfetti.bind(squid);
    squid.generateThought = this.generateThought.bind(squid);
    squid.generateChainOfThought = this.generateChainOfThought.bind(squid);
    squid.showFeedbackParticle = this.showFeedbackParticle.bind(squid);
  },

  /**
   * Feed squid
   */
  feed() {
    this.personality = this.personality || { energy: 50, mood: 'neutral', affection: 50 };
    this.stats = this.stats || { level: 1, experience: 0 };
    
    this.personality.energy = Math.min(100, this.personality.energy + 20);
    this.personality.mood = 'happy';
    this.showFeedbackParticle('🍕', '#FFD700');
    
    // Gain XP
    this.stats.experience += 5;
    if (this.stats.experience >= this.stats.level * 100) {
      this.stats.level++;
      this.showFeedbackParticle('⭐', '#00FF88');
    }
    
    // Eating animation
    this.isEating = true;
    setTimeout(() => this.isEating = false, 2000);
  },

  /**
   * Play with squid
   */
  play() {
    this.personality = this.personality || { energy: 50, mood: 'neutral', affection: 50 };
    
    if (this.personality.energy < 20) {
      this.showFeedbackParticle('😴', '#888');
      return;
    }
    
    this.personality.energy -= 15;
    this.personality.mood = 'playful';
    this.personality.affection = Math.min(100, this.personality.affection + 10);
    
    this.doSpin();
    this.showFeedbackParticle('[INTERACT]', '#00FF88');
  },

  /**
   * Put squid to sleep
   */
  sleep() {
    this.personality = this.personality || { energy: 50, mood: 'neutral', affection: 50 };
    
    this.personality.mood = 'sleeping';
    this.personality.energy = Math.min(100, this.personality.energy + 30);
    this.showFeedbackParticle('💤', '#A8DADC');
  },

  /**
   * Celebrate achievement
   */
  celebrate() {
    this.personality = this.personality || { energy: 50, mood: 'neutral', affection: 50 };
    
    this.personality.mood = 'excited';
    this.doBackflip();
    this.showConfetti();
    this.showFeedbackParticle('🎉', '#FFD700');
  },

  /**
   * Spin animation
   */
  doSpin() {
    const startRotation = this.rotation || 0;
    const spinDuration = 1000;
    const startTime = Date.now();
    
    const spin = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / spinDuration;
      
      if (progress < 1) {
        this.rotation = startRotation + (Math.PI * 2 * progress);
        requestAnimationFrame(spin);
      } else {
        this.rotation = startRotation;
      }
    };
    
    spin();
  },

  /**
   * Backflip animation
   */
  doBackflip() {
    const startY = this.y;
    const flipDuration = 1500;
    const startTime = Date.now();
    const startRotation = this.rotation || 0;
    
    const flip = () => {
      const elapsed = Date.now() - startTime;
      const progress = elapsed / flipDuration;
      
      if (progress < 1) {
        const arc = Math.sin(progress * Math.PI);
        this.y = startY - arc * 100;
        this.rotation = startRotation + (Math.PI * 2 * progress);
        requestAnimationFrame(flip);
      } else {
        this.y = startY;
        this.rotation = startRotation;
      }
    };
    
    flip();
  },

  /**
   * Show confetti
   */
  showConfetti() {
    this.particles = this.particles || [];
    const colors = ['#FFD700', '#FF6347', '#00FF88', '#00D4FF', '#FF00FF'];
    
    for (let i = 0; i < 15; i++) {
      setTimeout(() => {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2 + Math.random() * 3;
        const color = colors[Math.floor(Math.random() * colors.length)];
        
        this.particles.push({
          x: this.x,
          y: this.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          emoji: ['✨', '⭐', '🌟', '💫'][Math.floor(Math.random() * 4)],
          life: 60,
          color
        });
      }, i * 50);
    }
  },

  /**
   * Show thought bubble
   */
  showThoughtBubble() {
    const thought = this.generateThought();
    
    this.thoughtBubble = {
      visible: true,
      thought,
      opacity: 0,
      chainOfThought: this.generateChainOfThought()
    };
    
    const fadeIn = () => {
      if (this.thoughtBubble.opacity < 1) {
        this.thoughtBubble.opacity += 0.05;
        requestAnimationFrame(fadeIn);
      }
    };
    fadeIn();
  },

  /**
   * Hide thought bubble
   */
  hideThoughtBubble() {
    if (!this.thoughtBubble) return;
    
    const fadeOut = () => {
      if (this.thoughtBubble.opacity > 0) {
        this.thoughtBubble.opacity -= 0.1;
        requestAnimationFrame(fadeOut);
      } else {
        this.thoughtBubble.visible = false;
      }
    };
    fadeOut();
  },

  /**
   * Generate thought based on state
   */
  generateThought() {
    const personality = this.personality || { mood: 'neutral', energy: 50, affection: 50 };
    const stats = this.stats || { level: 1 };
    const { mood, energy, affection } = personality;
    const { level } = stats;
    
    if (this.status === 'working') {
      const thoughts = [
        '🤔 Analyzing...',
        '💭 Thinking...',
        '[CONFIG] Processing...',
        '🔍 Searching...',
        '✨ Creating...',
        '[OK] Finalizing...'
      ];
      const index = Math.floor(Date.now() / 2000) % thoughts.length;
      return thoughts[index];
    }
    
    if (energy < 30) {
      return ['💤 So tired...', '😴 Need rest', '⚡ Low energy'][Math.floor(Math.random() * 3)];
    }
    
    if (affection > 80) {
      return ['❤️ Happy!', '🥰 Love it here', '✨ Great mood'][Math.floor(Math.random() * 3)];
    }
    
    if (mood === 'happy') {
      return ['😊 Having fun!', '🎉 Life is good', '⭐ Ready!'][Math.floor(Math.random() * 3)];
    }
    
    if (level > 10) {
      return ['💪 Powerful!', '🏆 Expert', '⚡ Bring it'][Math.floor(Math.random() * 3)];
    }
    
    return ['🤔 Hmm...', '👋 Hi there!', '[SQUID] Squid mode'][Math.floor(Math.random() * 3)];
  },

  /**
   * Generate chain of thought
   */
  generateChainOfThought() {
    const personality = this.personality || { mood: 'neutral', energy: 50, affection: 50 };
    
    if (this.status === 'working') {
      return [
        '1️⃣ Parse input',
        '2️⃣ Plan steps',
        '3️⃣ Execute',
        '4️⃣ Validate',
        '5️⃣ Output'
      ];
    }
    
    const thoughts = [];
    
    if (personality.energy < 50) {
      thoughts.push('⚡ Energy: Low');
      thoughts.push('💭 Rest needed');
    } else {
      thoughts.push('⚡ Energy: OK');
      thoughts.push('💪 Ready');
    }
    
    if (personality.affection > 70) {
      thoughts.push('❤️ Happy');
    } else if (personality.affection < 30) {
      thoughts.push('🥺 Lonely');
    }
    
    thoughts.push('[TARGET] Waiting...');
    
    return thoughts;
  },

  /**
   * Show feedback particle
   */
  showFeedbackParticle(emoji, color) {
    this.particles = this.particles || [];
    
    this.particles.push({
      x: this.x,
      y: this.y - 30,
      vx: 0,
      vy: -2,
      emoji,
      life: 60,
      color,
      scale: 1.5
    });
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.SquidInteractions = SquidInteractions;
}
