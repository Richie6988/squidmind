/**
 * SquidAccessories - Pixel art accessories for squids
 * 
 * Drawn relative to the squid's local coordinate system (0,0 = squid center).
 * Uses crisp pixel-art rectangles for consistent style with PixelIcons.
 * 
 * Each draw function receives (ctx, size) where size is the squid scale (~40).
 */

const SquidAccessories = {
  /**
   * Draw pixel: helper that draws a square pixel at given grid position
   * Grid: 16x16 over the squid area. cellSize = size / 12 roughly.
   */
  _px(ctx, gridX, gridY, cellSize, color, w = 1, h = 1) {
    ctx.fillStyle = color;
    ctx.fillRect(gridX * cellSize, gridY * cellSize, w * cellSize, h * cellSize);
  },

  // ==================== HATS ====================

  drawHat(ctx, hatName, size) {
    if (!hatName || hatName === 'none') return;
    const cell = size / 12;
    ctx.save();
    // Position hat ABOVE the squid head
    ctx.translate(0, -size * 0.85);

    switch (hatName) {
      case 'top_hat': this._topHat(ctx, cell); break;
      case 'cap':     this._cap(ctx, cell); break;
      case 'crown':   this._crown(ctx, cell); break;
      case 'beanie':  this._beanie(ctx, cell); break;
      case 'pirate':  this._pirateHat(ctx, cell); break;
      case 'wizard_hat': this._wizardHat(ctx, cell); break;
      case 'headphones': this._headphones(ctx, cell); break;
    }
    ctx.restore();
  },

  _topHat(ctx, c) {
    // Black top hat with red band
    // brim
    this._px(ctx, -4, 0, c, '#000000', 8, 1);
    this._px(ctx, -3.5, 1, c, '#000000', 7, 1);
    // body
    this._px(ctx, -2.5, -4, c, '#1a1a1a', 5, 5);
    // top shine
    this._px(ctx, -2, -4, c, '#333333', 1, 5);
    // red band
    this._px(ctx, -2.5, 0, c, '#DC2626', 5, 1);
  },

  _cap(ctx, c) {
    // Baseball cap (red)
    this._px(ctx, -3, -2, c, '#DC2626', 6, 3);  // crown
    this._px(ctx, -3, 1, c, '#DC2626', 8, 1);   // bill base
    this._px(ctx, -2, 2, c, '#991B1B', 8, 1);   // bill shadow
    // logo
    this._px(ctx, -0.5, -1, c, '#FFFFFF', 1, 1);
  },

  _crown(ctx, c) {
    // Gold crown with jewels
    // base
    this._px(ctx, -3, 1, c, '#FFD700', 6, 2);
    // points
    this._px(ctx, -3, -2, c, '#FFD700', 1, 3);
    this._px(ctx, -1, -3, c, '#FFD700', 1, 4);
    this._px(ctx, 1, -3, c, '#FFD700', 1, 4);
    this._px(ctx, 2, -2, c, '#FFD700', 1, 3);
    // jewels
    this._px(ctx, -3, -2, c, '#EF4444', 1, 1);
    this._px(ctx, -1, -3, c, '#3B82F6', 1, 1);
    this._px(ctx, 1, -3, c, '#10B981', 1, 1);
    this._px(ctx, 2, -2, c, '#A855F7', 1, 1);
  },

  _beanie(ctx, c) {
    // Knit beanie with pom
    this._px(ctx, -3, -1, c, '#1E40AF', 6, 3);  // body
    this._px(ctx, -3, 1, c, '#1E3A8A', 6, 1);   // hem (darker)
    this._px(ctx, -3, -1, c, '#3B82F6', 1, 1);  // light stripe
    this._px(ctx, 2, -1, c, '#3B82F6', 1, 1);
    // pom
    this._px(ctx, -0.5, -3, c, '#FFFFFF', 1, 1);
    this._px(ctx, -1, -2.5, c, '#FFFFFF', 2, 1);
  },

  _pirateHat(ctx, c) {
    // Black pirate hat with skull
    // base brim
    this._px(ctx, -5, 1, c, '#000000', 10, 1);
    // hat body (triangle-ish)
    this._px(ctx, -4, 0, c, '#1a1a1a', 8, 1);
    this._px(ctx, -3, -1, c, '#1a1a1a', 6, 1);
    this._px(ctx, -2, -2, c, '#1a1a1a', 4, 1);
    // skull
    this._px(ctx, -1, 0, c, '#FFFFFF', 2, 1);
    this._px(ctx, -1.5, 0, c, '#FFFFFF', 1, 1);  // dot
    // crossbones hint
    this._px(ctx, -1, -1, c, '#FFFFFF', 2, 1);
  },

  _wizardHat(ctx, c) {
    // Purple wizard hat with stars
    // brim
    this._px(ctx, -4, 1, c, '#7C3AED', 8, 1);
    this._px(ctx, -3, 0, c, '#7C3AED', 6, 1);
    // cone (tapering)
    this._px(ctx, -2, -1, c, '#7C3AED', 4, 1);
    this._px(ctx, -1, -2, c, '#7C3AED', 3, 1);
    this._px(ctx, -1, -3, c, '#7C3AED', 2, 1);
    this._px(ctx, 0, -4, c, '#7C3AED', 1, 1);
    // stars (yellow)
    this._px(ctx, -1, -1, c, '#FBBF24', 1, 1);
    this._px(ctx, 1, -2, c, '#FBBF24', 1, 1);
  },

  _headphones(ctx, c) {
    // Red gaming headphones
    // headband
    this._px(ctx, -3, -2, c, '#EF4444', 6, 1);
    this._px(ctx, -3, -1, c, '#DC2626', 1, 1);
    this._px(ctx, 2, -1, c, '#DC2626', 1, 1);
    // ear cups
    this._px(ctx, -4, 0, c, '#DC2626', 2, 3);
    this._px(ctx, 2, 0, c, '#DC2626', 2, 3);
    // LED dots
    this._px(ctx, -3.5, 1, c, '#06FFA5', 1, 1);
    this._px(ctx, 2.5, 1, c, '#06FFA5', 1, 1);
  },

  // ==================== GLASSES ====================

  drawGlasses(ctx, glassesName, size) {
    if (!glassesName || glassesName === 'none') return;
    const cell = size / 12;
    ctx.save();
    // Position over eyes
    ctx.translate(0, -size * 0.05);

    switch (glassesName) {
      case 'round':      this._roundGlasses(ctx, cell); break;
      case 'sunglasses': this._sunglasses(ctx, cell); break;
      case 'monocle':    this._monocle(ctx, cell); break;
      case 'vr':         this._vr(ctx, cell); break;
    }
    ctx.restore();
  },

  _roundGlasses(ctx, c) {
    // Black round frames
    // left lens
    this._px(ctx, -3, -1, c, '#000000', 1, 2);
    this._px(ctx, -3.5, -0.5, c, '#000000', 0.5, 1);
    this._px(ctx, -2.5, -1.5, c, '#000000', 2, 0.5);
    this._px(ctx, -2.5, 0.5, c, '#000000', 2, 0.5);
    this._px(ctx, -1, -1, c, '#000000', 0.5, 2);
    // right lens
    this._px(ctx, 0.5, -1, c, '#000000', 0.5, 2);
    this._px(ctx, 1, -1.5, c, '#000000', 2, 0.5);
    this._px(ctx, 1, 0.5, c, '#000000', 2, 0.5);
    this._px(ctx, 2.5, -1, c, '#000000', 0.5, 2);
    // bridge
    this._px(ctx, -1, -0.5, c, '#000000', 1.5, 0.5);
  },

  _sunglasses(ctx, c) {
    // Solid black sunglasses
    this._px(ctx, -3, -1, c, '#000000', 3, 2);
    this._px(ctx, 0, -1, c, '#000000', 3, 2);
    this._px(ctx, -0.5, -0.5, c, '#000000', 1, 0.5);
    // reflective shine
    this._px(ctx, -2.5, -0.8, c, '#FFFFFF', 0.5, 0.5);
    this._px(ctx, 0.5, -0.8, c, '#FFFFFF', 0.5, 0.5);
  },

  _monocle(ctx, c) {
    // Gold monocle on right eye + chain
    this._px(ctx, 1, -1, c, '#FFD700', 2, 0.4);
    this._px(ctx, 1, 0.6, c, '#FFD700', 2, 0.4);
    this._px(ctx, 0.6, -1, c, '#FFD700', 0.4, 2);
    this._px(ctx, 2.6, -1, c, '#FFD700', 0.4, 2);
    // chain
    this._px(ctx, 3, 0.5, c, '#FFD700', 0.3, 0.3);
    this._px(ctx, 3.5, 1, c, '#FFD700', 0.3, 0.3);
    this._px(ctx, 4, 1.5, c, '#FFD700', 0.3, 0.3);
  },

  _vr(ctx, c) {
    // VR headset (large dark band)
    this._px(ctx, -4, -1.5, c, '#1F2937', 8, 3);
    // visor highlight
    this._px(ctx, -3, -1, c, '#06FFA5', 2, 1);
    this._px(ctx, 1, -1, c, '#06FFA5', 2, 1);
    // strap
    this._px(ctx, -5, -0.5, c, '#1F2937', 1, 1);
    this._px(ctx, 4, -0.5, c, '#1F2937', 1, 1);
  },

  // ==================== OUTFITS ====================

  drawOutfit(ctx, outfitName, size) {
    if (!outfitName || outfitName === 'none') return;
    const cell = size / 12;
    ctx.save();
    // Position on body (below head)
    ctx.translate(0, size * 0.15);

    switch (outfitName) {
      case 'scarf':    this._scarf(ctx, cell); break;
      case 'tie':      this._tie(ctx, cell); break;
      case 'cape':     this._cape(ctx, cell); break;
      case 'lab_coat': this._labCoat(ctx, cell); break;
      case 'armor':    this._armor(ctx, cell); break;
    }
    ctx.restore();
  },

  _scarf(ctx, c) {
    // Red striped scarf
    this._px(ctx, -3, 0, c, '#DC2626', 6, 1.5);
    this._px(ctx, -3, 0, c, '#FFFFFF', 6, 0.3);
    this._px(ctx, -3, 1, c, '#FFFFFF', 6, 0.3);
    // tail hanging
    this._px(ctx, 2, 1.5, c, '#DC2626', 1, 2);
    this._px(ctx, 2.3, 2, c, '#FFFFFF', 0.4, 0.3);
  },

  _tie(ctx, c) {
    // Blue necktie
    this._px(ctx, -0.5, 0, c, '#1E40AF', 1, 0.5);  // knot
    this._px(ctx, -1, 0.5, c, '#3B82F6', 2, 0.5);  // top of tie
    this._px(ctx, -0.7, 1, c, '#3B82F6', 1.4, 1);
    this._px(ctx, -0.4, 2, c, '#3B82F6', 0.8, 0.6);
    // stripe
    this._px(ctx, -0.3, 1.2, c, '#FFFFFF', 0.6, 0.3);
  },

  _cape(ctx, c) {
    // Red cape behind
    this._px(ctx, -4, -1, c, '#7F1D1D', 8, 1);  // shoulders
    this._px(ctx, -4, 0, c, '#991B1B', 8, 3);   // body of cape
    this._px(ctx, -3, 3, c, '#7F1D1D', 6, 1);
    // gold trim
    this._px(ctx, -4, -1, c, '#FFD700', 8, 0.3);
  },

  _labCoat(ctx, c) {
    // White lab coat
    this._px(ctx, -3, 0, c, '#FFFFFF', 6, 4);
    // collar
    this._px(ctx, -2, 0, c, '#E5E7EB', 4, 0.4);
    // pocket
    this._px(ctx, -2.5, 1.5, c, '#E5E7EB', 1.5, 1);
    // button
    this._px(ctx, -0.3, 1, c, '#9CA3AF', 0.3, 0.3);
    this._px(ctx, -0.3, 2, c, '#9CA3AF', 0.3, 0.3);
  },

  _armor(ctx, c) {
    // Steel armor plates
    this._px(ctx, -3, 0, c, '#9CA3AF', 6, 4);
    // segments (darker lines)
    this._px(ctx, -3, 1.5, c, '#4B5563', 6, 0.3);
    this._px(ctx, -3, 3, c, '#4B5563', 6, 0.3);
    // highlight
    this._px(ctx, -2.5, 0.3, c, '#F3F4F6', 1, 0.3);
    // emblem
    this._px(ctx, -0.5, 1.7, c, '#FFD700', 1, 0.8);
  },

  // ==================== EYES ====================

  drawEyes(ctx, eyesName, size) {
    if (!eyesName || eyesName === 'round') return; // round is default
    const cell = size / 12;
    ctx.save();
    
    switch (eyesName) {
      case 'happy':  this._happyEyes(ctx, cell); break;
      case 'sleepy': this._sleepyEyes(ctx, cell); break;
      case 'angry':  this._angryEyes(ctx, cell); break;
      case 'star':   this._starEyes(ctx, cell); break;
      case 'heart':  this._heartEyes(ctx, cell); break;
    }
    ctx.restore();
  },

  _happyEyes(ctx, c) {
    // ^ ^ closed happy
    ctx.fillStyle = '#000000';
    ctx.fillRect(-2.5 * c, 0, 0.4 * c, 0.4 * c);
    ctx.fillRect(-2 * c, -0.4 * c, 0.4 * c, 0.4 * c);
    ctx.fillRect(-1.5 * c, 0, 0.4 * c, 0.4 * c);
    ctx.fillRect(1.5 * c, 0, 0.4 * c, 0.4 * c);
    ctx.fillRect(2 * c, -0.4 * c, 0.4 * c, 0.4 * c);
    ctx.fillRect(2.5 * c, 0, 0.4 * c, 0.4 * c);
  },

  _sleepyEyes(ctx, c) {
    // - - half closed
    ctx.fillStyle = '#000000';
    ctx.fillRect(-2.5 * c, 0, 1.5 * c, 0.3 * c);
    ctx.fillRect(1 * c, 0, 1.5 * c, 0.3 * c);
  },

  _angryEyes(ctx, c) {
    // \ / angled
    ctx.fillStyle = '#DC2626';
    // left eye
    ctx.fillRect(-2.5 * c, -0.5 * c, 0.3 * c, 0.3 * c);
    ctx.fillRect(-2.1 * c, -0.2 * c, 0.3 * c, 0.3 * c);
    ctx.fillRect(-1.7 * c, 0.1 * c, 0.3 * c, 0.5 * c);
    // right eye
    ctx.fillRect(2.2 * c, -0.5 * c, 0.3 * c, 0.3 * c);
    ctx.fillRect(1.8 * c, -0.2 * c, 0.3 * c, 0.3 * c);
    ctx.fillRect(1.4 * c, 0.1 * c, 0.3 * c, 0.5 * c);
  },

  _starEyes(ctx, c) {
    // * * star eyes
    const drawStar = (cx, cy) => {
      ctx.fillStyle = '#FBBF24';
      ctx.fillRect((cx - 0.6) * c, cy * c, 1.2 * c, 0.3 * c);
      ctx.fillRect(cx * c - 0.15 * c, (cy - 0.6) * c, 0.3 * c, 1.2 * c);
      ctx.fillRect((cx - 0.4) * c, (cy - 0.4) * c, 0.3 * c, 0.3 * c);
      ctx.fillRect((cx + 0.1) * c, (cy + 0.1) * c, 0.3 * c, 0.3 * c);
    };
    drawStar(-2, 0);
    drawStar(2, 0);
  },

  _heartEyes(ctx, c) {
    // ♥ ♥ heart eyes
    const drawHeart = (cx, cy) => {
      ctx.fillStyle = '#EF4444';
      ctx.fillRect((cx - 0.5) * c, cy * c, 0.4 * c, 0.4 * c);
      ctx.fillRect((cx + 0.1) * c, cy * c, 0.4 * c, 0.4 * c);
      ctx.fillRect((cx - 0.5) * c, (cy + 0.4) * c, 1 * c, 0.3 * c);
      ctx.fillRect((cx - 0.3) * c, (cy + 0.7) * c, 0.6 * c, 0.2 * c);
      ctx.fillRect((cx - 0.1) * c, (cy + 0.9) * c, 0.2 * c, 0.2 * c);
    };
    drawHeart(-2, -0.4);
    drawHeart(2, -0.4);
  }
};

window.SquidAccessories = SquidAccessories;
console.log('[OK] SquidAccessories loaded - hats:7 glasses:4 outfits:5 eyes:5');
