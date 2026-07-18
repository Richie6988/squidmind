/**
 * InputWatcher — event-driven task creation from file drops.
 *
 * A project with `auto_analyze: true` gets its input/ directory polled
 * (30s); every NEW file spawns an analysis task assigned to the project's
 * first agent (or best available). Idempotence-by-title is the natural
 * dedup: the task title embeds the filename, so a file can never trigger
 * twice — even across restarts, because the seen-set is persisted.
 *
 * Design choices:
 *  - POLLING, not fs.watch: inotify descriptors leak across editors/rsync
 *    partial writes; a 30s poll on a handful of dirs is free and boring.
 *  - Partial-upload guard: a file is only "arrived" when its size is
 *    unchanged between two consecutive polls — big CSVs land whole.
 *  - Seen-set persisted to LOGS/input_seen.json (name+size+mtime key), so
 *    a server restart doesn't re-trigger the whole directory.
 *  - Toggle-time watermark: enabling auto-analyze only watches files that
 *    appear AFTER the toggle — flipping it on doesn't storm 50 tasks for
 *    the archive that was already sitting there.
 */

const fs   = require('fs').promises;
const path = require('path');
const AQUARIUM = require('../aquarium');
const log = require('../utils/logger').createLogger('InputWatcher');

const SEEN_PATH = path.join(AQUARIUM.LOGS, 'input_seen.json');
const TICK_MS   = 30_000;
const ANALYZABLE = /\.(csv|tsv|json|md|txt|xlsx|pdf|log|xml|yaml|yml|html?)$/i;

class InputWatcher {
  constructor(rm, orchestrator) {
    this.rm = rm;
    this.orchestrator = orchestrator;
    this._timer = null;
    this._seen = null;        // { "<folder>/<name>|<size>|<mtime>": ts }
    this._pending = new Map(); // key → size (partial-upload guard)
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick().catch(e => log.warn('tick:', e.message)), TICK_MS);
    log.info('InputWatcher started (30s poll on auto_analyze projects)');
  }
  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  async _loadSeen() {
    if (this._seen) return this._seen;
    try { this._seen = JSON.parse(await fs.readFile(SEEN_PATH, 'utf8')); }
    catch { this._seen = {}; }
    return this._seen;
  }
  async _saveSeen() {
    // Bound the file: keep the newest 2000 keys
    const keys = Object.keys(this._seen);
    if (keys.length > 2000) {
      const sorted = keys.sort((a, b) => (this._seen[a] || 0) - (this._seen[b] || 0));
      for (const k of sorted.slice(0, keys.length - 2000)) delete this._seen[k];
    }
    await fs.writeFile(SEEN_PATH, JSON.stringify(this._seen), 'utf8').catch(() => {});
  }

  /** Mark every current input file as seen — called when auto_analyze turns
   *  ON so the pre-existing archive doesn't storm tasks. */
  async baseline(folder) {
    const seen = await this._loadSeen();
    const dir = path.join(AQUARIUM.PROJECTS, folder, 'input');
    const files = await fs.readdir(dir).catch(() => []);
    let n = 0;
    for (const f of files) {
      try {
        const st = await fs.stat(path.join(dir, f));
        if (st.isFile()) { seen[`${folder}/${f}|${st.size}|${Math.round(st.mtimeMs)}`] = Date.now(); n++; }
      } catch {}
    }
    await this._saveSeen();
    log.info(`baseline: ${n} existing input file(s) marked seen for ${folder}`);
    return n;
  }

  async tick() {
    if (require('./PauseControl').isPaused()) return;   // global pause
    const preg = await this.rm.getProjectRegistry().catch(() => null);
    const projects = Object.values(preg?.projects || {})
      .filter(p => p.auto_analyze && p.status !== 'archived');
    if (!projects.length) return;
    const seen = await this._loadSeen();
    let dirty = false;

    for (const proj of projects) {
      const folder = proj.folder || proj.name?.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const dir = path.join(AQUARIUM.PROJECTS, folder, 'input');
      const files = await fs.readdir(dir).catch(() => []);
      for (const f of files) {
        if (f.startsWith('.')) continue;
        let st;
        try { st = await fs.stat(path.join(dir, f)); } catch { continue; }
        if (!st.isFile()) continue;
        const key = `${folder}/${f}|${st.size}|${Math.round(st.mtimeMs)}`;
        if (seen[key]) continue;
        // Partial-upload guard: require stable size across two polls.
        const pKey = `${folder}/${f}`;
        const prevSize = this._pending.get(pKey);
        if (prevSize !== st.size) { this._pending.set(pKey, st.size); continue; }
        this._pending.delete(pKey);
        seen[key] = Date.now(); dirty = true;

        if (!ANALYZABLE.test(f)) {
          log.info(`skip (not analyzable): ${folder}/input/${f}`);
          continue;
        }
        await this._spawnAnalysis(proj, folder, f).catch(e =>
          log.warn(`spawn failed for ${f}: ${e.message}`));
      }
    }
    if (dirty) await this._saveSeen();
  }

  async _spawnAnalysis(proj, folder, filename) {
    const base = filename.replace(/\.[^.]+$/, '');
    const title = `Analyser le fichier input ${filename}`;
    // Pick the assignee: first assigned agent, else registry default.
    let agentId = (proj.assigned_agents || [])[0] || null;
    if (!agentId && this.rm.pickDefaultAgent) {
      try { agentId = await this.rm.pickDefaultAgent(proj.name); } catch {}
    }
    const description = [
      `Un nouveau fichier est arrivé dans input/: ${filename}.`,
      `1. Lis input/${filename} (read_file).`,
      `2. Identifie sa nature (données tabulaires, texte, rapport, log…) et sa structure.`,
      `3. Produis une analyse structurée: contenu, colonnes/sections clés, statistiques ou points saillants, anomalies éventuelles, et 2-3 usages possibles dans ce projet.`,
      `4. Écris le résultat dans output/${base}_analysis.md (write_file). Structure .md claire avec titres.`,
    ].join('\n');
    const r = await this.orchestrator._createTaskInner({
      title, description,
      acceptance_criteria: `output/${base}_analysis.md existe et contient une analyse structurée du fichier (pas un placeholder).`,
      project: proj.name,
      assigned_agent_id: agentId || undefined,
      priority: 'medium',
    });
    if (r?.ok === false && /already exists/i.test(r?.error || r?.message || '')) {
      log.info(`dedup: analysis task already exists for ${filename}`);
      return;
    }
    log.info(`📥 auto-analysis task created for ${folder}/input/${filename}${agentId ? ` → ${agentId}` : ''}`);
    await this.rm.log({
      event_type: 'input_watcher',
      actor: { type: 'system', id: 'input_watcher' },
      subject: { type: 'project', id: proj.project_id || proj.name },
      action: `New input ${filename} → analysis task created`,
    }).catch(() => {});
  }
}

module.exports = InputWatcher;
