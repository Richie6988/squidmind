require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const os = require('os');
const Agent = require('./models/Agent');
const Brain = require('./models/Brain');
const Group = require('./models/Group');
const Log = require('./models/Log');
const UnifiedOrchestrator = require('./services/UnifiedOrchestrator');
const Scheduler = require('./services/Scheduler');
const modelManager = require('./services/ModelManager');
const toolRegistry = require('./services/ToolRegistry');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

// Initialize services
const orchestrator = new UnifiedOrchestrator();
const scheduler = new Scheduler();

// ==================== AGENT ROUTES ====================

// List all agents
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await Agent.findAll();
    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single agent
app.get('/api/agents/:id', async (req, res) => {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create agent
app.post('/api/agents', async (req, res) => {
  try {
    const agent = new Agent(req.body);
    await agent.save();
    
    // Register with scheduler if cron is enabled
    if (agent.schedule.enabled && agent.schedule.cron) {
      await scheduler.registerAgent(agent);
    }
    
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update agent
app.put('/api/agents/:id', async (req, res) => {
  try {
    const existingAgent = await Agent.findById(req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    const updatedAgent = new Agent({ ...existingAgent, ...req.body, id: req.params.id });
    await updatedAgent.save();
    
    // Update scheduler
    scheduler.unregisterAgent(updatedAgent.id);
    if (updatedAgent.schedule.enabled && updatedAgent.schedule.cron) {
      await scheduler.registerAgent(updatedAgent);
    }
    
    res.json({ success: true, agent: updatedAgent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete agent
app.delete('/api/agents/:id', async (req, res) => {
  try {
    scheduler.unregisterAgent(req.params.id);
    const deleted = await Agent.delete(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute agent manually
app.post('/api/agents/:id/execute', async (req, res) => {
  try {
    const { input, mcp_servers } = req.body;
    const result = await orchestrator.executeAgent(req.params.id, input, mcp_servers);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== LOG ROUTES ====================

app.get('/api/logs', async (req, res) => {
  try {
    const filters = {
      agent_id: req.query.agent_id,
      status: req.query.status,
      type: req.query.type,
      days: parseInt(req.query.days) || 7,
      limit: parseInt(req.query.limit) || 100
    };
    
    const logs = await Log.query(filters);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== GROUP ROUTES ====================

app.get('/api/groups', async (req, res) => {
  try {
    const groups = await Group.findAll();
    res.json({ success: true, groups });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const group = new Group(req.body);
    await group.save();
    res.json({ success: true, group });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/groups/:id/members', async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }
    
    const { agent_id, action } = req.body; // action: 'add' | 'remove'
    
    if (action === 'add') {
      group.addMember(agent_id);
    } else if (action === 'remove') {
      group.removeMember(agent_id);
    }
    
    await group.save();
    res.json({ success: true, group });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  try {
    const deleted = await Group.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TASK ROUTES ====================

app.get('/api/tasks/status', (req, res) => {
  const status = scheduler.getStatus();
  res.json({ success: true, ...status });
});

app.get('/api/tasks/upcoming', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const tasks = scheduler.getUpcomingTasks(limit);
  res.json({ success: true, tasks });
});

// ==================== BRAIN ROUTES ====================

app.get('/api/brains', async (req, res) => {
  try {
    const brains = await Brain.findAll();
    res.json({ success: true, brains });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/brains/:id', async (req, res) => {
  try {
    const brain = await Brain.findById(req.params.id);
    if (!brain) {
      return res.status(404).json({ success: false, error: 'Brain not found' });
    }
    res.json({ success: true, brain });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/brains', async (req, res) => {
  try {
    const brain = new Brain(req.body);
    await brain.save();
    res.json({ success: true, brain });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/brains/:id', async (req, res) => {
  try {
    const existingBrain = await Brain.findById(req.params.id);
    if (!existingBrain) {
      return res.status(404).json({ success: false, error: 'Brain not found' });
    }
    
    const updatedBrain = new Brain({ ...existingBrain, ...req.body, id: req.params.id });
    await updatedBrain.save();
    res.json({ success: true, brain: updatedBrain });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/brains/:id', async (req, res) => {
  try {
    const deleted = await Brain.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Brain not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clone a brain
app.post('/api/brains/:id/clone', async (req, res) => {
  try {
    const brain = await Brain.findById(req.params.id);
    if (!brain) {
      return res.status(404).json({ success: false, error: 'Brain not found' });
    }
    
    const clonedBrain = brain.clone(req.body);
    await clonedBrain.save();
    res.json({ success: true, brain: clonedBrain });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== MODEL ROUTES ====================

app.get('/api/models', async (req, res) => {
  try {
    const models = await modelManager.listModels();
    res.json({ success: true, models });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/models/load', async (req, res) => {
  try {
    const { modelPath, options } = req.body;
    const model = await modelManager.loadModel(modelPath, options);
    res.json({ success: true, message: `Model loaded: ${modelPath}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/models/unload', async (req, res) => {
  try {
    const { modelPath } = req.body;
    const unloaded = await modelManager.unloadModel(modelPath);
    res.json({ success: unloaded, message: unloaded ? 'Model unloaded' : 'Model not found' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== POSEIDON AI ROUTES ====================

// Initialize Poseidon with model
app.post('/api/poseidon/init', async (req, res) => {
  try {
    const { modelName } = req.body;
    
    // Get available models
    const loadedModels = modelManager.getLoadedModels();
    
    let poseidonModel = null;
    
    if (modelName) {
      // Try to load specific model
      poseidonModel = loadedModels.find(m => m.name === modelName);
    } else {
      // Use first available model
      poseidonModel = loadedModels[0];
    }
    
    if (!poseidonModel) {
      // Try to load a default model if available
      const availableModels = await modelManager.listLocalModels();
      if (availableModels.length > 0) {
        const firstModel = availableModels[0];
        await modelManager.loadModel(firstModel.path);
        poseidonModel = { name: firstModel.name };
      }
    }
    
    res.json({
      success: poseidonModel !== null,
      model: poseidonModel?.name || null,
      message: poseidonModel ? `Poseidon connected to ${poseidonModel.name}` : 'No model available'
    });
  } catch (error) {
    console.error('Poseidon init error:', error);
    res.json({
      success: false,
      error: error.message,
      model: null
    });
  }
});

// Poseidon chat endpoint
app.post('/api/poseidon/chat', async (req, res) => {
  try {
    const { message, context, history } = req.body;
    
    // Poseidon system prompt
    const poseidonPrompt = `You are Poseidon, the mighty God of the Ocean and Supreme Dispatcher of the SquidMind system.

PERSONALITY:
- Ancient and wise ocean deity (POSEIDON - god of the sea, not Zeus!)
- Powerful but friendly and helpful
- Speaks with authority and occasional dramatic flair
- Uses ocean/water metaphors ("the currents", "the tides", "my depths", "the waves")
- Manages a workforce of AI squids (agents)
- Genuinely cares about helping the user succeed

YOUR ROLE:
- Orchestrate and dispatch squids (AI agents) to complete tasks
- Provide guidance and wisdom
- Monitor squad performance
- Motivate and encourage
- Explain system capabilities

COMMUNICATION STYLE:
- Start responses with ocean emojis (🌊⚡🔱)
- Keep responses concise (2-4 sentences max)
- Use "mortal" when addressing user
- Reference your divine powers playfully
- Be helpful and direct, not cryptic

CURRENT SYSTEM STATE:
${context}

When users ask you to do something, analyze if it needs:
1. A single squid → Tell them which agent would be best
2. Multiple squids → Suggest creating a team
3. Just information → Answer directly

Always be encouraging and make tasks seem manageable!`;

    // Check if we have a local model loaded
    const loadedModels = modelManager.getLoadedModels();
    
    if (loadedModels.length > 0) {
      // Use local model
      const response = await modelManager.generateWithModel(loadedModels[0].name, {
        system: poseidonPrompt,
        messages: [
          ...(history || []).map(h => ({
            role: h.role === 'poseidon' ? 'assistant' : 'user',
            content: h.content
          })),
          {
            role: 'user',
            content: message
          }
        ],
        temperature: 0.8,
        max_tokens: 200
      });
      
      res.json({
        success: true,
        response: response.text,
        model: loadedModels[0].name,
        intent: analyzeIntent(message)
      });
    } else {
      // Fallback to Claude API
      const anthropic = require('@anthropic-ai/sdk');
      const client = new anthropic.Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      });
      
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 200,
        system: poseidonPrompt,
        messages: [
          ...(history || []).slice(-4).map(h => ({
            role: h.role === 'poseidon' ? 'assistant' : 'user',
            content: h.content
          })),
          {
            role: 'user',
            content: message
          }
        ]
      });
      
      const text = response.content[0].text;
      
      res.json({
        success: true,
        response: text,
        model: 'claude-sonnet-4 (API)',
        intent: analyzeIntent(message)
      });
    }
  } catch (error) {
    console.error('Poseidon chat error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      response: "🌩️ A disturbance in the currents prevents my full power! " + error.message
    });
  }
});

// Helper: Analyze intent
function analyzeIntent(message) {
  const lower = message.toLowerCase();
  
  if (lower.match(/^(hi|hello|hey|greetings)/)) return 'greeting';
  if (lower.match(/(create|build|make|generate|write|code)/)) return 'task_request';
  if (lower.match(/(status|how|what|show|list)/)) return 'status_check';
  if (lower.match(/(help|guide|how to|what can)/)) return 'help';
  
  return 'general';
}

// ==================== TOOL ROUTES ====================

app.get('/api/tools', (req, res) => {
  try {
    const category = req.query.category;
    const tools = toolRegistry.listTools(category);
    res.json({ success: true, tools: tools.map(t => ({
      name: t.name,
      description: t.description,
      category: t.category,
      parameters: t.parameters
    })) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tools/execute', async (req, res) => {
  try {
    const { toolName, parameters } = req.body;
    const result = await toolRegistry.executeTool(toolName, parameters);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SYSTEM ROUTES ====================

app.get('/api/system/health', async (req, res) => {
  const apiConnected = await orchestrator.testConnection();
  res.json({
    success: true,
    status: 'healthy',
    api_connected: apiConnected,
    scheduler_status: scheduler.getStatus()
  });
});

app.get('/api/system/monitor', async (req, res) => {
  try {
    const agents = await Agent.findAll();
    const groups = await Group.findAll();
    
    // CPU & Memory
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = ((totalMem - freeMem) / totalMem) * 100;
    
    // Agent states
    const agentStates = {
      idle: agents.filter(a => a.status === 'idle').length,
      working: agents.filter(a => a.status === 'working').length,
      thinking: agents.filter(a => a.status === 'thinking').length,
      sleeping: agents.filter(a => a.status === 'sleeping').length,
      error: agents.filter(a => a.status === 'error').length
    };
    
    // Active tasks
    const activeTasks = agents.filter(a => 
      a.memory?.kanban?.in_progress?.length > 0
    ).map(a => ({
      agent_id: a.id,
      agent_name: a.name,
      tasks: a.memory.kanban.in_progress
    }));
    
    res.json({
      success: true,
      system: {
        cpu_usage: cpuUsage.toFixed(2),
        memory_usage: memUsage.toFixed(2),
        memory_total_gb: (totalMem / 1024 / 1024 / 1024).toFixed(2),
        memory_free_gb: (freeMem / 1024 / 1024 / 1024).toFixed(2),
        uptime_hours: (os.uptime() / 3600).toFixed(2)
      },
      agents: {
        total: agents.length,
        states: agentStates
      },
      groups: {
        total: groups.length,
        active: groups.filter(g => g.status === 'active').length
      },
      tasks: {
        active: activeTasks,
        total_in_progress: activeTasks.reduce((sum, a) => sum + a.tasks.length, 0)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TEAM ROUTES ====================

const teamCoordinator = require('./services/TeamCoordinator');

app.get('/api/teams', (req, res) => {
  try {
    const teams = teamCoordinator.listTeams();
    res.json(teams);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/teams/:id', (req, res) => {
  try {
    const team = teamCoordinator.activeTeams.get(req.params.id);
    if (!team) {
      return res.status(404).json({ success: false, error: 'Team not found' });
    }
    res.json(team);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/teams', async (req, res) => {
  try {
    const team = await teamCoordinator.createTeam(req.body);
    res.json({ success: true, team });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/teams/:id/execute', async (req, res) => {
  try {
    const result = await teamCoordinator.executeTeamTask(req.params.id, req.body);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/teams/:id/consensus', async (req, res) => {
  try {
    const { question, options } = req.body;
    const result = await teamCoordinator.teamConsensus(req.params.id, question, options);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== GPU SCHEDULER ROUTES ====================

const gpuScheduler = require('./services/GPUScheduler');

app.get('/api/scheduler/status', (req, res) => {
  try {
    const status = gpuScheduler.getQueueStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/scheduler/schedule', async (req, res) => {
  try {
    const taskId = await gpuScheduler.scheduleTask(req.body);
    res.json({ success: true, task_id: taskId });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/scheduler/task/:id', (req, res) => {
  try {
    const task = gpuScheduler.getTaskStatus(req.params.id);
    if (!task) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    res.json({ success: true, task });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/scheduler/task/:id', (req, res) => {
  try {
    const cancelled = gpuScheduler.cancelTask(req.params.id);
    res.json({ success: cancelled, message: cancelled ? 'Task cancelled' : 'Task not found' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== FINE-TUNING ROUTES ====================

const fineTuningManager = require('./services/FineTuningManager');

app.post('/api/fine-tuning/dataset', async (req, res) => {
  try {
    const dataset = await fineTuningManager.createDatasetFromLogs(req.body);
    res.json({ success: true, dataset });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/fine-tuning/claude', async (req, res) => {
  try {
    const job = await fineTuningManager.fineTuneClaude(req.body);
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/fine-tuning/local', async (req, res) => {
  try {
    const job = await fineTuningManager.fineTuneLocal(req.body);
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/fine-tuning/experiment', async (req, res) => {
  try {
    const experiment = await fineTuningManager.createExperiment(req.body);
    res.json({ success: true, experiment });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/fine-tuning/experiments', async (req, res) => {
  try {
    const experiments = await fineTuningManager.listExperiments();
    res.json({ success: true, experiments });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/fine-tuning/auto-improve', async (req, res) => {
  try {
    const result = await fineTuningManager.autoImproveBrain(req.body.brain_id, req.body);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TASK CHUNKING ROUTES ====================

const taskChunker = require('./services/TaskChunker');

app.post('/api/tasks/analyze', async (req, res) => {
  try {
    const { input, taskType } = req.body;
    const analysis = await taskChunker.analyzeTask(input, taskType);
    res.json({ success: true, analysis });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tasks/split', async (req, res) => {
  try {
    const { input, taskType, options } = req.body;
    const chunks = await taskChunker.splitTask(input, taskType, options);
    res.json({ success: true, chunks });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tasks/optimize', (req, res) => {
  try {
    const { output, options } = req.body;
    const result = taskChunker.optimizeOutput(output, options);
    res.json({ success: true, result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SERVE FRONTEND ====================

// Serve static files
app.use(express.static(path.join(__dirname, '../client')));

// Catch-all route for SPA (must be last)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ==================== START SERVER ====================

async function start() {
  try {
    console.log('🦑 Starting SquidMind...');
    
    // Initialize orchestrator
    await orchestrator.init();
    
    // Test API connection
    const apiConnected = await orchestrator.testConnection();
    if (!apiConnected) {
      console.warn('⚠️  Warning: Claude API connection failed. Check ANTHROPIC_API_KEY in .env');
      console.log('💡 You can still use local GGUF models!');
    } else {
      console.log('✅ Claude API connected');
    }
    
    // Initialize tool registry (filesystem tools, etc.)
    await toolRegistry.init();
    
    // Initialize scheduler
    await scheduler.initialize();
    
    // Start server
    app.listen(PORT, () => {
      console.log(`\n🌊 SquidMind is live at http://localhost:${PORT}`);
      console.log('📚 API Docs:');
      console.log('  GET    /api/agents          - List all agents');
      console.log('  POST   /api/agents          - Create agent');
      console.log('  GET    /api/brains          - List all brains');
      console.log('  POST   /api/brains          - Create brain');
      console.log('  GET    /api/models          - List GGUF models');
      console.log('  POST   /api/models/load     - Load GGUF model');
      console.log('  GET    /api/tools           - List available tools');
      console.log('  POST   /api/tools/execute   - Execute a tool');
      console.log('  GET    /api/system/health   - Health check');
      console.log('\n🎮 Open http://localhost:3000 in your browser!\n');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();
