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

  // ── Shared HF fetch utility ────────────────────────────────────────────────
  function hfFetch(path, qs = '') {
    const https = require('https');
    // path = e.g. 'models/org/repo' — DON'T encodeURIComponent the slashes
    const url = 'https://huggingface.co/api/' + path + (qs ? '?' + qs : '');
    return new Promise((resolve, reject) => {
      const req = https.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SquidMind/2.0)', 'Accept': 'application/json' }
      }, (r) => {
        // Follow redirects
        if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
          r.resume();
          return hfFetch(r.headers.location.replace('https://huggingface.co/api/', '')).then(resolve).catch(reject);
        }
        if (r.statusCode !== 200) { r.resume(); return reject(new Error('HF API HTTP ' + r.statusCode + ' for ' + url)); }
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('JSON parse failed: ' + e.message)); } });
        r.on('error', reject);
      });
      req.setTimeout(12000, () => { req.destroy(); reject(new Error('HF API timeout')); });
      req.on('error', reject);
    });
  }

  // GET /api/v2/models/hf-search
  // params: q, pipeline (text-generation|image-to-image|text-to-image|feature-extraction|any)
  //         minSize (0.5|1|3|7|13|30), maxSize same, sort (downloads|likes|trending)
  router.get('/hf-search', async (req, res) => {
    const { q = '', limit = 24, sort = 'downloads', pipeline = '', minSize = '', maxSize = '' } = req.query;
    try {
      // Build filter: always gguf + optional pipeline tag
      let filter = 'gguf';
      if (pipeline && pipeline !== 'any') filter += ',' + pipeline;
      const qs = `search=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&sort=${sort}&limit=${limit}&full=false`;
      const models = await hfFetch('models', qs);
      const annotated = (Array.isArray(models) ? models : []).map(m => {
        const id = m.modelId || m.id || '';
        // Size from tags
        let size_hint = null, size_b = null;
        const sizeTag = (m.tags || []).find(t => /^[0-9]+(.[0-9]+)?[bBmM]$/.test(t));
        if (sizeTag) {
          size_hint = sizeTag.toUpperCase();
          const n = parseFloat(sizeTag); const u = sizeTag.slice(-1).toLowerCase();
          size_b = u === 'b' ? n : u === 'm' ? n / 1000 : null;
        }
        // Size filter
        if (size_b !== null) {
          if (minSize && size_b < parseFloat(minSize)) return null;
          if (maxSize && size_b > parseFloat(maxSize)) return null;
        }
        // Role
        let role = 'chat';
        if (/smol|tiny|0\.5b|0\.4b|\b1b\b|1\.5b|135m|360m|500m|256m/i.test(id)) role = 'dream';
        else if (/code|coder|starcoder|deepseek.*coder|codellama/i.test(id)) role = 'code';
        else if (/embed|nomic|e5-|bge-|rerank|minilm/i.test(id)) role = 'embed';
        else if (/reason|think|qwq|o1-|r1\b/i.test(id)) role = 'reason';
        const pt = m.pipeline_tag || '';
        if (!role || role === 'chat') {
          if (/image|text-to-image|image-to-image|vision/i.test(pt)) role = 'image';
          else if (/audio|speech|tts|asr/i.test(pt)) role = 'audio';
        }
        const dl = m.downloads||0;
        // Detect capabilities from tags
        const tags = m.tags || [];
        const caps = [];
        if (/vision|vlm|image.*text|multimodal/i.test(tags.join(' ') + pt)) caps.push('👁 VLM');
        if (/tool.call|function.call|tools/i.test(tags.join(' ')))          caps.push('🔧 Tools');
        if (/instruct|chat/i.test(tags.join(' ') + id))                     caps.push('💬 Chat');
        if (/code|coder/i.test(id + tags.join(' ')))                        caps.push('💻 Code');
        if (/embed|retrieval|rerank/i.test(id + tags.join(' ')))            caps.push('📐 Embed');
        if (/text.to.image|image.gen|flux|stable.diff|sdxl/i.test(id+pt))  caps.push('🖼 ImgGen');
        if (/audio|speech|tts|asr|whisper/i.test(id + pt))                 caps.push('🎵 Audio');
        if (/reason|think|qwq|r1\b/i.test(id))                             caps.push('🧠 Reason');
        return { id, downloads: dl, likes: m.likes||0, tags,
                 role, pipeline: pt, size_hint, size_b, updated: m.lastModified||'', caps };
      }).filter(Boolean);
      res.json({ success: true, models: annotated });
    } catch(e) { res.json({ success: false, error: e.message, models: [] }); }
  });

  // GET /api/v2/models/hf-files?repo=org/repo
  // Returns all GGUF files with real sizes, quant level, recommended flag
  router.get('/hf-files', async (req, res) => {
    const { repo } = req.query;
    if (!repo) return res.json({ success: false, error: 'repo required' });
    try {
      // Use tree API which always returns file sizes reliably
      // First try the model metadata endpoint with blobs=true
      let data;
      try {
        data = await hfFetch('models/' + repo, 'blobs=true');
      } catch(e1) {
        // Fallback: try without blobs (sizes may be 0)
        data = await hfFetch('models/' + repo, 'blobs=false');
      }

      const siblings = (data.siblings || []).filter(f =>
        f.rfilename && (f.rfilename.endsWith('.gguf') || f.rfilename.endsWith('.GGUF'))
      );

      if (!siblings.length) {
        // Try the repo tree endpoint as fallback
        try {
          const tree = await hfFetch(`models/${repo}/tree/main`);
          const treeFiles = (Array.isArray(tree) ? tree : []).filter(f =>
            f.type === 'file' && f.path && (f.path.endsWith('.gguf') || f.path.endsWith('.GGUF'))
          );
          if (treeFiles.length) {
            const files = treeFiles.map(f => ({
              name: f.path,
              size: f.size || 0,
              size_gb: f.size ? Math.round(f.size / (1024**3) * 100) / 100 : null,
              url: `https://huggingface.co/${repo}/resolve/main/${f.path}`,
              quant: detectQuant(f.path),
              recommended: isRecommended(f.path)
            }));
            return res.json({ success: true, repo, files: sortFiles(files), source: 'tree' });
          }
        } catch {}
        return res.json({ success: true, repo, files: [], warning: 'No .gguf files found. This repo may store models differently.' });
      }

      const files = siblings.map(f => ({
        name: f.rfilename,
        size: f.size || 0,
        size_gb: f.size ? Math.round(f.size / (1024**3) * 100) / 100 : null,
        url: `https://huggingface.co/${repo}/resolve/main/${f.rfilename}`,
        quant: detectQuant(f.rfilename),
        recommended: isRecommended(f.rfilename)
      }));
      // Also return repo-level capabilities from metadata
      const repoCaps = [];
      const repoTags = (data.tags || []).join(' ');
      const repoPipeline = data.pipeline_tag || '';
      if (/vision|vlm|multimodal/i.test(repoTags + repoPipeline)) repoCaps.push('👁 VLM');
      if (/tool.call|function.call/i.test(repoTags))               repoCaps.push('🔧 Tools');
      if (/text.to.image|flux|sdxl/i.test(repoTags + repoPipeline)) repoCaps.push('🖼 ImgGen');
      if (/instruct|chat/i.test(repoTags))                          repoCaps.push('💬 Chat');
      if (/code/i.test(repoTags + repo))                            repoCaps.push('💻 Code');
      res.json({ success: true, repo, files: sortFiles(files), source: 'siblings',
                 pipeline: repoPipeline, caps: repoCaps, modelCard: data.cardData?.text?.slice(0,300) });
    } catch(e) { res.json({ success: false, error: e.message, files: [] }); }
  });

  function detectQuant(name) {
    const m = name.match(/[_-]((?:IQ|Q)[0-9]+(?:_[A-Z0-9]+)*)/i)
           || name.match(/((?:IQ|Q)[0-9]+(?:_[A-Z0-9]+)*)/i);
    return m ? m[1].toUpperCase() : 'GGUF';
  }
  function isRecommended(name) {
    // Q4_K_M and Q5_K_M are the sweet spot — flag them
    return /Q[45]_K_M/i.test(name) || /Q4_K_S/i.test(name);
  }
  function sortFiles(files) {
    // Sort: recommended first, then by quant level desc, then by size
    const rank = f => f.recommended ? 0 : /Q8/.test(f.quant) ? 1 : /Q6/.test(f.quant) ? 2 : /Q5/.test(f.quant) ? 3 : /Q4/.test(f.quant) ? 4 : /Q3/.test(f.quant) ? 5 : /Q2/.test(f.quant) ? 6 : /IQ/.test(f.quant) ? 7 : 8;
    return files.sort((a, b) => rank(a) - rank(b) || (b.size - a.size));
  }

  // generate-image: see second declaration below

  // GET /api/v2/models/generated/:fileName — serve a generated image
  router.get('/generated/:fileName', (req, res) => {
    const AQUARIUM = require('../aquarium');
    const safe = req.params.fileName.replace(/[^a-zA-Z0-9._-]/g, '');
    const fpath = path.join(AQUARIUM.ROOT, 'generated', safe);
    if (!fpath.startsWith(AQUARIUM.ROOT)) return res.status(403).send('Forbidden');
    res.sendFile(fpath, err => { if (err) res.status(404).json({ error: 'not found' }); });
  });

  // POST /api/v2/models/download - download from HuggingFace or direct URL
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

  // GET /api/v2/models/broker — broker state for monitoring
  router.get('/broker', (req, res) => {
    res.json({ success: true, broker: v2ModelService.broker?.getState?.() ?? null });
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
  // Uses OrchestratorTools so a task is created in right panel + output in TASKS/<id>/output/
  router.post('/generate-image', async (req, res) => {
    try {
      const { modelId, model_id, prompt, negativePrompt, negative_prompt,
              width, height, steps, cfg, cfg_scale, seed, project_id, filename } = req.body;
      const tools = v2ModelService.orchestrator?.tools;
      if (tools) {
        const result = await tools.generateImage({
          model_id: modelId || model_id,
          prompt,
          negative_prompt: negativePrompt || negative_prompt || '',
          width:  Number(width)  || 512,
          height: Number(height) || 512,
          steps:  Number(steps)  || 20,
          cfg_scale: Number(cfg || cfg_scale) || 7,
          seed:   seed ?? -1,
          project_id: project_id || null,
          filename: filename || null,
        });
        if (!result.ok) return res.status(400).json({ success: false, ok: false, error: result.error });
        return res.json({ success: true, ok: true, ...result });
      }
      // Fallback: orchestrator not ready yet
      const result = await v2ModelService.generateImage(req.body);
      if (!result.ok) return res.status(400).json({ success: false, ok: false, error: result.error });
      res.json({ success: true, ok: true, ...result });
    } catch (err) {
      res.status(500).json({ success: false, ok: false, error: err.message });
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
