const fs = require('fs').promises;
const path = require('path');

const BRAINS_DIR = path.join(__dirname, '../../data/brains');

/**
 * Brain - The intelligence structure of an agent
 * 
 * A Brain defines:
 * - Identity: Who the agent is
 * - Prompts: System prompt, instruction templates
 * - Tools: Available tools for this brain
 * - Memory structure: How this brain organizes knowledge
 * - Model: Which LLM to use (Claude API or local GGUF)
 */
class Brain {
  constructor(data) {
    this.id = data.id || `brain_${Date.now()}`;
    this.name = data.name || 'Unnamed Brain';
    this.version = data.version || '1.0.0';
    this.created_at = data.created_at || new Date().toISOString();
    
    // Identity
    this.identity = data.identity || {
      role: '',
      expertise: [],
      personality: [],
      constraints: []
    };

    // Prompts
    this.prompts = data.prompts || {
      system: '',
      instruction_templates: {},
      few_shot_examples: []
    };

    // Model configuration
    this.model = data.model || {
      provider: 'anthropic', // 'anthropic' | 'local_gguf'
      model_name: 'claude-haiku-4-20250514',
      model_path: null, // For GGUF: path to .gguf file
      parameters: {
        temperature: 0.7,
        max_tokens: 500,
        top_p: 0.9
      }
    };

    // Tools
    this.tools = data.tools || {
      enabled: [],
      disabled: [],
      custom_tools: []
    };

    // Memory structure template
    this.memory_structure = data.memory_structure || {
      short_term: {
        max_items: 10,
        retention_policy: 'fifo'
      },
      long_term: {
        categories: ['knowledge', 'experiences', 'preferences'],
        max_size_mb: 10
      },
      kanban: {
        enabled: true,
        auto_populate: true
      },
      custom_fields: {}
    };

    // Performance metrics
    this.metrics = data.metrics || {
      total_executions: 0,
      success_rate: 0,
      avg_response_time_ms: 0,
      total_tokens_used: 0
    };
  }

  async save() {
    await fs.mkdir(BRAINS_DIR, { recursive: true });
    const filepath = path.join(BRAINS_DIR, `${this.id}.json`);
    await fs.writeFile(filepath, JSON.stringify(this, null, 2));
    return this;
  }

  static async findById(id) {
    try {
      const filepath = path.join(BRAINS_DIR, `${id}.json`);
      const data = await fs.readFile(filepath, 'utf8');
      return new Brain(JSON.parse(data));
    } catch (error) {
      return null;
    }
  }

  static async findAll() {
    try {
      await fs.mkdir(BRAINS_DIR, { recursive: true });
      const files = await fs.readdir(BRAINS_DIR);
      const brains = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async (file) => {
            const data = await fs.readFile(path.join(BRAINS_DIR, file), 'utf8');
            return new Brain(JSON.parse(data));
          })
      );
      return brains;
    } catch (error) {
      return [];
    }
  }

  static async delete(id) {
    try {
      const filepath = path.join(BRAINS_DIR, `${id}.json`);
      await fs.unlink(filepath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Build the full system prompt for this brain
   */
  buildSystemPrompt(context = {}) {
    let prompt = this.prompts.system;

    // Add identity context
    if (this.identity.role) {
      prompt += `\n\nYour role: ${this.identity.role}`;
    }

    if (this.identity.expertise.length > 0) {
      prompt += `\n\nYour expertise: ${this.identity.expertise.join(', ')}`;
    }

    if (this.identity.personality.length > 0) {
      prompt += `\n\nPersonality traits: ${this.identity.personality.join(', ')}`;
    }

    if (this.identity.constraints.length > 0) {
      prompt += `\n\nConstraints:\n${this.identity.constraints.map(c => `- ${c}`).join('\n')}`;
    }

    // Add context-specific instructions
    if (context.custom_instructions) {
      prompt += `\n\n${context.custom_instructions}`;
    }

    return prompt;
  }

  /**
   * Get instruction template
   */
  getInstructionTemplate(templateName) {
    return this.prompts.instruction_templates[templateName] || null;
  }

  /**
   * Update metrics
   */
  updateMetrics(executionData) {
    this.metrics.total_executions += 1;
    
    if (executionData.success) {
      const successCount = Math.floor(this.metrics.success_rate * (this.metrics.total_executions - 1));
      this.metrics.success_rate = (successCount + 1) / this.metrics.total_executions;
    } else {
      const successCount = Math.floor(this.metrics.success_rate * (this.metrics.total_executions - 1));
      this.metrics.success_rate = successCount / this.metrics.total_executions;
    }

    if (executionData.response_time_ms) {
      const totalTime = this.metrics.avg_response_time_ms * (this.metrics.total_executions - 1);
      this.metrics.avg_response_time_ms = (totalTime + executionData.response_time_ms) / this.metrics.total_executions;
    }

    if (executionData.tokens_used) {
      this.metrics.total_tokens_used += executionData.tokens_used;
    }
  }

  /**
   * Clone this brain with modifications
   */
  clone(modifications = {}) {
    const clonedData = {
      ...this,
      id: `brain_${Date.now()}`,
      name: `${this.name} (Clone)`,
      created_at: new Date().toISOString(),
      metrics: {
        total_executions: 0,
        success_rate: 0,
        avg_response_time_ms: 0,
        total_tokens_used: 0
      },
      ...modifications
    };

    return new Brain(clonedData);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      version: this.version,
      created_at: this.created_at,
      identity: this.identity,
      prompts: this.prompts,
      model: this.model,
      tools: this.tools,
      memory_structure: this.memory_structure,
      metrics: this.metrics
    };
  }
}

module.exports = Brain;
