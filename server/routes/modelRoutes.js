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

      const nodePath = require('path');
      const fsSync   = require('fs');

      // Resolve to absolute path (relative paths are resolved from process.cwd())
      const absPath = nodePath.isAbsolute(sourcePath)
        ? sourcePath
        : nodePath.resolve(process.cwd(), sourcePath);

      // Check existence first — give clear error with actual path tried
      if (!fsSync.existsSync(absPath)) {
        return res.status(400).json({
          success: false,
          error: `File not found: ${absPath}`,
          hint: `Make sure the path is correct and the file exists. You entered: "${sourcePath}"`
        });
      }

      const resolvedModelsDir = nodePath.resolve(v2ModelService.modelsDir);

      // If file is already inside modelsDir, import it directly without symlinking
      if (absPath.startsWith(resolvedModelsDir)) {
        const imported = await v2ModelService.importModel(absPath, config);
        res.json({ success: true, fileName: nodePath.basename(absPath), ...imported });
        return;
      }

      // Otherwise: symlink/copy into modelsDir, then register
      const result = await fsBrowser.importFromPath(absPath, v2ModelService.modelsDir);
      // Register using the SYMLINK path in modelsDir (not the original)
      const symlinkPath = nodePath.join(v2ModelService.modelsDir, result.fileName);
      const imported = await v2ModelService.importModel(symlinkPath, config);
      res.json({ success: true, fileName: result.fileName, action: result.action, ...imported });
    } catch (err) {
      console.error('[import-from-path] error:', err.message);
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

  // GET /api/v2/models/dir - returns the absolute path of the models directory
  // Used by the client to auto-fill the path input after native file picker
  router.get('/dir', (req, res) => {
    const path = require('path');
    res.json({ success: true, dir: path.resolve(v2ModelService.modelsDir) });
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

  // POST /api/v2/models/generate-image
  router.post('/generate-image', async (req, res) => {
    try {
      const result = await v2ModelService.generateImage(req.body);
      if (!result.ok) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // PATCH /api/v2/models/:modelId/type — manually set model_type (text|image)
  router.patch('/:modelId/type', async (req, res) => {
    try {
      const { model_type } = req.body;
      if (!['text', 'image'].includes(model_type)) {
        return res.status(400).json({ success: false, error: 'model_type must be "text" or "image"' });
      }
      await v2ModelService.updateModelParams(req.params.modelId, { model_type });
      res.json({ success: true, model_id: req.params.modelId, model_type });
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
    let toolCallCount = 0;
    try {
      for await (const ev of v2ModelService.chatWithPoseidon(message, history || [])) {
        // chatWithPoseidon now yields { type: 'text'|'tool_call'|'tool_result', ... }
        if (ev.type === 'text') {
          chunkCount++;
          res.write(`data: ${JSON.stringify({ text: ev.chunk })}\n\n`);
        } else if (ev.type === 'tool_call') {
          toolCallCount++;
          res.write(`event: tool_call\ndata: ${JSON.stringify({ name: ev.name, args: ev.args })}\n\n`);
        } else if (ev.type === 'tool_result') {
          const summary = ev.result?.message
            || (ev.result?.ok ? (Object.keys(ev.result).length > 2 ? 'success' : ev.result.ok) : (ev.result?.error || 'failed'));
          res.write(`event: tool_result\ndata: ${JSON.stringify({
            name: ev.name,
            ok: ev.result?.ok !== false,
            summary: typeof summary === 'string' ? summary.slice(0, 300) : String(summary).slice(0, 300),
            duration_ms: ev.duration_ms
          })}\n\n`);
        } else if (ev.type === 'thinking_start') {
          res.write(`event: thinking_start\ndata: {}\n\n`);
        } else if (ev.type === 'thinking') {
          res.write(`event: thinking\ndata: ${JSON.stringify({ text: ev.chunk })}\n\n`);
        } else if (ev.type === 'thinking_end') {
          res.write(`event: thinking_end\ndata: {}\n\n`);
        }
      }
      res.write(`event: end\ndata: ${JSON.stringify({
        chunks: chunkCount,
        tool_calls: toolCallCount,
        turn: v2ModelService.loaded.get(v2ModelService.poseidonModelId)?.sessionTurns ?? 0,
        wipe_threshold: v2ModelService.contextWipeThreshold
      })}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    } finally {
      res.end();
    }
  };
}

function buildAbortRoute(v2ModelService) {
  return (req, res) => {
    const result = v2ModelService.abortGeneration();
    res.json({ success: true, ...result });
  };
}

module.exports = { buildRouter, buildPoseidonChatRoute, buildAbortRoute };
