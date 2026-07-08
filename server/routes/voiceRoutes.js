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

  // Voice can be enabled two ways:
  //  1. voice.enabled=true in aquarium/CHANNELS/comms_config.json
  //  2. SPEACHES_URL env var is set (means an operator opted in at startup)
  // The env-var path bypasses the comms_config flag so fresh installs work
  // out of the box: run Speaches, export SPEACHES_URL=http://localhost:8000,
  // done. No need to edit JSON.
  const isVoiceEnabled = (cfg) => !!(cfg?.enabled) || !!process.env.SPEACHES_URL;
  const speachesBase   = (cfg) => {
    let url = (cfg?.speaches_url || process.env.SPEACHES_URL || 'http://localhost:8000').replace(/\/$/, '');
    // Node 18+ resolves "localhost" to IPv6 ::1 first. Speaches/docker
    // usually binds IPv4 0.0.0.0:8000, so a ::1 connection is refused and
    // surfaces as ECONNREFUSED — the #1 cause of "unreachable" when the
    // container is demonstrably running. Force IPv4 loopback.
    url = url.replace(/^(https?:\/\/)localhost(?=[:\/]|$)/i, '$1127.0.0.1');
    return url;
  };

  // ── POST /autostart — launch the Speaches container automatically ───────────
  // Saves the user from running `docker run …` by hand. Checks whether
  // Speaches already answers; if not, spawns the container detached and
  // polls until /v1/models responds (or times out).
  router.post('/autostart', async (req, res) => {
    const { spawn, exec } = require('child_process');
    const cfg  = (await rm.read('CHANNELS/comms_config.json').catch(() => ({}))).voice || {};
    const base = speachesBase(cfg);
    const port = (base.match(/:(\d+)/) || [])[1] || '8000';

    const ping = async () => {
      try {
        const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch { return false; }
    };

    // Already up?
    if (await ping()) return res.json({ ok: true, already_running: true, url: base });

    // Is docker even available?
    const dockerOk = await new Promise(r => exec('docker --version', e => r(!e)));
    if (!dockerOk) {
      return res.status(501).json({
        ok: false,
        error: 'Docker not found on this machine. Install Docker, or start Speaches manually.',
      });
    }

    const name  = 'squidmind-speaches';
    const image = process.env.SPEACHES_IMAGE || 'ghcr.io/speaches-ai/speaches:latest-cuda';
    // Remove any stale container with the same name first (ignore errors)
    await new Promise(r => exec(`docker rm -f ${name}`, () => r()));
    const args = ['run', '-d', '--rm', '--name', name, '-p', `${port}:8000`, '--gpus', 'all', image];

    try {
      const child = spawn('docker', args, { detached: true, stdio: 'ignore' });
      child.unref();
    } catch (e) {
      return res.status(500).json({ ok: false, error: `docker run failed: ${e.message}` });
    }

    // Poll for readiness — model download on first run can take a while.
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 3000));
      if (await ping()) {
        try {
          const full = await rm.read('CHANNELS/comms_config.json').catch(() => ({}));
          full.voice = { ...(full.voice || {}), enabled: true, speaches_url: base };
          await rm.write('CHANNELS/comms_config.json', full);
          rm.invalidateCache();
        } catch {}
        return res.json({ ok: true, started: true, url: base });
      }
    }
    return res.status(504).json({
      ok: false,
      error: `Started the Speaches container but it did not become ready within 90s at ${base}. ` +
             `First run downloads models — it may still be pulling. Try again in a minute, or check: docker logs ${name}`,
    });
  });

  // ── GET /ping — diagnostic: can the SERVER reach Speaches? ──────────────────
  router.get('/ping', async (req, res) => {
    const cfg = (await rm.read('CHANNELS/comms_config.json').catch(() => ({}))).voice || {};
    const base = speachesBase(cfg);
    try {
      const r = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(5000) });
      const body = await r.text();
      res.json({
        ok: r.ok, reachable: true, url: base, status: r.status,
        models_preview: body.slice(0, 300),
      });
    } catch (e) {
      res.json({
        ok: false, reachable: false, url: base, error: e.message,
        hint: 'Server process cannot open a socket to this URL. Check the container is up and the port is published to the host the SquidMind server runs on.',
      });
    }
  });

  // ── GET config ──────────────────────────────────────────────────────────────
  router.get('/config', async (req, res) => {
    try {
      rm.invalidateCache();
      const cfg = await rm.read('CHANNELS/comms_config.json').catch(() => ({}));
      const v = cfg.voice || {};
      res.json({ ok: true, config: {
        enabled:       isVoiceEnabled(v),
        speaches_url:  speachesBase(v),
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
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        return res.status(400).json({ ok: false, error: 'JSON body required. Got: ' + JSON.stringify(req.body) });
      }
      rm.invalidateCache();
      const cfg = await rm.read('CHANNELS/comms_config.json').catch(() => ({}));
      // Whitelist the fields we accept so a malformed client can't clobber
      // unrelated comms config.
      const allowed = ['enabled', 'speaches_url', 'tts_voice', 'tts_speed', 'language', 'stt_model', 'tts_model'];
      const patch = {};
      for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
      cfg.voice = { ...(cfg.voice || {}), ...patch };
      await rm.write('CHANNELS/comms_config.json', cfg);
      rm.invalidateCache();  // ensure the next GET reads fresh from disk
      // Echo back the persisted voice block so the client can confirm + refresh
      res.json({ ok: true, saved: cfg.voice });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ── POST stt — multipart audio → Whisper transcription ──────────────────────
  router.post('/stt', async (req, res) => {
    try {
      rm.invalidateCache();
      const cfg = (await rm.read('CHANNELS/comms_config.json').catch(() => ({}))).voice || {};
      if (!isVoiceEnabled(cfg)) return res.status(503).json({ ok: false, error: 'Voice not enabled. Set SPEACHES_URL env var or enable voice in Comms settings.' });

      const baseUrl = speachesBase(cfg);

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
      if (!isVoiceEnabled(cfg)) return res.status(503).json({ ok: false, error: 'Voice not enabled. Set SPEACHES_URL env var (e.g. http://localhost:8000) or enable voice in Comms settings.' });

      const { text, voice, speed } = req.body;
      if (!text) return res.status(400).json({ ok: false, error: 'text required' });

      const baseUrl = speachesBase(cfg);

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
      // Node's global fetch (undici) returns a WHATWG ReadableStream on
      // response.body — it has NO .pipe() method. Calling .pipe() throws
      // "response.body.pipe is not a function" and the TTS silently fails
      // even when Speaches responded 200. Convert to a Node Readable first.
      const { Readable } = require('stream');
      if (response.body && typeof response.body.pipe === 'function') {
        // node-fetch style (Node Readable) — pipe directly
        response.body.pipe(res);
      } else if (response.body) {
        // undici/global fetch (Web ReadableStream) — bridge it
        Readable.fromWeb(response.body).pipe(res);
      } else {
        // No streaming body — fall back to buffering
        const buf = Buffer.from(await response.arrayBuffer());
        res.end(buf);
      }
    } catch (e) {
      const isConn = /ECONNREFUSED|fetch failed|ENOTFOUND|ETIMEDOUT|network|abort/i.test(e.message);
      if (!res.headersSent) {
        res.status(isConn ? 503 : 500).json({
          ok: false,
          error: isConn
            ? `Cannot reach Speaches at ${speachesBase((await rm.read('CHANNELS/comms_config.json').catch(()=>({}))).voice || {})}. ` +
              `Verify: (1) the container is running (docker ps), (2) it maps port 8000 (-p 8000:8000), ` +
              `(3) curl the URL from the SAME machine the SquidMind server runs on — if SquidMind is itself in Docker, ` +
              `"localhost" points at its own container, use host.docker.internal or the host IP instead.`
            : e.message
        });
      }
    }
  });

  return router;
}

module.exports = { buildVoiceRoutes };
