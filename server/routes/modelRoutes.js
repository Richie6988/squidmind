/**
 * V2 Model and Poseidon Chat routes
 */
const express = require('express');
const path = require('path');
const FilesystemBrowser = require('../services/FilesystemBrowser');
const ModelDownloader = require('../services/ModelDownloader');

function buildRouter(v2ModelService) {
  const router = express.Router();
  const fsBrowser = new FilesystemBrowser();
  const downloader = new ModelDownloader(v2ModelService.modelsDir);

  // GET /api/v2/models/library - merged scan + registry view (what user sees)
  router.get('/library', async (req, res) => {
    try {
      const library = await v2ModelService.getLibrary();
      res.json({ success: true, ...library });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/v2/models/browse?path=... - list directory contents (subdirs + .gguf only)
  router.get('/browse', async (req, res) => {
    try {
      const result = await fsBrowser.list(req.query.path);
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/v2/models/import-from-path - symlink/copy a .gguf from anywhere
  router.post('/import-from-path', async (req, res) => {
    try {
      const { sourcePath, ...config } = req.body;
      if (!sourcePath) return res.status(400).json({ success: false, error: 'sourcePath required' });
      const result = await fsBrowser.importFromPath(sourcePath, v2ModelService.modelsDir);
      // Now register in library with default config
      const imported = await v2ModelService.importModel(result.fileName, config);
      res.json({ success: true, ...result, ...imported });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/v2/models/download - download from HuggingFace or direct URL
  router.post('/download', async (req, res) => {
    try {
      const { url, fileName } = req.body;
      if (!url) return res.status(400).json({ success: false, error: 'url required' });
      const state = downloader.startDownload(url, fileName);
      res.json({ success: true, downloadId: state.downloadId, fileName: state.fileName });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // GET /api/v2/models/downloads/:id - poll progress
  router.get('/downloads/:id', (req, res) => {
    const state = downloader.getProgress(req.params.id);
    if (!state) return res.status(404).json({ success: false, error: 'Download not found' });
    res.json({ success: true, ...state });
  });

  // GET /api/v2/models/downloads - list all
  router.get('/downloads', (req, res) => {
    res.json({ success: true, downloads: downloader.listAll() });
  });

  // POST /api/v2/models/downloads/:id/cancel
  router.post('/downloads/:id/cancel', (req, res) => {
    const cancelled = downloader.cancel(req.params.id);
    res.json({ success: cancelled, downloadId: req.params.id });
  });

  // POST /api/v2/models/delete-file - permanently delete a .gguf file from data/models
  router.post('/delete-file', async (req, res) => {
    try {
      const { fileName } = req.body;
      if (!fileName) return res.status(400).json({ success: false, error: 'fileName required' });
      const fs = require('fs').promises;
      const path = require('path');
      const fullPath = path.join(v2ModelService.modelsDir, path.basename(fileName));
      
      // Also remove from registry if imported
      const modelId = v2ModelService._fileNameToId(fileName);
      try { await v2ModelService.removeFromLibrary(modelId); } catch {}
      
      await fs.unlink(fullPath);
      res.json({ success: true, fileName });
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
