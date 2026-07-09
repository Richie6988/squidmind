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
      if (statusRes.status === 'fulfilled') this._renderContextBar(statusRes.value);
      if (brokerRes.status === 'fulfilled' && brokerRes.value) this._renderBroker(brokerRes.value.state);
    } catch (err) {
      // silent - endpoints might be temporarily unavailable
    }
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
    // Per-agent telemetry (success rate, avg duration) — throttled fetch.
    this._maybeRenderAgentStats();
  },

  _agentStatsLastFetch: 0,
  async _maybeRenderAgentStats() {
    // Refresh at most every 30s; the squad section re-renders more often.
    if (Date.now() - this._agentStatsLastFetch < 30_000) return;
    this._agentStatsLastFetch = Date.now();
    try {
      const r = await fetch('/api/v2/agents/stats');
      const d = await r.json();
      if (!d.ok || !d.agents) return;
      const host = document.getElementById('monitor-squad-stats');
      if (!host) return;
      let box = document.getElementById('squad-telemetry');
      if (!box) {
        box = document.createElement('div');
        box.id = 'squad-telemetry';
        host.appendChild(box);
      }
      const rows = d.agents.slice(0, 6).map(a => {
        const rate = a.success_rate === null ? '—' : a.success_rate + '%';
        const rateColor = a.success_rate === null ? '#475569'
          : a.success_rate >= 80 ? '#06ffa5'
          : a.success_rate >= 50 ? '#fbbf24' : '#f87171';
        const dur = a.avg_duration_s === null ? '' :
          ` · ${a.avg_duration_s >= 60 ? Math.round(a.avg_duration_s / 60) + 'm' : a.avg_duration_s + 's'} avg`;
        return `<div class="squad-tele-row" title="${a.completed} completed, ${a.failed} failed${dur ? ', avg duration' + dur : ''}">
          <span class="squad-tele-name">${(a.name || a.agent_id).slice(0, 14)}</span>
          <span class="squad-tele-nums">${a.completed}✓ ${a.failed}✗</span>
          <span class="squad-tele-rate" style="color:${rateColor};">${rate}</span>
        </div>`;
      }).join('');
      box.innerHTML = rows
        ? `<div class="squad-tele-head">AGENT PERFORMANCE</div>${rows}`
        : '';
    } catch { /* non-fatal — telemetry is best-effort */ }
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
    const pill = document.getElementById('monitor-model-pill');
    if (!pill) return;
    if (library.poseidon_model_id) {
      const inMem  = library.currently_loaded.includes(library.poseidon_model_id);
      const mid    = library.poseidon_model_id;
      const mEntry = (library.models || []).find(m => m.model_id === mid);
      const label  = mEntry?.display_name || mid;
      pill.innerHTML = `
        <div style="font-size:9px;color:#c8d8f0;word-break:break-all;line-height:1.4;">${label}</div>
        <div style="font-size:8px;color:${inMem ? '#06ffa5' : '#64748b'};margin-top:2px;">${inMem ? '&#9679; LOADED IN VRAM' : '&#9675; NOT LOADED (lazy)'}</div>`;
    } else {
      pill.textContent = 'none assigned';
      pill.style.color = 'var(--text-secondary)';
    }
  },
  
  _renderContextBar(statusData) {
    const poseidonId = statusData?.poseidon_model_id;
    if (!poseidonId) return;
    const model = (statusData?.loaded_models || []).find(m => m.model_id === poseidonId);
    if (!model) return;

    const pct      = model.context_pct    || 0;
    const turns    = model.session_turns  || 0;
    const ctxUsed  = model.context_used_tokens  || 0;
    const ctxTotal = model.context_total_tokens || 0;
    const tokens   = model.total_tokens_generated || 0;

    let barWrap = document.getElementById('ctx-bar-wrap');
    if (!barWrap) {
      const pill = document.getElementById('monitor-model-pill');
      if (!pill) return;
      barWrap = document.createElement('div');
      barWrap.id = 'ctx-bar-wrap';
      barWrap.style.cssText = 'margin-top:6px;';
      barWrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:7px;color:#64748b;margin-bottom:3px;letter-spacing:.04em;">
          <span>CONTEXT</span>
          <span id="ctx-bar-val" style="font-family:'Courier New',monospace;color:#94a3b8;"></span>
        </div>
        <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
          <div id="ctx-bar-fill" style="height:100%;border-radius:2px;transition:width 0.5s,background 0.5s;min-width:2px;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:7px;color:#475569;">
          <span id="ctx-turns"></span>
          <span id="ctx-tokens" style="font-family:'Courier New',monospace;"></span>
        </div>`;
      pill.parentNode.insertBefore(barWrap, pill.nextSibling);
    }

    const fill    = document.getElementById('ctx-bar-fill');
    const val     = document.getElementById('ctx-bar-val');
    const tokEl   = document.getElementById('ctx-tokens');
    const turnsEl = document.getElementById('ctx-turns');

    // Bar fill — always show at least the prompt size if pct is 0
    const displayPct = pct || (ctxTotal > 0 ? Math.round(ctxUsed / ctxTotal * 100) : 0);
    if (fill) {
      fill.style.width      = Math.min(100, displayPct) + '%';
      fill.style.background = displayPct < 60 ? '#06ffa5' : displayPct < 85 ? '#fbbf24' : '#ef4444';
    }

    // Top label: show used/total when available, else just total size
    if (val) {
      if (ctxTotal > 0 && ctxUsed > 0) {
        val.textContent = `${(ctxUsed/1000).toFixed(1)}k / ${(ctxTotal/1000).toFixed(0)}k (${displayPct}%)`;
      } else if (ctxTotal > 0) {
        val.textContent = `${(ctxTotal/1000).toFixed(0)}k ctx`;
        val.style.color = '#475569';
      }
    }

    // Bottom row: turns + tokens generated (only show when non-zero)
    if (turnsEl) turnsEl.textContent = turns > 0 ? `turn ${turns}` : '';
    if (tokEl)   tokEl.textContent   = tokens > 0 ? (tokens >= 10000 ? `${(tokens/1000).toFixed(1)}k tok` : `${window.Format?.num(tokens) || tokens} tok`) : '';
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
