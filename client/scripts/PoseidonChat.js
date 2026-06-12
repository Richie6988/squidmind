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
    // Auto-continue: if last session had an incomplete task, resume it immediately
    // without requiring any user input.
    this._tryAutoContinue();
  },

  async _tryAutoContinue() {
    try {
      const ss = await window.ApiV2._fetch('/poseidon/session-state');
      if (!ss?.last_user_message || ss.emergency) return;
      // Only resume if the last message wasn't already a resume injection
      if (ss.last_user_message.startsWith('[RESUME')) return;
      // Only resume if session is fresh (we just opened the modal = new session likely)
      const status = await window.ApiV2._fetch('/models/status');
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
            <div class="pc-welcome-sub">AI Orchestrator — SquidMind v2</div>
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
            <textarea id="pc-input" class="pc-input" placeholder="Message Poseidon... (paste images/files)" rows="1"></textarea>
            <div class="pc-input-actions">
              <button class="pc-send" id="pc-send" title="Send">
                <svg id="pc-send-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
              </button>
              <button class="pc-stop-btn" id="pc-stop" title="Stop generation" style="display:none">■ Stop</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);

    const ta   = this.modal.querySelector('#pc-input');
    const send = this.modal.querySelector('#pc-send');
    this._attachments = [];  // [{name, type, content, preview}]

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
      const s = await window.ApiV2._fetch('/models/status');
      if (!tag) return;
      if (s.poseidon_model_id) {
        tag.textContent = s.poseidon_model_id;
        tag.className = 'pc-model-tag pc-model-ready';
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
        <div class="pc-welcome-sub">AI Orchestrator — SquidMind v2</div>
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
    sendIcon.textContent = '⏳';
    const stopBtn = this.modal.querySelector('#pc-stop');
    if (stopBtn) stopBtn.style.display = 'inline-flex';

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
    const statusSeq = [
      [800,  'Sending to model…'],
      [3000, 'Loading model into VRAM…'],
      [12000,'Still loading — large model, please wait…'],
      [40000,'Taking longer than usual. Model may be loading from disk…'],
    ];
    const timers = statusSeq.map(([delay, msg]) =>
      setTimeout(() => {
        if (firstToken) return;
        const el = contentEl.querySelector('#pc-loader-msg');
        if (el) el.textContent = msg;
        this._setStatus(msg, 'loading');
      }, delay)
    );
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
                clearTimers();
                contentEl.querySelector('.pc-loader')?.remove();
                this._setStatus('Generating…', 'generating');
              }
              fullText += (evType === 'message' || evType === 'text') ? (p.text || '') : '';
            });
          } catch {}
        }
        this._scrollToBottom(msgs);
      }

      clearTimers();
      this._setStatus('Ready', 'idle');
      this.history[aiIdx].content = fullText || '(no response)';
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
      sendBtn.disabled = false;
      sendIcon.textContent = '▶';
      if (stopBtn) stopBtn.style.display = 'none';
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
    if (type === 'start')          { this._mutatedThisTurn = false; return; }
    if (type === 'end') {
      if (p.turn !== undefined) this._updateTurnCounter();
      // Inject copy button into the last AI bubble
      const lastAiMsg = this.modal?.querySelectorAll('.pc-msg-ai');
      const lastMsg = lastAiMsg?.[lastAiMsg.length - 1];
      if (lastMsg && !lastMsg.querySelector('.pc-copy-btn')) {
        const fullText = this.history.filter(h => h.role === 'assistant').slice(-1)[0]?.content || '';
        const actions = document.createElement('div');
        actions.className = 'pc-msg-actions';
        actions.innerHTML = '<button class="pc-copy-btn" title="Copy">⎘</button>';
        // Store content directly in data-copy (base64), no index needed
        const liveCid = ++PoseidonChat._copyCounter;
        PoseidonChat._copyStore.set(liveCid, fullText);
        actions.querySelector('.pc-copy-btn').dataset.cid = String(liveCid);
        actions.querySelector('.pc-copy-btn').setAttribute('onclick', 'PoseidonChat._copyText(this)');
        const ts = lastMsg.querySelector('.pc-ts');
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
    const preview = Object.entries(args || {}).slice(0, 2)
      .map(([k, v]) => `${k}: ${JSON.stringify(v).slice(0, 30)}`).join(', ');
    d.innerHTML = `
      <span class="pc-tool-icon">⚡</span>
      <span class="pc-tool-name">${this._esc(name)}</span>
      <span class="pc-tool-args">${this._esc(preview ? `(${preview})` : '')}</span>
      <span class="pc-tool-spin">◌</span>`;
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
    if (spin) spin.outerHTML = `<span class="pc-tool-res">${ok ? '✓' : '✗'} ${this._esc(summary || '')}${ms ? ` <em>${ms}ms</em>` : ''}</span>`;
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

  close() { this.modal?.classList.add('hidden'); },

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
  }
};

window.PoseidonChat = PoseidonChat;
console.log('[OK] PoseidonChat loaded');
