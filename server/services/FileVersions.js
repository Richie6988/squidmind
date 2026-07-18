/**
 * FileVersions — trust layer for file writes.
 *
 * Before ANY overwrite of an existing file — agent write_file, agent
 * edit_file, or the human saving in the temple IDE — the current content
 * is snapshotted to a shadow store. One mechanism, every door: the agent
 * breaking your working analyse.py and you fat-fingering a save are the
 * same event, and both are reversible.
 *
 * Store layout:  <project>/.versions/<relpath with / → __>/<epochMs>
 *   e.g. PROJECTS/NEWS/.versions/output__analyse.py/1752849000123
 *
 * Policies:
 *  - Only files that EXIST get snapshotted (a first write has no past).
 *  - Cap 10 versions per file — oldest deleted on overflow.
 *  - Skip binaries by extension and anything > 2MB (versioning is for the
 *    text artifacts agents actually break; a 500MB CSV re-upload should
 *    not clone itself ten times).
 *  - restore() snapshots the CURRENT content first — a restore is itself
 *    undoable, so there is no destructive path through this module.
 *  - .versions/ is hidden from file listings (dot-dir, existing filters
 *    skip dotfiles) and lives inside the project so a project export
 *    carries its history.
 */

const fs   = require('fs').promises;
const path = require('path');
const log = require('../utils/logger').createLogger('FileVersions');

const MAX_VERSIONS = 10;
const MAX_SIZE     = 2 * 1024 * 1024;
const SKIP_EXT     = /\.(png|jpe?g|webp|gif|bmp|ico|pdf|zip|tar|gz|bin|gguf|mp[34]|wav|ogg|xlsx|pptx|docx|pyc)$/i;

function slot(relPath) {
  return String(relPath).replace(/^[/\\]+/, '').replace(/[/\\]+/g, '__');
}

class FileVersions {
  /** Snapshot the current content of projectDir/relPath if it exists.
   *  Silent no-op for new files, binaries, oversized files, or errors —
   *  versioning must NEVER block a write. */
  async snapshot(projectDir, relPath, { actor = 'agent' } = {}) {
    try {
      if (SKIP_EXT.test(relPath)) return { ok: true, skipped: 'binary' };
      const src = path.join(projectDir, relPath);
      let st;
      try { st = await fs.stat(src); } catch { return { ok: true, skipped: 'new-file' }; }
      if (!st.isFile()) return { ok: true, skipped: 'not-a-file' };
      if (st.size > MAX_SIZE) return { ok: true, skipped: 'too-big' };

      const dir = path.join(projectDir, '.versions', slot(relPath));
      await fs.mkdir(dir, { recursive: true });
      const ts = Date.now();
      await fs.copyFile(src, path.join(dir, String(ts)));
      // Tiny sidecar with actor info (who is about to overwrite)
      await fs.writeFile(path.join(dir, `${ts}.meta`), JSON.stringify({ actor, size: st.size, mtime: st.mtimeMs }), 'utf8').catch(() => {});

      // Enforce the cap
      const entries = (await fs.readdir(dir)).filter(f => /^\d+$/.test(f)).sort();
      while (entries.length > MAX_VERSIONS) {
        const oldest = entries.shift();
        await fs.unlink(path.join(dir, oldest)).catch(() => {});
        await fs.unlink(path.join(dir, `${oldest}.meta`)).catch(() => {});
      }
      return { ok: true, ts };
    } catch (e) {
      log.warn(`snapshot ${relPath}: ${e.message}`);
      return { ok: true, skipped: 'error' };   // never block the write
    }
  }

  async list(projectDir, relPath) {
    try {
      const dir = path.join(projectDir, '.versions', slot(relPath));
      const files = (await fs.readdir(dir).catch(() => [])).filter(f => /^\d+$/.test(f)).sort().reverse();
      const out = [];
      for (const f of files) {
        let meta = {};
        try { meta = JSON.parse(await fs.readFile(path.join(dir, `${f}.meta`), 'utf8')); } catch {}
        let size = meta.size;
        if (size === undefined) { try { size = (await fs.stat(path.join(dir, f))).size; } catch {} }
        out.push({ ts: Number(f), at: new Date(Number(f)).toISOString(), size, actor: meta.actor || 'unknown' });
      }
      return { ok: true, file: relPath, count: out.length, versions: out };
    } catch (e) { return { ok: false, error: e.message }; }
  }

  async read(projectDir, relPath, ts) {
    try {
      const p = path.join(projectDir, '.versions', slot(relPath), String(Number(ts)));
      const content = await fs.readFile(p, 'utf8');
      return { ok: true, ts: Number(ts), content };
    } catch { return { ok: false, error: `version ${ts} not found for ${relPath}` }; }
  }

  /** Restore version ts → the live file. Snapshots current content first. */
  async restore(projectDir, relPath, ts, { actor = 'user' } = {}) {
    try {
      const vPath = path.join(projectDir, '.versions', slot(relPath), String(Number(ts)));
      await fs.access(vPath);
      // Undo-safety: snapshot what's about to be replaced.
      await this.snapshot(projectDir, relPath, { actor: `${actor}:pre-restore` });
      const live = path.join(projectDir, relPath);
      await fs.mkdir(path.dirname(live), { recursive: true });
      await fs.copyFile(vPath, live);
      log.info(`↩ restored ${relPath} → version ${new Date(Number(ts)).toISOString()}`);
      return { ok: true, restored_ts: Number(ts) };
    } catch (e) { return { ok: false, error: e.message }; }
  }
}

module.exports = new FileVersions();
