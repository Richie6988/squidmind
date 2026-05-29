'use strict';

/**
 * Agent execution routes
 *
 * POST /api/v2/agents/:id/run          — SSE stream: run a task message
 * GET  /api/v2/agents/:id/worker-status — current worker status
 * POST /api/v2/agents/:id/reset-session — dispose session (force fresh brain reload)
 * GET  /api/v2/agents/pool/status       — all workers status
 */

function buildAgentRunRoutes(pool) {
  const express = require('express');
  const router  = express.Router();

  // POST /api/v2/agents/:id/run
  // Body: { message: string, task_id?: string }
  router.post('/:id/run', async (req, res) => {
    const { id }     = req.params;
    const { message, task_id } = req.body;

    if (!message) {
      return res.status(400).json({ success: false, error: 'message required' });
    }

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    let gen;
    try {
      gen = await pool.dispatch(id, message);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
      return;
    }

    try {
      for await (const ev of gen) {
        if (ev.type === 'text') {
          res.write(`data: ${JSON.stringify({ text: ev.chunk })}\n\n`);
        } else if (ev.type === 'tool_call') {
          res.write(`event: tool_call\ndata: ${JSON.stringify({ name: ev.name, args: ev.args })}\n\n`);
        } else if (ev.type === 'tool_result') {
          const summary = ev.result?.message
            || (ev.result?.ok !== false ? 'success' : (ev.result?.error || 'failed'));
          res.write(`event: tool_result\ndata: ${JSON.stringify({
            name: ev.name,
            ok: ev.result?.ok !== false,
            summary: String(summary).slice(0, 300),
            duration_ms: ev.duration_ms
          })}\n\n`);
        } else if (ev.type === 'thinking_start') {
          res.write(`event: thinking_start\ndata: {}\n\n`);
        } else if (ev.type === 'thinking') {
          res.write(`event: thinking\ndata: ${JSON.stringify({ text: ev.chunk })}\n\n`);
        } else if (ev.type === 'thinking_end') {
          res.write(`event: thinking_end\ndata: {}\n\n`);
        } else if (ev.type === 'start') {
          res.write(`event: start\ndata: ${JSON.stringify({ agent_id: ev.agent_id, model_id: ev.model_id, task_id })}\n\n`);
        } else if (ev.type === 'end') {
          res.write(`event: end\ndata: ${JSON.stringify({ agent_id: ev.agent_id, task_id })}\n\n`);
        } else if (ev.type === 'error') {
          res.write(`event: error\ndata: ${JSON.stringify({ error: ev.error })}\n\n`);
        }
      }
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    } finally {
      res.end();
    }
  });

  // GET /api/v2/agents/:id/worker-status
  router.get('/:id/worker-status', (req, res) => {
    const s = pool.status();
    const w = s[req.params.id];
    res.json({ agent_id: req.params.id, worker: w || { status: 'not_initialized' } });
  });

  // POST /api/v2/agents/:id/reset-session
  router.post('/:id/reset-session', async (req, res) => {
    try {
      const w = pool._workers.get(req.params.id);
      if (w) {
        await w.dispose();
        pool._workers.delete(req.params.id);
      }
      res.json({ success: true, message: `Session reset for ${req.params.id}` });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/v2/agents/pool/status
  router.get('/pool/status', (req, res) => {
    res.json({ workers: pool.status() });
  });

  return router;
}

module.exports = { buildAgentRunRoutes };
