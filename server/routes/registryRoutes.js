/**
 * Registry API Routes - Express routes for the new neuronal architecture
 */

const express = require('express');
const path = require('path');
const RegistryManager = require('../services/RegistryManager');

const router = express.Router();
const rm = new RegistryManager(path.join(__dirname, '../../data'));

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
    const agent = await rm.createAgent(req.body);
    res.json({ success: true, agent });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
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

module.exports = router;
