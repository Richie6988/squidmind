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
    res.setHeader('Cache-Control',     'no-cache');
    res.setHeader('Connection',        'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write('data: {"type":"connected"}\n\n');
    ReasoningBus.subscribe(res);
    req.on('close', () => ReasoningBus.unsubscribe(res));
  });

  return router;
}

module.exports = { buildPoseidonRoutes };
