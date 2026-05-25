/**
 * V2 Model and Poseidon Chat routes
 */
const express = require('express');

function buildRouter(v2ModelService) {
  const router = express.Router();

  // GET /api/v2/models/library - merged scan + registry view (what user sees)
  router.get('/library', async (req, res) => {
    try {
      const library = await v2ModelService.getLibrary();
      res.json({ success: true, ...library });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/v2/models/available - list local .gguf files in models dir (legacy compat)
  router.get('/available', async (req, res) => {
    try {
      const models = await v2ModelService.scanLocalModels();
      res.json({ success: true, models });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/v2/models/status - what's loaded right now
  router.get('/status', (req, res) => {
    res.json({ success: true, ...v2ModelService.getStatus() });
  });

  // POST /api/v2/models/import - register a model in the library (no load)
  router.post('/import', async (req, res) => {
    try {
      const { fileName, ...config } = req.body;
      if (!fileName) return res.status(400).json({ success: false, error: 'fileName required' });
      const result = await v2ModelService.importModel(fileName, config);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // PATCH /api/v2/models/:id/params - edit load params
  router.patch('/:modelId/params', async (req, res) => {
    try {
      const result = await v2ModelService.updateModelParams(req.params.modelId, req.body);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/v2/models/:id - remove from library
  router.delete('/:modelId', async (req, res) => {
    try {
      const result = await v2ModelService.removeFromLibrary(req.params.modelId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/v2/models/:id/load - explicit manual load (rare; usually auto)
  router.post('/load', async (req, res) => {
    try {
      const { fileName, ...cfg } = req.body;
      if (!fileName) return res.status(400).json({ success: false, error: 'fileName required' });
      const result = await v2ModelService.loadModel(fileName, cfg);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/v2/models/:modelId/unload
  router.post('/:modelId/unload', async (req, res) => {
    try {
      const result = await v2ModelService.unloadModel(req.params.modelId);
      res.json(result);
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/v2/models/:modelId/assign-poseidon
  router.post('/:modelId/assign-poseidon', async (req, res) => {
    try {
      const result = await v2ModelService.setPoseidonModel(req.params.modelId);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  return router;
}

/**
 * Separately export the Poseidon chat route (SSE streaming) since it's not under /models
 */
function buildPoseidonChatRoute(v2ModelService) {
  return async (req, res) => {
    const { message, history } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'message required' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Tell client we started
    res.write(`event: start\ndata: ${JSON.stringify({ model_id: v2ModelService.poseidonModelId })}\n\n`);

    let chunkCount = 0;
    try {
      for await (const chunk of v2ModelService.chatWithPoseidon(message, history || [])) {
        chunkCount++;
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      res.write(`event: end\ndata: ${JSON.stringify({ chunks: chunkCount })}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    } finally {
      res.end();
    }
  };
}

module.exports = { buildRouter, buildPoseidonChatRoute };
