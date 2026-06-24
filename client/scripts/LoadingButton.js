/**
 * LoadingButton — universal loading state helper for slow async actions.
 *
 * Usage:
 *   await LoadingButton.run(buttonEl, async () => { ... });   // returns the action's result
 *   LoadingButton.start(buttonEl, 'Loading…');
 *   LoadingButton.stop(buttonEl);
 *
 * While loading: disables the button, replaces label with spinner + text,
 * remembers original innerHTML to restore on stop().
 */
(function () {
  const SPINNER = '<span class="iaqua-spin" style="display:inline-block;width:10px;height:10px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:iaqua-spin 0.7s linear infinite;vertical-align:middle;margin-right:6px;"></span>';

  // Inject keyframes once
  if (!document.getElementById('iaqua-spin-css')) {
    const s = document.createElement('style');
    s.id = 'iaqua-spin-css';
    s.textContent = '@keyframes iaqua-spin { to { transform: rotate(360deg); } } .iaqua-loading { cursor: wait !important; opacity: 0.85; pointer-events: none; }';
    document.head.appendChild(s);
  }

  function start(btn, label) {
    if (!btn || btn.dataset.loading === 'true') return;
    btn.dataset.loading = 'true';
    btn.dataset.originalHtml = btn.innerHTML;
    btn.dataset.originalDisabled = btn.disabled ? 'true' : 'false';
    btn.disabled = true;
    btn.classList.add('iaqua-loading');
    btn.innerHTML = SPINNER + '<span style="vertical-align:middle;">' + (label || 'Loading…') + '</span>';
  }

  function stop(btn) {
    if (!btn || btn.dataset.loading !== 'true') return;
    btn.innerHTML = btn.dataset.originalHtml || btn.innerHTML;
    btn.disabled = btn.dataset.originalDisabled === 'true';
    btn.classList.remove('iaqua-loading');
    delete btn.dataset.loading;
    delete btn.dataset.originalHtml;
    delete btn.dataset.originalDisabled;
  }

  async function run(btn, asyncFn, label) {
    start(btn, label);
    try {
      return await asyncFn();
    } finally {
      stop(btn);
    }
  }

  window.LoadingButton = { start, stop, run };
  console.log('[OK] LoadingButton ready');
})();
