/**
 * ZoomController — global page zoom slider persisted to localStorage.
 *
 * Renders a small floating pill in the bottom-right corner with a range
 * slider (50%–200%). Applies zoom via `document.documentElement.style.zoom`,
 * which Chrome+Edge support natively and Firefox now supports too (117+).
 *
 * Persistence key: 'aquariumZoom' → integer percent (75 = 75%).
 */
window.ZoomController = {
  STORAGE_KEY: 'aquariumZoom',
  MIN: 50,
  MAX: 200,
  DEFAULT: 100,

  _current: 100,

  init() {
    // Restore saved value before anything renders so we don't get a
    // visible resize flash on load.
    const saved = parseInt(localStorage.getItem(this.STORAGE_KEY) || '', 10);
    this._current = (Number.isFinite(saved) && saved >= this.MIN && saved <= this.MAX)
      ? saved
      : this.DEFAULT;
    this._apply(this._current);
    // Wait for body before mounting the pill
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._mount());
    } else {
      this._mount();
    }
  },

  _apply(pct) {
    document.documentElement.style.zoom = (pct / 100).toString();
    this._current = pct;
  },

  _persist(pct) {
    try { localStorage.setItem(this.STORAGE_KEY, String(pct)); } catch {}
  },

  _mount() {
    if (document.getElementById('zoom-controller')) return;
    const pill = document.createElement('div');
    pill.id = 'zoom-controller';
    pill.innerHTML = `
      <button class="zc-btn" id="zc-out"  title="Zoom out (-5%)">−</button>
      <input  class="zc-slider" id="zc-slider" type="range"
              min="${this.MIN}" max="${this.MAX}" step="5" value="${this._current}"
              title="Aquarium zoom">
      <button class="zc-btn" id="zc-in"   title="Zoom in (+5%)">+</button>
      <span   class="zc-val"  id="zc-val" title="Click to reset to 100%">${this._current}%</span>
    `;
    document.body.appendChild(pill);

    const slider = pill.querySelector('#zc-slider');
    const label  = pill.querySelector('#zc-val');
    const setVal = (v) => {
      const pct = Math.max(this.MIN, Math.min(this.MAX, Math.round(v / 5) * 5));
      slider.value = pct;
      label.textContent = pct + '%';
      this._apply(pct);
      this._persist(pct);
    };
    slider.addEventListener('input',  e => setVal(parseInt(e.target.value, 10)));
    pill.querySelector('#zc-out').addEventListener('click', () => setVal(this._current - 5));
    pill.querySelector('#zc-in') .addEventListener('click', () => setVal(this._current + 5));
    label.addEventListener('click', () => setVal(this.DEFAULT));
    // Keyboard shortcut: Ctrl/Cmd + / - / 0 (0 = reset)
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '=') { setVal(this._current + 5); e.preventDefault(); }
      else if (e.key === '-')             { setVal(this._current - 5); e.preventDefault(); }
      else if (e.key === '0')             { setVal(this.DEFAULT);      e.preventDefault(); }
    });
  }
};

// Initialise immediately so zoom is applied before the aquarium canvas
// paints (avoids visible resize flash).
window.ZoomController.init();
