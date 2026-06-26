'use strict';

/**
 * Backup routes — list + manual snapshot of aquarium/.backups/.
 *
 * GET  /          — list hourly + daily snapshots
 * POST /snapshot  — force an immediate snapshot (body: { bucket?: 'hourly'|'daily' })
 *
 * Mounted at /api/v2/backups in server/index.js.
 */

function buildBackupRoutes({ backupService }) {
  const express = require('express');
  const router  = express.Router();

  router.get('/', async (req, res) => {
    try { res.json({ success: true, ...(await backupService.listSnapshots()) }); }
    catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  router.post('/snapshot', async (req, res) => {
    try {
      const r = await backupService.snapshot(req.body?.bucket || 'hourly');
      res.json({ success: true, ...r });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
  });

  return router;
}

module.exports = { buildBackupRoutes };
