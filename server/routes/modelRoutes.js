/**
 * V2 Model and Poseidon Chat routes
 */
const express = require('express');
const path = require('path');
const FilesystemBrowser = require('../services/FilesystemBrowser');
const ModelDownloader = require('../services/ModelDownloader');

const log = require('../utils/logger').createLogger('modelRoutes');
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
      log.error('[import-from-path] error:', err.message);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // ── Shared HF fetch utility ────────────────────────────────────────────────
  function hfFetch(path, qs = '') {
    const https = require('https');
    // path = e.g. 'models/org/repo' — DON'T encodeURIComponent the slashes
    const url = 'https://huggingface.co/api/' + path + (qs ? '?' + qs : '');
    return new Promise((resolve, reject) => {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (compatible; SquidMind/2.0)',
        'Accept':     'application/json',
      };
      // If HF_TOKEN is set, authenticate — lets users browse gated repos too
      const hfToken = process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || '';
      if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;
      const req = https.get(url, { headers }, (r) => {
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
  //         minSize (0.5|1|3|7|13|30), maxSize same,
  //         sort (downloads|likes|trending|createdAt|lastModified)
  router.get('/hf-search', async (req, res) => {
    const { q = '', limit = 30, sort = 'downloads', pipeline = '', minSize = '', maxSize = '', quant = '' } = req.query;
    try {
      // Build filter: always gguf + optional pipeline tag
      let filter = 'gguf';
      if (pipeline && pipeline !== 'any') filter += ',' + pipeline;
      // Map client-side names → what the HF API actually accepts.
      // HF /api/models rejects sort=trending with 400; the correct field
      // is trendingScore. Same with "recent" alias → lastModified.
      const HF_SORT_MAP = {
        downloads:    'downloads',
        likes:        'likes',
        trending:     'trendingScore',
        recent:       'lastModified',
        lastModified: 'lastModified',
        createdAt:    'createdAt',
        release:      'createdAt',
      };
      const hfSort = HF_SORT_MAP[sort] || 'downloads';
      // Always descending — user picks a metric, we give the top of it
      const qs = `search=${encodeURIComponent(q)}&filter=${encodeURIComponent(filter)}&sort=${hfSort}&direction=-1&limit=${limit}&full=false`;
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
        // Quant filter — match filename tags in model id or tags
        if (quant) {
          const allText = (id + ' ' + (m.tags||[]).join(' ')).toUpperCase();
          if (!allText.includes(quant.toUpperCase())) return null;
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
      const { url, fileName, force } = req.body;
      if (!url) return res.status(400).json({ success: false, error: 'url required' });

      // Sanity check: refuse (soft) when URL clearly points at a component
      // of a diffusion pipeline rather than a chat LLM. Users often click on
      // the wrong file in a HF repo — this catches the mistake before a 5 GB
      // download of something llama.cpp can't run at all. `force: true`
      // overrides for the rare legit case.
      if (!force) {
        const urlLower = String(url).toLowerCase();
        const NON_CHAT_PATTERNS = [
          /text[-_]encoder/i, /encoder[-_]only/i, /clip[-_]?[lg]?\b/i,
          /\/(t5xxl|t5-encoder)/i, /^.*\/vae[-_]/i, /-vae\.gguf/i,
          /-tokenizer\.gguf/i, /vision[-_]encoder/i,
        ];
        const hit = NON_CHAT_PATTERNS.find(r => r.test(urlLower));
        if (hit) {
          return res.status(400).json({
            success: false,
            error: `This URL looks like a diffusion-pipeline component (${hit.source.replace(/[\\/\\|^$]/g, '')}), not a chat LLM. ` +
                   `llama.cpp cannot run it — you would get "missing blk.X…weight" errors on load. ` +
                   `Companion files (T5/CLIP/VAE) belong next to the Flux/SD model, not in your LLM library. ` +
                   `Retry with { "force": true } if you're sure.`,
            hint: 'non_chat_model_url'
          });
        }
      }

      const state = downloader.startDownload(url, fileName);
      res.json({ success: true, downloadId: state.downloadId, fileName: state.fileName });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /api/v2/models/downloads/clear — remove finished/failed/cancelled
  // entries from the list. Registered BEFORE /downloads/:id so 'clear'
  // isn't captured as an :id.
  router.post('/downloads/clear', (req, res) => {
    res.json({ success: true, cleared: downloader.clearFinished() });
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

  // PATCH /api/v2/models/:modelId/rename — set a human-readable alias
  router.patch('/:modelId/rename', async (req, res) => {
    try {
      const { display_name } = req.body;
      if (!display_name?.trim()) return res.status(400).json({ success: false, error: 'display_name required' });
      const rm = v2ModelService.rm;
      rm.invalidateCache();
      const reg = await rm.read('MODELS/model_registry.json');
      const entry = reg.models?.[req.params.modelId];
      if (!entry) return res.status(404).json({ success: false, error: 'Model not found' });
      entry.display_name = display_name.trim();
      await rm.write('MODELS/model_registry.json', reg);
      res.json({ success: true, model_id: req.params.modelId, display_name: entry.display_name });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
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
      const force = req.body?.force === true || req.query?.force === '1';
      if (force) {
        // Abort any in-flight generation for this model before unloading, so
        // the broker doesn't stay pinned to BUSY. Signal every warmed entry;
        // the actual dispose runs inside unloadModel.
        try {
          const entry = v2ModelService.loaded?.get?.(req.params.modelId);
          if (entry) entry._abortRequested = true;
          // Poseidon's entry gets the same signal in case caller passed the
          // wrong ID
          if (v2ModelService.poseidonModelId) {
            const pos = v2ModelService.loaded?.get?.(v2ModelService.poseidonModelId);
            if (pos) pos._abortRequested = true;
          }
          // Small wait so the generator sees the flag and exits cleanly
          await new Promise(r => setTimeout(r, 250));
          // Force-release any lingering broker tokens for this model
          if (v2ModelService.broker?.forceReleaseAll) {
            v2ModelService.broker.forceReleaseAll(`force-unload:${req.params.modelId}`);
          }
        } catch (e) { log.warn?.('[force-unload] pre-abort error:', e.message); }
      }
      const result = await v2ModelService.unloadModel(req.params.modelId);
      res.json({ ...result, forced: force });
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

  // POST /api/v2/models/upscale-image
  // REAL super-resolution via Real-ESRGAN (GPU, reconstructs detail) when
  // the binary is available, else pure-JS jimp bicubic fallback. Never a
  // diffusion regen. Response `backend` says which was used.
  router.post('/upscale-image', async (req, res) => {
    try {
      const { source_image, scale = 2 } = req.body;
      if (!source_image) return res.status(400).json({ ok: false, error: 'source_image is required' });
      const factor = [2, 3, 4].includes(Number(scale)) ? Number(scale) : 2;

      const path = require('path');
      const fs   = require('fs');
      const AQUARIUM = require('../aquarium');
      let src = source_image;
      if (!path.isAbsolute(src)) src = path.join(AQUARIUM.ROOT, src);
      if (!fs.existsSync(src)) return res.status(404).json({ ok: false, error: `Source image not found: ${src}` });

      const ext = path.extname(src) || '.png';
      const out = src.replace(new RegExp(`\\${ext}$`, 'i'), `_upscaled${factor}x${ext}`);

      const { upscaleService } = require('../services/UpscaleService');
      const result = await upscaleService.upscale(src, factor, out);

      const serveUrl = `/api/files/read?path=${encodeURIComponent(result.outputPath)}`;
      log.info?.(`[upscale-image] ${factor}x via ${result.backend}: ${result.from} → ${result.to} (${path.basename(result.outputPath)})`);
      res.json({
        ok: true, success: true,
        outputPath: result.outputPath, url: serveUrl,
        from: result.from, to: result.to, scale: factor,
        backend: result.backend,
      });
    } catch (err) {
      res.status(500).json({ ok: false, success: false, error: err.message });
    }
  });

  // GET /api/v2/models/recommendations — VRAM-aware starter models.
  // Powers the first-run wizard: fresh installs have zero models and users
  // shouldn't need to know what a GGUF quant is to get going. Detects free
  // VRAM and returns a curated shortlist with direct download URLs the
  // existing /download endpoint accepts.
  router.get('/recommendations', async (req, res) => {
    try {
      const { exec } = require('child_process');
      const vramMb = await new Promise(r =>
        exec('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits',
          { timeout: 4000 }, (e, out) => r(e ? 0 : parseInt(out, 10) || 0)));

      // Curated list: proven chat models with tool-calling ability, one per
      // size band, direct HF GGUF URLs. Sizes are approximate on-disk.
      const CATALOG = [
        {
          min_vram_mb: 10_000, name: 'Qwen2.5 14B Instruct Q4_K_M', size_gb: 9.0,
          why: 'Best quality if you have 12GB+ VRAM',
          url: 'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
        },
        {
          min_vram_mb: 6_500, name: 'Qwen2.5 7B Instruct Q4_K_M', size_gb: 4.7,
          why: 'Great balance for 8GB cards — recommended default',
          url: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
        },
        {
          min_vram_mb: 3_500, name: 'Llama 3.2 3B Instruct Q4_K_M', size_gb: 2.0,
          why: 'Light + fast for 4GB cards or shared VRAM',
          url: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
        },
        {
          min_vram_mb: 0, name: 'Qwen2.5 1.5B Instruct Q4_K_M', size_gb: 1.0,
          why: 'CPU-friendly starter — works everywhere',
          url: 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
        },
      ];

      // Everything that fits, best first; flag the top fit as recommended.
      const fits = CATALOG.filter(m => vramMb >= m.min_vram_mb || m.min_vram_mb === 0);
      const list = fits.map((m, i) => ({ ...m, recommended: i === 0 }));
      res.json({ ok: true, vram_mb: vramMb, gpu: vramMb > 0, recommendations: list });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // GET /api/v2/models/upscale-info — which upscale backend is available
  router.get('/upscale-info', async (req, res) => {
    try {
      const { upscaleService } = require('../services/UpscaleService');
      const hasReal = await upscaleService.hasRealEsrgan();
      res.json({
        ok: true,
        realesrgan: hasReal,
        backend: hasReal ? 'real-esrgan' : 'jimp-bicubic',
        install_hint: hasReal ? null :
          'For true super-resolution, download realesrgan-ncnn-vulkan from ' +
          'https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases, unzip into ' +
          'aquarium/TOOLS/realesrgan/, and chmod +x the binary. Falling back to bicubic for now.',
      });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // POST /api/v2/models/generate-image
  // Uses OrchestratorTools so a task is created in right panel + output in TASKS/<id>/output/
  router.post('/generate-image', async (req, res) => {
    try {
      const { modelId, model_id, prompt, negativePrompt, negative_prompt,
              width, height, steps, cfg, cfg_scale, seed, project_id, filename, upscale,
              source_image, strength } = req.body;
      const resolvedId = modelId || model_id;

      // Validate inputs up-front so the client gets a clear error before the
      // request bounces around three layers.
      let effectiveId = resolvedId;
      if (!effectiveId) {
        // Auto-pick the first image-tagged model — needed for the file-browser
        // "upscale existing image" quick action where the user hasn't selected
        // a specific model.
        try {
          const reg = await v2ModelService.rm.read('MODELS/model_registry.json').catch(() => ({ models: {} }));
          const imgEntry = Object.entries(reg.models || {}).find(([, e]) =>
            (e.config?.model_type || e.model_type) === 'image' ||
            (e.config?.model_category || e.model_category) === 'image'
          );
          if (imgEntry) effectiveId = imgEntry[0];
        } catch { /* fall through to error below */ }
      }
      if (!effectiveId) {
        log.warn('[generate-image] missing model_id; body=', JSON.stringify(req.body).slice(0, 200));
        return res.status(400).json({ success: false, ok: false,
          error: 'model_id is required — open Models, drag a Flux/SD model into the IMAGE column first.' });
      }
      if (!prompt || !String(prompt).trim()) {
        // Empty prompt is legit ONLY when we're upscaling an existing image
        // — no new subject, just detail refinement via low-strength img2img.
        if (!source_image) {
          return res.status(400).json({ success: false, ok: false, error: 'prompt is required' });
        }
      }

      const tools = v2ModelService.orchestrator?.tools;
      if (tools) {
        const result = await tools.generateImage({
          model_id: effectiveId,
          prompt,
          negative_prompt: negativePrompt || negative_prompt || '',
          width:  Number(width)  || 512,
          height: Number(height) || 512,
          steps:  Number(steps)  || 20,
          cfg_scale: Number(cfg || cfg_scale) || 7,
          seed:   seed ?? -1,
          project_id: project_id || null,
          filename: filename || null,
          upscale: Number(upscale) || 0,
          source_image: source_image || null,
          strength: strength != null ? Number(strength) : undefined,
        });
        if (!result.ok) {
          log.warn('[generate-image] failed:', result.error, '— model:', effectiveId);
          return res.status(400).json({ success: false, ok: false, error: result.error });
        }
        return res.json({ success: true, ok: true, ...result });
      }
      // Fallback: orchestrator not ready yet
      const result = await v2ModelService.generateImage(req.body);
      if (!result.ok) {
        log.warn('[generate-image] (fallback) failed:', result.error, '— model:', resolvedId);
        return res.status(400).json({ success: false, ok: false, error: result.error });
      }
      res.json({ success: true, ok: true, ...result });
    } catch (err) {
      log.warn('[generate-image] exception:', err.message, err.stack?.split('\n').slice(0, 3).join(' | '));
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

  // PATCH /api/v2/models/:modelId/category — set model_category (poseidon|agent|image)
  router.patch('/:modelId/category', async (req, res) => {
    try {
      const { model_category } = req.body;
      if (!['poseidon', 'agent', 'image'].includes(model_category)) {
        return res.status(400).json({ success: false, error: 'model_category must be poseidon, agent, or image' });
      }
      const model_type = model_category === 'image' ? 'image' : 'text';
      const modelId = req.params.modelId;

      // Auto-upsert: if model not in registry yet (unimported), create a minimal entry
      // This allows categorizing models without going through the full import flow
      const rm = v2ModelService.rm;
      rm.invalidateCache();
      const reg = await rm.read('MODELS/model_registry.json').catch(() => ({ models: {} }));
      if (!reg.models[modelId]) {
        // Find the file on disk to bootstrap the entry
        const lib = await v2ModelService.getLibrary();
        const found = lib.models?.find(m => m.model_id === modelId);
        if (found) {
          await v2ModelService._registryUpsert(modelId, {
            model_id: modelId,
            file_name: found.file_name,
            file_path: found.file_path,
            file_size_gb: found.file_size_gb,
            status: 'imported',
            config: { model_type, model_category, contextLength: 4096, gpuLayers: 'auto', cpuThreads: 4, batchSize: 512, flashAttention: true, useMmap: true, useMlock: false, autoUnloadIdleMinutes: 10 }
          });
        } else {
          return res.status(404).json({ success: false, error: `Model ${modelId} not found on disk` });
        }
      } else {
        await v2ModelService.updateModelParams(modelId, { model_category, model_type });
      }

      res.json({ success: true, model_id: modelId, model_category });
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
    const { message, history, project } = req.body;
    if (!message) {
      return res.status(400).json({ success: false, error: 'message required' });
    }
    // Project-scoped instruction (temple chatbox): don't just prefix a label
    // the model can ignore — inject the FULL working context (memory + files)
    // and an actionable directive, so the model never has to ask what the
    // project is, what its goal is, or what files exist.
    let effectiveMessage = message;
    if (project && (project.name || project.id)) {
      const pname = project.name || project.id;
      const ctxLines = [`[PROJECT INSTRUCTION — ${pname}${project.id ? ` (${project.id})` : ''}]`];
      try {
        const rm = v2ModelService.rm;
        // Resolve id + folder
        let pid = project.id, folder = null;
        const resolved = await rm.resolveProjectByNameOrId(project.id || project.name).catch(() => null);
        if (resolved) { pid = resolved.id || pid; folder = resolved.entry?.folder || null; }
        // 1. Project memory (vision, progress, blockers, next steps)
        if (pid && rm.getProjectMemory) {
          const mem = await rm.getProjectMemory(pid).catch(() => null);
          if (mem) {
            ctxLines.push('[PROJECT MEMORY]');
            if (mem.vision) ctxLines.push(`Vision: ${String(mem.vision).slice(0, 300)}`);
            if (mem.progress?.completion) ctxLines.push(`Progress: ${mem.progress.completion}`);
            if (mem.progress?.blockers?.length) ctxLines.push(`Blockers: ${mem.progress.blockers.slice(0, 3).map(b => b.text || b).join('; ').slice(0, 300)}`);
            if (mem.progress?.next_steps?.length) ctxLines.push(`Next steps: ${mem.progress.next_steps.slice(0, 5).join('; ').slice(0, 400)}`);
            if (mem.progress?.recent_achievements?.length) ctxLines.push(`Recently done: ${mem.progress.recent_achievements.slice(0, 3).map(a => a.text || a).join('; ').slice(0, 300)}`);
          }
        }
        // 2. Input + output file listings (names only, capped)
        if (folder) {
          const fsp = require('fs').promises;
          const path = require('path');
          const AQUARIUM = require('../aquarium');
          const listDir = async (sub) => {
            try {
              const files = await fsp.readdir(path.join(AQUARIUM.PROJECTS, folder, sub));
              return files.filter(f => !f.startsWith('.')).slice(0, 40);
            } catch { return []; }
          };
          const [inputs, outputs] = await Promise.all([listDir('input'), listDir('output')]);
          ctxLines.push(`Input files (${inputs.length}): ${inputs.join(', ') || '(none)'}`);
          ctxLines.push(`Output files (${outputs.length}): ${outputs.join(', ') || '(none)'}`);
          ctxLines.push(`(Read any of them with read_file("PROJECTS/${folder}/input/<name>" or ".../output/<name>").)`);
        }
      } catch { /* context enrichment is best-effort — instruction still goes through */ }
      ctxLines.push('');
      ctxLines.push(`Instruction: ${message}`);
      ctxLines.push(
        `(Directive: this instruction applies to project "${pname}". Everything you need is above — ` +
        `do NOT ask who you are, what the project is, or what its purpose is. When creating tasks, set project: "${pname}". ` +
        `Use THIS project's memory and files.)`);
      effectiveMessage = ctxLines.join('\n');
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Tell client we started
    res.write(`event: start\ndata: ${JSON.stringify({ model_id: v2ModelService.poseidonModelId })}\n\n`);

    let chunkCount = 0;
    let toolCallCount = 0;
    const bus = global.ReasoningBus;
    // Hold off BG tasks / auto-review while this chat turn runs, so the
    // heartbeat doesn't swap Poseidon into a background task between the
    // user's messages. Refreshed at the end for a post-reply grace window.
    try { v2ModelService.taskRunner?.setChatActive?.(true); } catch {}
    if (bus) bus.push({ type: 'task_start', task_id: 'poseidon_chat', title: message.slice(0, 80), agent: 'poseidon' });
    try {
      for await (const ev of v2ModelService.chatWithPoseidon(effectiveMessage, history || [])) {
        if (ev.type === 'text') {
          chunkCount++;
          res.write(`data: ${JSON.stringify({ text: ev.chunk })}\n\n`);
          bus?.push({ type: 'text', task_id: 'poseidon_chat', chunk: ev.chunk });
        } else if (ev.type === 'tool_call') {
          toolCallCount++;
          res.write(`event: tool_call\ndata: ${JSON.stringify({ name: ev.name, args: ev.args })}\n\n`);
          bus?.push({ type: 'tool_call', task_id: 'poseidon_chat', name: ev.name, args: ev.args });
        } else if (ev.type === 'tool_result') {
          const summary = ev.result?.message
            || (ev.result?.ok ? (Object.keys(ev.result).length > 2 ? 'success' : ev.result.ok) : (ev.result?.error || 'failed'));
          const summaryStr = typeof summary === 'string' ? summary.slice(0, 300) : String(summary).slice(0, 300);
          res.write(`event: tool_result\ndata: ${JSON.stringify({
            name: ev.name, ok: ev.result?.ok !== false,
            summary: summaryStr, duration_ms: ev.duration_ms
          })}\n\n`);
          bus?.push({ type: 'tool_result', task_id: 'poseidon_chat', name: ev.name, ok: ev.result?.ok !== false, summary: summaryStr });
        } else if (ev.type === 'thinking_start') {
          res.write(`event: thinking_start\ndata: {}\n\n`);
          bus?.push({ type: 'thinking_start', task_id: 'poseidon_chat' });
        } else if (ev.type === 'thinking') {
          res.write(`event: thinking\ndata: ${JSON.stringify({ text: ev.chunk })}\n\n`);
          bus?.push({ type: 'thinking', task_id: 'poseidon_chat', chunk: ev.chunk });
        } else if (ev.type === 'thinking_end') {
          res.write(`event: thinking_end\ndata: {}\n\n`);
          bus?.push({ type: 'thinking_end', task_id: 'poseidon_chat' });
        }
      }
      if (bus) bus.push({ type: 'task_end', task_id: 'poseidon_chat' });
      res.write(`event: end\ndata: ${JSON.stringify({
        chunks: chunkCount, tool_calls: toolCallCount,
        turn: v2ModelService.loaded.get(v2ModelService.poseidonModelId)?.sessionTurns ?? 0,
      })}\n\n`);
    } catch (err) {
      log.error('[Chat SSE] chatWithPoseidon error:', err.message, err.stack?.split('\n').slice(1,3).join(' '));
      if (bus) bus.push({ type: 'task_end', task_id: 'poseidon_chat' });
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    } finally {
      // Post-reply grace: keep BG paused a bit longer so the user can read
      // and start typing their next message before the heartbeat resumes
      // background work.
      try { v2ModelService.taskRunner?.setChatActive?.(false); } catch {}
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
