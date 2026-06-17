/**
 * SquidModal - Replace browser alert/confirm with styled modals.
 * Usage:
 *   await SquidModal.alert('Something happened')
 *   const yes = await SquidModal.confirm('Are you sure?')
 */
const SquidModal = {
  _make(html) {
    const el = document.createElement('div');
    el.className = 'squid-modal-overlay';
    el.innerHTML = `<div class="squid-modal-box">${html}</div>`;
    // z-index above everything including temple (9999) and agent form (20000)
    el.style.cssText = 'position:fixed;inset:0;z-index:30000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.65);';
    // Prevent clicks AND mouseup from propagating to underlying modals
    el.addEventListener('click',    e => e.stopPropagation());
    el.addEventListener('mouseup',  e => e.stopPropagation());
    el.addEventListener('mousedown',e => e.stopPropagation());
    document.body.appendChild(el);
    return el;
  },

  alert(msg) {
    return new Promise(resolve => {
      const el = this._make(`
        <p class="squid-modal-msg">${this._esc(msg)}</p>
        <div class="squid-modal-actions">
          <button class="btn-primary squid-modal-ok">OK</button>
        </div>
      `);
      el.querySelector('.squid-modal-ok').onclick = () => { el.remove(); resolve(); };
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === 'Escape') { el.remove(); resolve(); } });
      el.querySelector('.squid-modal-ok').focus();
    });
  },

  confirm(msg) {
    return new Promise(resolve => {
      const el = this._make(`
        <p class="squid-modal-msg">${this._esc(msg)}</p>
        <div class="squid-modal-actions">
          <button class="btn-secondary squid-modal-no">Cancel</button>
          <button class="btn-primary squid-modal-yes">Confirm</button>
        </div>
      `);
      el.querySelector('.squid-modal-yes').onclick = () => { el.remove(); resolve(true); };
      el.querySelector('.squid-modal-no').onclick  = () => { el.remove(); resolve(false); };
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') { el.remove(); resolve(true); }
        if (e.key === 'Escape') { el.remove(); resolve(false); }
      });
      el.querySelector('.squid-modal-yes').focus();
    });
  },

  prompt(title, placeholder, defaultValue) {
    return new Promise(resolve => {
      const el = this._make(`
        <p class="squid-modal-msg">${this._esc(title)}</p>
        <input class="squid-modal-input" type="text"
          placeholder="${this._esc(placeholder || '')}"
          value="${this._esc(defaultValue || '')}"
          style="width:100%;box-sizing:border-box;background:var(--ocean-deep,#020810);border:1px solid var(--border,#1e3a5f);color:var(--text-primary,#e2e8f0);border-radius:4px;padding:6px 8px;font-size:11px;margin-bottom:10px;outline:none;">
        <div class="squid-modal-actions">
          <button class="btn-secondary squid-modal-no">Cancel</button>
          <button class="btn-primary squid-modal-ok">OK</button>
        </div>
      `);
      const input = el.querySelector('.squid-modal-input');
      el.querySelector('.squid-modal-ok').onclick  = () => { el.remove(); resolve(input.value || null); };
      el.querySelector('.squid-modal-no').onclick  = () => { el.remove(); resolve(null); };
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter')  { el.remove(); resolve(input.value || null); }
        if (e.key === 'Escape') { el.remove(); resolve(null); }
      });
      input.focus();
      input.select();
    });
  },

  _esc(s) {
    return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
  }
};

window.SquidModal = SquidModal;
console.log('[OK] SquidModal loaded');
