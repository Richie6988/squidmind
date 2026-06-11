'use strict';

/**
 * BotService — Remote communication layer for SquidMind.
 *
 * Supports:
 *   • Telegram  — Bot API long-polling (no public endpoint needed)
 *   • Discord   — Bot Gateway WebSocket (opcode 2 IDENTIFY + DISPATCH)
 *
 * Flow per message:
 *   incoming text → security check (whitelist) → chatWithPoseidon() iterator
 *   → accumulate chunks → send reply → log exchange
 *
 * Config stored in data/main/comms_config.json (never sent to browser raw).
 * Tokens are read from config but NEVER returned to the client — only
 * masked versions (first 6 chars + ***) are exposed.
 */

const EventEmitter = require('events');
const fetch = require('node-fetch');

// ─── Constants ───────────────────────────────────────────────────────────────

const DISCORD_GATEWAY = 'wss://gateway.discord.gg/?v=10&encoding=json';
const DISCORD_API     = 'https://discord.com/api/v10';
const TG_API_BASE     = 'https://api.telegram.org/bot';

const DEFAULT_CONFIG = {
  telegram: { enabled: false, token: '', allowed_chat_ids: [], bot_username: '' },
  discord:  { enabled: false, token: '', allowed_channel_ids: [], allowed_user_ids: [], bot_username: '' },
  history:  []   // last 50 messages across all channels
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function maskToken(t) {
  if (!t || t.length < 8) return '***';
  return t.slice(0, 6) + '***' + t.slice(-4);
}

function safeConfig(cfg) {
  // Return config safe to send to browser — tokens masked
  return {
    telegram: { ...cfg.telegram, token: maskToken(cfg.telegram?.token) },
    discord:  { ...cfg.discord,  token: maskToken(cfg.discord?.token) },
    signal:   { ...cfg.signal },
  };
}

// ─── BotService ──────────────────────────────────────────────────────────────

class BotService extends EventEmitter {
  constructor(rm, modelService) {
    super();
    this.rm           = rm;
    this.modelService = modelService;
    this.config       = null;

    // Telegram state
    this._tgPolling   = false;
    this._tgOffset    = 0;
    this._tgAbort     = null;

    // Discord state
    this._dsWs        = null;
    this._dsHeartbeat = null;
    this._dsSessionId = null;
    this._dsSeq       = null;
    this._dsReady     = false;
    this._dsBotId     = null;

    // Shared
    this._history     = [];   // { at, platform, from, text, reply, ok }
    this._MAX_HISTORY = 50;
    this._processing  = new Set(); // prevent concurrent responses to same user
  }

  // ── Config I/O ─────────────────────────────────────────────────────────────

  async loadConfig() {
    try {
      this.config = await this.rm.read('CHANNELS/comms_config.json');
      // Migrate missing keys
      for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
        if (!this.config[k]) this.config[k] = v;
      }
    } catch {
      // File not found — try AQUARIUM.COMMS_CONFIG directly
      try {
        const AQUARIUM = require('../aquarium');
        const raw = require('fs').readFileSync(AQUARIUM.COMMS_CONFIG, 'utf8');
        this.config = JSON.parse(raw);
        for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
          if (!this.config[k]) this.config[k] = v;
        }
        console.log('[BotService] Loaded comms config from AQUARIUM:', AQUARIUM.COMMS_CONFIG);
        await this._saveConfig();
      } catch {
        this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        await this._saveConfig();
      }
    }
    this._history = this.config.history || [];
    return this.config;
  }

  async _saveConfig() {
    const toSave = { ...this.config, history: this._history.slice(-this._MAX_HISTORY) };
    await this.rm.write('CHANNELS/comms_config.json', toSave);
  }

  async updatePlatformConfig(platform, updates) {
    await this.loadConfig();

    // If updating token, accept real value (not masked)
    if (updates.token && updates.token.includes('***')) {
      delete updates.token; // don't overwrite with masked value
    }

    this.config[platform] = { ...this.config[platform], ...updates };
    await this._saveConfig();

    // Restart that platform if enabled state changed or token updated
    if (platform === 'telegram') {
      await this.stopTelegram();
      if (this.config.telegram.enabled && this.config.telegram.token) {
        await this.startTelegram();
      }
    } else if (platform === 'discord') {
      await this.stopDiscord();
      if (this.config.discord.enabled && this.config.discord.token) {
        await this.startDiscord();
      }
    }

    return safeConfig(this.config);
  }

  // ── Startup ────────────────────────────────────────────────────────────────

  async start() {
    await this.loadConfig();
    const tgEnabled = this.config.telegram?.enabled && this.config.telegram?.token;
    const dsEnabled = this.config.discord?.enabled  && this.config.discord?.token;
    console.log(`[BotService] started — Telegram: ${tgEnabled ? 'ON' : 'off'}, Discord: ${dsEnabled ? 'ON' : 'off'}`);
    if (tgEnabled) this.startTelegram().catch(e => console.warn('[BotService] Telegram start failed:', e.message));
    if (dsEnabled) this.startDiscord().catch(e => console.warn('[BotService] Discord start failed:', e.message));
  }

  async stop() {
    await this.stopTelegram();
    await this.stopDiscord();
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus() {
    return {
      telegram: {
        enabled:   this.config?.telegram?.enabled || false,
        connected: this._tgPolling,
        username:  this.config?.telegram?.bot_username || null,
        token:     maskToken(this.config?.telegram?.token),
        allowed_chat_ids: this.config?.telegram?.allowed_chat_ids || [],
      },
      discord: {
        enabled:   this.config?.discord?.enabled || false,
        connected: this._dsReady,
        username:  this.config?.discord?.bot_username || null,
        token:     maskToken(this.config?.discord?.token),
        allowed_channel_ids: this.config?.discord?.allowed_channel_ids || [],
        allowed_user_ids:    this.config?.discord?.allowed_user_ids || [],
      },
      history: this._history.slice(-20)
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TELEGRAM
  // ══════════════════════════════════════════════════════════════════════════

  async startTelegram() {
    if (this._tgPolling) return;
    const token = this.config.telegram.token;
    if (!token) throw new Error('No Telegram token configured');

    // Verify token + get bot info
    try {
      const me = await this._tgCall(token, 'getMe');
      this.config.telegram.bot_username = me.username;
      await this._saveConfig();
      console.log(`[BotService/Telegram] Connected as @${me.username}`);
    } catch (err) {
      throw new Error(`Telegram token invalid: ${err.message}`);
    }

    this._tgPolling = true;
    this._tgOffset  = 0;
    this._tgLoop(token);
  }

  async stopTelegram() {
    if (!this._tgPolling && !this._tgLoopRunning) return; // already stopped
    this._tgPolling = false;
    this._tgLoopRunning = false;
    this._tgAbort?.abort?.();
    this._tgAbort = null;
    console.log('[BotService/Telegram] stopped');
  }

  async _tgLoop(token) {
    if (this._tgLoopRunning) return; // prevent duplicate loops
    this._tgLoopRunning = true;
    while (this._tgPolling) {
      try {
        const controller = new AbortController();
        this._tgAbort = controller;
        const updates = await this._tgCall(token, 'getUpdates', {
          offset: this._tgOffset,
          timeout: 30,
          allowed_updates: ['message']
        }, { signal: controller.signal, fetchTimeout: 35000 });

        for (const upd of updates) {
          this._tgOffset = upd.update_id + 1;
          const msg = upd.message;
          if (!msg?.text) continue;
          // Fire-and-forget per message
          this._handleTgMessage(token, msg).catch(e =>
            console.warn('[BotService/Telegram] handler error:', e.message)
          );
        }
      } catch (err) {
        if (!this._tgPolling) break;
        if (err.name === 'AbortError') break;
        console.warn('[BotService/Telegram] poll error:', err.message);
        await new Promise(r => setTimeout(r, 5000)); // back-off
      }
    }
    this._tgPolling = false;
    this._tgLoopRunning = false;
  }

  async _handleTgMessage(token, msg) {
    const chatId   = msg.chat.id;
    const userId   = msg.from?.id;
    const username = msg.from?.username || msg.from?.first_name || String(userId);
    const text     = msg.text.trim();

    // Security: whitelist check
    const allowed = this.config.telegram.allowed_chat_ids;
    if (allowed.length > 0 && !allowed.map(String).includes(String(chatId))) {
      console.warn(`[BotService/Telegram] Rejected message from chat ${chatId}`);
      await this._tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text: '⛔ Unauthorized. This Poseidon instance is private.'
      });
      return;
    }

    // Prevent concurrent from same user
    const key = `tg:${chatId}`;
    if (this._processing.has(key)) {
      await this._tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text: '⏳ Still processing your previous message...'
      });
      return;
    }
    this._processing.add(key);

    // Send typing indicator
    this._tgCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

    const entry = { at: new Date().toISOString(), platform: 'telegram', from: username, text, reply: null, ok: false };

    try {
      const reply = await this._runPoseidon(text, `telegram:${chatId}`);

      // Telegram message limit = 4096 chars; chunk if needed
      const chunks = this._splitMessage(reply, 4096);
      for (const chunk of chunks) {
        await this._tgCall(token, 'sendMessage', {
          chat_id: chatId,
          text: chunk
          // No parse_mode: avoids Telegram entity-parsing errors on special chars
        });
      }
      entry.reply = reply.slice(0, 300);
      entry.ok    = true;
    } catch (err) {
      const errMsg = `❌ Error: ${err.message}`;
      await this._tgCall(token, 'sendMessage', { chat_id: chatId, text: errMsg });
      entry.reply = errMsg;
    } finally {
      this._processing.delete(key);
      this._logHistory(entry);
    }
  }

  async _tgCall(token, method, params = {}, opts = {}) {
    const url  = `${TG_API_BASE}${token}/${method}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.fetchTimeout || 10000);
    const signal = opts.signal || ctrl.signal;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal
      });
      clearTimeout(timer);
      const data = await res.json();
      if (!data.ok) throw new Error(data.description || `Telegram API error ${res.status}`);
      return data.result;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DISCORD
  // ══════════════════════════════════════════════════════════════════════════

  async startDiscord() {
    if (this._dsWs) return;
    const token = this.config.discord.token;
    if (!token) throw new Error('No Discord token configured');

    // Verify token first via REST
    try {
      const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bot ${token}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const me = await res.json();
      this._dsBotId = me.id;
      this.config.discord.bot_username = `${me.username}#${me.discriminator || '0'}`;
      await this._saveConfig();
      console.log(`[BotService/Discord] Bot verified: ${this.config.discord.bot_username}`);
    } catch (err) {
      throw new Error(`Discord token invalid: ${err.message}`);
    }

    this._dsConnect();
  }

  _dsConnect() {
    const WebSocket = require('ws');
    const token = this.config.discord.token;

    this._dsWs = new WebSocket(DISCORD_GATEWAY);

    this._dsWs.on('message', (raw) => {
      try {
        const payload = JSON.parse(raw);
        this._dsHandlePayload(payload);
      } catch {}
    });

    this._dsWs.on('close', (code) => {
      clearInterval(this._dsHeartbeat);
      this._dsReady    = false;
      this._dsHeartbeat = null;
      if (this.config?.discord?.enabled) {
        console.log(`[BotService/Discord] WS closed (${code}), reconnecting in 5s...`);
        setTimeout(() => this._dsConnect(), 5000);
      }
    });

    this._dsWs.on('error', (err) => {
      console.warn('[BotService/Discord] WS error:', err.message);
    });
  }

  _dsHandlePayload(payload) {
    const { op, t, d, s } = payload;
    if (s != null) this._dsSeq = s;

    // Opcode 10: Hello → start heartbeat + identify
    if (op === 10) {
      const interval = d.heartbeat_interval;
      this._dsHeartbeat = setInterval(() => {
        if (this._dsWs?.readyState === 1) {
          this._dsWs.send(JSON.stringify({ op: 1, d: this._dsSeq }));
        }
      }, interval);

      // Identify — GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT intents (1|512|32768=33281)
      this._dsWs.send(JSON.stringify({
        op: 2, d: {
          token: this.config.discord.token,
          intents: 33281,
          properties: { os: 'linux', browser: 'squidmind', device: 'squidmind' }
        }
      }));
    }

    // Opcode 11: Heartbeat ACK — ignore
    if (op === 11) return;

    // Opcode 9: Invalid session
    if (op === 9) {
      console.warn('[BotService/Discord] Invalid session, reconnecting...');
      this._dsWs?.close();
      return;
    }

    // Dispatch events
    if (op === 0) {
      if (t === 'READY') {
        this._dsReady     = true;
        this._dsSessionId = d.session_id;
        console.log(`[BotService/Discord] Gateway READY, connected as ${d.user?.username}`);
      }

      if (t === 'MESSAGE_CREATE') {
        // Ignore own messages and bots
        if (d.author?.bot) return;
        if (d.author?.id === this._dsBotId) return;

        const channelId = d.channel_id;
        const userId    = d.author?.id;
        const username  = d.author?.username || userId;
        const text      = (d.content || '').trim();

        // Only respond if mentioned or in DM, OR if channel is in allowlist
        const allowedChannels = this.config.discord.allowed_channel_ids || [];
        const allowedUsers    = this.config.discord.allowed_user_ids || [];
        const isMentioned     = (d.mentions || []).some(m => m.id === this._dsBotId);
        const isDM            = d.guild_id == null;
        const channelOk       = allowedChannels.length === 0 || allowedChannels.includes(channelId);
        const userOk          = allowedUsers.length === 0 || allowedUsers.includes(userId);

        if (!isMentioned && !isDM && !channelOk) return;
        if (!userOk && allowedUsers.length > 0) {
          this._dsSend(channelId, `⛔ <@${userId}> You are not authorized to use Poseidon.`).catch(() => {});
          return;
        }
        if (!text) return;

        // Strip bot mention from message text
        const cleanText = text.replace(/<@!?\d+>/g, '').trim();
        if (!cleanText) return;

        this._handleDsMessage(channelId, userId, username, cleanText).catch(e =>
          console.warn('[BotService/Discord] handler error:', e.message)
        );
      }
    }
  }

  async stopDiscord() {
    clearInterval(this._dsHeartbeat);
    this._dsHeartbeat = null;
    this._dsReady     = false;
    try { this._dsWs?.close(); } catch {}
    this._dsWs = null;
    console.log('[BotService/Discord] stopped');
  }

  async _handleDsMessage(channelId, userId, username, text) {
    const key = `ds:${channelId}:${userId}`;
    if (this._processing.has(key)) {
      await this._dsSend(channelId, `⏳ <@${userId}> Still processing your previous message...`);
      return;
    }
    this._processing.add(key);

    // Discord typing indicator
    this._dsTyping(channelId).catch(() => {});

    const entry = { at: new Date().toISOString(), platform: 'discord', from: username, text, reply: null, ok: false };

    try {
      const reply = await this._runPoseidon(text, `discord:${channelId}`);
      // Discord message limit = 2000 chars
      const chunks = this._splitMessage(reply, 1900);
      for (const chunk of chunks) {
        await this._dsSend(channelId, `<@${userId}> ${chunk}`);
      }
      entry.reply = reply.slice(0, 300);
      entry.ok    = true;
    } catch (err) {
      await this._dsSend(channelId, `<@${userId}> ❌ Error: ${err.message}`);
      entry.reply = `Error: ${err.message}`;
    } finally {
      this._processing.delete(key);
      this._logHistory(entry);
    }
  }

  async _dsSend(channelId, content) {
    const token = this.config.discord.token;
    const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Discord send error ${res.status}`);
    }
  }

  async _dsTyping(channelId) {
    const token = this.config.discord.token;
    await fetch(`${DISCORD_API}/channels/${channelId}/typing`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}` }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // POSEIDON BRIDGE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Run a message through Poseidon and return the full text response.
   * Uses a simple per-conversation history stored in memory (keyed by platform:chatId).
   */
  async _runPoseidon(text, conversationKey) {
    if (!this.modelService.poseidonModelId) {
      throw new Error('Poseidon has no model loaded. Assign a model in the Models library first.');
    }

    // Wait for Poseidon to be free (sequences:1 — only one chat at a time)
    // Poll up to 120s before giving up
    const maxWaitMs = 120_000;
    const pollMs    = 1_000;
    const deadline  = Date.now() + maxWaitMs;
    while (true) {
      const entry = this.modelService.loaded.get(this.modelService.poseidonModelId);
      if (!entry?.generating) break;
      if (Date.now() > deadline) throw new Error('Poseidon busy — timed out after 120s. Try again shortly.');
      await new Promise(r => setTimeout(r, pollMs));
    }

    // Per-conversation history (last 6 turns to keep context lean)
    if (!this._convHistory) this._convHistory = new Map();
    const history = this._convHistory.get(conversationKey) || [];

    let fullText = '';
    let toolSummary = [];

    try {
      for await (const ev of this.modelService.chatWithPoseidon(text, history)) {
        if (ev.type === 'text') fullText += ev.chunk;
        if (ev.type === 'tool_call') toolSummary.push(`🔧 ${ev.name}`);
        // thinking events silently consumed
      }
    } catch (err) {
      throw new Error(`Poseidon error: ${err.message}`);
    }

    // Update history
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: fullText });
    // Keep last 6 turns (12 messages)
    this._convHistory.set(conversationKey, history.slice(-12));

    // Prepend tool summary if any
    if (toolSummary.length) {
      fullText = `_Used: ${[...new Set(toolSummary)].join(', ')}_\n\n${fullText}`;
    }

    return fullText || '(no response)';
  }

  // ── Shared helpers ─────────────────────────────────────────────────────────

  _splitMessage(text, maxLen) {
    if (!text || text.length <= maxLen) return [text || '(empty)'];
    const chunks = [];
    let pos = 0;
    while (pos < text.length) {
      // Try to split at a newline near the limit
      let end = Math.min(pos + maxLen, text.length);
      if (end < text.length) {
        const nl = text.lastIndexOf('\n', end);
        if (nl > pos + maxLen * 0.7) end = nl + 1;
      }
      chunks.push(text.slice(pos, end));
      pos = end;
    }
    return chunks;
  }

  _logHistory(entry) {
    this._history.push(entry);
    if (this._history.length > this._MAX_HISTORY) this._history.shift();
    this._saveConfig().catch(() => {});
    this.emit('message', entry);
  }
}

module.exports = BotService;
