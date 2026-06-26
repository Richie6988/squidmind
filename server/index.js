require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs   = require('fs').promises;
const os = require('os');
const Agent = require('./models/Agent');
const toolRegistry = require('./services/ToolRegistry');
const { fetchWithRetry } = require('./utils/fetchWithRetry');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security middleware ────────────────────────────────────────────────────
// CORS: localhost-only by default. To expose, set IAQUA_CORS_ORIGIN=https://example.com
const corsOrigin = process.env.IAQUA_CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: corsOrigin === '*' ? true : corsOrigin.split(',').map(s => s.trim()),
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
}));

// Body limits — protect against memory exhaustion via huge payloads
app.use(bodyParser.json({ limit: '2mb' }));   // most routes need < 100 KB
app.use(bodyParser.urlencoded({ extended: true, limit: '2mb' }));

// Optional token auth: set IAQUA_API_TOKEN to require Bearer token on destructive routes.
// Read-only routes (GET) remain open. POST/PATCH/DELETE require the token when set.
const apiToken = process.env.IAQUA_API_TOKEN || null;
if (apiToken) {
  console.log('[Auth] IAQUA_API_TOKEN set — destructive routes require Bearer token');
  app.use((req, res, next) => {
    // Always allow GET, OPTIONS, HEAD
    if (['GET', 'OPTIONS', 'HEAD'].includes(req.method)) return next();
    // Allow SSE chat endpoint to be reached without token IF on localhost (browser convenience)
    const isLocal = req.ip === '::1' || req.ip === '127.0.0.1' || req.ip?.includes('::ffff:127.0.0.1');
    const isStatic = req.path.startsWith('/scripts/') || req.path.startsWith('/styles/');
    if (isStatic) return next();
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token === apiToken) return next();
    if (isLocal && req.path.startsWith('/api/')) return next(); // localhost dev convenience
    return res.status(401).json({ success: false, error: 'Unauthorized — Bearer token required' });
  });
} else {
  console.log('[Auth] No IAQUA_API_TOKEN set — all routes open (local-only deployment assumed)');
}

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

const buildRegistryRoutes      = require('./routes/registryRoutes');
const { buildVoiceRoutes }     = require('./routes/voiceRoutes');
const { buildHealthRoutes }    = require('./routes/healthRoutes');
const { buildBackupRoutes }    = require('./routes/backupRoutes');
// Services ref — populated after initialization, used by routes that need late-bound services
const servicesRef = { taskRunner: null, v2ModelService: null };
app.use('/api/v2', buildRegistryRoutes(sharedRm, servicesRef));

// Voice + health/recovery routes — stateless, depend only on rm + late-bound v2ModelService via refs.
app.use('/api/v2/voice', buildVoiceRoutes({ rm: sharedRm, fetchWithRetry }));
app.use('/api/v2',       buildHealthRoutes({ rm: sharedRm, repairAllRegistries, dataRoot, refs: servicesRef }));

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

// === BACKUP SERVICE (rolling snapshots of critical aquarium state) ===
const BackupService = require('./services/BackupService');
const backupService = new BackupService(AQUARIUM.ROOT);
backupService.start();

app.use('/api/v2/backups', buildBackupRoutes({ backupService }));

// === V2 MODEL SERVICE (GGUF loading + Poseidon chat) ===
const V2ModelService = require('./services/V2ModelService');
const PoseidonOrchestrator = require('./services/PoseidonOrchestrator');
const { buildRouter: buildModelRouter, buildPoseidonChatRoute, buildAbortRoute } = require('./routes/modelRoutes');
const v2ModelService = new V2ModelService(sharedRm, AQUARIUM.MODELS_DIR);
servicesRef.v2ModelService = v2ModelService;  // late-bound: healthRoutes reads via refs.v2ModelService

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
// GET /api/v2/poseidon/session-state — read last session snapshot for auto-continue
app.get('/api/v2/poseidon/session-state', async (req, res) => {
  try {
    const ss = await sharedRm.read('BRAIN/session_state.json');
    res.json(ss || {});
  } catch { res.json({}); }
});

app.post('/api/v2/poseidon/reset-session', async (req, res) => {
  try {
    const result = await v2ModelService.resetPoseidonSession();
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});


// Hook V2ModelService TTL check + dream into heartbeat
heartbeat.setModelService(v2ModelService);

// Task auto-runner — fires on every heartbeat tick
const TaskRunner = require('./services/TaskRunner');
const taskRunner = new TaskRunner(sharedRm, v2ModelService, agentWorkerPool, botService);
servicesRef.taskRunner = taskRunner;
heartbeat.setTaskRunner(taskRunner);
taskRunner.loadDone().catch(e => console.warn('[TaskRunner] loadDone error:', e.message));

// Signal from chat modal open/close — pauses BG tasks while user is chatting
app.post('/api/v2/poseidon/chat-active', (req, res) => {
  const { active } = req.body;
  taskRunner.setChatActive(!!active);
  res.json({ ok: true, active: !!active });
});

const _originalTick = heartbeat.tick.bind(heartbeat);
heartbeat.tick = async function() {
  await _originalTick();
  await v2ModelService.checkTtl();
  await taskRunner.tick().catch(e => console.warn('[TaskRunner] tick error:', e.message));
};

// ==================== VOICE ROUTES ====================
// Mounted via buildVoiceRoutes near top of file.

// ==================== REASONING BUS — live agent/poseidon thought stream ====================
// Lightweight pub/sub: any server code calls ReasoningBus.push(event) to broadcast to temple UIs.
const ReasoningBus = {
  _clients: new Set(),
  _listeners: new Set(),
  push(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of this._clients) {
      try { res.write(data); } catch {}
    }
    // Server-side listeners (e.g. BotService for Telegram follow-up)
    for (const fn of this._listeners) {
      try { fn(event); } catch (e) { console.warn('[ReasoningBus] listener error:', e.message); }
    }
  },
  subscribe(res) { this._clients.add(res); },
  unsubscribe(res) { this._clients.delete(res); },
  addListener(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); },
};
global.ReasoningBus = ReasoningBus;  // available to TaskRunner, AgentWorker, etc.

// BotService listens for task lifecycle events → targeted Telegram follow-up
// (only if the task was dispatched via the bot itself)
ReasoningBus.addListener(ev => {
  if (ev?.type === 'task_lifecycle') botService.onTaskLifecycle(ev).catch(() => {});
});

// GET /api/v2/reasoning/stream — SSE stream of all agent activity
app.get('/api/v2/reasoning/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.write('data: {"type":"connected"}\n\n');
  ReasoningBus.subscribe(res);
  req.on('close', () => ReasoningBus.unsubscribe(res));
});

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
    const registry = await sharedRm.read('PROJECTS/project_registry.json');
    
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
      registered_in: 'PROJECTS/project_registry.json',
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
    
    await sharedRm.write('PROJECTS/project_registry.json', registry);
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

// ==================== LOG ROUTES ====================
// All log access goes through /api/v2/logs (registryRoutes). No legacy alias.

// ==================== SYSTEM ROUTES (V2 only) ====================

// ==================== SERVE FRONTEND ====================

// Serve project output files (images, etc.) generated by agents
const dataProjectsPath = AQUARIUM.PROJECTS;

// GET /api/v2/projects/:projectId/outputs — list output files
app.get('/api/v2/projects/:projectId/outputs', async (req, res) => {
  const fsp2 = require('fs').promises;
  try {
    const proj = await sharedRm.resolveProjectByNameOrId(req.params.projectId);
    const folder = proj?.entry?.folder || req.params.projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const outputDir = path.join(AQUARIUM.PROJECTS, folder, 'output');
    try {
      const entries = await fsp2.readdir(outputDir, { withFileTypes: true });
      const files = entries.filter(e => e.isFile()).map(e => {
        const fp = path.join(outputDir, e.name);
        let size = 0, mtime = null;
        try { const s = require('fs').statSync(fp); size = s.size; mtime = s.mtime.toISOString(); } catch {}
        return { name: e.name, path: fp, size, mtime };
      });
      res.json({ success: true, files, dir: outputDir });
    } catch {
      res.json({ success: true, files: [], dir: outputDir });
    }
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/v2/projects/:projectId/inputs — list input files
app.get('/api/v2/projects/:projectId/inputs', async (req, res) => {
  const fsp2 = require('fs').promises;
  try {
    const proj = await sharedRm.resolveProjectByNameOrId(req.params.projectId);
    const folder = proj?.entry?.folder || req.params.projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const inputDir = path.join(AQUARIUM.PROJECTS, folder, 'input');
    await fsp2.mkdir(inputDir, { recursive: true });
    const entries = await fsp2.readdir(inputDir, { withFileTypes: true });
    const files = entries.filter(e => e.isFile()).map(e => ({
      name: e.name,
      path: path.join(inputDir, e.name),
      size: (() => { try { return require('fs').statSync(path.join(inputDir, e.name)).size; } catch { return 0; } })()
    }));
    res.json({ success: true, files });
  } catch (e) { res.json({ success: true, files: [], error: e.message }); }
});

// POST /api/v2/projects/:projectId/inputs — upload a file to project input/
// Body: { fileName: string, content: string (base64 or text), encoding: 'base64'|'utf8' }
app.post('/api/v2/projects/:projectId/inputs', express.json({ limit: '50mb' }), async (req, res) => {
  const { fileName, content, encoding = 'utf8' } = req.body;
  if (!fileName || content === undefined) return res.status(400).json({ success: false, error: 'fileName and content required' });
  const safeName = fileName.replace(/[^a-zA-Z0-9._\-\ ()]/g, '_');
  const fsp2 = require('fs').promises;
  try {
    const proj = await sharedRm.resolveProjectByNameOrId(req.params.projectId);
    const folder = proj?.entry?.folder || req.params.projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const inputDir = path.join(AQUARIUM.PROJECTS, folder, 'input');
    await fsp2.mkdir(inputDir, { recursive: true });
    const dest = path.join(inputDir, safeName);
    if (!dest.startsWith(inputDir)) return res.status(403).json({ success: false, error: 'path traversal' });
    const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
    await fsp2.writeFile(dest, buf);
    res.json({ success: true, fileName: safeName, size: buf.length });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE /api/v2/projects/:projectId/inputs/:filename — remove input file
app.delete('/api/v2/projects/:projectId/inputs/:filename', async (req, res) => {
  const safeName = req.params.filename.replace(/[^a-zA-Z0-9._\-\ ()]/g, '_');
  const fsp2 = require('fs').promises;
  try {
    const proj = await sharedRm.resolveProjectByNameOrId(req.params.projectId);
    const folder = proj?.entry?.folder || req.params.projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const filePath = path.join(AQUARIUM.PROJECTS, folder, 'input', safeName);
    if (!filePath.startsWith(AQUARIUM.PROJECTS)) return res.status(403).json({ success: false, error: 'forbidden' });
    await fsp2.unlink(filePath); res.json({ success: true });
  } catch (e) { res.status(404).json({ success: false, error: e.message }); }
});

// GET /api/v2/projects/:projectId/inputs/:filename — serve input file  
app.get('/api/v2/projects/:projectId/inputs/:filename', async (req, res) => {
  const safeName = req.params.filename.replace(/[^a-zA-Z0-9._\-\ ()]/g, '_');
  try {
    const proj = await sharedRm.resolveProjectByNameOrId(req.params.projectId);
    const folder = proj?.entry?.folder || req.params.projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const filePath = path.join(AQUARIUM.PROJECTS, folder, 'input', safeName);
    if (!filePath.startsWith(AQUARIUM.PROJECTS)) return res.status(403).send('Forbidden');
    res.sendFile(filePath, err => { if (err) res.status(404).json({ error: 'Input file not found' }); });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/v2/projects/:projectId/outputs/:filename', async (req, res) => {
  const safeFile = req.params.filename.replace(/[^a-zA-Z0-9._\- ()]/g, '');
  try {
    const proj = await sharedRm.resolveProjectByNameOrId(req.params.projectId);
    const folder = proj?.entry?.folder || req.params.projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const filePath = path.join(AQUARIUM.PROJECTS, folder, 'output', safeFile);
    if (!filePath.startsWith(AQUARIUM.PROJECTS)) return res.status(403).send('Forbidden');
    res.sendFile(filePath, err => { if (err) res.status(404).json({ error: 'Output file not found' }); });
  } catch (e) { res.status(500).json({ error: e.message }); }
});;

// GET /api/files/read?path=... — read any file within aquarium or project dirs
// Used by TempleInterior to load input/output file content for display
app.get('/api/files/read', async (req, res) => {
  const reqPath = req.query.path;
  if (!reqPath) return res.status(400).json({ error: 'path required' });
  const fsp2 = require('fs').promises;
  // Resolve absolute path — allow aquarium root and project dirs
  let absPath = reqPath;
  if (!path.isAbsolute(absPath)) {
    absPath = path.join(AQUARIUM.ROOT, reqPath);
  }
  // Security: must be inside aquarium root
  const resolved = path.resolve(absPath);
  if (!resolved.startsWith(path.resolve(AQUARIUM.ROOT))) {
    return res.status(403).json({ error: 'Access denied: path outside aquarium' });
  }
  try {
    const ext = path.extname(resolved).toLowerCase();
    const isImage = ['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp'].includes(ext);
    if (isImage) {
      return res.sendFile(resolved, err => {
        if (err) res.status(404).json({ error: 'File not found: ' + resolved });
      });
    }
    const content = await fsp2.readFile(resolved, 'utf8');
    res.json({ content });
  } catch (e) {
    res.status(404).json({ error: 'File not found: ' + e.message, path: resolved });
  }
});

// Serve static files — disable caching for JS/CSS so changes reload immediately
app.use(express.static(path.join(__dirname, '../client'), {
  setHeaders(res, filePath) {
    if (/\.(js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

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
    const httpServer = app.listen(PORT, () => {
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

    // ── Graceful shutdown ─────────────────────────────────────────────────
    let shuttingDown = false;
    async function gracefulShutdown(signal) {
      if (shuttingDown) {
        console.log(`[Shutdown] Already shutting down — second ${signal} forces exit`);
        process.exit(1);
      }
      shuttingDown = true;
      console.log(`\n[Shutdown] ${signal} received — beginning graceful shutdown…`);
      const startMs = Date.now();
      const hardTimeout = setTimeout(() => {
        console.error('[Shutdown] Hard timeout (15s) — forcing exit');
        process.exit(1);
      }, 15_000);
      hardTimeout.unref();

      // Stop accepting new HTTP connections (drains existing ones)
      try {
        await new Promise(r => httpServer.close(r));
        console.log('[Shutdown] ✓ HTTP server closed');
      } catch (e) { console.warn('[Shutdown] HTTP close error:', e.message); }

      // Stop heartbeat (prevents new dream/audit/planner triggers)
      try { heartbeat.stop?.(); console.log('[Shutdown] ✓ Heartbeat stopped'); }
      catch (e) { console.warn('[Shutdown] Heartbeat stop error:', e.message); }

      // Stop backup service
      try { backupService.stop?.(); console.log('[Shutdown] ✓ Backup service stopped'); }
      catch (e) { console.warn('[Shutdown] Backup stop error:', e.message); }

      // Final snapshot before exit
      try {
        await backupService.snapshot('hourly');
        console.log('[Shutdown] ✓ Final backup snapshot taken');
      } catch (e) { console.warn('[Shutdown] Final snapshot error:', e.message); }

      // Stop bot polling
      try { await botService.stop?.(); console.log('[Shutdown] ✓ Bot stopped'); }
      catch (e) { console.warn('[Shutdown] Bot stop error:', e.message); }

      // Persist _done set (in-memory completed task IDs)
      try { await taskRunner._saveDone?.(); console.log('[Shutdown] ✓ _done.json persisted'); }
      catch (e) { console.warn('[Shutdown] _done persist error:', e.message); }

      // Flush any pending registry writes (writeLocks chain)
      try {
        const locks = Array.from(sharedRm.writeLocks?.values?.() || []);
        if (locks.length) {
          console.log(`[Shutdown] Waiting for ${locks.length} pending registry write(s)…`);
          await Promise.allSettled(locks);
        }
        console.log('[Shutdown] ✓ Registry writes flushed');
      } catch (e) { console.warn('[Shutdown] Registry flush error:', e.message); }

      // Unload all models (disposes LlamaContext + ChatSession, frees VRAM)
      try {
        const loaded = Array.from(v2ModelService.loaded?.keys?.() || []);
        for (const id of loaded) {
          await v2ModelService.unloadModel(id).catch(e =>
            console.warn(`[Shutdown] unload ${id}:`, e.message));
        }
        console.log(`[Shutdown] ✓ Unloaded ${loaded.length} model(s)`);
      } catch (e) { console.warn('[Shutdown] Model unload error:', e.message); }

      clearTimeout(hardTimeout);
      console.log(`[Shutdown] ✓ Complete in ${Date.now() - startMs}ms — exiting cleanly`);
      process.exit(0);
    }

    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
      console.error('[FATAL] Uncaught exception:', err);
      gracefulShutdown('uncaughtException').catch(() => process.exit(1));
    });
    process.on('unhandledRejection', (reason) => {
      console.error('[FATAL] Unhandled rejection:', reason);
      // Don't shutdown on unhandled rejection — too easy to trigger from a single bad fetch
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
