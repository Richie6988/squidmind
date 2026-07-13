/* v1781267640088 */
/**
 * PoseidonChat - Streaming AI chat panel.
 * Handles SSE streaming, thinking blocks, tool calls, history.
 */
const PoseidonChat = {
  modal: null,
  history: [],
  currentRequest: null,
  _copyStore: new Map(),
  _copyCounter: 0,
  _mutatedThisTurn: false,
  _thinkText: '',

  async open() {
    this._buildModal();
    await this._refreshStatus();
    // Signal server: chat open -- pause BG tasks
    window.api._fetch('/poseidon/chat-active', { method: 'POST', body: JSON.stringify({ active: true }) }).catch(() => {});
    // Poll broker state every 3s so busy indicator stays current
    clearInterval(this._statusInterval);
    this._statusInterval = setInterval(() => this._refreshStatus(), 3000);
    // Auto-continue: if last session had an incomplete task, resume it immediately
    // without requiring any user input.
    this._tryAutoContinue();
  },

  async _tryAutoContinue() {
    try {
      const ss = await window.api._fetch('/poseidon/session-state');
      if (!ss?.last_user_message || ss.emergency) return;
      // Only resume if the last message wasn't already a resume injection
      if (ss.last_user_message.startsWith('[RESUME')) return;
      // Only resume if session is fresh (we just opened the modal = new session likely)
      const status = await window.api._fetch('/models/status');
      const pm = status?.loaded_models?.find(m => m.model_id === status.poseidon_model_id);
      if (!pm) return;  // no model loaded
      if (pm.session_turns > 0) return;  // already mid-session, don't hijack
      const ageMs = ss.saved_at ? Date.now() - new Date(ss.saved_at).getTime() : 0;
      if (ageMs > 30 * 60 * 1000) return;  // stale (>30min) — don't resume
      // Show a subtle indicator then auto-send
      const tools = ss.tool_calls_this_turn?.length ? ' [' + ss.tool_calls_this_turn.join(', ') + ']' : '';
      const resumeMsg = '[RESUME PREVIOUS TASK — turn ' + ss.turn + tools + ']\n' +
        'User previously asked: "' + ss.last_user_message + '"\n' +
        'Your last response: "' + ss.last_response_preview + '"\n' +
        'The task was not completed. Resume and finish it now without re-introducing yourself.';
      // Small delay so the modal renders first
      setTimeout(() => this._sendRaw(resumeMsg), 600);
    } catch {}
  },

  // Send a message programmatically (bypasses textarea)
  _sendRaw(msg) {
    if (this.currentRequest) return;
    this._clearAttachments();
    const ta = this.modal?.querySelector('#pc-input');
    if (!ta) return;
    // Show a subtle resume indicator
    const msgs = this.modal?.querySelector('#pc-messages');
    if (msgs) {
      const el = document.createElement('div');
      el.style.cssText = 'font-size:10px;color:var(--text-muted,#888);text-align:center;padding:4px 0;opacity:0.7;font-style:italic;';
      el.textContent = '↩ Resuming previous task…';
      msgs.appendChild(el);
    }
    ta.value = msg;
    this._send();
  },

  // ── Build Modal ──────────────────────────────────────────────────────────

  _buildModal() {
    if (this.modal && document.body.contains(this.modal)) {
      requestAnimationFrame(() => this._syncOverlayBounds());
    this.modal.classList.remove('hidden');
      return;
    }
    this.modal = document.createElement('div');
    this.modal.className = 'modal pc-overlay';
    this.modal.innerHTML = `
      <div class="pc-modal">
        <!-- Header -->
        <div class="pc-header">
          <div class="pc-header-left">
            <div class="pc-avatar-glow">
              <div class="pc-avatar">🔱</div>
            </div>
            <div class="pc-header-info">
              <span class="pc-name">POSEIDON</span>
              <span class="pc-model-tag" id="pc-model-tag">loading...</span>
            </div>
          </div>
          <div class="pc-header-right">
            <button class="pc-btn" onclick="PoseidonChat.close(); ModelLoader.open();" title="Manage models">⚙ Models</button>
            <button class="pc-btn" id="pc-voice-settings-btn" onclick="PoseidonChat._toggleVoiceSettings()" title="Voice settings (STT/TTS)">🎙 Voice</button>
            <button class="pc-close" onclick="PoseidonChat.close()">✕</button>
          </div>
        </div>

        <!-- Status bar -->
        <div class="pc-status-bar" id="pc-status-bar">
          <span id="pc-status-text" class="pc-status-idle">Ready</span>
        </div>

        <!-- Messages -->
        <div class="pc-messages" id="pc-messages">
          <div class="pc-welcome">
            <div class="pc-welcome-icon">🔱</div>
            <div class="pc-welcome-title">POSEIDON</div>
            <div class="pc-welcome-sub">AI Orchestrator — IAQUA v2</div>
          </div>
        </div>

        <!-- Input -->
        <div class="pc-input-area">
          <!-- Attachment previews strip -->
          <div class="pc-attachments" id="pc-attachments"></div>
          <div class="pc-input-wrap" id="pc-input-wrap">
            <button class="pc-attach-btn" id="pc-attach-btn" title="Attach file or image">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            </button>
            <input type="file" id="pc-file-input" style="display:none" accept="image/*,.pdf,.txt,.md,.json,.csv,.js,.ts,.py,.html,.css" multiple>
            <textarea id="pc-input" class="pc-input" placeholder="Message Poseidon… (Ctrl+Enter to send, paste images/files)" rows="1"></textarea>
            <div class="pc-input-actions">
              <button class="pc-tts-btn" id="pc-tts" title="Read last response aloud" style="display:none">🔊</button>
              <button class="pc-send" id="pc-send" title="Send">
                <svg id="pc-send-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
              </button>
              <button class="pc-stop-btn" id="pc-stop" title="Stop generation" style="display:none">■ Stop</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
    requestAnimationFrame(() => this._syncOverlayBounds());
    // Keep overlay synced if window resizes (e.g. panel drag)
    if (!this._resizeObserver) {
      this._resizeObserver = new ResizeObserver(() => this._syncOverlayBounds());
      // Watch aquarium (resizes when control tower is dragged)
      const aq = document.querySelector('.aquarium-wrapper');
      if (aq) this._resizeObserver.observe(aq);
      // Also watch right-panel for drag-to-resize events
      const rp = document.getElementById('right-panel');
      if (rp) this._resizeObserver.observe(rp);
      window.addEventListener('resize', () => this._syncOverlayBounds());
    }

    const ta   = this.modal.querySelector('#pc-input');
    const send = this.modal.querySelector('#pc-send');
    this._attachments = [];  // [{name, type, content, preview}]

    // Wire mic button
    const micBtn = this.modal.querySelector('#pc-mic');
    const ttsBtn = this.modal.querySelector('#pc-tts');
    if (micBtn) micBtn.addEventListener('click', () => this._toggleMic());
    if (ttsBtn) ttsBtn.addEventListener('click', () => this._speakLastResponse());

    // Wire attachment button
    const attachBtn  = this.modal.querySelector('#pc-attach-btn');
    const fileInput  = this.modal.querySelector('#pc-file-input');
    if (attachBtn) attachBtn.addEventListener('click', () => fileInput?.click());
    if (fileInput) fileInput.addEventListener('change', (e) => this._handleFiles(Array.from(e.target.files)));

    // Wire paste handler for images/files
    ta.addEventListener('paste', (e) => {
      const items = Array.from(e.clipboardData?.items || []);
      const fileItems = items.filter(i => i.kind === 'file');
      if (fileItems.length) {
        e.preventDefault();
        this._handleFiles(fileItems.map(i => i.getAsFile()).filter(Boolean));
      }
    });
    const msgs = this.modal.querySelector('#pc-messages');
    const stopBtnEl = this.modal.querySelector('#pc-stop');
    if (stopBtnEl) {
      stopBtnEl.addEventListener('click', () => {
        fetch('/api/v2/poseidon/abort', { method: 'POST' }).catch(() => {});
      });
    }
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._send(); }
    });
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
    });
    send.addEventListener('click', () => this._send());
    // Track user scroll intent — stop auto-scroll if they scrolled up
    msgs.addEventListener('scroll', () => {
      const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
      this._autoScroll = atBottom;
    });
    this._autoScroll = true;

    this._renderHistory();
  },

  // ── Status & History ─────────────────────────────────────────────────────

  async _refreshStatus() {
    const tag = this.modal?.querySelector('#pc-model-tag');
    try {
      const s = await window.api._fetch('/models/status');
      if (!tag) return;
      const broker = s.broker;
      const state  = broker?.state || 'IDLE';
      const owner  = broker?.owner || '';
      if (s.poseidon_model_id) {
        const isBusy = state !== 'IDLE';
        const isBG   = isBusy && owner.startsWith('bg_task');
        // Prefer display_name from library — fall back to model_id
        let modelName = s.poseidon_model_id;
        try {
          const lib = await window.api._fetch('/models/library');
          const entry = (lib.models || []).find(m => m.model_id === s.poseidon_model_id);
          if (entry?.display_name) modelName = entry.display_name;
        } catch {}
        const label  = isBG   ? `⏳ ${modelName} — task running`
                     : isBusy ? `⏳ ${modelName} — busy`
                     :          modelName;
        tag.textContent = label;
        tag.className = isBusy ? 'pc-model-tag pc-model-busy' : 'pc-model-tag pc-model-ready';
      } else {
        tag.textContent = 'no model assigned';
        tag.className = 'pc-model-tag pc-model-warn';
      }
    } catch { if (tag) tag.textContent = 'offline'; }
  },

  _setStatus(text, type = 'loading') {
    const el = this.modal?.querySelector('#pc-status-text');
    if (!el) return;
    el.textContent = text;
    el.className = `pc-status-${type}`;
  },

  _updateTurnCounter() { /* removed — no wipe */ },

  _renderHistory() {
    const msgs = this.modal?.querySelector('#pc-messages');
    if (!msgs) return;
    if (this.history.length === 0) {
      msgs.innerHTML = `<div class="pc-welcome">
        <div class="pc-welcome-icon">🔱</div>
        <div class="pc-welcome-title">POSEIDON</div>
        <div class="pc-welcome-sub">AI Orchestrator — IAQUA v2</div>
      </div>`;
      return;
    }
    this._copyStore.clear();
    msgs.innerHTML = this.history.map((t, i) => {
      const cid = ++this._copyCounter;
      this._copyStore.set(cid, t.content || '');
      const ts = t.ts ? `<div class="pc-ts${t.role==='assistant'?' pc-ts-ai':''}">${this._fmtTs(new Date(t.ts))}</div>` : '';
      if (t.role === 'user') {
        const _imgPreviews = (t._attachmentPreviews||[]).map(p=>
          `<div class="pc-img-wrap" style="margin:4px 0"><img class="pc-md-img" src="${p.src}" alt="${p.name}" style="max-height:120px"></div>`
        ).join('');
        return `<div class="pc-msg pc-msg-user"><div class="pc-bubble-user">${_imgPreviews}${this._esc(t.content)}</div><div class="pc-msg-actions"><button class="pc-copy-btn" onclick="PoseidonChat._copyText(this)" data-cid="${cid}">⎘</button></div>${ts}</div>`;
      } else {
        return `<div class="pc-msg pc-msg-ai" id="pc-msg-${i}"><div class="pc-ai-row"><div class="pc-ai-dot">🔱</div><div class="pc-bubble-ai pc-text-final">${this._md(t.content)}</div></div><div class="pc-msg-actions"><button class="pc-copy-btn" onclick="PoseidonChat._copyText(this)" data-cid="${cid}">⎘</button></div>${ts}</div>`;
      }
    }).join('');
    this._scrollToBottom(msgs);
  },

  // ── Send / Stream ─────────────────────────────────────────────────────────

  async _send() {
    const ta = this.modal?.querySelector('#pc-input');
    const msgRaw = ta?.value.trim();
    if (!msgRaw && !this._attachments?.length) return;
    if (this.currentRequest) return;
    // Store image previews on history entry before clearing attachments
    const _imgPreviews = (this._attachments||[]).filter(a=>a.type==='image').map(a=>({src:a.preview,name:a.name}));
    const msg = this._buildMessageWithAttachments(msgRaw || '(see attachment)');
    this._clearAttachments();
    ta.value = ''; ta.style.height = 'auto';

    const msgTs = new Date();
    this._autoScroll = true;  // new message → snap to bottom
    this.history.push({ role: 'user', content: msg, ts: msgTs, _attachmentPreviews: _imgPreviews });
    const aiIdx = this.history.length;
    const aiTs = new Date();
    this.history.push({ role: 'assistant', content: '', ts: aiTs });

    // Add user bubble
    const msgs = this.modal.querySelector('#pc-messages');
    msgs.querySelector('.pc-welcome')?.remove();
    const userEl = document.createElement('div');
    userEl.className = 'pc-msg pc-msg-user';
    const userCid = ++this._copyCounter;
    this._copyStore.set(userCid, msgRaw || '');
    const _uImgPreviews = (_imgPreviews||[]).map(p =>
      `<div class="pc-img-wrap" style="margin:4px 0"><img class="pc-md-img" src="${p.src}" alt="${p.name}" style="max-height:120px"></div>`
    ).join('');
    userEl.innerHTML = `<div class="pc-bubble-user">${_uImgPreviews}${this._esc(msgRaw || msg)}</div>
      <div class="pc-msg-actions"><button class="pc-copy-btn" onclick="PoseidonChat._copyText(this)" data-cid="${userCid}">⎘</button></div>
      <div class="pc-ts">${this._fmtTs(msgTs)}</div>`;
    msgs.appendChild(userEl);

    // Add AI placeholder
    const aiEl = document.createElement('div');
    aiEl.className = 'pc-msg pc-msg-ai';
    aiEl.id = `pc-msg-${aiIdx}`;
    aiEl.innerHTML = `<div class="pc-ai-row"><div class="pc-ai-dot">🔱</div><div class="pc-bubble-ai" id="pc-content-${aiIdx}"></div></div><div class="pc-ts pc-ts-ai" id="pc-ts-${aiIdx}"></div>`;
    msgs.appendChild(aiEl);
    this._scrollToBottom(msgs);

    const contentEl = aiEl.querySelector(`#pc-content-${aiIdx}`);
    const sendBtn   = this.modal.querySelector('#pc-send');
    const sendIcon  = this.modal.querySelector('#pc-send-icon');
    sendBtn.disabled = true;
    sendIcon.innerHTML = '<circle cx="12" cy="12" r="3" opacity=".4"><animate attributeName="r" values="3;8;3" dur="1s" repeatCount="indefinite"/><animate attributeName="opacity" values=".8;.1;.8" dur="1s" repeatCount="indefinite"/></circle>';
    const stopBtn = this.modal.querySelector('#pc-stop');
    if (stopBtn) stopBtn.style.display = 'inline-flex';
    const sendBtn2 = this.modal?.querySelector('#pc-send');
    if (sendBtn2) sendBtn2.style.display = 'none';

    // Loading indicator
    let firstToken = false;
    const startMs = Date.now();

    // Animated loader card inside the bubble
    contentEl.innerHTML = `<div class="pc-loader" id="pc-loader-active">
      <div class="pc-loader-ring"><span></span></div>
      <div class="pc-loader-text">
        <span class="pc-loader-msg" id="pc-loader-msg">Connecting to Poseidon…</span>
        <span class="pc-loader-elapsed" id="pc-loader-elapsed">0s</span>
      </div>
    </div>`;
    this._setStatus('Connecting...', 'loading');

    // Elapsed timer
    const elapsedTimer = setInterval(() => {
      const el = contentEl.querySelector('#pc-loader-elapsed');
      if (el) el.textContent = Math.floor((Date.now() - startMs) / 1000) + 's';
    }, 1000);

    // Progressive status messages
    // Adapt wording to whether the model has already produced a reply
    // in this session. First-message wording talks about loading; after
    // that we know the model is loaded and the wait is just inference.
    const isWarm = this._hasHadReply === true;
    const statusSeq = isWarm ? [
      [1500, 'Processing your message…'],
      [8000, 'Thinking…'],
      [30000,'Long response — still generating…'],
      [90000,'Taking longer than usual — you can hit stop and rephrase…'],
    ] : [
      [800,  'Sending to model…'],
      [3000, 'Loading model into VRAM…'],
      [12000,'Still loading — large model, please wait…'],
      [40000,'Taking longer than usual. Model may be loading from disk…'],
    ];
    const timers = statusSeq.map(([delay, msg]) =>
      setTimeout(() => {
        if (firstToken) return;
        // A real server status (broker wait / prefill progress) beats the
        // client-side guesses — stop cycling canned messages over it.
        if (this._serverStatusSeen) return;
        const el = contentEl.querySelector('#pc-loader-msg');
        if (el) el.textContent = msg;
        this._setStatus(msg, 'loading');
      }, delay)
    );
    this._serverStatusSeen = false;  // reset per message
    const clearTimers = () => {
      timers.forEach(clearTimeout);
      clearInterval(elapsedTimer);
    };

    let fullText = '';

    try {
      const res = await fetch('/api/v2/poseidon/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: this.history.slice(0, -2) })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      this.currentRequest = reader;
      this._generating = true;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop();

        for (const part of parts) {
          if (!part.trim()) continue;
          let evType = 'message', data = '';
          for (const line of part.split('\n')) {
            if (line.startsWith('event:')) evType = line.slice(6).trim();
            else if (line.startsWith('data:')) data = line.slice(5).trim();
          }
          if (!data) continue;
          try {
            const p = JSON.parse(data);
            this._handleEvent(evType, p, contentEl, msgs, () => {
              if (!firstToken) {
                firstToken = true;
                this._hasHadReply = true;
                clearTimers();
                contentEl.querySelector('.pc-loader')?.remove();
                this._setStatus('Generating…', 'generating');
              }
              fullText += (evType === 'message' || evType === 'text') ? (p.text || '') : '';
            });
          } catch (evErr) {
            // Re-throw server 'error' events — don't silently swallow them
            if (evType === 'error') throw evErr;
            // Other parse/handler errors are non-fatal, skip the chunk
          }
        }
        this._scrollToBottom(msgs);
      }

      clearTimers();
      this._setStatus('Ready', 'idle');
      this.history[aiIdx].content = fullText || '(no response)';
      // Update the copy button's store entry now that history is final
      // Find the AI bubble and update its button's cid entry
      const _lastAi = this.modal?.querySelectorAll('.pc-msg-ai');
      const _lastAiEl = _lastAi?.[_lastAi.length - 1];
      const _lastBtn = _lastAiEl?.querySelector('.pc-copy-btn');
      if (_lastBtn?.dataset?.cid) {
        PoseidonChat._copyStore.set(parseInt(_lastBtn.dataset.cid, 10), fullText || '(no response)');
      }
      // Stamp the AI message with finish time
      const tsEl = aiEl.querySelector(`#pc-ts-${aiIdx}`);
      if (tsEl) tsEl.textContent = this._fmtTs(new Date());

    } catch (err) {
      clearTimers();
      this._setStatus('Error', 'error');
      const msg = this._friendlyError(err.message);
      contentEl.innerHTML = `<div class="pc-error">${this._esc(msg)}</div>`;
      this.history[aiIdx].content = msg;
    } finally {
      this.currentRequest = null;
      this._generating = false;
      sendBtn.disabled = false;
      sendIcon.innerHTML = '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>';
      if (stopBtn) stopBtn.style.display = 'none';
      const sendBtnEnd = this.modal?.querySelector('#pc-send');
      if (sendBtnEnd) sendBtnEnd.style.display = '';
      if (this._mutatedThisTurn) {
        window.aquarium?.loadSquids?.();
        window.ProjectsPanel?.refresh?.();
        this._mutatedThisTurn = false;
      }
    }
  },

  // ── Event Handler ────────────────────────────────────────────────────────

  _handleEvent(type, p, el, msgs, onFirstToken) {
    const MUTATING = ['create_agent','delete_agent','update_agent_field',
                      'create_project','archive_project','create_task',
                      'write_file','edit_file','github_commit','github_pull'];

    if (type === 'error')          { throw new Error(p.error); }
    if (type === 'status') {
      // Progress info (broker wait, slow prefill) — update the loader label
      // and status bar. Deliberately NOT onFirstToken(): the loader stays
      // until real content arrives.
      this._serverStatusSeen = true;
      const lm = el.querySelector('#pc-loader-msg') || this.modal?.querySelector('#pc-loader-msg');
      if (lm && p.message) lm.textContent = p.message;
      if (p.message) this._setStatus(p.message, 'generating');
      return;
    }
    if (type === 'start')          { this._mutatedThisTurn = false; return; }
    if (type === 'end') {
      if (p.turn !== undefined) this._updateTurnCounter();
      this._updateTtsButton();  // show 🔊 button after response
      // Flush any tail text (last sentence without a terminator) to the
      // streaming voice queue instead of falling back to whole-reply speech.
      // If streaming voice wasn't enabled for this turn, fall through to the
      // legacy full-reply auto-speak.
      if (this._streamVoiceActive) {
        this._flushStreamSpeak();
        this._streamVoiceActive = false;
      } else {
        this._maybeAutoSpeak();
      }
      // Inject copy button — read accumulated text from contentEl's text nodes
      const lastAiMsg = this.modal?.querySelectorAll('.pc-msg-ai');
      const lastMsg = lastAiMsg?.[lastAiMsg.length - 1];
      if (lastMsg && !lastMsg.querySelector('.pc-copy-btn')) {
        // Collect text from all .pc-text-final nodes (the actual streamed content)
        const textNodes = lastMsg.querySelectorAll('.pc-text-final');
        let fullText = '';
        textNodes.forEach(n => { fullText += (n.dataset.raw || n.textContent || ''); });
        // Fallback: history (may still be empty here but try)
        if (!fullText) fullText = this.history.filter(h => h.role === 'assistant').slice(-1)[0]?.content || '';
        const actions = document.createElement('div');
        actions.className = 'pc-msg-actions';
        actions.innerHTML = '<button class="pc-copy-btn" title="Copy">⎘</button>';
        const liveCid = ++PoseidonChat._copyCounter;
        PoseidonChat._copyStore.set(liveCid, fullText);
        const btn = actions.querySelector('.pc-copy-btn');
        btn.dataset.cid = String(liveCid);
        btn.setAttribute('onclick', 'PoseidonChat._copyText(this)');
        const ts = lastMsg.querySelector('.pc-ts-ai') || lastMsg.querySelector('.pc-ts');
        if (ts) lastMsg.insertBefore(actions, ts); else lastMsg.appendChild(actions);
      }
      return;
    }
    if (type === 'thinking_start') { onFirstToken(); el.querySelector('.pc-loader')?.remove(); this._startThink(el); return; }
    if (type === 'thinking')       { this._appendThink(el, p.text || ''); return; }
    if (type === 'thinking_end')   { this._endThink(el); return; }
    if (type === 'tool_call') {
      onFirstToken();
      if (MUTATING.includes(p.name)) this._mutatedThisTurn = true;
      this._addToolCall(el, p.name, p.args);
      return;
    }
    if (type === 'tool_result') {
      this._resolveToolCall(el, p.name, p.ok, p.summary, p.duration_ms);
      return;
    }
    // image event
    if (type === 'image') {
      onFirstToken();
      let tNode = el.querySelector('.pc-text-final');
      if (!tNode) { tNode = document.createElement('div'); tNode.className = 'pc-text-final'; el.appendChild(tNode); }
      const iWrap = document.createElement('div');
      iWrap.className = 'pc-img-wrap';
      iWrap.innerHTML = `<img class="pc-md-img" src="${p.url}" alt="${p.alt||''}" loading="lazy"><div class="pc-img-caption">${p.caption||p.alt||''}</div>`;
      tNode.appendChild(iWrap);
      return;
    }

    // text chunk
    if (p.text) {
      onFirstToken();
      // Get the last text segment, or create a new one after the last tool
      let node = el.lastElementChild?.classList.contains('pc-text-final')
        ? el.lastElementChild : null;
      if (!node) {
        node = document.createElement('div');
        node.className = 'pc-text-final';
        el.appendChild(node);
      }
      // Store raw text, render as markdown
      node.dataset.raw = (node.dataset.raw || '') + p.text;
      node.innerHTML = this._md(node.dataset.raw);
      // Streaming voice: extract every COMPLETE sentence produced so far and
      // send it to the TTS queue. Playback starts on the first sentence
      // instead of waiting for the whole reply — immersion + latency win.
      this._maybeStreamSpeak(p.text);
    }
  },

  // ── Thinking Block ───────────────────────────────────────────────────────

  _startThink(el) {
    el.querySelector('.pc-think')?.remove();
    const d = document.createElement('div');
    d.className = 'pc-think pc-think-live';
    d.innerHTML = `
      <button class="pc-think-hd" onclick="this.closest('.pc-think').classList.toggle('pc-think-closed')">
        <span class="pc-think-spark">✦</span>
        <span class="pc-think-lbl">Thinking<span class="pc-think-dots"><i></i><i></i><i></i></span></span>
        <span class="pc-think-arr">▾</span>
      </button>
      <div class="pc-think-body"></div>`;
    el.insertBefore(d, el.querySelector('.pc-text-final') || null);
    this._thinkText = '';
  },

  _appendThink(el, chunk) {
    this._thinkText += chunk;
    const body = el.querySelector('.pc-think-body');
    if (body) body.textContent = this._thinkText;
  },

  _endThink(el) {
    const d = el.querySelector('.pc-think');
    if (!d) return;
    d.classList.remove('pc-think-live');
    const toks = Math.round((this._thinkText || '').length / 4);
    const lbl  = d.querySelector('.pc-think-lbl');
    if (lbl) lbl.textContent = `Reasoned (${toks} tokens)`;
    setTimeout(() => d.classList.add('pc-think-closed'), 600);
    this._thinkText = '';
  },

  // ── Tool Calls ───────────────────────────────────────────────────────────

  _addToolCall(el, name, args) {
    const d  = document.createElement('div');
    d.className = 'pc-tool pc-tool-pending';
    d.dataset.fn = name;
    // Build full args display — no truncation on keys, 200 chars on values
    const argsHtml = Object.entries(args || {})
      .map(([k, v]) => {
        const vs = typeof v === 'string' ? v : JSON.stringify(v);
        const display = vs.length > 200 ? vs.slice(0, 200) + '…' : vs;
        return `<span class="pc-tool-kv"><span class="pc-tool-key">${k}</span>: <span class="pc-tool-argval">${this._esc(display)}</span></span>`;
      }).join('');
    d.innerHTML = `
      <div class="pc-tool-header">
        <span class="pc-tool-icon" style="display:inline-flex;align-items:center;flex-shrink:0;">${window.PixelIcons?.inline('tools',10)||'⚡'}</span>
        <span class="pc-tool-name">${this._esc(name)}</span>
        <span class="pc-tool-spin">◌</span>
      </div>
      ${argsHtml ? `<div class="pc-tool-args">${argsHtml}</div>` : ''}`;
    // Seal current text segment, then append tool in stream order
    const cur = el.querySelector('.pc-text-final:last-of-type');
    if (cur) cur.classList.remove('pc-text-final');
    el.appendChild(d);
  },

  _resolveToolCall(el, name, ok, summary, ms) {
    const pending = [...el.querySelectorAll(`.pc-tool-pending[data-fn="${name}"]`)];
    const d = pending[pending.length - 1];
    if (!d) return;
    d.classList.remove('pc-tool-pending');
    d.classList.add(ok ? 'pc-tool-ok' : 'pc-tool-fail');
    const spin = d.querySelector('.pc-tool-spin');
    const statusIcon = ok
      ? (window.PixelIcons?.inline('ok',10)||'✓')
      : (window.PixelIcons?.inline('error',10)||'✗');
    // summary can be long (file content preview) — show up to 400 chars
    const sumDisplay = (summary || '').length > 400
      ? summary.slice(0, 400) + '…'
      : (summary || '');
    if (spin) spin.outerHTML = `<span class="pc-tool-res ${ok ? 'ok' : 'fail'}">${statusIcon} <span class="pc-tool-sum">${this._esc(sumDisplay)}</span>${ms ? ` <em class="pc-tool-ms">${ms}ms</em>` : ''}</span>`;
  },

  // ── Controls ────────────────────────────────────────────────────────────

  async resetConversation() {
    if (!await SquidModal.confirm('Wipe conversation? Model stays loaded.')) return;
    try {
      await fetch('/api/v2/poseidon/reset-session', { method: 'POST' });
      this.history = [];
      this._renderHistory();
      this._setStatus('Context wiped', 'idle');
    } catch (e) { await SquidModal.alert('Reset failed: ' + e.message); }
  },

  _syncOverlayBounds() {
    if (!this.modal) return;
    // html { zoom: 130% } (pixel.css): getBoundingClientRect() returns
    // VISUAL viewport px, but top/left/width set on an element inside the
    // zoomed root are multiplied by the zoom again at paint time — so every
    // coordinate landed 1.3× too far and the overlay overflowed the window.
    // Divide by the effective zoom to convert visual px → layout px.
    const zEl = document.documentElement;
    const z = (typeof zEl.currentCSSZoom === 'number' && zEl.currentCSSZoom > 0)
      ? zEl.currentCSSZoom
      : (parseFloat(getComputedStyle(zEl).zoom) || 1);
    // Use aquarium bounding box as the exact target area
    const aq  = document.querySelector('.aquarium-wrapper');
    const hdr = document.querySelector('header');

    if (aq) {
      const r = aq.getBoundingClientRect();
      // Clamp right edge to the left border of the right panel (Tower).
      // CSS .modal.pc-overlay has width:auto/left:0/right:480px with !important,
      // so we MUST use setProperty with 'important' or our inline styles lose.
      const rp     = document.getElementById('right-panel');
      const rpLeft = rp ? rp.getBoundingClientRect().left : window.innerWidth;
      const w      = Math.min(r.width, rpLeft - r.left);
      const top    = hdr ? hdr.getBoundingClientRect().bottom : r.top;
      this.modal.style.setProperty('left',   (r.left / z) + 'px', 'important');
      this.modal.style.setProperty('top',    (top / z) + 'px',    'important');
      this.modal.style.setProperty('width',  (w / z) + 'px',      'important');
      this.modal.style.setProperty('right',  'auto',        'important');
      this.modal.style.setProperty('bottom', '0px',         'important');
    } else {
      // Fallback: cover everything left of projects-container (or right-panel)
      const proj = document.getElementById('projects-container');
      const rp   = document.getElementById('right-panel');
      const cutEl = proj || rp;
      const t    = hdr ? hdr.getBoundingClientRect().bottom : 70;
      const rightPx = cutEl ? (window.innerWidth - cutEl.getBoundingClientRect().left) : 480;
      this.modal.style.setProperty('left',   '0px',        'important');
      this.modal.style.setProperty('top',    (t / z) + 'px',     'important');
      this.modal.style.setProperty('right',  (rightPx / z) + 'px', 'important');
      this.modal.style.setProperty('width',  'auto',       'important');
      this.modal.style.setProperty('bottom', '0px',        'important');
    }
  },

  close() {
    clearInterval(this._statusInterval);
    // If Poseidon is generating, just hide the modal — don't abort or signal inactive.
    // The stream continues in the background and history is preserved.
    if (!this._generating) {
      window.api._fetch('/poseidon/chat-active', { method: 'POST', body: JSON.stringify({ active: false }) }).catch(() => {});
    }
    this.modal?.classList.add('hidden');
  },

  // ── Helpers ──────────────────────────────────────────────────────────────

  _friendlyError(msg) {
    if (/Invalid GGUF/i.test(msg))    return 'Invalid model file. Use Browse Files or Download HF.';
    if (/out of memory|VRAM/i.test(msg)) return msg + '\n\nTip: Edit Params → Context Length: 2048';
    if (/No sequences/i.test(msg))    return 'Session exhausted — click Wipe to reset.';
    if (/No model assigned/i.test(msg)) return 'No model assigned. Open Models and click "Use as Poseidon".';
    if (/Model file.*missing/i.test(msg)) return 'Model file missing — re-import from Models panel.';
    if (/context.*too small/i.test(msg)) return msg;
    return msg;
  },

  _fmtTs(d) {
    if (!d) return '';
    const dt = d instanceof Date ? d : new Date(d);
    const dd  = String(dt.getDate()).padStart(2,'0');
    const mm  = String(dt.getMonth()+1).padStart(2,'0');
    const yy  = dt.getFullYear();
    const hh  = String(dt.getHours()).padStart(2,'0');
    const min = String(dt.getMinutes()).padStart(2,'0');
    return `${dd}/${mm}/${yy} ${hh}:${min}`;
  },

  // Lightweight markdown → HTML renderer
  // Handles: code blocks, inline code, headers, bold, italic, links, lists, blockquotes, hr, br
  _md(raw) {
    if (!raw) return '';
    let s = String(raw);

    // Escape HTML first (for non-code parts) — we'll unescape code specially
    const escMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
    const safeEsc = t => t.replace(/[&<>"]/g, c => escMap[c]);

    // Extract and protect fenced code blocks ``` ... ```
    const codeBlocks = [];
    s = s.replace(/```(\w*)[\n]?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre class="pc-code-block"><code class="pc-code-lang-${lang || 'text'}">${safeEsc(code.trim())}</code></pre>`);
      return ` CODE${idx} `;
    });

    // Extract images BEFORE HTML escaping (escaping corrupts URLs in src attributes)
    const imgBlocks = [];
    // Match ![alt](url) — more permissive: url may have commas, encoded chars
    s = s.replace(/!\[([^\]]*?)\]\(([^\)\n]+)\)/g, function(_, alt, url) {
      url = url.trim();
      var isImg = /upload\.wikimedia\.org/i.test(url)
               || /\.(png|jpg|jpeg|gif|webp|svg)(\?[^)]*)?$/i.test(url);
      if (isImg) {
        var n = imgBlocks.length;
        imgBlocks.push(
          '<div class="pc-img-wrap">' +
          '<img class="pc-md-img" src="' + url + '" alt="' + alt.replace(/"/g,'&quot;') + '" loading="lazy" ' +
          'onerror="this.style.display=\'none\'; if(this.nextSibling)this.nextSibling.style.display=\'block\'">' +
          '<div style="display:none;color:#475569;font-size:10px;padding:4px;">⚠ Could not load image</div>' +
          (alt ? '<div class="pc-img-caption">' + alt + '</div>' : '') +
          '</div>'
        );
        return '\x00IMG' + n + '\x00';
      }
      // Not an image — treat as link
      return '\x00LINK' + alt + '|||' + url + '\x00';
    });
    // Bare image URLs on their own line
    s = s.replace(/^(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp|svg)\S*)$/gim, function(_, url) {
      var n = imgBlocks.length;
      imgBlocks.push('<div class="pc-img-wrap"><img class="pc-md-img" src="' + url + '" alt="" loading="lazy"></div>');
      return '\x00IMG' + n + '\x00';
    });
    s = s.replace(/^(https?:\/\/\S+\.(?:png|jpg|jpeg|gif|webp|svg)(\?\S*)?)$/gim, function(_, url) {
      var idx2 = imgBlocks.length;
      imgBlocks.push('<div class="pc-img-wrap"><img class="pc-md-img" src="' + url + '" alt="" loading="lazy"></img></div>');
      return '\x00IMG' + idx2 + '\x00';
    });

    // Escape remaining HTML
    s = safeEsc(s);

    // Inline code `...`
    s = s.replace(/`([^`]+)`/g, '<code class="pc-code-inline">$1</code>');

    // Headers
    s = s.replace(/^#{3}\s+(.+)$/gm, '<h4 class="pc-md-h">$1</h4>');
    s = s.replace(/^#{2}\s+(.+)$/gm, '<h3 class="pc-md-h">$1</h3>');
    s = s.replace(/^#{1}\s+(.+)$/gm, '<h2 class="pc-md-h">$1</h2>');

    // Bold + italic
    s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g,     '<em>$1</em>');
    s = s.replace(/_(.+?)_/g,       '<em>$1</em>');

    // (image handling moved to pre-escape section above)

    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a class="pc-md-link" href="$2" target="_blank">$1</a>');

    // Blockquote
    s = s.replace(/^&gt;\s+(.+)$/gm, '<blockquote class="pc-md-quote">$1</blockquote>');

    // HR
    s = s.replace(/^[-*_]{3,}$/gm, '<hr class="pc-md-hr">');

    // Tables
    s = s.replace(/((\|[^\n]+\|\n)(\|[-: |]+\|\n)((?:\|[^\n]+\|\n?)*))/g, (_all, _a, header, _sep, body) => {
      const cells = r => r.replace(/^\s*\|\s*|\s*\|\s*$/g,'').split(/\s*\|\s*/);
      const th = cells(header).map(c => `<th class="pc-md-th">${c}</th>`).join('');
      const trs = body.trim().split('\n').filter(Boolean)
        .map(r => '<tr>' + cells(r).map(c => `<td class="pc-md-td">${c}</td>`).join('') + '</tr>').join('');
      return `<div class="pc-md-table-wrap"><table class="pc-md-table"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>`;
    });;

    // Unordered list items
    s = s.replace(/^[\*\-]\s+(.+)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>[\s\S]*?<\/li>)+/g, m => `<ul class="pc-md-ul">${m}</ul>`);

    // Numbered list items
    s = s.replace(/^\d+\.\s+(.+)$/gm, '<li>$1</li>');

    // Paragraphs: double newline → <p>, single newline → <br>
    s = s.replace(/\n\n+/g, '</p><p class="pc-md-p">');
    s = '<p class="pc-md-p">' + s + '</p>';
    s = s.replace(/\n/g, '<br>');

    // Restore code blocks, images, and plain links
    s = s.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[+i] || '');
    s = s.replace(/\x00IMG(\d+)\x00/g, (_, i) => imgBlocks[+i] || '');
    s = s.replace(/\x00LINK(.*?)\|\|\|(.*?)\x00/g, (_, alt, url) => '<a class="pc-md-link" href="' + url + '" target="_blank">' + (alt || url) + '</a>');    // Clean empty paragraphs
    s = s.replace(/<p class="pc-md-p"><\/p>/g, '');
    s = s.replace(/<p class="pc-md-p">(<(?:h[2-4]|ul|blockquote|hr|pre))/g, '$1');
    s = s.replace(/(<\/(?:h[2-4]|ul|blockquote|pre)>)<\/p>/g, '$1');

    return s;
  },

  _scrollToBottom(el) {
    if (this._autoScroll !== false) {
      el = el || this.modal?.querySelector('#pc-messages');
      if (el) el.scrollTop = el.scrollHeight;
    }
  },

  _copyText(btn) {
    // Read content from _copyStore by data-cid
    const cid = btn && btn.dataset && btn.dataset.cid;
    const raw = cid ? (PoseidonChat._copyStore.get(parseInt(cid, 10)) || '') : '';
    if (!raw) { console.warn('[copy] nothing to copy, cid=', cid, 'store size=', PoseidonChat._copyStore.size); return; }
    const flash = () => {
      if (!btn) return;
      btn.textContent = '✓'; btn.style.color = '#06ffa5';
      setTimeout(() => { btn.textContent = '⎘'; btn.style.color = ''; }, 1400);
    };
    const doCopy = () => {
      const ta = document.createElement('textarea');
      ta.value = raw;
      ta.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;opacity:0.01;z-index:99999;';
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand('copy'); flash(); } catch(e) { console.warn('[copy]', e); }
      document.body.removeChild(ta);
    };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(raw).then(flash).catch(doCopy);
      } else {
        doCopy();
      }
    } catch { doCopy(); }
  },

  _attachments: [],

  async _handleFiles(files) {
    for (const file of files) {
      if (!file) continue;
      const type = file.type || '';
      const name = file.name || 'attachment';
      try {
        if (type.startsWith('image/')) {
          // Image: read as base64 data URL for preview, include description in context
          const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file);
          });
          this._attachments.push({ name, type: 'image', content: dataUrl, preview: dataUrl });
        } else {
          // Text file: read as UTF-8
          const text = await file.text();
          this._attachments.push({ name, type: 'text', content: text.slice(0, 30000), preview: null });
        }
      } catch(e) {
        console.warn('[PoseidonChat] File read error:', e.message);
      }
    }
    this._renderAttachments();
  },

  _renderAttachments() {
    const strip = this.modal?.querySelector('#pc-attachments');
    if (!strip) return;
    if (!this._attachments.length) { strip.innerHTML = ''; return; }
    strip.innerHTML = this._attachments.map((a, i) => {
      if (a.type === 'image') {
        return `<div class="pc-att-chip" title="${a.name}">
          <img src="${a.preview}" class="pc-att-thumb">
          <span>${a.name.slice(0,20)}</span>
          <button onclick="PoseidonChat._removeAttachment(${i})">✕</button>
        </div>`;
      }
      return `<div class="pc-att-chip" title="${a.name}">
        <span class="pc-att-icon">📄</span>
        <span>${a.name.slice(0,20)}</span>
        <span class="pc-att-size">${(a.content.length/1000).toFixed(0)}k chars</span>
        <button onclick="PoseidonChat._removeAttachment(${i})">✕</button>
      </div>`;
    }).join('');
  },

  _removeAttachment(i) {
    this._attachments.splice(i, 1);
    this._renderAttachments();
  },

  _clearAttachments() {
    this._attachments = [];
    const strip = this.modal?.querySelector('#pc-attachments');
    if (strip) strip.innerHTML = '';
    const fi = this.modal?.querySelector('#pc-file-input');
    if (fi) fi.value = '';
  },

  _buildMessageWithAttachments(msg) {
    if (!this._attachments.length) return msg;
    const parts = [];
    for (const a of this._attachments) {
      if (a.type === 'image') {
        // Send the image as base64 data URL — vision models can use it directly,
        // text-only models will see the filename and can use tools to fetch/describe
        parts.push(`[Image attached: ${a.name}]\nData: ${a.content}`);
      } else {
        parts.push(`[File: ${a.name}]\n\`\`\`\n${a.content.slice(0, 12000)}\n\`\`\`${a.content.length > 12000 ? '\n(truncated)' : ''}`);
      }
    }
    parts.push(msg);
    return parts.join('\n\n');
  },

  _esc(s) {
    return String(s ?? '').replace(/[<>&"]/g, c =>
      ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;' })[c]);
  },

  // ── Voice: STT via MediaRecorder → Speaches, TTS via Speaches → Audio ──────

  /** Toggle mic recording. Uses local Speaches if configured, falls back to Web Speech API */
  async _toggleMic() {
    const btn = document.getElementById('pc-mic');
    if (!btn) return;

    // If recording, stop
    if (this._mediaRecorder && this._mediaRecorder.state === 'recording') {
      this._mediaRecorder.stop();
      return;
    }

    // Check if Speaches is configured
    let voiceCfg = null;
    try {
      const r = await window.api._fetch('/voice/config');
      if (r.ok && r.config.enabled) voiceCfg = r.config;
    } catch {}

    if (voiceCfg) {
      // ── Local STT via Speaches ────────────────────────────────────────────
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
        const rec = new MediaRecorder(stream, { mimeType });
        const chunks = [];

        rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

        rec.onstop = async () => {
          stream.getTracks().forEach(t => t.stop());
          btn.textContent = '⏳'; btn.title = 'Transcribing...';
          try {
            const blob = new Blob(chunks, { type: mimeType });
            const form = new FormData();
            form.append('file', blob, 'audio.webm');
            form.append('model', voiceCfg.stt_model || 'Systran/faster-whisper-small');
            if (voiceCfg.language && voiceCfg.language !== 'auto') {
              form.append('language', voiceCfg.language);
            }

            const resp = await fetch('/api/v2/voice/stt', { method: 'POST', body: form });
            const data = await resp.json();

            if (data.ok && data.text?.trim()) {
              const ta = this._getInput();
              if (ta) {
                ta.value = (ta.value ? ta.value + ' ' : '') + data.text.trim();
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
                ta.focus();
              }
            } else if (!data.ok) {
              this._showVoiceError(data.error);
            }
          } catch (err) {
            this._showVoiceError('STT error: ' + err.message);
          }
          btn.textContent = '🎤'; btn.title = 'Hold to record voice'; btn.style.color = '';
        };

        rec.start();
        this._mediaRecorder = rec;
        btn.textContent = '⏹'; btn.style.color = '#ef4444'; btn.title = 'Click to stop recording';
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          this._showVoiceError('Microphone access denied. Allow mic access in browser settings.');
        } else {
          this._showVoiceError('Mic error: ' + err.message);
        }
      }
    } else {
      // ── Fallback: Web Speech API (browser STT) ────────────────────────────
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        this._showVoiceError('No voice service configured and browser STT not available.\nConfigure Speaches in voice settings.');
        return;
      }
      if (this._recognition) { this._recognition.stop(); return; }

      const rec = new SR();
      rec.lang = 'fr-FR'; rec.interimResults = true; rec.maxAlternatives = 1;
      this._recognition = rec;
      btn.textContent = '🔴'; btn.style.color = '#ef4444'; btn.title = 'Recording (browser)… click to stop';

      const ta = this._getInput();
      const originalValue = ta ? ta.value : '';
      rec.onresult = e => {
        const t = Array.from(e.results).map(r => r[0].transcript).join(' ');
        if (ta) ta.value = (originalValue ? originalValue + ' ' : '') + t;
      };
      rec.onerror = () => this._stopBrowserMic();
      rec.onend   = () => this._stopBrowserMic();
      try { rec.start(); } catch { this._stopBrowserMic(); }
    }
  },

  _stopBrowserMic() {
    if (this._recognition) { try { this._recognition.stop(); } catch {} this._recognition = null; }
    const btn = document.getElementById('pc-mic');
    if (btn) { btn.textContent = '🎤'; btn.style.color = ''; btn.title = 'Voice input'; }
  },

  _showVoiceError(msg) {
    const div = document.createElement('div');
    div.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#1e0a0a;border:1px solid #ef4444;color:#f87171;font-family:monospace;font-size:10px;padding:8px 16px;z-index:99999;max-width:420px;text-align:center;';
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 5000);
  },

  /**
   * Streaming voice — read each SENTENCE as soon as it appears in the chat,
   * instead of waiting for the whole reply. This is the "auto-speak" path
   * during live streaming; _maybeAutoSpeak stays as the fallback for the
   * "voice off during stream" and for manual replay.
   *
   * Pipeline: text chunks feed a rolling buffer, sentence boundaries pop
   * complete sentences (>= _minChars, so we don't ship "Hi." alone and
   * pay the TTS latency for one word), each sentence is fetched → queued
   * → played in order. Fetches overlap playback so the model producing
   * sentence N+1 while sentence N plays hides latency.
   */
  async _maybeStreamSpeak(chunk) {
    // Same config gate as legacy auto-speak, but honored on the FIRST chunk
    // of the turn so we can decide to stream or not.
    if (this._streamVoiceActive === undefined) this._streamVoiceActive = false;
    if (!this._streamVoiceInited) {
      this._streamVoiceInited = true;
      try {
        const now = Date.now();
        if (!this._voiceCfgCache || (now - this._voiceCfgCacheAt) > 60_000) {
          const r = await window.api._fetch('/voice/config').catch(() => null);
          this._voiceCfgCache  = r?.config || null;
          this._voiceCfgCacheAt = now;
        }
        this._streamVoiceActive = !!this._voiceCfgCache?.enabled;
      } catch { this._streamVoiceActive = false; }
      if (this._streamVoiceActive) {
        // Stop any lingering audio from a previous turn
        if (this._ttsAudio && !this._ttsAudio.paused) {
          try { this._ttsAudio.pause(); this._ttsAudio.currentTime = 0; } catch {}
        }
        this._streamBuffer = '';
        this._streamQueue  = [];   // { promise: Promise<Blob|null> }
        this._streamPlaying = false;
      }
    }
    if (!this._streamVoiceActive) return;

    this._streamBuffer += chunk;
    // Fire on CLAUSE boundaries — .!?…;:,— (long-dash) or hard newline —
    // instead of only sentences. A clause of 6-15 words gets natural
    // prosody with much lower latency than waiting for a full sentence
    // (2-3s to first speech vs 8-10s). Minimum 12 chars so "Ok," alone
    // doesn't fire the TTS pipeline for nothing.
    const CLAUSE_RE = /([^.!?…;:,—\n]+[.!?…;:,—]+["')\]]*|\S[^\n]{50,}\n)/g;
    let m; let lastEnd = 0;
    while ((m = CLAUSE_RE.exec(this._streamBuffer)) !== null) {
      const s = m[0].trim();
      lastEnd = m.index + m[0].length;
      // Skip markdown-only fragments (headers, list bullets on their own line)
      const clean = s.replace(/^[#>*\-`\s]+/, '').trim();
      if (clean.length >= 12) this._enqueueStreamSentence(clean);
    }
    if (lastEnd > 0) this._streamBuffer = this._streamBuffer.slice(lastEnd);
  },

  _flushStreamSpeak() {
    const tail = (this._streamBuffer || '').replace(/^[#>*\-`\s]+/, '').trim();
    if (tail.length >= 6) this._enqueueStreamSentence(tail);
    this._streamBuffer = '';
  },

  _enqueueStreamSentence(text) {
    if (!this._streamQueue) this._streamQueue = [];
    const voiceCfg = this._voiceCfgCache || {};
    // Fire the TTS request immediately — playback picks it up in order.
    const promise = fetch('/api/v2/voice/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: voiceCfg.tts_voice, speed: voiceCfg.tts_speed }),
    }).then(r => (r.ok ? r.blob() : null)).catch(() => null);
    this._streamQueue.push({ promise });
    this._pumpStreamQueue();
  },

  async _pumpStreamQueue() {
    if (this._streamPlaying) return;
    this._streamPlaying = true;
    try {
      while (this._streamQueue && this._streamQueue.length) {
        const item = this._streamQueue.shift();
        const blob = await item.promise.catch(() => null);
        if (!blob) continue;
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        this._ttsAudio = audio;
        await new Promise((resolve) => {
          audio.onended = () => { URL.revokeObjectURL(url); resolve(); };
          audio.onerror = () => { URL.revokeObjectURL(url); resolve(); };
          audio.play().catch(() => resolve());
        });
      }
    } finally {
      this._streamPlaying = false;
      this._streamVoiceInited = false;   // reset for next turn
    }
  },

  /**
   * Auto-speak the reply when voice is enabled. Config is cached for 60s so
   * we don't hit /voice/config on every message; toggling the setting in the
   * voice panel updates within a minute (or immediately after reload).
   */
  async _maybeAutoSpeak() {
    try {
      const now = Date.now();
      if (!this._voiceCfgCache || (now - this._voiceCfgCacheAt) > 60_000) {
        const r = await window.api._fetch('/voice/config').catch(() => null);
        this._voiceCfgCache  = r?.config || null;
        this._voiceCfgCacheAt = now;
      }
      if (!this._voiceCfgCache?.enabled) return;
      // Don't overlap with something already playing (manual or previous turn)
      if (this._ttsAudio && !this._ttsAudio.paused) return;
      await this._speakLastResponse();
    } catch { /* auto-speak is best-effort */ }
  },

  /** Speak the last Poseidon response using Speaches TTS */
  async _speakLastResponse() {
    const btn = document.getElementById('pc-tts');
    if (!btn) return;

    // Stop if already playing
    if (this._ttsAudio && !this._ttsAudio.paused) {
      this._ttsAudio.pause();
      this._ttsAudio.currentTime = 0;
      btn.textContent = '🔊'; btn.title = 'Read last response aloud';
      return;
    }

    // Get last AI message text
    const aiMsgs = this.modal?.querySelectorAll('.pc-msg-ai');
    const lastMsg = aiMsgs?.[aiMsgs.length - 1];
    const text = lastMsg?.innerText?.trim();
    if (!text) return;

    btn.textContent = '⏳'; btn.disabled = true;

    try {
      let voiceCfg = {};
      try { const r = await window.api._fetch('/voice/config'); if (r.ok) voiceCfg = r.config; } catch {}

      const resp = await fetch('/api/v2/voice/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: voiceCfg.tts_voice, speed: voiceCfg.tts_speed }),
      });

      if (!resp.ok) {
        const d = await resp.json().catch(() => ({}));
        const msg = d.error || 'TTS failed';
        // Show in status bar so user knows what to do
        this._setStatus(msg, 'error');
        throw new Error(msg);
      }

      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this._ttsAudio = audio;
      btn.textContent = '⏸'; btn.disabled = false; btn.title = 'Click to stop';
      audio.onended = () => {
        URL.revokeObjectURL(url);
        btn.textContent = '🔊'; btn.title = 'Read last response aloud';
      };
      audio.onerror = () => {
        btn.textContent = '🔊'; btn.disabled = false;
        this._showVoiceError('Audio playback failed');
      };
      await audio.play();
    } catch (err) {
      btn.textContent = '🔊'; btn.disabled = false;
      this._showVoiceError(err.message);
    }
  },

  /** Show/hide TTS button after each AI response */
  _updateTtsButton() {
    const btn = document.getElementById('pc-tts');
    if (!btn) return;
    const hasMsgs = this.modal?.querySelectorAll('.pc-msg-ai')?.length > 0;
    btn.style.display = hasMsgs ? 'flex' : 'none';
  },


  async _toggleVoiceSettings() {
    let panel = this.modal?.querySelector('#pc-voice-panel');
    if (panel) { panel.remove(); return; }

    // Load current config
    let cfg = { enabled: false, speaches_url: 'http://localhost:8000', tts_voice: 'af_heart', tts_speed: 1.0, language: 'fr', stt_model: 'Systran/faster-whisper-small' };
    try { const r = await window.api._fetch('/voice/config'); if (r.ok) cfg = r.config; } catch {}

    panel = document.createElement('div');
    panel.id = 'pc-voice-panel';
    panel.style.cssText = 'position:absolute;top:52px;right:8px;background:#0d1b2e;border:1px solid rgba(79,172,254,0.3);border-radius:10px;padding:16px 18px;z-index:1000;min-width:320px;font-family:Courier New,monospace;font-size:11px;color:#94a3b8;box-shadow:0 8px 32px rgba(0,0,0,0.6);';
    panel.innerHTML = `
<div style="font-family:'Press Start 2P',monospace;font-size:8px;color:#4facfe;margin-bottom:12px;">🎙 VOICE SETTINGS</div>
<label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
  <input type="checkbox" id="pv-enabled" ${cfg.enabled ? 'checked' : ''}> Enable local voice (Speaches)
</label>
<div style="margin-bottom:8px;">
  <div style="font-size:9px;color:#475569;margin-bottom:4px;">Speaches URL</div>
  <input id="pv-url" value="${this._esc(cfg.speaches_url)}" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:5px 8px;font-size:10px;box-sizing:border-box;">
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;">
  <div>
    <div style="font-size:9px;color:#475569;margin-bottom:4px;">TTS Voice</div>
    <select id="pv-voice" style="width:100%;background:#0d1b2e;border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:4px 6px;font-size:10px;">
      <option value="af_heart" ${cfg.tts_voice==='af_heart'?'selected':''}>af_heart (EN, warm)</option>
      <option value="af_bella" ${cfg.tts_voice==='af_bella'?'selected':''}>af_bella (EN, bright)</option>
      <option value="am_adam" ${cfg.tts_voice==='am_adam'?'selected':''}>am_adam (EN, male)</option>
      <option value="ff_siwis" ${cfg.tts_voice==='ff_siwis'?'selected':''}>ff_siwis (FR, female)</option>
      <option value="fr_remi" ${cfg.tts_voice==='fr_remi'?'selected':''}>fr_remi (FR, male)</option>
    </select>
  </div>
  <div>
    <div style="font-size:9px;color:#475569;margin-bottom:4px;">Speed (${cfg.tts_speed}x)</div>
    <input type="range" id="pv-speed" min="0.5" max="2" step="0.1" value="${cfg.tts_speed}" style="width:100%;" oninput="this.previousElementSibling.textContent='Speed ('+this.value+'x)'">
  </div>
</div>
<div style="margin-bottom:12px;">
  <div style="font-size:9px;color:#475569;margin-bottom:4px;">STT Language</div>
  <select id="pv-lang" style="width:100%;background:#0d1b2e;border:1px solid rgba(255,255,255,0.1);color:#e2e8f0;padding:4px 6px;font-size:10px;">
    <option value="fr" ${cfg.language==='fr'?'selected':''}>Français</option>
    <option value="en" ${cfg.language==='en'?'selected':''}>English</option>
    <option value="auto" ${cfg.language==='auto'?'selected':''}>Auto-detect</option>
  </select>
</div>
<div style="display:flex;gap:8px;align-items:center;">
  <button id="pv-save" style="background:#4facfe;border:none;color:#fff;padding:6px 14px;font-size:9px;cursor:pointer;border-radius:4px;">SAVE</button>
  <button id="pv-test" style="background:rgba(79,172,254,0.1);border:1px solid rgba(79,172,254,0.3);color:#4facfe;padding:6px 14px;font-size:9px;cursor:pointer;border-radius:4px;">TEST TTS</button>
  <span id="pv-status" style="font-size:9px;color:#475569;"></span>
</div>
<div style="margin-top:10px;display:flex;align-items:center;gap:8px;">
  <button id="pv-autostart" style="background:rgba(6,255,165,0.15);border:1px solid rgba(6,255,165,0.4);color:#06ffa5;padding:6px 12px;font-size:10px;font-weight:700;cursor:pointer;border-radius:5px;">⚡ AUTO-START SPEACHES</button>
  <span id="pv-autostart-status" style="font-size:8.5px;color:#475569;line-height:1.5;">Launches the Docker container for you.</span>
</div>`;

    panel.querySelector('#pv-save').onclick = async () => {
      const status = panel.querySelector('#pv-status');
      status.textContent = 'Saving...';
      try {
        await window.api._fetch('/voice/config', { method: 'PATCH', body: JSON.stringify({
          enabled:    panel.querySelector('#pv-enabled').checked,
          speaches_url: panel.querySelector('#pv-url').value.trim(),
          tts_voice:  panel.querySelector('#pv-voice').value,
          tts_speed:  parseFloat(panel.querySelector('#pv-speed').value),
          language:   panel.querySelector('#pv-lang').value,
        })});
        status.textContent = '✓ Saved';
        // Invalidate the auto-speak config cache so the toggle applies to the
        // very next reply, not after the 60s cache window.
        PoseidonChat._voiceCfgCache = null;
        setTimeout(() => { status.textContent = ''; }, 2000);
      } catch (e) { status.textContent = '✗ ' + e.message; }
    };

    panel.querySelector('#pv-autostart').onclick = async () => {
      const btn = panel.querySelector('#pv-autostart');
      const st  = panel.querySelector('#pv-autostart-status');
      btn.disabled = true;
      st.textContent = 'Starting container (first run downloads models, up to 90s)...';
      st.style.color = '#fbbf24';
      try {
        const ac = new AbortController();
        const to = setTimeout(() => ac.abort(), 20000);
        const r = await fetch('/api/v2/voice/autostart', { method: 'POST', signal: ac.signal });
        clearTimeout(to);
        const ct = r.headers.get('content-type') || '';
        if (!ct.includes('application/json')) {
          const txt = await r.text();
          throw new Error(txt.trim().startsWith('<')
            ? 'Server returned HTML, not JSON — the /autostart route is not loaded. Restart the SquidMind server (voiceRoutes changed).'
            : ('Unexpected response: ' + txt.slice(0, 120)));
        }
        const d = await r.json();
        if (d.ok) {
          const en = panel.querySelector('#pv-enabled'); if (en) en.checked = true;
          if (d.ready) {
            st.textContent = '\u2713 Speaches ready at ' + d.url;
            st.style.color = '#06ffa5';
          } else if (d.pending) {
            st.textContent = '\u23f3 ' + (d.message || 'Container starting, downloading models... try Test TTS in a minute.');
            st.style.color = '#fbbf24';
          } else {
            st.textContent = d.already_running ? '\u2713 Already running at ' + d.url : '\u2713 Speaches started at ' + d.url;
            st.style.color = '#06ffa5';
          }
        } else {
          st.textContent = '\u2717 ' + (d.error || 'Failed to start');
          st.style.color = '#f87171';
        }
      } catch (e) {
        st.textContent = '\u2717 ' + e.message;
        st.style.color = '#f87171';
      } finally {
        btn.disabled = false;
      }
    };

    panel.querySelector('#pv-test').onclick = async () => {
      const status = panel.querySelector('#pv-status');
      status.textContent = 'Testing...';
      try {
        const resp = await fetch('/api/v2/voice/tts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'Bonjour, je suis Poseidon, votre assistant local.', voice: panel.querySelector('#pv-voice').value }),
        });
        if (!resp.ok) { const d = await resp.json(); throw new Error(d.error); }
        const blob = await resp.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
        status.textContent = '🔊 Playing...';
        audio.onended = () => { status.textContent = '✓ TTS works!'; };
      } catch (e) { status.textContent = '✗ ' + e.message; }
    };

    // Close on outside click
    setTimeout(() => {
      const close = (e) => { if (!panel.contains(e.target) && e.target.id !== 'pc-voice-settings-btn') { panel.remove(); document.removeEventListener('click', close); } };
      document.addEventListener('click', close);
    }, 100);

    this.modal?.appendChild(panel);
  },


  _getInput() {
    return this.modal?.querySelector('#pc-input') || document.getElementById('pc-input');
  },

};

window.PoseidonChat = PoseidonChat;
console.log('[OK] PoseidonChat loaded');
