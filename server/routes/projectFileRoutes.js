'use strict';

/**
 * V2 project input/output files.
 *
 * Mounted at /api/v2/projects in server/index.js.
 *
 * GET    /:projectId/outputs              — list output files (metadata only)
 * GET    /:projectId/outputs/:filename    — serve an output file
 * GET    /:projectId/inputs               — list input files
 * GET    /:projectId/inputs/:filename     — serve an input file
 * POST   /:projectId/inputs               — upload a file (body: { fileName, content, encoding? })
 * DELETE /:projectId/inputs/:filename     — remove an input file
 *
 * Filenames are sanitized server-side; final paths are checked to stay
 * inside the project folder (no path traversal).
 */

function buildProjectFileRoutes({ rm }) {
  const express = require('express');
  const path = require('path');
  const fs   = require('fs');
  const fsp  = require('fs').promises;
  const AQUARIUM = require('../aquarium');
  const router  = express.Router();

  const sanitize = (name) => String(name || '').replace(/[^a-zA-Z0-9._\- ()]/g, '_');

  // ── PATCH /:projectId/auto-analyze — toggle input auto-analysis ──────────
  // ON: baselines the existing input files first (no task storm for the
  // archive already sitting there), then every NEW drop spawns an analysis
  // task. OFF: the watcher simply skips the project.
  router.patch('/:projectId/auto-analyze', express.json({ limit: '8kb' }), async (req, res) => {
    try {
      const enabled = !!req.body?.enabled;
      const proj = await rm.resolveProjectByNameOrId(req.params.projectId);
      if (!proj?.entry) return res.status(404).json({ success: false, error: 'project not found' });
      const preg = await rm.getProjectRegistry();
      const p = preg.projects?.[proj.entry.project_id];
      if (!p) return res.status(404).json({ success: false, error: 'project not in registry' });
      p.auto_analyze = enabled;
      await rm.write('PROJECTS/project_registry.json', preg);
      let baselined = 0;
      if (enabled) {
        const watcher = req.app.get?.('inputWatcher') || global.__inputWatcher;
        if (watcher?.baseline) baselined = await watcher.baseline(p.folder || proj.entry.folder);
      }
      res.json({ success: true, auto_analyze: enabled, baselined });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ── POST /:projectId/exec — project-scoped terminal command ───────────────
  // Free-form bash from the temple TERMINAL. Trust model = execute_bash;
  // routed THROUGH BashExecutor so both paths share the danger-pattern
  // gate, the venv-first PATH, timeouts and output caps. cwd = the project
  // folder root (so `ls output/`, `python output/x.py`, `git …` all work).
  router.post('/:projectId/exec', express.json({ limit: '32kb' }), async (req, res) => {
    try {
      const { command } = req.body || {};
      if (!command || typeof command !== 'string') return res.status(400).json({ success: false, error: 'command required' });
      if (command.length > 4000) return res.status(400).json({ success: false, error: 'command too long (4KB max)' });
      const folder = await resolveFolder(req.params.projectId);
      const projDir = path.join(AQUARIUM.PROJECTS, folder);
      if (!fs.existsSync(projDir)) return res.status(404).json({ success: false, error: 'project folder not found' });
      const { BashExecutor } = require('../services/BashExecutor');
      const bash = new BashExecutor();
      const r = await bash.run({ command, cwd: projDir, timeout_ms: 60_000, actor: 'user' });
      res.json({ success: true, ...r });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ── POST /:projectId/run — execute a Python output/input file ─────────────
  // Manual "RUN" from the temple IDE. Trust model = execute_bash (local
  // machine trusted); the guards here are for STABILITY and containment:
  //   - .py files only (HTML runs client-side in the sandboxed preview iframe)
  //   - path forced inside the project folder (no traversal)
  //   - cwd = the file's own directory → relative reads/writes stay in-project
  //   - 60s SIGKILL timeout, 256KB combined output cap
  //   - python3 -I (isolated: no user site-packages injection, no PYTHONPATH)
  router.post('/:projectId/run', express.json({ limit: '32kb' }), async (req, res) => {
    try {
      const { filename, dir = 'output' } = req.body || {};
      if (!filename) return res.status(400).json({ success: false, error: 'filename required' });
      const isPy = /\.py$/i.test(filename);
      const isSh = /\.sh$/i.test(filename);
      if (!isPy && !isSh) return res.status(400).json({ success: false, error: 'Only .py and .sh files run server-side. HTML renders in the preview panel.' });
      if (!['output', 'input'].includes(dir)) return res.status(400).json({ success: false, error: 'dir must be output|input' });
      const folder  = await resolveFolder(req.params.projectId);
      const baseDir = path.join(AQUARIUM.PROJECTS, folder, dir);
      const target  = path.join(baseDir, sanitize(filename));
      if (!target.startsWith(baseDir + path.sep)) return res.status(400).json({ success: false, error: 'path traversal blocked' });
      if (!fs.existsSync(target)) return res.status(404).json({ success: false, error: `${filename} not found in ${dir}/` });

      const { spawn } = require('child_process');
      const pyenv = require('../services/PyEnvService');
      // Both interpreters get the venv-first PATH so `python` inside a .sh
      // resolves to the IAQUA venv — same environment everywhere.
      const venvEnv = (() => {
        const base = { ...process.env };
        const venvBin = path.join(__dirname, '..', '..', '.pyenv', 'bin');
        if (fs.existsSync(path.join(venvBin, 'python'))) {
          base.PATH = `${venvBin}:${base.PATH || ''}`;
          base.VIRTUAL_ENV = path.dirname(venvBin);
        }
        return base;
      })();
      let bin, args, label;
      if (isPy) {
        ({ bin, preArgs: args, label } = pyenv.pythonInvocation());
        args = [...args, target];
      } else {
        bin = '/bin/bash'; args = [target]; label = 'bash' + (venvEnv.VIRTUAL_ENV ? ' (venv PATH)' : '');
      }
      const t0 = Date.now();
      const child = spawn(bin, args, { cwd: baseDir, stdio: ['ignore', 'pipe', 'pipe'], env: venvEnv });
      let out = '', err = '', truncated = false, killed = false;
      const CAP = 256 * 1024;
      const clamp = () => { if (out.length + err.length > CAP) { truncated = true; try { child.kill('SIGKILL'); } catch {} } };
      child.stdout.on('data', d => { out += d; clamp(); });
      child.stderr.on('data', d => { err += d; clamp(); });
      const killer = setTimeout(() => { killed = true; try { child.kill('SIGKILL'); } catch {} }, 60_000);
      child.on('close', (code) => {
        clearTimeout(killer);
        res.json({
          success: true,
          exit_code: code,
          interpreter: label,
          killed_by: killed ? 'timeout (60s)' : (truncated ? 'output cap (256KB)' : null),
          duration_ms: Date.now() - t0,
          stdout: out.slice(0, CAP),
          stderr: err.slice(0, 64 * 1024),
        });
      });
      child.on('error', (e) => {
        clearTimeout(killer);
        res.json({ success: false, error: `spawn failed: ${e.message} (is python3 installed?)` });
      });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Resolve project folder via the canonical resolver. Falls back to a slugged
  // form of the URL parameter so missing projects still get a deterministic dir.
  const resolveFolder = async (projectId) => {
    const proj = await rm.resolveProjectByNameOrId(projectId);
    return proj?.entry?.folder || projectId.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  };

  // ── GET /:projectId/outputs — list output files ───────────────────────────
  router.get('/:projectId/outputs', async (req, res) => {
    try {
      const folder = await resolveFolder(req.params.projectId);
      const outputDir = path.join(AQUARIUM.PROJECTS, folder, 'output');
      try {
        const entries = await fsp.readdir(outputDir, { withFileTypes: true });
        const files = entries.filter(e => e.isFile()).map(e => {
          const fp = path.join(outputDir, e.name);
          let size = 0, mtime = null;
          try { const s = fs.statSync(fp); size = s.size; mtime = s.mtime.toISOString(); } catch {}
          return { name: e.name, path: fp, size, mtime };
        });

        // Attach the owning task: file appears in task.files_written, or
        // its name embeds an id like "task_0234" — either binds it to a
        // real card so the UI can jump straight to context.
        try {
          const treg  = await rm.getTasksRegistry().catch(() => ({ tasks: {} }));
          const rlog  = await rm.read('LOGS/results_log.json').catch(() => ({ results: {} }));
          const allTasks = { ...(treg.tasks || {}), ...(rlog.results || {}) };
          const byFile = new Map();
          for (const t of Object.values(allTasks)) {
            for (const w of (t.files_written || [])) byFile.set(w.split('/').pop(), t);
          }
          for (const f of files) {
            const t = byFile.get(f.name) || Object.values(allTasks).find(x => f.name.startsWith(String(x.task_id || '')));
            if (t) {
              f.task_id    = t.task_id;
              f.task_title = t.title;
              f.task_status = t.lifecycle?.status || t.status || null;
              f.task_review = t.review || null;
            }
          }
        } catch { /* linking is best-effort */ }

        // Sort by mtime desc so newest work is at the top — Richard's ask.
        files.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''));
        res.json({ success: true, files, dir: outputDir });
      } catch {
        res.json({ success: true, files: [], dir: outputDir });
      }
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // ── GET /:projectId/inputs — list input files ─────────────────────────────
  router.get('/:projectId/inputs', async (req, res) => {
    try {
      const folder = await resolveFolder(req.params.projectId);
      const inputDir = path.join(AQUARIUM.PROJECTS, folder, 'input');
      await fsp.mkdir(inputDir, { recursive: true });
      const entries = await fsp.readdir(inputDir, { withFileTypes: true });
      const files = entries.filter(e => e.isFile()).map(e => ({
        name: e.name,
        path: path.join(inputDir, e.name),
        size: (() => { try { return fs.statSync(path.join(inputDir, e.name)).size; } catch { return 0; } })(),
      }));
      res.json({ success: true, files });
    } catch (e) { res.json({ success: true, files: [], error: e.message }); }
  });

  // ── POST /:projectId/inputs — upload a file ───────────────────────────────
  router.post('/:projectId/inputs', express.json({ limit: '50mb' }), async (req, res) => {
    const { fileName, content, encoding = 'utf8' } = req.body || {};
    if (!fileName || content === undefined) {
      return res.status(400).json({ success: false, error: 'fileName and content required' });
    }
    const safeName = sanitize(fileName);
    try {
      const folder = await resolveFolder(req.params.projectId);
      const inputDir = path.join(AQUARIUM.PROJECTS, folder, 'input');
      await fsp.mkdir(inputDir, { recursive: true });
      const dest = path.join(inputDir, safeName);
      if (!dest.startsWith(inputDir)) {
        return res.status(403).json({ success: false, error: 'path traversal' });
      }
      const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
      await fsp.writeFile(dest, buf);
      res.json({ success: true, fileName: safeName, size: buf.length });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ── POST /:projectId/outputs — write/overwrite an output file ─────────────
  // Symmetric to POST /inputs. The temple IDE edits output files (generated
  // artifacts) far more often than inputs, and without this route those
  // saves 404'd silently — the editor showed "Saved" but nothing was
  // written. Writes into PROJECTS/<folder>/output/.
  router.post('/:projectId/outputs', express.json({ limit: '50mb' }), async (req, res) => {
    const { fileName, content, encoding = 'utf8' } = req.body || {};
    if (!fileName || content === undefined) {
      return res.status(400).json({ success: false, error: 'fileName and content required' });
    }
    const safeName = sanitize(fileName);
    try {
      const folder = await resolveFolder(req.params.projectId);
      const outputDir = path.join(AQUARIUM.PROJECTS, folder, 'output');
      await fsp.mkdir(outputDir, { recursive: true });
      const dest = path.join(outputDir, safeName);
      if (!dest.startsWith(outputDir)) {
        return res.status(403).json({ success: false, error: 'path traversal' });
      }
      const buf = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
      await fsp.writeFile(dest, buf);
      res.json({ success: true, fileName: safeName, size: buf.length });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  // ── DELETE /:projectId/inputs/:filename ───────────────────────────────────
  router.delete('/:projectId/inputs/:filename', async (req, res) => {
    const safeName = sanitize(req.params.filename);
    try {
      const folder = await resolveFolder(req.params.projectId);
      const filePath = path.join(AQUARIUM.PROJECTS, folder, 'input', safeName);
      if (!filePath.startsWith(AQUARIUM.PROJECTS)) {
        return res.status(403).json({ success: false, error: 'forbidden' });
      }
      await fsp.unlink(filePath);
      res.json({ success: true });
    } catch (e) { res.status(404).json({ success: false, error: e.message }); }
  });

  // ── DELETE /:projectId/outputs/:filename ──────────────────────────────────
  // The temple output tab's ✕ has always called this route — it never
  // existed server-side (only inputs had one), so deletion silently 404'd
  // and users had to remove deliverables from the filesystem by hand.
  router.delete('/:projectId/outputs/:filename', async (req, res) => {
    const safeName = sanitize(req.params.filename);
    try {
      const folder = await resolveFolder(req.params.projectId);
      const filePath = path.join(AQUARIUM.PROJECTS, folder, 'output', safeName);
      if (!filePath.startsWith(AQUARIUM.PROJECTS)) {
        return res.status(403).json({ success: false, error: 'forbidden' });
      }
      await fsp.unlink(filePath);
      res.json({ success: true });
    } catch (e) { res.status(404).json({ success: false, error: e.message }); }
  });

  // ── GET /:projectId/inputs/:filename — serve input file ───────────────────
  router.get('/:projectId/inputs/:filename', async (req, res) => {
    const safeName = sanitize(req.params.filename);
    try {
      const folder = await resolveFolder(req.params.projectId);
      const filePath = path.join(AQUARIUM.PROJECTS, folder, 'input', safeName);
      if (!filePath.startsWith(AQUARIUM.PROJECTS)) return res.status(403).send('Forbidden');
      res.sendFile(filePath, err => { if (err) res.status(404).json({ error: 'Input file not found' }); });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── GET /:projectId/outputs/:filename — serve output file ─────────────────
  router.get('/:projectId/outputs/:filename', async (req, res) => {
    const safeFile = sanitize(req.params.filename);
    try {
      const folder = await resolveFolder(req.params.projectId);
      const filePath = path.join(AQUARIUM.PROJECTS, folder, 'output', safeFile);
      if (!filePath.startsWith(AQUARIUM.PROJECTS)) return res.status(403).send('Forbidden');
      res.sendFile(filePath, err => { if (err) res.status(404).json({ error: 'Output file not found' }); });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
}

module.exports = { buildProjectFileRoutes };
