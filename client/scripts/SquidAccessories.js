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
      case 'headphones': this._headphones(ctx, c, size); break;
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

  _headphones(ctx, c, size) {
    // Full-size gaming headphones spanning the head width
    const s = size || 40;
    const HW = s * 0.55; // actual px half-width of headset
    const cc = s / 8;
    const R = '#DC2626', RD = '#991B1B', BK = '#1F2937', G = '#06FFA5', W = '#fff';
    // Headband arc (draw as a rectangle spanning head)
    this._rb(ctx, -HW / cc, -4, (HW * 2) / cc, 0.8, BK, '#000', cc);
    this._r(ctx, -HW / cc + 0.2, -3.8, (HW * 2) / cc - 0.4, 0.3, '#374151', cc);
    // Left ear cup
    this._rb(ctx, -HW / cc - 1, -2.5, 2, 3.5, R, RD, cc);
    this._r(ctx, -HW / cc - 0.8, -2.2, 1.6, 2.8, RD, cc);  // grille
    this._r(ctx, -HW / cc - 0.5, -1.2, 1, 0.4, G, cc);      // LED
    // Right ear cup
    this._rb(ctx, HW / cc - 1, -2.5, 2, 3.5, R, RD, cc);
    this._r(ctx, HW / cc - 0.8, -2.2, 1.6, 2.8, RD, cc);
    this._r(ctx, HW / cc - 0.5, -1.2, 1, 0.4, G, cc);
    // Mic boom (left side)
    this._rb(ctx, -HW / cc - 0.9, 0.8, 0.5, 1.5, BK, '#000', cc);
    this._rb(ctx, -HW / cc - 1.2, 2.1, 1.1, 0.7, G, '#00b37a', cc);
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
      case 'vr':         this._vr(ctx, c, size); break;
    }
    ctx.restore();
  },

  _roundGlasses(ctx, c, size) {
    // Round wire-frame glasses — 2 circular lenses framing the eyes
    // Eye centers at ±size*0.25. In cells: ±size*0.25 / (size/8) = ±2c
    const lx = -2.15, rx = 1.15; // left/right lens left edges
    const ty = -1.55, H = 2.8, W = 2.6; // top y, height, width
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
    // Retro aviator shades — big lenses, golden frame
    const lx=-2.4, rx=0.9, ty=-1.6, W=3, H=2.8;
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
    // Gold monocle on right eye + chain to collar
    const rx = 1.2, ty = -1.5, W = 2.8, H = 2.8;
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

  // ===================== OUTFITS =====================

  drawOutfit(ctx, outfitName, size) {
    if (!outfitName || outfitName === 'none') return;
    const c = size / 7;   // coarser grid — outfits are large
    ctx.save();
    switch (outfitName) {
      case 'scarf':    this._scarf(ctx, c, size); break;
      case 'tie':      this._tie(ctx, c, size); break;
      case 'cape':     this._cape(ctx, c, size); break;
      case 'lab_coat': this._labCoat(ctx, c, size); break;
      case 'armor':    this._armor(ctx, c, size); break;
    }
    ctx.restore();
  },

  _scarf(ctx, c, size) {
    // Chunky knit scarf wrapped around the neck
    const neckY = -size * 0.38 / c;  // neck level in cells
    const R = '#DC2626', W = '#fff', RD = '#991B1B';
    // Main scarf loop (3 stripes — red, white, red)
    this._rb(ctx, -4.2, neckY,       8.4, 1,   R,  RD, c);
    this._rb(ctx, -4.2, neckY+1,     8.4, 0.7, W,  '#ccc', c);
    this._rb(ctx, -4.2, neckY+1.7,   8.4, 0.9, R,  RD, c);
    // Knit texture dots
    for (let i = 0; i < 5; i++) {
      this._r(ctx, -3.5 + i * 1.5, neckY + 0.2, 0.4, 0.5, RD, c);
      this._r(ctx, -3.2 + i * 1.5, neckY + 1.2, 0.4, 0.5, '#ccc', c);
    }
    // Dangling tail (right side)
    this._rb(ctx, 2.8,  neckY+2.6, 1.2, 2.5, R, RD, c);
    this._r(ctx,  2.8,  neckY+2.6, 1.2, 0.5, W, c);
    this._r(ctx,  2.8,  neckY+3.5, 1.2, 0.5, W, c);
    // Fringe tips
    for (let i = 0; i < 4; i++) {
      this._r(ctx, 2.9 + i * 0.25, neckY + 5, 0.15, 0.6, RD, c);
    }
  },

  _tie(ctx, c, size) {
    // Sharp business tie with collar and tie pin
    const neckY = -size * 0.3 / c;
    const TI = '#1E40AF', TIL = '#3B82F6', ST = '#FBBF24', W = '#fff', GR = '#F3F4F6';
    // Shirt collar (white)
    this._rb(ctx, -2,   neckY,       4, 1.2, W, '#ccc', c);
    this._rb(ctx, -2,   neckY+0.8,   2, 0.8, GR, '#ccc', c);  // left collar fold
    this._rb(ctx,  0,   neckY+0.8,   2, 0.8, GR, '#bbb', c);  // right collar fold
    // Tie knot
    this._rb(ctx, -0.7, neckY+1.3,   1.4, 1.2, TIL, TI, c);
    // Tie body (widening downward)
    this._rb(ctx, -1,   neckY+2.5,   2, 1.2, TI, '#142972', c);
    this._rb(ctx, -1.3, neckY+3.7,   2.6, 1.2, TI, '#142972', c);
    this._rb(ctx, -1.6, neckY+4.9,   3.2, 1.5, TI, '#142972', c);
    // Diagonal stripe
    for (let i = 0; i < 4; i++) {
      this._r(ctx, -0.8 + i * 0.35, neckY + 2.2 + i * 0.7, 0.5, 0.3, ST, c);
    }
    // Tie pin
    this._rb(ctx, -1.5, neckY + 4.0, 3, 0.4, ST, '#a0720a', c);
  },

  _cape(ctx, c, size) {
    // Dramatic superhero cape with collar + inner lining + clasp
    const capY = -size * 0.35 / c;
    const R = '#9B1C1C', RL = '#DC2626', INN = '#FFD700', G = '#FFD700', BK = '#111';
    // Cape body (wide sweep)
    this._rb(ctx, -5,   capY+1,   10, 5.5, R, BK, c);
    this._rb(ctx, -4.5, capY+1.3, 9, 5, RL, R, c);
    // Inner lining shows at bottom (V-shape via two panels)
    this._rb(ctx, -5, capY+5, 2.5, 1.5, INN, '#a07a00', c);
    this._rb(ctx, 2.5, capY+5, 2.5, 1.5, INN, '#a07a00', c);
    // Shoulder collar
    this._rb(ctx, -4.5, capY, 9, 1.2, RL, BK, c);
    this._r(ctx, -4.2, capY+0.1, 8.4, 0.4, '#f87171', c);  // collar shine
    // Clasp (center)
    this._rb(ctx, -0.6, capY+0.9, 1.2, 1.2, G, '#a07a00', c);
    this._r(ctx, -0.25, capY+1.1, 0.5, 0.5, '#fff', c);  // clasp gem
    // Cape edge trim
    this._r(ctx, -5, capY+1, 0.4, 5, G, c);
    this._r(ctx, 4.6, capY+1, 0.4, 5, G, c);
  },

  _labCoat(ctx, c, size) {
    // Clean lab coat — lapels, pocket, emblem, buttons
    const coatY = -size * 0.25 / c;
    const W = '#F9FAFB', GR = '#E5E7EB', BL = '#3B82F6', RD = '#EF4444', BK = '#1a1a1a';
    // Main coat body
    this._rb(ctx, -4.5, coatY, 9, 7, W, GR, c);
    // Left lapel
    this._rb(ctx, -4.5, coatY, 2.5, 3.5, GR, BK, c);
    // Right lapel
    this._rb(ctx, 2,    coatY, 2.5, 3.5, GR, BK, c);
    // Shirt visible (blue)
    this._rb(ctx, -2, coatY+0.2, 4, 3, BL, '#1d4ed8', c);
    // Collar & lapel fold lines
    this._r(ctx, -4.2, coatY+0.1, 2, 0.3, W, c);
    this._r(ctx,  2.2, coatY+0.1, 2, 0.3, W, c);
    // Breast pocket (left)
    this._rb(ctx, -4, coatY+1.5, 2, 1.5, W, GR, c);
    this._r(ctx, -3.8, coatY+1.5, 1.6, 0.3, GR, c);
    // Pen in pocket
    this._rb(ctx, -3.5, coatY+1.4, 0.35, 2, BL, '#1d4ed8', c);
    this._r(ctx,  -3.5, coatY+1.4, 0.35, 0.3, RD, c);
    // Buttons (center front seam)
    for (let i = 0; i < 3; i++) {
      this._rb(ctx, -0.35, coatY+1.2+i*1.6, 0.7, 0.7, GR, '#9ca3af', c);
    }
    // Red cross emblem on breast
    this._r(ctx, 2.5, coatY+0.6, 0.8, 2.2, RD, c);
    this._r(ctx, 2,   coatY+1.3, 1.8, 0.8, RD, c);
  },

  _armor(ctx, c, size) {
    // Futuristic plate armor — segmented, glowing accents, sci-fi aesthetic
    const armY = -size * 0.35 / c;
    const ST = '#6B7280', STL = '#9CA3AF', STD = '#374151', C = '#06FFA5', BK = '#111';
    // Breastplate main
    this._rb(ctx, -3.8, armY+0.5, 7.6, 5.5, ST, BK, c);
    // Upper shoulder pauldrons
    this._rb(ctx, -5.2, armY, 2.5, 2.5, STL, BK, c);
    this._rb(ctx, 2.7,  armY, 2.5, 2.5, STL, BK, c);
    // Pauldron ridges
    this._r(ctx, -5, armY+0.2, 2, 0.35, '#d1d5db', c);
    this._r(ctx,  3, armY+0.2, 2, 0.35, '#d1d5db', c);
    // Chest segment lines
    this._r(ctx, -3.8, armY+2,   7.6, 0.4, BK, c);
    this._r(ctx, -3.8, armY+3.8, 7.6, 0.4, BK, c);
    // Central energy core
    this._rb(ctx, -1, armY+1.8, 2, 2, BK, C, c);
    this._rb(ctx, -0.6, armY+2.1, 1.2, 1.4, C, '#00b37a', c);
    this._r(ctx, -0.3, armY+2.3, 0.6, 0.8, '#ffffff', c);  // core glow
    // Plate highlights
    this._r(ctx, -3.5, armY+0.6, 2.5, 0.3, STL, c);
    this._r(ctx,  1,   armY+0.6, 2.5, 0.3, STL, c);
    // Waist segmented belt
    this._rb(ctx, -3.8, armY+5, 7.6, 1, STD, BK, c);
    for (let i = 0; i < 5; i++) {
      this._rb(ctx, -3.2+i*1.4, armY+5.1, 1, 0.8, ST, BK, c);
    }
    // Glowing trim lines
    this._r(ctx, -3.8, armY+0.5, 0.4, 5.5, C, c);
    this._r(ctx, 3.4,  armY+0.5, 0.4, 5.5, C, c);
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
    }
    ctx.restore();
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
  }
};

window.SquidAccessories = SquidAccessories;
console.log('[OK] SquidAccessories loaded - hats:7 glasses:4 outfits:5 eyes:5');
