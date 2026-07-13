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
