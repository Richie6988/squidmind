/**
 * ToastManager — non-intrusive notifications for task lifecycle, agent events, dreams.
 *
 * Public API:
 *   ToastManager.show({ title, body, type: 'success'|'info'|'warn'|'error', duration, action: { label, onClick }, icon })
 *   ToastManager.dismissAll()
 *
 * Stacks bottom-right. Auto-dismiss after `duration` ms (default 6000). Click action to navigate.
 */
(function () {
  const STACK_ID = 'iaqua-toast-stack';
  const MAX_VISIBLE = 4;
  const queue = [];
  const live = new Map(); // id → element

  function ensureStack() {
    let el = document.getElementById(STACK_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = STACK_ID;
    el.style.cssText =
      'position:fixed;bottom:16px;right:16px;display:flex;flex-direction:column;' +
      'gap:8px;z-index:99998;pointer-events:none;max-width:380px;';
    document.body.appendChild(el);
    return el;
  }

  const ICONS = {
    success: '✓', info: 'ⓘ', warn: '⚠', error: '✗', dream: '☾', task: '◆', agent: '◉',
  };
  const COLORS = {
    success: '#06ffa5', info: '#4facfe', warn: '#f59e0b', error: '#ef4444',
    dream:   '#a78bfa', task:    '#4facfe', agent:   '#06ffa5',
  };

  function escape(s) {
    return String(s).replace(/[<>&"']/g, c => ({
      '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  function show(opts) {
    const id = opts.id || 'toast_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    if (live.has(id)) return; // dedupe
    const type     = opts.type || 'info';
    const duration = opts.duration ?? 6000;
    const stack    = ensureStack();

    const el = document.createElement('div');
    el.style.cssText =
      'pointer-events:auto;background:#0f2236;border:1px solid rgba(255,255,255,0.08);' +
      'border-left:3px solid ' + (COLORS[type] || COLORS.info) + ';border-radius:6px;' +
      'padding:10px 12px;font-family:system-ui,sans-serif;color:#dce8f5;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.5);' +
      'opacity:0;transform:translateX(20px);transition:opacity 0.22s ease, transform 0.22s ease;';
    const icon  = opts.icon || ICONS[type] || ICONS.info;
    const color = COLORS[type] || COLORS.info;
    el.innerHTML =
      '<div style="display:flex;gap:10px;align-items:flex-start;">' +
        '<span style="color:' + color + ';font-size:14px;line-height:1.4;flex-shrink:0;">' + escape(icon) + '</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:600;font-size:12px;color:#e2e8f0;margin-bottom:2px;">' + escape(opts.title || '') + '</div>' +
          (opts.body ? '<div style="font-size:11px;color:#94a3b8;line-height:1.45;word-break:break-word;">' + escape(opts.body) + '</div>' : '') +
          (opts.action ? '<button class="iaqua-toast-action" style="margin-top:6px;background:rgba(79,172,254,0.15);border:1px solid rgba(79,172,254,0.35);color:' + color + ';font-family:system-ui;font-size:10px;font-weight:600;padding:3px 8px;border-radius:4px;cursor:pointer;letter-spacing:0.04em;">' + escape(opts.action.label) + '</button>' : '') +
        '</div>' +
        '<button class="iaqua-toast-close" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 4px;line-height:1;">×</button>' +
      '</div>';

    el.querySelector('.iaqua-toast-close').onclick = () => dismiss(id);
    if (opts.action) {
      el.querySelector('.iaqua-toast-action').onclick = (e) => {
        e.stopPropagation();
        try { opts.action.onClick(); } catch (err) { console.warn('[Toast] action error', err); }
        dismiss(id);
      };
    }

    stack.appendChild(el);
    live.set(id, el);
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';
    });

    // Cap visible toasts
    if (live.size > MAX_VISIBLE) {
      const oldest = live.keys().next().value;
      dismiss(oldest);
    }

    if (duration > 0) setTimeout(() => dismiss(id), duration);
    return id;
  }

  function dismiss(id) {
    const el = live.get(id);
    if (!el) return;
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => { el.remove(); live.delete(id); }, 200);
  }

  function dismissAll() {
    for (const id of [...live.keys()]) dismiss(id);
  }

  window.ToastManager = { show, dismiss, dismissAll };
  console.log('[OK] ToastManager ready');
})();
