/**
 * KeyboardShortcuts — global keyboard handling.
 *
 *   Esc       → close topmost open modal (PoseidonChat, AgentForm, ModelLoader, TempleInterior, etc.)
 *   Ctrl+/    → show shortcuts help toast
 *   ?         → show shortcuts help toast
 *
 * Designed to be additive — does not interfere with text inputs.
 */
(function () {
  const TOPMOST_MODAL_SELECTORS = [
              // Command Palette — highest priority (above SquidModal)
    '.squid-modal-overlay',         // SquidModal.alert/confirm/prompt
    '.agent-form-modal',
    '.modal[id="model-modal"]',
    '.modal[id="skills-modal"]',
    '.modal[id="comms-modal"]',
    '.modal[id="scheduler-modal"]',
    '#poseidon-chat.modal',
    '#temple-interior',
  ];

  function getTopmostOpenModal() {
    for (const sel of TOPMOST_MODAL_SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        if (el.style.display !== 'none' && el.offsetParent !== null) return el;
      }
    }
    return null;
  }

  function closeTopmostModal() {
    const m = getTopmostOpenModal();
    if (!m) return false;

    // Each modal has its own close logic — try the known handles in order
    if (m.classList.contains('squid-modal-overlay')) {
      // SquidModal.alert/confirm/prompt — find the cancel/close button
      const btn = m.querySelector('.squid-modal-btn-cancel, .squid-modal-btn-no, .squid-modal-btn-ok');
      if (btn) btn.click(); else m.remove();
      return true;
    }
    if (m.classList.contains('agent-form-modal')) {
      if (window.AgentForm?.close)        { window.AgentForm.close(); return true; }
    }
    if (m.id === 'model-modal'    && window.ModelLoader?.close)  { window.ModelLoader.close(); return true; }
    if (m.id === 'skills-modal'   && window.SkillsPanel?.close)  { window.SkillsPanel.close(); return true; }
    if (m.id === 'comms-modal'    && window.CommsPanel?.close)   { window.CommsPanel.close(); return true; }
    if (m.id === 'scheduler-modal'&& window.Scheduler?.close)    { window.Scheduler.close(); return true; }
    if (m.id === 'poseidon-chat'  && window.PoseidonChat?.close) { window.PoseidonChat.close(); return true; }
    if (m.id === 'temple-interior'&& window.TempleInterior?.close){ window.TempleInterior.close(); return true; }

    // Fallback — just hide
    m.style.display = 'none';
    return true;
  }

  function showShortcutsHelp() {
    if (!window.ToastManager) return;
    window.ToastManager.show({
      type: 'info',
      title: 'Keyboard shortcuts',
      body: 'Ctrl+K → search · Esc → close modal · F11 → temple focus · Ctrl+Enter → send · ? → help',
      duration: 7000,
    });
  }

  document.addEventListener('keydown', (ev) => {
    // Don't interfere when user is typing in inputs/textareas (except Esc, which always works)
    const t = ev.target;
    const isTyping = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

    if (ev.key === 'Escape') {
      const handled = closeTopmostModal();
      if (handled) ev.preventDefault();
      return;
    }

    if (isTyping) return;

    if (ev.key === '?' || (ev.ctrlKey && ev.key === '/')) {
      showShortcutsHelp();
      ev.preventDefault();
      return;
    }

    // F11 → toggle Temple focus mode (only when temple is open)
    if (ev.key === 'F11') {
      const temple = document.getElementById('temple-interior');
      if (temple && temple.style.display !== 'none' && temple.offsetParent !== null) {
        window.TempleInterior?._toggleFocus();
        ev.preventDefault();
      }
      return;
    }
  });

  console.log('[OK] KeyboardShortcuts ready');
})();
