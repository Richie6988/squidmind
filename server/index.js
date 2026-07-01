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

const buildRegistryRoutes        = require('./routes/registryRoutes');
const { buildVoiceRoutes }       = require('./routes/voiceRoutes');
const { buildHealthRoutes }      = require('./routes/healthRoutes');
const { buildBackupRoutes }      = require('./routes/backupRoutes');
const { buildPoseidonRoutes }    = require('./routes/poseidonRoutes');
const { buildProjectFileRoutes } = require('./routes/projectFileRoutes');
const { buildLegacyV1Routes }    = require('./routes/legacyV1Routes');
const { buildFilesRoutes }       = require('./routes/filesRoutes');
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


// Hook V2ModelService TTL check + dream into heartbeat
heartbeat.setModelService(v2ModelService);

// Task auto-runner — fires on every heartbeat tick
const TaskRunner = require('./services/TaskRunner');
const taskRunner = new TaskRunner(sharedRm, v2ModelService, agentWorkerPool, botService);
servicesRef.taskRunner = taskRunner;
heartbeat.setTaskRunner(taskRunner);
taskRunner.loadDone().catch(e => console.warn('[TaskRunner] loadDone error:', e.message));

// Mount routes that depend on late-bound taskRunner + v2ModelService (via refs).
app.use('/api/v2',           buildPoseidonRoutes({ rm: sharedRm, refs: servicesRef }));
app.use('/api/v2/projects',  buildProjectFileRoutes({ rm: sharedRm }));
app.use('/api',              buildLegacyV1Routes({ rm: sharedRm }));
app.use('/api/files',        buildFilesRoutes());

const _originalTick = heartbeat.tick.bind(heartbeat);
heartbeat.tick = async function() {
  await _originalTick();
  await v2ModelService.checkTtl();
  await taskRunner.tick().catch(e => console.warn('[TaskRunner] tick error:', e.message));
};

// ==================== VOICE ROUTES ====================
// Mounted via buildVoiceRoutes near top of file.

// ==================== REASONING BUS — live agent/poseidon thought stream ====================
// Lightweight pub/sub. Singleton lives in server/utils/ReasoningBus.js.
const ReasoningBus = require('./utils/ReasoningBus');
global.ReasoningBus = ReasoningBus;  // available to TaskRunner, AgentWorker, etc.

// BotService listens for task lifecycle events → targeted Telegram follow-up
ReasoningBus.addListener(ev => {
  if (ev?.type === 'task_lifecycle') botService.onTaskLifecycle(ev).catch(() => {});
});
// GET /api/v2/reasoning/stream is mounted via buildPoseidonRoutes.

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
// Get a single agent (used by AgentForm.open when editing)
// ==================== PROJECT ROUTES ====================


// List all projects
// Create new project
// Get project memory
// ==================== LOG ROUTES ====================
// All log access goes through /api/v2/logs (registryRoutes). No legacy alias.

// ==================== SYSTEM ROUTES (V2 only) ====================

// ==================== SERVE FRONTEND ====================

// Serve project output files (images, etc.) generated by agents
const dataProjectsPath = AQUARIUM.PROJECTS;

// GET /api/v2/projects/:projectId/outputs — list output files
// GET /api/v2/projects/:projectId/inputs — list input files
// POST /api/v2/projects/:projectId/inputs — upload a file to project input/
// Body: { fileName: string, content: string (base64 or text), encoding: 'base64'|'utf8' }
// DELETE /api/v2/projects/:projectId/inputs/:filename — remove input file
// GET /api/v2/projects/:projectId/inputs/:filename — serve input file  
// GET /api/files/read?path=... — read any file within aquarium or project dirs
// Used by TempleInterior to load input/output file content for display
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

    // Legacy cleanup: old versions created per-task folders TASKS/task_NNNN/.
    // Canonical layout is now TASKS/OUTPUT/<task_id>.<ext> (flat). Sweep any
    // orphan task_* directories at boot so they don't clutter file browsers
    // and don't get mistaken for live data.
    try {
      const entries = await fs.readdir(AQUARIUM.TASKS, { withFileTypes: true }).catch(() => []);
      let removed = 0;
      for (const e of entries) {
        if (e.isDirectory() && /^task_\d+/.test(e.name)) {
          const dp = path.join(AQUARIUM.TASKS, e.name);
          await fs.rm(dp, { recursive: true, force: true }).catch(() => {});
          removed++;
        }
      }
      if (removed > 0) console.log(`[Boot] Cleaned up ${removed} legacy TASKS/task_* folder(s)`);
    } catch { /* non-fatal */ }

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
        console.error('[Shutdown] Hard timeout (6s) — forcing exit');
        process.exit(1);
      }, 6_000);
      hardTimeout.unref();

      // Force-close all open sockets BEFORE httpServer.close().
      // Without this, SSE streams (chat, reasoning) and keep-alive HTTP keep
      // close() blocked forever — which is what triggered the old 15s timeout.
      // closeAllConnections is available in Node 18.2+.
      try {
        if (typeof httpServer.closeAllConnections === 'function') {
          httpServer.closeAllConnections();
        } else if (typeof httpServer.closeIdleConnections === 'function') {
          httpServer.closeIdleConnections();
        }
      } catch (e) { /* not fatal */ }

      // Stop accepting new HTTP connections (drains existing ones — now empty)
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

const BRAIN_PATH = AQUARIUM.POSEIDON_BRAIN;

// Repair missing project JSONs
console.log('✅ Project repair endpoint added');
