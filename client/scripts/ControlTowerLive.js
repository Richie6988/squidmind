/**
 * ControlTowerLive - Polls V2 endpoints to populate the right panel
 * with REAL data (not fake placeholder zeroes).
 * 
 * Updates every 5 seconds:
 *  - Resources: CPU/RAM/VRAM from poseidon_brain.current_state.system_load
 *  - Squad: counts from agent_registry.metadata
 *  - Model status pill
 *  - Scheduler count
 */

const ControlTowerLive = {
  pollInterval: null,
  
  start() {
    this.update();
    this.pollInterval = setInterval(() => this.update(), 5000);
    this._syncPause();
  },

  // ── PAUSE — the big red button ──────────────────────────────────────────
  async _syncPause() {
    try {
      const r = await window.api._fetch('/pause');
      this._renderPause(!!r?.paused);
    } catch {}
  },
  _renderPause(paused) {
    const b = document.getElementById('ct-pause-btn');
    if (!b) return;
    b.classList.toggle('paused', paused);
    b.textContent = paused ? '▶ RESUME' : '⏸ PAUSE';
    document.body.classList.toggle('system-paused', paused);
  },
  async togglePause() {
    const b = document.getElementById('ct-pause-btn');
    const target = !(b?.classList.contains('paused'));
    try {
      const r = await fetch('/api/v2/pause', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: target, by: 'control-tower' }),
      }).then(x => x.json());
      if (r.success) { this._renderPause(!!r.paused); window.SoundFX?.play(r.paused ? 'pause' : 'resume'); }
    } catch {}
  },
  
  async update() {
    try {
      // Parallel fetches
      const [brainRes, agentsRes, libRes, statusRes, brokerRes] = await Promise.allSettled([
        window.api._fetch('/poseidon'),
        window.api._fetch('/agents'),
        window.api._fetch('/models/library'),
        window.api._fetch('/models/status'),
        fetch('/api/v2/broker').then(r => r.ok ? r.json() : null)
      ]);

      if (brainRes.status === 'fulfilled') this._renderResources(brainRes.value.brain);
      if (agentsRes.status === 'fulfilled') this._renderSquad(agentsRes.value.registry);
      if (libRes.status === 'fulfilled') this._renderModel(libRes.value);
      this._syncPause();
      if (statusRes.status === 'fulfilled') {
        this._renderContextBar(statusRes.value);
        // _renderPhase was intentionally removed — Richard's context bar
        // already carries the holder name (Poseidon | agent name) + its
        // system-prompt size in the legend row, and the live phase is
        // visible via the "loaded model" tile just above (green Poseidon
        // pill or agent name). A second CHAT/generating chip on the right
        // duplicated that information without adding anything actionable.
      }
      if (brokerRes.status === 'fulfilled' && brokerRes.value) this._renderBroker(brokerRes.value.state);
    } catch (err) {
      // silent - endpoints might be temporarily unavailable
    }
  },

  /**
   * _renderPhase used to render a "CHAT · generating / N ctx · N turns"
   * chip on the right of the context bar. Removed — see the call-site
   * comment above. The stub below just tears down any leftover DOM the
   * old build may have created before this deploy, then no-ops.
   */
  _renderPhase() {
    const stale = document.getElementById('phase-panel');
    if (stale) stale.remove();
  },

  _renderResources(brain) {
    const load = brain.current_state?.system_load || {};
    const cpu = load.cpu_percent ?? 0;
    const ram = load.ram_percent ?? 0;
    const vram = load.vram_percent ?? 0;
    
    this._setBar('monitor-cpu', cpu);
    this._setBar('monitor-mem', ram);
    this._setBar('monitor-vram', vram);
    
    // RAM tooltip: show actual GB if available
    const memEl = document.getElementById('monitor-mem-value');
    if (memEl && load.ram_used_gb !== undefined) {
      memEl.title = `${load.ram_used_gb} / ${load.total_ram_gb} GB`;
    }
    const vramEl = document.getElementById('monitor-vram-value');
    if (vramEl && load.vram_used_gb !== undefined) {
      vramEl.title = `${load.vram_used_gb} / ${load.total_vram_gb} GB`;
    }
  },
  
  _setBar(prefix, percent) {
    const bar = document.getElementById(prefix + '-bar');
    const val = document.getElementById(prefix + '-value');
    if (bar) {
      bar.style.width = Math.min(100, percent) + '%';
      // Color shift based on load
      if (percent < 60) bar.style.background = 'var(--success)';
      else if (percent < 85) bar.style.background = '#FBBF24';
      else bar.style.background = 'var(--danger)';
    }
    if (val) val.textContent = percent.toFixed(0) + '%';
  },
  
  _renderSquad(registry) {
    const agents   = Object.values(registry.agents || {});
    const active   = agents.filter(a => a.status === 'active').length;
    const sleeping = agents.filter(a => a.status === 'sleeping').length;

    const activeWrap = document.getElementById('monitor-active-squids-wrap');
    const sleepWrap  = document.getElementById('monitor-sleeping-squids-wrap');
    if (activeWrap) {
      activeWrap.innerHTML =
        `<span style="font-size:7px;font-family:'Courier New',monospace;color:#06ffa5;letter-spacing:.08em;opacity:.8;">ACT</span>` +
        `<span id="monitor-active-squids" style="font-size:13px;font-weight:700;color:#06ffa5;font-family:'Courier New',monospace;">${active}</span>`;
    }
    if (sleepWrap) {
      sleepWrap.innerHTML =
        `<span style="font-size:7px;font-family:'Courier New',monospace;color:#4facfe;letter-spacing:.08em;opacity:.8;">ZZZ</span>` +
        `<span id="monitor-sleeping-squids" style="font-size:13px;font-weight:700;color:#4facfe;font-family:'Courier New',monospace;">${sleeping}</span>`;
    }
    // Compact per-agent LEVEL line replaces the old AGENT PERFORMANCE
    // telemetry table (it crowded the tower and hid other info). Level is a
    // GRADE earned from validated tasks: completion requires passing the
    // quality review, so tasks_completed IS the validated count.
    // Lv = floor(sqrt(validated)) + 1 → 0→Lv1, 1→Lv2, 4→Lv3, 9→Lv4, 16→Lv5.
    this._renderAgentLevels(agents);
  },

  _renderAgentLevels(agents) {
    const host = document.getElementById('monitor-squad-stats');
    if (!host) return;
    let box = document.getElementById('squad-telemetry');
    if (!box) {
      box = document.createElement('div');
      box.id = 'squad-telemetry';
      host.appendChild(box);
    }
    const open = !!this._levelsOpen;  // collapsed by default — saves tower space
    const rows = open ? agents.slice(0, 8).map(a => {
      const done   = a.performance_summary?.tasks_completed || 0;
      const level  = Math.floor(Math.sqrt(done)) + 1;
      const next   = level * level;             // validated tasks needed for next level
      const strikes = a.performance_summary?.honesty_strikes || 0;
      const lvColor = level >= 4 ? '#06ffa5' : level >= 2 ? '#4facfe' : '#64748b';
      return `<div class="squad-tele-row" title="${done} validated tasks — ${next - done} more to reach Lv ${level + 1}${strikes ? ` · ⚖${strikes} honesty strikes` : ''}">
        <span class="squad-tele-name">${((a.display_name || a.agent_id) + '').slice(0, 16)}</span>
        <span class="squad-tele-rate" style="color:${lvColor};font-weight:700;">Lv ${level}</span>
      </div>`;
    }).join('') : '';
    box.innerHTML =
      `<div class="squad-tele-toggle" id="squad-levels-toggle">${open ? '▾' : '▸'} AGENT LEVELS</div>${rows}`;
    box.querySelector('#squad-levels-toggle').onclick = () => {
      this._levelsOpen = !this._levelsOpen;
      this._renderAgentLevels(agents);
    };
  },

  /**
   * _renderBroker — flag stuck broker (held > 5 min by same owner) with a toast.
   * Only fires once per stuck session to avoid spam.
   */
  _renderBroker(state) {
    if (!state) return;
    const HELD_THRESHOLD_SEC = 300; // 5 min
    if (state.state === 'BUSY' && state.held_sec > HELD_THRESHOLD_SEC) {
      const sig = state.owner + '@' + Math.floor(state.held_sec / 60);
      if (this._lastStuckSig !== sig) {
        this._lastStuckSig = sig;
        window.ToastManager?.show({
          type: 'warn',
          icon: '⚠',
          title: 'Broker held for ' + Math.floor(state.held_sec / 60) + ' min',
          body: 'Owner: ' + (state.owner || '?') + ' · queue: ' + (state.queue?.length || 0),
          duration: 12000,
          action: {
            label: 'FORCE RELEASE',
            onClick: async () => {
              try {
                const r = await fetch('/api/v2/broker/force-release', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ reason: 'user click in Control Tower' })
                });
                const j = await r.json();
                window.ToastManager?.show({
                  type: j.success ? 'success' : 'error',
                  title: j.success ? 'Broker released' : 'Release failed',
                  body: j.success ? ('Held ' + (j.was_held_sec || 0) + 's by ' + (j.was_owner || '?')) : (j.error || ''),
                  duration: 5000
                });
              } catch (e) {
                window.ToastManager?.show({ type: 'error', title: 'Release failed', body: e.message, duration: 5000 });
              }
            }
          }
        });
      }
    } else if (state.state === 'IDLE') {
      this._lastStuckSig = null;
    }
  },

  _renderModel(library) {
    const dot   = document.getElementById('mm-dot');
    const name  = document.getElementById('mm-name');
    if (!dot || !name) return;
    if (library.poseidon_model_id) {
      const inMem  = library.currently_loaded.includes(library.poseidon_model_id);
      const mid    = library.poseidon_model_id;
      const mEntry = (library.models || []).find(m => m.model_id === mid);
      const label  = mEntry?.display_name || mid;
      name.textContent = label;
      name.title       = label;
      dot.className    = inMem ? 'mm-dot mm-dot-on' : 'mm-dot mm-dot-lazy';
      dot.title        = inMem ? 'Loaded in VRAM' : 'Registered but not loaded (lazy)';
    } else {
      name.textContent = 'none assigned';
      name.title       = 'No model assigned to Poseidon';
      dot.className    = 'mm-dot mm-dot-off';
      dot.title        = 'No model assigned';
    }
  },
  
  _renderContextBar(statusData) {
    const poseidonId = statusData?.poseidon_model_id;
    const wrap  = document.getElementById('mm-bar-wrap');
    if (!wrap) return;
    if (!poseidonId) { wrap.hidden = true; return; }
    const model = (statusData?.loaded_models || []).find(m => m.model_id === poseidonId);
    if (!model) { wrap.hidden = true; return; }
    wrap.hidden = false;

    const pct      = model.context_pct    || 0;
    const ctxUsed  = model.context_used_tokens  || 0;
    const ctxTotal = model.context_total_tokens || 0;

    const fill    = document.getElementById('mm-bar-fill');
    const sysFill = document.getElementById('mm-bar-sys');
    const track   = document.getElementById('mm-bar-track');
    const val     = document.getElementById('mm-bar-val');
    const holderLabel = document.getElementById('mm-holder-label');
    const holderSys   = document.getElementById('mm-holder-sys');

    // BLUE segment = fixed system+tools; GREEN/AMBER/RED = conversation.
    const sysTok      = model.system_prompt_tokens || 0;
    const displayPct  = pct || (ctxTotal > 0 ? Math.round(ctxUsed / ctxTotal * 100) : 0);
    const sysPct      = ctxTotal > 0 ? Math.min(100, (sysTok / ctxTotal) * 100) : 0;
    const convPct     = Math.max(0, Math.min(100 - sysPct, displayPct - sysPct));
    const convColor   = displayPct < 60 ? '#06ffa5' : displayPct < 85 ? '#fbbf24' : '#ef4444';
    if (sysFill) sysFill.style.width = sysPct.toFixed(1) + '%';
    if (fill)  { fill.style.width  = convPct.toFixed(1) + '%'; fill.style.background = convColor; }
    if (track) track.title = `System + tools ${sysTok} tok · conversation ${Math.max(0, ctxUsed - sysTok)} tok · free ${Math.max(0, ctxTotal - ctxUsed)} tok`;

    // Session label = who actually holds the context (real agent name)
    const modeName = model.session_mode === 'agent' ? (model.phase_agent_name || model.phase_agent || 'Agent')
                    : model.session_mode === 'bg' ? (model.phase_agent_name || 'BG')
                    : 'Poseidon';
    // KPI right of the bar — same colour hierarchy as before but bolder.
    if (val) {
      if (ctxTotal > 0) {
        val.textContent = `${(ctxUsed / 1000).toFixed(1)}k / ${(ctxTotal / 1000).toFixed(0)}k · ${displayPct}%`;
        val.dataset.state = displayPct >= 90 ? 'crit' : displayPct >= 70 ? 'warn' : 'ok';
      } else {
        val.textContent = '';
        delete val.dataset.state;
      }
    }
    if (holderLabel) holderLabel.textContent = modeName;
    if (holderSys)   holderSys.textContent   = sysTok ? `sys ${sysTok}` : '';
  },

  stop() {
    if (this.pollInterval) clearInterval(this.pollInterval);
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => ControlTowerLive.start(), 800));
} else {
  setTimeout(() => ControlTowerLive.start(), 800);
}

window.ControlTowerLive = ControlTowerLive;
console.log('[OK] ControlTowerLive started');
