'use strict';

/**
 * Comms routes — bridge between UI and BotService
 *
 * GET  /api/v2/comms/status              — current connection status (tokens masked)
 * POST /api/v2/comms/:platform/config    — update platform config (token, ids, enabled)
 * POST /api/v2/comms/:platform/test      — send a test message to verify credentials
 * POST /api/v2/comms/:platform/stop      — force-stop a platform
 * POST /api/v2/comms/:platform/start     — force-start a platform
 * DELETE /api/v2/comms/history           — clear message history
 */

function buildCommsRoutes(botService, rm = null) {
  const express = require('express');
  const router  = express.Router();

  // GET /status
  router.get('/status', (req, res) => {
    res.json({ success: true, ...botService.getStatus() });
  });

  // ── Email (SMTP) ────────────────────────────────────────────────────────
  // Registered BEFORE the /:platform routes so /email/test doesn't fall into
  // the platform whitelist. Email is stateless SMTP (no long-lived bot), so
  // it doesn't go through botService — config lives in comms_config.json
  // under `email`, exactly the shape EmailService._resolveConfig expects.

  // GET /email — current config with the password masked (for UI prefill)
  router.get('/email', async (req, res) => {
    if (!rm) return res.status(501).json({ success: false, error: 'rm not wired' });
    try {
      const cfg = await rm.read('CHANNELS/comms_config.json').catch(() => ({}));
      const e = cfg.email || null;
      res.json({
        success: true,
        configured: !!(e && e.host && e.user),
        email: e ? { host: e.host, port: e.port, secure: !!e.secure, user: e.user, from: e.from || null, pass_set: !!e.pass } : null,
      });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /email — save { email: { host, port, secure, user, pass, from } }
  router.post('/email', express.json(), async (req, res) => {
    if (!rm) return res.status(501).json({ success: false, error: 'rm not wired' });
    try {
      const e = req.body?.email || {};
      // Local open-source MTA (Postfix/Exim on this machine) needs no auth —
      // only host is mandatory. Remote providers still need user+pass.
      if (!e.host && e.transport !== 'sendmail') {
        return res.status(400).json({ success: false, error: 'host is required (or transport:"sendmail")' });
      }
      const isLocal = e.transport === 'sendmail' || /^(127\.0\.0\.1|localhost)$/i.test(e.host || '');
      const cfg = await rm.read('CHANNELS/comms_config.json').catch(() => ({}));
      // Masked-password re-save: GET /email never returns the pass (only
      // pass_set), so the UI form posts an empty pass on any re-save. Keep
      // the stored password when it belongs to the same user instead of
      // rejecting a config that already works.
      if (!isLocal && !e.pass && cfg.email?.pass && cfg.email.user === e.user) {
        e.pass = cfg.email.pass;
      }
      if (!isLocal && (!e.user || !e.pass)) {
        return res.status(400).json({ success: false, error: 'user and pass are required for remote SMTP (not needed for a local MTA on 127.0.0.1)' });
      }
      cfg.email = e.transport === 'sendmail'
        ? { transport: 'sendmail', ...(e.from ? { from: String(e.from) } : {}) }
        : {
            host: String(e.host), port: Number(e.port || 587), secure: !!e.secure,
            ...(e.user ? { user: String(e.user), pass: String(e.pass || '') } : {}),
            ...(e.from ? { from: String(e.from) } : {}),
          };
      await rm.write('CHANNELS/comms_config.json', cfg);
      rm.invalidateCache();
      res.json({ success: true, user: cfg.email.user });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /email/test — save must have happened; sends a real test email
  router.post('/email/test', express.json(), async (req, res) => {
    if (!rm) return res.status(501).json({ success: false, error: 'rm not wired' });
    const to = req.body?.to;
    if (!to) return res.status(400).json({ success: false, error: 'to is required' });
    try {
      const { EmailService } = require('../services/EmailService');
      const svc = new EmailService(rm);
      const result = await svc.send({
        to, subject: 'SquidMind test email',
        body: 'This is a test email from your SquidMind instance. SMTP is configured correctly. 🦑',
      });
      if (result && result.ok === false) {
        return res.status(502).json({ success: false, error: result.error || 'send failed' });
      }
      res.json({ success: true, ...result });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
  });

  // POST /:platform/config
  // Body: { token?, allowed_chat_ids?, allowed_channel_ids?, allowed_user_ids?, enabled? }
  router.post('/:platform/config', async (req, res) => {
    const { platform } = req.params;
    if (!['telegram', 'discord'].includes(platform)) {
      return res.status(400).json({ success: false, error: 'Unknown platform' });
    }
    try {
      const safe = await botService.updatePlatformConfig(platform, req.body);
      res.json({ success: true, config: safe });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /:platform/start
  router.post('/:platform/start', async (req, res) => {
    const { platform } = req.params;
    try {
      if (platform === 'telegram') await botService.startTelegram();
      else if (platform === 'discord') await botService.startDiscord();
      else return res.status(400).json({ success: false, error: 'Unknown platform' });
      res.json({ success: true, status: botService.getStatus() });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /:platform/stop
  router.post('/:platform/stop', async (req, res) => {
    const { platform } = req.params;
    try {
      if (platform === 'telegram') await botService.stopTelegram();
      else if (platform === 'discord') await botService.stopDiscord();
      else return res.status(400).json({ success: false, error: 'Unknown platform' });
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // POST /:platform/test — send a test message via the bot to verify it works
  router.post('/:platform/test', async (req, res) => {
    const { platform } = req.params;
    const { chat_id, channel_id } = req.body;
    try {
      if (platform === 'telegram') {
        if (!chat_id) return res.status(400).json({ success: false, error: 'chat_id required' });
        if (!botService._tgPolling) {
          return res.status(400).json({ success: false, error: 'Telegram not running. Start it first.' });
        }
        await botService._tgCall(
          botService.config.telegram.token,
          'sendMessage',
          { chat_id, text: '✅ SquidMind Poseidon is online and listening.' }
        );
        res.json({ success: true, message: `Test message sent to chat ${chat_id}` });
      } else if (platform === 'discord') {
        if (!channel_id) return res.status(400).json({ success: false, error: 'channel_id required' });
        if (!botService._dsReady) {
          return res.status(400).json({ success: false, error: 'Discord not connected. Start it first.' });
        }
        await botService._dsSend(channel_id, '✅ SquidMind Poseidon is online and listening.');
        res.json({ success: true, message: `Test message sent to channel ${channel_id}` });
      } else {
        res.status(400).json({ success: false, error: 'Unknown platform' });
      }
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // DELETE /history
  router.delete('/history', async (req, res) => {
    botService._history = [];
    await botService._saveConfig().catch(() => {});
    res.json({ success: true });
  });

  return router;
}

module.exports = { buildCommsRoutes };
