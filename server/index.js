require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs   = require('fs').promises;
const os = require('os');
const Agent = require('./models/Agent');
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
// Path detection is handled by server/aquarium.js — single source of truth
const AQUARIUM = require('./aquarium');
const dataRoot = AQUARIUM.ROOT;
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
    for (const reg of ['main/poseidon_brain.json','agents/agent_registry.json','tasks/tasks_registry.json','projects/project_registry.json','models/model_registry.json','tools/tool_registry.json','logs/logs.json']) {
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

// === SERVER LIFECYCLE (auto-shutdown when webapp closes) ===
// Client sends POST /api/v2/heartbeat every 10s while the page is open.
// If no heartbeat for `SHUTDOWN_AFTER_MS`, server exits.
// Brief reload gaps (<30s) won't trigger shutdown.
const SHUTDOWN_AFTER_MS = 60000;  // 60s of silence -> exit
let lastHeartbeatAt = Date.now();
let shutdownTimer = null;
let serverHasReceivedFirstHeartbeat = false;

app.post('/api/v2/heartbeat', (req, res) => {
  lastHeartbeatAt = Date.now();
  if (!serverHasReceivedFirstHeartbeat) {
    serverHasReceivedFirstHeartbeat = true;
    console.log('[lifecycle] First client heartbeat received - auto-shutdown armed.');
  }
  res.json({ success: true, server_uptime_seconds: Math.floor(process.uptime()) });
});

// Check every 20s if we should shut down
setInterval(() => {
  if (!serverHasReceivedFirstHeartbeat) return; // never armed
  const silenceMs = Date.now() - lastHeartbeatAt;
  if (silenceMs > SHUTDOWN_AFTER_MS) {
    if (!shutdownTimer) {
      console.log(`[lifecycle] No heartbeat for ${Math.floor(silenceMs/1000)}s. Webapp appears closed. Shutting down in 5s.`);
      shutdownTimer = setTimeout(() => {
        console.log('[lifecycle] Goodbye.');
        process.exit(0);
      }, 5000);
    }
  } else if (shutdownTimer) {
    // Heartbeat came back during grace - cancel
    console.log('[lifecycle] Heartbeat resumed - cancelling shutdown.');
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }
}, 20000);

// === V2 RESOURCE HEARTBEAT (uses shared RM so writes serialize correctly) ===
const HeartbeatService = require('./services/HeartbeatService');
const heartbeat = new HeartbeatService(sharedRm, 15000);
heartbeat.start();

// === V2 MODEL SERVICE (GGUF loading + Poseidon chat) ===
const V2ModelService = require('./services/V2ModelService');
const PoseidonOrchestrator = require('./services/PoseidonOrchestrator');
const { buildRouter: buildModelRouter, buildPoseidonChatRoute, buildAbortRoute } = require('./routes/modelRoutes');
const v2ModelService = new V2ModelService(sharedRm, AQUARIUM.MODELS_DIR);

// Orchestrator: gives Poseidon its identity prompt + function-calling tools.
// Set BEFORE first chat so the model sees its full toolset.
const poseidonOrchestrator = new PoseidonOrchestrator({
  registryManager: sharedRm,
  modelService: v2ModelService,
});
v2ModelService.setOrchestrator(poseidonOrchestrator);

// === AGENT WORKER POOL ===
const { AgentWorkerPool } = require('./services/AgentWorker');
const { buildAgentRunRoutes } = require('./routes/agentRoutes');
const agentWorkerPool = new AgentWorkerPool(sharedRm, v2ModelService, toolRegistry);
app.use('/api/v2/agents', buildAgentRunRoutes(agentWorkerPool));
// Expose pool to Poseidon orchestrator for dispatch_to_agent tool
poseidonOrchestrator.setAgentWorkerPool(agentWorkerPool);

// === BOT SERVICE (Telegram / Discord remote comms) ===
const BotService = require('./services/BotService');
const { buildCommsRoutes } = require('./routes/commsRoutes');
const botService = new BotService(sharedRm, v2ModelService);
app.use('/api/v2/comms', buildCommsRoutes(botService));
// Start bots after server is listening (wired below in app.listen callback)

app.use('/api/v2/models', buildModelRouter(v2ModelService));
app.post('/api/v2/poseidon/chat', buildPoseidonChatRoute(v2ModelService));
app.post('/api/v2/poseidon/abort', buildAbortRoute(v2ModelService));

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
// ==================== AGENT ROUTES (V1 reads, kept for canvas) ====================

// List all agents
// Get single agent
// Create agent
// Update agent
// Delete agent
// Execute agent manually
// ==================== AGENT ROUTES (V1 reads only - canvas reads from registry) ====================

// List all agents (used by aquarium canvas + ui.getAgents)
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await Agent.findAll();
    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get a single agent (used by AgentForm.open when editing)
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

// ==================== PROJECT ROUTES ====================


// List all projects
app.get('/api/projects', async (req, res) => {
  try {
    const projectsDir = AQUARIUM.PROJECTS;
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
    // Use slug of project name for folder — more intuitive than PROJECT_001
    const folderName = RegistryManager.toSlug(upperName);
    const projectDir = path.join(AQUARIUM.PROJECTS, folderName);
    
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
    await sharedRm.log({
      event_type: 'project_created',
      actor: { type: 'human', id: 'human_user' },
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
  const registryPath = AQUARIUM.PROJECT_REGISTRY;
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
    const memoryPath = path.join(AQUARIUM.PROJECTS, folder, 'project_memory.json');
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
    const memoryPath = path.join(AQUARIUM.PROJECTS, folder, 'project_memory.json');
    
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

// /api/logs - thin alias to V2 logs registry (kept for legacy UI)
app.get('/api/logs', async (req, res) => {
  try {
    sharedRm.invalidateCache();
    const data = await sharedRm.read('logs/logs.json').catch(() => ({ logs: [] }));
    const logs = Array.isArray(data?.logs) ? data.logs : [];
    const limit = parseInt(req.query.limit) || 100;
    res.json({ success: true, logs: logs.slice(-limit).reverse() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SYSTEM ROUTES (V2 only) ====================

// ==================== SERVE FRONTEND ====================

// Serve project output files (images, etc.) generated by agents
const dataProjectsPath = AQUARIUM.PROJECTS;

// GET /api/v2/projects/:projectId/outputs — list output files
app.get('/api/v2/projects/:projectId/outputs', async (req, res) => {
  const safeProject = req.params.projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const outputDir = path.join(dataProjectsPath, safeProject, 'outputs');
  try {
    const entries = await require('fs').promises.readdir(outputDir, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile())
      .map(e => ({
        name: e.name,
        path: path.join(outputDir, e.name),
        size: (() => { try { const s = require('fs').statSync(path.join(outputDir, e.name)); return `${(s.size/1024).toFixed(1)} KB`; } catch { return ''; } })()
      }));
    res.json({ success: true, files });
  } catch {
    res.json({ success: true, files: [] }); // empty dir / not yet created
  }
});

app.get('/api/v2/projects/:projectId/outputs/:filename', (req, res) => {
  const { projectId, filename } = req.params;
  // Sanitize to prevent path traversal
  const safeProject = projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '');
  const safeFile    = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  const filePath = path.join(dataProjectsPath, safeProject, 'outputs', safeFile);
  if (!filePath.startsWith(dataProjectsPath)) return res.status(403).send('Forbidden');
  res.sendFile(filePath, err => {
    if (err) res.status(404).json({ error: 'Output file not found', path: filePath });
  });
});

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

    // Ensure Aquarium directory structure exists
    const _dirs = [AQUARIUM.MODELS, AQUARIUM.AGENTS, AQUARIUM.PROJECTS, AQUARIUM.TASKS,
                   AQUARIUM.LOGS, AQUARIUM.TOOLS, AQUARIUM.SKILLS, AQUARIUM.BRAIN, AQUARIUM.CHANNELS];
    for (const dir of _dirs) {
      await fs.mkdir(dir, { recursive: true }).catch(() => {});
    }

    // Initialize tool registry (filesystem tools, etc.)
    await toolRegistry.init();
    // Mirror built-in tools to V2 tool_registry.json so AgentForm sees them
    await toolRegistry.syncToRegistryFile(sharedRm);
    // Start server
    app.listen(PORT, () => {
      // Start bots after port is bound
      botService.start().catch(err => console.warn('[BotService] startup error:', err.message));
      console.log(`\n🌊 SquidMind is live at http://localhost:${PORT}`);
      console.log('📚 Active routes:');
      console.log('  /api/v2/*                   - Registry-backed routes (V2)');
      console.log('  /api/v2/poseidon/chat       - Streaming chat (SSE)');
      console.log('  /api/v2/models/*            - Model library + load');
      console.log('  /api/agents (GET only)      - Canvas reads agents from registry');
      console.log('  /api/projects (GET/POST)    - Project listing + creation');
      console.log('\n🎮 Open http://localhost:3000 in your browser!\n');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();

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

const BRAIN_PATH = AQUARIUM.POSEIDON_BRAIN;

// Repair missing project JSONs
app.post('/api/projects/:name/repair', async (req, res) => {
  try {
    const projectDir = path.join(AQUARIUM.PROJECTS, req.params.name.toUpperCase());
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
