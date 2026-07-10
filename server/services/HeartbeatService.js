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
const log = require('../utils/logger').createLogger('HeartbeatService');
const { execSync } = require('child_process');

class HeartbeatService {
  constructor(registryManager, intervalMs = 5000) {
    this.rm = registryManager;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.lastCpuTimes = null;
    this.wasOverloaded = false;
    this.modelService = null;          // wired in by index.js
    this.taskRunner   = null;          // wired in by index.js
    this._lastPlannerAt = 0;
    this.dreamIdleMinutes = 15;        // dream after N minutes of Poseidon idle
    this._lastDreamAt = 0;
    this.dreamCooldownMinutes = 30;    // min gap between dream cycles
    this._lastDreamSkipLogAt = 0;      // rate-limit skip-reason logs to once/60s
    this.dreamRequiresIdleSession = true;  // when true, skip dream if chat session has active turns unless idle > 45min
    this._lastProjectAuditAt = {};     // project_id → last audit timestamp
    this.projectAuditIntervalMs = 20 * 60 * 1000; // review each project at most every 20 min
  }

  setModelService(ms) { this.modelService = ms; }
  setTaskRunner(tr)    { this.taskRunner = tr; }

  start() {
    if (this.timer) return;
    // Initial reading needs two samples for CPU delta
    this.lastCpuTimes = this._readCpuTimes();
    this.timer = setInterval(() => this.tick().catch(err =>
      log.error('[Heartbeat] tick failed:', err.message)
    ), this.intervalMs);
    log.info(`[Heartbeat] Started (every ${this.intervalMs}ms)`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('[Heartbeat] Stopped');
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
    
    await this.rm.write('BRAIN/poseidon_brain.json', brain);
    
    // Update model registry system_resources (bootstrap if missing)
    const modelReg = await this.rm.read('MODELS/model_registry.json');
    if (!modelReg.system_resources) modelReg.system_resources = {};
    modelReg.system_resources.total_ram_gb         = load.total_ram_gb;
    modelReg.system_resources.total_vram_gb        = load.total_vram_gb;
    modelReg.system_resources.total_cpu_cores      = load.cpu_cores;
    modelReg.system_resources.current_ram_used_gb  = load.ram_used_gb;
    modelReg.system_resources.current_vram_used_gb = load.vram_used_gb;
    modelReg.system_resources.current_cpu_percent  = load.cpu_percent;
    modelReg.system_resources.last_measured_at     = load.last_measured_at;
    await this.rm.write('MODELS/model_registry.json', modelReg);
    
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
    // Only trigger dream if:
    //   1. Broker is idle (no active or queued LLM work)
    //   2. Poseidon model is loaded
    //   3. Model has been idle for dreamIdleMinutes
    //   4. Cooldown period has passed
    if (this.modelService) {
      try {
        const broker = this.modelService.broker;
        const brokerState = broker?.getState?.();
        const status = this.modelService.getStatus();
        const pm = status.loaded_models.find(m => m.model_id === status.poseidon_model_id);
        let skipReason = null;
        if (!brokerState || brokerState.state !== 'IDLE' || brokerState.queue.length > 0) {
          skipReason = `broker busy (state=${brokerState?.state}, queue=${brokerState?.queue?.length})`;
        } else if (!pm) {
          // Model not loaded. Historically this skipped forever, so temp.md
          // accumulated and consolidation NEVER ran when Poseidon had been
          // evicted (image gen) or was simply not loaded since boot. Fix:
          // if there is meaningful interaction log to consolidate and the
          // cooldown has passed, auto-load Poseidon and dream directly.
          const dreamWorthy = this._tempLogHasContent();
          const cooledDown  = (Date.now() - this._lastDreamAt) > this.dreamCooldownMinutes * 60 * 1000;
          if (dreamWorthy && cooledDown && this.modelService.poseidonModelId && !this._dreamAutoloading) {
            this._dreamAutoloading = true;
            this._lastDreamAt = Date.now();   // set now to avoid re-entry while loading
            log.info('[Heartbeat] 💤 temp.md has content but Poseidon not loaded — auto-loading for dream consolidation');
            this.modelService.ensureLoaded(this.modelService.poseidonModelId)
              .then(() => this.modelService.triggerDream())
              .catch(e => log.warn('[Heartbeat] Dream autoload failed:', e.message))
              .finally(() => { this._dreamAutoloading = false; });
            skipReason = 'autoload + dream launched in background';
          } else {
            skipReason = dreamWorthy
              ? 'poseidon model not loaded (autoload waiting: cooldown or already in progress)'
              : 'poseidon model not loaded (temp.md empty — nothing to consolidate)';
          }
        } else if (pm.generating) {
          skipReason = 'model generating';
        } else if (pm.dreaming) {
          skipReason = 'already dreaming';
        } else if (pm.idle_minutes < this.dreamIdleMinutes) {
          skipReason = `idle ${pm.idle_minutes.toFixed(1)}min < threshold ${this.dreamIdleMinutes}min`;
        } else if (this.dreamRequiresIdleSession
                   && this.modelService.hasActiveChatSession?.()
                   && pm.idle_minutes < 45
                   && (this.modelService.loaded.get(this.modelService.poseidonModelId)?._sequences || 1) <= 1) {
          // On the single-sequence tier (8GB), triggerDream disposes the chat
          // session to free the slot. If the user has an active conversation
          // with meaningful KV cache, forcing a dispose now costs a 20-25s
          // prompt reprocess on their next message — wait 45min idle first.
          // On multi-sequence tiers (16/32GB) the dream uses a FREE slot and
          // the chat session survives, so this deferral doesn't apply.
          skipReason = `chat session active — will wait 45min idle before disposing (currently ${pm.idle_minutes.toFixed(1)}min)`;
        } else if ((Date.now() - this._lastDreamAt) <= this.dreamCooldownMinutes * 60 * 1000) {
          const cooldownRemainingMin = Math.round((this.dreamCooldownMinutes * 60 * 1000 - (Date.now() - this._lastDreamAt)) / 60000);
          skipReason = `cooldown ${cooldownRemainingMin}min remaining`;
        }
        if (skipReason) {
          // Rate-limit these to once/5min so the log isn't spammed
          if ((Date.now() - this._lastDreamSkipLogAt) > 300_000) {
            this._lastDreamSkipLogAt = Date.now();
            log.info(`[Heartbeat] 💤 dream skipped — ${skipReason}`);
          }
        } else {
          this._lastDreamAt = Date.now();
          log.info(`[Heartbeat] 💤 Poseidon idle ${pm.idle_minutes.toFixed(1)}min, broker IDLE — triggering dream`);
          this.modelService.triggerDream().catch(e =>
            log.warn('[Heartbeat] Dream trigger error:', e.message)
          );
        }
      } catch {}
    }

    // ── PLANNER TICK ───────────────────────────────────────────────────────
    // Every 30s: scan for planned tasks with no assigned agent → notify Poseidon
    // This is the proactive agentic loop: Poseidon assigns or executes pending work
    if (this.taskRunner && this.modelService) {
      this._plannerTick().catch(e =>
        log.warn('[Heartbeat] Planner tick error:', e.message)
      );
      this._projectAuditTick().catch(e =>
        log.warn('[Heartbeat] Project audit tick error:', e.message)
      );
    }

    // Daily state backup — aquarium registries/memories/projects snapshot
    // (models excluded). Fire-and-forget; a failed backup never disturbs
    // the heartbeat. Rotation (keep 10) is handled by the script.
    if (!this._lastBackupAt || (Date.now() - this._lastBackupAt) > 24 * 60 * 60 * 1000) {
      this._lastBackupAt = Date.now();
      try {
        const { exec } = require('child_process');
        const path = require('path');
        const script = path.join(__dirname, '..', '..', 'scripts', 'backup.sh');
        exec(`bash "${script}"`, { timeout: 120_000 }, (err, out) => {
          if (err) log.warn('[Heartbeat] daily backup failed:', err.message);
          else log.info('[Heartbeat] 💾 daily aquarium backup done');
        });
      } catch (e) { log.warn('[Heartbeat] backup spawn error:', e.message); }
    }
  }

  /**
   * _tempLogHasContent — does temp.md contain real interaction lines below
   * the seeded header comments? Mirrors triggerDream's own check so the
   * heartbeat never auto-loads a multi-GB model just to find an empty log.
   */
  _tempLogHasContent() {
    try {
      const fsSync   = require('fs');
      const AQUARIUM = require('../aquarium');
      const raw = fsSync.readFileSync(AQUARIUM.TEMP_LOG, 'utf8').trim();
      const contentBelowHeader = raw
        .split('\n')
        .filter(line => !line.trim().startsWith('<!--'))
        .join('\n')
        .trim();
      // Require a bit of substance (> 200 chars) — a stray blank line isn't
      // worth a model load.
      return contentBelowHeader.length > 200;
    } catch { return false; }
  }

  async _plannerTick() {
    // Don't run planner if Poseidon is busy or model not loaded
    if (!this.modelService?.poseidonModelId) return;
    const now = Date.now();
    if (!this._lastPlannerAt) this._lastPlannerAt = 0;
    if (now - this._lastPlannerAt < 30_000) return; // max once per 30s
    this._lastPlannerAt = now;

    try {
      this.rm.invalidateCache();
      const reg = await this.rm.getTasksRegistry();
      const unassigned = Object.values(reg.tasks || {}).filter(t => {
        const s = t.lifecycle?.status || t.status || 'open';
        return (s === 'open' || s === 'planned') && !t.assigned_to;
      });

      if (unassigned.length === 0) return;

      // Only inject nudge when broker is genuinely idle
      const broker = this.modelService.broker;
      if (!broker?.isDreamAllowed()) return;  // reuse same "nothing pending" check
      const entry = this.modelService.loaded.get(this.modelService.poseidonModelId);
      if (!entry || entry.generating || entry.dreaming) return;

      const taskList = unassigned.slice(0, 5)
        .map(t => `  - [${t.task_id}] ${t.title} (priority: ${t.priority?.label || 'medium'})`)
        .join('\n');

      log.info(`[Heartbeat] 📋 Planner: ${unassigned.length} unassigned tasks — injecting planning nudge`);

      // Store pending planner message — picked up by next Poseidon chat turn
      if (!entry._pendingPlannerNudge) {
        entry._pendingPlannerNudge = [
          `[BACKGROUND PLANNER — ${unassigned.length} unassigned task(s) waiting]`,
          taskList,
          'Review these tasks. For each: either assign to an agent with dispatch_to_agent, or handle directly.',
          'If agents are not set up, handle the highest priority task yourself now.'
        ].join('\n');
      }
    } catch {}
  }

  /**
   * _projectAuditTick — periodically triggers Poseidon to audit each active project.
   * Runs at most once per 2h per project. Only fires when broker is idle (same guard as dream).
   * Poseidon calls audit_project(name) and updates project_memory.next_steps.
   */
  async _projectAuditTick() {
    if (!this.modelService?.poseidonModelId) return;
    const broker = this.modelService.broker;
    if (!broker?.isDreamAllowed()) return;
    const entry = this.modelService.loaded.get(this.modelService.poseidonModelId);
    if (!entry || entry.generating || entry.dreaming) return;
    // Respect the chat-active window — don't swap Poseidon into an auto-review
    // while the user is (or was just) chatting.
    const tr = this.taskRunner || this.modelService.taskRunner;
    if (tr && Date.now() < (tr._chatOpenUntil || 0)) return;

    try {
      this.rm.invalidateCache();
      const projReg = await this.rm.getProjectRegistry();
      const taskReg = await this.rm.getTasksRegistry();
      const allTasks = Object.values(taskReg.tasks || {});
      const now = Date.now();

      for (const [projId, proj] of Object.entries(projReg.projects || {})) {
        // Active/planned work in this project
        const active = allTasks.filter(t =>
          (t.project_id === projId || t.project_name === proj.name) &&
          ['planned', 'in_progress'].includes(t.lifecycle?.status || t.status)
        );
        // Recently-completed tasks (still in the live registry OR results_log)
        // whose output Poseidon hasn't reviewed yet. These are what we want
        // Poseidon to judge for quality and possibly re-run.
        let recentlyDone = [];
        try {
          const results = await this.rm.read('TASKS/results_log.json').catch(() => ({ results: {} }));
          const resArr = Array.isArray(results.results) ? results.results : Object.values(results.results || {});
          recentlyDone = resArr.filter(t =>
            (t.project_id === projId || t.project_name === proj.name) &&
            (t.lifecycle?.status || t.status) === 'completed' &&
            !t._quality_reviewed
          ).slice(0, 5);
        } catch {}

        // Nothing to do for this project
        if (active.length === 0 && recentlyDone.length === 0) continue;

        // Cooldown per project
        const lastAudit = this._lastProjectAuditAt[projId] || 0;
        if (now - lastAudit < this.projectAuditIntervalMs) continue;

        this._lastProjectAuditAt[projId] = now;
        log.info(`[Heartbeat] 🔍 Auto-review: ${proj.name} (${active.length} active, ${recentlyDone.length} completed to review)`);

        const doneList = recentlyDone.length
          ? recentlyDone.map(t => {
              const files = Array.isArray(t.files_written) && t.files_written.length
                ? ` | VERIFIED files: ${t.files_written.slice(0, 6).join(', ')}`
                : ' | VERIFIED files: none';
              return `  [${t.task_id}] ${t.title} → ${(t.result_summary || '(no summary)').slice(0, 100)}${files}`;
            }).join('\n')
          : '  (none)';

        // Pull the project's goal so the review is anchored to the VISION,
        // not just per-task quality. Without this anchor Poseidon judged
        // tasks in isolation and kept spawning file-producing busywork that
        // never advanced (or concluded) the project.
        let visionLine = '', completionLine = '', nextStepsLine = '';
        try {
          const mem = await this.rm.getProjectMemory(projId).catch(() => null);
          if (mem) {
            if (mem.vision) visionLine = `GOAL / VISION: ${String(mem.vision).slice(0, 300)}`;
            if (mem.progress?.completion) completionLine = `Current completion: ${mem.progress.completion}`;
            if (mem.progress?.next_steps?.length) nextStepsLine = `Declared next steps: ${mem.progress.next_steps.slice(0, 4).join('; ').slice(0, 300)}`;
          }
        } catch {}

        // Build the BG review message — a GOAL-PROGRESS DRIVER, not a
        // generic quality pass.
        const msg = [
          `PROJECT GOAL REVIEW: "${proj.name}"`,
          `No user is waiting. Your job: move this project TOWARD ITS GOAL — or conclude it.`,
          visionLine, completionLine, nextStepsLine,
          ``,
          `Active/planned tasks: ${active.length}`,
          `Recently completed tasks to evaluate:`,
          doneList,
          ``,
          `Do the following, in order:`,
          `1. Call audit_project("${proj.name}") for full status.`,
          `2. For each completed task: judge it AGAINST THE GOAL above, not in isolation.`,
          `   - Result advances the goal: good, note what it unlocked.`,
          `   - Result is incomplete/wrong: create ONE follow-up that fixes it (reference the task_id).`,
          `   - Result is scaffolding nobody integrates: do NOT extend it; plan the INTEGRATION step instead.`,
          `3. Update project memory honestly: progress.completion (a % — be realistic), and next_steps as the`,
          `   SHORTEST path to the goal (3 items max). Delete stale next_steps.`,
          `4. Decide ONE of:`,
          `   a) GOAL REACHED: set completion to 100%, log the final achievement, create NO tasks.`,
          `   b) One clear next step exists AND active tasks < 2: create exactly ONE task for it`,
          `      (chain with depends_on if it needs a prior task's output).`,
          `   c) Active tasks >= 2: create NOTHING; the pipeline must drain first.`,
          `RULES: never create more than ONE task in this review. Files are not progress — integration and`,
          `goal advancement are. If you notice repeated file creation without integration, say so in next_steps.`
        ].filter(Boolean).join('\n');

        this.modelService.queueBgMessage?.(msg, `review_${projId}`);

        // Mark these tasks as reviewed NOW (when queued). Without this the
        // same completed tasks were re-reviewed every 20 minutes forever —
        // an improvement loop that never converges just burns tokens. If
        // Poseidon creates a follow-up task, that follow-up will itself get
        // reviewed once completed, so nothing is lost by marking here.
        if (recentlyDone.length) {
          try {
            const rl = await this.rm.read('TASKS/results_log.json').catch(() => null);
            if (rl?.results) {
              const ids = new Set(recentlyDone.map(t => t.task_id));
              if (Array.isArray(rl.results)) {
                for (const r of rl.results) if (ids.has(r.task_id)) r._quality_reviewed = true;
              } else {
                for (const id of ids) if (rl.results[id]) rl.results[id]._quality_reviewed = true;
              }
              await this.rm.write('TASKS/results_log.json', rl);
              this.rm.invalidateCache();
            }
          } catch (e) { log.warn('[Heartbeat] could not mark reviewed:', e.message); }
        }
        break; // one project per tick to avoid flooding
      }
    } catch (e) {
      log.warn('[Heartbeat] _projectAuditTick error:', e.message);
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
