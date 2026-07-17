/**
 * ToolForge — Poseidon writes, tests, and registers its OWN tools.
 *
 * The self-extension loop, optimized for a small local model:
 *  1. The model authors ONLY the async handler BODY — the module template,
 *     argument plumbing and error envelope are ours. Less surface = fewer
 *     syntax failures on a 9B model.
 *  2. Validation gauntlet before anything registers:
 *       a. name/size/collision checks (code, not model judgement)
 *       b. `node --check` on the generated file
 *       c. a REAL test run with model-provided test_args in the sandbox —
 *          a tool that never ran green does not enter the arsenal.
 *  3. Execution is out-of-process: child fork of a tiny runner with a hard
 *     timeout (kill -9) and capped output. A broken or looping tool can
 *     NEVER take down the server or block the model's event loop.
 *  4. Self-pruning: 5 consecutive failures auto-disable a tool (the model
 *     is told on the next call, and can forge a fix).
 *
 * Storage: aquarium/TOOLS/
 *   manifest.json           — registry (cached in memory, mtime-checked)
 *   <name>.js               — one CJS module per tool
 * Trust model: same as execute_bash — the local machine is trusted; the
 * sandbox is for STABILITY and bounds, not for containing hostile code.
 */

const fs   = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const AQUARIUM = require('../aquarium');
const log = require('../utils/logger').createLogger('ToolForge');

const TOOLS_DIR   = AQUARIUM.TOOLS;
const MANIFEST    = path.join(TOOLS_DIR, 'manifest.json');
const RUNNER      = path.join(__dirname, 'toolforge_runner.js');
const NAME_RE     = /^[a-z][a-z0-9_]{2,30}$/;
const MAX_TOOLS   = 40;
const MAX_CODE    = 8 * 1024;      // 8KB of handler body
const RUN_TIMEOUT = 30_000;
const TEST_TIMEOUT= 20_000;
const MAX_OUTPUT  = 64 * 1024;     // stdout cap
const AUTO_DISABLE_AFTER = 5;      // consecutive failures

// Builtin tool names are refused as forge names — collision would shadow
// core behavior. Kept as a function so the orchestrator can inject the
// live list at wire-up time.
let RESERVED = new Set();

class ToolForge {
  constructor() {
    this._manifest = null;          // in-memory cache
    this._manifestMtime = 0;
  }

  setReservedNames(names) { RESERVED = new Set(names); }

  async _ensureDir() { await fs.mkdir(TOOLS_DIR, { recursive: true }).catch(() => {}); }

  async _readManifest() {
    await this._ensureDir();
    try {
      const st = await fs.stat(MANIFEST);
      if (this._manifest && st.mtimeMs === this._manifestMtime) return this._manifest;
      this._manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
      this._manifestMtime = st.mtimeMs;
    } catch { this._manifest = { tools: {} }; }
    return this._manifest;
  }

  async _writeManifest(m) {
    await this._ensureDir();
    await fs.writeFile(MANIFEST, JSON.stringify(m, null, 2), 'utf8');
    try { this._manifestMtime = (await fs.stat(MANIFEST)).mtimeMs; } catch {}
    this._manifest = m;
  }

  _toolPath(name) { return path.join(TOOLS_DIR, `${name}.js`); }

  _wrap(name, description, body) {
    return [
      `// FORGED TOOL: ${name}`,
      `// ${String(description).replace(/\n/g, ' ').slice(0, 200)}`,
      `// Authored by Poseidon via forge_tool. Runs out-of-process (toolforge_runner).`,
      `'use strict';`,
      `module.exports = async function ${name}(args, ctx) {`,
      body,
      `};`,
      ``,
    ].join('\n');
  }

  /** Out-of-process execution with hard timeout + output cap. */
  _spawnRun(toolFile, args, timeoutMs) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [RUNNER, toolFile], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, AQUARIUM_ROOT: AQUARIUM.ROOT },
      });
      let out = '', err = '';
      let done = false;
      const finish = (res) => { if (!done) { done = true; resolve(res); } };
      const killer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
        finish({ ok: false, error: `tool timed out after ${Math.round(timeoutMs / 1000)}s (hard-killed)` });
      }, timeoutMs);
      child.stdout.on('data', d => { out += d; if (out.length > MAX_OUTPUT) { try { child.kill('SIGKILL'); } catch {} } });
      child.stderr.on('data', d => { err += d; if (err.length > 8192) err = err.slice(0, 8192); });
      child.on('error', e => { clearTimeout(killer); finish({ ok: false, error: `spawn failed: ${e.message}` }); });
      child.on('close', (code) => {
        clearTimeout(killer);
        if (out.length > MAX_OUTPUT) return finish({ ok: false, error: `output exceeded ${MAX_OUTPUT / 1024}KB cap` });
        try {
          const parsed = JSON.parse(out.trim().split('\n').pop() || '{}');
          finish(parsed && typeof parsed === 'object' ? parsed : { ok: false, error: 'runner returned non-object' });
        } catch {
          finish({ ok: false, error: `tool crashed (exit ${code}): ${(err || out).slice(0, 300)}` });
        }
      });
      child.stdin.write(JSON.stringify(args || {}));
      child.stdin.end();
    });
  }

  _nodeCheck(file) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      child.stderr.on('data', d => err += d);
      child.on('close', code => resolve(code === 0 ? { ok: true } : { ok: false, error: err.slice(0, 400) }));
      child.on('error', e => resolve({ ok: false, error: e.message }));
    });
  }

  /** Forge a new tool: validate → write → node --check → live test → register. */
  async forge({ name, description, params_properties = {}, required = [], code, test_args = {} }) {
    if (!NAME_RE.test(name || ''))
      return { ok: false, error: `Invalid name "${name}" — must match ${NAME_RE} (snake_case, 3-31 chars)` };
    if (RESERVED.has(name))
      return { ok: false, error: `"${name}" collides with a builtin tool — pick another name` };
    if (!code || typeof code !== 'string')
      return { ok: false, error: 'code (the async handler body) is required' };
    if (code.length > MAX_CODE)
      return { ok: false, error: `code too long (${code.length} chars, max ${MAX_CODE}). Split the logic or slim it down.` };
    if (!description || description.length < 10)
      return { ok: false, error: 'description required (min 10 chars) — the model that CALLS this tool only sees the description' };

    const m = await this._readManifest();
    const isUpdate = !!m.tools[name];
    if (!isUpdate && Object.keys(m.tools).length >= MAX_TOOLS)
      return { ok: false, error: `Forge full (${MAX_TOOLS} tools). Delete unused ones first (forge_tool action=list, then action=delete).` };

    // Write candidate to a temp path first — a broken update must not
    // destroy the working version.
    const finalPath = this._toolPath(name);
    const candPath  = this._toolPath(`_candidate_${name}`);
    await this._ensureDir();
    await fs.writeFile(candPath, this._wrap(name, description, code), 'utf8');

    const syn = await this._nodeCheck(candPath);
    if (!syn.ok) {
      await fs.unlink(candPath).catch(() => {});
      return { ok: false, error: `SYNTAX CHECK FAILED — fix and re-forge:\n${syn.error}` };
    }

    const test = await this._spawnRun(candPath, test_args, TEST_TIMEOUT);
    if (!test.ok) {
      await fs.unlink(candPath).catch(() => {});
      return { ok: false, error: `LIVE TEST FAILED with test_args=${JSON.stringify(test_args).slice(0, 200)} — fix and re-forge:\n${test.error || JSON.stringify(test).slice(0, 300)}` };
    }

    // Promote candidate → final, register.
    await fs.rename(candPath, finalPath);
    m.tools[name] = {
      name, description: description.slice(0, 300),
      params: { type: 'object', properties: params_properties, ...(required.length ? { required } : {}) },
      version: (m.tools[name]?.version || 0) + 1,
      enabled: true,
      created_at: m.tools[name]?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      stats: m.tools[name]?.stats || { calls: 0, ok: 0, fail: 0, consecutive_fail: 0 },
      test: { args: test_args, passed_at: new Date().toISOString(), result_preview: JSON.stringify(test.result ?? test).slice(0, 200) },
    };
    await this._writeManifest(m);
    log.info(`⚒ forged "${name}" v${m.tools[name].version} (${code.length} chars, test green)`);
    return { ok: true, name, version: m.tools[name].version,
      test_result_preview: m.tools[name].test.result_preview,
      message: `Tool "${name}" forged and REGISTERED (v${m.tools[name].version}, live test passed). Available from your NEXT turn — the session rebuilds to include it.` };
  }

  /** Execute a forged tool (called by the dynamic handler). */
  async run(name, args) {
    const m = await this._readManifest();
    const t = m.tools[name];
    if (!t) return { ok: false, error: `No forged tool "${name}"` };
    if (!t.enabled) return { ok: false, error: `Tool "${name}" is DISABLED (${t.stats.consecutive_fail} consecutive failures). Fix it with forge_tool action=create (same name = update) or re-enable with action=enable.` };
    const res = await this._spawnRun(this._toolPath(name), args, RUN_TIMEOUT);
    t.stats.calls += 1;
    if (res.ok) { t.stats.ok += 1; t.stats.consecutive_fail = 0; }
    else {
      t.stats.fail += 1; t.stats.consecutive_fail += 1;
      t.last_error = String(res.error || '').slice(0, 300);
      if (t.stats.consecutive_fail >= AUTO_DISABLE_AFTER) {
        t.enabled = false;
        log.warn(`⚒ "${name}" auto-disabled after ${AUTO_DISABLE_AFTER} consecutive failures`);
        res.error = `${res.error}\n[Tool auto-disabled after ${AUTO_DISABLE_AFTER} consecutive failures — forge a fix.]`;
      }
    }
    await this._writeManifest(m).catch(() => {});
    return res;
  }

  async list() {
    const m = await this._readManifest();
    const tools = Object.values(m.tools).map(t => ({
      name: t.name, v: t.version, enabled: t.enabled,
      calls: t.stats.calls, ok: t.stats.ok, fail: t.stats.fail,
      desc: t.description.slice(0, 90),
      ...(t.last_error ? { last_error: t.last_error.slice(0, 100) } : {}),
    }));
    return { ok: true, count: tools.length, max: MAX_TOOLS, tools };
  }

  async remove(name) {
    const m = await this._readManifest();
    if (!m.tools[name]) return { ok: false, error: `No forged tool "${name}"` };
    delete m.tools[name];
    await this._writeManifest(m);
    await fs.unlink(this._toolPath(name)).catch(() => {});
    return { ok: true, message: `Tool "${name}" deleted. Session rebuilds on next turn.` };
  }

  async setEnabled(name, enabled) {
    const m = await this._readManifest();
    const t = m.tools[name];
    if (!t) return { ok: false, error: `No forged tool "${name}"` };
    t.enabled = !!enabled;
    if (enabled) t.stats.consecutive_fail = 0;
    await this._writeManifest(m);
    return { ok: true, message: `Tool "${name}" ${enabled ? 'enabled' : 'disabled'}.` };
  }

  /** Enabled tools for buildFunctions merge (name → {description, params}). */
  async enabledTools() {
    const m = await this._readManifest();
    return Object.values(m.tools).filter(t => t.enabled);
  }
}

module.exports = new ToolForge();
