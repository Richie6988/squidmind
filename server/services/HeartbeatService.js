/**
 * HeartbeatService - Periodic system resource monitoring
 * 
 * Updates:
 *   - main/poseidon_brain.json -> current_state.system_load
 *   - models/model_registry.json -> system_resources
 * 
 * Detects overload conditions based on thresholds in poseidon_brain.
 * Logs significant state changes (overload entered/exited).
 */

const os = require('os');
const { execSync } = require('child_process');

class HeartbeatService {
  constructor(registryManager, intervalMs = 5000) {
    this.rm = registryManager;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastCpuTimes = null;
    this.wasOverloaded = false;
    this.modelService = null;          // wired in by index.js
    this.dreamIdleMinutes = 10;        // dream after N minutes of Poseidon idle
    this._lastDreamAt = 0;
    this.dreamCooldownMinutes = 30;    // min gap between dream cycles
  }

  setModelService(ms) { this.modelService = ms; }

  start() {
    if (this.timer) return;
    // Initial reading needs two samples for CPU delta
    this.lastCpuTimes = this._readCpuTimes();
    this.timer = setInterval(() => this.tick().catch(err =>
      console.error('[Heartbeat] tick failed:', err.message)
    ), this.intervalMs);
    console.log(`[Heartbeat] Started (every ${this.intervalMs}ms)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Heartbeat] Stopped');
    }
  }

  async tick() {
    const load = this._measure();
    
    // Update poseidon brain
    this.rm.invalidateCache();
    const brain = await this.rm.getPoseidonBrain();
    brain.current_state.system_load = load;
    brain.current_state.last_state_update_at = load.last_measured_at;
    
    // Check overload
    const thresholds = brain.resource_limits.resource_thresholds;
    const isOverloaded = (
      load.cpu_percent >= thresholds.cpu_critical_percent ||
      load.ram_percent >= thresholds.ram_critical_percent ||
      load.vram_percent >= thresholds.vram_critical_percent
    );
    brain.current_state.is_overloaded = isOverloaded;
    
    await this.rm.write('main/poseidon_brain.json', brain);
    
    // Update model registry system_resources (bootstrap if missing)
    const modelReg = await this.rm.read('models/model_registry.json');
    if (!modelReg.system_resources) modelReg.system_resources = {};
    modelReg.system_resources.total_ram_gb         = load.total_ram_gb;
    modelReg.system_resources.total_vram_gb        = load.total_vram_gb;
    modelReg.system_resources.total_cpu_cores      = load.cpu_cores;
    modelReg.system_resources.current_ram_used_gb  = load.ram_used_gb;
    modelReg.system_resources.current_vram_used_gb = load.vram_used_gb;
    modelReg.system_resources.current_cpu_percent  = load.cpu_percent;
    modelReg.system_resources.last_measured_at     = load.last_measured_at;
    await this.rm.write('models/model_registry.json', modelReg);
    
    // Log overload state changes
    if (isOverloaded && !this.wasOverloaded) {
      await this.rm.log({
        event_type: 'model_overloaded',
        severity: 'warning',
        actor: { type: 'system', id: 'heartbeat' },
        subject: { type: 'system', id: 'resources' },
        action: 'System entered OVERLOADED state',
        context: load
      });
    } else if (!isOverloaded && this.wasOverloaded) {
      await this.rm.log({
        event_type: 'model_overloaded',
        severity: 'info',
        actor: { type: 'system', id: 'heartbeat' },
        subject: { type: 'system', id: 'resources' },
        action: 'System exited overloaded state',
        context: load
      });
    }
    this.wasOverloaded = isOverloaded;

    // ── DREAM TRIGGER ──────────────────────────────────────────────────────
    // If Poseidon model is loaded, not generating, and idle > dreamIdleMinutes,
    // trigger a metacognition session (max once per dreamCooldownMinutes).
    if (this.modelService) {
      try {
        const status = this.modelService.getStatus();
        const pm = status.loaded_models.find(m => m.model_id === status.poseidon_model_id);
        if (pm && !pm.generating && !pm.dreaming && pm.idle_minutes >= this.dreamIdleMinutes) {
          const cooldownOk = (Date.now() - this._lastDreamAt) > this.dreamCooldownMinutes * 60 * 1000;
          if (cooldownOk) {
            this._lastDreamAt = Date.now();
            console.log(`[Heartbeat] 💤 Poseidon idle ${pm.idle_minutes.toFixed(1)}min — triggering dream`);
            this.modelService.triggerDream().catch(e =>
              console.warn('[Heartbeat] Dream trigger error:', e.message)
            );
          }
        }
      } catch {}
    }
  }

  _measure() {
    // CPU
    const now = this._readCpuTimes();
    const cpuPercent = this._cpuDelta(this.lastCpuTimes, now);
    this.lastCpuTimes = now;
    
    // RAM (in GB)
    const totalRam = os.totalmem() / (1024 ** 3);
    const freeRam = os.freemem() / (1024 ** 3);
    const usedRam = totalRam - freeRam;
    
    // VRAM via nvidia-smi if available
    const vram = this._readVram();
    
    return {
      cpu_percent: Math.round(cpuPercent * 10) / 10,
      cpu_cores: os.cpus().length,
      ram_percent: Math.round((usedRam / totalRam) * 100 * 10) / 10,
      ram_used_gb: Math.round(usedRam * 100) / 100,
      total_ram_gb: Math.round(totalRam * 100) / 100,
      vram_percent: vram.percent,
      vram_used_gb: vram.used_gb,
      total_vram_gb: vram.total_gb,
      load_avg_1m: os.loadavg()[0],
      last_measured_at: new Date().toISOString()
    };
  }

  _readCpuTimes() {
    const cpus = os.cpus();
    let user = 0, nice = 0, sys = 0, idle = 0, irq = 0;
    for (const cpu of cpus) {
      user += cpu.times.user;
      nice += cpu.times.nice;
      sys += cpu.times.sys;
      idle += cpu.times.idle;
      irq += cpu.times.irq;
    }
    return { user, nice, sys, idle, irq, total: user + nice + sys + idle + irq };
  }

  _cpuDelta(prev, curr) {
    if (!prev) return 0;
    const totalDelta = curr.total - prev.total;
    const idleDelta = curr.idle - prev.idle;
    if (totalDelta === 0) return 0;
    return ((totalDelta - idleDelta) / totalDelta) * 100;
  }

  _readVram() {
    try {
      const out = execSync('nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader,nounits', {
        timeout: 1000,
        stdio: ['pipe', 'pipe', 'ignore']
      }).toString().trim();
      const [usedMB, totalMB] = out.split(',').map(s => parseInt(s.trim(), 10));
      const used = usedMB / 1024;
      const total = totalMB / 1024;
      return {
        used_gb: Math.round(used * 100) / 100,
        total_gb: Math.round(total * 100) / 100,
        percent: total > 0 ? Math.round((used / total) * 100 * 10) / 10 : 0
      };
    } catch {
      return { used_gb: 0, total_gb: 0, percent: 0 };
    }
  }
}

module.exports = HeartbeatService;
