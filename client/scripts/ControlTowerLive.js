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
      if (statusRes.status === 'fulfilled') {
        this._renderContextBar(statusRes.value);
        this._renderPhase(statusRes.value);   // agentic state — always visible
      }
      if (brokerRes.status === 'fulfilled' && brokerRes.value) this._renderBroker(brokerRes.value.state);
    } catch (err) {
      // silent - endpoints might be temporarily unavailable
    }
  },

  /**
   * Render the current agentic phase: what the model is doing right now,
   * which task/project/agent if in BG. This is the panel the user was
   * missing — every phase transition is loud and visible.
   */
  _renderPhase(status) {
    const model = (status.loaded_models || [])[0];
    let panel = document.getElementById('phase-panel');
    if (!panel) {
      const monitorHost = document.getElementById('monitor-model-pill')?.parentElement;
      if (!monitorHost) return;
      panel = document.createElement('div');
      panel.id = 'phase-panel';
      panel.style.cssText = 'margin-top:10px;padding:8px 10px;background:rgba(6,255,165,0.04);border:1px solid rgba(6,255,165,0.15);border-radius:4px;font-size:9px;';
      monitorHost.appendChild(panel);
    }
    if (!model) {
      panel.innerHTML = `<div style="color:#64748b;">No model loaded</div>`;
      return;
    }
    const phase = model.phase || (model.generating ? 'chat' : 'idle');
    const phaseColor = phase === 'agent' ? '#fbbf24' : phase === 'review' ? '#a78bfa' : phase === 'chat' ? '#06ffa5' : '#64748b';
    const phaseLabel = { chat: 'CHAT', agent: 'AGENT', review: 'REVIEW', idle: 'IDLE' }[phase] || phase.toUpperCase();
    const busy = model.generating ? '● generating' : '○ idle';
    let subline = '';
    if (phase === 'agent' && model.phase_task_id) {
      subline = `task ${model.phase_task_id}${model.phase_project ? ` · ${model.phase_project}` : ''}${model.phase_agent ? ` · ${model.phase_agent}` : ''}`;
    } else if (phase === 'review' && model.phase_task_id) {
      subline = `reviewing ${model.phase_task_id}`;
    } else if (phase === 'chat') {
      subline = `${(model.context_total_tokens/1000).toFixed(0)}k ctx · ${model.session_turns || 0} turns`;
    }
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;font-family:'Courier New',monospace;">
        <span style="color:${phaseColor};font-weight:700;letter-spacing:0.1em;">${phaseLabel}</span>
        <span style="color:#94a3b8;font-size:8px;">${busy}</span>
      </div>
      ${subline ? `<div style="color:#94a3b8;font-size:8px;font-family:'Courier New',monospace;margin-top:3px;">${subline}</div>` : ''}
    `;
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
      barWrap.style.cssText = 'margin-top:8px;';
      barWrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:8px;color:#94a3b8;letter-spacing:.04em;margin-bottom:4px;">
          <span>CONTEXT</span>
          <span id="ctx-bar-val" style="font-family:'Courier New',monospace;color:#cbd5e1;font-size:9px;"></span>
        </div>
        <div id="ctx-bar-track" title="" style="height:6px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;display:flex;">
          <div id="ctx-bar-sys"  style="height:100%;background:#4facfe;transition:width 0.4s;flex:0 0 auto;"></div>
          <div id="ctx-bar-fill" style="height:100%;transition:width 0.4s,background 0.4s;flex:0 0 auto;"></div>
        </div>
        <div id="ctx-bar-legend" style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:8px;font-family:'Courier New',monospace;color:#94a3b8;margin-top:5px;line-height:1;">
          <span style="display:flex;gap:10px;align-items:center;">
            <span id="ctx-legend-sys"  style="display:inline-flex;align-items:center;gap:4px;"><span style="width:6px;height:6px;background:#4facfe;border-radius:1px;"></span><span></span></span>
            <span id="ctx-legend-conv" style="display:inline-flex;align-items:center;gap:4px;"><span id="ctx-legend-conv-dot" style="width:6px;height:6px;background:#06ffa5;border-radius:1px;"></span><span></span></span>
          </span>
          <span id="ctx-legend-free" style="color:#64748b;"></span>
        </div>`;
      pill.parentNode.insertBefore(barWrap, pill.nextSibling);
    }

    const fill    = document.getElementById('ctx-bar-fill');
    const sysFill = document.getElementById('ctx-bar-sys');
    const track   = document.getElementById('ctx-bar-track');
    const val     = document.getElementById('ctx-bar-val');
    const legSys  = document.getElementById('ctx-legend-sys')?.lastElementChild;
    const legConv = document.getElementById('ctx-legend-conv')?.lastElementChild;
    const legConvDot = document.getElementById('ctx-legend-conv-dot');
    const legFree = document.getElementById('ctx-legend-free');

    // BLUE segment = fixed system+tools; GREEN/AMBER/RED = conversation.
    const sysTok = model.system_prompt_tokens || 0;
    const displayPct = pct || (ctxTotal > 0 ? Math.round(ctxUsed / ctxTotal * 100) : 0);
    const sysPct  = ctxTotal > 0 ? Math.min(100, (sysTok / ctxTotal) * 100) : 0;
    const convPct = Math.max(0, Math.min(100 - sysPct, displayPct - sysPct));
    const convColor = displayPct < 60 ? '#06ffa5' : displayPct < 85 ? '#fbbf24' : '#ef4444';
    if (sysFill) sysFill.style.width = sysPct.toFixed(1) + '%';
    if (fill) { fill.style.width = convPct.toFixed(1) + '%'; fill.style.background = convColor; }
    if (track) track.title = `System+tools ${sysTok} tok · conversation ${Math.max(0, ctxUsed - sysTok)} tok · free ${Math.max(0, ctxTotal - ctxUsed)} tok`;

    // Session label matches what's actually resident
    const modeName = model.session_mode === 'agent' ? 'Agent'
                    : model.session_mode === 'bg' ? 'BG'
                    : 'Poseidon';

    // Right-aligned header: N/M (X%) if there's any conversation, else empty
    // (avoids "45k" up top duplicating "45056 free" below when idle).
    const conversationTok = Math.max(0, ctxUsed - sysTok);
    const freeTok = Math.max(0, ctxTotal - ctxUsed);
    if (val) {
      if (ctxTotal > 0 && conversationTok > 0) {
        val.textContent = `${(ctxUsed/1000).toFixed(1)}k / ${(ctxTotal/1000).toFixed(0)}k · ${displayPct}%`;
        val.style.color = displayPct >= 85 ? '#ef4444' : displayPct >= 60 ? '#fbbf24' : '#cbd5e1';
      } else {
        val.textContent = '';
      }
    }

    // Single legend row — no more duplicated numbers
    if (legSys)  legSys.textContent  = sysTok ? `${modeName} ${sysTok}` : '';
    if (legConv) legConv.textContent = conversationTok > 0 ? `conv ${conversationTok}` : (turns > 0 ? `turn ${turns}` : '');
    if (legConvDot) legConvDot.style.background = convColor;
    if (legFree) legFree.textContent = ctxTotal ? `${(freeTok/1000).toFixed(1)}k free of ${(ctxTotal/1000).toFixed(0)}k` : '';
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
