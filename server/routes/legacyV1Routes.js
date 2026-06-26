'use strict';

/**
 * V1 legacy routes used by the aquarium canvas / older client code.
 *
 * Mounted at /api in server/index.js.
 *
 * GET  /agents                   — list all agents (V1 shape)
 * GET  /agents/:id               — single agent (V1 shape, used by AgentForm)
 * GET  /projects                 — list projects (reads project_memory.json per folder)
 * POST /projects                 — create new project (folder + memory + registry entry)
 * GET  /projects/:name/memory    — read a project's memory.json
 * POST /projects/:name/repair    — recreate missing project_memory.json
 *
 * These exist because the canvas/UI was built before the V2 registry-routes
 * conventions. New code should prefer /api/v2/{agents,projects,...}.
 * Kept isolated here so a future deprecation pass can delete this file alone.
 */

function buildLegacyV1Routes({ rm }) {
  const express = require('express');
  const path = require('path');
  const fs   = require('fs').promises;
  const AQUARIUM = require('../aquarium');
  const Agent = require('../models/Agent');
  const RegistryManager = require('../services/RegistryManager');
  const router = express.Router();

  // Helper: map project name to its on-disk folder. Falls back to upper-casing
  // the name if no registry entry matches.
  async function resolveProjectFolder(name) {
    try {
      const data = JSON.parse(await fs.readFile(AQUARIUM.PROJECT_REGISTRY, 'utf8'));
      for (const [, entry] of Object.entries(data.projects || {})) {
        if (entry.name === name.toUpperCase() || entry.folder === name.toUpperCase()) {
          return entry.folder;
        }
      }
    } catch {}
    return name.toUpperCase();
  }

  // ── GET /agents ───────────────────────────────────────────────────────────
  router.get('/agents', async (req, res) => {
    try {
      const agents = await Agent.findAll();
      res.json({ success: true, agents });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── GET /agents/:id ───────────────────────────────────────────────────────
  router.get('/agents/:id', async (req, res) => {
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

  // ── GET /projects ─────────────────────────────────────────────────────────
  router.get('/projects', async (req, res) => {
    try {
      const projectsDir = AQUARIUM.PROJECTS;
      const folders = await fs.readdir(projectsDir);
      const projects = [];
      for (const folder of folders) {
        const memoryPath = path.join(projectsDir, folder, 'project_memory.json');
        try {
          const memoryData = await fs.readFile(memoryPath, 'utf8');
          const memory = JSON.parse(memoryData);
          projects.push({ name: folder, ...memory });
        } catch {
          // Project folder exists but no memory file
          projects.push({
            name: folder,
            vision: 'No description',
            colors: { outside: '#667eea', inside: '#764ba2' },
          });
        }
      }
      res.json({ success: true, projects });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── POST /projects — create new project ───────────────────────────────────
  router.post('/projects', async (req, res) => {
    try {
      const { name, vision, colors } = req.body;
      if (!name) {
        return res.status(400).json({ success: false, error: 'Project name required' });
      }
      const upperName = name.toUpperCase();

      // 1. Read registry, check for duplicate
      rm.invalidateCache();
      const registry = await rm.read('PROJECTS/project_registry.json');
      for (const existing of Object.values(registry.projects)) {
        if (existing.name === upperName) {
          return res.status(400).json({ success: false, error: `Project "${upperName}" already exists` });
        }
      }

      const nextId = registry.metadata.next_id || 1;
      const projectId = `project_${String(nextId).padStart(3, '0')}`;
      const folderName = RegistryManager.toSlug(upperName);
      const projectDir = path.join(AQUARIUM.PROJECTS, folderName);

      // 2. Create folder + subfolders
      await fs.mkdir(projectDir, { recursive: true });
      await fs.mkdir(path.join(projectDir, 'input'),  { recursive: true });
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
          completion: '0%',
          blockers: [],
          recent_achievements: [],
          next_steps: [],
        },
        architecture: { frontend: {}, backend: {} },
        files: { input: [], output: [] },
        agents_communication: [],
        decisions: [],
        colors: colors || { outside: '#667eea', inside: '#764ba2' },
        created: new Date().toISOString(),
      };
      await fs.writeFile(
        path.join(projectDir, 'project_memory.json'),
        JSON.stringify(projectMemory, null, 2),
        'utf8',
      );

      // 4. Register in project_registry.json
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
          completion_percent: 0,
        },
      };
      registry.metadata.next_id = nextId + 1;
      registry.metadata.last_id_used = nextId;
      registry.metadata.total_active = (registry.metadata.total_active || 0) + 1;

      await rm.write('PROJECTS/project_registry.json', registry);
      await rm.log({
        event_type: 'project_created',
        actor: { type: 'human', id: 'human_user' },
        subject: { type: 'project', id: projectId },
        action: `Created project ${upperName} (${projectId})`,
        context: { folder: folderName, vision: vision || '' },
      });

      res.json({ success: true, project: { ...projectMemory, project_id: projectId, folder: folderName } });
    } catch (error) {
      console.error('[POST /api/projects] error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── GET /projects/:name/memory ────────────────────────────────────────────
  router.get('/projects/:name/memory', async (req, res) => {
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

  // ── POST /projects/:name/repair ───────────────────────────────────────────
  router.post('/projects/:name/repair', async (req, res) => {
    try {
      const projectDir = path.join(AQUARIUM.PROJECTS, req.params.name.toUpperCase());
      const memoryPath = path.join(projectDir, 'project_memory.json');
      try {
        await fs.access(memoryPath);
        return res.json({ success: true, message: 'Project memory already exists' });
      } catch {
        const projectMemory = {
          project: req.params.name.toUpperCase(),
          vision: `${req.params.name} project workspace`,
          goals: [],
          tasks: [],
          progress: {
            completion: '0%',
            blockers: [],
            recent_achievements: [],
            next_steps: [],
          },
          architecture: { frontend: {}, backend: {} },
          files: { input: [], output: [] },
          agents_communication: [],
          decisions: [],
          colors: { outside: '#667eea', inside: '#764ba2' },
          created: new Date().toISOString(),
        };
        await fs.writeFile(memoryPath, JSON.stringify(projectMemory, null, 2), 'utf8');
        res.json({ success: true, message: 'Created missing project_memory.json' });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = { buildLegacyV1Routes };
