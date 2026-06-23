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
          allowed_updates: ['message']
        }, { signal: controller.signal, fetchTimeout: 35000 });

        for (const upd of updates) {
          this._tgOffset = upd.update_id + 1;
          const msg = upd.message;
          if (!msg?.text) continue;
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
    const text     = msg.text.trim();

    // Security: whitelist check
    const allowed = this.config.telegram.allowed_chat_ids;
    if (allowed.length > 0 && !allowed.map(String).includes(String(chatId))) {
      log.warn(`Rejected message from chat ${chatId}`);
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
      // ── Slash commands — handled locally, never sent to Poseidon LLM ──────
      if (text.startsWith('/')) {
        const reply = await this._handleSlashCommand(text, 'telegram');
        for (const chunk of this._splitMessage(reply, 4096)) {
          await this._tgCall(token, 'sendMessage', { chat_id: chatId, text: chunk });
        }
        entry.reply = reply.slice(0, 300); entry.ok = true;
        return;
      }

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
  async _handleSlashCommand(text, platform) {
    const [cmd, ...args] = text.split(/\s+/);
    const arg = args.join(' ').trim();

    switch (cmd.toLowerCase()) {

      case '/help':
        return [
          '🔱 *IAQUA Bot Commands*',
          '',
          '`/models`        — list all models in library',
          '`/load <name>`   — load a model (fuzzy name match)',
          '`/unload`        — unload current model (free VRAM)',
          '`/restart`       — unload + reload current Poseidon model',
          '`/status`        — system status (model, ctx, VRAM, tasks)',
          '`/ctx`           — context window details',
          '`/tasks`         — recent task status',
          '',
          'Any other message is sent to Poseidon for processing.',
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
    const enrichedText = `${ctx}\n\n---\n${text}`;

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
