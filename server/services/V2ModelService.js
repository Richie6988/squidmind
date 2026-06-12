/**
 * V2ModelService - GGUF model loading and chat using node-llama-cpp v3
 * 
 * Features:
 *  - Load models with all user-controlled settings (context, GPU layers, threads, etc.)
 *  - Track state in model_registry.json
 *  - TTL auto-unload after idle
 *  - Streaming chat
 *  - Poseidon system prompt from poseidon_brain.json
 */

const path = require('path');
const ImageGenerationService = require('./ImageGenerationService');
const fs = require('fs').promises;
const fsSync = require('fs');

class V2ModelService {
  // Minimum context tokens needed for the Poseidon system prompt + tools + 1 turn.
  // Derived from poseidon_brain.json size (~2800 tokens) + safety margin.
  // Any model with trainCtx < this is an encoder / non-chat model.
  static MIN_VIABLE_CTX = 4096;

  constructor(registryManager, modelsDir) {
    this.rm = registryManager;
    this.modelsDir = modelsDir;
    this.llama = null;                       // node-llama-cpp instance (singleton)
    this.imageGen = new ImageGenerationService();
    this.loaded = new Map();                 // model_id -> { model, context, session, config, lastUsedAt, generating }
    this.poseidonModelId = null;             // currently assigned to Poseidon
    this._libPromise = null;
    this.orchestrator = null;                // wired in by index.js after construction
    this.dreamModelId  = null;                // optional small model for async metacognition
  }
  
  /**
   * Set the orchestrator (called once at startup). Provides Poseidon's
   * system prompt + function-calling tools.
   */
  setOrchestrator(orchestrator) {
    this.orchestrator = orchestrator;
    // Restore last-used Poseidon model from brain (fire-and-forget)
    this._restorePoseidonModel().catch(err =>
      console.warn('[V2ModelService] Could not restore Poseidon model:', err.message)
    );
  }

  /**
   * On startup, read poseidon_brain.json and auto-assign the last-used model
   * if it exists in the model registry. Does NOT load it into memory yet —
   * that happens lazily on first chat (or eagerly via setPoseidonModel).
   */
  async _restorePoseidonModel() {
    try {
      const brain = await this.rm.getPoseidonBrain();
      const savedId = brain?.current_state?.loaded_model_id;
      if (!savedId) return;

      const reg = await this.rm.read('models/model_registry.json').catch(() => ({ models: {} }));
      if (!reg.models?.[savedId]) {
        console.log(`[V2ModelService] Saved Poseidon model ${savedId} not in registry — skipping restore`);
        return;
      }
      this.poseidonModelId = savedId;
      console.log(`[V2ModelService] ✓ Restored Poseidon model from brain: ${savedId}`);
    } catch (err) {
      // non-fatal
    }
  }

  /**
   * _emergencyReset — only called when the LLM session crashes hard (OOM, context overflow error).
   * Saves a minimal recovery note to session_state.json and resets the session.
   * Poseidon's session is NOT wiped proactively — it persists across chat turns indefinitely.
   */
  async _emergencyReset(entry) {
    const lastUser = (entry._lastUserMessage || '').slice(0, 300);
    const note = `(emergency reset — session crashed)
Last user request: ${lastUser}
Resume: call read_my_brain('tasks') and read_my_brain('projects') to re-orient.`;
    await this.rm.write('BRAIN/session_state.json', {
      saved_at: new Date().toISOString(),
      turn: entry.sessionTurns,
      context_pct: entry.contextPct || 0,
      last_user_message: lastUser,
      last_response_preview: note,
      tool_calls_this_turn: [],
      emergency: true
    }).catch(() => {});

    try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
    try { if (entry._currentSequence?.dispose) entry._currentSequence.dispose(); } catch {}
    entry.session           = null;
    entry._currentSequence  = null;
    entry.sessionTurns      = 0;
    entry._thinkBuf         = '';
    entry.contextPct        = 0;
    entry.contextUsedTokens = 0;
    console.log('[V2ModelService] Emergency reset — session cleared after crash');

    await this.rm.log({
      event_type: 'poseidon_decision', severity: 'warning',
      actor: { type: 'system', id: 'v2_model_service' },
      subject: { type: 'model', id: this.poseidonModelId },
      action: `Emergency session reset at turn ${entry.sessionTurns}`
    }).catch(() => {});
  }


  /**
   * Abort the current Poseidon generation mid-stream.
   */
  abortGeneration() {
    const entry = this.poseidonModelId ? this.loaded.get(this.poseidonModelId) : null;
    if (!entry || !entry.generating) return { ok: false, message: 'Nothing generating' };
    entry._abortRequested = true;
    return { ok: true, message: 'Abort requested' };
  }

  // === LIB INITIALIZATION ===

  async _ensureLib() {
    if (this.llama) return this.llama;
    if (!this._libPromise) {
      this._libPromise = (async () => {
        const llamaCpp = await import('node-llama-cpp');
        this.llama = await llamaCpp.getLlama();
        console.log('[V2ModelService] node-llama-cpp v3 initialized');
        return this.llama;
      })();
    }
    return this._libPromise;
  }

  // === MODEL ID HELPERS ===

  _fileNameToId(fileName) {
    // kwen3.5-9B.gguf  ->  kwen3-5-9b
    return fileName.replace(/\.gguf$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }

  /**
   * Default loading config (user spec).
   */
  static DEFAULT_CONFIG = {
    // 'auto' = let llama-cpp pick the maximum context that fits VRAM.
    // 'auto' for gpuLayers = pick the optimal CPU/GPU split.
    // This mirrors LM Studio's defaults and is the right choice 99% of the time.
    contextLength: 'auto',
    gpuLayers: 'auto',
    cpuThreads: 4,
    batchSize: 512,
    flashAttention: true,     // ~50% smaller KV cache (biggest VRAM saver)
    useMmap: true,            // OS-level page sharing for the model file
    useMlock: false,          // disabled by default (can be enabled in Edit Params)
    randomSeed: true,
    autoUnloadIdleMinutes: 15
  };

  async scanLocalModels() {
    const result = [];
    try {
      const files = await fs.readdir(this.modelsDir);
      for (const file of files) {
        if (!file.toLowerCase().endsWith('.gguf')) continue;
        const fullPath = path.join(this.modelsDir, file);
        const stat = await fs.stat(fullPath);
        
        // Quick validity check (without parsing whole file)
        let isValid = false;
        if (stat.size >= 4) {
          try {
            const fd = await fs.open(fullPath, 'r');
            const buf = Buffer.alloc(4);
            await fd.read(buf, 0, 4, 0);
            await fd.close();
            isValid = buf.toString('utf8') === 'GGUF';
          } catch {}
        }
        
        result.push({
          model_id: this._fileNameToId(file),
          file_name: file,
          file_path: fullPath,
          file_size_gb: Math.round((stat.size / (1024 ** 3)) * 100) / 100,
          format: 'gguf',
          is_valid_gguf: isValid,
          size_bytes: stat.size
        });
      }
    } catch (err) {
      console.warn('[V2ModelService] scanLocalModels:', err.message);
    }
    return result;
  }

  /**
   * Scan local files AND merge with registry to show import status.
   */
  async getLibrary() {
    const scanned = await this.scanLocalModels();
    this.rm.invalidateCache();
    const reg = await this.rm.read('models/model_registry.json');
    const registered = reg.models || {};
    
    const items = [];
    
    // Files present on disk
    const seenIds = new Set();
    for (const file of scanned) {
      seenIds.add(file.model_id);
      const regEntry = registered[file.model_id];
      const loadedEntry = this.loaded.get(file.model_id);
      items.push({
        model_id: file.model_id,
        file_name: file.file_name,
        file_path: file.file_path,
        file_size_gb: file.file_size_gb,
        format: 'gguf',
        imported: !!regEntry,
        config: regEntry?.config || null,             // SAVED config (user preference, may have 'auto')
        runtime_config: loadedEntry?.config || null,  // RESOLVED config (all numeric, what's actually running)
        status: regEntry?.status || 'not_imported',
        is_loaded: this.loaded.has(file.model_id),
        is_poseidon: this.poseidonModelId === file.model_id,
        runtime: regEntry?.runtime || null,
        is_valid_gguf: file.is_valid_gguf,
        size_bytes: file.size_bytes
      });
    }
    
    // Registered models whose files are missing (orphans)
    for (const [id, entry] of Object.entries(registered)) {
      if (!seenIds.has(id)) {
        const loadedEntry = this.loaded.get(id);
        items.push({
          model_id: id,
          file_name: entry.file_name,
          file_path: entry.file_path,
          file_size_gb: entry.file_size_gb,
          format: 'gguf',
          imported: true,
          config: entry.config,
          runtime_config: loadedEntry?.config || null,
          status: 'missing',
          is_loaded: this.loaded.has(id),
          is_poseidon: this.poseidonModelId === id,
          runtime: entry.runtime
        });
      }
    }
    
    return {
      models: items,
      poseidon_model_id: this.poseidonModelId,
      currently_loaded: Array.from(this.loaded.keys())
    };
  }

  /**
   * Import a .gguf file into the model library (register with config).
   * Does NOT load the model into memory - that happens on demand.
   */
  async importModel(fileName, config = {}) {
    const fullPath = path.isAbsolute(fileName) ? fileName : path.join(this.modelsDir, fileName);
    if (!fsSync.existsSync(fullPath)) {
      throw new Error(`File not found: ${fullPath}`);
    }
    const stat = await fs.stat(fullPath);
    
    // Validate GGUF magic bytes - reject placeholder/corrupt files at import time
    // (much better than failing at chat time after assigning to Poseidon)
    if (stat.size < 4) {
      throw new Error(`File is only ${stat.size} bytes - not a real .gguf model. Looks like a placeholder. Use Browse Files or Download HF to get a real one.`);
    }
    const fd = await fs.open(fullPath, 'r');
    const buf = Buffer.alloc(4);
    await fd.read(buf, 0, 4, 0);
    await fd.close();
    const magic = buf.toString('utf8');
    if (magic !== 'GGUF') {
      throw new Error(`Not a valid GGUF file: magic bytes are "${magic.replace(/[^\x20-\x7e]/g, '?')}" instead of "GGUF". The file is likely corrupted or a placeholder.`);
    }
    
    const modelId = this._fileNameToId(path.basename(fileName));
    const finalConfig = { ...V2ModelService.DEFAULT_CONFIG, ...config };
    
    // Auto-detect model type from filename if not specified in config
    const model_type = config.model_type || ImageGenerationService.detectModelType(path.basename(fileName));

    await this._registryUpsert(modelId, {
      file_name: path.basename(fileName),
      file_path: fullPath,
      file_size_gb: Math.round((stat.size / (1024 ** 3)) * 100) / 100,
      format: 'gguf',
      model_type,            // 'text' | 'image'
      status: 'available',
      config: finalConfig,
      runtime: {
        loaded_at: null,
        last_used_at: null,
        total_tokens_generated: 0,
        total_requests: 0
      }
    });
    
    await this.rm.log({
      event_type: 'model_loaded',
      severity: 'info',
      actor: { type: 'human', id: 'human_user' },
      subject: { type: 'model', id: modelId },
      action: `Imported ${fileName} to library`,
      context: { config: finalConfig }
    });
    
    return { success: true, model_id: modelId, config: finalConfig };
  }

  /**
   * Update load params for a registered model.
   * If the model is currently loaded, the new params apply on next load.
   */
  async updateModelParams(modelId, params) {
    this.rm.invalidateCache();
    const reg = await this.rm.read('models/model_registry.json');
    const entry = reg.models[modelId];
    if (!entry) throw new Error(`Model ${modelId} not in library`);
    
    const newConfig = { ...entry.config, ...params };
    entry.config = newConfig;
    await this.rm.write('models/model_registry.json', reg);
    
    await this.rm.log({
      event_type: 'json_update',
      actor: { type: 'human', id: 'human_user' },
      subject: { type: 'model', id: modelId },
      action: `Updated load params for ${modelId}`,
      context: { config: newConfig, will_apply_on_next_load: this.loaded.has(modelId) }
    });
    
    return { success: true, model_id: modelId, config: newConfig, currently_loaded: this.loaded.has(modelId) };
  }

  /**
   * Remove a model from the library. Unloads if loaded.
   */
  async removeFromLibrary(modelId) {
    if (this.loaded.has(modelId)) {
      await this.unloadModel(modelId);
    }
    this.rm.invalidateCache();
    const reg = await this.rm.read('models/model_registry.json');
    delete reg.models[modelId];
    await this.rm.write('models/model_registry.json', reg);
    
    if (this.poseidonModelId === modelId) this.poseidonModelId = null;
    
    await this.rm.log({
      event_type: 'model_unloaded',
      actor: { type: 'human', id: 'human_user' },
      subject: { type: 'model', id: modelId },
      action: `Removed ${modelId} from library`
    });
    return { success: true };
  }

  /**
   * Ensure a model is loaded into memory. Loads with stored config if not.
   * No-op if already loaded.
   */
  async ensureLoaded(modelId) {
    if (this.loaded.has(modelId)) return { already_loaded: true, model_id: modelId };

    // Dedup: if a load is already in progress for this modelId (e.g. pre-load fired
    // by setPoseidonModel raced with auto-load from chatWithPoseidon), wait for the
    // existing promise instead of starting a second concurrent load.
    if (!this._loadingPromises) this._loadingPromises = new Map();
    if (this._loadingPromises.has(modelId)) {
      console.log(`[V2ModelService] Joining existing load for ${modelId} (dedup)`);
      return this._loadingPromises.get(modelId);
    }

    this.rm.invalidateCache();
    const reg = await this.rm.read('models/model_registry.json');
    const entry = reg.models[modelId];
    if (!entry) throw new Error(`Model ${modelId} not in library. Import it first.`);
    if (entry.status === 'missing') throw new Error(`Model file is missing: ${entry.file_path}`);

    const promise = this.loadModel(entry.file_name, entry.config || {});
    this._loadingPromises.set(modelId, promise);
    try {
      return await promise;
    } finally {
      this._loadingPromises.delete(modelId);
    }
  }

  // === LOAD ===

  /**
   * Load a GGUF model into memory.
   * 
   * Parameters mirror the standard GGUF loader contract (see ComfyUI's
   * LLM-GGUF Loader). Caller passes concrete numbers; we never pass 'auto'
   * through to node-llama-cpp because it picks pathological values on
   * tight-VRAM systems (e.g. 256 tokens with a 9B model and 6GB free).
   * 
   * @param {string} fileName - file in the models dir, e.g. 'qwen3.5-9B.gguf'
   * @param {object} cfg
   *   @param {number|'auto'} cfg.contextLength - max ctx tokens. 'auto' = compute from VRAM
   *   @param {number|'auto'|'max'} cfg.gpuLayers - GPU layer count. 'auto' = compute from VRAM
   *   @param {number} cfg.cpuThreads
   *   @param {number} cfg.batchSize
   *   @param {boolean} cfg.flashAttention - ~50% smaller KV
   *   @param {boolean} cfg.useMmap
   *   @param {boolean} cfg.useMlock - pin in VRAM (LM Studio "Keep in Memory")
   *   @param {boolean} cfg.randomSeed
   *   @param {number} cfg.autoUnloadIdleMinutes
   * @returns {object} { success, model_id, config } - config holds the RESOLVED numbers
   */
  async loadModel(fileName, cfg = {}) {
    const config = {
      contextLength: cfg.contextLength ?? 'auto',
      gpuLayers:     cfg.gpuLayers     ?? 'auto',
      cpuThreads:    cfg.cpuThreads    ?? 4,
      batchSize:     cfg.batchSize     ?? 512,
      flashAttention:cfg.flashAttention ?? true,
      useMmap:       cfg.useMmap       ?? true,
      useMlock:      cfg.useMlock      ?? false,
      randomSeed:    cfg.randomSeed    ?? true,
      autoUnloadIdleMinutes: cfg.autoUnloadIdleMinutes ?? 15
    };

    const modelId   = this._fileNameToId(fileName);
    if (this.loaded.has(modelId)) return { success: true, alreadyLoaded: true, model_id: modelId };

    const fullPath = path.isAbsolute(fileName) ? fileName : path.join(this.modelsDir, fileName);
    if (!fsSync.existsSync(fullPath)) throw new Error(`Model file not found: ${fullPath}`);
    const stat      = await fs.stat(fullPath);
    const fileSizeGb = Math.round((stat.size / (1024 ** 3)) * 100) / 100;

    await this._registryUpsert(modelId, {
      file_name: fileName, file_path: fullPath, file_size_gb: fileSizeGb,
      format: 'gguf', status: 'loading', config,
      runtime: { loading_started_at: new Date().toISOString(), loaded_at: null,
                 last_used_at: null, total_tokens_generated: 0, total_requests: 0 }
    });

    let model = null, context = null;
    try {
      const llama = await this._ensureLib();
      console.log(`[V2ModelService] Loading ${fileName} (${fileSizeGb} GB)`);

      // ── Step 1: VRAM snapshot before weights ──────────────────────────────
      let vramBefore = null;
      try { if (llama.getVramState) vramBefore = await llama.getVramState(); } catch {}
      const freeBeforeGb = vramBefore ? vramBefore.free  / (1024 ** 3) : 0;
      const totalGb      = vramBefore ? vramBefore.total / (1024 ** 3) : 0;
      if (vramBefore) console.log(`  VRAM before load: ${freeBeforeGb.toFixed(2)} / ${totalGb.toFixed(2)} GB free`);
      try { if (llama.gpu) console.log(`  GPU backend: ${llama.gpu}`); } catch {}

      // Estimate total layers for gpu_layers auto-resolve.
      // ~160 MB/layer at Q4_K_M. Clamp to [20, 80].
      const estLayers = Math.max(20, Math.min(80, Math.round(fileSizeGb * 1024 / 160)));

      if (config.gpuLayers === 'auto' || config.gpuLayers === 'max') {
        if (vramBefore && freeBeforeGb > 0.5) {
          const frac    = Math.min(1.0, (freeBeforeGb * 0.72) / fileSizeGb);
          const computed = Math.round(estLayers * frac);
          config.gpuLayers = config.gpuLayers === 'max' ? estLayers : Math.max(1, computed);
          console.log(`  [auto] gpuLayers: ${config.gpuLayers} / ${estLayers}`);
        } else {
          config.gpuLayers = 0;
          console.log(`  [auto] gpuLayers: 0 (no VRAM info, CPU only)`);
        }
      }

      // ── Step 2: LOAD WEIGHTS ONCE ────────────────────────────────────────
      model = await llama.loadModel({
        modelPath:  fullPath,
        gpuLayers:  config.gpuLayers,
        useMmap:    config.useMmap,
        useMlock:   config.useMlock,
        defaultContextFlashAttention: config.flashAttention
      });

      const trainCtx = model.trainContextSize;
      console.log(`  Weights loaded. trainCtx=${trainCtx}, gpuLayers=${config.gpuLayers}`);

      if (trainCtx < V2ModelService.MIN_VIABLE_CTX) {
        await model.dispose(); model = null;
        throw new Error(
          `trainCtx=${trainCtx} < ${V2ModelService.MIN_VIABLE_CTX} — encoder model (T5/CLIP/VAE), not a chat LLM. ` +
          `Tag it as model_type: "image".`
        );
      }

      // ── Step 3: VRAM snapshot AFTER weights — real remaining budget ───────
      let vramAfter = null;
      try { if (llama.getVramState) vramAfter = await llama.getVramState(); } catch {}
      const freeAfterGb = vramAfter ? vramAfter.free / (1024 ** 3) : 0;
      if (vramAfter) console.log(`  VRAM after weights: ${freeAfterGb.toFixed(2)} GB free`);

      // ── Step 4: Compute target contextLength from REAL remaining VRAM ─────
      if (config.contextLength === 'auto') {
        if (vramAfter && freeAfterGb > 0.3) {
          const margin       = 0.25;  // 250 MB headroom for activations (flashAttention reduces pressure)
          const availKvGb    = Math.max(0, freeAfterGb - margin);
          const bytesPerTok  = config.flashAttention ? 50 * 1024 : 100 * 1024;  // FA halves KV memory
          const toksFit      = Math.floor(availKvGb * 1024 ** 3 / bytesPerTok);
          const capped       = Math.min(toksFit, trainCtx, 32768);
          config.contextLength = Math.max(V2ModelService.MIN_VIABLE_CTX, Math.floor(capped / 1024) * 1024);
          console.log(`  [auto] contextLength: ${config.contextLength} (${availKvGb.toFixed(2)} GB for KV)`);
        } else {
          config.contextLength = V2ModelService.MIN_VIABLE_CTX;
          console.log(`  [auto] contextLength: ${config.contextLength} (fallback, no VRAM info)`);
        }
      }

      // Never exceed model's own trainCtx
      if (config.contextLength > trainCtx) {
        config.contextLength = trainCtx;
        console.log(`  clamped contextLength to trainCtx=${trainCtx}`);
      }

      // ── Step 5: CREATE CONTEXT — retry DOWN without reloading the model ───
      // Retry ladder: start at desired ctx, step down if createContext OOMs.
      // We NEVER reload the model — just try smaller contexts.
      const ctxLadder = (() => {
        const target = config.contextLength;
        const steps  = [target, Math.floor(target / 2), Math.floor(target / 4), V2ModelService.MIN_VIABLE_CTX, 2048];
        return [...new Set(steps.map(v => Math.max(2048, Math.min(v, trainCtx))))];
      })();

      let ctxErr = null;
      for (let i = 0; i < ctxLadder.length; i++) {
        const tryCtx = ctxLadder[i];
        if (context) { try { await context.dispose(); } catch {} context = null; }
        try {
          if (i > 0) console.log(`  [ctx retry ${i}] trying ctx=${tryCtx}`);
          context = await model.createContext({
            contextSize:    tryCtx,
            batchSize:      config.batchSize,
            threads:        config.cpuThreads,
            sequences:      1,   // single-user chat — 4 was wasting 4× KV cache VRAM
            flashAttention: config.flashAttention
          });
          config.contextLength = context.contextSize;
          console.log(`  Context created: ${config.contextLength} tokens${i > 0 ? ` (after ${i} retry/ies)` : ''}`);
          ctxErr = null;
          break;
        } catch (e) {
          ctxErr = e;
          const isOOM = /out of memory|VRAM|allocation|context size.*too large|insufficient/i.test(e.message);
          if (!isOOM) throw e;  // non-OOM error → propagate immediately
          console.warn(`  [ctx retry ${i}] OOM at ctx=${tryCtx}: ${e.message.slice(0, 80)}`);
        }
      }
      if (!context) {
        await model.dispose(); model = null;
        throw ctxErr || new Error('All context sizes failed (OOM)');
      }

      // Warn if context ended up too small for the system prompt
      if (config.contextLength < V2ModelService.MIN_VIABLE_CTX) {
        console.warn(
          `[V2ModelService] ⚠ Context ${config.contextLength} < ${V2ModelService.MIN_VIABLE_CTX} minimum. ` +
          `Chat may fail. Try: smaller model, fewer GPU layers, or CPU-only mode.`
        );
      }

      // ── Step 6: Register as loaded ────────────────────────────────────────
      this.loaded.set(modelId, {
        model_id: modelId, file_name: fileName, file_path: fullPath,
        model, context, session: null, config,
        loadedAt: Date.now(), lastUsedAt: Date.now(),
        generating: false, totalTokensGenerated: 0, totalRequests: 0
      });

      await this._registryUpsert(modelId, {
        status: 'loaded',
        runtime: {
          loading_started_at: null, loaded_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          total_tokens_generated: 0, total_requests: 0
        }
      });
      await this.rm.log({
        event_type: 'model_loaded', actor: { type: 'system', id: 'v2_model_service' },
        subject: { type: 'model', id: modelId },
        action: `Loaded ${fileName} (ctx=${config.contextLength}, gpu_layers=${config.gpuLayers})`,
        context: { config }
      });
      console.log(`[V2ModelService] ✓ ${fileName} ready (ctx=${config.contextLength})`);
      return { success: true, model_id: modelId, config };

    } catch (err) {
      try { if (context) await context.dispose(); } catch {}
      try { if (model)   await model.dispose();   } catch {}
      context = null; model = null;
      if (typeof global.gc === 'function') { try { global.gc(); } catch {} }
      await new Promise(r => setTimeout(r, 1500));
      await this._registryUpsert(modelId, {
        status: 'available',
        runtime: { loading_started_at: null, loaded_at: null, last_used_at: null,
                   total_tokens_generated: 0, total_requests: 0 }
      });
      await this.rm.log({
        event_type: 'model_loaded', severity: 'error',
        actor: { type: 'system', id: 'v2_model_service' },
        subject: { type: 'model', id: modelId },
        action: `FAILED to load ${fileName}: ${err.message}`
      });
      // Surface actionable message for unknown architecture (e.g. gemma4, phi4, etc.)
      const archM = err.message.match(/unknown model architecture[:\s'"]+([\w0-9]+)/i);
      if (archM) {
        throw new Error(
          `Architecture "${archM[1]}" not supported by current llama.cpp build.\n` +
          `Run: cd <squidmind-dir> && npm update node-llama-cpp && npm start`
        );
      }
      throw new Error(`Load failed: ${err.message}`);
    }
  }

  async unloadModel(modelId) {
    const entry = this.loaded.get(modelId);
    if (!entry) return { success: false, error: 'Not loaded' };

    if (entry.generating) {
      throw new Error('Cannot unload while generating. Try again in a moment.');
    }

    try { if (entry.session) await entry.session.dispose?.(); } catch {}
    try { if (entry.context) await entry.context.dispose(); } catch {}
    try { if (entry.model) await entry.model.dispose(); } catch {}

    this.loaded.delete(modelId);
    if (this.poseidonModelId === modelId) this.poseidonModelId = null;

    await this._registryUpsert(modelId, {
      status: 'available',
      runtime: {
        loaded_at: null,
        last_used_at: new Date().toISOString(),
        total_tokens_generated: entry.totalTokensGenerated,
        total_requests: entry.totalRequests
      }
    });

    await this.rm.log({
      event_type: 'model_unloaded',
      actor: { type: 'system', id: 'v2_model_service' },
      subject: { type: 'model', id: modelId },
      action: `Unloaded model ${modelId}`
    });

    console.log(`[V2ModelService] Unloaded ${modelId}`);
    return { success: true, model_id: modelId };
  }

  // === POSEIDON ASSIGNMENT ===

  async setPoseidonModel(modelId) {
    this.rm.invalidateCache();
    const reg = await this.rm.read('models/model_registry.json');
    const entry = reg.models[modelId];
    if (!entry) {
      throw new Error(`Model ${modelId} is not in library. Import it first.`);
    }

    // Block non-text models (T5, CLIP, VAE, diffusion encoders, etc.)
    const mtype = entry.config?.model_type || entry.model_type || 'text';
    if (mtype === 'image') {
      throw new Error(
        `Cannot assign "${entry.file_name}" to Poseidon: it is tagged as an IMAGE model (encoder/diffusion). ` +
        `Only text-generation LLMs work as Poseidon. Change the model type in the library if this is wrong.`
      );
    }

    // Block models whose train context is too small to fit the system prompt.
    // We detect this by loading metadata only (no full model load).
    // Heuristic: file_size_gb < 0.8 GB with no known large-vocab text LLMs
    // under that size → likely an encoder.
    if (entry.file_size_gb && entry.file_size_gb < 0.8) {
      throw new Error(
        `Cannot assign "${entry.file_name}" to Poseidon: too small (${entry.file_size_gb} GB). ` +
        `Text LLMs need at least ~1 GB. This looks like an encoder component (T5, CLIP, etc.).`
      );
    }

    this.poseidonModelId = modelId;

    const brain = await this.rm.getPoseidonBrain();
    brain.current_state.loaded_model_id = modelId;
    await this.rm.write('main/poseidon_brain.json', brain);

    await this.rm.log({
      event_type: 'poseidon_decision',
      actor: { type: 'human', id: 'human_user' },
      subject: { type: 'model', id: modelId },
      action: `Assigned ${modelId} as Poseidon's model`
    });
    
    // Fire-and-forget preload so the model is ready when the user opens chat.
    // We don't await - the API returns immediately. Failures are logged but
    // not surfaced to the assign call (user will see them when they actually chat).
    if (!this.loaded.has(modelId)) {
      const entry = reg.models[modelId];
      console.log(`[V2ModelService] Pre-loading ${modelId} after assignment to Poseidon...`);
      // Important: don't return this promise - let it run in background
      this.ensureLoaded(modelId).then(() => {
        console.log(`[V2ModelService] ✓ Pre-load complete for ${modelId}, ready for chat`);
      }).catch(err => {
        console.warn(`[V2ModelService] Pre-load failed for ${modelId}:`, err.message);
      });
    }

    return { success: true, model_id: modelId, loaded: this.loaded.has(modelId), preloading: !this.loaded.has(modelId) };
  }

  getStatus() {
    return {
      loaded_count: this.loaded.size,
      loaded_models: Array.from(this.loaded.values()).map(e => ({
        model_id: e.model_id,
        file_name: e.file_name,
        config: e.config,
        loaded_at: new Date(e.loadedAt).toISOString(),
        last_used_at: new Date(e.lastUsedAt).toISOString(),
        idle_minutes: Math.round((Date.now() - e.lastUsedAt) / 60000 * 10) / 10,
        total_tokens_generated: e.totalTokensGenerated,
        total_requests: e.totalRequests,
        generating: e.generating,
        session_turns: e.sessionTurns || 0,
        context_used_tokens:  e.contextUsedTokens  || 0,
        context_total_tokens: e.contextTotalTokens || e.config?.contextLength || 0,
        context_pct: e.contextPct ?? 0,
        dreaming: e.dreaming || false
      })),
      poseidon_model_id: this.poseidonModelId,
      dream_model_id: this.dreamModelId || null
    };
  }

  // === CHAT ===

  /**
   * Build Poseidon's system prompt from brain.json.
   */
  async buildPoseidonSystemPrompt() {
    this.rm.invalidateCache();
    const brain = await this.rm.getPoseidonBrain();

    const lines = [
      `You are ${brain.identity.name}, ${brain.identity.role}.`,
      ``,
      `# Identity`,
      `- System ID: ${brain.identity.system_id}`,
      `- Born: ${brain.identity.born_at}`,
      `- Awakenings: ${brain.identity.total_awakening_count}`,
      ``,
      `# Soul (your unchanging core)`,
      `Core truths:`,
      ...(brain.soul?.core_truths || []).map(t => `- ${t}`),
      ``,
      `Boundaries:`,
      ...(brain.soul?.boundaries || []).map(b => `- ${b}`),
      ``,
      `Vibe: ${brain.soul?.vibe || ''}`,
      `Continuity: ${brain.soul?.continuity || ''}`,
      ``,
      `# Your User`,
      `Preferences: ${JSON.stringify(brain.user?.preferences || {}, null, 2)}`,
      `Context: ${JSON.stringify(brain.user?.context || {}, null, 2)}`,
      ``,
      `# Current System State`,
      `- Active agents: ${brain.current_state?.active_agents_count ?? 0}`,
      `- Sleeping agents: ${brain.current_state?.sleeping_agents_count ?? 0}`,
      `- Tasks in progress: ${brain.current_state?.tasks_in_progress ?? 0}`,
      `- Tasks queued: ${brain.current_state?.tasks_queued ?? 0}`,
      `- System load: CPU ${brain.current_state?.system_load?.cpu_percent ?? 0}%, RAM ${brain.current_state?.system_load?.ram_percent ?? 0}%`,
      `- Overloaded: ${brain.current_state?.is_overloaded ? 'YES (be cautious about spawning tasks)' : 'no'}`,
      ``,
      `# Available Capabilities`,
      `You can direct the user to (or describe how to):`,
      `- Create/wake/sleep agents`,
      `- Create tasks and assign them`,
      `- Approve or reject agent chunk reports`,
      `- Edit registries (agents, projects, tasks)`,
      `- View logs`,
      ``,
      `Speak naturally, helpfully, in the user's preferred style. You are not a generic assistant - you are Poseidon, with continuity across sessions via this brain file.`
    ];
    return lines.join('\n');
  }

  /**
   * Chat with Poseidon. Yields text chunks as model generates.
   * 
   * @param {string} userMessage
   * @param {Array<{role,content}>} history - prior turns
   * @yields {string} chunk of generated text
   */
  async *chatWithPoseidon(userMessage, history = []) {
    if (!this.poseidonModelId) {
      throw new Error('No model assigned to Poseidon. Import a model and assign it first.');
    }
    // Keep the last user message for emergency checkpoints
    const _entryPre = this.loaded.get(this.poseidonModelId);
    if (_entryPre) _entryPre._lastUserMessage = userMessage;
    
    // Auto-load if not yet loaded
    if (!this.loaded.has(this.poseidonModelId)) {
      console.log(`[V2ModelService] Auto-loading ${this.poseidonModelId} for Poseidon chat...`);
      await this.ensureLoaded(this.poseidonModelId);
    }
    
    const entry = this.loaded.get(this.poseidonModelId);
    if (!entry) {
      throw new Error('Poseidon model failed to load');
    }
    if (entry.generating) {
      throw new Error('Poseidon is already generating a response. Wait for it to finish.');
    }

    entry.generating = true;
    entry.lastUsedAt = Date.now();
    entry.totalRequests++;
    entry._lastUserMessage = userMessage;

    // ── AUTO-CONTINUE: if session_state shows an unfinished task and this message
    // looks like a continuation cue (short cmd OR first message after a crash),
    // prepend the previous context so Poseidon resumes without re-reading state.
    try {
      const ss = await this.rm.read('BRAIN/session_state.json');
      const isContinueCue = ss?.last_user_message && !ss.emergency && (
        // Explicit continuation keywords
        /^(continue|go ahead|proceed|keep going|resume|go on|do it|yes|go|ok|k|yep|sure)\.?$/i.test(userMessage.trim()) ||
        // First turn after a crash/restart (turn 0 = fresh session, state exists = was mid-task)
        (entry.sessionTurns === 0 && ss.last_user_message && ss.context_pct < 90)
      );
      if (isContinueCue) {
        const tools = ss.tool_calls_this_turn?.length ? ' | last tools: ' + ss.tool_calls_this_turn.join(', ') : '';
        userMessage = '[RESUME PREVIOUS TASK — turn ' + ss.turn + ', ' + ss.context_pct + '% ctx' + tools + ']\n' +
          'User previously asked: "' + ss.last_user_message + '"\n' +
          'Your last response: "' + ss.last_response_preview + '"\n' +
          'Task was not completed. Resume and finish it now. Do not re-introduce yourself.';
        entry._lastUserMessage = userMessage;
        console.log('[V2ModelService] Auto-continue injected for turn ' + entry.sessionTurns);
      }
    } catch {}
    
    // Per-session turn counter (resets when session is wiped)
    entry.sessionTurns = (entry.sessionTurns || 0);

    try {
      const llamaCpp = await import('node-llama-cpp');

      // Reuse the same session across chats so we don't burn through sequences.
      if (!entry.session) {
        const orchestrator = this.orchestrator;
        let systemPrompt, functions;
        if (orchestrator) {
          systemPrompt = await orchestrator.buildSystemPrompt();
          try {
            functions = await orchestrator.buildFunctions();
          } catch (err) {
            console.warn('[V2ModelService] Function-calling setup failed:', err.message, '- continuing without functions');
            functions = undefined;
          }
        } else {
          systemPrompt = await this.buildPoseidonSystemPrompt();
        }

        // Auto-slim system prompt when context is tight.
        // Rule of thumb: system prompt should not exceed 60% of total ctx,
        // leaving 40% for conversation. ~4 chars per token.
        const ctxTokens   = entry.config?.contextLength || V2ModelService.MIN_VIABLE_CTX;
        const promptTokens = Math.ceil(systemPrompt.length / 4);
        const budgetTokens = Math.floor(ctxTokens * 0.6);
        if (promptTokens > budgetTokens) {
          const maxChars  = budgetTokens * 4;
          const original  = systemPrompt.length;
          // Hard truncate: keep first section (absolute rules) + truncation notice
          const notice    = `

[System prompt truncated from ${original} to ${maxChars} chars to fit ctx=${ctxTokens}]`;
          systemPrompt    = systemPrompt.slice(0, maxChars - notice.length) + notice;
          console.warn(`[V2ModelService] System prompt slimmed: ${original} → ${systemPrompt.length} chars (ctx=${ctxTokens})`);
          // Drop function-calling if ctx is critically small
          if (ctxTokens < 3500) {
            console.warn(`[V2ModelService] ctx=${ctxTokens} < 3500 — disabling function-calling to save space`);
            functions = undefined;
          }
        }

        // TOOL COMPRESSION: tool schemas are serialized into the prompt and can
        // cost 3-4k tokens with 27 tools. On tight contexts, truncate descriptions
        // to the first sentence (max 90 chars) — keeps meaning, halves the cost.
        if (functions && ctxTokens < 16384) {
          let saved = 0;
          for (const fn of Object.values(functions)) {
            if (fn.description && fn.description.length > 90) {
              const firstSentence = fn.description.split(/(?<=[.!?])\s/)[0] || fn.description;
              const slim = firstSentence.slice(0, 90);
              saved += fn.description.length - slim.length;
              fn.description = slim;
            }
            // Also slim param descriptions
            const props = fn.params?.properties || {};
            for (const p of Object.values(props)) {
              if (p.description && p.description.length > 60) {
                saved += p.description.length - 60;
                p.description = p.description.slice(0, 60);
              }
            }
          }
          if (saved > 0) console.log(`[V2ModelService] Tool descriptions compressed: ~${Math.round(saved/4)} tokens saved (ctx=${ctxTokens})`);
        }

        const sequence   = entry.context.getSequence();
        entry.session    = new llamaCpp.LlamaChatSession({
          contextSequence: sequence,
          systemPrompt,
          chatWrapper: 'auto'
        });
        entry._functions         = functions;
        entry._currentSequence   = sequence;
        entry.sessionTurns       = 0;
        entry._lastSystemPromptChars = systemPrompt.length;
        const wrapper = entry.session.chatWrapper?.constructor?.name || 'unknown';
        console.log(`[V2ModelService] Session created for ${this.poseidonModelId} (${wrapper}, ctx=${ctxTokens}, prompt=${promptTokens}tok${functions ? `, ${Object.keys(functions).length} tools` : ', no tools (ctx too small)'})`);
      }
      const session = entry.session;

      // Buffer for text chunks AND for tool-call / tool-result events.
      // The model emits text via onTextChunk; we wrap each function so we also
      // capture call + result events for SSE streaming to the client.
      const events = [];
      
      // Wrap each function so we can stream tool-call + tool-result events.
      // The wrapped versions still call the originals but also emit to `events`.
      let wrappedFunctions;
      if (entry._functions) {
        wrappedFunctions = {};
        for (const [fnName, fnDef] of Object.entries(entry._functions)) {
          // fnDef from defineChatSessionFunction has shape { description, params, handler }
          // We reconstruct via defineChatSessionFunction again so the wrapped one
          // is still a valid ChatSessionModelFunction.
          const originalHandler = fnDef.handler;
          wrappedFunctions[fnName] = {
            ...fnDef,
            handler: async (args) => {
              const callTime = Date.now();
              events.push({ type: 'tool_call', name: fnName, args, at: callTime });
              try {
                const result = await originalHandler(args);
                events.push({ type: 'tool_result', name: fnName, result, duration_ms: Date.now() - callTime });
                return result;
              } catch (err) {
                const errResult = { ok: false, error: err.message };
                events.push({ type: 'tool_result', name: fnName, result: errResult, duration_ms: Date.now() - callTime });
                return errResult;
              }
            }
          };
        }
      }
      
      // Read inference params from brain (set via AgentForm or brain.json).
      // Fall back to generous defaults so Qwen3 thinking blocks don't eat all tokens.
      let brainParams = {};
      try {
        const b = await this.rm.getPoseidonBrain();
        brainParams = b?.brain_config?.inference_params || b?.current_state?.inference_params || {};
      } catch {}
      const maxTokens = brainParams.max_tokens_per_response || 4096;

      // State machine for <think>...</think> parsing across streaming chunks.
      // State is stored on the entry so it survives between poll cycles.
      entry._thinkBuf   = '';     // inter-chunk buffer
      entry._inThink    = false;  // are we currently inside a <think> block?

      const promptOpts = {
        onTextChunk: (chunk) => {
          let buf = entry._thinkBuf + chunk;
          entry._thinkBuf = '';
        entry._inThink  = false;
          while (buf.length > 0) {
            if (entry._inThink) {
              const closeIdx = buf.indexOf('</think>');
              if (closeIdx === -1) {
                // Still inside think block — buffer everything (tag might be split)
                // But emit what we have as thinking if it's getting long
                if (buf.length > 50) {
                  events.push({ type: 'thinking', chunk: buf.slice(0, -15) });
                  entry._thinkBuf = buf.slice(-15);
                } else {
                  entry._thinkBuf = buf;
                }
                buf = '';
              } else {
                // End of think block found
                if (closeIdx > 0) events.push({ type: 'thinking', chunk: buf.slice(0, closeIdx) });
                events.push({ type: 'thinking_end' });
                entry._inThink = false;
                buf = buf.slice(closeIdx + '</think>'.length).replace(/^\n/, '');
              }
            } else {
              const openIdx = buf.indexOf('<think>');
              if (openIdx === -1) {
                // Pure text — check for partial opening tag at end
                const partial = ['<think>', '<think', '<thin', '<thi', '<th', '<t', '<'].find(p => buf.endsWith(p));
                if (partial) {
                  if (buf.length > partial.length) events.push({ type: 'text', chunk: buf.slice(0, -partial.length) });
                  entry._thinkBuf = partial;
                } else {
                  events.push({ type: 'text', chunk: buf });
                }
                buf = '';
              } else {
                if (openIdx > 0) events.push({ type: 'text', chunk: buf.slice(0, openIdx) });
                events.push({ type: 'thinking_start' });
                entry._inThink = true;
                buf = buf.slice(openIdx + '<think>'.length);
              }
            }
          }
        },
        maxTokens
      };
      if (wrappedFunctions) promptOpts.functions = wrappedFunctions;
      const completion = session.prompt(userMessage, promptOpts);

      // Yield events as they accumulate. Two kinds:
      //   - 'text' events: emit just the chunk (consumer joins them)
      //   - 'tool_call' / 'tool_result' events: surface for UI thinking display
      let lastIdx = 0;
      let lastChunkAt = Date.now();
      const IDLE_TIMEOUT_MS = 300000;  // 5 min — tool calls (web fetch, file ops) can take time
      const ABSOLUTE_MAX_MS = 30 * 60_000;
      const start = Date.now();
      while (true) {
        const isDone = await Promise.race([
          completion.then(() => true),
          new Promise(r => setTimeout(() => r(false), 100))
        ]);
        while (lastIdx < events.length) {
          const ev = events[lastIdx++];
          // Any token output (text, thinking, tools) resets the idle clock
          lastChunkAt = Date.now();
          if (ev.type === 'text') {
            entry.totalTokensGenerated += Math.ceil(ev.chunk.length / 4);
          }
          yield ev;
        }
        if (isDone) break;

        // Stop button: abort requested from UI
        if (entry._abortRequested) {
          entry._abortRequested = false;
          console.log('[V2ModelService] Generation aborted by user');
          yield { type: 'text', chunk: '\n\n_[Generation stopped by user]_' };
          break;
        }

        const idleMs = Date.now() - lastChunkAt;
        // Don't timeout while model is actively thinking (think block open)
        const isThinking = entry._inThink === true;
        if (!isThinking && idleMs > IDLE_TIMEOUT_MS) {
          console.warn(`[V2ModelService] generation idle timeout (${Math.round(idleMs/1000)}s) — resetting session`);
          // Reset session so next message reloads cleanly (user won't notice)
          try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
          entry.session = null;
          entry._currentSequence = null;
          entry.sessionTurns = 0;
          entry._thinkBuf = '';
          entry._inThink  = false;
          break;
        }
        if (Date.now() - start > ABSOLUTE_MAX_MS) {
          console.warn('[V2ModelService] absolute generation cap (30min) hit');
          break;
        }
      }
      
      // Flush remaining buffer
      if (entry._thinkBuf && entry._thinkBuf.trim().length > 0) {
        const t = entry._inThink ? 'thinking' : 'text';
        events.push({ type: t, chunk: entry._thinkBuf.trim() });
        if (entry._inThink) events.push({ type: 'thinking_end' });
      }
      entry._thinkBuf = '';
      entry._inThink  = false;

      // Successfully completed a turn
      entry.sessionTurns++;
      
      // Log this exchange to the V2 log file
      const fullResponse = events.filter(e => e.type === 'text').map(e => e.chunk).join('');
      const toolCallCount = events.filter(e => e.type === 'tool_call').length;
      await this.rm.log({
        event_type: 'user_input',
        severity: 'info',
        actor: { type: 'human', id: 'human_user' },
        subject: { type: 'system', id: 'poseidon_main' },
        action: 'Chat exchange',
        context: {
          model_id: this.poseidonModelId,
          turn: entry.sessionTurns,
          user_message_preview: userMessage.slice(0, 200),
          response_preview: fullResponse.slice(0, 200),
          tokens_in_response: Math.ceil(fullResponse.length / 4),
          tool_calls_made: toolCallCount
        }
      }).catch(() => {});
      
      // ── CONTEXT CHECKPOINT SYSTEM (token-based, not turn-based) ──────────
      // Measure REAL KV-cache usage from the sequence. When usage crosses the
      // threshold, generate a continuity summary while there's still room,
      // then reload the session fresh. The summary is injected into the next
      // system prompt as # CONTINUITY so Poseidon resumes where it left off.
      const ctxTotal = entry.config?.contextLength || 4096;
      let ctxUsed = 0;
      try { ctxUsed = entry._currentSequence?.nextTokenIndex ?? 0; } catch {}
      if (!ctxUsed) {
        // Fallback estimate: system prompt + ~400 tok per exchange
        ctxUsed = Math.ceil((entry._lastSystemPromptChars || 3000) / 4) + entry.sessionTurns * 400;
      }
      const ctxPct = Math.min(100, Math.round((ctxUsed / ctxTotal) * 100));
      entry.contextUsedTokens  = ctxUsed;
      entry.contextTotalTokens = ctxTotal;
      entry.contextPct         = ctxPct;

      // ── SESSION STATE (lightweight continuity, updated every turn) ───────
      // Written to BRAIN/session_state.json after every exchange so the next
      // server restart can resume without re-reading everything.
      const toolNames = events.filter(e => e.type === 'tool_call').map(e => e.name || '?');
      this.rm.write('BRAIN/session_state.json', {
        saved_at: new Date().toISOString(),
        turn: entry.sessionTurns,
        context_pct: ctxPct,
        context_used: ctxUsed,
        context_total: ctxTotal,
        last_user_message: userMessage.slice(0, 500),
        last_response_preview: fullResponse.slice(0, 300),
        tool_calls_this_turn: toolNames
      }).catch(() => {});

      // Session persists indefinitely — no proactive wipe
    } catch (err) {
      // Catch all session/context/prompt errors and reset session state fully
      const isSessionErr = /no sequences|sequence|context|too long|compress|prompt|system message/i.test(err.message);
      if (isSessionErr) {
        console.warn(`[V2ModelService] Session error, emergency checkpoint + reset:`, err.message);
        // Save what we can BEFORE losing the session — work is never silently lost
        await this._emergencyReset(entry).catch(() => {});
        entry.session = null;
        entry._currentSequence = null;
        entry.sessionTurns = 0;
        // Surface a friendly error if it's a context-too-small problem
        if (/too long|compress|system message/i.test(err.message)) {
          const ctx = entry.config?.contextLength || '?';
          throw new Error(
            `Model context (${ctx} tokens) is too small for the Poseidon system prompt. ` +
            `Minimum recommended: ${V2ModelService.MIN_VIABLE_CTX} tokens. ` +
            `Try a larger model or increase contextLength in model params.`
          );
        }
      }
      throw err;
    } finally {
      entry.generating = false;
      entry.lastUsedAt = Date.now();

      // Update registry
      await this._registryUpsert(this.poseidonModelId, {
        runtime: {
          loaded_at: new Date(entry.loadedAt).toISOString(),
          last_used_at: new Date(entry.lastUsedAt).toISOString(),
          total_tokens_generated: entry.totalTokensGenerated,
          total_requests: entry.totalRequests
        }
      }).catch(() => {});
    }
  }

  /**
   * Reset Poseidon's chat session - clears all conversation history but keeps
   * the model loaded. Called when user clicks "Reset" in chat UI.
   */
  async resetPoseidonSession() {
    if (!this.poseidonModelId) return { success: false, error: 'No Poseidon model' };
    const entry = this.loaded.get(this.poseidonModelId);
    if (!entry || !entry.session) return { success: true, info: 'No session to reset' };
    if (entry.generating) throw new Error('Cannot reset while generating');
    try { await entry.session.dispose?.(); } catch {}
    entry.session = null;
    return { success: true, model_id: this.poseidonModelId };
  }


  // === DREAMING (metacognition, called by HeartbeatService when idle) ===

  /**
   * triggerDream — runs a background metacognition session when Poseidon has been
   * idle for DREAM_IDLE_MINUTES. Uses a SEPARATE session so the chat context is
   * never polluted. Poseidon reads its own recent logs + skills, reflects on what
   * worked and what needs improvement, then calls write_skill autonomously.
   *
   * Results saved to BRAIN/dream_memory.json — injected into next chat as # LAST DREAM.
   */
  async triggerDream() {
    const entry = this.poseidonModelId ? this.loaded.get(this.poseidonModelId) : null;
    if (!entry || entry.generating || entry.dreaming) return;
    if (!entry.model || !entry.context) return;

    entry.dreaming = true;
    console.log('[V2ModelService] 💤 Poseidon dreaming — pure-JS metacognition');

    try {
      const AQUARIUM = require('../aquarium');
      const fsp  = require('fs').promises;
      const fsSync = require('fs');
      const path = require('path');

      // ── Step 1: Read recent logs ─────────────────────────────────────────
      let recentErrors = [];
      let recentToolRetries = {};
      try {
        const logsPath = path.join(AQUARIUM.ROOT, 'LOGS', 'logs.json');
        const logsRaw  = JSON.parse(fsSync.readFileSync(logsPath, 'utf8'));
        const entries  = (logsRaw.entries || []).slice(-50);
        // Find errors and retried tool calls
        for (const e of entries) {
          if (e.severity === 'error' || (e.context?.ok === false)) recentErrors.push(e.action || e.event_type);
          if (e.event_type === 'tool_call' && e.context?.ok === false) {
            const t = e.subject?.id || 'unknown';
            recentToolRetries[t] = (recentToolRetries[t] || 0) + 1;
          }
        }
      } catch {}

      // ── Step 2: Read existing skills ─────────────────────────────────────
      let existingSkills = [];
      try {
        if (fsSync.existsSync(AQUARIUM.SKILLS)) {
          existingSkills = fsSync.readdirSync(AQUARIUM.SKILLS)
            .filter(f => f.endsWith('.json'))
            .map(f => f.replace('.json', ''));
        }
      } catch {}

      // ── Step 3: Identify gaps and auto-patch known fixable patterns ───────
      const patches = [];

      // Pattern: fetch_image_url errors → skill needs reminder
      const imgRetries = recentToolRetries['fetch_image_url'] || 0;
      if (imgRetries > 2 && existingSkills.includes('find_image')) {
        patches.push('find_image skill had repeated failures — skill is current v3, no auto-patch needed');
      }

      // Pattern: skill_not_found for a new skill type → note it
      const notFoundErrors = recentErrors.filter(e => e && e.includes('not found'));
      for (const err of notFoundErrors.slice(0, 3)) {
        patches.push(`Observed gap: ${err}`);
      }

      // ── Step 4: Write dream summary ───────────────────────────────────────
      const lines = [
        `Dream at: ${new Date().toISOString()}`,
        `Session turns at dream: ${entry.sessionTurns}`,
        `Recent error count: ${recentErrors.length}`,
        `Tool retry hotspots: ${JSON.stringify(recentToolRetries)}`,
        `Existing skills (${existingSkills.length}): ${existingSkills.join(', ')}`,
        patches.length ? `Observations:\n${patches.map(p => '- ' + p).join('\n')}` : 'No actionable gaps found.',
        'On next chat: review these observations and update any relevant skills.'
      ];
      const reflection = lines.join('\n');

      const dreamRecord = {
        saved_at: new Date().toISOString(),
        type: 'dream',
        turns_at_dream: entry.sessionTurns,
        reflection
      };
      await this.rm.write('BRAIN/dream_memory.json', dreamRecord).catch(() => {});
      console.log(`[V2ModelService] 💤 Dream complete — ${patches.length} observation(s) logged`);

      await this.rm.log({
        event_type: 'poseidon_decision', severity: 'info',
        actor: { type: 'system', id: 'poseidon_dream' },
        subject: { type: 'system', id: 'poseidon_main' },
        action: 'Pure-JS metacognition dream cycle complete',
        context: { errors_seen: recentErrors.length, tool_retries: recentToolRetries }
      }).catch(() => {});

    } catch (e) {
      console.warn('[Dream] Failed:', e.message);
    } finally {
      entry.dreaming = false;
    }
  }


  // === TTL CHECK (called by HeartbeatService) ===

  async checkTtl() {
    const now = Date.now();
    for (const [modelId, entry] of this.loaded.entries()) {
      if (entry.generating) continue;
      const idleMinutes = (now - entry.lastUsedAt) / 60000;
      if (idleMinutes >= entry.config.autoUnloadIdleMinutes) {
        console.log(`[V2ModelService] TTL: unloading ${modelId} after ${idleMinutes.toFixed(1)} min idle`);
        try {
          await this.unloadModel(modelId);
        } catch (err) {
          console.warn(`[V2ModelService] TTL unload failed for ${modelId}:`, err.message);
        }
      }
    }
  }

  // === REGISTRY MERGE HELPER ===

  /**
   * Generate an image using an image-type GGUF model.
   * Returns { ok, outputPath, bytes, url } or { ok:false, error }.
   */
  async generateImage({ modelId, prompt, outputPath, width, height, steps, cfg, seed, negativePrompt }) {
    this.rm.invalidateCache();
    const reg = await this.rm.read('models/model_registry.json');
    const entry = reg.models?.[modelId];
    if (!entry) return { ok: false, error: `Model ${modelId} not in registry` };
    if (entry.model_type !== 'image') {
      return { ok: false, error: `Model ${modelId} is type '${entry.model_type || 'text'}', not an image model. Change model_type in the library.` };
    }
    return this.imageGen.generate({
      modelPath: entry.file_path,
      prompt, outputPath, width, height, steps, cfg, seed, negativePrompt
    });
  }

  async _registryUpsert(modelId, partial) {
    this.rm.invalidateCache();
    // Bootstrap registry if it doesn't exist yet (e.g. first import after workspace rename)
    let reg;
    try {
      reg = await this.rm.read('models/model_registry.json');
    } catch {
      reg = {
        schema_version: '2.0', schema_type: 'model_registry',
        metadata: { total_available: 0, last_updated_at: new Date().toISOString() },
        models: {}
      };
      // Ensure models dir exists
      const path = require('path');
      const fsP  = require('fs').promises;
      await fsP.mkdir(path.join(this.rm.dataRoot, 'models'), { recursive: true });
    }
    const existing = reg.models[modelId] || { model_id: modelId };
    reg.models[modelId] = this._deepMerge(existing, partial);
    reg.metadata.total_available = Object.keys(reg.models).length;
    reg.last_updated_at = new Date().toISOString();
    await this.rm.write('models/model_registry.json', reg);
  }

  _deepMerge(target, source) {
    const out = { ...target };
    for (const [k, v] of Object.entries(source)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        out[k] = this._deepMerge(target[k] || {}, v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }
}

module.exports = V2ModelService;
