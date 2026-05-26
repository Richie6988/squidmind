#!/usr/bin/env node

/**
 * SquidMind MCP Server
 * 
 * Exposes SquidMind functionality via Model Context Protocol
 * Can be used with Claude Desktop, Cline, and other MCP clients
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const Agent = require('./models/Agent');
const Brain = require('./models/Brain');
const Group = require('./models/Group');
const Log = require('./models/Log');
const toolRegistry = require('./services/ToolRegistry');

class SquidMindMCPServer {
  constructor() {
    this.server = new Server(
      {
        name: 'squidmind',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {}
        },
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          // Agent management
          {
            name: 'list_agents',
            description: 'List all SquidMind agents',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'create_agent',
            description: 'Create a new SquidMind agent',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Agent name' },
                brain_id: { type: 'string', description: 'Brain ID to use' },
                type: { type: 'string', description: 'Agent type (worker/main)' }
              },
              required: ['name']
            }
          },
          {
            name: 'execute_agent',
            description: 'Execute a SquidMind agent with input',
            inputSchema: {
              type: 'object',
              properties: {
                agent_id: { type: 'string', description: 'Agent ID' },
                input: { type: 'string', description: 'Input text for the agent' }
              },
              required: ['agent_id', 'input']
            }
          },
          {
            name: 'get_agent_status',
            description: 'Get the current status of an agent',
            inputSchema: {
              type: 'object',
              properties: {
                agent_id: { type: 'string', description: 'Agent ID' }
              },
              required: ['agent_id']
            }
          },

          // Brain management
          {
            name: 'list_brains',
            description: 'List all available brain templates',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'get_brain',
            description: 'Get details about a specific brain',
            inputSchema: {
              type: 'object',
              properties: {
                brain_id: { type: 'string', description: 'Brain ID' }
              },
              required: ['brain_id']
            }
          },

          // Group management
          {
            name: 'list_groups',
            description: 'List all agent groups',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'create_group',
            description: 'Create a new agent group',
            inputSchema: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Group name' },
                description: { type: 'string', description: 'Group description' },
                members: { type: 'array', items: { type: 'string' }, description: 'Agent IDs' }
              },
              required: ['name']
            }
          },

          // Tools
          {
            name: 'list_squidmind_tools',
            description: 'List all available SquidMind tools (filesystem, web, etc.)',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'execute_squidmind_tool',
            description: 'Execute a SquidMind tool (read_file, web_search, calculator, etc.)',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: { type: 'string', description: 'Tool name' },
                parameters: { type: 'object', description: 'Tool parameters' }
              },
              required: ['tool_name', 'parameters']
            }
          },

          // Logs
          {
            name: 'get_agent_logs',
            description: 'Get execution logs for an agent',
            inputSchema: {
              type: 'object',
              properties: {
                agent_id: { type: 'string', description: 'Agent ID' },
                limit: { type: 'number', description: 'Max logs to return' }
              },
              required: ['agent_id']
            }
          }
        ]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'list_agents':
            return await this.handleListAgents();
          
          case 'create_agent':
            return await this.handleCreateAgent(args);
          
          case 'execute_agent':
            return await this.handleExecuteAgent(args);
          
          case 'get_agent_status':
            return await this.handleGetAgentStatus(args);
          
          case 'list_brains':
            return await this.handleListBrains();
          
          case 'get_brain':
            return await this.handleGetBrain(args);
          
          case 'list_groups':
            return await this.handleListGroups();
          
          case 'create_group':
            return await this.handleCreateGroup(args);
          
          case 'list_squidmind_tools':
            return await this.handleListTools();
          
          case 'execute_squidmind_tool':
            return await this.handleExecuteTool(args);
          
          case 'get_agent_logs':
            return await this.handleGetLogs(args);
          
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ],
          isError: true
        };
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const agents = await Agent.findAll();
      const brains = await Brain.findAll();

      return {
        resources: [
          ...agents.map(agent => ({
            uri: `squidmind://agents/${agent.id}`,
            name: `Agent: ${agent.name}`,
            description: `SquidMind agent (${agent.status})`,
            mimeType: 'application/json'
          })),
          ...brains.map(brain => ({
            uri: `squidmind://brains/${brain.id}`,
            name: `Brain: ${brain.name}`,
            description: brain.identity.role || 'AI brain template',
            mimeType: 'application/json'
          }))
        ]
      };
    });

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      
      if (uri.startsWith('squidmind://agents/')) {
        const agentId = uri.replace('squidmind://agents/', '');
        const agent = await Agent.findById(agentId);
        
        if (!agent) {
          throw new Error(`Agent not found: ${agentId}`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(agent, null, 2)
            }
          ]
        };
      }

      if (uri.startsWith('squidmind://brains/')) {
        const brainId = uri.replace('squidmind://brains/', '');
        const brain = await Brain.findById(brainId);
        
        if (!brain) {
          throw new Error(`Brain not found: ${brainId}`);
        }

        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(brain, null, 2)
            }
          ]
        };
      }

      throw new Error(`Unknown resource URI: ${uri}`);
    });
  }

  // Tool handlers
  async handleListAgents() {
    const agents = await Agent.findAll();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(agents.map(a => ({
            id: a.id,
            name: a.name,
            type: a.type,
            status: a.status,
            brain_id: a.brain_id,
            group_id: a.group_id
          })), null, 2)
        }
      ]
    };
  }

  async handleCreateAgent(args) {
    const agent = new Agent(args);
    await agent.save();
    return {
      content: [
        {
          type: 'text',
          text: `Agent created: ${agent.name} (${agent.id})`
        }
      ]
    };
  }

  async handleExecuteAgent(args) {
    const { agent_id, input } = args;
    
    // Note: This is a simplified version
    // In production, you'd use UnifiedOrchestrator
    const agent = await Agent.findById(agent_id);
    if (!agent) {
      throw new Error(`Agent not found: ${agent_id}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Agent ${agent.name} received input: ${input}\n\nNote: Execution queued. Use get_agent_logs to see results.`
        }
      ]
    };
  }

  async handleGetAgentStatus(args) {
    const agent = await Agent.findById(args.agent_id);
    if (!agent) {
      throw new Error(`Agent not found: ${args.agent_id}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id: agent.id,
            name: agent.name,
            status: agent.status,
            current_thought: agent.current_thought,
            last_execution: agent.memory?.short_term?.last_execution
          }, null, 2)
        }
      ]
    };
  }

  async handleListBrains() {
    const brains = await Brain.findAll();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(brains.map(b => ({
            id: b.id,
            name: b.name,
            role: b.identity.role,
            expertise: b.identity.expertise,
            model: b.model.provider
          })), null, 2)
        }
      ]
    };
  }

  async handleGetBrain(args) {
    const brain = await Brain.findById(args.brain_id);
    if (!brain) {
      throw new Error(`Brain not found: ${args.brain_id}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(brain, null, 2)
        }
      ]
    };
  }

  async handleListGroups() {
    const groups = await Group.findAll();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(groups, null, 2)
        }
      ]
    };
  }

  async handleCreateGroup(args) {
    const group = new Group(args);
    await group.save();
    return {
      content: [
        {
          type: 'text',
          text: `Group created: ${group.name} (${group.id})`
        }
      ]
    };
  }

  async handleListTools() {
    const tools = toolRegistry.getAllToolDefinitions();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(tools, null, 2)
        }
      ]
    };
  }

  async handleExecuteTool(args) {
    const { tool_name, parameters } = args;
    const result = await toolRegistry.executeTool(tool_name, parameters);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2)
        }
      ]
    };
  }

  async handleGetLogs(args) {
    const logs = await Log.query({
      agent_id: args.agent_id,
      limit: args.limit || 10
    });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(logs, null, 2)
        }
      ]
    };
  }

  setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('SquidMind MCP Server running on stdio');
  }
}

// Run server
const server = new SquidMindMCPServer();
server.run().catch(console.error);
