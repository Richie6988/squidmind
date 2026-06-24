/**
 * UndoManager — soft delete with undo toast.
 *
 * UndoManager.scheduleDelete({
 *   label:    'Agent “Bob”',
 *   onCommit: async () => {  await fetch(...DELETE...);  },
 *   onCancel: () => {},
 *   delay:    8000,
 * })
 *
 * Shows a toast with an UNDO button. After `delay` ms, calls onCommit.
 * If UNDO clicked, calls onCancel and skips the commit.
 *
 * The caller MUST optimistically update its UI before calling — UndoManager
 * doesn't touch the DOM. If the user undoes, the caller re-renders from server.
 */
(function () {
  function scheduleDelete(opts) {
    const { label, onCommit, onCancel, delay = 8000, type = 'warn' } = opts;
    if (!window.ToastManager) {
      // No toast available — commit immediately (degraded mode)
      onCommit?.();
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      try { await onCommit?.(); }
      catch (e) {
        window.ToastManager?.show({
          type: 'error', title: 'Delete failed',
          body: e.message || String(e), duration: 6000
        });
      }
    }, delay);

    window.ToastManager.show({
      type,
      icon: '🗑',
      title: 'Deleted ' + (label || 'item'),
      body: 'Undo within ' + Math.round(delay / 1000) + 's',
      duration: delay,
      action: {
        label: 'UNDO',
        onClick: () => {
          cancelled = true;
          clearTimeout(timer);
          try { onCancel?.(); } catch {}
          window.ToastManager.show({ type: 'info', title: 'Restored', body: label, duration: 2500 });
        }
      }
    });
  }

  window.UndoManager = { scheduleDelete };
  console.log('[OK] UndoManager ready');
})();
