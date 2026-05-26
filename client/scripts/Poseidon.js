/**
 * Poseidon - God of the Ocean & Squad Dispatcher
 * 
 * REAL AI + VISIBLE IN AQUARIUM!
 * - Majestic character swimming in ocean
 * - Connects to local LLM models  
 * - Generates dynamic responses
 * - Interactive (hover, click)
 * - Real conversation intelligence
 */

class Poseidon {
  constructor() {
    this.personality = {
      title: "Poseidon, God of the Ocean",
      role: "Supreme Dispatcher & Oracle",
      mood: "wise",
      powers: ["Orchestration", "Squad Management", "Task Distribution", "Ancient Knowledge"]
    };
    
    // Visual representation in aquarium
    this.x = 100;
    this.y = 100;
    this.size = 80;
    this.rotation = 0;
    this.floatOffset = 0;
    this.visible = true;
    this.hovered = false;
    
    // Animation
    this.targetX = 100;
    this.targetY = 100;
    this.particles = [];
    this.squadsManaged = 0;
    
    // Poseidon's system prompt
  }
  /**
   * Set position in aquarium
   */
  setPosition(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Update animation
   */
  update(deltaTime) {
    // Smooth movement
    this.x += (this.targetX - this.x) * 0.05;
    this.y += (this.targetY - this.y) * 0.05;
    
    // Floating animation
    this.floatOffset += deltaTime * 0.002;
    this.rotation = Math.sin(this.floatOffset) * 0.1;
    
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      p.opacity = p.life / 60;
      
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
    
    // Emit divine particles when hovered
    if (this.hovered && Math.random() < 0.3) {
      this.particles.push({
        x: this.x + (Math.random() - 0.5) * this.size,
        y: this.y + (Math.random() - 0.5) * this.size,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.random() * 2,
        life: 60,
        opacity: 1,
        color: '#FFD700'
      });
    }
  }

  /**
   * Draw Poseidon in aquarium
   */
  draw(ctx, canvas) {
    if (!this.visible) return;
    
    // Draw particles
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    
    ctx.save();
    
    // Position with floating
    const floatY = this.y + Math.sin(this.floatOffset) * 15;
    
    ctx.translate(this.x, floatY);
    ctx.rotate(this.rotation);
    
    // Hover glow
    if (this.hovered) {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * 1.5);
      glow.addColorStop(0, 'rgba(255, 215, 0, 0.3)');
      glow.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-this.size * 1.5, -this.size * 1.5, this.size * 3, this.size * 3);
    }
    
    // Draw majestic Poseidon
    this.drawPoseidon(ctx);
    
    ctx.restore();
    
    // Name tag
    ctx.fillStyle = this.hovered ? '#FFD700' : '#06FFA5';
    ctx.font = '12px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText('POSEIDON', this.x, floatY + this.size + 20);
    
    // Level indicator
    ctx.fillStyle = '#888';
    ctx.font = '8px "Press Start 2P"';
    ctx.fillText(`Divine Level ∞`, this.x, floatY + this.size + 35);
  }

  /**
   * Draw Poseidon character - MAJESTIC GOD with beard, crown, trident!
   */
  drawPoseidon(ctx) {
    const scale = this.hovered ? 1.1 : 1;
    ctx.scale(scale, scale);
    
    // Divine aura (larger!)
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * 1.3);
    glow.addColorStop(0, 'rgba(30, 144, 255, 0.6)');
    glow.addColorStop(0.5, 'rgba(255, 215, 0, 0.3)');
    glow.addColorStop(1, 'rgba(30, 144, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-this.size * 1.3, -this.size * 1.3, this.size * 2.6, this.size * 2.6);
    
    // Body (divine robes - ocean blue with gold trim)
    ctx.fillStyle = '#1E90FF';
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, this.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // CROWN (three points - classic god crown)
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#FFA500';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Base of crown
    ctx.moveTo(-this.size * 0.4, -this.size * 0.45);
    ctx.lineTo(this.size * 0.4, -this.size * 0.45);
    // Left point
    ctx.lineTo(this.size * 0.3, -this.size * 0.65);
    // Middle point (tallest)
    ctx.lineTo(0, -this.size * 0.75);
    // Right point
    ctx.lineTo(-this.size * 0.3, -this.size * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Crown gems
    ctx.fillStyle = '#FF1493'; // Pink gem
    ctx.beginPath();
    ctx.arc(0, -this.size * 0.68, this.size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyes (wise and powerful)
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(-this.size * 0.2, -this.size * 0.1, this.size * 0.12, 0, Math.PI * 2);
    ctx.arc(this.size * 0.2, -this.size * 0.1, this.size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    
    // Pupils (deep blue)
    ctx.fillStyle = '#000080';
    ctx.beginPath();
    ctx.arc(-this.size * 0.2, -this.size * 0.1, this.size * 0.05, 0, Math.PI * 2);
    ctx.arc(this.size * 0.2, -this.size * 0.1, this.size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    
    // BEARD (flowing, majestic!)
    ctx.fillStyle = '#E0E0E0'; // White/silver beard
    ctx.strokeStyle = '#C0C0C0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Beard shape (three flowing sections)
    ctx.moveTo(-this.size * 0.3, this.size * 0.15);
    ctx.quadraticCurveTo(-this.size * 0.4, this.size * 0.4, -this.size * 0.25, this.size * 0.55);
    ctx.quadraticCurveTo(0, this.size * 0.65, this.size * 0.25, this.size * 0.55);
    ctx.quadraticCurveTo(this.size * 0.4, this.size * 0.4, this.size * 0.3, this.size * 0.15);
    ctx.lineTo(this.size * 0.2, this.size * 0.1);
    ctx.lineTo(-this.size * 0.2, this.size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Beard details (flowing lines)
    ctx.strokeStyle = '#A0A0A0';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * this.size * 0.08, this.size * 0.15);
      ctx.quadraticCurveTo(i * this.size * 0.12, this.size * 0.4, i * this.size * 0.1, this.size * 0.6);
      ctx.stroke();
    }
    
    // TRIDENT (ICONIC!)
    ctx.save();
    ctx.translate(this.size * 0.6, 0);
    
    // Trident shaft (golden)
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, -this.size * 0.3);
    ctx.lineTo(0, this.size * 0.9);
    ctx.stroke();
    
    // Trident prongs (three sharp points)
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 4;
    ctx.beginPath();
    // Middle prong (longest)
    ctx.moveTo(0, -this.size * 0.6);
    ctx.lineTo(0, -this.size * 0.3);
    // Left prong
    ctx.moveTo(-this.size * 0.15, -this.size * 0.5);
    ctx.lineTo(-this.size * 0.15, -this.size * 0.25);
    ctx.lineTo(0, -this.size * 0.3);
    // Right prong
    ctx.moveTo(this.size * 0.15, -this.size * 0.5);
    ctx.lineTo(this.size * 0.15, -this.size * 0.25);
    ctx.lineTo(0, -this.size * 0.3);
    ctx.stroke();
    
    // Prong tips (sharp!)
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(0, -this.size * 0.6, this.size * 0.05, 0, Math.PI * 2);
    ctx.arc(-this.size * 0.15, -this.size * 0.5, this.size * 0.05, 0, Math.PI * 2);
    ctx.arc(this.size * 0.15, -this.size * 0.5, this.size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }

  /**
   * Check if point is over Poseidon
   */
  isPointOver(x, y) {
    const dx = x - this.x;
    const dy = y - this.y;
    return Math.sqrt(dx * dx + dy * dy) < this.size;
  }

  /**
   * Handle click
   */
  handleClick() {
    // V2: Open the streaming chat with poseidon_brain context
    if (typeof PoseidonChat !== 'undefined') {
      PoseidonChat.open();
      return;
    }
    // Fallback to legacy panel if V2 chat not loaded
    if (typeof ui !== 'undefined') {
      ui.showPanel('poseidon');
    }
  }}

// Export singleton
const poseidon = new Poseidon();

// Make available globally
if (typeof window !== 'undefined') {
  window.poseidon = poseidon;
}

console.log('[POSEIDON] Poseidon loaded');
