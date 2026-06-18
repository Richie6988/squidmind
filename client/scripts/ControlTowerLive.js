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
      const [brainRes, agentsRes, libRes, statusRes] = await Promise.allSettled([
        window.ApiV2._fetch('/poseidon'),
        window.ApiV2._fetch('/agents'),
        window.ApiV2._fetch('/models/library'),
        window.ApiV2._fetch('/models/status')
      ]);
      
      if (brainRes.status === 'fulfilled') this._renderResources(brainRes.value.brain);
      if (agentsRes.status === 'fulfilled') this._renderSquad(agentsRes.value.registry);
      if (libRes.status === 'fulfilled') this._renderModel(libRes.value);
      if (statusRes.status === 'fulfilled') this._renderContextBar(statusRes.value);
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
    const agents = Object.values(registry.agents || {});
    const active   = agents.filter(a => a.status === 'active').length;
    const sleeping = agents.filter(a => a.status === 'sleeping').length;
    const PI = window.PixelIcons;

    const activeWrap = document.getElementById('monitor-active-squids-wrap');
    const sleepWrap  = document.getElementById('monitor-sleeping-squids-wrap');
    if (activeWrap) {
      activeWrap.innerHTML = (PI?.inline('bolt',12) || '⚡') +
        `<span id="monitor-active-squids" style="font-size:11px;font-weight:600;color:#facc15;">${active}</span>`;
    }
    if (sleepWrap) {
      sleepWrap.innerHTML = (PI?.inline('moon',12) || '💤') +
        `<span id="monitor-sleeping-squids" style="font-size:11px;color:var(--text-secondary);">${sleeping}</span>`;
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
    if (tokEl)   tokEl.textContent   = tokens > 0 ? `${(tokens/1000).toFixed(1)}k tok` : '';
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
