const Agent = require('../models/Agent');
const Brain = require('../models/Brain');
const Log = require('../models/Log');
const modelManager = require('./ModelManager');
const toolRegistry = require('./ToolRegistry');
const gpuScheduler = require('./GPUScheduler');
const taskChunker = require('./TaskChunker');

class UnifiedOrchestrator {
  constructor() {
    this.claudeApiKey = process.env.ANTHROPIC_API_KEY;
    this.claudeApiUrl = 'https://api.anthropic.com/v1/messages';
  }

  async init() {
    await modelManager.init();
    await gpuScheduler.initialize();
    console.log('🧠 UnifiedOrchestrator initialized');
    console.log('✂️  Task chunking enabled (auto-split big tasks)');
  }

  /**
   * Execute an agent with automatic task chunking
   */
  async executeAgent(agentId, input = '', options = {}) {
    const agent = await Agent.findById(agentId);
    
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Load brain
    let brain = null;
    if (agent.brain_id) {
      brain = await Brain.findById(agent.brain_id);
      if (!brain) {
        console.warn(`Brain ${agent.brain_id} not found, using agent's own config`);
      }
    }

    // Analyze task for chunking
    const taskType = this.detectTaskType(input, brain);
    const analysis = await taskChunker.analyzeTask(input, taskType);

    console.log(`📊 Task analysis: ${analysis.estimated_tokens} tokens, ${analysis.recommended_chunks} chunks`);

    // If task is small enough, execute directly
    if (!analysis.needs_chunking || options.force_single) {
      return await this.executeSingleTask(agent, brain, input, options);
    }

    // Split task into chunks
    const chunks = await taskChunker.splitTask(input, taskType);
    console.log(`✂️  Task split into ${chunks.length} optimized chunks`);

    // Execute chunks
    const chunkResults = await taskChunker.executeChunkedTask(
      chunks,
      async (chunk) => {
        return await this.executeSingleTask(agent, brain, chunk.input, {
          ...options,
          chunk_context: chunk.context
        });
      },
      {
        parallel: options.parallel || false,
        max_parallel: 3
      }
    );

    // Optimize final output
    const optimized = taskChunker.optimizeOutput(chunkResults, {
      max_tokens: brain?.model.parameters?.max_tokens || 500
    });

    console.log(`💎 Output optimized: ${optimized.tokens_saved} tokens saved (${optimized.compression_ratio})`);

    return {
      success: true,
      output: optimized.optimized,
      chunks_used: chunks.length,
      tokens_saved: optimized.tokens_saved,
      compression_ratio: optimized.compression_ratio,
      metadata: {
        original_tokens: optimized.original_tokens,
        optimized_tokens: optimized.optimized_tokens,
        task_type: taskType
      }
    };
  }

  /**
   * Detect task type for optimal chunking strategy
   */
  detectTaskType(input, brain) {
    const lowerInput = input.toLowerCase();

    // Check brain specialty
    if (brain?.identity?.expertise) {
      const expertise = brain.identity.expertise.join(' ').toLowerCase();
      if (expertise.includes('code') || expertise.includes('review')) {
        return 'code_review';
      }
      if (expertise.includes('data') || expertise.includes('analysis')) {
        return 'data_analysis';
      }
    }

    // Check input content
    if (lowerInput.includes('review') && lowerInput.includes('code')) {
      return 'code_review';
    }
    if (lowerInput.includes('analyze') && lowerInput.includes('data')) {
      return 'data_analysis';
    }
    if (lowerInput.includes('write') && (lowerInput.includes('document') || lowerInput.includes('article'))) {
      return 'document_writing';
    }
    if (lowerInput.includes('research') || lowerInput.includes('find information')) {
      return 'research';
    }

    return 'default';
  }

  /**
   * Execute single task (chunk or full)
   */
  async executeSingleTask(agent, brain, input, options = {}) {

    // Determine priority based on agent stats/marketplace
    const priority = this.determinePriority(agent);

    // Estimate VRAM needed
    const estimatedVRAM = this.estimateVRAM(brain);

    // Schedule with GPU scheduler
    const taskId = await gpuScheduler.scheduleTask({
      agent_id: agent.id,
      brain_id: brain?.id,
      input,
      priority,
      estimated_vram: estimatedVRAM,
      estimated_time: options.estimated_time || 60,
      wake_at: options.wake_at,
      callback: async () => {
        // This callback executes when GPU is available
        return await this.executeAgentNow(agent, brain, input, options);
      }
    });

    return {
      task_id: taskId,
      status: 'scheduled',
      message: 'Task scheduled. Agent will execute when GPU is available.'
    };
  }

  /**
   * Determine priority based on agent/user tier
   */
  determinePriority(agent) {
    // VIP: Marketplace premium agents or paid users
    if (agent.marketplace?.is_for_sale && agent.marketplace.price > 500) {
      return 'vip';
    }

    // High: High-performing agents
    if (agent.stats?.average_quality > 9) {
      return 'high';
    }

    // Normal: Standard agents
    if (agent.stats?.level > 10) {
      return 'normal';
    }

    // Low: New/untested agents
    return 'low';
  }

  /**
   * Estimate VRAM needed for brain
   */
  estimateVRAM(brain) {
    if (!brain) return 0;

    if (brain.model.provider === 'local_gguf') {
      // Estimate based on model size
      // Q4 models: ~4GB for 7B params
      // Q8 models: ~8GB for 7B params
      const modelPath = brain.model.model_path;
      
      if (modelPath.includes('7b') || modelPath.includes('7B')) {
        return modelPath.includes('Q4') ? 4 : 8;
      } else if (modelPath.includes('13b') || modelPath.includes('13B')) {
        return modelPath.includes('Q4') ? 8 : 13;
      }
      
      return 4; // Default estimate
    }

    return 0; // Claude API doesn't use GPU
  }

  /**
   * Execute an agent with its brain
   */
  async executeAgentNow(agent, brain, input = '', options = {}) {
    const startTime = Date.now();

    // Update agent status
    agent.status = 'thinking';
    agent.current_thought = 'Loading brain...';
    await agent.save();

    // Create execution log
    const log = new Log({
      agent_id: agent.id,
      agent_name: agent.name,
      type: 'execution',
      status: 'pending',
      input: input
    });

    try {
      let result;

      // Determine which provider to use
      const provider = brain?.model.provider || agent.llm.provider || 'anthropic';

      if (provider === 'local_gguf') {
        result = await this.executeWithLocalModel(agent, brain, input, options);
      } else {
        result = await this.executeWithClaudeAPI(agent, brain, input, options);
      }

      // Update log
      log.status = 'success';
      log.output = result.output;
      log.duration_ms = Date.now() - startTime;
      log.metadata = result.metadata;

      // Update agent memory
      this.updateAgentMemory(agent, input, result.output, result.thinking);

      // Update brain metrics if used
      if (brain) {
        brain.updateMetrics({
          success: true,
          response_time_ms: log.duration_ms,
          tokens_used: result.metadata?.usage?.total_tokens || 0
        });
        await brain.save();
      }

      return { success: true, output: result.output, thinking: result.thinking, log };

    } catch (error) {
      log.status = 'error';
      log.error = error.message;
      log.duration_ms = Date.now() - startTime;

      agent.status = 'error';
      agent.current_thought = `Error: ${error.message}`;
      
      console.error(`Agent execution error (${agentId}):`, error);
      
      // Update brain metrics for failure
      if (brain) {
        brain.updateMetrics({
          success: false,
          response_time_ms: log.duration_ms
        });
        await brain.save();
      }

      return { success: false, error: error.message, log };

    } finally {
      await log.save();
      setTimeout(async () => {
        agent.status = 'idle';
        agent.current_thought = null;
        await agent.save();
      }, 3000);
    }
  }

  /**
   * Execute with Claude API
   */
  async executeWithClaudeAPI(agent, brain, input, options) {
    agent.current_thought = 'Calling Claude API...';
    await agent.save();

    const systemPrompt = brain 
      ? brain.buildSystemPrompt(options.context || {})
      : agent.prompt.system;

    const messages = [{ role: 'user', content: input || 'Execute your task.' }];

    // Build request with extended thinking
    const requestBody = {
      model: brain?.model.model_name || agent.llm.model,
      max_tokens: brain?.model.parameters.max_tokens || agent.llm.max_tokens,
      temperature: brain?.model.parameters.temperature || agent.llm.temperature,
      thinking: {
        type: 'enabled',
        budget_tokens: 2000
      },
      system: systemPrompt,
      messages: messages
    };

    const response = await fetch(this.claudeApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': this.claudeApiKey
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`API error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();
    
    // Extract thinking
    const thinkingContent = data.content.find(item => item.type === 'thinking');
    const thinking = thinkingContent?.thinking || null;
    
    if (thinking) {
      agent.current_thought = thinking;
      await agent.save();
    }
    
    // Extract response
    const output = data.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');

    return {
      output,
      thinking,
      metadata: {
        provider: 'anthropic',
        model: requestBody.model,
        usage: data.usage
      }
    };
  }

  /**
   * Execute with local GGUF model
   */
  async executeWithLocalModel(agent, brain, input, options) {
    if (!brain) {
      throw new Error('Brain required for local model execution');
    }

    agent.current_thought = 'Loading local model...';
    await agent.save();

    const modelPath = brain.model.model_path;
    if (!modelPath) {
      throw new Error('model_path not specified in brain config');
    }

    // Create or reuse session
    const { sessionId, session } = await modelManager.createSession(modelPath, {
      systemPrompt: brain.buildSystemPrompt(options.context || {}),
      contextSize: 2048,
      nGpuLayers: brain.model.parameters.gpu_layers || 0
    });

    agent.current_thought = 'Generating response...';
    await agent.save();

    // Execute
    const output = await modelManager.chat(sessionId, input, {
      maxTokens: brain.model.parameters.max_tokens || 500,
      temperature: brain.model.parameters.temperature || 0.7,
      topP: brain.model.parameters.top_p || 0.9
    });

    // Close session to free memory
    modelManager.closeSession(sessionId);

    return {
      output,
      thinking: null, // Local models don't have extended thinking yet
      metadata: {
        provider: 'local_gguf',
        model: modelPath,
        session_id: sessionId
      }
    };
  }

  /**
   * Execute tool for an agent
   */
  async executeTool(toolName, parameters, agent) {
    // Check if agent/brain allows this tool
    const result = await toolRegistry.executeTool(toolName, parameters);
    
    // Log tool execution
    const log = new Log({
      agent_id: agent.id,
      agent_name: agent.name,
      type: 'tool_execution',
      status: result.success ? 'success' : 'error',
      input: JSON.stringify({ tool: toolName, parameters }),
      output: JSON.stringify(result)
    });
    await log.save();

    return result;
  }

  /**
   * Update agent memory with execution results
   */
  updateAgentMemory(agent, input, output, thinking) {
    agent.memory.short_term.last_execution = {
      timestamp: new Date().toISOString(),
      input: input,
      output: output,
      thinking: thinking
    };

    agent.memory.kanban.done.push({
      id: `task_${Date.now()}`,
      description: input,
      completed_at: new Date().toISOString(),
      result: output
    });

    if (agent.memory.kanban.done.length > agent.memory.max_history) {
      agent.memory.kanban.done.shift();
    }
  }

  /**
   * Test connection (Claude API)
   */
  async testConnection() {
    try {
      const response = await fetch(this.claudeApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.claudeApiKey
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Hello!' }]
        })
      });

      return response.ok;
    } catch (error) {
      console.error('API connection test failed:', error);
      return false;
    }
  }
}

module.exports = UnifiedOrchestrator;
