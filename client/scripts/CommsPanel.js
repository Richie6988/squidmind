/**
 * CommsPanel — Remote communication setup modal.
 *
 * Two tabs: Telegram | Discord
 * Each tab: token input, allowed-ids config, connect/disconnect button,
 *           live status indicator, test button, message history.
 */

const CommsPanel = {
  modal: null,
  _statusInterval: null,
  _status: {},

  // ── Open ────────────────────────────────────────────────────────────────────

  async open() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      this.modal.style.display = '';
      this._startPolling();
      await this._loadStatus();
      return;
    }

    this.modal = document.createElement('div');
    this.modal.className = 'modal comms-modal';
    this.modal.innerHTML = `
      <div class="modal-content comms-content">
        <div class="modal-header">
          <h2>📡 Remote Comms</h2>
          <button class="btn-close" onclick="CommsPanel.close()">x</button>
        </div>
        <div class="comms-tabs">
          <button class="comms-tab active" data-tab="telegram" onclick="CommsPanel._switchTab('telegram')">
            <span class="comms-tab-icon">✈️</span> Telegram
            <span class="comms-dot" id="dot-telegram"></span>
          </button>
          <button class="comms-tab" data-tab="discord" onclick="CommsPanel._switchTab('discord')">
            <span class="comms-tab-icon">🎮</span> Discord
            <span class="comms-dot" id="dot-discord"></span>
          </button>
        </div>
        <div class="comms-body">
          <div id="comms-tab-telegram" class="comms-tab-pane active">
            ${this._renderTelegramTab()}
          </div>
          <div id="comms-tab-discord" class="comms-tab-pane" style="display:none">
            ${this._renderDiscordTab()}
          </div>
        </div>
        <div class="comms-history-section">
          <div class="comms-history-header">
            <span class="comms-section-title">📜 Recent messages</span>
            <button class="btn-secondary" style="font-size:8px;padding:2px 8px;" onclick="CommsPanel._clearHistory()">Clear</button>
          </div>
          <div id="comms-history-list" class="comms-history-list">
            <p class="comms-hint">No messages yet.</p>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.modal);
    this._wireEvents();
    await this._loadStatus();
    this._startPolling();
  },

  close() {
    this._stopPolling();
    if (this.modal) {
      this.modal.style.display = 'none';
      // Keep in DOM so we can reopen cheaply — just hide it
    }
  },

  // ── Tab HTML ────────────────────────────────────────────────────────────────

  _renderTelegramTab() {
    return `
      <div class="comms-setup-guide">
        <div class="comms-guide-steps">
          <div class="comms-step"><span class="comms-step-num">1</span>
            <span>Open Telegram → search <b>@BotFather</b> → <code>/newbot</code></span></div>
          <div class="comms-step"><span class="comms-step-num">2</span>
            <span>Copy the token BotFather gives you (format: <code>123456:ABC-DEF...</code>)</span></div>
          <div class="comms-step"><span class="comms-step-num">3</span>
            <span>Paste it below and click Connect</span></div>
          <div class="comms-step"><span class="comms-step-num">4</span>
            <span>Get your Chat ID: message <b>@userinfobot</b> on Telegram, add it to the whitelist</span></div>
        </div>
      </div>
      <div class="comms-field-group">
        <label class="comms-label">Bot Token</label>
        <div class="comms-token-row">
          <input id="tg-token" type="password" class="comms-input" placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" autocomplete="off">
          <button class="comms-eye-btn" onclick="CommsPanel._toggleVisible('tg-token')">👁</button>
        </div>
      </div>
      <div class="comms-field-group">
        <label class="comms-label">Allowed Chat IDs <span class="comms-hint-inline">(whitelist — leave empty to allow all)</span></label>
        <input id="tg-chat-ids" type="text" class="comms-input" placeholder="123456789, -1001234567890">
        <p class="comms-hint">Comma-separated. Get your ID from @userinfobot. Group IDs start with -100.</p>
      </div>
      <div class="comms-field-group">
        <label class="comms-label">Test message target Chat ID</label>
        <div class="comms-token-row">
          <input id="tg-test-id" type="text" class="comms-input" placeholder="Your chat ID">
          <button class="btn-secondary" style="font-size:9px;" onclick="CommsPanel._testTelegram()">Send test</button>
        </div>
      </div>
      <div class="comms-status-bar" id="tg-status-bar">
        <span id="tg-status-dot" class="comms-status-dot comms-status-off"></span>
        <span id="tg-status-text">Not connected</span>
        <span id="tg-bot-name" class="comms-bot-name"></span>
      </div>
      <div class="comms-actions">
        <button class="btn-primary" id="tg-connect-btn" onclick="CommsPanel._saveTelegram()">Connect</button>
        <button class="btn-secondary" id="tg-disconnect-btn" onclick="CommsPanel._stopPlatform('telegram')" style="display:none">Disconnect</button>
      </div>
      <p id="tg-error" class="comms-error" style="display:none"></p>
    `;
  },

  _renderDiscordTab() {
    return `
      <div class="comms-setup-guide">
        <div class="comms-guide-steps">
          <div class="comms-step"><span class="comms-step-num">1</span>
            <span>Go to <b>discord.com/developers/applications</b> → New Application</span></div>
          <div class="comms-step"><span class="comms-step-num">2</span>
            <span>Bot section → Add Bot → copy the <b>Token</b></span></div>
          <div class="comms-step"><span class="comms-step-num">3</span>
            <span>Enable <b>Message Content Intent</b> in the Bot settings</span></div>
          <div class="comms-step"><span class="comms-step-num">4</span>
            <span>OAuth2 → URL Generator → scopes: <code>bot</code>, permissions: <code>Send Messages, Read Message History</code> → invite bot to your server</span></div>
          <div class="comms-step"><span class="comms-step-num">5</span>
            <span>Right-click your channel → Copy Channel ID (enable Developer Mode in Discord settings first)</span></div>
        </div>
      </div>
      <div class="comms-field-group">
        <label class="comms-label">Bot Token</label>
        <div class="comms-token-row">
          <input id="ds-token" type="password" class="comms-input" placeholder="MTExxx.YYYyyy.ZZZzzz..." autocomplete="off">
          <button class="comms-eye-btn" onclick="CommsPanel._toggleVisible('ds-token')">👁</button>
        </div>
      </div>
      <div class="comms-field-group">
        <label class="comms-label">Allowed Channel IDs <span class="comms-hint-inline">(whitelist)</span></label>
        <input id="ds-channel-ids" type="text" class="comms-input" placeholder="1234567890123456789, 9876543210987654321">
        <p class="comms-hint">Comma-separated channel IDs. Bot also responds to DMs and when mentioned.</p>
      </div>
      <div class="comms-field-group">
        <label class="comms-label">Allowed User IDs <span class="comms-hint-inline">(optional extra lock)</span></label>
        <input id="ds-user-ids" type="text" class="comms-input" placeholder="123456789012345678">
        <p class="comms-hint">Comma-separated Discord user IDs. Leave empty to allow anyone in allowed channels.</p>
      </div>
      <div class="comms-field-group">
        <label class="comms-label">Test message target Channel ID</label>
        <div class="comms-token-row">
          <input id="ds-test-id" type="text" class="comms-input" placeholder="Channel ID">
          <button class="btn-secondary" style="font-size:9px;" onclick="CommsPanel._testDiscord()">Send test</button>
        </div>
      </div>
      <div class="comms-status-bar" id="ds-status-bar">
        <span id="ds-status-dot" class="comms-status-dot comms-status-off"></span>
        <span id="ds-status-text">Not connected</span>
        <span id="ds-bot-name" class="comms-bot-name"></span>
      </div>
      <div class="comms-actions">
        <button class="btn-primary" id="ds-connect-btn" onclick="CommsPanel._saveDiscord()">Connect</button>
        <button class="btn-secondary" id="ds-disconnect-btn" onclick="CommsPanel._stopPlatform('discord')" style="display:none">Disconnect</button>
      </div>
      <p id="ds-error" class="comms-error" style="display:none"></p>
    `;
  },

  // ── Tab switching ───────────────────────────────────────────────────────────

  _switchTab(name) {
    this.modal.querySelectorAll('.comms-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === name));
    this.modal.querySelectorAll('.comms-tab-pane').forEach(p => p.style.display = 'none');
    this.modal.querySelector(`#comms-tab-${name}`).style.display = 'block';
  },

  // ── Load & apply status ─────────────────────────────────────────────────────

  async _loadStatus() {
    try {
      const data = await window.ApiV2._fetch('/comms/status');
      this._status = data;
      this._applyStatus(data);
      this._renderHistory(data.history || []);
    } catch (err) {
      console.warn('[CommsPanel] status load failed:', err.message);
    }
  },

  _applyStatus(data) {
    if (!this.modal) return;
    const tg = data.telegram || {};
    const ds = data.discord  || {};

    // Dots in tab headers
    const dotTg = this.modal.querySelector('#dot-telegram');
    const dotDs = this.modal.querySelector('#dot-discord');
    if (dotTg) dotTg.className = `comms-dot ${tg.connected ? 'comms-dot-on' : 'comms-dot-off'}`;
    if (dotDs) dotDs.className = `comms-dot ${ds.connected ? 'comms-dot-on' : 'comms-dot-off'}`;
    // (Signal tab removed)

    // Telegram tab
    this._applyPlatformStatus('tg', tg);
    if (tg.token && !tg.token.startsWith('***') === false) {
      // token is masked — fill placeholder to show something is set
      const inp = this.modal.querySelector('#tg-token');
      if (inp && !inp.value) inp.placeholder = tg.token; // show masked
    }
    const tgIds = this.modal.querySelector('#tg-chat-ids');
    if (tgIds && tg.allowed_chat_ids?.length) tgIds.value = tg.allowed_chat_ids.join(', ');

    // Discord tab
    this._applyPlatformStatus('ds', ds);
    const dsChIds = this.modal.querySelector('#ds-channel-ids');
    const dsUsIds = this.modal.querySelector('#ds-user-ids');
    if (dsChIds && ds.allowed_channel_ids?.length) dsChIds.value = ds.allowed_channel_ids.join(', ');
    if (dsUsIds && ds.allowed_user_ids?.length)    dsUsIds.value = ds.allowed_user_ids.join(', ');
  },

  _applyPlatformStatus(prefix, data) {
    if (!this.modal) return;
    const dot     = this.modal.querySelector(`#${prefix}-status-dot`);
    const text    = this.modal.querySelector(`#${prefix}-status-text`);
    const botName = this.modal.querySelector(`#${prefix}-bot-name`);
    const connBtn = this.modal.querySelector(`#${prefix}-connect-btn`);
    const discBtn = this.modal.querySelector(`#${prefix}-disconnect-btn`);

    if (!dot) return;

    const connected = data.connected;
    dot.className   = `comms-status-dot ${connected ? 'comms-status-on' : 'comms-status-off'}`;
    text.textContent = connected ? 'Connected' : (data.enabled ? 'Enabled (starting...)' : 'Disconnected');
    botName.textContent = data.username ? `@${data.username}` : '';

    if (connBtn) connBtn.style.display = connected ? 'none' : 'inline-block';
    if (discBtn) discBtn.style.display = connected ? 'inline-block' : 'none';
  },

  // ── Save/connect actions ────────────────────────────────────────────────────

  async _saveTelegram() {
    const token   = this.modal.querySelector('#tg-token').value.trim();
    const idsRaw  = this.modal.querySelector('#tg-chat-ids').value.trim();
    const ids     = idsRaw ? idsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const errEl   = this.modal.querySelector('#tg-error');

    errEl.style.display = 'none';
    this.modal.querySelector('#tg-connect-btn').textContent = 'Connecting...';

    try {
      await window.ApiV2._fetch('/comms/telegram/config', {
        method: 'POST',
        body: JSON.stringify({ token: token || undefined, allowed_chat_ids: ids, enabled: true })
      });
      await this._loadStatus();
    } catch (err) {
      errEl.textContent = '❌ ' + err.message;
      errEl.style.display = 'block';
    } finally {
      this.modal.querySelector('#tg-connect-btn').textContent = 'Connect';
    }
  },

  async _saveDiscord() {
    const token    = this.modal.querySelector('#ds-token').value.trim();
    const chRaw    = this.modal.querySelector('#ds-channel-ids').value.trim();
    const usRaw    = this.modal.querySelector('#ds-user-ids').value.trim();
    const chIds    = chRaw ? chRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const usIds    = usRaw ? usRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const errEl    = this.modal.querySelector('#ds-error');

    errEl.style.display = 'none';
    this.modal.querySelector('#ds-connect-btn').textContent = 'Connecting...';

    try {
      await window.ApiV2._fetch('/comms/discord/config', {
        method: 'POST',
        body: JSON.stringify({ token: token || undefined, allowed_channel_ids: chIds, allowed_user_ids: usIds, enabled: true })
      });
      await this._loadStatus();
    } catch (err) {
      errEl.textContent = '❌ ' + err.message;
      errEl.style.display = 'block';
    } finally {
      this.modal.querySelector('#ds-connect-btn').textContent = 'Connect';
    }
  },

  async _stopPlatform(platform) {
    try {
      await window.ApiV2._fetch(`/comms/${platform}/config`, {
        method: 'POST',
        body: JSON.stringify({ enabled: false })
      });
      await this._loadStatus();
    } catch (err) {
      console.warn('[CommsPanel] stop failed:', err);
    }
  },

  // ── Test messages ───────────────────────────────────────────────────────────

  async _testTelegram() {
    const chatId = this.modal.querySelector('#tg-test-id').value.trim();
    if (!chatId) return SquidModal.alert('Enter a Chat ID first.');
    try {
      await window.ApiV2._fetch('/comms/telegram/test', {
        method: 'POST',
        body: JSON.stringify({ chat_id: chatId })
      });
      SquidModal.alert('✅ Test message sent!');
    } catch (err) {
      SquidModal.alert('❌ ' + err.message);
    }
  },

  async _testDiscord() {
    const channelId = this.modal.querySelector('#ds-test-id').value.trim();
    if (!channelId) return SquidModal.alert('Enter a Channel ID first.');
    try {
      await window.ApiV2._fetch('/comms/discord/test', {
        method: 'POST',
        body: JSON.stringify({ channel_id: channelId })
      });
      SquidModal.alert('✅ Test message sent!');
    } catch (err) {
      SquidModal.alert('❌ ' + err.message);
    }
  },

  // ── History ─────────────────────────────────────────────────────────────────

  _renderHistory(history) {
    const el = this.modal?.querySelector('#comms-history-list');
    if (!el) return;
    if (!history || history.length === 0) {
      el.innerHTML = '<p class="comms-hint">No messages yet.</p>';
      return;
    }
    const rows = [...history].reverse().slice(0, 15).map(m => {
      const platform = m.platform === 'telegram' ? '✈️' : m.platform === 'discord' ? '🎮' : '📨';
      const time = m.at ? new Date(m.at).toLocaleTimeString() : '';
      const ok   = m.ok ? '✅' : '❌';
      return `
        <div class="comms-history-row ${m.ok ? '' : 'comms-history-err'}">
          <div class="comms-history-meta">${platform} <b>${this._esc(m.from || '?')}</b> <span class="comms-history-time">${time}</span></div>
          <div class="comms-history-text">→ ${this._esc((m.text || '').slice(0, 80))}${(m.text||'').length > 80 ? '…' : ''}</div>
          ${m.reply ? `<div class="comms-history-reply">${ok} ${this._esc(m.reply.slice(0, 120))}${m.reply.length > 120 ? '…' : ''}</div>` : ''}
        </div>
      `;
    }).join('');
    el.innerHTML = rows;
  },

  async _clearHistory() {
    try {
      await window.ApiV2._fetch('/comms/history', { method: 'DELETE' });
      await this._loadStatus();
    } catch {}
  },

  // ── Polling ─────────────────────────────────────────────────────────────────

  _startPolling() {
    this._stopPolling();
    this._statusInterval = setInterval(() => this._loadStatus(), 4000);
  },

  _stopPolling() {
    if (this._statusInterval) clearInterval(this._statusInterval);
    this._statusInterval = null;
  },

  // ── Helpers ──────────────────────────────────────────────────────────────────

  _wireEvents() {
    // Close on backdrop click
    this.modal.addEventListener('click', e => {
      if (e.target === this.modal) this.close();
    });
  },

  _toggleVisible(id) {
    const inp = this.modal.querySelector('#' + id);
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  },

  _esc(s) {
    return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  }
};

window.CommsPanel = CommsPanel;
console.log('[OK] CommsPanel loaded');
