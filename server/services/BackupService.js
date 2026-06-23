/**
 * BackupService — periodic snapshots of critical aquarium state.
 *
 * Backs up to aquarium/.backups/ on a rolling window:
 *   • Every hour: keep last 24 hourly snapshots
 *   • Every day:  keep last 7 daily snapshots
 *
 * Files snapshotted (small + critical):
 *   BRAIN/soul.json
 *   BRAIN/poseidon_brain.json
 *   BRAIN/dream_memory.json
 *   AGENTS/agent_registry.json
 *   PROJECTS/project_registry.json
 *   TASKS/results_log.json
 *   MODELS/model_registry.json
 *
 * Recovery: copy file from .backups/<snapshot_id>/<rel_path> back to live location.
 */

const fs   = require('fs');
const log = require('../utils/logger').createLogger('BackupService');
const fsp  = require('fs').promises;
const path = require('path');

class BackupService {
  constructor(aquariumRoot, options = {}) {
    this.root        = aquariumRoot;
    this.backupDir   = path.join(aquariumRoot, '.backups');
    this.hourlyMax   = options.hourlyMax  || 24;
    this.dailyMax    = options.dailyMax   || 7;
    this.intervalMs  = options.intervalMs || 60 * 60 * 1000; // hourly
    this.timer       = null;
    this.criticalFiles = [
      'BRAIN/soul.json',
      'BRAIN/poseidon_brain.json',
      'BRAIN/dream_memory.json',
      'AGENTS/agent_registry.json',
      'PROJECTS/project_registry.json',
      'TASKS/results_log.json',
      'TASKS/tasks_registry.json',
      'MODELS/model_registry.json',
      'SKILLS/skills_registry.json',
    ];
  }

  start() {
    try { fs.mkdirSync(this.backupDir, { recursive: true }); } catch {}
    try { fs.mkdirSync(path.join(this.backupDir, 'hourly'), { recursive: true }); } catch {}
    try { fs.mkdirSync(path.join(this.backupDir, 'daily'),  { recursive: true }); } catch {}

    // Initial snapshot on startup (5s delay to let services settle)
    setTimeout(() => this.snapshot('hourly').catch(e =>
      log.warn('[Backup] initial snapshot failed:', e.message)
    ), 5000);

    this.timer = setInterval(() => this._tick(), this.intervalMs);
    log.info(`[Backup] Started — hourly snapshots, ${this.hourlyMax} hourly + ${this.dailyMax} daily retained`);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async _tick() {
    try {
      await this.snapshot('hourly');
      // Daily snapshot if last one is older than 24h
      const dailyDir = path.join(this.backupDir, 'daily');
      const dailies  = await fsp.readdir(dailyDir).catch(() => []);
      const lastDaily = dailies.sort().pop();
      if (!lastDaily || (Date.now() - new Date(lastDaily.replace(/_/g, ':')).getTime()) > 24 * 60 * 60 * 1000) {
        await this.snapshot('daily');
      }
    } catch (e) { log.warn('[Backup] tick error:', e.message); }
  }

  async snapshot(bucket = 'hourly') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dest = path.join(this.backupDir, bucket, stamp);
    await fsp.mkdir(dest, { recursive: true });

    let copied = 0;
    for (const rel of this.criticalFiles) {
      const src = path.join(this.root, rel);
      try {
        await fsp.access(src);
        const dst = path.join(dest, rel);
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        await fsp.copyFile(src, dst);
        copied++;
      } catch { /* file may not exist yet */ }
    }
    log.info(`[Backup] Snapshot ${bucket}/${stamp} — ${copied} files`);

    // Prune old snapshots
    await this._prune(bucket, bucket === 'hourly' ? this.hourlyMax : this.dailyMax);
    return { stamp, copied };
  }

  async _prune(bucket, maxKeep) {
    const dir = path.join(this.backupDir, bucket);
    try {
      const entries = (await fsp.readdir(dir)).sort();
      const toDelete = entries.slice(0, Math.max(0, entries.length - maxKeep));
      for (const e of toDelete) {
        await fsp.rm(path.join(dir, e), { recursive: true, force: true });
      }
      if (toDelete.length) log.info(`[Backup] Pruned ${toDelete.length} old ${bucket} snapshot(s)`);
    } catch (e) { log.warn('[Backup] prune error:', e.message); }
  }

  async listSnapshots() {
    const out = { hourly: [], daily: [] };
    for (const bucket of ['hourly', 'daily']) {
      try {
        out[bucket] = (await fsp.readdir(path.join(this.backupDir, bucket))).sort().reverse();
      } catch {}
    }
    return out;
  }
}

module.exports = BackupService;
