const fs = require('fs').promises;
const path = require('path');
const { LlamaModel, LlamaContext, LlamaChatSession } = require('node-llama-cpp');

const MODELS_DIR = path.join(__dirname, '../../data/models');

class ModelManager {
  constructor() {
    this.loadedModels = new Map(); // modelPath -> LlamaModel instance
    this.sessions = new Map(); // sessionId -> LlamaChatSession
  }

  async init() {
    await fs.mkdir(MODELS_DIR, { recursive: true });
    console.log('📦 ModelManager initialized');
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
