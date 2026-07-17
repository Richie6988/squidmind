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
    
    // CROWN — proper three-point silhouette. (The old path went base →
    // shoulder → middle → shoulder with no valleys, which renders as ONE
    // spike with slanted sides, not a crown.)
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#FFA500';
    ctx.lineWidth = 2;
    ctx.beginPath();
    const cw = this.size;                    // shorthand
    ctx.moveTo(-cw * 0.40, -cw * 0.45);      // base left
    ctx.lineTo(-cw * 0.30, -cw * 0.68);      // ▲ left point
    ctx.lineTo(-cw * 0.15, -cw * 0.52);      // ▽ valley
    ctx.lineTo(0,          -cw * 0.78);      // ▲ middle point (tallest)
    ctx.lineTo( cw * 0.15, -cw * 0.52);      // ▽ valley
    ctx.lineTo( cw * 0.30, -cw * 0.68);      // ▲ right point
    ctx.lineTo( cw * 0.40, -cw * 0.45);      // base right
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Crown gem — centered in the middle spike (at -0.68 it overflowed the
    // spike edges; at -0.60 the spike half-width ≈ 0.10 > gem radius 0.08)
    ctx.fillStyle = '#FF1493'; // Pink gem
    ctx.beginPath();
    ctx.arc(0, -this.size * 0.60, this.size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyes (wise and powerful) — one path per eye: chained arcs in a single
    // path draw a filled chord bar between them (same bug as the trident tips).
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(-this.size * 0.2, -this.size * 0.1, this.size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(this.size * 0.2, -this.size * 0.1, this.size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    
    // Pupils (deep blue)
    ctx.fillStyle = '#000080';
    ctx.beginPath();
    ctx.arc(-this.size * 0.2, -this.size * 0.1, this.size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
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
    const s = this.size;

    // Shaft (golden, slight gradient for depth)
    const shaftGrad = ctx.createLinearGradient(-2, 0, 3, 0);
    shaftGrad.addColorStop(0, '#B8860B');
    shaftGrad.addColorStop(0.5, '#FFD700');
    shaftGrad.addColorStop(1, '#B8860B');
    ctx.strokeStyle = shaftGrad;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.30);
    ctx.lineTo(0, s * 0.9);
    ctx.stroke();

    // Crossbar — the base the three prongs rise from
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-s * 0.18, -s * 0.30);
    ctx.lineTo( s * 0.18, -s * 0.30);
    ctx.stroke();

    // Three prongs — verticals from the crossbar. Middle one longer.
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, -s * 0.30); ctx.lineTo(-s * 0.15, -s * 0.52);
    ctx.moveTo(0,         -s * 0.30); ctx.lineTo(0,         -s * 0.62);
    ctx.moveTo( s * 0.15, -s * 0.30); ctx.lineTo( s * 0.15, -s * 0.52);
    ctx.stroke();

    // Sharp triangular tips — ONE beginPath per triangle. (The old version
    // chained three arc() calls in a single path: canvas draws connecting
    // chords between chained arcs, and the fill produced a stray triangle
    // on the central spike.)
    ctx.fillStyle = '#FFD700';
    const tip = (x, yBase, h) => {
      ctx.beginPath();
      ctx.moveTo(x - s * 0.045, yBase);
      ctx.lineTo(x + s * 0.045, yBase);
      ctx.lineTo(x, yBase - h);
      ctx.closePath();
      ctx.fill();
    };
    tip(-s * 0.15, -s * 0.52, s * 0.10);
    tip(0,         -s * 0.62, s * 0.12);
    tip( s * 0.15, -s * 0.52, s * 0.10);

    // Butt cap at the bottom of the shaft
    ctx.beginPath();
    ctx.arc(0, s * 0.9, s * 0.045, 0, Math.PI * 2);
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
    if (typeof PoseidonChat !== 'undefined') PoseidonChat.open();
  }}

// Export singleton
const poseidon = new Poseidon();

// Make available globally
if (typeof window !== 'undefined') {
  window.poseidon = poseidon;
}

console.log('[POSEIDON] Poseidon loaded');
