/**
 * GlobalSearch — CONTENT search for the Ctrl+K palette.
 *
 * The palette already fuzzy-matches registry NAMES (agents, projects,
 * tasks, skills, models) instantly client-side. What it cannot do is look
 * INSIDE files — "where did the agent write about GPU costs?" This service
 * fills exactly that gap:
 *   files  — BM25 chunks from every project's output/+input/ (reuses
 *            ProjectRetriever; its mtime-fingerprint cache makes repeat
 *            queries nearly free)
 *   memory — project_memory.json content per project
 * Capped work: 20 projects × top-2 chunks; response ≤ 16 hits.
 */

const fs   = require('fs').promises;
const path = require('path');
const AQUARIUM = require('../aquarium');
const { retrieve } = require('./ProjectRetriever');

function toks(s) {
  return String(s).toLowerCase().split(/[^a-z\u00e0-\u00ff0-9_]+/i).filter(t => t.length > 1);
}
function overlapScore(qTokens, text) {
  const t = new Set(toks(text));
  if (!t.size) return 0;
  let hit = 0;
  for (const q of qTokens) if (t.has(q)) hit++;
  return hit / qTokens.length;
}

class GlobalSearch {
  constructor(rm) { this.rm = rm; }

  async search(query, { limit = 16 } = {}) {
    const q = String(query || '').trim();
    if (q.length < 2) return { ok: true, query: q, hits: [] };
    const qTokens = [...new Set(toks(q))];
    const hits = [];

    let projects = [];
    try {
      const preg = await this.rm.getProjectRegistry();
      projects = Object.values(preg?.projects || {}).filter(p => p.status !== 'archived').slice(0, 20);
    } catch {}

    for (const p of projects) {
      const folder = p.folder || p.name?.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
      const dir = path.join(AQUARIUM.PROJECTS, folder);
      try {
        const rs = await retrieve(dir, q, { topK: 2, excerptChars: 130 });
        for (const r of rs) {
          hits.push({ type: 'filehit', score: r.score + 0.4, title: r.file.split('/').pop(),
            subtitle: `${p.name} \u00b7 ${r.excerpt}`,
            project: p.name, project_id: p.project_id, folder, file: r.file });
        }
      } catch {}
      try {
        const raw = await fs.readFile(path.join(dir, 'project_memory.json'), 'utf8');
        const s = overlapScore(qTokens, raw.slice(0, 20000));
        if (s > 0.5) hits.push({ type: 'memoryhit', score: s, title: `Memory: ${p.name}`,
          subtitle: 'project memory contains your terms',
          project: p.name, project_id: p.project_id, folder });
      } catch {}
    }

    hits.sort((a, b) => b.score - a.score);
    return { ok: true, query: q, hits: hits.slice(0, limit) };
  }
}

module.exports = GlobalSearch;
