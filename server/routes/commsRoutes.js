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

function buildCommsRoutes(botService) {
  const express = require('express');
  const router  = express.Router();

  // GET /status
  router.get('/status', (req, res) => {
    res.json({ success: true, ...botService.getStatus() });
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
