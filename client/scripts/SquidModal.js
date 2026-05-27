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

  _esc(s) {
    return String(s ?? '').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);
  }
};

window.SquidModal = SquidModal;
console.log('[OK] SquidModal loaded');
