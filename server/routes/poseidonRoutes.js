'use strict';

/**
 * Poseidon session control + global reasoning stream.
 *
 * Mounted at /api/v2 in server/index.js.
 *
 * GET  /poseidon/session-state — snapshot for auto-continue UI
 * POST /poseidon/reset-session — disposes current chat session (model stays loaded)
 * POST /poseidon/chat-active   — toggle BG task pause while user is chatting
 * GET  /reasoning/stream       — global SSE feed of all agent thoughts
 *
 * /poseidon/chat and /poseidon/abort are mounted separately in index.js
 * because they use specialized factories from modelRoutes.
 */

function buildPoseidonRoutes({ rm, refs }) {
  const express = require('express');
  const router  = express.Router();
  const ReasoningBus = require('../utils/ReasoningBus');

  router.get('/poseidon/session-state', async (req, res) => {
    try {
      const ss = await rm.read('BRAIN/session_state.json');
      res.json(ss || {});
    } catch { res.json({}); }
  });

  router.post('/poseidon/reset-session', async (req, res) => {
    try {
      const v2 = refs.v2ModelService;
      if (!v2?.resetPoseidonSession) {
        return res.status(503).json({ success: false, error: 'Model service not ready' });
      }
      const result = await v2.resetPoseidonSession();
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/poseidon/chat-active', (req, res) => {
    const { active } = req.body || {};
    const tr = refs.taskRunner;
    if (!tr?.setChatActive) {
      return res.status(503).json({ ok: false, error: 'Task runner not ready' });
    }
    tr.setChatActive(!!active);
    res.json({ ok: true, active: !!active });
  });

  router.get('/reasoning/stream', (req, res) => {
    res.setHeader('Content-Type',      'text/event-stream');
    res.setHeader('Cache-Control',     'no-cache, no-transform');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    // CRITICAL: flush headers so the browser's EventSource onopen fires
    // immediately. Without this, Node may buffer until the first big payload,
    // which never comes when no agent is running — and the temple's live
    // stream sits "empty" until something happens, looking broken.
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write('data: {"type":"connected"}\n\n');

    ReasoningBus.subscribe(res);

    // Periodic SSE keepalive (comment lines, ignored by EventSource).
    // Required to keep the connection alive through proxies / Node idle
    // socket timeouts that otherwise close it after ~2 minutes of silence.
    const keepalive = setInterval(() => {
      try { res.write(': keepalive\n\n'); } catch { /* socket closed */ }
    }, 20_000);
    keepalive.unref();

    req.on('close', () => {
      clearInterval(keepalive);
      ReasoningBus.unsubscribe(res);
    });
  });

  // GET /api/v2/dream-state — poller-friendly read of dream_memory.json.
  // Returns 200 with { saved_at:null, last_updated:null } when no dream has
  // happened yet, instead of forcing the client to hit /api/files/read and
  // pollute the network log with a 404.
  router.get('/dream-state', async (req, res) => {
    try {
      const dm = await rm.read('BRAIN/dream_memory.json').catch(() => null);
      if (!dm) return res.json({ ok: true, saved_at: null, last_updated: null });
      res.json({
        ok: true,
        saved_at:     dm.saved_at     || null,
        last_updated: dm.last_updated || null,
        type:         dm.type         || null,
        reflection:   dm.reflection   || null,
        skills_updated: dm.skills_updated || 0,
      });
    } catch (err) {
      res.json({ ok: true, saved_at: null, last_updated: null });
    }
  });

  // POST /api/v2/poseidon/dream — manually kick off a dream cycle.
  // Useful for debugging when the heartbeat conditions (idle threshold,
  // cooldown) haven't been met, or when the user wants to force a soul
  // consolidation before shutting down.
  router.post('/poseidon/dream', async (req, res) => {
    try {
      const v2 = refs.v2ModelService;
      if (!v2?.triggerDream) {
        return res.status(503).json({ ok: false, error: 'Model service not ready' });
      }
      // Fire-and-forget so the HTTP round-trip is quick; client polls
      // /dream-state to observe progress.
      v2.triggerDream({ force: true })  // manual trigger — bypasses the low-compute auto-dream gate
        .then(() => console.info('[poseidon/dream] manual dream complete'))
        .catch(e => console.warn('[poseidon/dream] manual dream error:', e.message));
      res.json({ ok: true, message: 'Dream cycle triggered — check /dream-state for progress' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}

module.exports = { buildPoseidonRoutes };
