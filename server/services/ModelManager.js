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
    console.log('🔍 ========== LOAD MODEL DEBUG ==========');
    console.log('📥 Requested model:', modelPath);
    console.log('⚙️  Options:', JSON.stringify(options, null, 2));
    
    try {
      let fullPath = modelPath;
      
      console.log('📂 Step 1: Resolving path...');
      
      // Check if it's a relative path (local model)
      if (!path.isAbsolute(modelPath)) {
        console.log('   → Relative path detected');
        
        // Try local models dir first
        const localPath = path.join(MODELS_DIR, modelPath);
        console.log('   → Checking local:', localPath);
        
        const localExists = await fs.access(localPath).then(() => true).catch(() => false);
        
        if (localExists) {
          fullPath = localPath;
          console.log('   ✅ Found in local directory');
        } else {
          console.log('   ❌ Not found in local directory');
          console.log('   → Searching HuggingFace cache...');
          
          // Search in HuggingFace cache
          const hfModel = this.hfModels.find(m => 
            m.file === modelPath || 
            m.full_path.includes(modelPath)
          );
          
          if (hfModel) {
            fullPath = hfModel.full_path;
            console.log(`   ✅ Found in HuggingFace cache: ${hfModel.name}/${hfModel.file}`);
          } else {
            console.log('   ❌ NOT FOUND in HuggingFace cache');
            console.log('   Available HF models:', this.hfModels.length);
            this.hfModels.slice(0, 3).forEach(m => console.log('      -', m.file));
            throw new Error(`Model not found: ${modelPath}`);
          }
        }
      } else {
        console.log('   → Absolute path provided');
      }
      
      console.log('📍 Final path:', fullPath);
      
      // Check if already loaded
      if (this.loadedModels.has(fullPath)) {
        console.log(`✅ Model already loaded: ${path.basename(fullPath)}`);
        console.log('=======================================');
        return this.loadedModels.get(fullPath);
      }

      console.log('📂 Step 2: Loading node-llama-cpp...');
      const { LlamaModel } = await this.ensureLlamaLib();
      console.log('   ✅ node-llama-cpp loaded');
      
      console.log('📂 Step 3: Creating LlamaModel instance...');
      console.log('   Model path:', fullPath);
      console.log('   GPU layers:', options.nGpuLayers || 0);
      
      const model = new LlamaModel({
        modelPath: fullPath,
        gpuLayers: options.nGpuLayers || 0,
        ...options
      });
      
      console.log('   ✅ LlamaModel instance created');

      this.loadedModels.set(fullPath, model);
      console.log(`✅ SUCCESS! Model loaded: ${path.basename(fullPath)}`);
      console.log('📊 Total loaded models:', this.loadedModels.size);
      console.log('=======================================');
      
      return model;
    } catch (error) {
      console.error('❌ ========== LOAD FAILED ==========');
      console.error('Model path:', modelPath);
      console.error('Error:', error.message);
      console.error('Stack:', error.stack);
      console.error('====================================');
      throw error;
    }
  }

  /**
   * Lazy load node-llama-cpp only when needed
   */
  async ensureLlamaLib() {
    if (!this.llamaLib) {
      try {
        console.log('📦 Loading node-llama-cpp...');
        this.llamaLib = await import('node-llama-cpp');
        console.log('✅ node-llama-cpp loaded successfully');
      } catch (error) {
        console.error('❌ Failed to load node-llama-cpp:', error.message);
        console.log('💡 Install with: npm install node-llama-cpp');
        throw new Error('node-llama-cpp not available. Local GGUF models disabled.');
      }
    }
    return this.llamaLib;
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
   * Get list of currently loaded models
   */
  getLoadedModels() {
    return Array.from(this.loadedModels.keys()).map(path => ({
      path,
      name: path.split('/').pop()
    }));
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
