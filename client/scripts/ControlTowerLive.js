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
      const [brainRes, agentsRes, libRes] = await Promise.allSettled([
        window.ApiV2._fetch('/poseidon'),
        window.ApiV2._fetch('/agents'),
        window.ApiV2._fetch('/models/library')
      ]);
      
      if (brainRes.status === 'fulfilled') this._renderResources(brainRes.value.brain);
      if (agentsRes.status === 'fulfilled') this._renderSquad(agentsRes.value.registry);
      if (libRes.status === 'fulfilled') this._renderModel(libRes.value);
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
