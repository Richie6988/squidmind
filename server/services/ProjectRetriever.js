/**
 * ProjectRetriever — zero-dependency BM25 retrieval over a project's files.
 *
 * Purpose: the agent phase runs on a tight context (12k). Instead of dumping
 * every project file (or just filenames), retrieve the 2-3 chunks most
 * relevant to THE TASK AT HAND and inject short excerpts into the prompt.
 *
 * Design constraints (IAQUA local-first):
 *  - No vector DB, no embeddings, no native deps — pure JS BM25.
 *  - Index cached per project, invalidated by an mtime+size fingerprint,
 *    so repeated tasks in the same project don't re-read every file.
 *  - Text files only, capped at 200KB per file — bigger files are truncated
 *    (their head usually carries the structure/summary anyway).
 */

const fs   = require('fs').promises;
const path = require('path');

// Minimal FR+EN stopword set — enough to stop them dominating BM25 scores.
const STOP = new Set(('the a an and or of to in for on with is are was be as at by it this that from ' +
  'le la les un une des du de et ou à au aux en pour sur avec est sont était dans ce cette ça qui que ne pas').split(' '));

const _cache = new Map();   // projectDir → { fp, chunks, df, avgLen, built_at }

function tokenize(text) {
  return String(text).toLowerCase()
    .split(/[^a-zà-ÿ0-9_]+/i)
    .filter(t => t.length > 1 && !STOP.has(t));
}

/** Split a document into ~paragraph chunks of 150-400 words. */
function chunkify(text, file) {
  const paras = String(text).split(/\n\s*\n/);
  const chunks = [];
  let buf = [], words = 0;
  const flush = () => {
    if (!words) return;
    const body = buf.join('\n\n').trim();
    if (body) chunks.push({ file, text: body.slice(0, 2000) });
    buf = []; words = 0;
  };
  for (const p of paras) {
    const w = p.split(/\s+/).length;
    buf.push(p); words += w;
    if (words >= 250) flush();
  }
  flush();
  return chunks;
}

async function fingerprint(dirs) {
  const parts = [];
  for (const dir of dirs) {
    const files = await fs.readdir(dir).catch(() => []);
    for (const f of files) {
      try {
        const st = await fs.stat(path.join(dir, f));
        if (st.isFile()) parts.push(`${f}:${st.mtimeMs}:${st.size}`);
      } catch {}
    }
  }
  return parts.sort().join('|');
}

async function buildIndex(projectDir) {
  const dirs = [path.join(projectDir, 'output'), path.join(projectDir, 'input')];
  const fp = await fingerprint(dirs);
  const cached = _cache.get(projectDir);
  if (cached && cached.fp === fp) return cached;

  const chunks = [];
  for (const dir of dirs) {
    const files = await fs.readdir(dir).catch(() => []);
    for (const f of files) {
      if (/\.(png|jpe?g|webp|gif|pdf|zip|bin|gguf|mp[34]|wav|xlsx|pptx|docx)$/i.test(f)) continue;
      try {
        const st = await fs.stat(path.join(dir, f));
        if (!st.isFile() || st.size > 400_000) continue;
        let text = await fs.readFile(path.join(dir, f), 'utf8');
        if (text.length > 200_000) text = text.slice(0, 200_000);
        const rel = `${path.basename(dir)}/${f}`;
        chunks.push(...chunkify(text, rel));
      } catch {}
    }
  }
  // Term frequencies per chunk + document frequencies.
  const df = new Map();
  for (const ch of chunks) {
    ch.tokens = tokenize(ch.text);
    ch.len = ch.tokens.length || 1;
    ch.tf = new Map();
    for (const t of ch.tokens) ch.tf.set(t, (ch.tf.get(t) || 0) + 1);
    for (const t of ch.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  }
  const avgLen = chunks.length ? chunks.reduce((n, c) => n + c.len, 0) / chunks.length : 1;
  const idx = { fp, chunks, df, avgLen, built_at: Date.now() };
  _cache.set(projectDir, idx);
  // Bound the cache — 20 projects is plenty for one machine.
  if (_cache.size > 20) _cache.delete(_cache.keys().next().value);
  return idx;
}

/** BM25 (k1=1.4, b=0.75). Returns [{file, excerpt, score}] topK. */
async function retrieve(projectDir, query, { topK = 3, excerptChars = 320 } = {}) {
  try {
    const idx = await buildIndex(projectDir);
    if (!idx.chunks.length) return [];
    const qTokens = [...new Set(tokenize(query))];
    if (!qTokens.length) return [];
    const N = idx.chunks.length;
    const k1 = 1.4, b = 0.75;
    const scored = idx.chunks.map(ch => {
      let score = 0;
      for (const q of qTokens) {
        const f = ch.tf.get(q) || 0;
        if (!f) continue;
        const n = idx.df.get(q) || 0;
        const iidf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += iidf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * ch.len / idx.avgLen));
      }
      return { ch, score };
    }).filter(x => x.score > 0);
    scored.sort((a, b2) => b2.score - a.score);
    return scored.slice(0, topK).map(({ ch, score }) => ({
      file: ch.file,
      excerpt: ch.text.replace(/\s+/g, ' ').trim().slice(0, excerptChars),
      score: Math.round(score * 100) / 100,
    }));
  } catch {
    return [];
  }
}

module.exports = { retrieve };
