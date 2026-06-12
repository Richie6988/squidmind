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
    const agents = registry.agents || {};
    const agentList = Object.values(agents);
    // Count from actual registry entries (not stale metadata counters)
    const total    = agentList.length;
    const active   = agentList.filter(a => a.status === 'active').length;
    const sleeping = agentList.filter(a => a.status === 'sleeping').length;
    const working  = agentList.filter(a => a.current_task_id).length;
    
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set('monitor-total-squids', total);
    set('monitor-active-squids', active);
    set('monitor-sleeping-squids', sleeping);
    set('monitor-working-squids', working);
  },
  
  _renderModel(library) {
    const pill = document.getElementById('monitor-model-pill');
    if (!pill) return;
    if (library.poseidon_model_id) {
      const inMem = library.currently_loaded.includes(library.poseidon_model_id);
      pill.innerHTML = `<strong style="color:${inMem ? 'var(--success)' : 'var(--text)'}">${library.poseidon_model_id}</strong> ${inMem ? '(loaded)' : '(lazy)'}`;
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

    const pct      = model.context_pct || 0;
    const turns    = model.session_turns || 0;
    const ctxUsed  = model.context_used_tokens  || 0;
    const ctxTotal = model.context_total_tokens || 0;
    const tokens   = model.total_tokens_generated || 0;

    // Update or create context bar element
    let barWrap = document.getElementById('ctx-bar-wrap');
    if (!barWrap) {
      const pill = document.getElementById('monitor-model-pill');
      if (!pill) return;
      barWrap = document.createElement('div');
      barWrap.id = 'ctx-bar-wrap';
      barWrap.style.cssText = 'margin-top:4px;';
      barWrap.innerHTML = `
        <div style="display:flex;justify-content:space-between;font-size:7px;color:var(--text-secondary);margin-bottom:2px;">
          <span id="ctx-bar-label">Context</span>
          <span id="ctx-bar-val"></span>
        </div>
        <div style="height:3px;background:rgba(255,255,255,0.1);border-radius:2px;overflow:hidden;">
          <div id="ctx-bar-fill" style="height:100%;border-radius:2px;transition:width 0.5s,background 0.5s;"></div>
        </div>
        <div id="ctx-tokens" style="font-size:7px;color:var(--text-secondary);margin-top:2px;"></div>`;
      pill.parentNode.insertBefore(barWrap, pill.nextSibling);
    }

    const fill  = document.getElementById('ctx-bar-fill');
    const val   = document.getElementById('ctx-bar-val');
    const tokEl = document.getElementById('ctx-tokens');
    if (fill) {
      fill.style.width = Math.min(100, pct) + '%';
      fill.style.background = pct < 60 ? 'var(--success)' : pct < 85 ? '#FBBF24' : 'var(--danger)';
    }
    if (val) val.textContent = ctxTotal
      ? `${(ctxUsed/1000).toFixed(1)}k/${(ctxTotal/1000).toFixed(0)}k tok (${pct}%) · turn ${turns}`
      : `turn ${turns} (${pct}%)`;
    if (tokEl) tokEl.textContent = `${(tokens/1000).toFixed(1)}k tokens total`;
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
