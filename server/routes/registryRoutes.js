/**
 * Registry API Routes - Express routes for the new neuronal architecture
 * 
 * Exports a factory that accepts the shared RegistryManager instance.
 */

const express = require('express');
const path = require('path');
const RegistryManager = require('../services/RegistryManager');

function buildRouter(sharedRm, servicesRef = {}) {
  const router = express.Router();
  const AQUARIUM = require('../aquarium');
  const rm = sharedRm || new RegistryManager(AQUARIUM.ROOT);

// POSEIDON
router.get('/poseidon', async (req, res) => {
  try {
    const brain = await rm.getPoseidonBrain();
    res.json({ success: true, brain });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/poseidon/wake', async (req, res) => {
  try {
    const result = await rm.wakeUp();
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// AGENTS
router.get('/agents', async (req, res) => {
  try {
    rm.invalidateCache();
    const registry = await rm.getAgentRegistry();
    res.json({ success: true, registry });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/agents/:id', async (req, res) => {
  try {
    rm.invalidateCache();
    const agent = await rm.getAgent(req.params.id);
    if (!agent) return res.status(404).json({ success: false, error: 'Agent not found' });
    res.json({ success: true, agent });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/agents', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.createAgent(req.body);
    // Return { success, agent: { agent_id, ... } } for AgentForm
    res.json({ success: true, agent: result });
  } catch (err) {
    console.error('[POST /agents] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.deleteProject(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[DELETE /projects] error:', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ success: false, error: err.message });
  }
});

router.delete('/agents/:id', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.deleteAgent(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[DELETE /agents] error:', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ success: false, error: err.message });
  }
});

// AGENT LIFECYCLE
router.post('/agents/:id/wake', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.wakeAgent(req.params.id, req.body || {});
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/agents/:id/sleep', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.sleepAgent(req.params.id, req.body || {});
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// CHUNK EXECUTION
router.post('/tasks/:id/chunks/start', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.startTaskChunk(req.params.id, req.body);
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/tasks/:id/chunks/:chunkId/report', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.reportChunkComplete(req.params.id, req.params.chunkId, req.body);
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

router.post('/tasks/:id/chunks/:chunkId/decide', async (req, res) => {
  try {
    rm.invalidateCache();
    const { decision, reason } = req.body;
    const result = await rm.approveChunk(req.params.id, req.params.chunkId, decision, reason);
    res.json({ success: true, ...result });
  } catch (err) { res.status(400).json({ success: false, error: err.message }); }
});

// PROJECTS
router.get('/projects', async (req, res) => {
  try {
    rm.invalidateCache();
    const registry = await rm.getProjectRegistry();
    res.json({ success: true, registry });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/projects/:id', async (req, res) => {
  try {
    rm.invalidateCache();
    const project = await rm.getProject(req.params.id);
    if (!project) return res.status(404).json({ success: false, error: 'Project not found' });
    res.json({ success: true, project });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /tasks/:id/status — quick status update used by kanban drag-drop
router.patch('/tasks/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'status required' });
    const task = await rm._readTaskDetails(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    task.lifecycle = { ...(task.lifecycle || {}), status };
    task.status = status;
    if (status === 'in_progress' && !task.lifecycle.started_at) task.lifecycle.started_at = new Date().toISOString();
    if (['completed','failed','cancelled'].includes(status)) task.lifecycle.completed_at = new Date().toISOString();
    await rm._writeTaskDetails(req.params.id, task);
    rm.invalidateCache();
    res.json({ success: true, task_id: req.params.id, status });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// TASKS
router.get('/tasks', async (req, res) => {
  try {
    rm.invalidateCache();
    const registry = await rm.getTasksRegistry();
    res.json({ success: true, registry });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /tasks/results — completed/cancelled task log (slim, for UI Results pane)
router.get('/tasks/results', async (req, res) => {
  try {
    const fsp      = require('fs').promises;
    const AQUARIUM = require('../aquarium');
    let rlog = { results: {} };
    try { rlog = JSON.parse(await fsp.readFile(AQUARIUM.RESULTS_LOG, 'utf8')); } catch {}
    res.json({ success: true, results: rlog.results || {} });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /tasks/results/:id — dismiss a result from the log
router.delete('/tasks/results/:id', async (req, res) => {
  try {
    const fsp      = require('fs').promises;
    const AQUARIUM = require('../aquarium');
    let rlog = { results: {} };
    try { rlog = JSON.parse(await fsp.readFile(AQUARIUM.RESULTS_LOG, 'utf8')); } catch {}
    delete rlog.results[req.params.id];
    await fsp.writeFile(AQUARIUM.RESULTS_LOG, JSON.stringify(rlog, null, 2), 'utf8');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/tasks', async (req, res) => {
  try {
    rm.invalidateCache();
    const task = await rm.createTask(req.body);
    res.json({ success: true, task });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/tasks/:id/result', async (req, res) => {
  try {
    const fs   = require('fs').promises;
    const path = require('path');
    const AQUARIUM = require('../aquarium');
    const taskId = req.params.id;

    // Read task details to get result_file path
    const task = await rm._readTaskDetails(taskId);

    // Try result_file field first (set by TaskRunner on completion)
    if (task?.result_file) {
      try {
        const text = await fs.readFile(task.result_file, 'utf8');
        return res.json({ success: true, task_id: taskId, content: text, path: task.result_file });
      } catch {}
    }

    // Check TASKS/OUTPUT/<taskId>.txt|.json (flat output folder)
    for (const ext of ['txt', 'json', 'md', 'csv']) {
      const outPath = path.join(AQUARIUM.OUTPUT, `${taskId}.${ext}`);
      try {
        const text = await fs.readFile(outPath, 'utf8');
        return res.json({ success: true, task_id: taskId, content: text, path: outPath });
      } catch {}
    }

    // Legacy fallback: old per-folder output.txt
    for (const legPath of [
      path.join(AQUARIUM.TASKS, taskId, 'output.txt'),
      path.join(AQUARIUM.TASKS, taskId, 'results', 'output.txt'),
    ]) {
      try {
        const text = await fs.readFile(legPath, 'utf8');
        return res.json({ success: true, task_id: taskId, content: text, path: legPath });
      } catch {}
    }

    res.json({ success: true, task_id: taskId, content: task?.result_summary || null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /tasks/:id — hard delete task folder + remove from registry index
router.delete('/tasks/:id', async (req, res) => {
  try {
    const path     = require('path');
    const fsp      = require('fs').promises;
    const AQUARIUM = require('../aquarium');
    const taskId   = req.params.id;

    // 1. Remove per-folder task directory (covers per-folder format)
    const taskDir = path.join(AQUARIUM.TASKS, taskId);
    try { await fsp.rm(taskDir, { recursive: true, force: true }); } catch {}

    // 2. Remove from flat tasks_registry.json (covers flat-registry tasks)
    rm.invalidateCache();
    try {
      const flatPath = path.join(AQUARIUM.TASKS, 'tasks_registry.json');
      const raw = await fsp.readFile(flatPath, 'utf8').catch(() => null);
      if (raw) {
        const reg = JSON.parse(raw);
        if (reg.tasks?.[taskId]) {
          delete reg.tasks[taskId];
          await fsp.writeFile(flatPath, JSON.stringify(reg, null, 2), 'utf8');
        }
      }
    } catch {}

    rm.invalidateCache();
    // Tell TaskRunner to never run this task again (in-memory _done set + persist)
    const taskRunner = servicesRef.taskRunner;
    if (taskRunner?.markDeleted) taskRunner.markDeleted(taskId);
    await rm.log({
      event_type: 'task_deleted', severity: 'info',
      actor:   { type: 'human', id: 'user' },
      subject: { type: 'task',  id: taskId },
      action:  `Hard-deleted task ${taskId}`
    });
    res.json({ success: true, task_id: taskId });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/tasks/:id/close', async (req, res) => {
  try {
    rm.invalidateCache();
    const { outcome, ...closureData } = req.body;
    const task = await rm.closeTask(req.params.id, outcome, closureData);
    res.json({ success: true, task });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// LOGS
router.get('/logs', async (req, res) => {
  try {
    rm.invalidateCache();
    const logs = await rm.read('logs/logs.json');
    const limit = parseInt(req.query.limit) || 50;
    res.json({ success: true, metadata: logs.metadata, entries: logs.entries.slice(-limit) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// TOOLS
router.get('/tools', async (req, res) => {
  try {
    rm.invalidateCache();
    const registry = await rm.read('tools/tool_registry.json');
    res.json({ success: true, registry });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/tools/:name', async (req, res) => {
  try {
    rm.invalidateCache();
    const spec = await rm.read(`tools/${req.params.name}.json`);
    res.json({ success: true, spec });
  } catch (err) { res.status(404).json({ success: false, error: err.message }); }
});

// MODELS
router.get('/models', async (req, res) => {
  try {
    rm.invalidateCache();
    const registry = await rm.read('models/model_registry.json');
    res.json({ success: true, registry });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// ==================== GENERIC FIELD UPDATES ====================

/**
 * PATCH any field in any registry file
 * Body: { filePath, fieldPath, newValue, reason }
 */
router.patch('/field', async (req, res) => {
  try {
    const { filePath, fieldPath, newValue, reason } = req.body;
    if (!filePath || !fieldPath) {
      return res.status(400).json({ success: false, error: 'filePath and fieldPath required' });
    }
    rm.invalidateCache();
    const result = await rm.updateField(filePath, fieldPath, newValue, {
      actor: 'human_richard',
      actor_type: 'human',
      reason: reason || 'manual_edit'
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET schema introspection for any registry file
 * Returns field types, read-only paths, enum options
 */
router.get('/schema/{*filePath}', async (req, res) => {
  try {
    rm.invalidateCache();
    const filePath = Array.isArray(req.params.filePath)
      ? req.params.filePath.join('/')
      : req.params.filePath;
    const schema = await rm.getFileSchema(filePath);
    res.json({ success: true, filePath, ...schema });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

/**
 * GET full file contents (for editor to load)
 */
router.get('/file/{*filePath}', async (req, res) => {
  try {
    rm.invalidateCache();
    const filePath = Array.isArray(req.params.filePath)
      ? req.params.filePath.join('/')
      : req.params.filePath;
    const data = await rm.read(filePath);
    res.json({ success: true, filePath, data });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ── SKILLS API ────────────────────────────────────────────────────────────────

/** GET /skills — list all skills from aquarium/SKILLS/ */
router.get('/skills', async (req, res) => {
  try {
    const fs   = require('fs');
    const path = require('path');
    const AQUARIUM = require('../aquarium');
    const dir = AQUARIUM.SKILLS;
    if (!fs.existsSync(dir)) return res.json({ success: true, skills: [] });
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    const skills = [];
    for (const f of files) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        skills.push(s);
      } catch {}
    }
    skills.sort((a, b) => (b.version || 1) - (a.version || 1));
    res.json({ success: true, skills });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/** GET /skills/:id — read single skill */
router.get('/skills/:id', async (req, res) => {
  try {
    const fs   = require('fs');
    const path = require('path');
    const AQUARIUM = require('../aquarium');
    const file = path.join(AQUARIUM.SKILLS, req.params.id + '.json');
    if (!fs.existsSync(file)) return res.status(404).json({ success: false, error: 'Skill not found' });
    res.json({ success: true, skill: JSON.parse(fs.readFileSync(file, 'utf8')) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/** PUT /skills/:id — create or update a skill */
router.put('/skills/:id', async (req, res) => {
  try {
    const fs   = require('fs').promises;
    const path = require('path');
    const AQUARIUM = require('../aquarium');
    await fs.mkdir(AQUARIUM.SKILLS, { recursive: true });
    const file = path.join(AQUARIUM.SKILLS, req.params.id + '.json');
    let version = 1;
    try { version = (JSON.parse(require('fs').readFileSync(file, 'utf8')).version || 1) + 1; } catch {}
    const skill = { ...req.body, skill_id: req.params.id, version, updated_at: new Date().toISOString() };
    await fs.writeFile(file, JSON.stringify(skill, null, 2), 'utf8');
    // Also seed to server/skills/
    const seedFile = path.join(require('path').join(__dirname, '../skills'), req.params.id + '.json');
    await fs.writeFile(seedFile, JSON.stringify(skill, null, 2), 'utf8').catch(() => {});
    res.json({ success: true, skill });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/** DELETE /skills/:id */
router.delete('/skills/:id', async (req, res) => {
  try {
    const fs   = require('fs').promises;
    const path = require('path');
    const AQUARIUM = require('../aquarium');
    const file = path.join(AQUARIUM.SKILLS, req.params.id + '.json');
    await fs.unlink(file);
    res.json({ success: true, deleted: req.params.id });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});


router.get('/file/{*filePath}', async (req, res) => {
  try {
    rm.invalidateCache();
    const filePath = Array.isArray(req.params.filePath)
      ? req.params.filePath.join('/')
      : req.params.filePath;
    const data = await rm.read(filePath);
    res.json({ success: true, filePath, data });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

/**
 * GET /tasks/:id/stream — SSE endpoint for live task output.
 * Polls the output file and pushes new bytes every 1s until task is terminal.
 */
router.get('/tasks/:id/stream', async (req, res) => {
  const taskId = req.params.id;
  const path = require('path');
  const fs   = require('fs');
  const AQUARIUM = require('../aquarium');

  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  const TERMINAL = new Set(['completed','failed','cancelled','archived']);
  let offset = 0;
  let ticks  = 0;
  const MAX_TICKS = 600; // 10 min max

  const send = (evt, data) => {
    try {
      res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  const getOutputPath = async () => {
    try {
      const task = await rm._readTaskDetails(taskId);
      if (task?.result_file && fs.existsSync(task.result_file)) return task.result_file;
    } catch {}
    // Check TASKS/OUTPUT/<taskId>.*
    for (const ext of ['txt', 'json', 'md', 'csv']) {
      const p = path.join(AQUARIUM.OUTPUT, `${taskId}.${ext}`);
      if (fs.existsSync(p)) return p;
    }
    // Legacy per-folder fallback
    const legacyFlat = path.join(AQUARIUM.TASKS, taskId, 'output.txt');
    if (fs.existsSync(legacyFlat)) return legacyFlat;
    return null;
  };

  const poll = async () => {
    ticks++;
    if (ticks > MAX_TICKS) { send('done', { reason: 'timeout' }); return res.end(); }

    // Check task status
    let task = null;
    try { task = await rm._readTaskDetails(taskId); } catch {}
    const status = task?.lifecycle?.status || task?.status || 'open';

    // Stream new output bytes
    const outPath = await getOutputPath();
    if (outPath) {
      try {
        const stat = fs.statSync(outPath);
        if (stat.size > offset) {
          const fd = fs.openSync(outPath, 'r');
          const buf = Buffer.alloc(stat.size - offset);
          fs.readSync(fd, buf, 0, buf.length, offset);
          fs.closeSync(fd);
          offset = stat.size;
          send('chunk', { text: buf.toString('utf8') });
        }
      } catch {}
    }

    if (TERMINAL.has(status)) {
      send('done', { status, task_id: taskId });
      return res.end();
    }

    // Schedule next poll
    setTimeout(poll, 1000);
  };

  // Start polling
  send('open', { task_id: taskId });
  setTimeout(poll, 500);

  // Clean up on client disconnect
  req.on('close', () => { ticks = MAX_TICKS + 1; });
});

// ── PROJECT MEMORY API ────────────────────────────────────────────────────────

/** GET /projects/:id/memory — read project_memory.json */
router.get('/projects/:id/memory', async (req, res) => {
  try {
    const mem = await rm.getProjectMemory(req.params.id);
    if (!mem) return res.status(404).json({ success: false, error: 'Memory file not found' });
    res.json({ success: true, memory: mem });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

/** PATCH /projects/:id/memory — update project memory (section + content) */
router.patch('/projects/:id/memory', async (req, res) => {
  try {
    const { section, content, by } = req.body;
    if (!section || content === undefined) {
      return res.status(400).json({ success: false, error: 'section and content required' });
    }
    const ok = await rm.updateProjectMemory(req.params.id, section, content, by || 'human_user');
    res.json({ success: ok });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

  return router;
}

module.exports = buildRouter;
