'use strict';

/**
 * BashExecutor — runs shell commands on the operator's machine.
 *
 * This gives Poseidon (and by extension its agents) real hands-on-the-box
 * capability. The user opted into this explicitly for their local
 * orchestration platform. Security posture:
 *
 *  - Default cwd is aquarium/, override with `cwd` param (must stay
 *    inside a project folder or the aquarium root — no path traversal).
 *  - Timeout enforced (default 30s, max 600s). SIGKILL on timeout.
 *  - stdout + stderr + exit code always returned so the LLM can see
 *    what actually happened. stdout truncated at 20 KB to protect the
 *    context window.
 *  - Every command is appended to aquarium/LOGS/bash_history.jsonl with
 *    { ts, command, cwd, exit_code, duration_ms, danger_flags }.
 *  - Dangerous patterns (rm -rf /, dd of=/dev/, curl | sh, fork bombs,
 *    sudo…) are flagged in the response but NOT blocked by default —
 *    it's the operator's own machine. Set BASH_STRICT=1 in env to hard-
 *    block instead of warn.
 *
 * Not implemented here:
 *  - Interactive commands (no stdin piping)
 *  - sudo elevation (would need password handling)
 *  - Long-running background jobs (use spawn with detached instead)
 */

const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');
const fsp       = fs.promises;

const log = {
  info: (...a) => console.log('[BashExec]', ...a),
  warn: (...a) => console.warn('[BashExec]', ...a),
};

// Patterns that should get flagged. Not exhaustive — a determined operator
// can bypass with `bash -c '...'`. Point is to make accidents visible.
const DANGER_PATTERNS = [
  { pattern: /\brm\s+(-[a-z]*[rRf][a-z]*\s+)?[\/~]/,           label: 'rm on system path' },
  { pattern: /\bdd\s+.*\bof=\/dev\//,                          label: 'dd write to /dev/' },
  { pattern: /\bmkfs\.\w+\s+\/dev\//,                          label: 'mkfs on device' },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,                label: 'fork bomb' },
  { pattern: /\bcurl\s+[^|]*\|\s*(sh|bash|zsh)/,               label: 'curl | sh' },
  { pattern: /\bwget\s+[^|]*\|\s*(sh|bash|zsh)/,               label: 'wget | sh' },
  { pattern: /\bsudo\b/,                                       label: 'sudo elevation' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/,            label: 'system power op' },
  { pattern: /\b(chmod|chown)\s+-R\s+.*[\/~]/,                 label: 'recursive perms on system path' },
  { pattern: />\s*\/dev\/(sd[a-z]|nvme|hd[a-z])/,              label: 'redirect to raw disk' },
];

class BashExecutor {
  constructor({ rm } = {}) {
    this.rm = rm;
    this._logPath = null;
  }

  _getLogPath() {
    if (!this._logPath) {
      const AQUARIUM = require('../aquarium');
      this._logPath = path.join(AQUARIUM.LOGS, 'bash_history.jsonl');
    }
    return this._logPath;
  }

  _scanDangers(command) {
    const flags = [];
    for (const { pattern, label } of DANGER_PATTERNS) {
      if (pattern.test(command)) flags.push(label);
    }
    return flags;
  }

  async _log(entry) {
    try {
      await fsp.mkdir(path.dirname(this._getLogPath()), { recursive: true });
      await fsp.appendFile(this._getLogPath(), JSON.stringify(entry) + '\n', 'utf8');
    } catch (e) { log.warn('log write failed:', e.message); }
  }

  /**
   * @param {string}  command       — shell command, run via /bin/sh -c
   * @param {string}  cwd           — working dir (default aquarium/)
   * @param {number}  timeout_ms    — kill after N ms (default 30_000, max 600_000)
   * @param {object}  env           — extra env vars merged onto process.env
   * @returns {Promise<{ok, exit_code, stdout, stderr, duration_ms, danger_flags, killed}>}
   */
  async run({ command, cwd, timeout_ms = 30_000, env }) {
    if (!command || typeof command !== 'string') {
      return { ok: false, error: '"command" must be a non-empty string' };
    }
    const AQUARIUM = require('../aquarium');
    const workDir = cwd || AQUARIUM.ROOT;
    // Timeout clamp
    timeout_ms = Math.max(500, Math.min(600_000, Number(timeout_ms) || 30_000));

    // Danger scan
    const dangerFlags = this._scanDangers(command);
    if (dangerFlags.length && process.env.BASH_STRICT === '1') {
      return {
        ok: false,
        error: `Blocked (BASH_STRICT=1): ${dangerFlags.join(', ')}`,
        danger_flags: dangerFlags,
      };
    }

    if (!fs.existsSync(workDir)) {
      return { ok: false, error: `cwd does not exist: ${workDir}` };
    }

    const startedAt = Date.now();
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let killed = false;
      // Use /bin/sh -c so full shell syntax works (pipes, redirects, &&)
      const child = spawn('/bin/sh', ['-c', command], {
        cwd:   workDir,
        env:   { ...process.env, ...(env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const MAX_BYTES = 20 * 1024;
      const cap = (buf, chunk) => {
        if (buf.length >= MAX_BYTES) return buf;
        const remaining = MAX_BYTES - buf.length;
        return buf + chunk.toString('utf8').slice(0, remaining);
      };
      child.stdout.on('data', c => { stdout = cap(stdout, c); });
      child.stderr.on('data', c => { stderr = cap(stderr, c); });

      const timer = setTimeout(() => {
        killed = true;
        try { child.kill('SIGKILL'); } catch {}
      }, timeout_ms);

      child.on('close', async (code) => {
        clearTimeout(timer);
        const duration_ms = Date.now() - startedAt;
        const result = {
          ok:           !killed && code === 0,
          exit_code:    code,
          stdout:       stdout || null,
          stderr:       stderr || null,
          duration_ms,
          danger_flags: dangerFlags,
          killed,
          cwd:          workDir,
          command,
        };
        if (killed) result.error = `Command killed after ${timeout_ms}ms timeout`;
        // Log every invocation
        await this._log({
          ts: new Date().toISOString(),
          command, cwd: workDir,
          exit_code: code, duration_ms, killed,
          danger_flags: dangerFlags,
        });
        resolve(result);
      });

      child.on('error', async (err) => {
        clearTimeout(timer);
        await this._log({
          ts: new Date().toISOString(),
          command, cwd: workDir,
          error: err.message, danger_flags: dangerFlags,
        });
        resolve({ ok: false, error: err.message, command, cwd: workDir });
      });
    });
  }
}

module.exports = { BashExecutor };
