/**
 * Registry API Routes - Express routes for the new neuronal architecture
 * 
 * Exports a factory that accepts the shared RegistryManager instance.
 */

const express = require('express');
const path = require('path');
const RegistryManager = require('../services/RegistryManager');

function buildRouter(sharedRm) {
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
    const filePath = path.join(rm.dataRoot, 'tasks', req.params.id, 'results', 'output.txt');
    const text = await fs.readFile(filePath, 'utf8');
    res.json({ success: true, task_id: req.params.id, result: text });
  } catch (err) {
    if (err.code === 'ENOENT') return res.json({ success: true, task_id: req.params.id, result: null });
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /tasks/:id — hard delete task folder + remove from registry index
router.delete('/tasks/:id', async (req, res) => {
  try {
    const path = require('path');
    const fsp  = require('fs').promises;
    const AQUARIUM = require('../aquarium');
    const taskId = req.params.id;
    // Remove task folder from AQUARIUM.TASKS
    const taskDir = path.join(AQUARIUM.TASKS, taskId);
    try { await fsp.rm(taskDir, { recursive: true, force: true }); } catch {}
    rm.invalidateCache();
    await rm.log({
      event_type: 'task_deleted', severity: 'info',
      actor: { type: 'human', id: 'user' },
      subject: { type: 'task', id: taskId },
      action: `Hard-deleted task ${taskId}`
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

  return router;
}

module.exports = buildRouter;
