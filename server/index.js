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

// === V2 NEURONAL ARCHITECTURE (single shared RegistryManager instance) ===
const RegistryManager = require('./services/RegistryManager');
const { repairAllRegistries } = require('./services/RegistryHealthCheck');

// CRITICAL: validate/repair registries BEFORE any service touches them
const dataRoot = path.join(__dirname, '../data');
const healthReport = repairAllRegistries(dataRoot);
if (healthReport.repaired.length > 0) {
  console.log(`[STARTUP] Repaired ${healthReport.repaired.length} registry file(s):`);
  healthReport.repaired.forEach(r => console.log(`  - ${r.file}: ${r.reason}`));
}
if (healthReport.errors.length > 0) {
  console.error(`[STARTUP] ${healthReport.errors.length} repair errors:`);
  healthReport.errors.forEach(e => console.error(`  - ${e.file}: ${e.error}`));
}

const sharedRm = new RegistryManager(dataRoot);

const buildRegistryRoutes = require('./routes/registryRoutes');
app.use('/api/v2', buildRegistryRoutes(sharedRm));

// === V2 EMERGENCY REPAIR ENDPOINT ===
app.post('/api/v2/repair', (req, res) => {
  try {
    sharedRm.invalidateCache();
    const report = repairAllRegistries(dataRoot);
    res.json({ success: true, ...report });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === V2 HEALTH ENDPOINT ===
app.get('/api/v2/health', async (req, res) => {
  try {
    sharedRm.invalidateCache();
    const checks = {};
    for (const reg of ['main/poseidon_brain.json','agents/agent_registry.json','tasks/tasks_registry.json','projects/project_registry.json','models/model_registry.json','teams/team_registry.json','tools/tool_registry.json','logs/logs.json']) {
      try {
        await sharedRm.read(reg);
        checks[reg] = 'ok';
      } catch (err) {
        checks[reg] = 'error: ' + err.message.slice(0, 100);
      }
    }
    const allOk = Object.values(checks).every(v => v === 'ok');
    res.json({ success: allOk, checks });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// === V2 RESOURCE HEARTBEAT (uses shared RM so writes serialize correctly) ===
const HeartbeatService = require('./services/HeartbeatService');
const heartbeat = new HeartbeatService(sharedRm, 15000);
heartbeat.start();

// === V2 MODEL SERVICE (GGUF loading + Poseidon chat) ===
const V2ModelService = require('./services/V2ModelService');
const { buildRouter: buildModelRouter, buildPoseidonChatRoute } = require('./routes/modelRoutes');
const v2ModelService = new V2ModelService(sharedRm, path.join(__dirname, '../data/models'));
app.use('/api/v2/models', buildModelRouter(v2ModelService));
app.post('/api/v2/poseidon/chat', buildPoseidonChatRoute(v2ModelService));

// Reset Poseidon chat session (clears history, keeps model loaded)
app.post('/api/v2/poseidon/reset-session', async (req, res) => {
  try {
    const result = await v2ModelService.resetPoseidonSession();
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Hook V2ModelService TTL check into heartbeat
const _originalTick = heartbeat.tick.bind(heartbeat);
heartbeat.tick = async function() {
  await _originalTick();
  await v2ModelService.checkTtl();
};

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

// ==================== PROJECT ROUTES ====================

const fs = require('fs').promises;

// List all projects
app.get('/api/projects', async (req, res) => {
  try {
    const projectsDir = path.join(__dirname, '../data/projects');
    const folders = await fs.readdir(projectsDir);
    
    const projects = [];
    for (const folder of folders) {
      const memoryPath = path.join(projectsDir, folder, 'project_memory.json');
      try {
        const memoryData = await fs.readFile(memoryPath, 'utf8');
        const memory = JSON.parse(memoryData);
        projects.push({
          name: folder,
          ...memory
        });
      } catch (err) {
        // Project folder exists but no memory file
        projects.push({
          name: folder,
          vision: 'No description',
          colors: { outside: '#667eea', inside: '#764ba2' }
        });
      }
    }
    
    res.json({ success: true, projects });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create new project
app.post('/api/projects', async (req, res) => {
  try {
    const { name, vision, colors } = req.body;
    
    if (!name) {
      return res.status(400).json({ success: false, error: 'Project name required' });
    }
    
    const upperName = name.toUpperCase();
    
    // 1. Read current registry to figure out next ID
    sharedRm.invalidateCache();
    const registry = await sharedRm.read('projects/project_registry.json');
    
    // Check for duplicate name
    for (const existing of Object.values(registry.projects)) {
      if (existing.name === upperName) {
        return res.status(400).json({ success: false, error: `Project "${upperName}" already exists` });
      }
    }
    
    const nextId = registry.metadata.next_id || 1;
    const projectId = `project_${String(nextId).padStart(3, '0')}`;
    const folderName = `PROJECT_${String(nextId).padStart(3, '0')}`;
    const projectDir = path.join(__dirname, '../data/projects', folderName);
    
    // 2. Create folder + subfolders
    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(path.join(projectDir, 'input'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'output'), { recursive: true });
    
    // 3. Write project_memory.json
    const projectMemory = {
      schema_version: '2.0.0',
      schema_type: 'project_memory',
      project_id: projectId,
      name: upperName,
      registered_in: 'projects/project_registry.json',
      vision: vision || `${upperName} project workspace`,
      goals: [],
      tasks: [],
      progress: {
        completion: "0%",
        blockers: [],
        recent_achievements: [],
        next_steps: []
      },
      architecture: { frontend: {}, backend: {} },
      files: { input: [], output: [] },
      agents_communication: [],
      decisions: [],
      colors: colors || { outside: '#667eea', inside: '#764ba2' },
      created: new Date().toISOString()
    };
    
    await fs.writeFile(
      path.join(projectDir, 'project_memory.json'),
      JSON.stringify(projectMemory, null, 2),
      'utf8'
    );
    
    // 4. Register in project_registry.json (CRITICAL - this is what UI reads)
    registry.projects[projectId] = {
      project_id: projectId,
      name: upperName,
      folder: folderName,
      memory_file: `${folderName}/project_memory.json`,
      status: 'active',
      colors: colors || { outside: '#667eea', inside: '#764ba2' },
      temple_shape: 'classic',
      assigned_agents: [],
      vision: vision || '',
      display_order: Object.keys(registry.projects).length,
      created_at: new Date().toISOString(),
      metrics: {
        tasks_total: 0,
        tasks_completed: 0,
        tasks_pending: 0,
        completion_percent: 0
      }
    };
    registry.metadata.next_id = nextId + 1;
    registry.metadata.last_id_used = nextId;
    registry.metadata.total_active = (registry.metadata.total_active || 0) + 1;
    
    await sharedRm.write('projects/project_registry.json', registry);
    
    // 5. Log
    await sharedRm.log({
      event_type: 'project_created',
      actor: { type: 'human', id: 'human_richard' },
      subject: { type: 'project', id: projectId },
      action: `Created project ${upperName} (${projectId})`,
      context: { folder: folderName, vision: vision || '' }
    });
    
    res.json({ success: true, project: { ...projectMemory, project_id: projectId, folder: folderName } });
  } catch (error) {
    console.error('[POST /api/projects] error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper: map project name (e.g. "AQUARIUM") to folder (e.g. "PROJECT_001")
async function resolveProjectFolder(name) {
  const registryPath = path.join(__dirname, '../data/projects/project_registry.json');
  const data = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  for (const [id, entry] of Object.entries(data.projects)) {
    if (entry.name === name.toUpperCase() || entry.folder === name.toUpperCase()) {
      return entry.folder;
    }
  }
  // Fallback: assume name IS folder
  return name.toUpperCase();
}

// Get project memory
app.get('/api/projects/:name/memory', async (req, res) => {
  try {
    const folder = await resolveProjectFolder(req.params.name);
    const memoryPath = path.join(__dirname, '../data/projects', folder, 'project_memory.json');
    const memoryData = await fs.readFile(memoryPath, 'utf8');
    const memory = JSON.parse(memoryData);
    res.json({ success: true, memory });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update project colors
app.put('/api/projects/:name/colors', async (req, res) => {
  try {
    const { outside, inside } = req.body;
    const folder = await resolveProjectFolder(req.params.name);
    const memoryPath = path.join(__dirname, '../data/projects', folder, 'project_memory.json');
    
    const memoryData = await fs.readFile(memoryPath, 'utf8');
    const memory = JSON.parse(memoryData);
    
    memory.colors = { outside, inside };
    
    await fs.writeFile(memoryPath, JSON.stringify(memory, null, 2), 'utf8');
    
    res.json({ success: true, memory });
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
// DEPRECATED - V2 ModelService handles this automatically. Returns helpful error.
app.post('/api/poseidon/init', async (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Deprecated endpoint. Use /api/v2/models/* to manage models. Poseidon auto-loads its assigned model on first chat.',
    redirect: '/api/v2/models/status'
  });
});

// Poseidon chat endpoint
// DEPRECATED - V2 endpoint /api/v2/poseidon/chat replaces this.
app.post('/api/poseidon/chat', (req, res) => {
  res.status(410).json({
    success: false,
    error: 'Deprecated. Use POST /api/v2/poseidon/chat for streaming chat with brain.json context.',
    redirect: '/api/v2/poseidon/chat'
  });
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
    // Mirror built-in tools to V2 tool_registry.json so AgentForm sees them
    await toolRegistry.syncToRegistryFile(sharedRm);
    
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

// ==================== MODEL MANAGEMENT ROUTES ====================

// Scan for available models
app.get('/api/models/scan', async (req, res) => {
  try {
    console.log('🔍 Scanning for models...');
    const models = await modelManager.listModels();
    console.log(`✅ Found ${models.length} models`);
    
    res.json({
      success: true,
      models: models.map(m => ({
        name: m.name || m.file,
        path: m.full_path,
        size: m.size_mb ? m.size_mb * 1024 * 1024 : 0,
        source: m.source,
        loaded: m.loaded
      }))
    });
  } catch (error) {
    console.error('❌ Model scan error:', error);
    res.json({
      success: false,
      error: error.message,
      models: []
    });
  }
});

// Load a specific model
app.post('/api/models/load', async (req, res) => {
  try {
    const { path: modelPath } = req.body;
    console.log('📥 Loading model:', modelPath);
    
    const model = await modelManager.loadModel(modelPath);
    
    res.json({
      success: true,
      message: 'Model loaded successfully',
      model: {
        path: modelPath
      }
    });
  } catch (error) {
    console.error('❌ Model load error:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// Get loaded models
app.get('/api/models/loaded', (req, res) => {
  try {
    const models = modelManager.getLoadedModels();
    res.json({
      success: true,
      models
    });
  } catch (error) {
    console.error('❌ Get loaded models error:', error);
    res.json({
      success: false,
      error: error.message,
      models: []
    });
  }
});


// File browser endpoint
app.post('/api/files/browse', async (req, res) => {
  try {
    const { path: dirPath } = req.body;
    
    if (!dirPath) {
      return res.status(400).json({ success: false, error: 'Path required' });
    }
    
    // Security: prevent path traversal outside home
    const resolvedPath = path.resolve(dirPath);
    
    try {
      const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
      
      const results = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(resolvedPath, entry.name);
          let size = null;
          
          if (entry.isFile()) {
            try {
              const stats = await fs.stat(entryPath);
              size = stats.size;
            } catch (err) {
              // Ignore stat errors
            }
          }
          
          return {
            name: entry.name,
            path: entryPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size
          };
        })
      );
      
      res.json({ success: true, entries: results });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

console.log('  POST   /api/files/browse   - File browser');

// Brain.json management
const BRAIN_PATH = path.join(__dirname, '../data/brain.json');

app.get('/api/brain', async (req, res) => {
  try {
    const brainData = await fs.readFile(BRAIN_PATH, 'utf8');
    const brain = JSON.parse(brainData);
    res.json({ success: true, brain });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/brain', async (req, res) => {
  try {
    const { brain } = req.body;
    await fs.writeFile(BRAIN_PATH, JSON.stringify(brain, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

console.log('  GET/PUT /api/brain      - Brain.json management');

// Repair missing project JSONs
app.post('/api/projects/:name/repair', async (req, res) => {
  try {
    const projectDir = path.join(__dirname, '../data/projects', req.params.name.toUpperCase());
    const memoryPath = path.join(projectDir, 'project_memory.json');
    
    // Check if project_memory.json exists
    try {
      await fs.access(memoryPath);
      return res.json({ success: true, message: 'Project memory already exists' });
    } catch {
      // Create missing project_memory.json
      const projectMemory = {
        project: req.params.name.toUpperCase(),
        vision: `${req.params.name} project workspace`,
        goals: [],
        tasks: [],
        progress: {
          completion: "0%",
          blockers: [],
          recent_achievements: [],
          next_steps: []
        },
        architecture: {
          frontend: {},
          backend: {}
        },
        files: {
          input: [],
          output: []
        },
        agents_communication: [],
        decisions: [],
        colors: {
          outside: '#667eea',
          inside: '#764ba2'
        },
        created: new Date().toISOString()
      };
      
      await fs.writeFile(memoryPath, JSON.stringify(projectMemory, null, 2), 'utf8');
      res.json({ success: true, message: 'Created missing project_memory.json' });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

console.log('✅ Project repair endpoint added');
