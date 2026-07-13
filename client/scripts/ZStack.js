'use strict';

/**
 * ZStack — window-manager stacking for panels.
 *
 * Rule: the LAST panel opened (or clicked) is always on top.
 *
 * Fully generic: every panel in the app is a `.modal` element (chat overlay,
 * Logs, Comms, Models, Skills, AgentForm, Scheduler, editors…). Instead of
 * touching each open() implementation, one MutationObserver raises a modal
 * whenever it (a) is appended to the DOM, or (b) transitions hidden → visible
 * (display style or .hidden class). A capture-phase mousedown also raises the
 * panel you interact with, so clicking a half-covered chat brings it back to
 * front — real window-manager feel.
 *
 * CSS in pixel.css assigns static z-indexes up to `20000 !important`
 * (agent-form) — the counter starts ABOVE all of them and every raise uses
 * setProperty(..., 'important') so no static rule can win.
 */
(function () {
  const ZStack = {
    top: 30000,
    raise(el) {
      if (!el || el.nodeType !== 1) return;
      el.style.setProperty('z-index', String(++this.top), 'important');
    },
  };
  window.ZStack = ZStack;

  const isVisible = (el) =>
    !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none';

  const maybeRaiseOnShow = (el) => {
    const visible = isVisible(el);
    if (visible && el.dataset.zOpen !== '1') {
      el.dataset.zOpen = '1';
      ZStack.raise(el);
    } else if (!visible) {
      el.dataset.zOpen = '';
    }
  };

  const start = () => {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList') {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.classList?.contains('modal') || n.classList?.contains('squid-modal-overlay')) maybeRaiseOnShow(n);
            // A container appended with modals inside
            n.querySelectorAll?.('.modal, .squid-modal-overlay').forEach(maybeRaiseOnShow);
          }
        } else if (m.type === 'attributes' && (m.target.classList?.contains('modal') || m.target.classList?.contains('squid-modal-overlay'))) {
          maybeRaiseOnShow(m.target);
        }
      }
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    // Click-to-front: interacting with any visible modal raises it.
    document.addEventListener(
      'mousedown',
      (e) => {
        const modal = e.target.closest?.('.modal, .squid-modal-overlay');
        if (modal && isVisible(modal)) ZStack.raise(modal);
      },
      true
    );
  };

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);
})();
