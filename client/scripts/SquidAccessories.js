/**
 * SquidAccessories - Pixel art accessories for squids.
 *
 * Coordinate system: (0,0) = squid body center, positive Y = down.
 * Body is a circle of radius `size` (typically 40).
 *
 * Key body landmarks (at size=40, scale by size/40):
 *   Eye centers: x=±size*0.25  y=0         radius=size*0.18
 *   Hat anchor:  y=-size*0.87              body half-width ≈ size*0.49
 *   Scarf level: y=-size*0.40              body half-width ≈ size*0.92
 *   Chest level: y=0                       body half-width ≈ size
 *
 * Base cell = size/8.  All x/y coords below are in cells unless noted.
 * At size=40: 1 cell = 5px.
 *   Eye x = ±2c, scarf y = -3.2c, hat anchor y = -7c.
 */

const SquidAccessories = {

  // Fill a rectangle at grid (gx,gy) sized (gw,gh) cells.
  _r(ctx, gx, gy, gw, gh, col, c) {
    ctx.fillStyle = col;
    ctx.fillRect(gx * c, gy * c, gw * c, gh * c);
  },

  // Outlined rectangle: fill then 1-pixel dark border.
  _rb(ctx, gx, gy, gw, gh, col, border, c) {
    ctx.fillStyle = col;
    ctx.fillRect(gx * c, gy * c, gw * c, gh * c);
    ctx.strokeStyle = border || '#111';
    ctx.lineWidth = Math.max(1, c * 0.18);
    ctx.strokeRect(gx * c + ctx.lineWidth / 2, gy * c + ctx.lineWidth / 2,
                   gw * c - ctx.lineWidth, gh * c - ctx.lineWidth);
  },

  // ===================== HATS =====================

  drawHat(ctx, hatName, size) {
    if (!hatName || hatName === 'none') return;
    const c = size / 8;
    ctx.save();
    ctx.translate(0, -size * 0.87);  // anchor: just above body top
    switch (hatName) {
      case 'top_hat':    this._topHat(ctx, c); break;
      case 'cap':        this._cap(ctx, c); break;
      case 'crown':      this._crown(ctx, c); break;
      case 'beanie':     this._beanie(ctx, c); break;
      case 'pirate':     this._pirateHat(ctx, c); break;
      case 'wizard_hat': this._wizardHat(ctx, c); break;
      case 'headphones':   this._headphones(ctx, c, size); break;
      case 'beret':        this._beret(ctx, c); break;
      case 'halo':         this._halo(ctx, c); break;
      case 'antenna':      this._antenna(ctx, c); break;
      case 'devil_horns':  this._devilHorns(ctx, c); break;
      case 'ninja_mask':   this._ninjaMask(ctx, c, size); break;
      case 'sombrero':     this._sombrero(ctx, c); break;
    }
    ctx.restore();
  },

  _topHat(ctx, c) {
    // Classic tall black top hat — wide brim, silk shine, red hatband
    const R = '#111', S = '#2a2a2a', SH = '#444', B = '#C41E3A';
    // Brim (wide, two-layer for 3-D)
    this._rb(ctx, -4.5, 0.3, 9, 0.9, S, R, c);
    this._rb(ctx, -4,   0.1, 8, 0.5, SH, R, c);
    // Crown body
    this._rb(ctx, -2.5, -5.5, 5, 5.8, R, R, c);
    // Silk highlight strip
    this._r(ctx, -2.2, -5.2, 0.6, 4.8, SH, c);
    // Hatband
    this._rb(ctx, -2.5, -0.5, 5, 0.7, B, '#7a0000', c);
    // Gold hatpin dot
    this._r(ctx, -0.3, -0.2, 0.6, 0.6, '#FFD700', c);
    // Top edge highlight
    this._r(ctx, -2.2, -5.5, 4.4, 0.3, SH, c);
  },

  _cap(ctx, c) {
    // Snapback — structured crown + flat brim + embroidered logo
    const CR = '#1E3A8A', CD = '#1e2d5e', BR = '#172554', W = '#fff';
    // Crown
    this._rb(ctx, -3, -4, 6, 4.3, CR, CD, c);
    // Crown panels (seam lines)
    this._r(ctx, -0.2, -4, 0.4, 4, CD, c);
    // Button on top
    this._rb(ctx, -0.5, -4.3, 1, 0.6, CD, BR, c);
    // Brim (flat)
    this._rb(ctx, -3.5, 0.3, 8, 0.9, BR, '#0f1a3a', c);
    this._r(ctx, -3.2, 0.3, 7.4, 0.35, CR, c);   // top highlight
    // Embroidered star on front
    this._r(ctx, -0.5, -2.5, 0.4, 0.4, W, c);    // star cross
    this._r(ctx, -0.7, -2.3, 0.4, 0.4, W, c);
    this._r(ctx, -0.3, -2.3, 0.4, 0.4, W, c);
    this._r(ctx, -0.5, -2.1, 0.4, 0.4, W, c);
  },

  _crown(ctx, c) {
    // Royal crown — five points, jeweled base, metallic finish
    const G = '#FFD700', GD = '#B8860B', J = ['#EF4444','#3B82F6','#10B981','#A855F7','#F97316'];
    // Base band
    this._rb(ctx, -3.5, -0.2, 7, 1.7, G, GD, c);
    // Ermine dots on band
    for (let i = 0; i < 5; i++) this._r(ctx, -3 + i * 1.3, 0.1, 0.5, 0.5, GD, c);
    // Five points (alternating heights)
    const pts = [[-3.5,-3.5],[-2.2,-5],[-0.5,-3.5],[0.8,-5],[2.5,-3.5]];
    pts.forEach(([x,h]) => this._rb(ctx, x, h, 1.2, Math.abs(h)-0.2+0.2, G, GD, c));
    // Jewels on points
    pts.forEach(([x,h],i) => this._rb(ctx, x+0.1, h, 1, 0.9, J[i], '#222', c));
    // Gold shine on band top
    this._r(ctx, -3.2, -0.2, 6.4, 0.3, '#FFEC8B', c);
  },

  _beanie(ctx, c) {
    // Chunky ribbed beanie + oversized pom-pom
    const B = '#1E40AF', S = '#1e3a8a', L = '#3B82F6', W = '#fff', R = '#EF4444';
    // Main body
    this._rb(ctx, -3, -4.5, 6, 5, B, S, c);
    // Rib lines (lighter stripes)
    for (let i = 0; i < 4; i++) this._r(ctx, -2.8, -4 + i * 1.1, 5.6, 0.4, L, c);
    // Coloured accent stripe
    this._rb(ctx, -3, -0.2, 6, 0.6, R, '#7a0000', c);
    // Hem fold
    this._rb(ctx, -3.5, 0.2, 7, 0.8, S, '#0f1a3a', c);
    // Pom-pom (fluffy cluster of squares)
    const P = [[-0.8,-6.2],[0,-5.8],[0.8,-6.2],[-0.5,-5.4],[0.5,-5.4]];
    P.forEach(([px,py]) => this._rb(ctx, px, py, 1, 1, W, '#ccc', c));
  },

  _pirateHat(ctx, c) {
    // Pirate tricorn with skull-and-crossbones
    const B = '#111', S = '#222', W = '#fff', G = '#FFD700';
    // Wide brim
    this._rb(ctx, -5, 0, 10, 1, S, B, c);
    // Tricorn shape (three raised corners)
    this._rb(ctx, -4.5, -0.8, 9, 1.2, B, B, c);
    this._rb(ctx, -3.5, -2.2, 7, 1.8, B, B, c);
    this._rb(ctx, -2.2, -4, 4.4, 2, B, B, c);
    // Gold trim on brim edge
    this._r(ctx, -4.8, 0, 9.6, 0.35, G, c);
    // Skull face
    this._rb(ctx, -1.2, -3.8, 2.4, 2, W, '#555', c);
    // Eyes
    this._r(ctx, -0.9, -3.4, 0.5, 0.6, B, c);
    this._r(ctx,  0.4, -3.4, 0.5, 0.6, B, c);
    // Nose
    this._r(ctx, -0.2, -2.8, 0.4, 0.3, '#888', c);
    // Crossbones
    this._r(ctx, -1.6, -1.8, 3.2, 0.35, W, c);
    this._r(ctx, -0.2, -2.4, 0.4, 1.4, W, c);
  },

  _wizardHat(ctx, c) {
    // Tall wizard hat with star constellation and glowing tip
    const P = '#5B21B6', PL = '#7C3AED', PD = '#3b0764', Y = '#FBBF24', C = '#06FFA5';
    // Wide brim
    this._rb(ctx, -4.5, 0, 9, 1, PD, '#1a0040', c);
    this._r(ctx, -4.2, 0, 8.4, 0.4, P, c);
    // Cone (tapering upward in sections)
    this._rb(ctx, -3.2, -1.5, 6.4, 1.8, P, PD, c);
    this._rb(ctx, -2.4, -3.2, 4.8, 1.8, P, PD, c);
    this._rb(ctx, -1.5, -4.8, 3, 1.8, P, PD, c);
    this._rb(ctx, -0.7, -6.2, 1.4, 1.6, P, PD, c);
    // Highlight stripe on cone
    this._r(ctx, -0.3, -6, 0.3, 5.5, PL, c);
    // Stars constellation
    [[1.2,-2.5],[2,-4],[-1,-3.5],[-2,-1.5],[0.5,-5.2]].forEach(([x,y]) => {
      this._r(ctx, x, y, 0.4, 0.4, Y, c);
      this._r(ctx, x+0.15, y-0.15, 0.1, 0.7, Y, c);
      this._r(ctx, x-0.15, y+0.15, 0.7, 0.1, Y, c);
    });
    // Glowing tip
    this._rb(ctx, -0.5, -7.2, 1, 1.2, C, '#00b37a', c);
  },

  _headphones(ctx, c) {
    // Gaming headphones — cups sit on the SIDES of the head at eye level.
    // Head radius ≈ 4c. Cups are at x = ±(4c outer) and y = -1..+2 (ear zone).
    const R = '#DC2626', RD = '#991B1B', BK = '#1F2937', G = '#06FFA5';
    const HW = 4.0;  // half-width: outer edge of cup from center
    const CY = -1.8; // cup top Y (ear center ~y=0)
    const CH = 3.6;  // cup height
    // Headband arc over the top of the head
    this._rb(ctx, -HW + 0.5, -5.2, (HW - 0.5) * 2, 0.85, BK, '#000', c);
    this._r(ctx,  -HW + 0.7, -5.0, (HW - 0.7) * 2, 0.35, '#374151', c);
    // Left ear cup (flush against head left side)
    this._rb(ctx, -HW - 1.0, CY, 2.0, CH, R, RD, c);
    this._r(ctx,  -HW - 0.75, CY + 0.3, 1.5, CH - 0.6, RD, c);   // grille
    this._r(ctx,  -HW - 0.55, CY + 1.3, 1.1, 0.4, G, c);          // LED strip
    // Right ear cup
    this._rb(ctx, HW - 1.0, CY, 2.0, CH, R, RD, c);
    this._r(ctx,  HW - 0.75, CY + 0.3, 1.5, CH - 0.6, RD, c);
    this._r(ctx,  HW - 0.55, CY + 1.3, 1.1, 0.4, G, c);
    // Foam padding rings
    this._r(ctx, -HW - 0.95, CY,        1.9, 0.3, '#450a0a', c);
    this._r(ctx, -HW - 0.95, CY + CH - 0.3, 1.9, 0.3, '#450a0a', c);
    this._r(ctx,  HW - 0.95, CY,        1.9, 0.3, '#450a0a', c);
    this._r(ctx,  HW - 0.95, CY + CH - 0.3, 1.9, 0.3, '#450a0a', c);
    // Mic boom arm (left side, below cup)
    this._rb(ctx, -HW - 0.85, CY + CH, 0.5, 1.6, BK, '#000', c);
    // Mic capsule
    this._rb(ctx, -HW - 1.2,  CY + CH + 1.4, 1.2, 0.8, G, '#00b37a', c);
    this._r(ctx,  -HW - 0.95, CY + CH + 1.5, 0.65, 0.35, '#fff', c);
  },


  _beret(ctx, c) {
    // Flat French beret — dark red with tiny stem on top
    ctx.fillStyle = '#8B1A1A';
    ctx.beginPath(); ctx.ellipse(0, -1.5*c, 3.5*c, 2*c, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#6B0000';
    ctx.beginPath(); ctx.ellipse(0, -1.5*c, 3.5*c, 0.5*c, 0, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#333'; ctx.fillRect(-0.3*c, -3.8*c, 0.6*c, 0.9*c); // stem
  },

  _halo(ctx, c) {
    // Golden glowing halo ring floating above head
    ctx.strokeStyle = '#FFD700'; ctx.lineWidth = c * 0.8;
    ctx.shadowColor = '#FFD700'; ctx.shadowBlur = 6;
    ctx.beginPath(); ctx.ellipse(0, -3.2*c, 3*c, 0.9*c, 0, 0, Math.PI*2); ctx.stroke();
    ctx.shadowBlur = 0;
    // Support pillar
    ctx.strokeStyle = 'rgba(255,215,0,0.3)'; ctx.lineWidth = c*0.3;
    ctx.beginPath(); ctx.moveTo(0, -2.3*c); ctx.lineTo(0, -3.2*c); ctx.stroke();
  },

  _antenna(ctx, c) {
    // Sci-fi antenna with glowing ball on top
    ctx.strokeStyle = '#888'; ctx.lineWidth = c*0.4;
    ctx.beginPath(); ctx.moveTo(0, -1.5*c); ctx.lineTo(0.5*c, -4*c); ctx.stroke();
    ctx.fillStyle = '#00ffb4';
    ctx.shadowColor = '#00ffb4'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(0.5*c, -4*c, c*0.7, 0, Math.PI*2); ctx.fill();
    ctx.shadowBlur = 0;
  },

  _devilHorns(ctx, c) {
    // Two red devil horns
    const horn = (x) => {
      ctx.fillStyle = '#CC0000';
      ctx.beginPath(); ctx.moveTo(x-c, -0.5*c); ctx.lineTo(x, -3.5*c); ctx.lineTo(x+c, -0.5*c); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#880000';
      ctx.beginPath(); ctx.moveTo(x-0.3*c, -0.5*c); ctx.lineTo(x+0.2*c, -3*c); ctx.lineTo(x+0.3*c, -0.5*c); ctx.closePath(); ctx.fill();
    };
    horn(-2.5*c); horn(2.5*c);
  },

  _ninjaMask(ctx, c, size) {
    // Dark mask covering forehead and across eyes
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(-4*c, -2.5*c, 8*c, 2.2*c);
    // Headband knot on side
    ctx.fillStyle = '#111'; ctx.fillRect(3.2*c, -2.2*c, 1.2*c, 1.4*c);
    // Eye slits
    ctx.fillStyle = '#FF4500'; ctx.fillRect(-2.5*c, -1.8*c, 1.6*c, 0.5*c);
    ctx.fillRect(0.9*c, -1.8*c, 1.6*c, 0.5*c);
  },

  _sombrero(ctx, c) {
    // Wide Mexican sombrero — big brim + tall crown
    const O='#D4A017', D='#8B6914', B='#111', R='#CC0000';
    this._rb(ctx, -7, 0.5, 14, 1.0, O, D, c); // wide brim
    this._rb(ctx, -7, 0.2, 14, 0.5, D, B, c); // brim shadow
    this._rb(ctx, -2.5, -3.5, 5, 3.5, O, D, c); // crown
    this._rb(ctx, -2.5, -0.2, 5, 0.5, R, B, c); // red band
    // Tiny stitching dots on brim
    for(let i=-6; i<6; i+=1.5){ctx.fillStyle=D; ctx.fillRect(i*c, 0.6*c, 0.3*c, 0.3*c);}
  },

  // ===================== GLASSES =====================

  drawGlasses(ctx, glassesName, size) {
    if (!glassesName || glassesName === 'none') return;
    const c = size / 8;
    ctx.save();
    // Eye centers are at y=0. No translate needed — draw at absolute positions.
    switch (glassesName) {
      case 'round':      this._roundGlasses(ctx, c, size); break;
      case 'sunglasses': this._sunglasses(ctx, c, size); break;
      case 'monocle':    this._monocle(ctx, c, size); break;
      case 'vr':           this._vr(ctx, c, size); break;
      case 'pixel_glasses': this._pixelGlasses(ctx, c, size); break;
      case '3d_glasses':    this._3dGlasses(ctx, c, size); break;
      case 'eyepatch':      this._eyepatch(ctx, c, size); break;
    }
    ctx.restore();
  },

  _roundGlasses(ctx, c, size) {
    // Round wire-frame glasses — 2 circular lenses framing the eyes.
    // Eye centers ±2c (= ±size*0.25 with c=size/8), radius 1.44c (Ø 2.88c).
    // Lens CENTERED on each eye: left edge = eyeCenter - W/2; ty = -H/2.
    const W = 2.9, H = 2.9;                    // ≥ eye diameter 2.88c
    const lx = -2 - W / 2, rx = 2 - W / 2;     // lens left edges, centered on ±2c
    const ty = -H / 2;
    const FR = '#2a2a2a', LE = 'rgba(120,200,255,0.18)';
    // Lens fill (subtle tint)
    this._r(ctx, lx, ty, W, H, LE, c);
    this._r(ctx, rx, ty, W, H, LE, c);
    // Frame (4-sided border)
    [lx, rx].forEach(x => {
      this._r(ctx, x,       ty,       W,   0.45, FR, c); // top
      this._r(ctx, x,       ty+H-0.4, W,   0.4,  FR, c); // bottom
      this._r(ctx, x,       ty,       0.4, H,    FR, c); // left
      this._r(ctx, x+W-0.4, ty,       0.4, H,    FR, c); // right
    });
    // Bridge
    this._r(ctx, lx+W, ty+H*0.3, rx-lx-W, 0.4, FR, c);
    // Temple arms
    this._r(ctx, lx-1.2, ty+0.2, 1.2, 0.35, FR, c);
    this._r(ctx, rx+W,   ty+0.2, 1.2, 0.35, FR, c);
    // Lens highlight
    this._r(ctx, lx+0.2, ty+0.2, 0.5, 0.4, '#ffffff', c);
    this._r(ctx, rx+0.2, ty+0.2, 0.5, 0.4, '#ffffff', c);
  },

  _sunglasses(ctx, c, size) {
    // Retro aviator shades — big lenses, golden frame, centered on eyes ±2c
    const W = 3.2, H = 3.0;
    const lx = -2 - W / 2, rx = 2 - W / 2, ty = -H / 2;
    const FR = '#B8860B', LE = 'rgba(0,0,0,0.82)', GL = 'rgba(255,255,200,0.12)';
    // Dark lenses
    this._r(ctx, lx, ty, W, H, LE, c);
    this._r(ctx, rx, ty, W, H, LE, c);
    // Gold frame
    [lx, rx].forEach(x => {
      this._r(ctx, x,       ty,       W,   0.45, FR, c);
      this._r(ctx, x,       ty+H-0.4, W,   0.4,  FR, c);
      this._r(ctx, x,       ty,       0.45, H,    FR, c);
      this._r(ctx, x+W-0.4, ty,       0.45, H,    FR, c);
    });
    // Bridge
    this._r(ctx, lx+W, ty+H*0.25, rx-lx-W, 0.45, FR, c);
    // Temple arms
    this._r(ctx, lx-1.3, ty+0.3, 1.3, 0.4, FR, c);
    this._r(ctx, rx+W,   ty+0.3, 1.3, 0.4, FR, c);
    // Lens shine
    this._r(ctx, lx+0.3, ty+0.3, 0.8, 0.5, GL, c);
    this._r(ctx, rx+0.3, ty+0.3, 0.8, 0.5, GL, c);
  },

  _monocle(ctx, c, size) {
    // Gold monocle centered on the RIGHT eye (+2c) + chain to collar
    const W = 2.9, H = 2.9;
    const rx = 2 - W / 2, ty = -H / 2;
    const G = '#FFD700', GD = '#B8860B', LE = 'rgba(200,230,255,0.15)';
    // Lens tint
    this._r(ctx, rx, ty, W, H, LE, c);
    // Gold frame
    this._r(ctx, rx,       ty,       W,   0.5,  G,  c);
    this._r(ctx, rx,       ty+H-0.4, W,   0.4,  GD, c);
    this._r(ctx, rx,       ty,       0.5,  H,    G,  c);
    this._r(ctx, rx+W-0.4, ty,       0.5,  H,    GD, c);
    // Rim highlight
    this._r(ctx, rx+0.4, ty+0.2, 0.6, 0.35, '#FFEC8B', c);
    // Chain (diagonal dots)
    for (let i = 0; i < 5; i++) {
      this._r(ctx, rx+W-0.1+i*0.55, ty+H+i*0.6, 0.4, 0.35, G, c);
    }
    // Temple arm
    this._r(ctx, rx+W, ty+0.5, 1.3, 0.4, GD, c);
  },

  _vr(ctx, c, size) {
    // Sci-fi VR headset spanning full face width
    const W = size * 0.9, BK = '#111827', TE = '#374151', C = '#06FFA5', P = '#A855F7';
    const hw = W / (size / 8) / 2;  // half-width in cells
    // Main body
    this._rb(ctx, -hw, -1.8, hw*2, 3.4, BK, '#000', c);
    // Face foam padding
    this._r(ctx, -hw+0.3, 1.2, hw*2-0.6, 0.6, TE, c);
    this._r(ctx, -hw+0.3, -1.8, 0.5, 3.4, TE, c);
    this._r(ctx, hw-0.8, -1.8, 0.5, 3.4, TE, c);
    // Left display
    this._rb(ctx, -hw+0.6, -1.3, hw-0.9, 2.2, '#0f172a', C, c);
    this._r(ctx, -hw+0.8, -1.1, hw-1.3, 1.8, 'rgba(6,255,165,0.12)', c);
    // Right display
    this._rb(ctx, 0.3, -1.3, hw-0.9, 2.2, '#0f172a', P, c);
    this._r(ctx, 0.5, -1.1, hw-1.3, 1.8, 'rgba(168,85,247,0.12)', c);
    // Nose bridge notch
    this._r(ctx, -0.4, 0.6, 0.8, 1.2, BK, c);
    // Status LED
    this._rb(ctx, hw-1.5, -0.3, 0.7, 0.7, C, '#00b37a', c);
    // Strap side nubs
    this._rb(ctx, -hw-1, -0.8, 1.2, 1.6, TE, '#000', c);
    this._rb(ctx, hw-0.2, -0.8, 1.2, 1.6, TE, '#000', c);
  },

  _pixelGlasses(ctx, c, size) {
    // Chunky 8-bit pixel glasses — black square frames, cyan tint, on eyes ±2c
    const W = 3.0, H = 3.0;
    const lx = -2 - W / 2, rx = 2 - W / 2, ty = -H / 2;
    const FR = '#000000', LE = 'rgba(125,211,252,0.30)', SH = '#FFFFFF';
    // Tinted lenses
    this._r(ctx, lx, ty, W, H, LE, c);
    this._r(ctx, rx, ty, W, H, LE, c);
    // Thick chunky frame (each side is 1 pixel cell wide)
    [lx, rx].forEach(x => {
      this._r(ctx, x,         ty,         W,   0.6, FR, c);  // top
      this._r(ctx, x,         ty + H - 0.6, W, 0.6, FR, c);  // bottom
      this._r(ctx, x,         ty,         0.6, H,   FR, c);  // left
      this._r(ctx, x + W - 0.6, ty,       0.6, H,   FR, c);  // right
    });
    // Bridge (thick)
    this._r(ctx, lx + W, ty + H * 0.35, rx - lx - W, 0.55, FR, c);
    // Temple arms
    this._r(ctx, lx - 1.2, ty + 0.4, 1.2, 0.5, FR, c);
    this._r(ctx, rx + W,   ty + 0.4, 1.2, 0.5, FR, c);
    // Pixel shine — single corner cell on each lens
    this._r(ctx, lx + 0.6, ty + 0.6, 0.6, 0.6, SH, c);
    this._r(ctx, rx + 0.6, ty + 0.6, 0.6, 0.6, SH, c);
  },

  _3dGlasses(ctx, c, size) {
    // Classic cyan/magenta 3D glasses — paper frame, lenses on eyes ±2c
    const W = 3.0, H = 2.6;
    const lx = -2 - W / 2, rx = 2 - W / 2, ty = -H / 2;
    const FR = '#1a1a1a';
    const LCYAN = 'rgba(0,212,255,0.55)';
    const LRED  = 'rgba(255,40,90,0.55)';
    // Left lens — cyan
    this._r(ctx, lx, ty, W, H, LCYAN, c);
    // Right lens — magenta/red
    this._r(ctx, rx, ty, W, H, LRED, c);
    // Black frame (thin)
    [lx, rx].forEach(x => {
      this._r(ctx, x,         ty,         W,   0.35, FR, c);
      this._r(ctx, x,         ty + H - 0.35, W, 0.35, FR, c);
      this._r(ctx, x,         ty,         0.35, H,    FR, c);
      this._r(ctx, x + W - 0.35, ty,       0.35, H,    FR, c);
    });
    // Bridge
    this._r(ctx, lx + W, ty + H * 0.3, rx - lx - W, 0.35, FR, c);
    // Temple arms
    this._r(ctx, lx - 1.1, ty + 0.3, 1.1, 0.3, FR, c);
    this._r(ctx, rx + W,   ty + 0.3, 1.1, 0.3, FR, c);
  },

  _eyepatch(ctx, c, size) {
    // Black pirate eyepatch centered on the RIGHT eye (+2c) + strap
    const W = 3.0, H = 3.0;
    const rx = 2 - W / 2, ty = -H / 2;
    const PA = '#0a0a0a', ST = '#1f1f1f';
    // Patch (rounded square — slightly inset corners)
    this._r(ctx, rx + 0.3, ty,         W - 0.6, H,         PA, c);  // mid stripe
    this._r(ctx, rx,       ty + 0.3,   W,       H - 0.6,   PA, c);
    // Single highlight pixel for material
    this._r(ctx, rx + 0.6, ty + 0.6, 0.6, 0.6, '#3a3a3a', c);
    // Strap going up-left and down-left across the head
    this._r(ctx, rx - 3.0, ty - 0.2, 3.2, 0.4, ST, c);  // upper strap
    this._r(ctx, rx - 3.0, ty + H - 0.2, 3.2, 0.4, ST, c); // lower strap
  },

  // ===================== OUTFITS (shoes at tentacle tips) =====================
  // Shoes are drawn at the tip of each tentacle.
  // Tentacles use ctx.rotate((2π/6)*i) then draw from y=size*0.7 to y=size*1.5.
  // Tip in rotated frame = (wave*2, size*1.5). We replicate that transform.

  drawOutfit(ctx, outfitName, size, animFrame) {
    if (!outfitName || outfitName === 'none') return;
    ctx.save();
    const af = animFrame || 0;
    const TENTACLES = 6;
    for (let i = 0; i < TENTACLES; i++) {
      ctx.save();
      ctx.rotate((Math.PI * 2 / TENTACLES) * i);
      const wave = Math.sin(af * 3 + i) * 5;
      // Move to tentacle tip (matching drawTentacles wavy path)
      ctx.translate(wave * 2, size * 1.5);
      switch (outfitName) {
        case 'scarf':    this._shoeSneaker(ctx, size, i); break;
        case 'tie':      this._shoeLoafer(ctx, size, i); break;
        case 'cape':     this._shoeBoots(ctx, size, i); break;
        case 'lab_coat': this._shoeLabShoe(ctx, size, i); break;
        case 'armor':    this._shoeArmorBoot(ctx, size, i); break;
        case 'hoodie':   this._shoeHoodie(ctx, size, i); break;
        case 'kimono':   this._shoeKimono(ctx, size, i); break;
        case 'cloak':    this._shoeCloak(ctx, size, i); break;
      }
      ctx.restore();
    }
    ctx.restore();
  },

  // Shoe helpers — drawn at (0,0) = tentacle tip, facing down.
  // w/h in pixels derived from size to scale properly.

  _shoeBase(ctx, col, sole, size) {
    const w = size * 0.28, h = size * 0.16;
    // Upper
    ctx.fillStyle = col;
    ctx.strokeStyle = '#111';
    ctx.lineWidth = Math.max(1, size * 0.03);
    ctx.beginPath();
    ctx.roundRect(-w * 0.5, -h, w, h, 2);
    ctx.fill(); ctx.stroke();
    // Sole (wider, slightly below)
    ctx.fillStyle = sole;
    ctx.beginPath();
    ctx.roundRect(-w * 0.6, -2, w * 1.2, size * 0.07, 1);
    ctx.fill(); ctx.stroke();
  },

  _shoeSneaker(ctx, size, i) {
    // Colourful sneaker — alternating colours per leg
    const COLS = ['#EF4444','#3B82F6','#10B981','#F59E0B','#A855F7','#EC4899'];
    const col  = COLS[i % COLS.length];
    this._shoeBase(ctx, col, '#1a1a1a', size);
    // Lace stripe
    ctx.fillStyle = '#fff';
    ctx.fillRect(-size * 0.08, -size * 0.13, size * 0.16, size * 0.04);
    // Toe cap highlight
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.ellipse(size * 0.06, -size * 0.12, size * 0.06, size * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  },

  _shoeLoafer(ctx, size, i) {
    // Classic brown loafer with buckle
    const col = i % 2 === 0 ? '#92400E' : '#78350F';
    this._shoeBase(ctx, col, '#451A03', size);
    // Buckle
    ctx.strokeStyle = '#FFD700'; ctx.lineWidth = Math.max(1, size*0.025);
    ctx.strokeRect(-size*0.05, -size*0.12, size*0.1, size*0.07);
    ctx.fillStyle = '#FFD700';
    ctx.fillRect(-size*0.01, -size*0.11, size*0.02, size*0.05);
  },

  _shoeBoots(ctx, size, i) {
    // Tall black boot with red trim
    const w = size * 0.26, h = size * 0.22;
    ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = '#333'; ctx.lineWidth = Math.max(1, size*0.03);
    ctx.beginPath(); ctx.roundRect(-w*0.5, -h, w, h, 2); ctx.fill(); ctx.stroke();
    // Red trim stripe
    ctx.fillStyle = '#DC2626';
    ctx.fillRect(-w*0.5, -size*0.08, w, size*0.04);
    // Sole
    ctx.fillStyle = '#555'; ctx.strokeStyle = '#111';
    ctx.beginPath(); ctx.roundRect(-w*0.6, -size*0.02, w*1.2, size*0.07, 1); ctx.fill(); ctx.stroke();
    // Lace holes
    ctx.fillStyle = '#888';
    [-0.12,-0.16,-0.20].forEach(y => {
      ctx.beginPath(); ctx.arc(-size*0.04, y*size, size*0.015, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc( size*0.04, y*size, size*0.015, 0, Math.PI*2); ctx.fill();
    });
  },

  _shoeLabShoe(ctx, size, i) {
    // White lab clog / slip-on
    const col = '#F9FAFB';
    this._shoeBase(ctx, col, '#D1D5DB', size);
    // Blue toe cap
    ctx.fillStyle = '#3B82F6';
    ctx.beginPath();
    ctx.ellipse(size*0.07, -size*0.12, size*0.07, size*0.055, 0, 0, Math.PI*2);
    ctx.fill();
    // White cross on toe
    ctx.fillStyle = '#fff'; ctx.fillRect(-size*0.01, -size*0.14, size*0.02, size*0.06);
    ctx.fillRect(-size*0.03, -size*0.12, size*0.06, size*0.02);
  },

  _shoeArmorBoot(ctx, size, i) {
    // Armored sabatons — segmented metal with cyan glow edge
    const w = size * 0.30, h = size * 0.24;
    ctx.fillStyle = '#6B7280'; ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1, size*0.03);
    ctx.beginPath(); ctx.roundRect(-w*0.5, -h, w, h, 2); ctx.fill(); ctx.stroke();
    // Segment lines
    ctx.strokeStyle = '#374151'; ctx.lineWidth = Math.max(1, size*0.02);
    [-0.14,-0.20].forEach(y => { ctx.beginPath(); ctx.moveTo(-w*0.5, y*size); ctx.lineTo(w*0.5, y*size); ctx.stroke(); });
    // Plate highlight
    ctx.fillStyle = '#9CA3AF';
    ctx.fillRect(-w*0.4, -h+size*0.01, w*0.3, size*0.03);
    // Cyan glow edge
    ctx.strokeStyle = '#06FFA5'; ctx.lineWidth = Math.max(1.5, size*0.025);
    ctx.beginPath(); ctx.moveTo(-w*0.5, -h); ctx.lineTo(-w*0.5, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( w*0.5, -h); ctx.lineTo( w*0.5, 0); ctx.stroke();
    // Sole
    ctx.fillStyle = '#1a1a1a'; ctx.strokeStyle = '#06FFA5'; ctx.lineWidth = Math.max(1, size*0.02);
    ctx.beginPath(); ctx.roundRect(-w*0.6, -size*0.02, w*1.2, size*0.07, 1); ctx.fill(); ctx.stroke();
  },



  _shoeHoodie(ctx, size, i) {
    // Colourful sneaker with hoodie strings
    const w=size*0.28, h=size*0.17;
    ctx.fillStyle='#4A90D9'; ctx.fillRect(-w/2, -h, w, h);
    ctx.fillStyle='#2c5f8a'; ctx.fillRect(-w/2, 0, w, h*0.35);
    ctx.fillStyle='#fff'; ctx.fillRect(-w/4, -h*0.6, w*0.5, h*0.3);
  },

  _shoeKimono(ctx, size, i) {
    // Japanese-style kimono sash end
    const w=size*0.22, h=size*0.2;
    ctx.fillStyle='#E8A0A0'; ctx.fillRect(-w/2, -h, w, h);
    ctx.fillStyle='#C47070';
    ctx.beginPath(); ctx.moveTo(-w/2,-h); ctx.lineTo(0,-h*0.4); ctx.lineTo(w/2,-h); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#F5D5D5'; ctx.fillRect(-w/2, -h*0.25, w, h*0.15);
  },

  _shoeCloak(ctx, size, i) {
    // Dark flowing cloak hem
    const w=size*0.3, h=size*0.22;
    ctx.fillStyle='#1a1040';
    ctx.beginPath(); ctx.moveTo(-w/2, -h); ctx.lineTo(w/2, -h);
    ctx.lineTo(w/2*1.2, 0); ctx.lineTo(-w/2*1.2, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle='#2d1f60'; ctx.fillRect(-w/2, -h, w, h*0.2);
    ctx.fillStyle='rgba(150,100,255,0.4)'; ctx.fillRect(-w/2+w*0.4, -h, w*0.08, h);
  },

  // ===================== EYES =====================

  drawEyes(ctx, eyesName, size) {
    if (!eyesName || eyesName === 'round') return;
    const c = size / 10;  // finer grid for eye expressions
    ctx.save();
    switch (eyesName) {
      case 'happy':  this._happyEyes(ctx, c, size); break;
      case 'sleepy': this._sleepyEyes(ctx, c, size); break;
      case 'angry':  this._angryEyes(ctx, c, size); break;
      case 'star':   this._starEyes(ctx, c, size); break;
      case 'heart':  this._heartEyes(ctx, c, size); break;
      case 'dizzy':     this._dizzyEyes(ctx, c, size); break;
      case 'wink':      this._winkEyes(ctx, c, size); break;
      case 'surprised': this._surprisedEyes(ctx, c, size); break;
      case 'laser':     this._laserEyes(ctx, c, size); break;
    }
    ctx.restore();
  },

  // Default round eyes — drawEyes('round') returns early so we keep the
  // squid's own default rendering. Exposed publicly so the AgentForm tile
  // preview can render a visible "round" tile instead of an empty one.
  drawRoundEyes(ctx, size) {
    const c = size / 10;
    // Eye centres at ±size*0.25 → ±2.5c. Match the Squid body's default
    // round eyes: small white sclera + black pupil per eye.
    [-2.5, 2.5].forEach(ex => {
      this._r(ctx, ex - 1.0, -1.0, 2.0, 2.0, '#FFFFFF', c);  // sclera
      this._r(ctx, ex - 0.5, -0.5, 1.0, 1.0, '#111111', c);  // pupil
      this._r(ctx, ex - 0.3, -0.7, 0.4, 0.4, '#FFFFFF', c);  // catch-light
    });
  },

  _happyEyes(ctx, c, size) {
    // Big curved happy ^^ eyes (arc approximated with rects)
    // Eye centers at ±size*0.25. In cells: ±size*0.25/(size/10) = ±2.5c
    [[-2.5], [2.5]].forEach(([ex]) => {
      // ^ shape: 3 dots forming upward arc
      ctx.fillStyle = '#111';
      this._r(ctx, ex-0.8, 0.3, 0.7, 0.7, '#111', c);
      this._r(ctx, ex-0.1, -0.2, 0.7, 0.7, '#111', c);
      this._r(ctx, ex+0.6, 0.3, 0.7, 0.7, '#111', c);
      // Rosy cheek
      this._r(ctx, ex-0.5, 1.0, 1.5, 0.6, 'rgba(255,100,100,0.45)', c);
    });
  },

  _sleepyEyes(ctx, c, size) {
    // Heavy-lidded half-closed eyes
    const EW = size * 0.36 / c, EH = size * 0.18 / c;
    [[-2.5, 1], [2.5, -1]].forEach(([ex]) => {
      // White of eye (half visible)
      this._r(ctx, ex - EW/2, -EH/2, EW, EH, '#fff', c);
      // Drooping lid covers top half
      this._r(ctx, ex - EW/2 - 0.1, -EH/2 - 0.1, EW + 0.2, EH * 0.55, '#111', c);
      // Pupil (small, looking down)
      this._r(ctx, ex - 0.3, 0, 0.6, 0.5, '#111', c);
      // Lash lines
      this._r(ctx, ex - EW/2, -EH/2, EW, 0.3, '#333', c);
    });
    // Z Z floating above (sleepy symbol)
    ctx.fillStyle = '#94A3B8';
    ctx.font = `bold ${c * 1.8}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('z', 3.5 * c, -size * 0.5);
  },

  _angryEyes(ctx, c, size) {
    // Slanted angry brows + glowing red pupils
    [[-2.5, -1], [2.5, 1]].forEach(([ex, dir]) => {
      const EW = size * 0.36 / c, EH = size * 0.32 / c;
      // Eyeball
      this._r(ctx, ex - EW/2, -EH/2, EW, EH, '#fff', c);
      // Red glowing pupil
      this._r(ctx, ex - 0.4, -0.3, 0.8, 0.8, '#DC2626', c);
      this._r(ctx, ex - 0.2, -0.1, 0.4, 0.4, '#ff9999', c); // hot center
      // Angry brow (slanted inward)
      this._r(ctx, ex - EW/2, -EH*0.8, EW * 0.5, 0.5, '#333', c);
      this._r(ctx, ex,        -EH,     EW * 0.5, 0.5, '#333', c);
    });
  },

  _starEyes(ctx, c, size) {
    // Gold star eyes ★★
    [[-2.5], [2.5]].forEach(([ex]) => {
      const Y = '#FBBF24', O = '#F97316';
      // 8-pointed star via crossing rects
      this._r(ctx, ex-1.1, -0.3, 2.2, 0.6, Y, c);  // horiz bar
      this._r(ctx, ex-0.3, -1.1, 0.6, 2.2, Y, c);  // vert bar
      this._r(ctx, ex-0.8, -0.8, 0.5, 0.5, Y, c);  // diag TL
      this._r(ctx, ex+0.3, -0.8, 0.5, 0.5, Y, c);  // diag TR
      this._r(ctx, ex-0.8,  0.3, 0.5, 0.5, Y, c);  // diag BL
      this._r(ctx, ex+0.3,  0.3, 0.5, 0.5, Y, c);  // diag BR
      // Hot center
      this._r(ctx, ex-0.3, -0.3, 0.6, 0.6, O, c);
      this._r(ctx, ex-0.15,-0.15, 0.3, 0.3, '#fff', c);
    });
  },

  _heartEyes(ctx, c, size) {
    // Pixel heart eyes ♥♥
    [[-2.5], [2.5]].forEach(([ex]) => {
      const R = '#EF4444', RH = '#FDA4AF';
      // Classic pixel heart shape
      this._r(ctx, ex-1.1, -1.0, 0.9, 0.9, R, c);  // TL bump
      this._r(ctx, ex+0.2, -1.0, 0.9, 0.9, R, c);  // TR bump
      this._r(ctx, ex-1.1, -0.1, 2.0, 0.9, R, c);  // middle row
      this._r(ctx, ex-0.7,  0.8, 1.4, 0.8, R, c);  // lower
      this._r(ctx, ex-0.3,  1.5, 0.6, 0.6, R, c);  // tip
      // Highlights
      this._r(ctx, ex-0.9, -0.9, 0.4, 0.35, RH, c);
      this._r(ctx, ex+0.3, -0.9, 0.4, 0.35, RH, c);
    });
  },
  _dizzyEyes(ctx, c, size) {
    [[-2.5],[2.5]].forEach(([ex]) => {
      // X shape for dizziness
      ctx.strokeStyle='#111'; ctx.lineWidth=c*0.6;
      ctx.beginPath(); ctx.moveTo((ex-0.8)*c,-0.8*c); ctx.lineTo((ex+0.8)*c,0.8*c); ctx.stroke();
      ctx.beginPath(); ctx.moveTo((ex+0.8)*c,-0.8*c); ctx.lineTo((ex-0.8)*c,0.8*c); ctx.stroke();
    });
  },

  _winkEyes(ctx, c, size) {
    // Left eye normal, right eye winking (closed line)
    ctx.fillStyle='#111';
    ctx.beginPath(); ctx.arc(-2.5*c, 0, 0.9*c, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle='rgba(255,255,255,0.7)'; ctx.beginPath(); ctx.arc(-2.8*c,-0.3*c,0.3*c,0,Math.PI*2); ctx.fill();
    // Wink = closed arc
    ctx.strokeStyle='#111'; ctx.lineWidth=c*0.65;
    ctx.beginPath(); ctx.arc(2.4*c, 0.1*c, 0.9*c, Math.PI*0.1, Math.PI*0.9); ctx.stroke();
  },

  _surprisedEyes(ctx, c, size) {
    [[-2.5],[2.5]].forEach(([ex]) => {
      // Wide open circle eyes
      ctx.strokeStyle='#111'; ctx.lineWidth=c*0.5;
      ctx.beginPath(); ctx.arc(ex*c, 0, 1.1*c, 0, Math.PI*2); ctx.stroke();
      ctx.fillStyle='#111'; ctx.beginPath(); ctx.arc(ex*c, 0, 0.55*c, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc((ex-0.3)*c,-0.35*c,0.28*c,0,Math.PI*2); ctx.fill();
    });
  },

  _laserEyes(ctx, c, size) {
    [[-2.5],[2.5]].forEach(([ex]) => {
      ctx.fillStyle='#FF0000';
      ctx.shadowColor='#FF0000'; ctx.shadowBlur=10;
      ctx.beginPath(); ctx.arc(ex*c, 0, 0.9*c, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
      // Laser beam
      ctx.strokeStyle='rgba(255,50,50,0.8)'; ctx.lineWidth=c*0.35;
      ctx.beginPath(); ctx.moveTo((ex>0?ex+0.9:ex-0.9)*c, 0); ctx.lineTo((ex>0?ex+5:ex-5)*c, 0); ctx.stroke();
    });
  }

};

window.SquidAccessories = SquidAccessories;
console.log('[OK] SquidAccessories loaded - hats:13 glasses:7 outfits:8 eyes:10');
