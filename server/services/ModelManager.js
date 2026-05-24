const fs = require('fs').promises;
const path = require('path');

const MODELS_DIR = path.join(__dirname, '../../data/models');
const HF_CACHE_DIR = process.env.HF_HOME || path.join(require('os').homedir(), '.cache/huggingface/hub');

class ModelManager {
  constructor() {
    this.loadedModels = new Map(); // modelPath -> LlamaModel instance
    this.sessions = new Map(); // sessionId -> LlamaChatSession
    this.llamaLib = null; // Will be loaded on demand
    this.hfModels = []; // Cached list of HuggingFace models
  }

  async init() {
    await fs.mkdir(MODELS_DIR, { recursive: true });
    
    // Scan Hugging Face cache
    await this.scanHuggingFaceCache();
    
    console.log('📦 ModelManager initialized');
    console.log(`   Local models: ${MODELS_DIR}`);
    console.log(`   HuggingFace cache: ${HF_CACHE_DIR}`);
    console.log(`   Found ${this.hfModels.length} HF models in cache`);
  }

  /**
   * Scan Hugging Face cache for available models
   */
  async scanHuggingFaceCache() {
    try {
      const cacheExists = await fs.access(HF_CACHE_DIR).then(() => true).catch(() => false);
      if (!cacheExists) {
        console.log('ℹ️  HuggingFace cache not found');
        return;
      }

      // List models in HF cache
      const models = await fs.readdir(HF_CACHE_DIR);
      
      for (const model of models) {
        if (model.startsWith('models--')) {
          // Extract model name (e.g., "models--TheBloke--Mistral-7B-Instruct-v0.2-GGUF")
          const modelName = model.replace('models--', '').replace(/--/g, '/');
          const modelPath = path.join(HF_CACHE_DIR, model);
          
          // Find .gguf files in snapshots
          try {
            const snapshots = await fs.readdir(path.join(modelPath, 'snapshots'));
            for (const snapshot of snapshots) {
              const snapshotPath = path.join(modelPath, 'snapshots', snapshot);
              const files = await fs.readdir(snapshotPath);
              
              const ggufFiles = files.filter(f => f.endsWith('.gguf'));
              
              for (const ggufFile of ggufFiles) {
                this.hfModels.push({
                  name: modelName,
                  file: ggufFile,
                  full_path: path.join(snapshotPath, ggufFile),
                  source: 'huggingface',
                  snapshot: snapshot.substring(0, 8)
                });
              }
            }
          } catch (e) {
            // Skip if can't read snapshots
          }
        }
      }
    } catch (error) {
      console.log('ℹ️  Could not scan HuggingFace cache:', error.message);
    }
  }

  /**
   * List all available models (local + HuggingFace)
   */
  async listModels() {
    const models = [];

    // Local models
    try {
      const files = await fs.readdir(MODELS_DIR);
      const ggufFiles = files.filter(f => f.endsWith('.gguf'));
      
      for (const file of ggufFiles) {
        const stats = await fs.stat(path.join(MODELS_DIR, file));
        models.push({
          name: file.replace('.gguf', ''),
          file: file,
          full_path: path.join(MODELS_DIR, file),
          source: 'local',
          size_mb: Math.round(stats.size / 1024 / 1024),
          loaded: this.loadedModels.has(file)
        });
      }
    } catch (error) {
      console.error('Error listing local models:', error);
    }

    // HuggingFace models
    for (const hfModel of this.hfModels) {
      try {
        const stats = await fs.stat(hfModel.full_path);
        models.push({
          ...hfModel,
          size_mb: Math.round(stats.size / 1024 / 1024),
          loaded: this.loadedModels.has(hfModel.full_path)
        });
      } catch (e) {
        // Skip if can't stat
      }
    }

    return models;
  }

  /**
   * Load model from local path or HuggingFace cache
   */
  async loadModel(modelPath, options = {}) {
    try {
      let fullPath = modelPath;
      
      // Check if it's a relative path (local model)
      if (!path.isAbsolute(modelPath)) {
        // Try local models dir first
        const localPath = path.join(MODELS_DIR, modelPath);
        const localExists = await fs.access(localPath).then(() => true).catch(() => false);
        
        if (localExists) {
          fullPath = localPath;
        } else {
          // Search in HuggingFace cache
          const hfModel = this.hfModels.find(m => 
            m.file === modelPath || 
            m.full_path.includes(modelPath)
          );
          
          if (hfModel) {
            fullPath = hfModel.full_path;
            console.log(`📦 Found in HuggingFace cache: ${hfModel.name}/${hfModel.file}`);
          } else {
            throw new Error(`Model not found: ${modelPath}`);
          }
        }
      }
      
      // Check if already loaded
      if (this.loadedModels.has(fullPath)) {
        console.log(`📦 Model already loaded: ${path.basename(fullPath)}`);
        return this.loadedModels.get(fullPath);
      }

      console.log(`📦 Loading GGUF model: ${path.basename(fullPath)}...`);
      
      const { LlamaModel } = await this.ensureLlamaLib();
      
      const model = new LlamaModel({
        modelPath: fullPath,
        gpuLayers: options.nGpuLayers || 0,
        ...options
      });

      this.loadedModels.set(fullPath, model);
      console.log(`✅ Model loaded: ${path.basename(fullPath)}`);
      
      return model;
    } catch (error) {
      console.error(`❌ Failed to load model ${modelPath}:`, error);
      throw error;
    }
  }

  /**
   * Lazy load node-llama-cpp only when needed
   */
  async ensureLlamaLib() {
    if (!this.llamaLib) {
      try {
        this.llamaLib = await import('node-llama-cpp');
        console.log('✅ node-llama-cpp loaded');
      } catch (error) {
        console.error('❌ Failed to load node-llama-cpp:', error.message);
        console.log('💡 Install with: npm install node-llama-cpp');
        throw new Error('node-llama-cpp not available. Local GGUF models disabled.');
      }
    }
    return this.llamaLib;
  }

  /**
   * Load a GGUF model from disk
   * @param {string} modelPath - Path to .gguf file
   * @param {object} options - Model options (nCtx, nGpuLayers, etc.)
   */
  async loadModel(modelPath, options = {}) {
    try {
      const fullPath = path.join(MODELS_DIR, modelPath);
      
      // Check if already loaded
      if (this.loadedModels.has(modelPath)) {
        console.log(`📦 Model already loaded: ${modelPath}`);
        return this.loadedModels.get(modelPath);
      }

      console.log(`📦 Loading GGUF model: ${modelPath}...`);
      
      const { LlamaModel } = await this.ensureLlamaLib();
      
      const model = new LlamaModel({
        modelPath: fullPath,
        gpuLayers: options.nGpuLayers || 0, // 0 = CPU only
        ...options
      });

      this.loadedModels.set(modelPath, model);
      console.log(`✅ Model loaded: ${modelPath}`);
      
      return model;
    } catch (error) {
      console.error(`❌ Failed to load model ${modelPath}:`, error);
      throw error;
    }
  }

  /**
   * Create a chat session with a loaded model
   */
  async createSession(modelPath, options = {}) {
    const { LlamaContext, LlamaChatSession } = await this.ensureLlamaLib();
    const model = await this.loadModel(modelPath, options);
    
    const context = new LlamaContext({
      model,
      contextSize: options.contextSize || 2048,
      batchSize: options.batchSize || 512
    });

    const session = new LlamaChatSession({
      context,
      systemPrompt: options.systemPrompt || 'You are a helpful AI assistant.'
    });

    const sessionId = `session_${Date.now()}`;
    this.sessions.set(sessionId, session);

    return { sessionId, session };
  }

  /**
   * Chat with a model session
   */
  async chat(sessionId, message, options = {}) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    try {
      const response = await session.prompt(message, {
        maxTokens: options.maxTokens || 500,
        temperature: options.temperature || 0.7,
        topP: options.topP || 0.9,
        topK: options.topK || 40,
        repeatPenalty: options.repeatPenalty || 1.1
      });

      return response;
    } catch (error) {
      console.error(`Chat error in session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * List available models in the models directory
   */
  async listModels() {
    try {
      const files = await fs.readdir(MODELS_DIR);
      const ggufFiles = files.filter(f => f.endsWith('.gguf'));
      
      return ggufFiles.map(file => ({
        name: file,
        path: file,
        size: null, // Could add file size check
        loaded: this.loadedModels.has(file)
      }));
    } catch (error) {
      console.error('Error listing models:', error);
      return [];
    }
  }

  /**
   * Unload a model to free memory
   */
  async unloadModel(modelPath) {
    if (this.loadedModels.has(modelPath)) {
      const model = this.loadedModels.get(modelPath);
      // Cleanup associated sessions
      for (const [sessionId, session] of this.sessions.entries()) {
        if (session.context.model === model) {
          this.sessions.delete(sessionId);
        }
      }
      
      this.loadedModels.delete(modelPath);
      console.log(`🗑️  Model unloaded: ${modelPath}`);
      return true;
    }
    return false;
  }

  /**
   * Get model info
   */
  getModelInfo(modelPath) {
    const model = this.loadedModels.get(modelPath);
    if (!model) {
      return null;
    }

    return {
      path: modelPath,
      loaded: true,
      sessions: Array.from(this.sessions.entries())
        .filter(([_, session]) => session.context.model === model)
        .map(([id]) => id)
    };
  }

  /**
   * Close a session
   */
  closeSession(sessionId) {
    if (this.sessions.has(sessionId)) {
      this.sessions.delete(sessionId);
      console.log(`🔒 Session closed: ${sessionId}`);
      return true;
    }
    return false;
  }

  /**
   * Cleanup all models and sessions
   */
  async cleanup() {
    console.log('🧹 Cleaning up ModelManager...');
    this.sessions.clear();
    this.loadedModels.clear();
    console.log('✅ Cleanup complete');
  }
}

// Singleton instance
const modelManager = new ModelManager();

module.exports = modelManager;
