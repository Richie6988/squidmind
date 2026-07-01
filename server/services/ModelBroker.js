'use strict';
/**
 * ModelBroker — single-model resource coordinator.
 *
 * The GGUF model weights are loaded once in VRAM.  Everything that wants to
 * run inference (Poseidon chat, agent tasks, background tasks, dream cycles,
 * image generation) must go through this broker so only one consumer runs at
 * a time and resources are never double-allocated.
 *
 * PRIORITY LEVELS (lower = more urgent)
 *   0  CHAT        interactive Poseidon ↔ user (preempts everything)
 *   1  AGENT       assigned agent task execution
 *   2  POSEIDON_BG background task run by Poseidon (no agent assigned)
 *   3  DREAM       metacognition (only when queue empty + idle > threshold)
 *   4  IMAGE       image generation (swaps LLM out of VRAM while running)
 *
 * GUARANTEES
 *   - One token active at a time — no concurrent LLM calls
 *   - acquire() returns a Promise that resolves when the slot is free
 *   - release(token) unblocks the highest-priority waiter
 *   - Image gen: LLM is evicted from VRAM before starting, reloaded after
 *   - Dream: refused if any waiter in queue or model still has tasks pending
 *   - Tokens expire after MAX_HOLD_MS to prevent deadlocks on crashes
 *   - Full audit log: every acquire/release/timeout logged to console
 */

const EventEmitter = require('events');

const log = require('../utils/logger').createLogger('ModelBroker');
const PRIORITY = Object.freeze({
  CHAT:         0,
  IMAGE:        1,   // image gen preempts agents — needs full VRAM, evicts LLM
  AGENT:        2,
  POSEIDON_BG:  3,
  DREAM:        4,
});
const PRIORITY_NAMES = Object.fromEntries(Object.entries(PRIORITY).map(([k,v]) => [v,k]));

const MAX_HOLD_MS   = 10 * 60 * 1000;  // 10 min hard timeout
const POLL_MS       = 200;              // how often waiters re-check

class ModelBroker extends EventEmitter {
  constructor() {
    super();

    // ── Active token ───────────────────────────────────────────────────────
    this._token     = null;   // { id, priority, ownerId, acquiredAt, expiresAt }
    this._tokenSeq  = 0;

    // ── Wait queue ─────────────────────────────────────────────────────────
    // Each entry: { priority, ownerId, resolve, reject, queuedAt, id }
    this._queue     = [];

    // ── Statistics ─────────────────────────────────────────────────────────
    this._stats = {
      total_acquired: 0,
      total_timeouts: 0,
      total_preemptions: 0,
      wait_ms_sum: 0,
      wait_count: 0,
    };

    // ── Idle tracking ──────────────────────────────────────────────────────
    this._lastReleasedAt  = Date.now();
    this._idleCallbacks   = [];         // fired when broker goes idle

    // ── Watchdog: release expired tokens every 30s ─────────────────────────
    this._watchdog = setInterval(() => this._checkExpiry(), 30_000);
    this._watchdog.unref?.();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * acquire(priority, ownerId, opts?)
   *   → Promise<token>
   *
   * Waits until the slot is free (respecting priority), then returns a token.
   * Call release(token) when done — ALWAYS in a finally block.
   *
   * opts.timeoutMs  — max wait time before reject (default: 15 min)
   * opts.preemptible — if true, this acquisition can be preempted by a higher-prio waiter (default: false)
   */
  acquire(priority, ownerId, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? 15 * 60 * 1000;
    const queuedAt  = Date.now();
    const reqId     = `${PRIORITY_NAMES[priority] ?? priority}-${ownerId}-${++this._tokenSeq}`;

    return new Promise((resolve, reject) => {
      // If slot is free, grab it immediately
      if (!this._token) {
        this._grant(priority, ownerId, reqId, queuedAt, resolve);
        return;
      }

      // Dream: refused if anything is queued
      if (priority === PRIORITY.DREAM) {
        reject(new Error('BROKER_DREAM_REFUSED: slot busy or queue non-empty'));
        return;
      }

      // Image: refused if AGENT or BG tasks are queued (but not other IMAGE requests)
      // IMAGE has higher priority than AGENT/BG so it will be served first once slot free.
      if (priority === PRIORITY.IMAGE) {
        const llmQueued = this._queue.some(e => e.priority >= PRIORITY.AGENT && e.priority <= PRIORITY.POSEIDON_BG);
        if (llmQueued) {
          reject(new Error('BROKER_IMAGE_REFUSED: LLM tasks queued'));
          return;
        }
      }

      // Queue the request
      const entry = { priority, ownerId, resolve, reject, queuedAt, id: reqId };
      this._queue.push(entry);
      this._queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);

      log.info(`[Broker] QUEUED  ${reqId} (queue depth: ${this._queue.length})`);

      // Timeout
      const timer = setTimeout(() => {
        const idx = this._queue.findIndex(e => e.id === reqId);
        if (idx !== -1) {
          this._queue.splice(idx, 1);
          this._stats.total_timeouts++;
          log.warn(`[Broker] TIMEOUT ${reqId} after ${Math.round((Date.now()-queuedAt)/1000)}s`);
          reject(new Error(`BROKER_TIMEOUT: ${reqId} waited too long`));
        }
      }, timeoutMs);

      // Make timer non-blocking
      if (timer.unref) timer.unref();
      entry._timer = timer;
    });
  }

  /**
   * release(token)
   * Releases the active slot.  Must always be called, even on error.
   */
  release(token) {
    if (!this._token || this._token.id !== token?.id) {
      log.warn(`[Broker] release() called with stale/wrong token ${token?.id}`);
      return;
    }

    const held = Date.now() - this._token.acquiredAt;
    log.info(`[Broker] RELEASE ${this._token.id} held=${Math.round(held/1000)}s`);

    this._token = null;
    this._lastReleasedAt = Date.now();
    this.emit('idle');

    // Wake highest-priority waiter
    this._dequeue();
  }

  /**
   * forceReleaseAll(reason)
   * Emergency unblock: drops any held token AND drains the queue,
   * rejecting every waiter. Used by the /unload?force=1 endpoint so a
   * stuck generation doesn't strand the broker in BUSY forever.
   */
  forceReleaseAll(reason = 'forced') {
    const dropped = this._token
      ? `${this._token.id} (held ${Math.round((Date.now() - this._token.acquiredAt) / 1000)}s)`
      : 'none';
    log.warn(`[Broker] FORCE-RELEASE — token=${dropped}, queue=${this._queue.length}, reason=${reason}`);
    this._token = null;
    this._lastReleasedAt = Date.now();
    // Reject every queued waiter so they can bail cleanly
    for (const w of this._queue) {
      try { w.reject(new Error(`Broker force-released: ${reason}`)); } catch {}
    }
    this._queue = [];
    this.emit('idle');
  }

  /**
   * isDreamAllowed()
   * True only if slot free AND queue empty.
   */
  isDreamAllowed() {
    return !this._token && this._queue.length === 0;
  }

  /**
   * hasChatWaiting()
   * True if a CHAT request is queued — used by BG tasks to yield voluntarily.
   */
  hasChatWaiting() {
    return this._queue.some(e => e.priority === PRIORITY.CHAT);
  }

  /**
   * hasHighPriorityWaiting()
   * True if CHAT or IMAGE is waiting — BG tasks should yield.
   * With IMAGE=1 < POSEIDON_BG=3, any queue entry with priority < POSEIDON_BG qualifies.
   */
  hasHighPriorityWaiting() {
    return this._queue.some(e => e.priority < PRIORITY.POSEIDON_BG);
  }
  /**
   * isImageAllowed()
   * True only if slot free AND no LLM-priority tasks queued (CHAT/AGENT/BG).
   * IMAGE evicts the LLM from VRAM — it can't co-exist with queued LLM work.
   */
  isImageAllowed() {
    if (this._token) return false;
    const llmQueued = this._queue.some(e => e.priority >= PRIORITY.AGENT && e.priority <= PRIORITY.POSEIDON_BG);
    return !llmQueued;
  }

  /**
   * getState()
   * Returns a snapshot for monitoring / getStatus().
   */
  getState() {
    return {
      state:     this._token ? 'BUSY' : 'IDLE',
      owner:     this._token?.ownerId ?? null,
      priority:  this._token ? PRIORITY_NAMES[this._token.priority] ?? this._token.priority : null,
      held_sec:  this._token ? Math.round((Date.now() - this._token.acquiredAt) / 1000) : 0,
      queue:     this._queue.map(e => ({ id: e.id, priority: PRIORITY_NAMES[e.priority] ?? e.priority, wait_sec: Math.round((Date.now() - e.queuedAt) / 1000) })),
      idle_sec:  Math.round((Date.now() - this._lastReleasedAt) / 1000),
      stats:     { ...this._stats, avg_wait_ms: this._stats.wait_count ? Math.round(this._stats.wait_ms_sum / this._stats.wait_count) : 0 },
    };
  }

  /**
   * forceRelease — emergency recovery. Drops the current token, clears the queue,
   * and grants the next pending waiter (if any). Only call this when getState
   * shows BUSY for a clearly stuck owner (e.g. dead generator, abandoned SSE).
   */
  forceRelease(reason = 'manual recovery') {
    const wasOwner = this._token?.ownerId || null;
    const heldSec  = this._token ? Math.round((Date.now() - this._token.acquiredAt) / 1000) : 0;
    log.warn?.(`forceRelease called (was BUSY=${!!this._token}, owner=${wasOwner}, held=${heldSec}s) — ${reason}`);
    if (this._token?.timeoutHandle) clearTimeout(this._token.timeoutHandle);
    this._token = null;
    this._lastReleasedAt = Date.now();
    // Drain queue — grant next-highest priority waiter
    if (this._queue.length > 0) {
      this._queue.sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt);
      const next = this._queue.shift();
      this._grant(next.priority, next.ownerId, next.id, next.queuedAt, next.resolve);
    }
    return { released: !!wasOwner, was_owner: wasOwner, was_held_sec: heldSec };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INTERNAL
  // ═══════════════════════════════════════════════════════════════════════

  _grant(priority, ownerId, reqId, queuedAt, resolve) {
    const now = Date.now();
    const waitMs = now - queuedAt;

    this._stats.total_acquired++;
    this._stats.wait_ms_sum += waitMs;
    this._stats.wait_count++;

    this._token = {
      id:          reqId,
      priority,
      ownerId,
      acquiredAt:  now,
      expiresAt:   now + MAX_HOLD_MS,
    };

    if (waitMs > 500) {
      log.info(`[Broker] ACQUIRE ${reqId} waited=${Math.round(waitMs/1000)}s`);
    } else {
      log.info(`[Broker] ACQUIRE ${reqId}`);
    }

    this.emit('acquired', this._token);
    resolve(this._token);
  }

  _dequeue() {
    if (this._queue.length === 0) return;

    const entry = this._queue.shift();
    if (entry._timer) clearTimeout(entry._timer);

    this._grant(entry.priority, entry.ownerId, entry.id, entry.queuedAt, entry.resolve);
  }

  _checkExpiry() {
    if (!this._token) return;
    if (Date.now() > this._token.expiresAt) {
      log.error(`[Broker] EXPIRY  ${this._token.id} — force-releasing after ${Math.round(MAX_HOLD_MS/60000)}min`);
      const stale = this._token;
      this._token = null;
      this._lastReleasedAt = Date.now();
      this.emit('idle');
      this._dequeue();
    }
  }

  destroy() {
    clearInterval(this._watchdog);
  }
}

// Export singleton + constants
ModelBroker.PRIORITY = PRIORITY;
module.exports = ModelBroker;
