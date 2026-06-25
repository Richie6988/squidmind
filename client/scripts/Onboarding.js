/**
 * Onboarding — first-time user guidance overlay.
 *
 * Shows a welcome panel over the empty aquarium when there are no agents.
 * Auto-hides as soon as an agent is created.
 *
 * Dismissible (localStorage), but reappears if all agents are deleted.
 */
(function () {
  const DISMISS_KEY = 'iaqua-onboarding-dismissed';

  function maybeShow(squidCount) {
    if (squidCount > 0) {
      hide();
      return;
    }
    if (localStorage.getItem(DISMISS_KEY) === 'yes') {
      // Still show — but minimised — if user manually dismissed and aquarium is still empty
      showMinimised();
      return;
    }
    show();
  }

  function show() {
    if (document.getElementById('iaqua-onboarding')) return;
    const overlay = document.createElement('div');
    overlay.id = 'iaqua-onboarding';
    overlay.style.cssText =
      'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'z-index:10;pointer-events:auto;max-width:480px;width:90%;' +
      'background:rgba(15,34,54,0.92);backdrop-filter:blur(8px);' +
      'border:1px solid rgba(79,172,254,0.3);border-radius:10px;' +
      'box-shadow:0 12px 40px rgba(0,0,0,0.6);padding:24px 26px;' +
      'font-family:system-ui,sans-serif;color:#dce8f5;' +
      'animation:iaqua-modal-in 0.3s ease-out;';
    overlay.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:14px;">' +
        '<div>' +
          '<div style="font-size:11px;color:#06ffa5;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:6px;font-weight:600;">⬡ Welcome aboard</div>' +
          '<div style="font-size:18px;font-weight:600;color:#e2e8f0;">Your aquarium is empty</div>' +
        '</div>' +
        '<button id="iaqua-ob-close" title="Dismiss" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:18px;line-height:1;padding:0 6px;">×</button>' +
      '</div>' +
      '<div style="color:#94a3b8;font-size:12px;line-height:1.55;margin-bottom:18px;">' +
        'Get started in three steps. Each Squid is an autonomous AI agent that handles tasks. ' +
        'Poseidon orchestrates them.' +
      '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;margin-bottom:18px;">' +
        step(1, 'Import a model', 'Pick a GGUF model and assign it to Poseidon — the master orchestrator.', 'Open Models', () => window.ModelLoader?.open()) +
        step(2, 'Create your first agent', 'Customize a Squid: personality, tools, appearance. Poseidon will dispatch tasks to it.', 'New Agent', () => window.AgentForm?.openNew()) +
        step(3, 'Chat with Poseidon', 'Tell Poseidon what to build. It will plan, delegate to your agents, and report back.', 'Open chat', () => window.PoseidonChat?.open()) +
      '</div>' +
      '<div style="font-size:10px;color:#64748b;text-align:center;padding-top:10px;border-top:1px solid rgba(255,255,255,0.05);">' +
        'Press <kbd style="background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:3px;font-family:var(--panel-font-mono,monospace);">Ctrl+K</kbd> anywhere to search · <kbd style="background:rgba(255,255,255,0.08);padding:2px 6px;border-radius:3px;font-family:var(--panel-font-mono,monospace);">?</kbd> for shortcuts' +
      '</div>';

    const wrap = document.querySelector('.aquarium-wrapper') || document.body;
    wrap.appendChild(overlay);

    overlay.querySelector('#iaqua-ob-close').onclick = () => {
      localStorage.setItem(DISMISS_KEY, 'yes');
      hide();
      showMinimised();
    };
  }

  function step(n, title, body, ctaLabel, ctaFn) {
    const id = 'iaqua-ob-step-' + n;
    setTimeout(() => {
      const btn = document.getElementById(id);
      if (btn) btn.onclick = ctaFn;
    }, 0);
    return '<div style="display:flex;gap:12px;align-items:flex-start;padding:10px;background:rgba(255,255,255,0.02);border-radius:6px;border:1px solid rgba(255,255,255,0.04);">' +
      '<div style="background:rgba(79,172,254,0.15);color:#4facfe;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0;">' + n + '</div>' +
      '<div style="flex:1;min-width:0;">' +
        '<div style="font-size:12px;font-weight:600;color:#e2e8f0;margin-bottom:3px;">' + title + '</div>' +
        '<div style="font-size:11px;color:#94a3b8;line-height:1.4;margin-bottom:8px;">' + body + '</div>' +
        '<button id="' + id + '" style="background:rgba(79,172,254,0.18);border:1px solid rgba(79,172,254,0.4);color:#4facfe;padding:4px 12px;font-size:10px;font-weight:600;border-radius:5px;cursor:pointer;font-family:system-ui;letter-spacing:0.03em;text-transform:uppercase;">' + ctaLabel + '</button>' +
      '</div>' +
    '</div>';
  }

  function showMinimised() {
    if (document.getElementById('iaqua-onboarding-mini')) return;
    const mini = document.createElement('div');
    mini.id = 'iaqua-onboarding-mini';
    mini.title = 'Onboarding (click to reopen)';
    mini.style.cssText =
      'position:absolute;left:14px;bottom:14px;z-index:10;cursor:pointer;' +
      'background:rgba(15,34,54,0.85);backdrop-filter:blur(6px);' +
      'border:1px solid rgba(79,172,254,0.3);border-radius:6px;padding:6px 12px;' +
      'font-family:system-ui,sans-serif;font-size:11px;color:#4facfe;' +
      'display:flex;align-items:center;gap:6px;';
    mini.innerHTML = '<span style="font-size:13px;">⬡</span> Get started';
    mini.onclick = () => {
      localStorage.removeItem(DISMISS_KEY);
      mini.remove();
      show();
    };
    (document.querySelector('.aquarium-wrapper') || document.body).appendChild(mini);
  }

  function hide() {
    document.getElementById('iaqua-onboarding')?.remove();
    document.getElementById('iaqua-onboarding-mini')?.remove();
  }

  window.Onboarding = { maybeShow, show, hide };
  console.log('[OK] Onboarding ready');
})();
