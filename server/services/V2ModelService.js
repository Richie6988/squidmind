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
const fs = require('fs').promises;
const fsSync = require('fs');

class V2ModelService {
  constructor(registryManager, modelsDir) {
    this.rm = registryManager;
    this.modelsDir = modelsDir;
    this.llama = null;                       // node-llama-cpp instance (singleton)
    this.loaded = new Map();                 // model_id -> { model, context, session, config, lastUsedAt, generating }
    this.poseidonModelId = null;             // currently assigned to Poseidon
    this._libPromise = null;
    this.contextWipeThreshold = 5;           // wipe Poseidon session after N exchanges
    this.orchestrator = null;                // wired in by index.js after construction
  }
  
  /**
   * Set the orchestrator (called once at startup). Provides Poseidon's
   * system prompt + function-calling tools.
   */
  setOrchestrator(orchestrator) {
    this.orchestrator = orchestrator;
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
      items.push({
        model_id: file.model_id,
        file_name: file.file_name,
        file_path: file.file_path,
        file_size_gb: file.file_size_gb,
        format: 'gguf',
        imported: !!regEntry,
        config: regEntry?.config || null,
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
        items.push({
          model_id: id,
          file_name: entry.file_name,
          file_path: entry.file_path,
          file_size_gb: entry.file_size_gb,
          format: 'gguf',
          imported: true,
          config: entry.config,
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
    
    await this._registryUpsert(modelId, {
      file_name: path.basename(fileName),
      file_path: fullPath,
      file_size_gb: Math.round((stat.size / (1024 ** 3)) * 100) / 100,
      format: 'gguf',
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
    
    this.rm.invalidateCache();
    const reg = await this.rm.read('models/model_registry.json');
    const entry = reg.models[modelId];
    if (!entry) throw new Error(`Model ${modelId} not in library. Import it first.`);
    if (entry.status === 'missing') throw new Error(`Model file is missing: ${entry.file_path}`);
    
    // Use stored config
    return await this.loadModel(entry.file_name, entry.config || {});
  }

  // === LOAD ===

  /**
   * Load a GGUF model with the user's exact settings.
   * 
   * @param {string} fileName - just the filename in models dir, e.g. 'kwen3.5-9B.gguf'
   * @param {object} cfg - { contextLength, gpuLayers, cpuThreads, batchSize, offloadKqvToGpu, randomSeed, autoUnloadIdleMinutes }
   * @returns {object} status
   */
  async loadModel(fileName, cfg = {}) {
    const config = {
      // contextLength: 'auto' lets node-llama-cpp pick the max that fits VRAM
      // (LM Studio-style). User can override with a number.
      contextLength: cfg.contextLength ?? 'auto',
      // gpuLayers: 'auto' = fit as many in VRAM as possible, considering ctx size.
      // 'max' = all layers (errors if not enough VRAM).
      // number = force exact count.
      gpuLayers: cfg.gpuLayers ?? 'auto',
      cpuThreads: cfg.cpuThreads ?? 4,
      batchSize: cfg.batchSize ?? 512,
      // Flash attention: ~50% smaller KV cache. The single biggest VRAM saver.
      flashAttention: cfg.flashAttention ?? true,
      // mmap: lets the OS page the model file directly - faster load, shared RAM
      useMmap: cfg.useMmap ?? true,
      // Mlock: force keep in VRAM (LM Studio "Keep Model in Memory")
      useMlock: cfg.useMlock ?? false,
      randomSeed: cfg.randomSeed ?? true,
      autoUnloadIdleMinutes: cfg.autoUnloadIdleMinutes ?? 15
    };

    const modelId = this._fileNameToId(fileName);

    // Already loaded?
    if (this.loaded.has(modelId)) {
      return { success: true, alreadyLoaded: true, model_id: modelId };
    }

    // Resolve path
    const fullPath = path.isAbsolute(fileName) ? fileName : path.join(this.modelsDir, fileName);
    if (!fsSync.existsSync(fullPath)) {
      throw new Error(`Model file not found: ${fullPath}`);
    }
    const stat = await fs.stat(fullPath);
    const fileSizeGb = Math.round((stat.size / (1024 ** 3)) * 100) / 100;

    // Mark in registry as 'loading'
    await this._registryUpsert(modelId, {
      file_name: fileName,
      file_path: fullPath,
      file_size_gb: fileSizeGb,
      format: 'gguf',
      status: 'loading',
      config,
      runtime: {
        loading_started_at: new Date().toISOString(),
        loaded_at: null,
        last_used_at: null,
        total_tokens_generated: 0,
        total_requests: 0
      }
    });

    let model, context;
    try {
      const llama = await this._ensureLib();
      console.log(`[V2ModelService] Loading ${fileName} ...`);
      console.log(`  gpuLayers=${config.gpuLayers}, ctx=${config.contextLength}, flashAttention=${config.flashAttention}, mmap=${config.useMmap}`);

      // Log GPU/VRAM state if available (debugging info)
      try {
        if (llama.getVramState) {
          const vram = await llama.getVramState();
          console.log(`  GPU VRAM: ${(vram.free / 1024 ** 3).toFixed(2)} GB free / ${(vram.total / 1024 ** 3).toFixed(2)} GB total`);
        }
        if (llama.gpu) console.log(`  GPU backend: ${llama.gpu}`);
      } catch {}

      // node-llama-cpp v3 model load (LM Studio-equivalent flags)
      const modelOpts = {
        modelPath: fullPath,
        gpuLayers: config.gpuLayers,           // 'auto' | 'max' | number
        useMmap: config.useMmap,
        useMlock: config.useMlock,
        // Tell the model that contexts will use flash attention so it sizes VRAM accordingly
        defaultContextFlashAttention: config.flashAttention
      };
      
      // If user set a numeric context limit, hint the model loader to fit it
      if (typeof config.contextLength === 'number' && config.gpuLayers === 'auto') {
        modelOpts.gpuLayers = {
          fitContext: { contextSize: config.contextLength }
        };
      }
      
      model = await llama.loadModel(modelOpts);
      console.log(`  Model loaded. Train context size: ${model.trainContextSize}`);

      context = await model.createContext({
        contextSize: config.contextLength,     // 'auto' or number
        batchSize: config.batchSize,
        threads: config.cpuThreads,
        sequences: 8,                          // headroom for parallel agents
        flashAttention: config.flashAttention  // explicit per-context (also inherited)
      });
      
      // Report what we actually got (auto may differ from request)
      const actualCtx = context.contextSize;
      console.log(`  Context created: ${actualCtx} tokens`);

      this.loaded.set(modelId, {
        model_id: modelId,
        file_name: fileName,
        file_path: fullPath,
        model,
        context,
        session: null,          // LlamaChatSession created lazily on first chat, reused after
        config,
        loadedAt: Date.now(),
        lastUsedAt: Date.now(),
        generating: false,
        totalTokensGenerated: 0,
        totalRequests: 0
      });

      await this._registryUpsert(modelId, {
        status: 'loaded',
        runtime: {
          loading_started_at: null,
          loaded_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
          total_tokens_generated: 0,
          total_requests: 0
        }
      });

      await this.rm.log({
        event_type: 'model_loaded',
        actor: { type: 'system', id: 'v2_model_service' },
        subject: { type: 'model', id: modelId },
        action: `Loaded ${fileName} (ctx=${config.contextLength}, gpu_layers=${config.gpuLayers})`,
        context: { config }
      });

      console.log(`[V2ModelService] ✓ ${fileName} ready`);
      return { success: true, model_id: modelId, config };
    } catch (err) {
      // PROPER CLEANUP: dispose context AND model, null refs so GC can collect.
      try { if (context) await context.dispose(); } catch {}
      try { if (model) await model.dispose(); } catch {}
      context = null;
      model = null;
      // Force GC if node was started with --expose-gc
      if (typeof global.gc === 'function') { try { global.gc(); } catch {} }
      // CUDA cleanup is async at the driver level. 1.5s is empirically what
      // it takes for VRAM to actually free on most setups.
      await new Promise(r => setTimeout(r, 1500));

      await this._registryUpsert(modelId, {
        status: 'available',
        runtime: { loading_started_at: null, loaded_at: null, last_used_at: null,
                   total_tokens_generated: 0, total_requests: 0 }
      });

      await this.rm.log({
        event_type: 'model_loaded',
        severity: 'error',
        actor: { type: 'system', id: 'v2_model_service' },
        subject: { type: 'model', id: modelId },
        action: `FAILED to load ${fileName}: ${err.message}`
      });
      
      const isMemoryError = /context size.*too large|out of memory|VRAM|allocation|insufficient|cannot allocate/i.test(err.message);
      const attempt = cfg._retryAttempt || 0;
      
      // Fallback ladder: MONOTONICALLY REDUCE both context and gpu_layers
      // from the user's saved values. Bug we fixed: previously this would
      // INCREASE gpu_layers from the user's value (e.g. 24 -> 28), which
      // is worse, not better - if 24 layers OOMs, 28 layers also OOMs.
      //
      // Compute from user's actual config so we always step DOWN.
      const userCtx = cfg.contextLength || config.contextLength;
      const userGpu = cfg.gpuLayers || config.gpuLayers;
      const baseCtx = typeof userCtx === 'number' ? userCtx : 8192;
      const baseGpu = typeof userGpu === 'number' ? userGpu : 28;
      
      // Each retry: cut context in half AND drop a few gpu layers.
      // Last attempts disable flash attention (may not be supported on this
      // arch even if libllama says it is).
      const fallbacks = [
        // attempt 0 -> attempt 1: halve ctx, drop 4 gpu layers
        {
          contextLength: Math.max(1024, Math.floor(baseCtx / 2)),
          gpuLayers: Math.max(8, baseGpu - 4),
          flashAttention: true,
          reason: `halve ctx + drop 4 gpu layers (from user: ctx=${baseCtx} gpu=${baseGpu})`
        },
        // attempt 1 -> attempt 2: quarter ctx, drop 8 gpu layers
        {
          contextLength: Math.max(1024, Math.floor(baseCtx / 4)),
          gpuLayers: Math.max(8, baseGpu - 8),
          flashAttention: true,
          reason: 'quarter ctx + drop 8 gpu layers'
        },
        // attempt 2 -> attempt 3: same, disable flash attention
        {
          contextLength: Math.max(1024, Math.floor(baseCtx / 4)),
          gpuLayers: Math.max(8, baseGpu - 8),
          flashAttention: false,
          reason: 'same conservative ctx/gpu WITHOUT flash attention'
        },
        // attempt 3 -> attempt 4: minimum viable
        {
          contextLength: 2048,
          gpuLayers: Math.max(4, Math.floor(baseGpu / 2)),
          flashAttention: false,
          reason: 'minimum viable: ctx=2048, gpu halved, no flash'
        }
      ];
      
      if (isMemoryError && attempt < fallbacks.length) {
        const next = fallbacks[attempt];
        console.warn(`[V2ModelService] OOM at attempt ${attempt}. ${next.reason} (NOT persisted - your saved config is kept)`);
        return await this.loadModel(fileName, {
          ...cfg,
          contextLength: next.contextLength,
          gpuLayers: next.gpuLayers,
          flashAttention: next.flashAttention,
          _retryAttempt: attempt + 1
        });
      }

      // Surface friendly error after all attempts
      let msg = err.message;
      if (isMemoryError) {
        msg = `Your GPU can't fit this model even with conservative settings (tried ${attempt} fallbacks). Free VRAM: check your GPU. Options: (1) Close other GPU programs (browsers, games), (2) Use a smaller model like Llama-3.2-3B-Q4 (~2GB), (3) Try Edit Params with Context=2048 and GPU layers=10.`;
      }
      throw new Error(`Load failed: ${msg}`);
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
    if (!reg.models[modelId]) {
      throw new Error(`Model ${modelId} is not in library. Import it first.`);
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
        generating: e.generating
      })),
      poseidon_model_id: this.poseidonModelId
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
    
    // Per-session turn counter (resets when session is wiped)
    entry.sessionTurns = (entry.sessionTurns || 0);

    try {
      const llamaCpp = await import('node-llama-cpp');

      // Reuse the same session across chats so we don't burn through sequences.
      if (!entry.session) {
        // Build system prompt + tool definitions from the orchestrator.
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
        
        // Pick the right chat wrapper - model-agnostic.
        // LlamaChatSession accepts chatWrapper:'auto' which uses the model's
        // GGUF metadata + tokenizer to pick the right template. Works for
        // any modern model (Qwen, Llama, Mistral, DeepSeek, Gemma, etc).
        // We pass 'auto' as the default and let node-llama-cpp do the work.
        const sequence = entry.context.getSequence();
        const sessionOpts = {
          contextSequence: sequence,
          systemPrompt,
          chatWrapper: 'auto'
        };
        entry.session = new llamaCpp.LlamaChatSession(sessionOpts);
        entry._functions = functions;
        entry._currentSequence = sequence;
        entry.sessionTurns = 0;
        const detectedWrapper = entry.session.chatWrapper?.constructor?.name || 'unknown';
        console.log(`[V2ModelService] Created fresh chat session for ${this.poseidonModelId} (${detectedWrapper}, system prompt reloaded from brain.json${functions ? `, ${Object.keys(functions).length} functions exposed` : ''})`);
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
      
      const promptOpts = {
        onTextChunk: (chunk) => { events.push({ type: 'text', chunk }); },
        maxTokens: 512
      };
      if (wrappedFunctions) promptOpts.functions = wrappedFunctions;
      const completion = session.prompt(userMessage, promptOpts);

      // Yield events as they accumulate. Two kinds:
      //   - 'text' events: emit just the chunk (consumer joins them)
      //   - 'tool_call' / 'tool_result' events: surface for UI thinking display
      let lastIdx = 0;
      let lastChunkAt = Date.now();
      const IDLE_TIMEOUT_MS = 90000;
      const ABSOLUTE_MAX_MS = 30 * 60_000;
      const start = Date.now();
      while (true) {
        const isDone = await Promise.race([
          completion.then(() => true),
          new Promise(r => setTimeout(() => r(false), 100))
        ]);
        while (lastIdx < events.length) {
          const ev = events[lastIdx++];
          if (ev.type === 'text') {
            entry.totalTokensGenerated += Math.ceil(ev.chunk.length / 4);
            lastChunkAt = Date.now();
            yield ev;
          } else {
            // Tool-related events count as activity (model is doing work)
            lastChunkAt = Date.now();
            yield ev;
          }
        }
        if (isDone) break;
        const idleMs = Date.now() - lastChunkAt;
        if (idleMs > IDLE_TIMEOUT_MS) {
          console.warn(`[V2ModelService] generation idle timeout (${Math.round(idleMs/1000)}s with no new tokens)`);
          break;
        }
        if (Date.now() - start > ABSOLUTE_MAX_MS) {
          console.warn('[V2ModelService] absolute generation cap (30min) hit');
          break;
        }
      }
      
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
      
      // AUTO-WIPE: after N exchanges, dispose session but keep model in memory.
      // The next chat will rebuild the session fresh, re-reading the system
      // prompt from poseidon_brain.json (so any brain updates take effect).
      const wipeAfter = entry.config?.wipeContextAfterTurns ?? this.contextWipeThreshold;
      if (entry.sessionTurns >= wipeAfter) {
        console.log(`[V2ModelService] Auto-wiping context after ${entry.sessionTurns} turns (model stays loaded)`);
        try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
        try { if (entry._currentSequence?.dispose) entry._currentSequence.dispose(); } catch {}
        entry.session = null;
        entry._currentSequence = null;
        entry.sessionTurns = 0;
        await this.rm.log({
          event_type: 'poseidon_decision',
          severity: 'info',
          actor: { type: 'system', id: 'v2_model_service' },
          subject: { type: 'model', id: this.poseidonModelId },
          action: `Context wiped after ${wipeAfter} turns. Next chat will reload brain.json.`
        }).catch(() => {});
      }
    } catch (err) {
      // If we get a sequence-related error, FULLY clean up session AND sequence
      if (/no sequences|sequence|context/i.test(err.message)) {
        console.warn(`[V2ModelService] Session error, resetting fully:`, err.message);
        try { if (entry.session?.dispose) await entry.session.dispose(); } catch {}
        try { if (entry._currentSequence?.dispose) entry._currentSequence.dispose(); } catch {}
        entry.session = null;
        entry._currentSequence = null;
        entry.sessionTurns = 0;
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

  async _registryUpsert(modelId, partial) {
    this.rm.invalidateCache();
    const reg = await this.rm.read('models/model_registry.json');
    const existing = reg.models[modelId] || { model_id: modelId };
    reg.models[modelId] = this._deepMerge(existing, partial);
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
