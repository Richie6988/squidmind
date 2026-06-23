// ── Global error boundary for IAQUA client ──
// Catches uncaught exceptions and unhandled Promise rejections.
// Shows a non-intrusive toast at bottom-right so the user knows something went wrong
// instead of silent freeze (e.g. when canvas RAF loop dies).

(function () {
  let toastQueue = [];
  let toastEl = null;
  let dismissTimer = null;
  let errorCount = 0;
  const MAX_TOASTS = 5;
  const RECENT_ERRORS = new Map(); // message → timestamp (dedupe spam)

  function ensureToast() {
    if (toastEl) return toastEl;
    toastEl = document.createElement('div');
    toastEl.id = 'iaqua-error-toast';
    toastEl.style.cssText =
      'position:fixed;bottom:16px;right:16px;max-width:380px;background:#1a1a2e;' +
      'border:1px solid rgba(239,68,68,0.45);border-left:3px solid #ef4444;' +
      'border-radius:6px;padding:10px 14px;font-family:system-ui,sans-serif;' +
      'font-size:12px;color:#e2e8f0;z-index:99999;display:none;' +
      'box-shadow:0 4px 12px rgba(0,0,0,0.5);';
    document.body.appendChild(toastEl);
    return toastEl;
  }

  function showToast(title, detail) {
    const el = ensureToast();
    errorCount++;
    const safeTitle  = String(title).slice(0, 80);
    const safeDetail = detail ? String(detail).slice(0, 200) : '';
    el.innerHTML =
      '<div style="display:flex;align-items:start;gap:8px;">' +
        '<span style="color:#ef4444;font-weight:600;flex-shrink:0;">⚠</span>' +
        '<div style="flex:1;min-width:0;">' +
          '<div style="font-weight:600;color:#ef4444;margin-bottom:3px;">' + escapeHtml(safeTitle) + '</div>' +
          (safeDetail ? '<div style="color:#94a3b8;font-size:11px;word-break:break-word;">' + escapeHtml(safeDetail) + '</div>' : '') +
          (errorCount > 1 ? '<div style="color:#64748b;font-size:10px;margin-top:4px;">' + errorCount + ' errors total this session</div>' : '') +
        '</div>' +
        '<button onclick="this.parentNode.parentNode.style.display=\'none\'" ' +
          'style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 4px;">×</button>' +
      '</div>';
    el.style.display = 'block';
    if (dismissTimer) clearTimeout(dismissTimer);
    dismissTimer = setTimeout(() => { el.style.display = 'none'; }, 8000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[<>&"']/g, c => ({
      '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  function dedupe(key) {
    const now = Date.now();
    const last = RECENT_ERRORS.get(key);
    if (last && now - last < 5000) return true; // same error within 5s
    RECENT_ERRORS.set(key, now);
    if (RECENT_ERRORS.size > 50) {
      const oldest = [...RECENT_ERRORS.entries()].sort((a, b) => a[1] - b[1])[0];
      RECENT_ERRORS.delete(oldest[0]);
    }
    return false;
  }

  window.addEventListener('error', (ev) => {
    const msg = ev.message || 'Unknown error';
    const loc = ev.filename ? (ev.filename.split('/').pop() + ':' + (ev.lineno || '?')) : '';
    if (dedupe(msg)) return;
    console.error('[ErrorBoundary]', msg, ev.error || '');
    showToast(msg, loc);
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const msg = (reason && reason.message) || String(reason || 'Promise rejected');
    if (dedupe(msg)) return;
    console.error('[ErrorBoundary] Unhandled rejection:', reason);
    // Skip common benign network errors so they don't spam the toast
    if (/Failed to fetch|NetworkError|aborted/i.test(msg)) return;
    showToast('Async error', msg);
  });

  // Expose for debugging
  window.IAQUAErrorBoundary = {
    show: showToast,
    count: () => errorCount,
    reset: () => { errorCount = 0; RECENT_ERRORS.clear(); }
  };

  console.log('[OK] ErrorBoundary installed');
})();
