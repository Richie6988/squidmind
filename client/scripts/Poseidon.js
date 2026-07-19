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

    // ── AMBIENT SYSTEM STATE ──────────────────────────────────────────────
    // Poseidon IS the status indicator: read the shared 5s poll from the
    // aquarium. loaded → trident lit; generating → aura pulses with energy;
    // dreaming → dim violet aura; nothing loaded → sleepy grey + Zzz.
    const sys = (typeof window !== 'undefined' && window.aquarium?._sysState) || null;
    const tNow = Date.now() / 1000;
    this._sysLoaded     = !!sys?.loaded;
    this._sysGenerating = !!sys?.generating;
    this._sysDreaming   = !!sys?.dreaming;

    // Divine aura — mood follows the system
    let a0 = 'rgba(30, 144, 255, 0.6)', a1 = 'rgba(255, 215, 0, 0.3)', a2 = 'rgba(30, 144, 255, 0)';
    let auraR = this.size * 1.3;
    if (this._sysDreaming) {
      a0 = 'rgba(140, 90, 220, 0.45)'; a1 = 'rgba(60, 40, 130, 0.25)'; a2 = 'rgba(60, 40, 130, 0)';
    } else if (this._sysGenerating) {
      const pulse = 0.75 + 0.25 * Math.sin(tNow * 5.5);
      a0 = `rgba(60, 200, 255, ${0.65 * pulse})`; a1 = `rgba(255, 230, 80, ${0.35 * pulse})`;
      auraR = this.size * (1.3 + 0.12 * Math.sin(tNow * 5.5));
    } else if (!this._sysLoaded) {
      a0 = 'rgba(110, 125, 150, 0.30)'; a1 = 'rgba(70, 80, 100, 0.15)'; a2 = 'rgba(70, 80, 100, 0)';
    }
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, auraR);
    glow.addColorStop(0, a0);
    glow.addColorStop(0.5, a1);
    glow.addColorStop(1, a2);
    ctx.fillStyle = glow;
    ctx.fillRect(-auraR, -auraR, auraR * 2, auraR * 2);

    // Sleepy Zzz when no model is loaded — the god naps, the system is cold.
    if (!this._sysLoaded && !this._sysDreaming) {
      ctx.fillStyle = 'rgba(180, 195, 220, 0.75)';
      ctx.font = `${Math.round(this.size * 0.22)}px "Press Start 2P", monospace`;
      ctx.textAlign = 'left';
      for (let i = 0; i < 3; i++) {
        const zt = (tNow * 0.6 + i * 0.9) % 2.7;
        const zy = -this.size * 0.85 - zt * this.size * 0.28;
        const zx = this.size * 0.55 + Math.sin(zt * 2.2) * this.size * 0.10 + i * 5;
        ctx.globalAlpha = Math.max(0, 0.8 - zt * 0.3);
        ctx.fillText('z', zx, zy);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = 'center';
    }
    
    // Body (divine robes - ocean blue with gold trim)
    ctx.fillStyle = '#1E90FF';
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, this.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // CROWN — original silhouette restored (user preference): base line up
    // to a single central peak with slanted shoulders. The 3-spike rebuild
    // was geometrically "correct" but Richard liked this look better.
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#FFA500';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-this.size * 0.4, -this.size * 0.45);   // base left
    ctx.lineTo(this.size * 0.4, -this.size * 0.45);    // base right
    ctx.lineTo(this.size * 0.3, -this.size * 0.65);    // right shoulder
    ctx.lineTo(0, -this.size * 0.75);                  // central peak
    ctx.lineTo(-this.size * 0.3, -this.size * 0.65);   // left shoulder
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Crown gem — back at -0.68, centered in the tall single peak
    ctx.fillStyle = '#FF1493'; // Pink gem
    ctx.beginPath();
    ctx.arc(0, -this.size * 0.68, this.size * 0.08, 0, Math.PI * 2);
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
    
    // TRIDENT (ICONIC!) — lit when the model is loaded, sparking while
    // generating, dull steel when the system is cold. One glance = status.
    ctx.save();
    ctx.translate(this.size * 0.6, 0);
    const s = this.size;
    const lit  = this._sysLoaded;
    const busy = this._sysGenerating;
    const GOLD_HI = lit ? '#FFD700' : '#8a8f9c';
    const GOLD_LO = lit ? '#B8860B' : '#5a5f6c';

    // Glow behind the head when lit
    if (lit) {
      const litPulse = busy ? 0.55 + 0.35 * Math.sin(tNow * 6) : 0.35;
      const tg = ctx.createRadialGradient(0, -s * 0.48, 0, 0, -s * 0.48, s * 0.45);
      tg.addColorStop(0, `rgba(120, 220, 255, ${litPulse})`);
      tg.addColorStop(1, 'rgba(120, 220, 255, 0)');
      ctx.fillStyle = tg;
      ctx.fillRect(-s * 0.45, -s * 0.95, s * 0.9, s * 0.9);
    }

    // Shaft (slight gradient for depth)
    const shaftGrad = ctx.createLinearGradient(-2, 0, 3, 0);
    shaftGrad.addColorStop(0, GOLD_LO);
    shaftGrad.addColorStop(0.5, GOLD_HI);
    shaftGrad.addColorStop(1, GOLD_LO);
    ctx.strokeStyle = shaftGrad;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.30);
    ctx.lineTo(0, s * 0.9);
    ctx.stroke();

    // Crossbar — the base the three prongs rise from
    ctx.strokeStyle = GOLD_HI;
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
    ctx.fillStyle = GOLD_HI;
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
