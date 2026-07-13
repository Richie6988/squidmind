'use strict';

/**
 * ReasoningBus — lightweight pub/sub for live agent/poseidon thought streams.
 *
 * Producers (TaskRunner, ModelService, PoseidonOrchestrator route) call
 * push(event) to broadcast. Two consumer flavors:
 *
 *   subscribe(res)              — SSE response gets ALL events (global temple panel)
 *   subscribeForTask(taskId, res) — SSE response gets only events with matching task_id
 *                                    (per-task live output viewer)
 *   addListener(fn)             — server-side callback (BotService task follow-up,
 *                                    metrics, dream cycle, etc.)
 *
 * All event payloads MUST be JSON-serializable. Common shapes:
 *   { type:'text',          task_id, chunk }
 *   { type:'thinking',      task_id, chunk }
 *   { type:'tool_call',     task_id, name, args }
 *   { type:'tool_result',   task_id, name, ok, summary }
 *   { type:'task_lifecycle',task_id, status, ... }
 */

class ReasoningBus {
  constructor() {
    this._clients      = new Set();              // global SSE subscribers
    this._taskClients  = new Map();              // task_id -> Set<res>
    this._listeners    = new Set();              // server-side fn callbacks
    this._stats = { pushes: 0, drops: 0 };
  }

  push(event) {
    this._stats.pushes++;
    if (!event || typeof event !== 'object') return;
    const data = `data: ${JSON.stringify(event)}\n\n`;

    // 1) Global subscribers — receive everything
    for (const res of this._clients) {
      try { res.write(data); } catch { this._stats.drops++; }
    }

    // 2) Task-scoped subscribers — only matching task_id
    if (event.task_id && this._taskClients.has(event.task_id)) {
      for (const res of this._taskClients.get(event.task_id)) {
        try { res.write(data); } catch { this._stats.drops++; }
      }
    }

    // 3) Server-side listeners (BotService etc.)
    for (const fn of this._listeners) {
      try { fn(event); } catch (e) {
        // Never let a listener crash the bus.
        // eslint-disable-next-line no-console
        console.warn('[ReasoningBus] listener error:', e.message);
      }
    }
  }

  subscribe(res) {
    this._clients.add(res);
    return () => this.unsubscribe(res);
  }

  unsubscribe(res) {
    this._clients.delete(res);
  }

  /**
   * Register an SSE response to receive only events tagged with this task_id.
   * Returns an unsubscribe function. Caller must call it on disconnect.
   */
  subscribeForTask(taskId, res) {
    if (!taskId) return () => {};
    if (!this._taskClients.has(taskId)) this._taskClients.set(taskId, new Set());
    this._taskClients.get(taskId).add(res);
    return () => this.unsubscribeForTask(taskId, res);
  }

  unsubscribeForTask(taskId, res) {
    const set = this._taskClients.get(taskId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this._taskClients.delete(taskId);
  }

  addListener(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Debug/health snapshot. */
  getStats() {
    return {
      ...this._stats,
      global_clients: this._clients.size,
      task_streams: this._taskClients.size,
      task_clients: [...this._taskClients.values()].reduce((sum, s) => sum + s.size, 0),
      listeners: this._listeners.size,
    };
  }
}

// Singleton — every require() returns the same instance.
const instance = new ReasoningBus();

module.exports = instance;
module.exports.ReasoningBus = ReasoningBus;  // class export for tests
