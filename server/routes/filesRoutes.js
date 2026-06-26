'use strict';

/**
 * File-access routes.
 *
 * Mounted at /api/files in server/index.js.
 *
 * GET  /read    — read any file inside aquarium/ (with path-traversal check)
 *                 image extensions are served as binary; everything else as text
 * POST /browse  — list directory contents (used by file picker UI)
 *
 * Both routes resolve absolute paths and reject anything outside their
 * sandbox. /read is sandboxed to AQUARIUM.ROOT; /browse uses caller-supplied
 * paths (the UI defaults to the user home and walks down).
 */

function buildFilesRoutes() {
  const express = require('express');
  const path = require('path');
  const fs   = require('fs').promises;
  const fsSync = require('fs');
  const AQUARIUM = require('../aquarium');
  const router  = express.Router();

  const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp']);

  // ── GET /read?path=... ────────────────────────────────────────────────────
  router.get('/read', async (req, res) => {
    const reqPath = req.query.path;
    if (!reqPath) return res.status(400).json({ error: 'path required' });

    // Resolve absolute path — relative paths are anchored to AQUARIUM.ROOT
    let absPath = reqPath;
    if (!path.isAbsolute(absPath)) absPath = path.join(AQUARIUM.ROOT, reqPath);
    const resolved = path.resolve(absPath);
    if (!resolved.startsWith(path.resolve(AQUARIUM.ROOT))) {
      return res.status(403).json({ error: 'Access denied: path outside aquarium' });
    }
    try {
      const ext = path.extname(resolved).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        return res.sendFile(resolved, err => {
          if (err) res.status(404).json({ error: 'File not found: ' + resolved });
        });
      }
      const content = await fs.readFile(resolved, 'utf8');
      res.json({ content });
    } catch (e) {
      res.status(404).json({ error: 'File not found: ' + e.message, path: resolved });
    }
  });

  // ── POST /browse  body: { path: string } ──────────────────────────────────
  router.post('/browse', async (req, res) => {
    try {
      const { path: dirPath } = req.body || {};
      if (!dirPath) return res.status(400).json({ success: false, error: 'Path required' });
      const resolvedPath = path.resolve(dirPath);
      try {
        const entries = await fs.readdir(resolvedPath, { withFileTypes: true });
        const results = await Promise.all(entries.map(async (entry) => {
          const entryPath = path.join(resolvedPath, entry.name);
          let size = null;
          if (entry.isFile()) {
            try { size = (await fs.stat(entryPath)).size; } catch {}
          }
          return {
            name: entry.name,
            path: entryPath,
            type: entry.isDirectory() ? 'directory' : 'file',
            size,
          };
        }));
        res.json({ success: true, entries: results });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}

module.exports = { buildFilesRoutes };
