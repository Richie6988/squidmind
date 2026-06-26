'use strict';

/**
 * Voice routes — config + STT + TTS via Speaches.
 *
 * GET   /config — read voice settings from CHANNELS/comms_config.json
 * PATCH /config — partial update (merged into cfg.voice)
 * POST  /stt    — proxy multipart audio → Speaches Whisper
 * POST  /tts    — proxy text → Speaches Kokoro (streams audio/wav)
 *
 * Mounted at /api/v2/voice in server/index.js.
 */

function buildVoiceRoutes({ rm, fetchWithRetry }) {
  const express = require('express');
  const router  = express.Router();

  // ── GET config ──────────────────────────────────────────────────────────────
  router.get('/config', async (req, res) => {
    try {
      rm.invalidateCache();
      const cfg = await rm.read('CHANNELS/comms_config.json').catch(() => ({}));
      const v = cfg.voice || {};
      res.json({ ok: true, config: {
        enabled:       v.enabled || false,
        speaches_url:  v.speaches_url || 'http://localhost:8000',
        tts_voice:     v.tts_voice || 'af_heart',
        tts_speed:     v.tts_speed ?? 1.0,
        language:      v.language || 'fr',
        stt_model:     v.stt_model || 'Systran/faster-whisper-small',
        tts_model:     v.tts_model || 'kokoro',
      }});
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── PATCH config (partial update) ───────────────────────────────────────────
  router.patch('/config', express.json(), async (req, res) => {
    try {
      rm.invalidateCache();
      const cfg = await rm.read('CHANNELS/comms_config.json').catch(() => ({}));
      cfg.voice = { ...(cfg.voice || {}), ...req.body };
      await rm.write('CHANNELS/comms_config.json', cfg);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── POST stt — multipart audio → Whisper transcription ──────────────────────
  router.post('/stt', async (req, res) => {
    try {
      rm.invalidateCache();
      const cfg = (await rm.read('CHANNELS/comms_config.json').catch(() => ({}))).voice || {};
      if (!cfg.enabled) return res.status(503).json({ ok: false, error: 'Voice service not enabled. Configure Speaches URL in settings.' });

      const baseUrl = (cfg.speaches_url || 'http://localhost:8000').replace(/\/$/, '');

      // Buffer the raw request body, then forward to Speaches.
      const chunks = [];
      req.on('data', c => chunks.push(c));
      await new Promise(r => req.on('end', r));
      const body = Buffer.concat(chunks);

      const response = await fetchWithRetry(`${baseUrl}/v1/audio/transcriptions`, {
        retries: 2, baseDelayMs: 500, timeoutMs: 60_000,
        method: 'POST',
        headers: {
          'Content-Type': req.headers['content-type'],
          'Content-Length': body.length,
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(502).json({ ok: false, error: `Speaches STT error: ${response.status} — ${errText.slice(0, 200)}` });
      }
      const result = await response.json();
      res.json({ ok: true, text: result.text || '' });
    } catch (e) {
      const isConn = /ECONNREFUSED|fetch failed|network/i.test(e.message);
      res.status(isConn ? 503 : 500).json({
        ok: false,
        error: isConn
          ? 'Cannot reach Speaches — is it running? Start with: docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cu124'
          : e.message
      });
    }
  });

  // ── POST tts — text → audio/wav stream ──────────────────────────────────────
  router.post('/tts', express.json({ limit: '50kb' }), async (req, res) => {
    try {
      rm.invalidateCache();
      const cfg = (await rm.read('CHANNELS/comms_config.json').catch(() => ({}))).voice || {};
      if (!cfg.enabled) return res.status(503).json({ ok: false, error: 'Voice not enabled — click 🎙 Voice in chat header to enable Speaches and save.' });

      const { text, voice, speed } = req.body;
      if (!text) return res.status(400).json({ ok: false, error: 'text required' });

      const baseUrl = (cfg.speaches_url || 'http://localhost:8000').replace(/\/$/, '');

      const response = await fetchWithRetry(`${baseUrl}/v1/audio/speech`, {
        retries: 2, baseDelayMs: 500, timeoutMs: 60_000,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model:  cfg.tts_model  || 'kokoro',
          input:  text.slice(0, 4000),  // Speaches limit
          voice:  voice || cfg.tts_voice || 'af_heart',
          speed:  speed || cfg.tts_speed || 1.0,
          response_format: 'wav',
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        const errText = await response.text();
        return res.status(502).json({ ok: false, error: `Speaches TTS error: ${response.status} — ${errText.slice(0, 200)}` });
      }

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Transfer-Encoding', 'chunked');
      response.body.pipe(res);
    } catch (e) {
      const isConn = /ECONNREFUSED|fetch failed/i.test(e.message);
      if (!res.headersSent) {
        res.status(isConn ? 503 : 500).json({ ok: false, error: isConn ? 'Speaches unreachable' : e.message });
      }
    }
  });

  return router;
}

module.exports = { buildVoiceRoutes };
