/**
 * Registry API Routes - Express routes for the new neuronal architecture
 * 
 * Exports a factory that accepts the shared RegistryManager instance.
 */

const express = require('express');
const path = require('path');
const RegistryManager = require('../services/RegistryManager');

const log = require('../utils/logger').createLogger('registryRoutes');
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

    // Merge brain.appearance + brain.accessories into each registry entry so
    // the canvas (Squid constructor) gets the customization on a single fetch.
    // Without this, squids fall back to defaults and the name shows "undefined"
    // because data.name was never populated (registry stores display_name only).
    await Promise.all(
      Object.entries(registry.agents || {}).map(async ([agentId, entry]) => {
        try {
          if (!entry.brain_file) return;
          const brain = await rm.read(`AGENTS/${entry.brain_file}`).catch(() => null);
          if (!brain) return;
          entry.name = entry.display_name;                                // Squid constructor reads .name
          entry.appearance = brain.appearance || {};
          entry.accessories = brain.appearance?.accessories || null;
        } catch (err) {
          // Brain file missing or unreadable — skip enrichment for this agent,
          // canvas will use defaults rather than the whole endpoint failing.
        }
      })
    );

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
    log.error('[POST /agents] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/projects/:id', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.deleteProject(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    log.error('[DELETE /projects] error:', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({ success: false, error: err.message });
  }
});

router.delete('/agents/:id', async (req, res) => {
  try {
    rm.invalidateCache();
    const result = await rm.deleteAgent(req.params.id);
    res.json({ success: true, ...result });
  } catch (err) {
    log.error('[DELETE /agents] error:', err);
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
    const { status, cancel_running } = req.body;
    if (!status) return res.status(400).json({ success: false, error: 'status required' });
    const task = await rm._readTaskDetails(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    // If the caller is stopping a running task and asked us to abort the
    // underlying generation, signal every warmed entry to stop. TaskRunner's
    // status polling will pick up the new value on its next check.
    if (cancel_running === true) {
      try {
        const ms = req.app.get?.('v2ModelService') || req.app.locals?.v2ModelService;
        if (ms?.loaded) {
          for (const entry of ms.loaded.values()) {
            entry._abortRequested = true;
          }
        }
      } catch { /* non-fatal */ }
    }
    task.lifecycle = { ...(task.lifecycle || {}), status };
    task.status = status;
    if (status === 'in_progress' && !task.lifecycle.started_at) task.lifecycle.started_at = new Date().toISOString();
    if (['completed','failed','cancelled'].includes(status)) task.lifecycle.completed_at = new Date().toISOString();
    await rm._writeTaskDetails(req.params.id, task);
    rm.invalidateCache();
    res.json({ success: true, task_id: req.params.id, status, cancelled: cancel_running === true });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /tasks/:id/sort — Kanban drag-to-reorder within column
router.patch('/tasks/:id/sort', async (req, res) => {
  try {
    const { sort_order } = req.body;
    if (typeof sort_order !== 'number') return res.status(400).json({ success: false, error: 'sort_order (number) required' });
    const task = await rm._readTaskDetails(req.params.id);
    if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
    task.sort_order = sort_order;
    await rm._writeTaskDetails(req.params.id, task);
    rm.invalidateCache();
    res.json({ success: true, task_id: req.params.id, sort_order });
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
// GET /agents/stats — per-agent telemetry aggregated from results_log.
// Answers "which agent actually delivers": completed/failed counts, success
// rate, average duration, last activity. Cheap to compute (results_log is
// small), computed on demand — no background job needed.
router.get('/agents/stats', async (req, res) => {
  try {
    const AQUARIUM = require('../aquarium');
    const fsp = require('fs').promises;
    const path = require('path');
    let rlog = { results: {} };
    try { rlog = JSON.parse(await fsp.readFile(path.join(AQUARIUM.TASKS, 'results_log.json'), 'utf8')); } catch {}
    const entries = Array.isArray(rlog.results) ? rlog.results : Object.values(rlog.results || {});

    // Resolve agent display names
    let agentNames = {};
    try {
      const areg = await rm.read('AGENTS/agent_registry.json');
      for (const [id, a] of Object.entries(areg.agents || {})) agentNames[id] = a.display_name || id;
    } catch {}

    const byAgent = {};
    for (const r of entries) {
      const id = r.assigned_name || 'poseidon';
      const a = byAgent[id] = byAgent[id] || {
        agent_id: id, name: agentNames[id] || id,
        completed: 0, failed: 0, cancelled: 0,
        total_duration_ms: 0, timed: 0, last_at: null,
      };
      if (r.status === 'completed') a.completed++;
      else if (r.status === 'failed') a.failed++;
      else if (r.status === 'cancelled') a.cancelled++;
      if (typeof r.duration_ms === 'number' && r.duration_ms > 0 && r.duration_ms < 86_400_000) {
        a.total_duration_ms += r.duration_ms; a.timed++;
      }
      const at = r.completed_at ? Date.parse(r.completed_at) : 0;
      if (at && (!a.last_at || at > a.last_at)) a.last_at = at;
    }

    const stats = Object.values(byAgent).map(a => {
      const attempts = a.completed + a.failed;
      return {
        agent_id: a.agent_id, name: a.name,
        completed: a.completed, failed: a.failed, cancelled: a.cancelled,
        success_rate: attempts ? Math.round((a.completed / attempts) * 100) : null,
        avg_duration_s: a.timed ? Math.round(a.total_duration_ms / a.timed / 1000) : null,
        last_at: a.last_at ? new Date(a.last_at).toISOString() : null,
      };
    }).sort((x, y) => (y.completed + y.failed) - (x.completed + x.failed));

    res.json({ success: true, ok: true, total_results: entries.length, agents: stats });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/tasks/results', async (req, res) => {
  try {
    const fsp      = require('fs').promises;
    const AQUARIUM = require('../aquarium');
    let rlog = { results: {} };
    try { rlog = JSON.parse(await fsp.readFile(AQUARIUM.RESULTS_LOG, 'utf8')); } catch {}
    res.json({ success: true, results: rlog.results || {} });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /tasks/results — clear ALL results from the log (kanban "clear done").
// Registered before /:id so the bare path doesn't match the param route.
// Optional body { statuses: ["completed"] } limits which statuses are cleared.
router.delete('/tasks/results', async (req, res) => {
  try {
    const fsp      = require('fs').promises;
    const AQUARIUM = require('../aquarium');
    let rlog = { results: {} };
    try { rlog = JSON.parse(await fsp.readFile(AQUARIUM.RESULTS_LOG, 'utf8')); } catch {}
    const statuses = Array.isArray(req.body?.statuses) && req.body.statuses.length
      ? new Set(req.body.statuses) : null;
    let removed = 0;
    if (Array.isArray(rlog.results)) {
      const before = rlog.results.length;
      rlog.results = statuses ? rlog.results.filter(r => !statuses.has(r.status)) : [];
      removed = before - rlog.results.length;
    } else {
      for (const [id, r] of Object.entries(rlog.results || {})) {
        if (!statuses || statuses.has(r.status)) { delete rlog.results[id]; removed++; }
      }
    }
    await fsp.writeFile(AQUARIUM.RESULTS_LOG, JSON.stringify(rlog, null, 2), 'utf8');
    res.json({ success: true, removed });
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

    // 3. Remove output files from TASKS/OUTPUT/ (.md, .json, .png)
    for (const ext of ['md', 'txt', 'json', 'png']) {
      try { await fsp.unlink(path.join(AQUARIUM.OUTPUT, `${taskId}.${ext}`)); } catch {}
    }

    // 4. Remove from results_log.json if present
    try {
      const rlogPath = AQUARIUM.RESULTS_LOG;
      const raw = await fsp.readFile(rlogPath, 'utf8').catch(() => null);
      if (raw) {
        const rlog = JSON.parse(raw);
        if (rlog.results?.[taskId]) {
          delete rlog.results[taskId];
          await fsp.writeFile(rlogPath, JSON.stringify(rlog, null, 2), 'utf8');
        }
      }
    } catch {}
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
    const logs = await rm.read('LOGS/logs.json');
    const limit = parseInt(req.query.limit) || 50;
    res.json({ success: true, metadata: logs.metadata, entries: logs.entries.slice(-limit) });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

// TOOLS
router.get('/tools', async (req, res) => {
  try {
    rm.invalidateCache();
    const registry = await rm.read('TOOLS/tool_registry.json');
    res.json({ success: true, registry });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/tools/:name', async (req, res) => {
  try {
    rm.invalidateCache();
    const spec = await rm.read(`TOOLS/${req.params.name}.json`);
    res.json({ success: true, spec });
  } catch (err) { res.status(404).json({ success: false, error: err.message }); }
});

// MODELS
router.get('/models', async (req, res) => {
  try {
    rm.invalidateCache();
    const registry = await rm.read('MODELS/model_registry.json');
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
    const fsp  = require('fs').promises;
    const fs   = require('fs');
    const path = require('path');
    const AQUARIUM = require('../aquarium');
    const skillId = req.params.id;
    await fsp.unlink(path.join(AQUARIUM.SKILLS, skillId + '.json')).catch(() => {});
    await fsp.unlink(path.join(__dirname, '../skills', skillId + '.json')).catch(() => {});

    // Persist to blocklist so skill is never re-seeded on restart
    const blocklistPath = AQUARIUM.skillsDeletedPath || path.join(AQUARIUM.SKILLS, '.skills_deleted');
    try {
      let deleted = [];
      try { deleted = JSON.parse(fs.readFileSync(blocklistPath, 'utf8')); } catch {}
      if (!deleted.includes(skillId)) {
        deleted.push(skillId);
        await fsp.writeFile(blocklistPath, JSON.stringify(deleted, null, 2), 'utf8');
      }
    } catch {}

    // Rebuild positive registry
    const regPath = path.join(AQUARIUM.SKILLS, 'skills_registry.json');
    try {
      const entries = {};
      for (const f of fs.readdirSync(AQUARIUM.SKILLS)) {
        if (!f.endsWith('.json') || f === 'skills_registry.json') continue;
        try {
          const s = JSON.parse(fs.readFileSync(path.join(AQUARIUM.SKILLS, f), 'utf8'));
          const id = s.skill_id || f.replace('.json', '');
          entries[id] = { skill_id: id, name: s.name || id, version: s.version || 1, file: f };
        } catch {}
      }
      await fsp.writeFile(regPath, JSON.stringify({ skills: entries, updated_at: new Date().toISOString() }, null, 2), 'utf8');
    } catch {}
    res.json({ success: true, deleted: skillId });
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
 *
 * Real-time path: subscribes to ReasoningBus events filtered by task_id.
 * Each 'text' event from the LLM streams immediately as an SSE 'chunk'.
 * Terminates on task_lifecycle status terminal OR client disconnect.
 *
 * Catch-up path: if task is already in a terminal state when the client
 * connects, send the saved output as one chunk and close cleanly. This
 * makes the endpoint useful for reconnects after task completion.
 *
 * Hard timeout: 30 min (the longest BG task we expect).
 */
router.get('/tasks/:id/stream', async (req, res) => {
  const taskId = req.params.id;
  const fs   = require('fs');
  const fsp  = require('fs').promises;
  const ReasoningBus = require('../utils/ReasoningBus');

  res.writeHead(200, {
    'Content-Type':      'text/event-stream',
    'Cache-Control':     'no-cache',
    'Connection':        'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (evt, data) => {
    try { res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`); } catch {}
  };

  send('open', { task_id: taskId });

  const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'archived']);

  // ── Catch-up path: task already done? Send saved output + close ────────────
  let task = null;
  try { task = await rm._readTaskDetails(taskId); } catch {}
  const currentStatus = task?.lifecycle?.status || task?.status || 'open';

  if (TERMINAL.has(currentStatus)) {
    // Send result file content as a single chunk if it exists.
    const outPath = task?.result_file && fs.existsSync(task.result_file)
      ? task.result_file
      : (() => {
          for (const ext of ['txt', 'md', 'json', 'csv']) {
            const p = path.join(AQUARIUM.OUTPUT, `${taskId}.${ext}`);
            if (fs.existsSync(p)) return p;
          }
          return null;
        })();
    if (outPath) {
      try {
        const text = await fsp.readFile(outPath, 'utf8');
        send('chunk', { text });
      } catch {}
    }
    send('done', { status: currentStatus, task_id: taskId });
    return res.end();
  }

  // ── Live path: subscribe to the bus, filter by task_id ─────────────────────
  let timedOut = false;
  const HARD_TIMEOUT_MS = 30 * 60 * 1000;  // 30 min ceiling
  const timer = setTimeout(() => {
    timedOut = true;
    send('done', { reason: 'timeout', task_id: taskId });
    cleanup();
  }, HARD_TIMEOUT_MS);

  // We can't use subscribeForTask alone because we also need task_lifecycle
  // events (which are tagged with task_id), so the per-task filter works.
  const unsubscribe = ReasoningBus.subscribeForTask(taskId, {
    // Adapter: forward bus events to the client as SSE events.
    write: (data) => {
      // data is the bus's `data: ${JSON}\n\n` line. Parse it back so we can
      // re-emit with a typed SSE event name the client already understands.
      try {
        const m = data.match(/^data:\s*(.+?)\n\n$/);
        if (!m) return;
        const ev = JSON.parse(m[1]);
        if (ev.type === 'text' && ev.chunk !== undefined) {
          send('chunk', { text: ev.chunk });
        } else if (ev.type === 'thinking' && ev.chunk !== undefined) {
          send('thinking', { text: ev.chunk });
        } else if (ev.type === 'tool_call') {
          send('tool_call', { name: ev.name, args: ev.args });
        } else if (ev.type === 'tool_result') {
          send('tool_result', { name: ev.name, ok: ev.ok, summary: ev.summary });
        } else if (ev.type === 'task_lifecycle') {
          if (TERMINAL.has(ev.status)) {
            send('done', { status: ev.status, task_id: taskId });
            cleanup();
          }
        }
      } catch {}
    },
  });

  function cleanup() {
    clearTimeout(timer);
    try { unsubscribe(); } catch {}
    if (!timedOut) { try { res.end(); } catch {} }
  }

  req.on('close', cleanup);
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
