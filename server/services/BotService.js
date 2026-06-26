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
const log = require('../utils/logger').createLogger('BotService');
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

    // Per-chat conversation memory (key: 'tg:<chatId>' or 'ds:<channelId>')
    //   { lastTurns: [{role, content, at}], lastN: 6 }
    this._conversations = new Map();
    this._MAX_TURNS     = 6;

    // Per-chat preferences (persisted into comms_config.telegram.chat_prefs[chatId])
    //   { subscribed: bool, voice_replies: bool, language: 'fr'|'en' }
    // Loaded lazily from config; getChatPrefs(chatId) returns defaults if missing.

    // Tasks dispatched via this bot — receive targeted follow-up notifications
    //   Map<task_id, { platform, chatId, fromUser, dispatchedAt }>
    this._dispatchedTasks = new Map();
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
        log.info(' Loaded comms config from AQUARIUM:', AQUARIUM.COMMS_CONFIG);
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
    log.info(` started — Telegram: ${tgEnabled ? 'ON' : 'off'}, Discord: ${dsEnabled ? 'ON' : 'off'}`);
    if (tgEnabled) this.startTelegram().catch(e => log.warn(' Telegram start failed:', e.message));
    if (dsEnabled) this.startDiscord().catch(e => log.warn(' Discord start failed:', e.message));
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
      log.info(`Connected as @${me.username}`);
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
    log.info('stopped');
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
          allowed_updates: ['message', 'callback_query']
        }, { signal: controller.signal, fetchTimeout: 35000 });

        for (const upd of updates) {
          this._tgOffset = upd.update_id + 1;
          if (upd.callback_query) {
            this._handleTgCallback(token, upd.callback_query).catch(e =>
              log.warn('callback handler error:', e.message));
            continue;
          }
          const msg = upd.message;
          // Accept text, voice, photo+caption, document+caption
          if (!msg) continue;
          if (!msg.text && !msg.voice && !msg.photo && !msg.document) continue;
          // Fire-and-forget per message
          this._handleTgMessage(token, msg).catch(e =>
            log.warn('handler error:', e.message)
          );
        }
      } catch (err) {
        if (!this._tgPolling) break;
        if (err.name === 'AbortError') break;
        log.warn('poll error:', err.message);
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

    // Security: whitelist check (BEFORE we do anything else)
    const allowed = this.config.telegram.allowed_chat_ids;
    if (allowed.length > 0 && !allowed.map(String).includes(String(chatId))) {
      log.warn(`Rejected message from chat ${chatId}`);
      await this._tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text: '⛔ Unauthorized. This Poseidon instance is private.\nYour chat_id: `' + chatId + '`',
        parse_mode: 'Markdown'
      });
      return;
    }

    // Expose chat context for slash commands
    this._currentChatId = chatId;
    this._currentUser   = username;

    // Detect message type — text, voice, photo, document — and extract text accordingly
    let text = '';
    let messageType = 'text';
    if (msg.text) {
      text = msg.text.trim();
    } else if (msg.voice) {
      messageType = 'voice';
      // Will be transcribed below — set placeholder for now
    } else if (msg.photo || msg.document) {
      messageType = 'media';
      text = msg.caption?.trim() || '';
    } else {
      // Sticker, location, etc — ignore politely
      await this._tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text: 'ℹ️ I only understand text, voice messages, and captioned media.'
      });
      return;
    }

    // Prevent concurrent
    const key = `tg:${chatId}`;
    if (this._processing.has(key)) {
      await this._tgCall(token, 'sendMessage', {
        chat_id: chatId,
        text: '⏳ Still processing your previous message...'
      });
      return;
    }
    this._processing.add(key);

    // Typing indicator (recording for voice)
    const action = messageType === 'voice' ? 'record_voice' : 'typing';
    this._tgCall(token, 'sendChatAction', { chat_id: chatId, action }).catch(() => {});

    const entry = { at: new Date().toISOString(), platform: 'telegram', from: username, text, reply: null, ok: false };

    try {
      // ── Voice message: download → STT → continue as if it were text ─────────
      if (messageType === 'voice') {
        try {
          const audioBuf = await this._tgDownloadFile(token, msg.voice.file_id);
          const prefs    = this.getChatPrefs('telegram', chatId);
          text = await this._transcribeVoice(audioBuf, prefs.language);
          if (!text) {
            await this._tgCall(token, 'sendMessage', { chat_id: chatId, text: '🎙 Could not transcribe — empty result.' });
            return;
          }
          // Echo what we heard so the user can correct if needed
          await this._tgCall(token, 'sendMessage', {
            chat_id: chatId,
            text: `🎙 _Heard:_ ${text.slice(0, 300)}`,
            parse_mode: 'Markdown',
          }).catch(() => {});
          entry.text = '[voice] ' + text.slice(0, 200);
        } catch (e) {
          await this._tgCall(token, 'sendMessage', {
            chat_id: chatId,
            text: `🎙 Voice transcription failed: ${e.message}\nMake sure Speaches is reachable.`
          });
          return;
        }
      }

      // ── Slash command (handled locally, never sent to Poseidon LLM) ─────────
      if (text.startsWith('/')) {
        const reply = await this._handleSlashCommand(text, 'telegram');
        for (const chunk of this._splitMessage(reply, 4096)) {
          await this._tgCall(token, 'sendMessage', { chat_id: chatId, text: chunk });
        }
        entry.reply = reply.slice(0, 300); entry.ok = true;
        return;
      }

      // ── Free-text → Poseidon ────────────────────────────────────────────────
      const reply  = await this._runPoseidon(text, `telegram:${chatId}`);
      const prefs  = this.getChatPrefs('telegram', chatId);
      const chunks = this._splitMessage(reply, 4096);
      for (const chunk of chunks) {
        await this._tgCall(token, 'sendMessage', { chat_id: chatId, text: chunk });
      }

      // ── Optional TTS reply ──────────────────────────────────────────────────
      if (prefs.voice_replies && reply.length < 1500) {
        try {
          // Strip markdown / tool annotations for cleaner speech
          const speech = reply.replace(/_Used:[^_]+_\n+/g, '').replace(/[*_`]/g, '').trim();
          if (speech.length > 5) {
            const audio = await this._synthesizeReply(speech, prefs.language);
            await this._tgSendVoice(token, chatId, audio);
          }
        } catch (e) { log.warn('TTS reply failed:', e.message); }
      }

      entry.reply = reply.slice(0, 300);
      entry.ok    = true;
    } catch (err) {
      const errMsg = `❌ Error: ${err.message}`;
      await this._tgCall(token, 'sendMessage', { chat_id: chatId, text: errMsg });
      entry.reply = errMsg;
    } finally {
      this._processing.delete(key);
      this._currentChatId = null;
      this._currentUser   = null;
      this._logHistory(entry);
    }
  }

  /** Handle callback_query (inline button click). */
  async _handleTgCallback(token, cb) {
    const chatId = cb.message?.chat?.id;
    const data   = cb.data || '';
    // Acknowledge so the button stops spinning
    await this._tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
    if (!chatId) return;

    // Whitelist
    const allowed = this.config.telegram.allowed_chat_ids;
    if (allowed.length > 0 && !allowed.map(String).includes(String(chatId))) return;

    this._currentChatId = chatId;
    this._currentUser   = cb.from?.username || String(cb.from?.id);

    try {
      if (data.startsWith('cmd:')) {
        const cmdText = data.slice(4);
        const reply = await this._handleSlashCommand(cmdText, 'telegram');
        for (const chunk of this._splitMessage(reply, 4096)) {
          await this._tgCall(token, 'sendMessage', { chat_id: chatId, text: chunk });
        }
      }
    } finally {
      this._currentChatId = null;
      this._currentUser   = null;
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
      log.info(`Bot verified: ${this.config.discord.bot_username}`);
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
        log.info(`WS closed (${code}), reconnecting in 5s...`);
        setTimeout(() => this._dsConnect(), 5000);
      }
    });

    this._dsWs.on('error', (err) => {
      log.warn('WS error:', err.message);
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
      log.warn('Invalid session, reconnecting...');
      this._dsWs?.close();
      return;
    }

    // Dispatch events
    if (op === 0) {
      if (t === 'READY') {
        this._dsReady     = true;
        this._dsSessionId = d.session_id;
        log.info(`Gateway READY, connected as ${d.user?.username}`);
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
          log.warn('handler error:', e.message)
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
    log.info('stopped');
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
      // ── Slash commands ──────────────────────────────────────────────────────
      if (text.startsWith('/')) {
        const reply = await this._handleSlashCommand(text, 'discord');
        for (const chunk of this._splitMessage(reply, 1900)) {
          await this._dsSend(channelId, `<@${userId}> ${chunk}`);
        }
        entry.reply = reply.slice(0, 300); entry.ok = true;
        return;
      }

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
  async _buildBotContext() {
    // Build a rich context string injected before every bot message.
    // This tells Poseidon the exact paths it must use for file operations.
    const AQUARIUM = require('../aquarium');
    const lines = [
      `[REMOTE SESSION — Telegram/Discord]`,
      `Aquarium root: ${AQUARIUM.ROOT}`,
      `  PROJECTS: ${AQUARIUM.PROJECTS}`,
      `  TASKS:    ${AQUARIUM.TASKS}`,
      `  AGENTS:   ${AQUARIUM.AGENTS}`,
      `  BRAIN:    ${AQUARIUM.BRAIN}`,
      `  LOGS:     ${AQUARIUM.LOGS}`,
    ];

    // List active projects with actual folder paths
    try {
      const reg = await this.rm.read('projects/project_registry.json');
      const active = Object.values(reg.projects || {}).filter(p => p.status !== 'archived');
      if (active.length) {
        lines.push('Active projects (use these exact paths for file operations):');
        for (const p of active) {
          const folder = require('path').join(AQUARIUM.PROJECTS, p.folder || p.project_id);
          lines.push(`  ${p.name} (${p.project_id}): ${folder}`);
          lines.push(`    input/:  ${folder}/input/`);
          lines.push(`    output/: ${folder}/output/`);
        }
      } else {
        lines.push('No active projects. Use create_project to create one.');
      }
    } catch {}

    // List agents
    try {
      const agReg = await this.rm.read('agents/agent_registry.json');
      const agents = Object.values(agReg.agents || {});
      if (agents.length) {
        lines.push(`Agents: ${agents.map(a => `${a.display_name} (${a.agent_id})`).join(', ')}`);
      }
    } catch {}

    lines.push('RULE: Always write files inside the aquarium paths above. Never use relative paths like "./output" or "/tmp".');
    lines.push('RULE: For project files use the project folder paths listed above.');
    return lines.join('\n');
  }

  /**
   * Handle /slash commands from Telegram or Discord.
   * These are handled locally (no LLM call) for speed and reliability.
   *
   * Commands:
   *   /help               — list all commands
   *   /models             — list all models in library with status
   *   /load <name>        — load a model (fuzzy match on model_id or file_name)
   *   /unload             — unload current model (frees VRAM)
   *   /status             — show loaded model, ctx, VRAM, tasks, agents
   *   /ctx                — show current context window info
   *   /tasks              — show last 5 tasks status
   *   /restart            — unload + reload current Poseidon model
   */
  // ── Per-chat preferences ────────────────────────────────────────────────────

  getChatPrefs(platform, chatId) {
    const key = String(chatId);
    const prefs = this.config?.[platform]?.chat_prefs?.[key] || {};
    return {
      subscribed:    prefs.subscribed    ?? true,    // receive notify() broadcasts
      voice_replies: prefs.voice_replies ?? false,   // get TTS audio for replies
      language:      prefs.language      || this.config?.voice?.language || 'en',
    };
  }

  async setChatPrefs(platform, chatId, patch) {
    const cfg = this.config || (await this.loadConfig());
    if (!cfg[platform]) cfg[platform] = {};
    if (!cfg[platform].chat_prefs) cfg[platform].chat_prefs = {};
    const key = String(chatId);
    cfg[platform].chat_prefs[key] = { ...(cfg[platform].chat_prefs[key] || {}), ...patch };
    this.config = cfg;
    await this._saveConfig();
  }

  // ── Dispatched-task tracking (targeted follow-up) ──────────────────────────

  trackDispatchedTask(taskId, info) {
    this._dispatchedTasks.set(taskId, { ...info, dispatchedAt: Date.now() });
    // Prune entries older than 24h
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, e] of this._dispatchedTasks) {
      if (e.dispatchedAt < cutoff) this._dispatchedTasks.delete(id);
    }
  }

  /** Called by index.js when ReasoningBus emits task_lifecycle. */
  async onTaskLifecycle(event) {
    if (!event || event.type !== 'task_lifecycle') return;
    const entry = this._dispatchedTasks.get(event.task_id);
    if (!entry) return;  // not dispatched via bot — skip targeted notify
    this._dispatchedTasks.delete(event.task_id);

    const ok    = event.status === 'completed';
    const icon  = ok ? '✅' : event.status === 'failed' ? '❌' : '⚠️';
    const title = (event.title || event.task_id).slice(0, 80);
    const lines = [
      `${icon} *${title}* — ${event.status}`,
      '   _by_ `' + (event.assigned_name || event.task_id) + '`',
    ];
    if (event.result_summary) lines.push('\n' + event.result_summary.slice(0, 300));

    if (entry.platform === 'telegram') {
      const token = this.config?.telegram?.token;
      if (!token) return;
      const reply_markup = {
        inline_keyboard: [[
          { text: '📋 Tasks', callback_data: 'cmd:/tasks' },
          { text: '🔍 Status', callback_data: 'cmd:/status' },
        ]],
      };
      try {
        await this._tgCall(token, 'sendMessage', {
          chat_id: entry.chatId,
          text: lines.join('\n'),
          // No parse_mode — plain text avoids Telegram entity-parsing errors
          reply_markup,
        });
      } catch (e) { log.warn('targeted follow-up failed:', e.message); }
    }
  }

  // ── Markdown escape (MarkdownV2 strict) ─────────────────────────────────────

  _mdEscape(s) {
    // Only escape outside of code-spans. Telegram MarkdownV2 needs these chars escaped:
    //   _ * [ ] ( ) ~ ` > # + - = | { } . !
    // We preserve our intentional formatting (bold via *, code via `).
    if (!s) return '';
    let out = '';
    let inCode = false;  // backtick state
    let inBold = false;  // single * state
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '`') { inCode = !inCode; out += c; continue; }
      if (inCode)    { out += c; continue; }
      if (c === '*') { inBold = !inBold; out += c; continue; }
      if ('_[]()~>#+-=|{}.!\\'.includes(c)) out += '\\\\' + c;
      else out += c;
    }
    return out;
  }

  // ── Voice (Telegram only) ──────────────────────────────────────────────────

  /** Download a Telegram file (voice/photo/document) and return Buffer. */
  async _tgDownloadFile(token, file_id) {
    const info = await this._tgCall(token, 'getFile', { file_id });
    if (!info?.ok || !info.result?.file_path) throw new Error('getFile failed');
    const url  = `https://api.telegram.org/file/bot${token}/${info.result.file_path}`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Transcribe voice via internal /api/v2/voice/stt. */
  async _transcribeVoice(audioBuf, language) {
    const port    = process.env.PORT || 3000;
    const baseUrl = `http://localhost:${port}`;
    const form    = new FormData();
    form.append('file', new Blob([audioBuf], { type: 'audio/ogg' }), 'voice.ogg');
    if (language) form.append('language', language);
    const res = await fetch(`${baseUrl}/api/v2/voice/stt`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`STT ${res.status}`);
    const j = await res.json();
    return j.text || j.transcription || '';
  }

  /** Synthesize TTS audio for a reply, returns Buffer (ogg/opus). */
  async _synthesizeReply(text, language) {
    const port    = process.env.PORT || 3000;
    const baseUrl = `http://localhost:${port}`;
    const body = {
      text:     text.slice(0, 2000),
      language: language || this.config?.voice?.language || 'en',
      voice:    this.config?.voice?.tts_voice || 'af_heart',
      model:    this.config?.voice?.tts_model || 'kokoro',
      speed:    this.config?.voice?.tts_speed || 1.0,
    };
    const res = await fetch(`${baseUrl}/api/v2/voice/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** Send voice (ogg/opus) via Telegram sendVoice. */
  async _tgSendVoice(token, chatId, audioBuf, caption) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('voice', new Blob([audioBuf], { type: 'audio/ogg' }), 'reply.ogg');
    if (caption) form.append('caption', caption.slice(0, 1024));
    const url = `${TG_API_BASE}${token}/sendVoice`;
    const res = await fetch(url, { method: 'POST', body: form });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`sendVoice ${res.status} ${t.slice(0, 200)}`);
    }
    return res.json();
  }

  async _handleSlashCommand(text, platform) {
    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(' ').trim();

    switch (cmd.toLowerCase()) {

      case '/help':
        return [
          '🔱 *IAQUA Bot Commands*',
          '',
          '*Models*',
          '`/models`              — list all models',
          '`/load <name>`         — load model (fuzzy match)',
          '`/unload`              — unload all (free VRAM)',
          '`/restart`             — unload + reload Poseidon',
          '',
          '*Status*',
          '`/status`              — system overview',
          '`/ctx`                 — context window details',
          '`/tasks`               — recent task status',
          '`/agents`              — active agents',
          '`/projects`            — projects + completion',
          '`/skills`              — available skills',
          '',
          '*Actions*',
          '`/dispatch <agent> <text>` — create + assign task',
          '`/cancel <task_id>`        — cancel running task',
          '`/audit <project>`         — Poseidon audits project',
          '`/dream`                   — trigger dream cycle now',
          '',
          '*Preferences*',
          '`/sub on|off`          — receive event notifications',
          '`/voice on|off`        — receive TTS audio replies',
          '`/lang fr|en`          — response language',
          '`/clear`               — reset conversation context',
          '`/whoami`              — show your chat_id',
          '',
          'Anything else → Poseidon. Voice notes are auto-transcribed.',
        ].join('\n');

      case '/models': {
        try {
          this.rm.invalidateCache();
          const reg = await this.rm.read('models/model_registry.json');
          const models = Object.values(reg.models || {});
          if (!models.length) return '📦 No models in library. Import a GGUF model first.';
          const loaded = this.modelService.loaded;
          const posId  = this.modelService.poseidonModelId;
          const lines  = ['📦 *Model Library*', ''];
          for (const m of models) {
            const isLoaded  = loaded.has(m.model_id);
            const isPos     = m.model_id === posId;
            const ctx       = isLoaded ? loaded.get(m.model_id)?.config?.contextLength : null;
            const statusIcon = isLoaded ? (isPos ? '🧠' : '✅') : '💤';
            const ctxStr    = ctx ? ` [ctx=${ctx}]` : '';
            const catStr    = m.config?.model_category ? ` (${m.config.model_category})` : '';
            lines.push(`${statusIcon} \`${m.model_id}\`${catStr}${ctxStr}`);
            lines.push(`   ${m.file_name} — ${m.file_size_gb || '?'}GB`);
          }
          lines.push('', '🧠 = active Poseidon  ✅ = loaded  💤 = not loaded');
          return lines.join('\n');
        } catch (e) { return `❌ Error reading model library: ${e.message}`; }
      }

      case '/load': {
        if (!arg) return '❌ Usage: `/load <model_name_or_id>`\nExample: `/load qwen3` or `/load flux`';
        try {
          this.rm.invalidateCache();
          const reg = await this.rm.read('models/model_registry.json');
          const models = Object.values(reg.models || {});
          const query  = arg.toLowerCase();
          // Fuzzy match: exact id → startsWith → includes in id → includes in filename
          const found  = models.find(m => m.model_id === query)
            || models.find(m => m.model_id.startsWith(query))
            || models.find(m => m.model_id.includes(query))
            || models.find(m => (m.file_name || '').toLowerCase().includes(query));
          if (!found) return `❌ No model matching \`${arg}\`\nUse /models to list available models.`;

          // Check if already loaded
          if (this.modelService.loaded.has(found.model_id)) {
            const e = this.modelService.loaded.get(found.model_id);
            return `ℹ️ \`${found.model_id}\` is already loaded (ctx=${e.config?.contextLength || '?'})`;
          }

          // If it's a text model, set it as Poseidon and load
          const isImage = found.config?.model_type === 'image' || found.config?.model_category === 'image';
          if (isImage) {
            return `ℹ️ \`${found.model_id}\` is an image model — it will be loaded on-demand for image generation. Use Poseidon to generate images instead.`;
          }

          // Kick off load (non-blocking reply, then load)
          const loadMsg = `⏳ Loading \`${found.model_id}\` (${found.file_size_gb || '?'}GB)...\nThis may take 10-30 seconds.`;
          // Set as Poseidon model if no model is set or explicitly requested
          const setPoseidon = !this.modelService.poseidonModelId || arg.toLowerCase() === this.modelService.poseidonModelId;

          // Fire-and-forget load with status update
          (async () => {
            try {
              if (setPoseidon) await this.modelService.setPoseidonModel(found.model_id);
              await this.modelService.ensureLoaded(found.model_id);
              const e   = this.modelService.loaded.get(found.model_id);
              const ctx = e?.config?.contextLength || '?';
              const msg = `✅ \`${found.model_id}\` ready (ctx=${ctx})${setPoseidon ? ' — set as Poseidon' : ''}`;
              await this.notify(msg);
            } catch (err) {
              await this.notify(`❌ Load failed for \`${found.model_id}\`: ${err.message}`);
            }
          })();

          return loadMsg;
        } catch (e) { return `❌ Load error: ${e.message}`; }
      }

      case '/unload': {
        const posId = this.modelService.poseidonModelId;
        const loaded = [...this.modelService.loaded.keys()];
        if (!loaded.length) return 'ℹ️ No models are currently loaded.';
        try {
          for (const id of loaded) await this.modelService.unloadModel(id).catch(() => {});
          return `✅ Unloaded ${loaded.length} model(s): ${loaded.join(', ')}\nVRAM freed.`;
        } catch (e) { return `❌ Unload error: ${e.message}`; }
      }

      case '/restart': {
        const posId = this.modelService.poseidonModelId;
        if (!posId) return '❌ No Poseidon model assigned. Use `/load <name>` first.';
        (async () => {
          try {
            await this.notify(`⏳ Restarting \`${posId}\`...`);
            await this.modelService.unloadModel(posId).catch(() => {});
            await this.modelService.ensureLoaded(posId);
            const e   = this.modelService.loaded.get(posId);
            const ctx = e?.config?.contextLength || '?';
            await this.notify(`✅ \`${posId}\` reloaded (ctx=${ctx})`);
          } catch (err) {
            await this.notify(`❌ Restart failed: ${err.message}`);
          }
        })();
        return `⏳ Restarting \`${posId}\`... You'll get a notification when ready.`;
      }

      case '/status': {
        try {
          const lines = ['🔱 *IAQUA System Status*', ''];
          // Model
          const posId  = this.modelService.poseidonModelId;
          const entry  = posId ? this.modelService.loaded.get(posId) : null;
          if (entry) {
            const ctx     = entry.config?.contextLength || '?';
            const ctxUsed = entry.contextUsedTokens || 0;
            const ctxPct  = entry.contextPct || 0;
            const uptime  = entry.loadedAt ? Math.round((Date.now() - entry.loadedAt) / 60000) : 0;
            lines.push(`🧠 *Model:* \`${posId}\``);
            lines.push(`   Context: ${ctxUsed}/${ctx} tokens (${ctxPct}%)`);
            lines.push(`   Uptime: ${uptime}m | Requests: ${entry.totalRequests || 0}`);
          } else {
            lines.push('🧠 *Model:* none loaded');
          }
          // VRAM
          try {
            const llama = await this.modelService._ensureLib();
            if (llama.getVramState) {
              const v = await llama.getVramState();
              const free  = (v.free  / 1024**3).toFixed(2);
              const total = (v.total / 1024**3).toFixed(2);
              lines.push(`💾 *VRAM:* ${free}/${total} GB free`);
            }
          } catch {}
          // Tasks
          try {
            const tReg = await this.rm.getTasksRegistry();
            const tasks = Object.values(tReg.tasks || {});
            const running  = tasks.filter(t => (t.lifecycle?.status || t.status) === 'in_progress').length;
            const queued   = tasks.filter(t => ['open','planned'].includes(t.lifecycle?.status || t.status)).length;
            const failed   = tasks.filter(t => (t.lifecycle?.status || t.status) === 'failed').length;
            lines.push(`📋 *Tasks:* ${running} running | ${queued} queued | ${failed} failed`);
          } catch {}
          // Agents
          try {
            const aReg = await this.rm.getAgentRegistry();
            const agents = Object.values(aReg.agents || {});
            const active = agents.filter(a => a.status === 'active').length;
            lines.push(`🦑 *Agents:* ${agents.length} total | ${active} active`);
          } catch {}
          return lines.join('\n');
        } catch (e) { return `❌ Status error: ${e.message}`; }
      }

      case '/ctx': {
        const posId = this.modelService.poseidonModelId;
        const entry = posId ? this.modelService.loaded.get(posId) : null;
        if (!entry) return '❌ No model loaded.';
        const ctx     = entry.config?.contextLength || entry.context?.contextSize || '?';
        const used    = entry.contextUsedTokens || 0;
        const pct     = entry.contextPct || 0;
        const sess    = entry.sessionTurns || 0;
        const gpu     = entry.config?.gpuLayers ?? '?';
        return [
          `📊 *Context Window — ${posId}*`,
          `Total: ${ctx} tokens`,
          `Used:  ${used} (${pct}%)`,
          `Turns: ${sess}`,
          `GPU layers: ${gpu}`,
          `Flash attention: ${entry.config?.flashAttention ? 'yes' : 'no'}`,
        ].join('\n');
      }

      case '/tasks': {
        try {
          const tReg  = await this.rm.getTasksRegistry();
          const tasks = Object.values(tReg.tasks || {})
            .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
            .slice(0, 8);
          if (!tasks.length) return 'ℹ️ No tasks found.';
          const icon = { completed: '✅', failed: '❌', in_progress: '⚙️', open: '⏳', planned: '📋' };
          const lines = ['📋 *Recent Tasks*', ''];
          for (const t of tasks) {
            const s = t.lifecycle?.status || t.status || 'open';
            lines.push(`${icon[s] || '•'} \`${t.task_id}\` ${t.title?.slice(0, 40) || ''}${t.title?.length > 40 ? '…' : ''}`);
            if (t.result_summary) lines.push(`   └ ${t.result_summary.slice(0, 80)}`);
          }
          return lines.join('\n');
        } catch (e) { return `❌ Tasks error: ${e.message}`; }
      }

      case '/agents': {
        try {
          const reg = await this.rm.getAgentRegistry();
          const agents = Object.values(reg.agents || {});
          if (!agents.length) return 'ℹ️ No agents yet. Create one via the UI.';
          const lines = ['🦑 *Agents*', ''];
          for (const a of agents.slice(0, 20)) {
            const icon = a.status === 'active' ? '🟢' : a.status === 'sleeping' ? '💤' : '⚪';
            const done = a.performance_summary?.tasks_completed || 0;
            const sr   = a.performance_summary?.success_rate
              ? Math.round(a.performance_summary.success_rate * 100) + '%' : '–';
            lines.push(`${icon} \`${a.agent_id}\` ${a.display_name || ''}`);
            lines.push(`   ${done} done · ${sr} success · ${a.specialization || 'general'}`);
          }
          return lines.join('\n');
        } catch (e) { return `❌ Agents error: ${e.message}`; }
      }

      case '/projects': {
        try {
          const pReg = await this.rm.read('projects/project_registry.json');
          const tReg = await this.rm.getTasksRegistry();
          const projects = Object.values(pReg.projects || {});
          if (!projects.length) return 'ℹ️ No projects yet.';
          const allTasks = Object.values(tReg.tasks || {});
          const lines = ['📂 *Projects*', ''];
          for (const p of projects.slice(0, 15)) {
            const active = allTasks.filter(t =>
              (t.project_id === p.project_id || t.project_name === p.name) &&
              ['planned', 'in_progress'].includes(t.lifecycle?.status || t.status)).length;
            const done = p.metrics?.tasks_completed || 0;
            lines.push(`📁 *${p.name}*`);
            lines.push(`   ${done} done · ${active} active · ${(p.assigned_agents || []).length} agents`);
          }
          return lines.join('\n');
        } catch (e) { return `❌ Projects error: ${e.message}`; }
      }

      case '/skills': {
        try {
          const reg = await this.rm.read('SKILLS/skills_registry.json');
          const skills = Object.values(reg.skills || {});
          if (!skills.length) return 'ℹ️ No skills.';
          const lines = ['🎯 *Skills* (' + skills.length + ')', ''];
          for (const s of skills.slice(0, 25)) {
            lines.push(`• \`${s.skill_id || s.name}\` ${s.description ? '— ' + s.description.slice(0,60) : ''}`);
          }
          return lines.join('\n');
        } catch (e) { return `❌ Skills error: ${e.message}`; }
      }

      case '/dispatch': {
        if (!arg) return '❌ Usage: `/dispatch <agent> <task description>`';
        const parts = arg.split(/\s+/);
        if (parts.length < 2) return '❌ Need both agent and task description.';
        const agentQuery = parts[0].toLowerCase();
        const description = parts.slice(1).join(' ');
        try {
          const reg = await this.rm.getAgentRegistry();
          const agents = Object.values(reg.agents || {});
          const agent = agents.find(a => a.agent_id === agentQuery)
            || agents.find(a => (a.display_name || '').toLowerCase() === agentQuery)
            || agents.find(a => a.agent_id.includes(agentQuery))
            || agents.find(a => (a.display_name || '').toLowerCase().includes(agentQuery));
          if (!agent) return `❌ No agent matching \`${agentQuery}\`. Use /agents to list.`;
          const title = description.slice(0, 60);
          const task = await this.rm.createTask({
            title, description, assigned_to: agent.agent_id,
            task_type: 'text',
          });
          if (this._currentChatId) {
            this.trackDispatchedTask(task.task_id, { platform, chatId: this._currentChatId, fromUser: this._currentUser });
          }
          return `✅ Dispatched \`${task.task_id}\` → ${agent.display_name || agent.agent_id}\n_${title}_\n\nYou'll get a notification when it completes.`;
        } catch (e) { return `❌ Dispatch error: ${e.message}`; }
      }

      case '/cancel': {
        if (!arg) return '❌ Usage: `/cancel <task_id>`';
        try {
          const taskId = arg.startsWith('task_') ? arg : `task_${arg.padStart(4, '0')}`;
          const task = await this.rm._readTaskDetails(taskId);
          if (!task) return `❌ Task \`${taskId}\` not found.`;
          task.lifecycle = task.lifecycle || {};
          task.lifecycle.status = 'cancelled';
          task.status = 'cancelled';
          task.lifecycle.completed_at = new Date().toISOString();
          await this.rm._writeTaskDetails(taskId, task);
          return `🛑 \`${taskId}\` cancelled.`;
        } catch (e) { return `❌ Cancel error: ${e.message}`; }
      }

      case '/audit': {
        if (!arg) return '❌ Usage: `/audit <project_name>`';
        if (!this.modelService.queueBgMessage) return '❌ Background tasks not available.';
        const msg = `PROJECT AUDIT (Telegram trigger): "${arg}"\n` +
          `Call audit_project("${arg}") and report completion %, blockers, next 3 priorities. Be concise.`;
        this.modelService.queueBgMessage(msg, `audit_${arg.replace(/\s+/g, '_')}`);
        return `🔍 Audit of *${arg}* queued. Poseidon will report shortly.`;
      }

      case '/dream': {
        if (this.modelService.queueBgMessage) {
          this.modelService.queueBgMessage(
            'DREAM TRIGGER (Telegram): consolidate recent activity into soul.json. Be concise.',
            `dream_${Date.now()}`);
          return '🌙 Dream cycle requested. Poseidon will consolidate memory shortly.';
        }
        return '❌ Dream trigger not available.';
      }

      case '/sub': {
        if (!this._currentChatId) return '❌ Use this in your direct chat.';
        const on = (arg || '').toLowerCase() === 'on';
        const off = (arg || '').toLowerCase() === 'off';
        if (!on && !off) {
          const prefs = this.getChatPrefs(platform, this._currentChatId);
          return `🔔 Notifications: *${prefs.subscribed ? 'on' : 'off'}*\nToggle with \`/sub on\` or \`/sub off\``;
        }
        await this.setChatPrefs(platform, this._currentChatId, { subscribed: on });
        return on ? '🔔 You will receive task/system notifications.' : '🔕 Notifications muted for this chat.';
      }

      case '/voice': {
        if (!this._currentChatId) return '❌ Use this in your direct chat.';
        const on  = (arg || '').toLowerCase() === 'on';
        const off = (arg || '').toLowerCase() === 'off';
        if (!on && !off) {
          const prefs = this.getChatPrefs(platform, this._currentChatId);
          return `🎙 Voice replies: *${prefs.voice_replies ? 'on' : 'off'}*\nToggle with \`/voice on\` or \`/voice off\``;
        }
        await this.setChatPrefs(platform, this._currentChatId, { voice_replies: on });
        return on ? '🎙 Replies will also come as voice audio (when Speaches is reachable).' : '🔇 Voice replies disabled.';
      }

      case '/lang': {
        if (!this._currentChatId) return '❌ Use this in your direct chat.';
        const lang = (arg || '').toLowerCase();
        if (!['fr', 'en'].includes(lang)) {
          const prefs = this.getChatPrefs(platform, this._currentChatId);
          return `🌐 Language: *${prefs.language}*\nSet with \`/lang fr\` or \`/lang en\``;
        }
        await this.setChatPrefs(platform, this._currentChatId, { language: lang });
        return `🌐 Replies in *${lang}* preferred.`;
      }

      case '/clear': {
        const key = `${platform}:${this._currentChatId}`;
        this._conversations.delete(key);
        this._convHistory?.delete(key);
        return '🧹 Conversation context cleared. Next message starts fresh.';
      }

      case '/whoami': {
        return [
          '👤 *Your identity*',
          `Chat ID:  \`${this._currentChatId || '?'}\``,
          `User:     ${this._currentUser || '?'}`,
          `Platform: ${platform}`,
          '',
          'Add this chat ID to `allowed_chat_ids` in IAQUA → Comms to authorise.',
        ].join('\n');
      }

      default:
        return `❓ Unknown command: \`${cmd}\`\nType /help for available commands.`;
    }
  }

  async _runPoseidon(text, conversationKey) {
    if (!this.modelService.poseidonModelId) {
      throw new Error('Poseidon has no model loaded. Assign a model in the Models library first.');
    }

    // Wait for Poseidon to be free (sequences:1 — only one chat at a time)
    const maxWaitMs = 120_000;
    const pollMs    = 1_000;
    const deadline  = Date.now() + maxWaitMs;
    while (true) {
      const entry = this.modelService.loaded.get(this.modelService.poseidonModelId);
      if (!entry?.generating) break;
      if (Date.now() > deadline) throw new Error('Poseidon busy — timed out after 120s. Try again shortly.');
      await new Promise(r => setTimeout(r, pollMs));
    }

    // Per-conversation history (last 6 turns)
    if (!this._convHistory) this._convHistory = new Map();
    const history = this._convHistory.get(conversationKey) || [];

    // Build context prefix with aquarium paths + project locations
    const ctx = await this._buildBotContext();

    // Append per-chat language preference so Poseidon replies in user's preferred language
    const [platform, chatId] = conversationKey.split(':');
    const prefs   = chatId ? this.getChatPrefs(platform, chatId) : { language: 'en' };
    const langHint = prefs.language === 'fr'
      ? '\n\n[Reply in French unless the user wrote in another language.]'
      : '\n\n[Reply in English unless the user wrote in another language.]';
    const enrichedText = `${ctx}${langHint}\n\n---\n${text}`;

    let fullText = '';
    let toolSummary = [];

    try {
      for await (const ev of this.modelService.chatWithPoseidon(enrichedText, history)) {
        if (ev.type === 'text') fullText += ev.chunk;
        if (ev.type === 'tool_call') toolSummary.push(`⚡ ${ev.name}`);
      }
    } catch (err) {
      throw new Error(`Poseidon error: ${err.message}`);
    }

    // Update history with original text (not enriched, to avoid context bloat)
    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: fullText });
    this._convHistory.set(conversationKey, history.slice(-12));

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

  /**
   * Send a notification to all configured channels (Telegram + Discord).
   * Used by TaskRunner on task completion/failure.
   */
  async notify(text) {
    if (!this.config) return;

    // Throttle: batch rapid task completions to avoid flooding the bot.
    // Queue messages; flush at most once every 30 seconds.
    if (!this._notifyQueue) this._notifyQueue = [];
    this._notifyQueue.push(text);

    if (this._notifyTimer) return; // already scheduled
    this._notifyTimer = setTimeout(async () => {
      const msgs = this._notifyQueue.splice(0);
      this._notifyTimer = null;
      if (!msgs.length) return;

      // If multiple messages, collapse into a digest
      const payload = msgs.length === 1
        ? msgs[0]
        : `[IAQUA Digest — ${msgs.length} events]\n` + msgs.map(m => '• ' + m.split('\n')[0]).join('\n');

      const errors = [];
      // Telegram
      if (this.config.telegram?.enabled && this.config.telegram?.token) {
        const token   = this.config.telegram.token;
        const chatIds = this.config.telegram.allowed_chat_ids || [];
        for (const chatId of chatIds) {
          // Respect per-chat subscription preference
          const prefs = this.getChatPrefs('telegram', chatId);
          if (!prefs.subscribed) continue;
          try {
            await this._tgCall(token, 'sendMessage', {
              chat_id: chatId,
              text: payload.slice(0, 4096),
              parse_mode: 'Markdown'
            });
          } catch (e) { errors.push(`TG ${chatId}: ${e.message}`); }
        }
      }
      // Discord
      if (this.config.discord?.enabled && this._dsReady) {
        const channelIds = this.config.discord.allowed_channel_ids || [];
        for (const channelId of channelIds) {
          try { await this._dsSend(channelId, payload.slice(0, 2000)); }
          catch (e) { errors.push(`DS ${channelId}: ${e.message}`); }
        }
      }
      if (errors.length) log.warn(' notify partial errors:', errors.join(', '));
    }, 30_000); // 30s window
  }
}

module.exports = BotService;
