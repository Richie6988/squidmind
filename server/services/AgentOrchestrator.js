const Agent = require('../models/Agent');
const Log = require('../models/Log');

class AgentOrchestrator {
  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY;
    this.apiUrl = 'https://api.anthropic.com/v1/messages';
  }

  async executeAgent(agentId, input = '', mcpServers = []) {
    const startTime = Date.now();
    const agent = await Agent.findById(agentId);
    
    if (!agent) {
      throw new Error(`Agent ${agentId} not found`);
    }

    // Update agent status
    agent.status = 'thinking';
    agent.current_thought = 'Analyzing request...';
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
      // Build messages
      const messages = [
        {
          role: 'user',
          content: input || 'Execute your scheduled task.'
        }
      ];

      // Build request body with extended thinking
      const requestBody = {
        model: agent.llm.model,
        max_tokens: agent.llm.max_tokens,
        temperature: agent.llm.temperature,
        thinking: {
          type: 'enabled',
          budget_tokens: 2000
        },
        system: this.buildSystemPrompt(agent),
        messages: messages
      };

      // Add MCP servers if provided
      if (mcpServers && mcpServers.length > 0) {
        requestBody.mcp_servers = mcpServers;
      }

      // Update thinking status
      agent.current_thought = 'Calling Claude API...';
      await agent.save();

      // Call Claude API
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.apiKey
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
      if (thinkingContent) {
        agent.current_thought = thinkingContent.thinking || 'Processing...';
      }
      
      // Extract response text
      const output = data.content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');

      // Update status
      agent.status = 'working';
      agent.current_thought = 'Task completed';
      await agent.save();

      // Update log
      log.status = 'success';
      log.output = output;
      log.duration_ms = Date.now() - startTime;
      log.metadata = {
        model: agent.llm.model,
        usage: data.usage,
        thinking: thinkingContent?.thinking || null
      };

      // Update agent memory with detailed documentation
      this.updateAgentMemory(agent, input, output, thinkingContent?.thinking);

      return { success: true, output, thinking: thinkingContent?.thinking, log };

    } catch (error) {
      log.status = 'error';
      log.error = error.message;
      log.duration_ms = Date.now() - startTime;

      agent.status = 'error';
      agent.current_thought = `Error: ${error.message}`;
      
      console.error(`Agent execution error (${agentId}):`, error);
      return { success: false, error: error.message, log };

    } finally {
      // Always save log and reset to idle after delay
      await log.save();
      setTimeout(async () => {
        agent.status = 'idle';
        agent.current_thought = null;
        await agent.save();
      }, 3000);
    }
  }

  updateAgentMemory(agent, input, output, thinking) {
    // Short-term: dernière exécution
    agent.memory.short_term.last_execution = {
      timestamp: new Date().toISOString(),
      input: input,
      output: output,
      thinking: thinking
    };

    // KANBAN: ajouter à done
    agent.memory.kanban.done.push({
      id: `task_${Date.now()}`,
      description: input,
      completed_at: new Date().toISOString(),
      result: output
    });

    // Limiter historique
    if (agent.memory.kanban.done.length > agent.memory.max_history) {
      agent.memory.kanban.done.shift();
    }
  }

  buildSystemPrompt(agent) {
    let systemPrompt = agent.prompt.system || '';
    
    // Add context if provided
    if (agent.prompt.context && agent.prompt.context.length > 0) {
      systemPrompt += '\n\nAdditional context:\n';
      systemPrompt += agent.prompt.context.map(c => `- ${c}`).join('\n');
    }

    // Add memory context if available
    if (agent.memory.long_term && Object.keys(agent.memory.long_term).length > 0) {
      systemPrompt += '\n\nLong-term memory:\n';
      systemPrompt += JSON.stringify(agent.memory.long_term, null, 2);
    }

    return systemPrompt;
  }

  async testConnection() {
    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': this.apiKey
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

module.exports = AgentOrchestrator;
