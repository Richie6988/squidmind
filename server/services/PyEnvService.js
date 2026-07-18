/**
 * PyEnvService — dedicated Python virtualenv for IAQUA script execution.
 *
 * Location: <repo>/.pyenv  (gitignored, OUTSIDE aquarium/ so the daily
 * backups never swallow a multi-hundred-MB site-packages tree).
 *
 * Behavior:
 *  - Lazy creation: the venv is built on the first install request (or
 *    explicit ensure), not at boot — zero cost until someone needs a lib.
 *  - The temple RUN route prefers .pyenv/bin/python when the venv exists
 *    (the venv IS the isolation — no -I flag needed), and falls back to
 *    system `python3 -I` when it doesn't.
 *  - pip installs run with a 5min timeout and capped output; package names
 *    are validated against a strict regex — no shell injection surface,
 *    no `pip install git+...` or local-path tricks through this API.
 */

const path = require('path');
const fs   = require('fs');
const { spawn } = require('child_process');
const log = require('../utils/logger').createLogger('PyEnv');

const REPO_ROOT = path.join(__dirname, '..', '..');
const VENV_DIR  = path.join(REPO_ROOT, '.pyenv');
const VENV_PY   = path.join(VENV_DIR, 'bin', 'python');
const VENV_PIP  = path.join(VENV_DIR, 'bin', 'pip');

// PEP 508-ish name with optional extras and version spec:
//   pandas | pandas==2.2.1 | requests>=2.31 | uvicorn[standard]
const PKG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}(\[[A-Za-z0-9,_-]{1,40}\])?([=<>!~]=?[A-Za-z0-9.*+!_-]{1,30})?$/;

function _run(cmd, args, { timeoutMs = 60_000, cap = 256 * 1024 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', killed = false;
    const killer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', d => { out += d; if (out.length > cap) { try { child.kill('SIGKILL'); } catch {} } });
    child.stderr.on('data', d => { err += d; if (err.length > cap) err = err.slice(0, cap); });
    child.on('error', e => { clearTimeout(killer); resolve({ ok: false, error: `spawn failed: ${e.message}` }); });
    child.on('close', code => {
      clearTimeout(killer);
      resolve({ ok: code === 0 && !killed, code, killed, stdout: out.slice(0, cap), stderr: err });
    });
  });
}

class PyEnvService {
  exists() { return fs.existsSync(VENV_PY); }

  /** Python binary the RUN route should use, with the matching args prefix. */
  pythonInvocation() {
    return this.exists()
      ? { bin: VENV_PY, preArgs: [], label: 'iaqua venv' }
      : { bin: 'python3', preArgs: ['-I'], label: 'system python3 -I' };
  }

  /** Create the venv if missing. ~10-30s the first time. */
  async ensure() {
    if (this.exists()) return { ok: true, created: false, python: VENV_PY };
    log.info(`Creating IAQUA venv at ${VENV_DIR}…`);
    const r = await _run('python3', ['-m', 'venv', VENV_DIR], { timeoutMs: 120_000 });
    if (!r.ok) {
      return { ok: false, error: `venv creation failed (${r.killed ? 'timeout' : `exit ${r.code}`}): ${(r.stderr || r.stdout).slice(0, 400)}${/ensurepip/.test(r.stderr) ? '\nHint: sudo apt install python3-venv' : ''}` };
    }
    // Fresh venvs ship an old pip — upgrade quietly, best effort.
    await _run(VENV_PIP, ['install', '--upgrade', 'pip', '--quiet'], { timeoutMs: 120_000 });
    log.info('✓ IAQUA venv created');
    return { ok: true, created: true, python: VENV_PY };
  }

  /** Install packages. Creates the venv on first use. */
  async install(packages) {
    if (!Array.isArray(packages) || !packages.length)
      return { ok: false, error: 'packages: non-empty array required' };
    if (packages.length > 15)
      return { ok: false, error: 'max 15 packages per call' };
    const bad = packages.filter(p => !PKG_RE.test(String(p)));
    if (bad.length)
      return { ok: false, error: `invalid package spec(s): ${bad.join(', ')} — plain PyPI names with optional ==version only (no URLs, no local paths)` };
    const ens = await this.ensure();
    if (!ens.ok) return ens;
    log.info(`pip install ${packages.join(' ')}`);
    const r = await _run(VENV_PIP, ['install', ...packages], { timeoutMs: 300_000, cap: 512 * 1024 });
    if (!r.ok) {
      return { ok: false, error: `pip install failed (${r.killed ? 'timeout 5min' : `exit ${r.code}`})`,
        detail: (r.stderr || r.stdout).slice(-1500) };
    }
    // Summarize: pip's "Successfully installed x-1.0 y-2.0" line is the signal.
    const success = (r.stdout.match(/Successfully installed .+/g) || []).pop()
      || 'Requirements already satisfied.';
    return { ok: true, message: success.slice(0, 400), venv_created: ens.created };
  }

  /** Installed packages (name + version). */
  async list() {
    if (!this.exists()) return { ok: true, venv: false, packages: [], note: 'venv not created yet — first install creates it' };
    const r = await _run(VENV_PIP, ['list', '--format', 'json'], { timeoutMs: 30_000 });
    if (!r.ok) return { ok: false, error: r.stderr.slice(0, 300) };
    let pkgs = [];
    try { pkgs = JSON.parse(r.stdout).map(p => `${p.name}==${p.version}`); } catch {}
    return { ok: true, venv: true, count: pkgs.length, packages: pkgs };
  }

  async remove(packages) {
    if (!this.exists()) return { ok: false, error: 'venv not created yet' };
    if (!Array.isArray(packages) || !packages.length) return { ok: false, error: 'packages required' };
    const bad = packages.filter(p => !/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(String(p)));
    if (bad.length) return { ok: false, error: `invalid name(s): ${bad.join(', ')}` };
    const r = await _run(VENV_PIP, ['uninstall', '-y', ...packages], { timeoutMs: 120_000 });
    return r.ok ? { ok: true, message: `Removed: ${packages.join(', ')}` }
                : { ok: false, error: (r.stderr || r.stdout).slice(-500) };
  }
}

module.exports = new PyEnvService();
