const fetch = require('node-fetch');

/**
 * HuggingFace Inference API Integration
 * 
 * Supports:
 * - Text generation
 * - Conversational models
 * - Free inference API
 * - Custom endpoints
 * - Model search
 */
class HuggingFaceInference {
  constructor() {
    this.apiKey = process.env.HUGGINGFACE_API_KEY || '';
    this.baseUrl = 'https://api-inference.huggingface.co/models';
    this.searchUrl = 'https://huggingface.co/api/models';
    
    // Popular models for quick access
    this.popularModels = {
      // Text Generation
      'mistral-7b': 'mistralai/Mistral-7B-Instruct-v0.2',
      'llama-2-7b': 'meta-llama/Llama-2-7b-chat-hf',
      'llama-2-13b': 'meta-llama/Llama-2-13b-chat-hf',
      'codellama-7b': 'codellama/CodeLlama-7b-Instruct-hf',
      'phi-2': 'microsoft/phi-2',
      'zephyr-7b': 'HuggingFaceH4/zephyr-7b-beta',
      'tiny-llama': 'TinyLlama/TinyLlama-1.1B-Chat-v1.0',
      
      // Conversational
      'blenderbot': 'facebook/blenderbot-400M-distill',
      'dialo-gpt': 'microsoft/DialoGPT-medium',
      
      // Code
      'starcoder': 'bigcode/starcoder',
      'codegen': 'Salesforce/codegen-350M-mono',
    };
  }

  /**
   * Test API connection
   */
  async testConnection() {
    try {
      const response = await fetch(`${this.searchUrl}?limit=1`);
      return response.ok;
    } catch (error) {
      console.error('HuggingFace API connection failed:', error.message);
      return false;
    }
  }

  /**
   * Search for models
   */
  async searchModels(query, options = {}) {
    const {
      task = 'text-generation',
      limit = 20,
      sort = 'downloads',
      direction = 'desc'
    } = options;

    try {
      const params = new URLSearchParams({
        search: query,
        filter: task,
        limit,
        sort,
        direction
      });

      const response = await fetch(`${this.searchUrl}?${params}`);
      const models = await response.json();

      return models.map(model => ({
        id: model.id,
        name: model.id.split('/').pop(),
        author: model.id.split('/')[0],
        downloads: model.downloads || 0,
        likes: model.likes || 0,
        task: model.pipeline_tag,
        tags: model.tags || [],
        private: model.private || false,
        gated: model.gated || false
      }));
    } catch (error) {
      console.error('Model search failed:', error);
      return [];
    }
  }

  /**
   * Get model info
   */
  async getModelInfo(modelId) {
    try {
      const response = await fetch(`https://huggingface.co/api/models/${modelId}`);
      
      if (!response.ok) {
        throw new Error(`Model ${modelId} not found`);
      }

      return await response.json();
    } catch (error) {
      console.error('Failed to get model info:', error);
      return null;
    }
  }

  /**
   * Generate text (main inference method)
   */
  async generateText(modelId, input, options = {}) {
    const {
      max_new_tokens = 500,
      temperature = 0.7,
      top_p = 0.9,
      top_k = 50,
      repetition_penalty = 1.1,
      do_sample = true,
      return_full_text = false,
      wait_for_model = true
    } = options;

    try {
      const response = await fetch(`${this.baseUrl}/${modelId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: input,
          parameters: {
            max_new_tokens,
            temperature,
            top_p,
            top_k,
            repetition_penalty,
            do_sample,
            return_full_text
          },
          options: {
            wait_for_model
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `API Error: ${response.status}`);
      }

      const result = await response.json();

      // Handle different response formats
      if (Array.isArray(result)) {
        return result[0].generated_text || result[0].text;
      } else if (result.generated_text) {
        return result.generated_text;
      } else if (result[0]) {
        return result[0].generated_text || result[0].text;
      }

      return result;
    } catch (error) {
      console.error(`HuggingFace inference error (${modelId}):`, error.message);
      throw error;
    }
  }

  /**
   * Conversational inference (chat)
   */
  async chat(modelId, messages, options = {}) {
    const {
      max_new_tokens = 500,
      temperature = 0.7,
      top_p = 0.9
    } = options;

    try {
      // Convert messages to HF format
      const formattedInput = messages.map(msg => {
        if (msg.role === 'user') {
          return { role: 'user', content: msg.content };
        } else if (msg.role === 'assistant') {
          return { role: 'assistant', content: msg.content };
        }
        return { role: 'system', content: msg.content };
      });

      const response = await fetch(`${this.baseUrl}/${modelId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: {
            past_user_inputs: formattedInput
              .filter(m => m.role === 'user')
              .map(m => m.content),
            generated_responses: formattedInput
              .filter(m => m.role === 'assistant')
              .map(m => m.content),
            text: messages[messages.length - 1].content
          },
          parameters: {
            max_new_tokens,
            temperature,
            top_p
          }
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `API Error: ${response.status}`);
      }

      const result = await response.json();
      
      return result.generated_text || result.text || result;
    } catch (error) {
      console.error(`HuggingFace chat error (${modelId}):`, error.message);
      throw error;
    }
  }

  /**
   * Code generation
   */
  async generateCode(prompt, language = 'python', options = {}) {
    const modelId = options.model || 'bigcode/starcoder';
    
    const formattedPrompt = `# Language: ${language}\n# Task: ${prompt}\n\n`;
    
    return await this.generateText(modelId, formattedPrompt, {
      max_new_tokens: options.max_tokens || 1000,
      temperature: options.temperature || 0.2,
      ...options
    });
  }

  /**
   * Get popular models list
   */
  getPopularModels() {
    return Object.entries(this.popularModels).map(([key, modelId]) => ({
      key,
      modelId,
      name: modelId.split('/').pop(),
      author: modelId.split('/')[0]
    }));
  }

  /**
   * Check model status
   */
  async checkModelStatus(modelId) {
    try {
      const response = await fetch(`${this.baseUrl}/${modelId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          inputs: "test",
          options: { wait_for_model: false }
        })
      });

      if (response.status === 503) {
        const data = await response.json();
        return {
          status: 'loading',
          estimated_time: data.estimated_time || 20
        };
      }

      return {
        status: 'ready',
        estimated_time: 0
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Batch inference (multiple inputs)
   */
  async batchGenerate(modelId, inputs, options = {}) {
    const results = [];

    for (const input of inputs) {
      try {
        const result = await this.generateText(modelId, input, options);
        results.push({ input, output: result, success: true });
      } catch (error) {
        results.push({ input, error: error.message, success: false });
      }
    }

    return results;
  }

  /**
   * Estimate cost (HF Inference API is free but rate-limited)
   */
  estimateCost(modelId, tokens) {
    // HF Inference API is free but has rate limits:
    // - Free tier: ~100 requests/hour
    // - With API key: ~1000 requests/hour
    // - Pro: Unlimited
    
    return {
      cost: 0, // Free!
      tier: this.apiKey ? 'API Key' : 'Free',
      rate_limit: this.apiKey ? '1000 req/hour' : '100 req/hour',
      tokens,
      note: 'HuggingFace Inference API is free with rate limits'
    };
  }
}

// Singleton
const hfInference = new HuggingFaceInference();

module.exports = hfInference;
