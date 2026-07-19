'use strict';

/**
 * Health + recovery routes.
 *
 * POST /repair                — recompute registry indices, rebuild orphans
 * GET  /health                — up / degraded / down (200 / 200 / 503) + checks
 * GET  /livez                 — cheap liveness (no IO)
 * GET  /readyz                — readiness (registry readable, returns 503 if not)
 * GET  /broker                — ModelBroker state inspection
 * POST /broker/force-release  — emergency unstick (body: { reason? })
 *
 * Mounted at /api/v2 in server/index.js. modelService is late-bound at boot,
 * so it's accessed lazily via the `refs` object at request time.
 */

function buildHealthRoutes({ rm, repairAllRegistries, dataRoot, refs }) {
  const express = require('express');
  const router  = express.Router();

  // ── POST /repair ────────────────────────────────────────────────────────────
  router.post('/repair', (req, res) => {
    try {
      rm.invalidateCache();
      const report = repairAllRegistries(dataRoot);
      res.json({ success: true, ...report });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /health ─────────────────────────────────────────────────────────────
  router.get('/health', async (req, res) => {
    // Returns 200 + 'up' all-good, 200 + 'degraded' partial, 503 + 'down' core failure.
    const startMs = Date.now();
    const checks = {};
    const coreRegistries = [
      'BRAIN/poseidon_brain.json',
      'AGENTS/agent_registry.json',
      'PROJECTS/tasks_registry.json',
      'PROJECTS/project_registry.json',
      'MODELS/model_registry.json',
    ];
    let coreFailures = 0;
    try { rm.invalidateCache(); } catch {}
    for (const reg of coreRegistries) {
      try { await rm.read(reg); checks[reg] = 'ok'; }
      catch { checks[reg] = 'error'; coreFailures++; }
    }

    const optional = {};
    try {
      const v2 = refs.modelService;
      optional.poseidon_model = v2?.poseidonModelId ? 'configured' : 'not_assigned';
      optional.model_loaded   = v2?.loaded?.size > 0 ? 'yes' : 'no';
      optional.broker_state   = v2?.broker?.getState?.() || 'unknown';
    } catch { optional.broker_state = 'error'; }

    let status, code;
    if (coreFailures === 0)                       { status = 'up';       code = 200; }
    else if (coreFailures < coreRegistries.length) { status = 'degraded'; code = 200; }
    else                                          { status = 'down';     code = 503; }

    res.status(code).json({
      status,
      success: status !== 'down',
      uptime_seconds: Math.floor(process.uptime()),
      response_time_ms: Date.now() - startMs,
      checks,
      optional,
      timestamp: new Date().toISOString(),
    });
  });

  // ── GET /livez ──────────────────────────────────────────────────────────────
  router.get('/livez', (req, res) => {
    res.json({ status: 'alive', uptime_seconds: Math.floor(process.uptime()) });
  });

  // ── GET /readyz ─────────────────────────────────────────────────────────────
  router.get('/readyz', async (req, res) => {
    try {
      await rm.read('BRAIN/poseidon_brain.json');
      res.json({ status: 'ready' });
    } catch (e) {
      res.status(503).json({ status: 'not_ready', error: e.message });
    }
  });

  // ── GET /broker ─────────────────────────────────────────────────────────────
  router.get('/broker', (req, res) => {
    try {
      const state = refs.modelService?.broker?.getState?.();
      res.json({ success: true, state });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ── POST /broker/force-release ──────────────────────────────────────────────
  router.post('/broker/force-release', (req, res) => {
    try {
      const broker = refs.modelService?.broker;
      if (!broker?.forceRelease) {
        return res.status(404).json({ success: false, error: 'forceRelease not available' });
      }
      const reason = req.body?.reason || 'manual recovery via API';
      const result = broker.forceRelease(reason);
      res.json({ success: true, ...result });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
}

module.exports = { buildHealthRoutes };
