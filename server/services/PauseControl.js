/**
 * PauseControl — the big red button.
 *
 * One global switch that freezes every AUTONOMOUS loop — TaskRunner,
 * MissionControl, InputWatcher, Scheduler, dream cycle — while CHAT STAYS
 * ALIVE. Use cases: reclaiming the GPU for something else, stopping a
 * runaway mission, quiet debugging.
 *
 * Persisted to BRAIN/pause.json so a restart keeps the pause (a machine
 * you paused before rebooting should come back paused). Reads are cached
 * 2s: every loop tick checks isPaused() and that must cost nothing.
 */

const fs   = require('fs');
const path = require('path');
const AQUARIUM = require('../aquarium');
const log = require('../utils/logger').createLogger('Pause');

const STATE_PATH = path.join(AQUARIUM.BRAIN, 'pause.json');
const CACHE_MS = 2000;

class PauseControl {
  constructor() {
    this._cache = null;
    this._cachedAt = 0;
  }

  _read() {
    const now = Date.now();
    if (this._cache && now - this._cachedAt < CACHE_MS) return this._cache;
    try { this._cache = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
    catch { this._cache = { paused: false }; }
    this._cachedAt = now;
    return this._cache;
  }

  isPaused() { return !!this._read().paused; }

  state() { return { ...this._read() }; }

  setPaused(paused, by = 'user') {
    const st = { paused: !!paused, by, at: new Date().toISOString() };
    try {
      fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
      fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2), 'utf8');
    } catch (e) { log.warn(`persist failed: ${e.message}`); }
    this._cache = st; this._cachedAt = Date.now();
    log.info(paused ? `⏸ SYSTEM PAUSED (by ${by}) — autonomous loops frozen, chat stays alive`
                    : `▶ SYSTEM RESUMED (by ${by})`);
    return st;
  }
}

module.exports = new PauseControl();
