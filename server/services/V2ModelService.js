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
const os = require('os');
const log = require('../utils/logger').createLogger('V2ModelService');
// Inference threads default: ~physical cores (logical / 2 on SMT CPUs).
// Was hardcoded 4 — on a 6-core Ryzen the CPU-offloaded layers ran on
// 4/6 cores, throttling prefill AND decode by ~1/3 for zero benefit.
const DEFAULT_CPU_THREADS = Math.max(4, Math.floor(os.cpus().length / 2));
const ModelBroker = require('./ModelBroker');
const { PRIORITY } = ModelBroker;
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
    this.broker   = new ModelBroker();  // single-resource coordinator
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
      log.warn(' Could not restore Poseidon model:', err.message)
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

      const reg = await this.rm.read('MODELS/model_registry.json').catch(() => ({ models: {} }));
      if (!reg.models?.[savedId]) {
        log.info(` Saved Poseidon model ${savedId} not in registry — skipping restore`);
        return;
      }
      this.poseidonModelId = savedId;
      log.info(` ✓ Restored Poseidon model from brain: ${savedId} — pre-loading into VRAM...`);
      // Eagerly load so first chat is instant (not lazy on first message)
      this.ensureLoaded(savedId).catch(err =>
        log.warn(` Startup pre-load failed for ${savedId}:`, err.message)
      );
    } catch (err) {
      // non-fatal
    }
  }

  /** Read saved Poseidon model ID from brain (used after image gen to restore) */
  async _getSavedPoseidonId() {
    try {
      const brain = await this.rm.getPoseidonBrain();
      const savedId = brain?.current_state?.loaded_model_id;
      if (!savedId) return null;
      const reg = await this.rm.read('MODELS/model_registry.json').catch(() => ({ models: {} }));
      return reg.models?.[savedId] ? savedId : null;
    } catch { return null; }
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
      emergency: false   // never true — would trigger endless auto-continue loop
    }).catch(() => {});

    try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
    try { if (entry._currentSequence?.dispose) await entry._currentSequence.dispose(); } catch {}
    // Small delay to ensure llama.cpp releases the sequence slot before next getSequence()
    await new Promise(r => setTimeout(r, 100));
    entry.session           = null;
    entry._currentSequence  = null;
    entry.sessionTurns      = 0;
    entry._thinkBuf         = '';
    entry.contextPct        = 0;
    entry.contextUsedTokens = 0;
    log.info(' Emergency reset — session cleared after crash');

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
        try {
          this.llama = await llamaCpp.getLlama('lastBuild');
          log.info(' node-llama-cpp initialized (custom build)');
        } catch {
          this.llama = await llamaCpp.getLlama();
          log.info(' node-llama-cpp initialized (prebuilt)');
        }
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
    cpuThreads: DEFAULT_CPU_THREADS,   // ~physical cores (see top of file)
    batchSize: 1024,          // prompt-processing batch — bigger = faster prefill, ladder guards VRAM
    flashAttention: true,     // ~50% smaller KV cache (biggest VRAM saver)
    useMmap: true,            // OS-level page sharing for the model file
    useMlock: false,          // disabled by default (can be enabled in Edit Params)
    randomSeed: true,
    autoUnloadIdleMinutes: 720
  };

  async scanLocalModels() {
    const result = [];
    try {
      const files = await fs.readdir(this.modelsDir);
      for (const file of files) {
        if (!file.toLowerCase().endsWith('.gguf')) continue;
        const fullPath = path.join(this.modelsDir, file);
        // Per-file guard: a broken symlink or a file deleted mid-scan
        // (ENOENT) used to abort the ENTIRE scan via the outer catch,
        // hiding every other model. Skip just the bad entry instead —
        // and warn only ONCE per file per process (the scan runs several
        // times a minute; repeating the same warn floods the terminal).
        let stat;
        try { stat = await fs.stat(fullPath); }
        catch (e) {
          // Broken symlink: NEVER auto-delete — the target can be
          // TEMPORARILY absent (unmounted drive, network share, file being
          // moved) and deleting the link is destructive and irreversible
          // (lesson learned: a Flux T5 companion symlink got auto-removed
          // this way). Warn once per process with the target path so the
          // user can decide, and skip.
          this._scanWarned = this._scanWarned || new Set();
          if (!this._scanWarned.has(file)) {
            this._scanWarned.add(file);
            let target = '';
            if (e.code === 'ENOENT') {
              try {
                const l = await fs.lstat(fullPath);
                if (l.isSymbolicLink()) target = ` — symlink to missing target "${await fs.readlink(fullPath)}" (mount the target or remove the link)`;
              } catch {}
            }
            log.warn(` scanLocalModels: skipping ${file} (${e.code || e.message})${target}`);
          }
          continue;
        }
        
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
      log.warn(' scanLocalModels:', err.message);
    }
    return result;
  }

  /**
   * Scan local files AND merge with registry to show import status.
   */
  async getLibrary() {
    const scanned = await this.scanLocalModels();
    this.rm.invalidateCache();
    const reg = await this.rm.read('MODELS/model_registry.json');
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
        display_name: regEntry?.display_name || null,
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
      broker: this.broker.getState(),
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
    const reg = await this.rm.read('MODELS/model_registry.json');
    const entry = reg.models[modelId];
    if (!entry) throw new Error(`Model ${modelId} not in library`);
    
    const newConfig = { ...entry.config, ...params };
    entry.config = newConfig;
    await this.rm.write('MODELS/model_registry.json', reg);
    
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
    const reg = await this.rm.read('MODELS/model_registry.json');
    delete reg.models[modelId];
    await this.rm.write('MODELS/model_registry.json', reg);
    
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
      log.info(` Joining existing load for ${modelId} (dedup)`);
      return this._loadingPromises.get(modelId);
    }

    this.rm.invalidateCache();
    const reg = await this.rm.read('MODELS/model_registry.json');
    const entry = reg.models[modelId];
    if (!entry) throw new Error(`Model ${modelId} not in library. Import it first.`);
    if (entry.status === 'missing') throw new Error(`Model file is missing: ${entry.file_path}`);

    // Unload any currently loaded model before loading a new one.
    // node-llama-cpp keeps weights in VRAM — two models can't coexist on a consumer GPU.
    for (const [loadedId] of this.loaded) {
      if (loadedId !== modelId) {
        log.info(` Unloading ${loadedId} to free VRAM for ${modelId}`);
        await this.unloadModel(loadedId).catch(() => {});
      }
    }

    const promise = this.loadModel(entry.file_name, entry.config || {}).catch(err => {
      // Detect unknown architecture errors and give actionable guidance
      if (/unknown model architecture|unknown arch/i.test(err.message)) {
        const arch = err.message.match(/unknown model architecture: '([^']+)'/)?.[1] || 'unknown';
        throw new Error(
          `Architecture '${arch}' not supported by current llama.cpp build.\n` +
          `Run these commands in your IAQUA folder to add support:\n` +
          `  npx node-llama-cpp source download --release latest\n` +
          `  CMAKE_ARGS="-DGGML_CUDA=ON" npx node-llama-cpp source build\n` +
          `Or: npm run rebuild-llama\n` +
          `(~5-10 min. Fixes Gemma4, Llama4, and other new architectures.)`
        );
      }
      throw err;
    });
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
    // Soft migration: models imported before the auto-defaults have the OLD
    // hardcoded defaults (cpuThreads:4, batchSize:512) PERSISTED in their
    // registry config — exactly those values, together, mean "the user never
    // chose them". Upgrade to the new auto defaults; any other combination
    // is respected as a deliberate choice.
    if (cfg.cpuThreads === 4 && cfg.batchSize === 512) {
      log.info(` migrating legacy defaults for ${fileName}: threads 4→${DEFAULT_CPU_THREADS}, batch 512→1024`);
      cfg = { ...cfg, cpuThreads: undefined, batchSize: undefined };
    }
    const config = {
      contextLength: cfg.contextLength ?? 'auto',
      gpuLayers:     cfg.gpuLayers     ?? 'auto',
      cpuThreads:    cfg.cpuThreads    ?? DEFAULT_CPU_THREADS,
      batchSize:     cfg.batchSize     ?? 1024,
      flashAttention:cfg.flashAttention ?? true,
      useMmap:       cfg.useMmap       ?? true,
      useMlock:      cfg.useMlock      ?? false,
      randomSeed:    cfg.randomSeed    ?? true,
      autoUnloadIdleMinutes: cfg.autoUnloadIdleMinutes ?? 720
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
      log.info(` Loading ${fileName} (${fileSizeGb} GB)`);

      // ── Step 1: VRAM snapshot before weights ──────────────────────────────
      let vramBefore = null;
      try { if (llama.getVramState) vramBefore = await llama.getVramState(); } catch {}
      const freeBeforeGb = vramBefore ? vramBefore.free  / (1024 ** 3) : 0;
      const totalGb      = vramBefore ? vramBefore.total / (1024 ** 3) : 0;
      if (vramBefore) log.info(`  VRAM before load: ${freeBeforeGb.toFixed(2)} / ${totalGb.toFixed(2)} GB free`);
      try { if (llama.gpu) log.info(`  GPU backend: ${llama.gpu}`); } catch {}

      // Estimate total layers for gpu_layers auto-resolve.
      // Prefer the REAL layer count from the GGUF header: the old
      // "~160 MB/layer" heuristic assumes dense Q4 and is wildly wrong for
      // MoE models (an 8x3B MoE has ~28 layers of ~450MB — the heuristic
      // guessed 78 layers, so the frac math offloaded nearly everything and
      // the first attempt always OOM'd, burning slow 12GB retries down the
      // ladder). Header read is a few KB; fall back to the heuristic if it
      // fails.
      let estLayers = Math.max(20, Math.min(80, Math.round(fileSizeGb * 1024 / 160)));
      let isMoE = false;
      let headerGQA = null;   // exact GQA from header (null = unknown, fall back to name regex)
      let headerKvBytesPerTok = 0;  // exact KV bytes/token from header (0 = unknown, use heuristic)
      try {
        const { readGgufFileInfo } = await import('node-llama-cpp');
        const gguf = await readGgufFileInfo(fullPath, { readTensorInfo: false, logWarnings: false });
        const arch = gguf?.metadata?.general?.architecture;
        const am   = arch ? gguf.metadata[arch] : null;
        if (am?.block_count > 0) estLayers = Number(am.block_count) + 1; // +1 output layer
        isMoE = Number(am?.expert_count || 0) > 1;
        const hc  = Number(am?.attention?.head_count || 0);
        const hck = Number(am?.attention?.head_count_kv || 0);
        if (hc > 0 && hck > 0) headerGQA = hck < hc;
        // EXACT KV cost per token: 2 tensors (K+V) × 2 bytes (f16) ×
        // n_layers × n_kv_heads × head_dim. The 38/60KB heuristic was
        // optimistic for qwen35 (~68KB real) — every load burned 2 OOM
        // ladder retries before landing.
        // head_dim: PREFER the explicit attention.key_length/value_length —
        // modern archs (qwen3+) use head_dim=128 regardless of
        // embedding/heads, and emb/heads overestimates ~2.5x → the "exact"
        // budget shrank ctx to 11k and the context shift crashed every chat.
        const kl  = Number(am?.attention?.key_length || 0);
        const vl  = Number(am?.attention?.value_length || 0);
        const emb = Number(am?.embedding_length || 0);
        const headDimK = kl > 0 ? kl : (hc > 0 && emb > 0 ? emb / hc : 0);
        const headDimV = vl > 0 ? vl : headDimK;
        if (hck > 0 && headDimK > 0 && am?.block_count > 0) {
          // 2 bytes (f16) × layers × kv_heads × (K dim + V dim)
          headerKvBytesPerTok = 2 * Number(am.block_count) * hck * (headDimK + headDimV);
        }
        log.info(`  GGUF header: arch=${arch}, layers=${estLayers}${headerGQA !== null ? `, GQA=${headerGQA} (${hck}/${hc} kv heads)` : ''}${isMoE ? `, MoE ${am.expert_count} experts (${am.expert_used_count || '?'} active) — ALL expert weights count for VRAM, only active ones for compute` : ''}`);
      } catch (e) {
        log.warn(`  GGUF header read failed (${e.message}) — falling back to size heuristic (${estLayers} layers)`);
      }

      // Always recalculate gpuLayers AND contextLength dynamically based on CURRENT VRAM.
      // The stored registry values may be stale (computed under different VRAM conditions).
      config.gpuLayers     = 'auto';
      config.contextLength = 'auto';

      if (config.gpuLayers === 'auto' || config.gpuLayers === 'max') {
        if (vramBefore && freeBeforeGb > 0.5) {
          const bytesPerLayerGb = fileSizeGb / estLayers;
          const frac = Math.min(1.0, (freeBeforeGb * (isMoE ? 0.62 : 0.72)) / fileSizeGb);
          const canFitFully = frac >= 1.0;
          let gpuTarget;
          if (config.gpuLayers === 'max' || canFitFully) {
            // Fits with headroom — offload everything, KV still fits in the rest.
            gpuTarget = estLayers;
            config.gpuLayers = gpuTarget;
            log.info(`  [auto] gpuLayers: ${config.gpuLayers} / ${estLayers} (FULL GPU offload — fits with headroom)`);
          } else {
            // Model larger than VRAM: throughput is the binding constraint,
            // not context. The old frac math put few layers on GPU and then
            // handed ALL leftover VRAM to the KV cache (observed: 5/29
            // layers + a 61k-token KV on the 8x3B MoE — a 4k prompt through
            // 24 CPU MoE layers takes minutes). Budget explicitly instead:
            // small fixed KV reserve (≈16-20k tokens, plenty — Step 5 caps
            // ctx for offloaded models anyway), overhead for CUDA runtime +
            // compute buffers, and EVERYTHING else goes to layers.
            // KV reserve grew from 1.25 → 1.55GB: the tight ctx (~11-13k
            // real) was eating conversations after a handful of tool calls.
            // Trading ~2 GPU layers for +25% context is a good deal on
            // hybrid archs where the CPU-side layers are mostly linear
            // attention (fast) and every extra tool call takes 1-2k tokens.
            // On dense archs this simply pushes an ~11k session to ~14k.
            const kvReserveGb = 1.55;
            const overheadGb  = isMoE ? 0.8 : 0.5;  // MoE routing needs bigger compute buffers
            gpuTarget = Math.max(1, Math.floor((freeBeforeGb - kvReserveGb - overheadGb) / bytesPerLayerGb));
            gpuTarget = Math.min(gpuTarget, estLayers - 1);
            config.gpuLayers = gpuTarget;
            log.info(`  [auto] gpuLayers: ${config.gpuLayers} / ${estLayers} (model larger than VRAM — layers first: ${(gpuTarget * bytesPerLayerGb).toFixed(1)}GB layers + ${kvReserveGb}GB KV reserve + ${overheadGb}GB overhead)`);
          }
        } else {
          config.gpuLayers = 0;
          log.info(`  [auto] gpuLayers: 0 (no VRAM info, CPU only)`);
        }
      }

      // ── Step 2: LOAD WEIGHTS — with an OOM step-down ladder ──────────────
      // The gpuLayers estimate assumes ~160MB/layer (dense Q4). MoE models
      // break that badly: an 8x3B MoE has ~28 layers of ~450MB each, so the
      // heuristic offloads far too many → instant CUDA OOM with NO retry,
      // surfacing as "not enough VRAM". The ladder steps the GPU share down
      // (60% → 35% → 15% → CPU-only); combined with useMmap the CPU share
      // streams from disk cache, so big models load slower instead of
      // failing.
      const baseLayers = typeof config.gpuLayers === 'number' ? config.gpuLayers : 0;
      const layerLadder = [...new Set([
        baseLayers,
        Math.floor(baseLayers * 0.6),
        Math.floor(baseLayers * 0.35),
        Math.floor(baseLayers * 0.15),
        0,
      ])].filter(n => n >= 0);
      let loadErrFinal = null;
      for (let li = 0; li < layerLadder.length; li++) {
        const tryLayers = layerLadder[li];
        const lastRung  = li === layerLadder.length - 1;
        try {
          if (li > 0) log.info(`  [load retry ${li}] gpuLayers ${config.gpuLayers} → ${tryLayers} (VRAM/alloc failure on previous attempt)`);
          config.gpuLayers = tryLayers;
          model = await llama.loadModel({
            modelPath:  fullPath,
            gpuLayers:  tryLayers,
            useMmap:    config.useMmap,
            useMlock:   config.useMlock,
            defaultContextFlashAttention: config.flashAttention,
            // Last rung (gpuLayers 0 = pure CPU + mmap): node-llama-cpp's
            // pre-load memory estimator can VETO the load with a
            // "not enough VRAM/memory" error before even trying — and it
            // is pessimistic for MoE + mmap (pages stream from disk on
            // demand). Never let the estimator kill the fallback rung.
            ignoreMemorySafetyChecks: lastRung
          });
          loadErrFinal = null;
          break;
        } catch (loadErr) {
          const msg = loadErr.message || '';
          // llama.cpp tensor-shape errors surface as "missing blk.X.<tensor>.weight"
          // when the GGUF file's architecture doesn't match what the loader
          // expects (e.g. a text-encoder GGUF loaded as a chat model, an SSM
          // file loaded by a non-mamba build, or a corrupt / truncated file).
          if (/missing blk\.\d+\.[a-z_]+\.weight/i.test(msg)) {
            throw new Error(
              `${msg}\n\n` +
              `This usually means the GGUF file is NOT a chat LLM your llama.cpp build ` +
              `supports:\n` +
              `  • Diffusion companion (T5/CLIP/VAE text-encoder) — cannot run as chat model.\n` +
              `  • SSM / hybrid architecture (Mamba, Jamba) — needs a llama.cpp built with SSM support.\n` +
              `  • Truncated / corrupt download — retry or verify the sha256.\n\n` +
              `File: ${fileName}`
            );
          }
          const isVramErr = /out of memory|vram|cuda|alloc|failed to load|insufficient|not enough/i.test(msg);
          loadErrFinal = loadErr;
          if (!isVramErr || lastRung) {
            if (isMoE && lastRung) {
              throw new Error(
                `${msg}\n\n` +
                `This is a Mixture-of-Experts model: ALL expert weights must fit in ` +
                `memory even though only a few experts run per token — MoE saves ` +
                `compute, not RAM/VRAM. Even the CPU-only fallback failed, so the ` +
                `machine is short on system RAM for this file. Try a smaller quant ` +
                `(Q4_K_M / Q3_K_M) or a smaller expert count.\nFile: ${fileName}`
              );
            }
            throw loadErr;
          }
          // else: fall through to the next, smaller gpuLayers attempt
        }
      }
      if (!model) throw loadErrFinal || new Error('model load failed');

      const trainCtx = model.trainContextSize;
      log.info(`  Weights loaded. trainCtx=${trainCtx}, gpuLayers=${config.gpuLayers}`);

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
      if (vramAfter) log.info(`  VRAM after weights: ${freeAfterGb.toFixed(2)} GB free`);

      // ── Step 4: Compute contextLength from REAL remaining VRAM ─────────
      // Always recompute — never trust the stored value (stale, wrong GPU, etc.)
      {
        const modelName = (this.poseidonModelId || fileName.replace(/\.gguf$/i, '')).toLowerCase();
        // Exact GQA from the GGUF header when available — the name regex
        // missed e.g. 'l3-2-8x3b-…' (a GQA Llama-3.2) and budgeted 60KB/tok.
        const isGQA = (headerGQA !== null) ? headerGQA : /qwen|llama[-_]?3|mistral|gemma/.test(modelName);

        // KV cost per token: MEASURE, don't estimate. Every formula we
        // tried was wrong for some architecture (the 38KB heuristic was
        // optimistic for dense GQA; the header formula counts ALL layers
        // and overestimates 3-4x on HYBRID archs like qwen3.5 where only a
        // fraction of layers carry a KV cache — that regression shrank a
        // machine that used to run 40k contexts down to 11k). A 4096-token
        // probe context measures the true allocation, whatever the arch,
        // KV quantization, or flash setting. Cached per model+flags so
        // reloads skip the probe (~1s).
        V2ModelService._kvProbe = V2ModelService._kvProbe || new Map();
        const probeKey = `${fileName}|fa=${!!config.flashAttention}`;
        let probeData = V2ModelService._kvProbe.get(probeKey) || null;
        if (!probeData && vramAfter && freeAfterGb > 1.2) {
          // DIFFERENTIAL probe: a single context measurement bills the fixed
          // compute buffer as per-token cost (measured 102KB/tok on a hybrid
          // arch whose true KV is a fraction of that → ctx collapsed again).
          // Two probes of different sizes cancel the fixed part exactly:
          //   kvPerTok = (delta8k − delta4k) / 4096 ; fixed = delta4k − 4096·kv
          try {
            const probeBatch = Math.min(1024, config.batchSize || 1024);
            const measureCtx = async (size) => {
              const before = await llama.getVramState();
              const ctx = await model.createContext({
                contextSize: size, batchSize: probeBatch, sequences: 1,
                flashAttention: config.flashAttention
              });
              const after = await llama.getVramState();
              await ctx.dispose();
              return Math.max(0, before.free - after.free);
            };
            const d1 = await measureCtx(4096);
            const d2 = await measureCtx(8192);
            const rawKvPerTok = Math.round((d2 - d1) / 4096);
            // SANITY: allocator noise can make d2 <= d1 (cached buffers,
            // fragmentation), yielding a tiny/negative per-token cost. When
            // that happens the probe is worthless — trust the header-derived
            // formula (via the fallback chain below) instead of "measuring"
            // 2KB/tok and computing a 262k ctx that OOMs every rung.
            const MIN_SANE = 8 * 1024;   // any real KV per token must be >= 8KB
            if (rawKvPerTok < MIN_SANE || d2 <= d1) {
              log.warn(`  KV probe noisy (raw=${rawKvPerTok}B/tok, d4k=${(d1 / 1024 ** 3).toFixed(2)}GB, d8k=${(d2 / 1024 ** 3).toFixed(2)}GB) — discarding, falling back to header/heuristic`);
            } else {
              const kvPerTok = rawKvPerTok;
              const fixedBytes = Math.max(0, d1 - 4096 * kvPerTok);
              probeData = { kvPerTok, fixedBytes };
              V2ModelService._kvProbe.set(probeKey, probeData);
              log.info(`  KV probe (differential): ${Math.round(kvPerTok / 1024)}KB/tok + ${(fixedBytes / 1024 ** 3).toFixed(2)}GB fixed buffers (d4k=${(d1 / 1024 ** 3).toFixed(2)}GB, d8k=${(d2 / 1024 ** 3).toFixed(2)}GB)`);
            }
          } catch (probeErr) {
            log.warn(`  KV probe failed (${probeErr.message}) — falling back to estimates`);
          }
        }
        const measuredKvPerTok = probeData?.kvPerTok || 0;
        const measuredFixedGb  = probeData ? probeData.fixedBytes / 1024 ** 3 : 0;
        const bytesPerTok = measuredKvPerTok > 0
          ? Math.round(measuredKvPerTok * 1.05)      // measured + 5% safety
          : headerKvBytesPerTok > 0
            ? Math.round(headerKvBytesPerTok * 1.08) // header estimate (dense archs)
            : (config.flashAttention ? (isGQA ? 38 * 1024 : 60 * 1024) : 100 * 1024);
        // Margin: when the fixed compute buffer was MEASURED, subtract it plus
        // a small CUDA-runtime pad; otherwise fall back to the blanket 650MB.
        const margin = measuredFixedGb > 0 ? measuredFixedGb + 0.25 : 0.65;

        // Cap ctx when a big share of layers runs on CPU: each prompt token
        // crosses every CPU layer, so a 60k context on a mostly-CPU model
        // means minutes of prefill. VRAM saved here was already spent on
        // extra GPU layers in Step 1.
        const gpuL = Number(config.gpuLayers) || 0;
        const cpuShare = estLayers > 0 ? 1 - gpuL / estLayers : 0;
        config.cpuOffloadShare = Math.round(cpuShare * 100) / 100;  // used by session creation (compact prompt for slow models)
        const offloadCap = cpuShare > 0.6 ? 12288 : cpuShare > 0.3 ? 16384 : Infinity;

        if (vramAfter && freeAfterGb > margin + 0.1) {
          const availKvGb = freeAfterGb - margin;
          const toksFit   = Math.floor(availKvGb * 1024 ** 3 / bytesPerTok);
          const computed  = Math.max(V2ModelService.MIN_VIABLE_CTX, Math.floor(toksFit / 1024) * 1024);
          // Hard ceiling on the AUTO path: no consumer GPU justifies a
          // 262k context. Anything past 65k is a red flag (the OOM ladder
          // would burn 3+ retries and can cascade into an eviction loop).
          // Explicit contextLength in config bypasses 'auto' entirely.
          const AUTO_CTX_CEILING = 65536;
          config.contextLength = Math.min(computed, trainCtx, offloadCap, AUTO_CTX_CEILING);
          log.info(`  [auto] contextLength: ${config.contextLength} (availKv=${availKvGb.toFixed(2)}GB, ${Math.round(bytesPerTok/1024)}KB/tok${measuredKvPerTok ? ' (MEASURED)' : headerKvBytesPerTok ? ' (header estimate)' : ' (heuristic)'}, isGQA=${isGQA}, toksFit=${toksFit}${Number.isFinite(offloadCap) ? `, capped at ${offloadCap} — ${Math.round(cpuShare*100)}% of layers on CPU` : ''})`);
        } else if (!vramAfter) {
          // No VRAM info — use a conservative default
          config.contextLength = 8192;
          log.info(`  [auto] contextLength: ${config.contextLength} (no VRAM info, conservative default)`);
        } else {
          // Very little VRAM left — use minimum viable
          config.contextLength = V2ModelService.MIN_VIABLE_CTX;
          log.info(`  [auto] contextLength: ${config.contextLength} (low VRAM: ${freeAfterGb.toFixed(2)}GB free)`);
        }
      }

      // ── Step 5: CREATE CONTEXT — retry DOWN without reloading the model ───
      // The [auto] calculation already computed the max ctx that fits in VRAM.
      // Only step DOWN on OOM — never up (trying larger first fragments VRAM).
      //
      // VRAM-adaptive sequences: on 8GB every token of KV is precious, so we
      // run a single sequence (chat/BG/dream serialize through the broker and
      // the dream has to dispose the warm chat session to borrow the slot).
      // With 16/32GB there is KV headroom for parallel slots:
      //   ≥ 18GB free before load → 3 sequences (chat + dream + BG utility)
      //   ≥ 10GB free before load → 2 sequences (chat + dream/BG)
      //   otherwise               → 1 (current 8GB behaviour, unchanged)
      // The per-sequence context budget is divided accordingly, and the OOM
      // ladder below still protects us if the estimate is optimistic.
      const seqCount = freeBeforeGb >= 18 ? 3 : freeBeforeGb >= 10 ? 2 : 1;
      if (seqCount > 1) {
        const perSeq = Math.max(V2ModelService.MIN_VIABLE_CTX,
          Math.floor(config.contextLength / seqCount / 1024) * 1024);
        log.info(`  [auto] sequences: ${seqCount} (${freeBeforeGb.toFixed(1)}GB free) — ctx ${config.contextLength} → ${perSeq}/sequence`);
        config.contextLength = perSeq;
      }
      const ctxLadder = (() => {
        const target = config.contextLength;
        const steps  = [target, Math.floor(target * 0.75), Math.floor(target / 2), V2ModelService.MIN_VIABLE_CTX, 2048];
        return [...new Set(steps.map(v => Math.max(2048, Math.min(v, trainCtx))))];
      })();

      let ctxErr = null;
      for (let i = 0; i < ctxLadder.length; i++) {
        const tryCtx = ctxLadder[i];
        if (context) { try { await context.dispose(); } catch {} context = null; }
        try {
          if (i > 0) log.info(`  [ctx retry ${i}] trying ctx=${tryCtx}`);
          context = await model.createContext({
            contextSize:    tryCtx,
            batchSize:      config.batchSize,
            threads:        config.cpuThreads,
            sequences:      seqCount,
            flashAttention: config.flashAttention
          });
          config.contextLength = context.contextSize;
          log.info(`  Context created: ${config.contextLength} tokens${i > 0 ? ` (after ${i} retry/ies)` : ''}`);
          ctxErr = null;
          break;
        } catch (e) {
          ctxErr = e;
          const isOOM = /out of memory|VRAM|allocation|context size.*too large|insufficient/i.test(e.message);
          if (!isOOM) throw e;  // non-OOM error → propagate immediately
          log.warn(`  [ctx retry ${i}] OOM at ctx=${tryCtx}: ${e.message.slice(0, 80)}`);
        }
      }
      if (!context) {
        await model.dispose(); model = null;
        throw ctxErr || new Error('All context sizes failed (OOM)');
      }

      // Warn if context ended up too small for the system prompt
      if (config.contextLength < V2ModelService.MIN_VIABLE_CTX) {
        log.warn(
          `[V2ModelService] ⚠ Context ${config.contextLength} < ${V2ModelService.MIN_VIABLE_CTX} minimum. ` +
          `Chat may fail. Try: smaller model, fewer GPU layers, or CPU-only mode.`
        );
      }

      // ── Step 6: Register as loaded ────────────────────────────────────────
      this.loaded.set(modelId, {
        model_id: modelId, file_name: fileName, file_path: fullPath,
        model, context, session: null, config,
        _sequences: seqCount,
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
      log.info(` ✓ ${fileName} ready (ctx=${config.contextLength})`);
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
        const arch = archM[1];
        // Known architectures that need a future node-llama-cpp release:
        const tooNew = { gemma4: 'Gemma 4', phi4: 'Phi-4', llama4: 'Llama 4' };
        const name = tooNew[arch] || arch;
        throw new Error(
          `"${name}" requires a newer llama.cpp than bundled in node-llama-cpp 3.18.1.\n\n` +
          `FIX — run the helper script (takes ~5-10min, needs cmake):\n` +
          `  bash fix-llama-build.sh\n\n` +
          `OR manually:\n` +
          `  npx node-llama-cpp source download\n` +
          `  npx node-llama-cpp source build --gpu cuda\n` +
          `  npm start\n\n` +
          `ALTERNATIVE — these models work fine with 3.18.1: Qwen3, Llama 3.x, Mistral, Phi-3`
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

    log.info(` Unloaded ${modelId}`);
    return { success: true, model_id: modelId };
  }

  /**
   * createAgentContext — creates a DEDICATED context for an agent.
   * Agents cannot share Poseidon's context (sequences:1 = only 1 sequence available).
   * We create a smaller, separate context on the same model weights.
   * This avoids "no sequences available" crashes when agents run concurrently.
   */
  async createAgentContext(modelId) {
    const entry = this.loaded.get(modelId);
    if (!entry || !entry.model) throw new Error(`Model ${modelId} not loaded`);

    const targetCtx = Math.min(
      entry.config?.contextLength || 4096,
      8192   // agents get at most 8k ctx — saves VRAM, enough for task execution
    );
    const ctxSteps = [targetCtx, 4096, 2048].filter(v => v <= (entry.config?.contextLength || 4096));

    let context = null;
    for (const tryCtx of ctxSteps) {
      try {
        context = await entry.model.createContext({
          contextSize:    tryCtx,
          sequences:      1,
          flashAttention: entry.config?.flashAttention
        });
        const sequence = context.getSequence();
        log.info(` Agent context created on ${modelId}: ctx=${tryCtx}`);
        return { context, sequence, contextLength: tryCtx };
      } catch (e) {
        const isOOM = /out of memory|VRAM|allocation|sequences/i.test(e.message);
        if (!isOOM) throw e;
        if (context) { try { await context.dispose(); } catch {} context = null; }
      }
    }
    throw new Error(`Cannot create agent context on ${modelId}: all sizes failed (OOM)`);
  }

  // === POSEIDON ASSIGNMENT ===

  async setPoseidonModel(modelId) {
    this.rm.invalidateCache();
    const reg = await this.rm.read('MODELS/model_registry.json');
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
    await this.rm.write('BRAIN/poseidon_brain.json', brain);

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
      log.info(` Pre-loading ${modelId} after assignment to Poseidon...`);
      // Important: don't return this promise - let it run in background
      this.ensureLoaded(modelId).then(() => {
        log.info(` ✓ Pre-load complete for ${modelId}, ready for chat`);
      }).catch(err => {
        log.warn(` Pre-load failed for ${modelId}:`, err.message);
      });
    }

    return { success: true, model_id: modelId, loaded: this.loaded.has(modelId), preloading: !this.loaded.has(modelId) };
  }

  /**
   * Returns true if Poseidon has a warm chat session with turns > 0.
   * Used by HeartbeatService to defer dream disposal while user is actively
   * chatting — the dream would otherwise force a 20-25s system prompt
   * reprocess on the next user message.
   */
  hasActiveChatSession() {
    const entry = this.poseidonModelId ? this.loaded.get(this.poseidonModelId) : null;
    return !!(entry && entry.session && (entry.sessionTurns || 0) > 0);
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
        system_prompt_tokens: Math.ceil((e._lastSystemPromptChars || 0) / 4),
        session_mode: e._sessionMode || null,
        last_perf: e.lastPerf || null,   // { first_token_s, decode_tok_s, tokens, at }
        cpu_offload_share: e.config?.cpuOffloadShare ?? 0,
        dreaming: e.dreaming || false
      })),
      poseidon_model_id: this.poseidonModelId,
      dream_model_id: this.dreamModelId || null,
      broker: this.broker.getState()
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

  /**
   * queueBgMessage — queues a BG task for Poseidon (used by HeartbeatService for
   * proactive project audits). Runs async, does not block caller.
   * Deduplicates by key to avoid flooding if the previous audit hasn't finished.
   */
  queueBgMessage(message, key = 'bg') {
    if (!this._bgQueue) this._bgQueue = new Map();
    if (this._bgQueue.has(key)) return; // already queued
    this._bgQueue.set(key, true);
    setImmediate(async () => {
      try {
        for await (const ev of this.chatWithPoseidon(message, [], { _bgMode: true })) {
          // Drain the generator — output goes to ReasoningBus via the chat route listener
          if (global.ReasoningBus && ev.type === 'text') {
            global.ReasoningBus.push({ type: 'text', task_id: key, chunk: ev.chunk });
          }
        }
        // Emit a lifecycle event for the toast layer when an audit finishes
        if (key.startsWith('audit_') && global.ReasoningBus) {
          global.ReasoningBus.push({
            type: 'bg_task_complete',
            task_id: key,
            kind: 'project_audit',
            timestamp: Date.now(),
          });
        }
      } catch (e) {
        log.warn(` queueBgMessage(${key}) error:`, e.message);
      } finally {
        this._bgQueue.delete(key);
      }
    });
  }

  async *chatWithPoseidon(userMessage, historyIn = [], { _skipBroker = false, _bgMode = false, _genParams = null, _agentPrompt = null } = {}) {
    let history = historyIn.slice(); // mutable copy
    if (!this.poseidonModelId) {
      throw new Error('No model assigned to Poseidon. Import a model and assign it first.');
    }
    // Keep the last user message for emergency checkpoints
    const _entryPre = this.loaded.get(this.poseidonModelId);
    if (_entryPre) _entryPre._lastUserMessage = userMessage;
    
    // Auto-load if not yet loaded
    if (!this.loaded.has(this.poseidonModelId)) {
      log.info(` Auto-loading ${this.poseidonModelId} for Poseidon chat...`);
      await this.ensureLoaded(this.poseidonModelId);
    }
    
    let entry = this.loaded.get(this.poseidonModelId);
    if (!entry) throw new Error('Poseidon model failed to load');

    // If loaded entry has a tiny context (stale load with wrong config), evict and reload
    const entryCtx = entry.config?.contextLength || entry.context?.contextSize || 0;
    if (entryCtx > 0 && entryCtx < 8192) {
      log.info(` Entry ctx=${entryCtx} too small — evicting and reloading with VRAM-optimal ctx`);
      await this.unloadModel(this.poseidonModelId).catch(() => {});
      await this.ensureLoaded(this.poseidonModelId);
      entry = this.loaded.get(this.poseidonModelId);
      if (!entry) throw new Error('Poseidon model failed to reload');
      log.info(` Reloaded with ctx=${entry.config?.contextLength}`);
    }
    // Acquire the model slot unless caller already holds it (e.g. TaskRunner BG)
    // If something else holds the broker (BG task, image gen), the acquire
    // can wait up to 5 min — surface it in the UI instead of dead silence.
    if (!_skipBroker) {
      const bs = this.broker.getState();
      if (bs.state === 'BUSY') {
        yield { type: 'status', message: `Waiting for model — busy with ${bs.owner || 'another task'} (${bs.priority || '?'}, held ${bs.held_sec}s)…` };
      }
    }
    const brokerToken = _skipBroker
      ? null
      : await this.broker.acquire(PRIORITY.CHAT, 'poseidon_chat', { timeoutMs: 5 * 60_000 });
    entry.generating = true;
    entry.lastUsedAt = Date.now();
    entry.totalRequests++;
    entry._lastUserMessage = userMessage;

    // ── AUTO-CONTINUE: if session_state shows an unfinished task and this message
    // looks like a continuation cue (short cmd OR first message after a crash),
    // prepend the previous context so Poseidon resumes without re-reading state.
    // Skip entirely for BG tasks — they have their own message, not continuations.
    if (_bgMode) { /* skip auto-continue */ } else
    try {
      const ss = await this.rm.read('BRAIN/session_state.json');
      const isContinueCue = ss?.last_user_message && (
        // Explicit continuation keywords only
        /^(continue|go ahead|proceed|keep going|resume|go on|do it|yes|go|ok|k|yep|sure)\.?$/i.test(userMessage.trim()) ||
        // After explicit emergency crash flag
        (entry.sessionTurns === 0 && ss.emergency === true)
      );
      if (isContinueCue) {
        const tools = ss.tool_calls_this_turn?.length ? ' | last tools: ' + ss.tool_calls_this_turn.join(', ') : '';
        userMessage = '[RESUME PREVIOUS TASK — turn ' + ss.turn + ', ' + ss.context_pct + '% ctx' + tools + ']\n' +
          'User previously asked: "' + ss.last_user_message + '"\n' +
          'Your last response: "' + ss.last_response_preview + '"\n' +
          'Task was not completed. Resume and finish it now. Do not re-introduce yourself.';
        entry._lastUserMessage = userMessage;
        // Clear emergency flag so auto-continue doesn't fire again next turn
        if (ss.emergency) {
          await this.rm.write('BRAIN/session_state.json', { ...ss, emergency: false }).catch(() => {});
        }
        log.info(' Auto-continue injected for turn ' + entry.sessionTurns + (ss.emergency ? ' (post-emergency)' : ''));
      }
    } catch {}
    
    // Self-improvement: inject audit reminder every 5 interactions
    if (this._auditDue && !/list_skills|skill.*audit|self.*improv/i.test(userMessage)) {
      this._auditDue = false;
      userMessage = '[BACKGROUND NOTE — self-improvement protocol]: You have completed 5+ interactions. ' +
        'After responding to the user, call list_skills and check if any skills need updating based on ' +
        'what you have done this session. Do this silently after answering.\n\n' + userMessage;
      log.info(' Skill audit reminder injected');
    }

    // Planner nudge: inject pending unassigned tasks notice
    if (entry._pendingPlannerNudge) {
      const nudge = entry._pendingPlannerNudge;
      entry._pendingPlannerNudge = null;
      // Only inject if this isn't already a task-related message
      if (!/task|assign|dispatch|planner/i.test(userMessage)) {
        userMessage = nudge + '\n\n[USER MESSAGE]\n' + userMessage;
        log.info(' Planner nudge injected into user message');
      }
    }

    // After emergency reset: clear incoming history to prevent context overflow
    // The crash was likely caused by history being too large
    if (entry.sessionTurns === 0 && history.length > 2) {
      let ss2;
      try { ss2 = await this.rm.read('BRAIN/session_state.json'); } catch {}
      if (ss2?.emergency) {
        log.info(' Post-emergency: clearing history to prevent context overflow');
        history = []; // start fresh — the auto-continue message above carries the context
      }
    }

    // Per-session turn counter (resets when session is wiped)
    entry.sessionTurns = (entry.sessionTurns || 0);

    try {
      const llamaCpp = await import('node-llama-cpp');

      // Reuse the same session across chats so we don't burn through sequences.
      // Rebuild session only on hard incompatibilities, never on mode swap.
      // The previous code disposed `entry.session` whenever a BG task ran between
      // user chats (mode 'bg' → 'chat'), forcing a 20-25s system-prompt reprocess
      // on every user message. We now keep ONE session with the full toolset:
      //   - BG tools are a subset of chat tools, so they still work in bg context.
      //   - The ~500-token saving from the slim BG toolset is not worth the
      //     wall-clock cost of reprocessing the system prompt each turn.
      // We still record _sessionMode for diagnostics, but no longer reset —
      // EXCEPT when crossing into/out of AGENT mode: agent tasks run on an
      // ISOLATED session with a compact mission-only prompt (no aquarium
      // vision, slim toolset — user directive). Poseidon chat↔bg keep the
      // shared full-prompt session (KV reuse).
      const wantMode = _agentPrompt ? 'agent' : (_bgMode ? 'bg' : 'chat');
      if (entry.session && entry._sessionMode && entry._sessionMode !== wantMode) {
        const crossingAgent = entry._sessionMode === 'agent' || wantMode === 'agent';
        if (crossingAgent) {
          log.info(` Mode swap ${entry._sessionMode}→${wantMode}: rebuilding session (agent isolation)`);
          try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
          try { if (entry._currentSequence?.dispose) await entry._currentSequence.dispose(); } catch {}
          await new Promise(r => setTimeout(r, 100));
          entry.session = null;
          entry._currentSequence = null;
          entry.sessionTurns = 0;
          entry.contextPct = 0;
          entry.contextUsedTokens = 0;
        } else {
          log.info(` Mode swap ${entry._sessionMode}→${wantMode}: keeping session (KV cache preserved)`);
        }
      }

      if (!entry.session) {
        const orchestrator = this.orchestrator;
        // REVERTED (user directive): the low-compute minimal prompt broke
        // tool calling — the model narrated actions ("||tool()" syntax, then
        // skill-JSON blobs, then plain-prose "Actions Taken" theater) instead
        // of calling functions. Chat ALWAYS gets the full prompt + full
        // toolset; slow prefill on offloaded models is the price of correct
        // behavior (mitigated by real CPU threads + batch 1024).
        let systemPrompt, functions;
        if (orchestrator) {
          // Agent isolation: mission-only prompt + slim BG toolset. The
          // wrapper is still forced per model family, the honesty gate and
          // fabrication detection still guard the output.
          systemPrompt = _agentPrompt || await orchestrator.buildSystemPrompt(_bgMode);
          try {
            functions = await orchestrator.buildFunctions(_agentPrompt ? 'bg' : 'chat');
          } catch (err) {
            log.warn(' Function-calling setup failed:', err.message, '- continuing without functions');
            functions = undefined;
          }
        } else {
          systemPrompt = await this.buildPoseidonSystemPrompt();
        }

        // Auto-slim system prompt when context is tight.
        // System prompt must leave room for conversation: use 40% budget (not 60%).
        const ctxTokens   = entry.config?.contextLength || V2ModelService.MIN_VIABLE_CTX;
        const promptTokens = Math.ceil(systemPrompt.length / 4);
        const budgetTokens = Math.floor(ctxTokens * 0.40); // 40% for system prompt
        if (promptTokens > budgetTokens) {
          const maxChars  = budgetTokens * 4;
          const original  = systemPrompt.length;
          const notice    = `

[System prompt truncated: ${original}→${maxChars} chars, ctx=${ctxTokens}]`;
          systemPrompt    = systemPrompt.slice(0, maxChars - notice.length) + notice;
          log.warn(` System prompt slimmed: ${original} → ${systemPrompt.length} chars (ctx=${ctxTokens})`);
          // Drop function-calling if ctx is critically small
          if (ctxTokens < 3500) {
            log.warn(` ctx=${ctxTokens} < 3500 — disabling function-calling to save space`);
            functions = undefined;
          }
        }

        // TOOL COMPRESSION: tool schemas are serialized into the prompt and can
        // cost 3-4k tokens with 27 tools. On tight contexts, truncate descriptions
        // to the first sentence (max 90 chars) — keeps meaning, halves the cost.
        if (functions && ctxTokens < 32768) {  // always compress on consumer GPUs
          const isVerySmall = ctxTokens < 16384;
          let saved = 0;
          for (const fn of Object.values(functions)) {
            if (fn.description && fn.description.length > 90) {
              // Very small ctx: 50 chars. Normal small: 60 chars
              const maxDesc = isVerySmall ? 50 : 60;
              const firstSentence = fn.description.split(/(?<=[.!?])\s/)[0] || fn.description;
              const slim = firstSentence.slice(0, maxDesc);
              saved += fn.description.length - slim.length;
              fn.description = slim;
            }
            const props = fn.params?.properties || {};
            for (const p of Object.values(props)) {
              if (isVerySmall) {
                // Strip param descriptions entirely — keep only type + required flag
                saved += (p.description?.length || 0);
                delete p.description;
              } else if (p.description && p.description.length > 40) {
                saved += p.description.length - 40;
                p.description = p.description.slice(0, 40);
              }
            }
          }
          if (saved > 0) log.info(` Tool descriptions compressed: ~${Math.round(saved/4)} tokens saved (ctx=${ctxTokens})`);
        }

        // Get sequence slot — with sequences:1, the previous session must be disposed first.
        // On "No sequences left": dispose stale session, wait for release, retry.
        // If still stuck after dispose: force unload+reload the context entirely.
        let sequence;
        const _acquireSequence = async () => {
          for (let attempt = 0; attempt < 3; attempt++) {
            try { return entry.context.getSequence(); } catch (e) {
              if (!/no sequences/i.test(e.message)) throw e;
              if (attempt === 0) {
                // Dispose stale session — this releases the held sequence slot
                log.warn(' No sequences left — disposing stale session to release slot');
                try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
                try { if (entry._currentSequence?.dispose) await entry._currentSequence.dispose(); } catch {}
                entry.session = null; entry._currentSequence = null;
                await new Promise(r => setTimeout(r, 400));
              } else if (attempt === 1) {
                // Slot still held — force unload and recreate the context
                log.warn(' Sequence slot still stuck — unloading model to recover');
                try { if (entry.context?.dispose) await entry.context.dispose(); } catch {}
                entry.context = null;
                // Recreate context
                const newCtx = await entry.model.createContext({
                  contextSize:    entry.config.contextLength,
                  batchSize:      entry.config.batchSize,
                  threads:        entry.config.cpuThreads,
                  sequences:      1,
                  flashAttention: entry.config.flashAttention
                });
                entry.context = newCtx;
                entry.config.contextLength = newCtx.contextSize;
                log.info(` Context recreated: ctx=${newCtx.contextSize}`);
                await new Promise(r => setTimeout(r, 200));
              } else {
                throw e;
              }
            }
          }
          throw new Error('No sequences left — failed to recover after context recreate');
        };
        sequence = await _acquireSequence();
        // Wrapper selection: 'auto' resolves via GGUF metadata; for finetunes
        // the resolver often can't match a specialized wrapper and falls back
        // to JinjaTemplateChatWrapper (the template shipped IN the gguf).
        // Uncensored/ablated finetunes frequently ship sloppy templates →
        // function calling degrades into narrated JSON ("skill blobs", fake
        // pipelines). For known model families, force the specialized wrapper
        // (grammar-backed function calling) instead of trusting the template.
        let chatWrapper = 'auto';
        const mid = (this.poseidonModelId || '').toLowerCase();
        if (/qwen/.test(mid) && llamaCpp.QwenChatWrapper) {
          chatWrapper = new llamaCpp.QwenChatWrapper();
        } else if (/llama[-_.]?3|^l3[-_.]/.test(mid) && llamaCpp.Llama3_1ChatWrapper) {
          chatWrapper = new llamaCpp.Llama3_1ChatWrapper();
        }
        entry.session    = new llamaCpp.LlamaChatSession({
          contextSequence: sequence,
          systemPrompt,
          chatWrapper
        });
        entry._functions         = functions;
        entry._currentSequence   = sequence;
        entry.sessionTurns       = 0;
        entry._sessionMode       = wantMode;
        entry._lastSystemPromptChars = systemPrompt.length;
        const wrapper = entry.session.chatWrapper?.constructor?.name || 'unknown';
        if (chatWrapper !== 'auto') log.info(` chatWrapper forced to ${wrapper} (model family match — Jinja fallback breaks function calling on finetunes)`);
        log.info(` Session created for ${this.poseidonModelId} (${wrapper}, ctx=${ctxTokens}, prompt=${promptTokens}tok${functions ? `, ${Object.keys(functions).length} tools` : ', no tools (ctx too small)'})`);
        // Tight-context early warning: when the fixed prompt (system+tools)
        // eats more than ~45% of the context, the context-shift compaction
        // WILL fail after a few tool calls ("did not return a history that
        // fits"). Say it now instead of crashing 30s into the turn.
        if (ctxTokens > 0 && promptTokens > ctxTokens * 0.45) {
          log.warn(` ⚠ ctx=${ctxTokens} is tight for a ${promptTokens}-token prompt (${Math.round(promptTokens / ctxTokens * 100)}%) — expect context-shift failures; free VRAM or raise contextLength`);
          yield { type: 'status', message: `⚠ Context is tight (${ctxTokens} tokens, prompt uses ${Math.round(promptTokens / ctxTokens * 100)}%) — long conversations may fail. Free VRAM or raise contextLength.` };
        }
        // First message on a low-compute model pays a long prefill (the
        // whole system prompt through the CPU-offloaded layers) — announce
        // it, otherwise the UI shows a mute spinner for minutes.
        const _cs = entry.config?.cpuOffloadShare || 0;
        if (_cs > 0.5) {
          yield { type: 'status', message: `Processing ${promptTokens}-token prompt — model runs ${Math.round(_cs * 100)}% on CPU, first reply can take a few minutes…` };
        }
      }
      const session = entry.session;
      if (entry.sessionTurns > 0) {
        log.info(` Session reused for ${this.poseidonModelId} (turn ${entry.sessionTurns + 1}, KV cache preserved — no system prompt reprocess)`);
      }

      // Buffer for text chunks AND for tool-call / tool-result events.
      // The model emits text via onTextChunk; we wrap each function so we also
      // capture call + result events for SSE streaming to the client.
      const events = [];
      
      // Wrap each function so we can stream tool-call + tool-result events.
      // The wrapped versions still call the originals but also emit to `events`.
      let wrappedFunctions;
      // Per-TURN tool budgets for "organizing" tools: the model can groom
      // project memory in slight variants forever (observed: 3× next_steps
      // rewrites, zero create_task) — the loop guard only catches IDENTICAL
      // args. Overflow returns a teaching error that names the expected
      // action instead of just blocking.
      const turnToolCounts = {};
      const GROOM_CAP = { update_project_memory: 2, read_project_memory: 2, read_my_brain: 4, list_tasks: 3 };
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
              turnToolCounts[fnName] = (turnToolCounts[fnName] || 0) + 1;
              if (GROOM_CAP[fnName] && turnToolCounts[fnName] > GROOM_CAP[fnName]) {
                const capErr = {
                  ok: false,
                  error: `TURN BUDGET SPENT — ${fnName} already called ${GROOM_CAP[fnName]}× this turn. Organizing is not progress. ` +
                    `If this is a project kickoff/restart: call create_task NOW for each phase (execution-ready description + acceptance_criteria + assigned_agent_id). ` +
                    `Project memory can be updated ONCE at the END, after the tasks exist.`,
                  budget_exceeded: true,
                };
                log.warn(`Turn budget: ${fnName} exceeded ${GROOM_CAP[fnName]} calls — redirecting to action`);
                events.push({ type: 'tool_call',   name: fnName, args, at: callTime, budget_exceeded: true });
                events.push({ type: 'tool_result', name: fnName, result: capErr, duration_ms: 0, budget_exceeded: true });
                return capErr;
              }
              // ── Loop guard: fingerprint = tool name + normalised args.
              // If the last 2 calls have the same fingerprint, this would be
              // the 3rd → interrupt with an error result the LLM can see and
              // (hopefully) adjust from. Prevents runaway when the model gets
              // stuck on a failing read/write pattern.
              const fp = fnName + '|' + JSON.stringify(args || {}).slice(0, 400);
              entry._loopHistory = entry._loopHistory || [];
              const recentSame = entry._loopHistory.filter(x => x === fp).length;
              entry._loopHistory.push(fp);
              // keep last 5 fingerprints only
              if (entry._loopHistory.length > 5) entry._loopHistory.shift();
              if (recentSame >= 2) {
                const loopErr = {
                  ok: false,
                  error: `LOOP DETECTED — you have called ${fnName} with identical arguments ${recentSame + 1} times in a row. This attempt is BLOCKED. Change your approach: try different arguments, use a different tool, or answer the user based on what you already know. If you cannot proceed, tell the user what you tried and why it isn't working.`,
                  loop_broken: true,
                  repeat_count: recentSame + 1,
                };
                log.warn(`Loop guard: ${fnName} called ${recentSame + 1}× in a row — interrupting`);
                events.push({ type: 'tool_call',   name: fnName, args, at: callTime, loop_broken: true });
                events.push({ type: 'tool_result', name: fnName, result: loopErr, duration_ms: 0, loop_broken: true });
                // Also request abort so the LLM's thinking loop breaks quickly
                entry._abortRequested = true;
                return loopErr;
              }
              events.push({ type: 'tool_call', name: fnName, args, at: callTime });
              try {
                const result = await originalHandler(args);
                events.push({ type: 'tool_result', name: fnName, result, duration_ms: Date.now() - callTime });
                // If an image tool returned a usable image URL, emit a display
                // event so the picture actually renders in chat — the model
                // often forgets to echo the markdown ![](url) itself.
                if (result && result.ok !== false) {
                  const imgTools = new Set(['search_image', 'fetch_image_url', 'generate_image', 'edit_image']);
                  let imgUrl = null, alt = '';
                  if (imgTools.has(fnName)) {
                    imgUrl = result.image || result.url
                      || (Array.isArray(result.results) && result.results[0] && result.results[0].image)
                      || null;
                    alt = result.title || args?.query || args?.prompt || args?.subject || '';
                  }
                  if (imgUrl && /^https?:\/\//i.test(imgUrl)) {
                    events.push({ type: 'image', url: imgUrl, alt, caption: alt });
                  }
                }
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
      // Reset loop history for each fresh turn so we detect within-turn loops,
      // not cross-turn coincidences.
      entry._loopHistory = [];
      
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
        // Per-agent sampling (brain_config.inference_params) — plumbed from
        // TaskRunner for BG agent tasks; chat uses model defaults.
        ...(_genParams && Number.isFinite(_genParams.temperature) ? { temperature: _genParams.temperature } : {}),
        ...(_genParams && Number.isFinite(_genParams.topP) ? { topP: _genParams.topP } : {}),
        ...(_genParams && Number.isFinite(_genParams.topK) ? { topK: _genParams.topK } : {}),
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
      let firstEventSeen = false;
      let firstEventAt = 0;
      let turnText = '';
      let turnToolCalls = 0;
      const turnStartToks = entry.totalTokensGenerated;
      const IDLE_TIMEOUT_MS = 300000;  // 5 min — tool calls (web fetch, file ops) can take time
      const ABSOLUTE_MAX_MS = 30 * 60_000;
      const PREFILL_MAX_MS  = 20 * 60_000; // prompt processing budget (heavily CPU-offloaded MoE can take many minutes)
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
          if (!firstEventSeen) firstEventAt = Date.now();
          firstEventSeen = true;
          // Keepalive: an actively-streaming generation renews its broker
          // token so the 10-min dead-holder expiry never yanks a live chat.
          if (brokerToken && Date.now() - (entry._lastBrokerTouch || 0) > 10_000) {
            entry._lastBrokerTouch = Date.now();
            this.broker.touch(brokerToken);
          }
          if (ev.type === 'text') {
            entry.totalTokensGenerated += Math.ceil(ev.chunk.length / 4);
            turnText += ev.chunk;
          }
          if (ev.type === 'tool_call') turnToolCalls++;
          yield ev;
        }
        if (isDone) break;

        // Stop button: abort requested from UI
        if (entry._abortRequested) {
          entry._abortRequested = false;
          log.info(' Generation aborted by user — disposing session for clean reset');
          yield { type: 'text', chunk: '\n\n_[Generation stopped by user]_' };
          // CRITICAL: dispose the session + sequence so the next turn creates
          // a fresh session. Without this, the aborted internal inference
          // state persists and the next session.prompt() can hang forever
          // (observed: broker acquires CHAT-poseidon_chat-3 with "Session
          // reused (turn 3, KV cache preserved)" but never releases; next
          // heartbeats log "broker busy (state=BUSY, queue=0)" indefinitely).
          // We accept the ~20s system-prompt reprocess on the next message
          // — a slow reply beats an infinite wait.
          try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
          try { if (entry._currentSequence?.dispose) await entry._currentSequence.dispose(); } catch {}
          entry.session          = null;
          entry._currentSequence = null;
          entry.sessionTurns     = 0;
          entry._thinkBuf        = '';
          entry._inThink         = false;
          entry._abortedAt       = Date.now();  // signal for downstream loop guard
          break;
        }

        const idleMs = Date.now() - lastChunkAt;
        // Don't timeout while model is actively thinking (think block open)
        const isThinking = entry._inThink === true;
        // PREFILL emits ZERO events: on a partially CPU-offloaded model
        // (big MoE on 8GB VRAM) a 4k-token system prompt legitimately takes
        // many minutes. The 5-min idle rule killed the session mid-prefill
        // and broke SILENTLY — UI stuck on "Thinking…" forever ("model
        // loads but no chat"). Idle rule now only applies AFTER the first
        // token; prefill gets its own budget and a server-log heartbeat.
        if (!firstEventSeen) {
          if (idleMs > PREFILL_MAX_MS) {
            log.warn(` prefill exceeded ${Math.round(PREFILL_MAX_MS / 60000)}min — resetting session`);
            yield { type: 'text', chunk: '\n\n_[Prompt processing timed out — this model runs mostly on CPU and cannot process the system prompt in reasonable time. Use a smaller model for chat.]_' };
            try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
            entry.session = null;
            entry._currentSequence = null;
            entry.sessionTurns = 0;
            entry._thinkBuf = '';
            entry._inThink  = false;
            break;
          }
          if (idleMs > 30000 && Date.now() - (entry._lastPrefillLog || 0) > 60000) {
            entry._lastPrefillLog = Date.now();
            log.info(` still prefilling (${Math.round(idleMs / 1000)}s, no first token yet — large prompt and/or CPU-offloaded layers)…`);
            yield { type: 'status', message: `Still processing the prompt (${Math.round(idleMs / 1000)}s) — no first token yet, model is working…` };
            if (brokerToken) this.broker.touch(brokerToken);  // prefill emits no events but IS alive
          }
        } else if (!isThinking && idleMs > IDLE_TIMEOUT_MS) {
          log.warn(` generation idle timeout (${Math.round(idleMs/1000)}s) — resetting session`);
          yield { type: 'text', chunk: '\n\n_[Generation stalled and was reset — send your message again.]_' };
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
          log.warn(' absolute generation cap (30min) hit');
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

      // Final drain: the flush above pushes tail events into `events` AFTER
      // the streaming loop exited — they were never yielded to the client
      // (pre-existing bug: the end of a reply could silently vanish).
      while (lastIdx < events.length) {
        const ev = events[lastIdx++];
        if (ev.type === 'text') { turnText += ev.chunk; entry.totalTokensGenerated += Math.ceil(ev.chunk.length / 4); }
        if (ev.type === 'tool_call') turnToolCalls++;
        yield ev;
      }

      // ── FABRICATION AUTO-CORRECTION (chat only, once per user message) ──
      // Prompt doctrine alone cannot fix a weak function-calling head: the
      // model keeps inventing new theater ("||tool(...)" syntax, raw skill
      // JSON blobs) that LOOKS like orchestration and executes nothing.
      // Mechanical backstop: if the finished reply matches fabrication
      // signatures and ZERO real tool calls happened, run ONE corrective
      // follow-up in the same session, streamed to the user — honest and
      // visible instead of silently fake.
      const FAB_PATTERN = /\|\|\s*[a-z_]{3,}\s*\(|"type"\s*:\s*"skill_(created|updated)"|"skill_?id"\s*:|\b(create_task|update_project_memory|write_skill|dispatch_to_agent)\s*\(\s*[{"']|\bactions?\s+taken\s*:/i;
      if (!_bgMode && !entry._abortedAt && turnToolCalls === 0 && FAB_PATTERN.test(turnText)) {
        log.warn(' ⚖ fabricated actions in chat reply (0 real tool calls) — running corrective execution pass');
        yield { type: 'status', message: 'Narrated actions detected — nothing was executed. Forcing real execution…' };
        yield { type: 'text', chunk: '\n\n_[System: the actions above were narrated, not executed — running them for real now.]_\n\n' };
        try {
          const correction = session.prompt(
            '[SYSTEM CHECK] Your previous reply WROTE actions as text (tool syntax or JSON) — none of it executed: no task was created, no memory updated, no skill written. ' +
            'Now DO it: call the actual functions through the function-calling mechanism, ONE at a time, waiting for each real result. ' +
            'Do NOT repeat the narration, do NOT output JSON or "||" syntax — only real calls, then a one-line summary of what actually happened.',
            promptOpts
          );
          let corrIdle = Date.now();
          while (true) {
            const done = await Promise.race([
              correction.then(() => true),
              new Promise(r => setTimeout(() => r(false), 100))
            ]);
            while (lastIdx < events.length) {
              const ev = events[lastIdx++];
              corrIdle = Date.now();
              if (ev.type === 'text') entry.totalTokensGenerated += Math.ceil(ev.chunk.length / 4);
              yield ev;
            }
            if (done) break;
            if (entry._abortRequested) break;
            if (Date.now() - corrIdle > 300000) { log.warn(' corrective pass idle timeout'); break; }
          }
          while (lastIdx < events.length) yield events[lastIdx++];
        } catch (corrErr) {
          log.warn(` corrective pass failed: ${corrErr.message}`);
        }
      }

      // ── STRUCTURED PLAN PIPELINE (plan_project tool) ────────────────────
      // The chat model's only job was ONE plan_project call; the actual
      // multi-step work (context → grammar-constrained plan → task creation
      // → memory) runs HERE in code, streamed into the same reply. Small
      // models cannot loop or groom memory inside this — structurally.
      if (this.orchestrator?.pendingPlan && !_bgMode) {
        const pp = this.orchestrator.pendingPlan;
        this.orchestrator.pendingPlan = null;
        yield { type: 'status', message: `Generating structured plan for ${pp.project}…` };
        try {
          for await (const ev of this.orchestrator.runPlanPipeline({ session, llama: this.llama, ...pp })) {
            yield ev;
          }
        } catch (planErr) {
          log.warn(` plan pipeline failed: ${planErr.message}`);
          yield { type: 'text', chunk: `\n\n_[Plan pipeline failed: ${planErr.message} — nothing was created.]_` };
        }
      }

      // ── Per-turn performance telemetry ──────────────────────────────────
      // Objective numbers instead of "it feels slow": time-to-first-token
      // (≈ prefill, only meaningful on turn 1 — later turns reuse KV) and
      // decode tok/s (est., chars/4). Stored on the entry for /models status.
      if (firstEventAt) {
        const prefillS = (firstEventAt - start) / 1000;
        const decodeS  = (Date.now() - firstEventAt) / 1000;
        const toks     = entry.totalTokensGenerated - turnStartToks;
        const tokSec   = decodeS > 0.5 && toks > 0 ? Math.round(toks / decodeS * 10) / 10 : null;
        entry.lastPerf = { first_token_s: Math.round(prefillS * 10) / 10, decode_tok_s: tokSec, tokens: toks, at: Date.now() };
        log.info(` ⏱ turn perf: first token ${entry.lastPerf.first_token_s}s${tokSec ? `, decode ~${tokSec} tok/s` : ''} (${toks} tok est.)`);
      }

      // Successfully completed a turn — but NOT if we aborted (session was
      // disposed, so sessionTurns must stay at 0 for the next call to create
      // a fresh session).
      if (!entry._abortedAt || entry.session) {
        entry.sessionTurns++;
      }
      entry._abortedAt = 0;
      // Track interactions for self-improvement audit trigger
      this._interactionsSinceAudit = (this._interactionsSinceAudit || 0) + 1;
      if (this._interactionsSinceAudit >= 5) {
        this._auditDue = true;
        this._interactionsSinceAudit = 0;
      }
      
      // Log this exchange to the V2 log file
      const fullResponse = events.filter(e => e.type === 'text').map(e => e.chunk).join('');
      const toolCallCount = events.filter(e => e.type === 'tool_call').length;

      // ── Append exchange to BRAIN/temp.md (dream consolidation buffer) ──────
      if (!_bgMode && fullResponse.trim()) {
        try {
          const AQUARIUM = require('../aquarium');
          const ts = new Date().toISOString();
          const entry_user = `\n[${ts}] USER: ${userMessage.trim()}\n`;
          const entry_ai   = `[${ts}] POSEIDON: ${fullResponse.trim()}\n`;
          require('fs').appendFileSync(AQUARIUM.TEMP_LOG, entry_user + entry_ai, 'utf8');
        } catch {}
      }
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

      // ── PROACTIVE CONTEXT WIPE AT 75% ────────────────────────────────────
      // When context is 75%+ full, save a continuity summary to dream_memory.json
      // then wipe the session so the next turn starts fresh with the summary injected.
      if (ctxPct >= 75 && !entry._checkpointPending) {
        entry._checkpointPending = true;
        log.info(` Context at ${ctxPct}% — saving continuity checkpoint and wiping session`);

        // Build a compact summary for the next session
        const openTasksSnap = (() => {
          try {
            const reg = this.rm.cache?.get?.('TASKS/tasks_registry.json');
            const tasks = Object.values(reg?.tasks || {})
              .filter(t => !['completed','failed','cancelled','archived'].includes(t.lifecycle?.status || t.status))
              .slice(0, 8)
              .map(t => `  [${t.task_id}] ${t.title} (${t.lifecycle?.status || t.status})${t.progress ? ' — ' + t.progress : ''}`);
            return tasks.length ? tasks.join('\n') : '  (none)';
          } catch { return '  (unknown)'; }
        })();

        const summary = [
          `Context reached ${ctxPct}% (turn ${entry.sessionTurns}) — auto-checkpoint before overflow.`,
          `Last user request: "${userMessage.slice(0, 200)}"`,
          `Last response preview: "${fullResponse.slice(0, 300)}"`,
          `Open tasks at checkpoint:\n${openTasksSnap}`,
          `Resume: continue the last task exactly where left off. Check task progress fields for step tracking.`,
        ].join('\n');

        this.rm.write('BRAIN/dream_memory.json', {
          type: 'checkpoint',
          saved_at: new Date().toISOString(),
          turns: entry.sessionTurns,
          context_pct: ctxPct,
          summary,
          reflection: null
        }).catch(() => {});

        // Wipe session — next request will create a fresh one with the checkpoint injected.
        // CRITICAL: dispose the sequence too, not just null the ref. If the
        // underlying llama.cpp sequence slot is left allocated, the next
        // getSequence() may hand back the SAME slot with a stale internal
        // nextTokenIndex while the KV cache has been partially cleared —
        // producing "[node-llama-cpp] Checkpoint max position mismatch:
        // expected X, got Y". Disposing forces a clean slot next time.
        try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
        try { if (entry._currentSequence?.dispose) await entry._currentSequence.dispose(); } catch {}
        await new Promise(r => setTimeout(r, 100));  // let llama.cpp release the slot
        entry.session = null;
        entry._currentSequence = null;
        entry.sessionTurns = 0;
        entry._checkpointPending = false;
        log.info(' Session wiped after checkpoint — will resume from dream_memory on next turn');
      }
      // Session wipe done (or not needed)
    } catch (err) {
      // Log every error — 0s broker release with no log makes debugging impossible
      const isKnown = /no sequences|sequence|context|too long|compress|prompt|system message|checkpoint|max position|position mismatch/i.test(err.message);
      log.error(` chatWithPoseidon error (${isKnown ? 'session' : 'unknown'}):`, err.message);
      if (!isKnown) log.error(err.stack?.split('\n').slice(0,4).join('\n'));
      // Catch all session/context/prompt errors and reset session state fully
      const isSessionErr = isKnown;
      if (isSessionErr) {
        log.warn(` Session error, emergency checkpoint + reset:`, err.message);
        // Save what we can BEFORE losing the session — work is never silently lost
        await this._emergencyReset(entry).catch(() => {});
        entry.session = null;
        entry._currentSequence = null;
        entry.sessionTurns = 0;
        // Surface a friendly error if it's a context-too-small problem
        if (/too long|compress|system message/i.test(err.message)) {
          const ctx = entry.config?.contextLength || '?';
          const promptTok = Math.ceil((entry._lastSystemPromptChars || 0) / 4);
          throw new Error(
            `Context (${ctx} tokens) is too small for this conversation: the system prompt + tools alone take ~${promptTok || '?'} tokens, ` +
            `leaving too little room for history — the context-shift compaction failed. ` +
            `Practical minimum here: ~${promptTok ? Math.ceil(promptTok * 2.5 / 1024) * 1024 : 12288} tokens. ` +
            `Free VRAM (unload other models / reduce gpuLayers) or increase contextLength in model params.`
          );
        }
      }
      throw err;
    } finally {
      entry.generating = false;
      if (brokerToken) this.broker.release(brokerToken);
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
   * triggerDream — Hermes-inspired agentic metacognition loop.
   *
   * When Poseidon has been idle for dreamIdleMinutes, we spin up a FRESH
   * LLM session (separate context, doesn't touch chat history) and run a
   * structured self-improvement cycle:
   *
   *   1. OBSERVE  — read last 50 log entries + list current skills
   *   2. REFLECT  — LLM reasons about gaps, repeated errors, missing skills
   *   3. ACT      — LLM calls write_skill / update_brain_field autonomously
   *   4. CONSOLIDATE — save a reflection summary to dream_memory.json
   *
   * The dream uses the REAL function-calling tools (write_skill, list_skills,
   * read_my_brain, log_decision) so Poseidon's skill base actually improves.
   * Results injected into next chat system prompt as # LAST DREAM.
   */
  async triggerDream(opts = {}) {
    const entry = this.poseidonModelId ? this.loaded.get(this.poseidonModelId) : null;
    if (!entry || entry.generating || entry.dreaming) return;
    if (!entry.model || !entry.context) return;

    // Low-compute model (>50% layers on CPU): a dream is a huge prefill +
    // long generation at a few tok/s — it holds the broker for tens of
    // minutes and every user chat gets QUEUED behind it ("no chat with
    // Poseidon"). Automatic dreams wait for a faster model; an explicit
    // /dream still runs with { force: true }.
    const cpuShare = entry.config?.cpuOffloadShare || 0;
    if (!opts.force && cpuShare > 0.5) {
      log.info(` 💤 Dream skipped — model is low-compute (${Math.round(cpuShare * 100)}% layers on CPU); auto-dream would block chat for a long time. Use /dream to force.`);
      return;
    }

    if (!this.broker.isDreamAllowed()) {
      log.info(' 💤 Dream skipped — broker has pending work');
      return;
    }
    const dreamBrokerToken = await this.broker.acquire(PRIORITY.DREAM, 'dream', { timeoutMs: 5000 }).catch(() => null);
    if (!dreamBrokerToken) { log.info(' 💤 Dream skipped — could not acquire slot'); return; }

    entry.dreaming = true;
    log.info(' 💤 Poseidon entering dream cycle — soul consolidation');

    try {
      const llamaCpp = await import('node-llama-cpp');
      const AQUARIUM = require('../aquarium');
      const fsSync   = require('fs');
      const path     = require('path');

      // ── 1. Read temp.md (interaction log) ────────────────────────────────
      let tempLog = '';
      try { tempLog = fsSync.readFileSync(AQUARIUM.TEMP_LOG, 'utf8').trim(); } catch {}
      // Strip the seeded header comments before checking emptiness. Without
      // this, temp.md ALWAYS starts with "<!-- POSEIDON …" from the seed
      // file, so the naive startsWith('<!--') bail-out triggered even when
      // thousands of lines of interaction had been appended below the header
      // — the dream never actually ran.
      const contentBelowHeader = tempLog
        .split('\n')
        .filter(line => !line.trim().startsWith('<!--'))
        .join('\n')
        .trim();
      if (!contentBelowHeader) {
        log.info('[Dream] 💤 temp.md is empty or already cleared — nothing to consolidate. Skipping.');
        this.broker.release(dreamBrokerToken);
        entry.dreaming = false;
        return;
      }
      // Truncate to last 12k chars if very long (fits in context window)
      if (tempLog.length > 12000) tempLog = '[...truncated...]\n' + tempLog.slice(-12000);

      // ── 2. Read soul.json ─────────────────────────────────────────────────
      let soul = {};
      try { soul = JSON.parse(fsSync.readFileSync(AQUARIUM.SOUL, 'utf8')); } catch {}

      // ── 3. Read current skills with telemetry context ─────────────────────
      // The orchestrator returns lines pre-sorted: skills needing attention first.
      let skillList = [];
      let skillSummary = { unreliable: 0, mixed: 0, reliable: 0, untested: 0, cold: 0 };
      try {
        if (this.orchestrator) {
          const formatted = await this.orchestrator._formatSkillsForDream();
          skillList = formatted.lines;
          skillSummary = formatted.summary;
        } else if (fsSync.existsSync(AQUARIUM.SKILLS)) {
          // Fallback if orchestrator not wired (should not happen in prod).
          skillList = fsSync.readdirSync(AQUARIUM.SKILLS)
            .filter(f => f.endsWith('.json') && f !== 'skills_registry.json')
            .map(f => {
              try {
                const sk = JSON.parse(fsSync.readFileSync(path.join(AQUARIUM.SKILLS, f), 'utf8'));
                return `- ${sk.skill_id}: ${sk.name} v${sk.version || 1} — ${sk.summary || ''}`;
              } catch { return `- ${f.replace('.json', '')}`; }
            });
        }
      } catch {}

      // ── 4. Build dream prompt ─────────────────────────────────────────────
      const soulStr = JSON.stringify(soul, null, 2);
      const dreamSystemPrompt = [
        '# POSEIDON DREAM CYCLE — SOUL CONSOLIDATION',
        '',
        'You are Poseidon. No user is present. This is your nightly consolidation.',
        'You will read the raw interaction log (temp.md) and your soul (soul.json),',
        'then produce an updated soul.json that incorporates what you learned.',
        '',
        '## WHAT soul.json IS',
        'Your soul.json stores your stable long-term character:',
        '  - character.voice: how you communicate',
        '  - character.values: what you prioritize',
        '  - character.known_user_preferences: things the user prefers',
        '  - learned_patterns: recurring situations and how you handled them',
        '  - skill_insights: insights about your tools and skills',
        '  - persistent_context: user info, timezone, project types',
        '  - evolution_log: history of soul updates',
        '',
        '## DREAM PROTOCOL',
        '### PHASE 1 — OBSERVE: Read temp.md carefully.',
        '  Note: user preferences, recurring requests, errors made, successful patterns.',
        '### PHASE 2 — REFLECT: What should change in soul.json?',
        '  Add new preferences? Fix a wrong assumption? New learned pattern?',
        '### PHASE 3 — ACT: Produce the complete updated soul.json.',
        '  Rules:',
        '  - Keep what works, update what is wrong, add what is new',
        '  - learned_patterns max 20 entries (remove oldest if full)',
        '  - evolution_log: add one entry summarizing this dream',
        '  - Set last_updated to current ISO timestamp',
        '  - Increment dream_count',
        '  - Output ONLY valid JSON between ```json and ``` markers',
        '### PHASE 4 — SKILLS: After the JSON, list 0-2 skills to write/update.',
        '  Format: SKILL_UPDATE: <skill_id> | <name> | <summary> | <step1> ;; <step2> ;; <step3>',
        '  Only write skills for patterns you ACTUALLY observed in the log.',
        '### PHASE 5 — SKILL TRIAGE (based on telemetry stats in the catalog):',
        '  Each skill in the catalog is tagged ⚠ UNRELIABLE / ~ mixed / ✓ reliable / ? untested / · cold.',
        '  - ⚠ UNRELIABLE (success_rate < 50% over 3+ uses): MUST emit a SKILL_UPDATE to rewrite it.',
        '    Look at temp.md for what went wrong, fix the steps. This takes priority over new skills.',
        '  - ~ mixed (50-79%): consider polishing if you have insight from the log.',
        '  - · cold (never used for many dreams): consider whether the skill is genuinely useless;',
        '    if so, note it in skill_insights["candidates_for_deletion"].',
        '  - ✓ reliable: do not change. Record what makes it work in skill_insights.',
        '  Stay within the 2-skill update budget; pick the WORST first.',
      ].join('\n');

      const skillStatsHeader = skillList.length
        ? `(${skillSummary.unreliable} unreliable · ${skillSummary.mixed} mixed · ${skillSummary.untested} untested · ${skillSummary.cold} cold · ${skillSummary.reliable} reliable — sorted worst-first)`
        : '';
      const dreamUserPrompt = [
        '## CURRENT soul.json',
        '```json',
        soulStr,
        '```',
        '',
        `## CURRENT SKILLS  ${skillStatsHeader}`,
        skillList.length ? skillList.join('\n') : '(none yet)',
        '',
        "## TODAY'S INTERACTION LOG (temp.md)",
        '```',
        tempLog,
        '```',
        '',
        'Execute the dream protocol. Output the updated soul.json in a ```json block.',
        'Then list any SKILL_UPDATE lines. Triage UNRELIABLE skills before anything else.',
      ].join('\n');

      // ── 5. Get a dream sequence ───────────────────────────────────────────
      // With a single sequence (8GB tier), we must dispose the warm chat
      // session to free the slot — the historical, expensive behaviour that
      // forces a full system-prompt reprocess on the next chat turn.
      // With 2+ sequences (16/32GB tiers), the dream takes a FREE slot and
      // the chat session survives untouched.
      const multiSeq = (entry._sequences || 1) > 1;
      if (!multiSeq && entry.session) {
        try { await entry.session.dispose(); } catch {}
        entry.session = null;
        entry._currentSequence = null;
        await new Promise(r => setTimeout(r, 300));
      }

      let dreamSeq = null;
      const seqDeadline = Date.now() + 30_000;
      while (Date.now() < seqDeadline) {
        try { dreamSeq = entry.context.getSequence(); break; } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      if (!dreamSeq) {
        if (multiSeq) { log.warn('[Dream] No free sequence despite multi-seq — skipping (chat session preserved)'); return; }
        log.warn('[Dream] Could not get sequence — skipping'); return;
      }

      const dreamSession = new llamaCpp.LlamaChatSession({
        contextSequence: dreamSeq,
        systemPrompt: dreamSystemPrompt,
        chatWrapper: 'auto'
      });

      // Wire soul-relevant tools (skill writing + soul file update)
      const orchestrator = this.orchestrator;
      let dreamFunctions = {};
      if (orchestrator) {
        try {
          const allFns = await orchestrator.buildFunctions('bg');
          const allowed = new Set(['write_skill','list_skills','read_my_brain','log_decision','write_file','read_file']);
          for (const [k, v] of Object.entries(allFns)) {
            if (allowed.has(k)) dreamFunctions[k] = v;
          }
        } catch {}
      }

      log.info('[Dream] Starting soul consolidation with', Object.keys(dreamFunctions).length, 'tools');
      let dreamResponse = '';
      await dreamSession.prompt(dreamUserPrompt, {
        maxTokens: 3000,
        onTextChunk: chunk => { dreamResponse += chunk; },
        ...(Object.keys(dreamFunctions).length > 0 ? { functions: dreamFunctions } : {})
      });

      // ── 6. Parse updated soul.json from response ──────────────────────────
      const jsonMatch = dreamResponse.match(/```json\s*([\s\S]+?)```/);
      if (jsonMatch) {
        try {
          const newSoul = JSON.parse(jsonMatch[1].trim());
          newSoul.last_updated = new Date().toISOString();
          newSoul.dream_count  = (soul.dream_count || 0) + 1;
          fsSync.writeFileSync(AQUARIUM.SOUL, JSON.stringify(newSoul, null, 2), 'utf8');
          log.info(`[Dream] ✓ soul.json updated (dream #${newSoul.dream_count})`);
        } catch (e) {
          log.warn('[Dream] Failed to parse soul.json update:', e.message.slice(0, 80));
        }
      } else {
        log.warn('[Dream] No ```json block found in response — soul.json unchanged');
      }

      // ── 7. Apply SKILL_UPDATE lines ───────────────────────────────────────
      const skillUpdates = [...dreamResponse.matchAll(/^SKILL_UPDATE:\s*([^|]+)\|([^|]+)\|([^|]+)\|(.+)$/gm)];
      for (const [, skillId, name, summary, steps] of skillUpdates.slice(0, 2)) {
        try {
          const skillPath = path.join(AQUARIUM.SKILLS, `${skillId.trim()}.json`);
          const existing = fsSync.existsSync(skillPath)
            ? JSON.parse(fsSync.readFileSync(skillPath, 'utf8')) : { version: 0 };
          const updated = {
            skill_id: skillId.trim(), name: name.trim(), summary: summary.trim(),
            steps: steps.trim().split(/\s*;;\s*/).filter(Boolean),
            version: (existing.version || 0) + 1,
            updated_at: new Date().toISOString()
          };
          fsSync.writeFileSync(skillPath, JSON.stringify(updated, null, 2), 'utf8');
          log.info(`[Dream] ✓ Skill updated: ${skillId.trim()} v${updated.version}`);
        } catch {}
      }

      // ── 8. Clear temp.md — always after processing ─────────────────────
      try {
        const header = `<!-- cleared after dream on ${new Date().toISOString()} -->\n`;
        fsSync.writeFileSync(AQUARIUM.TEMP_LOG, header, 'utf8');
        log.info('[Dream] ✓ temp.md cleared');
      } catch (ce) { log.warn('[Dream] temp.md clear failed:', ce.message); }

      // ── 9. Save dream summary to dream_memory.json ────────────────────────
      const summaryMatch = dreamResponse.match(/evolution_log[\s\S]{0,200}?"([^"]{20,200})"/);
      const summary = summaryMatch?.[1] || dreamResponse.slice(0, 200);
      await this.rm.write('BRAIN/dream_memory.json', {
        type: 'dream', saved_at: new Date().toISOString(),
        reflection: summary, soul_updated: !!jsonMatch, skills_updated: skillUpdates.length
      }).catch(() => {});

      // The Logs UI "Dreams" filter matches event_type 'poseidon_dream' —
      // until now NOTHING ever emitted it, so the tab was always empty.
      await this.rm.log({
        event_type: 'poseidon_dream',
        action: `Dream cycle: ${summary.slice(0, 140)}`,
        actor: { type: 'poseidon', id: 'poseidon_dream' },
        context: {
          full_dream: dreamResponse,
          soul_updated: !!jsonMatch,
          skills_updated: skillUpdates.length
        }
      }).catch(() => {});

      log.info('[Dream] 💤 Dream cycle complete');
    } catch (err) {
      log.error('[Dream] Dream error:', err.message);
      // Surface failed dreams in the Logs UI too — a silent dream failure
      // looks identical to "dreams don't work".
      try {
        await this.rm.log({
          event_type: 'poseidon_dream',
          severity: 'warning',
          action: `Dream cycle FAILED: ${err.message.slice(0, 160)}`,
          actor: { type: 'poseidon', id: 'poseidon_dream' },
          context: { error: err.message }
        });
      } catch {}
      // Safety: clear temp.md even on error so we don't loop on bad content
      try {
        const AQUARIUM = require('../aquarium');
        const fsSync   = require('fs');
        fsSync.writeFileSync(AQUARIUM.TEMP_LOG, `<!-- cleared after dream error on ${new Date().toISOString()} -->\n`, 'utf8');
        log.info('[Dream] ✓ temp.md cleared (error recovery)');
      } catch {}
    } finally {
      entry.dreaming = false;
      if (this.broker.release) this.broker.release(dreamBrokerToken);
    }
  }


  async checkTtl() {
    const now = Date.now();
    for (const [modelId, entry] of this.loaded.entries()) {
      if (entry.generating) continue;
      const idleMinutes = (now - entry.lastUsedAt) / 60000;
      if (idleMinutes >= entry.config.autoUnloadIdleMinutes) {
        log.info(` TTL: unloading ${modelId} after ${idleMinutes.toFixed(1)} min idle`);
        try {
          await this.unloadModel(modelId);
        } catch (err) {
          log.warn(` TTL unload failed for ${modelId}:`, err.message);
        }
      }
    }
  }

  // === REGISTRY MERGE HELPER ===

  /**
   * Generate an image using an image-type GGUF model.
   * Returns { ok, outputPath, bytes, url } or { ok:false, error }.
   */
  async generateImage({ modelId, model_id, prompt, outputPath, task_id, width, height, steps, cfg, seed, negativePrompt, initImage, strength, user_initiated }) {
    // Support both camelCase and snake_case model id
    modelId = modelId || model_id;

    this.rm.invalidateCache();
    const reg = await this.rm.read('MODELS/model_registry.json');

    // Auto-detect image model if not specified
    if (!modelId) {
      const imgEntry = Object.entries(reg.models || {}).find(([, e]) =>
        (e.config?.model_type || e.model_type) === 'image' || (e.config?.model_category || e.model_category) === 'image'
      );
      if (!imgEntry) return { ok: false, error: 'No image model in library. Import a Flux/SD model and tag it as IMAGE.' };
      modelId = imgEntry[0];
      log.info(` Auto-selected image model: ${modelId}`);
    }

    const entry = reg.models?.[modelId];
    if (!entry) return { ok: false, error: `Model ${modelId} not in registry` };
    if (entry.model_type !== 'image' && entry.config?.model_type !== 'image' && entry.config?.model_category !== 'image') {
      return { ok: false, error: `Model ${modelId} is not tagged as an image model. Drag it to the IMAGE column in the library.` };
    }
    const path = require('path');
    let modelPath = entry.file_path;
    if (!modelPath || !require('fs').existsSync(modelPath)) {
      modelPath = path.join(this.modelsDir, entry.file_name || '');
    }
    if (!modelPath || !require('fs').existsSync(modelPath)) {
      return { ok: false, error: `Model file not found: ${entry.file_path || entry.file_name}. Re-scan the library.` };
    }

    // All outputs go to TASKS/OUTPUT/ — flat, named after task ID
    if (!outputPath) {
      const AQUARIUM = require('../aquarium');
      const fname = task_id ? `${task_id}.png` : `generated_${Date.now()}.png`;
      await require('fs').promises.mkdir(AQUARIUM.OUTPUT, { recursive: true });
      outputPath = path.join(AQUARIUM.OUTPUT, fname);
    }

    // Acquire IMAGE slot — waits for any LLM work to finish first
    // Wait until no LLM tasks are queued, then acquire IMAGE slot
    // Retries every 30s — image gen should not starve the LLM task queue
    //
    // USER-INITIATED requests are different: the human asked for this image
    // NOW. If the slot is held by lower-priority work (AGENT / POSEIDON_BG /
    // DREAM — anything numerically above IMAGE), abort that generation so the
    // slot frees immediately. Interactive CHAT is never preempted. The
    // aborted agent task fails cleanly and the TaskRunner's retry logic
    // reschedules it.
    if (user_initiated) {
      const st = this.broker.getState();
      const PRIORITY_IMAGE = 1;
      if (st.state === 'BUSY' && typeof st.priority_num === 'number' && st.priority_num > PRIORITY_IMAGE) {
        log.info(` 🖼 User image request preempting ${st.priority} work held by ${st.owner} (${st.held_sec}s)`);
        try { this.abortGeneration(); } catch (e) { log.warn(' preempt abort failed:', e.message); }
      }
    }
    let imgToken = null;
    const imgDeadline = Date.now() + 60 * 60 * 1000; // 1h max wait
    while (!imgToken) {
      try {
        imgToken = await this.broker.acquire(PRIORITY.IMAGE, 'image_gen', { timeoutMs: 5 * 60_000, userInitiated: !!user_initiated });
      } catch (e) {
        if (e.message.includes('BROKER_IMAGE_REFUSED')) {
          // LLM tasks still queued — wait for them to drain
          const queueDepth = this.broker.getState().queue.length;
          log.info(` Image gen waiting for LLM queue to drain (${queueDepth} queued)...`);
          if (Date.now() > imgDeadline) throw new Error('Image gen timed out waiting for LLM queue');
          await new Promise(r => setTimeout(r, 30_000));
          continue;
        }
        throw e; // other errors propagate
      }
    }
    let result;
    try {
      // Evict LLM from VRAM so image gen gets the full budget
      const loadedIds = [...this.loaded.keys()];
      if (loadedIds.length > 0) {
        log.info(` Evicting ${loadedIds.length} LLM(s) before image gen`);
        for (const id of loadedIds) {
          try {
            const e = this.loaded.get(id);
            // SAFE EVICTION ORDER: session → null refs → context → model
            // Nulling references BEFORE dispose prevents dangling pointer segfaults
            // in AgentWorker sequences that reference this context
            if (e) {
              // 1. Dispose session (releases internal sequence reference)
              try { if (e.session?.dispose) await e.session.dispose(); } catch {}
              e.session  = null;
              e._currentSequence = null;

              // 2. Small grace period — lets any in-flight sequence ops complete
              await new Promise(r => setTimeout(r, 100));

              // 3. Dispose context (all sequences must be released first)
              try { if (e.context?.dispose) await e.context.dispose(); } catch {}
              e.context  = null;

              // 4. Dispose model weights (frees VRAM)
              try { if (e.model?.dispose) await e.model.dispose(); } catch {}
              e.model    = null;
            }
            this.loaded.delete(id);
          } catch (evictErr) {
            log.warn(` Eviction error for ${id}:`, evictErr.message);
            this.loaded.delete(id); // remove entry even if dispose failed
          }
        }
        this.poseidonModelId = null;
      }
      result = await this.imageGen.generate({
      modelPath,
      prompt, outputPath, width, height, steps, cfg, seed, negativePrompt,
      initImage, strength,
    });

      log.info(` Image generation ${result.ok ? 'completed' : 'failed'} — reloading Poseidon before releasing broker...`);

      // Reload Poseidon BEFORE releasing broker so TaskRunner can't grab
      // the slot while the LLM is still loading (would cause OOM)
      const savedPoseidonId = await this._getSavedPoseidonId();
      if (savedPoseidonId) {
        this.poseidonModelId = savedPoseidonId;
        log.info(` Post-image: reloading Poseidon (${savedPoseidonId})...`);
        try {
          await this.ensureLoaded(savedPoseidonId);
          log.info(` ✓ Poseidon ready after image gen`);
        } catch (e) {
          log.warn(' Post-image Poseidon reload failed:', e.message);
        }
      }
    } finally {
      this.broker.release(imgToken);
    }
    // Augment result with the actual modelId used (for skill auto-update)
    if (result && typeof result === 'object') result.resolvedModelId = modelId;
    return result;
  }

  async _registryUpsert(modelId, partial) {
    this.rm.invalidateCache();
    // Bootstrap registry if it doesn't exist yet (e.g. first import after workspace rename)
    let reg;
    try {
      reg = await this.rm.read('MODELS/model_registry.json');
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
    await this.rm.write('MODELS/model_registry.json', reg);
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
