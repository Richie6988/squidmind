/**
 * PoseidonChat - Chat panel with streaming responses from loaded model.
 * Uses Server-Sent Events from /api/v2/poseidon/chat.
 */

const PoseidonChat = {
  modal: null,
  history: [],
  currentRequest: null,
  
  async open() {
    this._buildModal();
    await this._refreshStatus();
  },
  
  _buildModal() {
    if (this.modal && !document.body.contains(this.modal)) {
      this.modal = null;
    }
    if (this.modal) {
      this.modal.classList.remove('hidden');
      return;
    }
    this.modal = document.createElement('div');
    this.modal.className = 'modal poseidon-chat-modal';
    this.modal.innerHTML = `
      <div class="modal-content poseidon-chat-content">
        <div class="modal-header poseidon-chat-header">
          <h2>Poseidon</h2>
          <span id="poseidon-chat-status" class="poseidon-chat-status">checking...</span>
          <span id="poseidon-turn-counter" class="poseidon-turn-counter" title="Context auto-wipes when turn count reaches limit">turn 0/-</span>
          <button class="btn-secondary" onclick="PoseidonChat.resetConversation()" style="font-size:9px;" title="Wipe context now">Wipe</button>
          <button class="btn-secondary" onclick="PoseidonChat.close(); ModelLoader.open();" style="font-size:9px;">Manage Models</button>
          <button class="btn-close" onclick="PoseidonChat.close()">x</button>
        </div>
        <div class="poseidon-chat-messages" id="poseidon-chat-messages"></div>
        <div class="poseidon-chat-input-row">
          <textarea id="poseidon-chat-input" placeholder="Talk to Poseidon..." rows="2"></textarea>
          <button class="btn-primary" id="poseidon-chat-send">Send</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
    
    const ta = this.modal.querySelector('#poseidon-chat-input');
    const sendBtn = this.modal.querySelector('#poseidon-chat-send');
    
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendMessage();
      }
    });
    sendBtn.addEventListener('click', () => this._sendMessage());
    
    // Render initial messages
    this._renderHistory();
  },
  
  async _refreshStatus() {
    const statusEl = this.modal.querySelector('#poseidon-chat-status');
    try {
      const status = await window.ApiV2._fetch('/models/status');
      if (status.poseidon_model_id) {
        statusEl.textContent = `using ${status.poseidon_model_id}`;
        statusEl.className = 'poseidon-chat-status ready';
      } else if (status.loaded_count > 0) {
        statusEl.innerHTML = `no model assigned - <a href="#" onclick="PoseidonChat.close(); ModelLoader.open(); return false;">assign one</a>`;
        statusEl.className = 'poseidon-chat-status warn';
      } else {
        statusEl.innerHTML = `no models loaded - <a href="#" onclick="PoseidonChat.close(); ModelLoader.open(); return false;">load one</a>`;
        statusEl.className = 'poseidon-chat-status warn';
      }
    } catch (err) {
      statusEl.textContent = 'status check failed';
      statusEl.className = 'poseidon-chat-status error';
    }
  },
  
  _renderHistory() {
    const msgs = this.modal.querySelector('#poseidon-chat-messages');
    if (this.history.length === 0) {
      msgs.innerHTML = '<p class="poseidon-chat-empty">Start a conversation. Poseidon is initialized from poseidon_brain.json.</p>';
      return;
    }
    msgs.innerHTML = this.history.map((turn, i) => `
      <div class="poseidon-chat-turn poseidon-chat-${turn.role}">
        <div class="poseidon-chat-role">${turn.role === 'user' ? 'You' : 'Poseidon'}</div>
        <div class="poseidon-chat-text" id="poseidon-chat-text-${i}">${this._escape(turn.content)}</div>
      </div>
    `).join('');
    msgs.scrollTop = msgs.scrollHeight;
  },
  
  async _sendMessage() {
    const ta = this.modal.querySelector('#poseidon-chat-input');
    const message = ta.value.trim();
    if (!message) return;
    if (this.currentRequest) return; // already streaming
    
    ta.value = '';
    
    // Add user message
    this.history.push({ role: 'user', content: message });
    
    // Add empty assistant placeholder
    const assistantIdx = this.history.length;
    this.history.push({ role: 'assistant', content: '' });
    this._renderHistory();
    
    const textEl = this.modal.querySelector(`#poseidon-chat-text-${assistantIdx}`);
    const sendBtn = this.modal.querySelector('#poseidon-chat-send');
    sendBtn.disabled = true;
    sendBtn.textContent = '...';
    
    // === LOADING INDICATOR ===
    // Show a status line above the placeholder text while waiting for first token
    let firstTokenReceived = false;
    const setStatus = (msg, kind = 'loading') => {
      if (!textEl) return;
      if (kind === 'loading') {
        textEl.innerHTML = `<div class="chat-loading">
          <span class="chat-loading-dots"><span></span><span></span><span></span></span>
          <span class="chat-loading-msg">${this._escape(msg)}</span>
        </div>`;
      } else {
        textEl.textContent = msg;
      }
    };
    
    setStatus('Sending request...');
    
    // Show progressive status updates so user knows the model is loading
    const statusTimers = [
      setTimeout(() => { if (!firstTokenReceived) setStatus('Checking model status...'); }, 800),
      setTimeout(() => { if (!firstTokenReceived) setStatus('Loading model into memory (first load can take 30-90s)...'); }, 3000),
      setTimeout(() => { if (!firstTokenReceived) setStatus('Still loading model. Larger models take longer...'); }, 30000),
      setTimeout(() => { if (!firstTokenReceived) setStatus('Generating response...'); }, 60000)
    ];
    const clearStatusTimers = () => statusTimers.forEach(t => clearTimeout(t));
    
    try {
      const response = await fetch('/api/v2/poseidon/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: this.history.slice(0, -2)  // history excluding the current pair
        })
      });
      
      if (!response.ok) {
        clearStatusTimers();
        const err = await response.json().catch(() => ({ error: 'request failed' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      
      this.currentRequest = reader;
      
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        
        // Parse SSE format: lines like "event: X\n" or "data: ...\n", split by \n\n
        const events = buffer.split('\n\n');
        buffer = events.pop(); // keep incomplete event in buffer
        
        for (const evt of events) {
          if (!evt.trim()) continue;
          const lines = evt.split('\n');
          let eventType = 'message';
          let data = '';
          for (const line of lines) {
            if (line.startsWith('event:')) eventType = line.substring(6).trim();
            else if (line.startsWith('data:')) data = line.substring(5).trim();
          }
          if (!data) continue;
          
          try {
            const payload = JSON.parse(data);
            if (eventType === 'error') {
              throw new Error(payload.error || 'streaming error');
            } else if (eventType === 'end') {
              if (payload.turn !== undefined && payload.wipe_threshold) {
                this._updateTurnCounter(payload.turn, payload.wipe_threshold);
              }
              // If Poseidon mutated state (created/deleted agents, projects, tasks),
              // tell the UI to refresh. We don't have to know which - just kick everything.
              if (this._mutatedThisTurn) {
                if (window.aquarium?.loadSquids) window.aquarium.loadSquids();
                if (window.ProjectsPanel?.refresh) window.ProjectsPanel.refresh();
                this._mutatedThisTurn = false;
              }
            } else if (eventType === 'start') {
              setStatus('Generating response...');
              this._mutatedThisTurn = false;  // reset for new turn
            } else if (eventType === 'tool_call') {
              if (!firstTokenReceived) {
                firstTokenReceived = true;
                clearStatusTimers();
                textEl.innerHTML = '';
              }
              this._appendToolCall(textEl, payload.name, payload.args);
              // Mark mutating calls so we know to refresh the UI on `end`
              const MUTATING = ['create_agent', 'delete_agent', 'update_agent_field',
                                'create_project', 'archive_project',
                                'create_task', 'write_file', 'edit_file',
                                'github_commit', 'github_pull'];
              if (MUTATING.includes(payload.name)) this._mutatedThisTurn = true;
              this.modal.querySelector('#poseidon-chat-messages').scrollTop = 999999;
            } else if (eventType === 'tool_result') {
              this._appendToolResult(textEl, payload.name, payload.ok, payload.summary, payload.duration_ms);
              this.modal.querySelector('#poseidon-chat-messages').scrollTop = 999999;
            } else {
              // text chunk - clear loading indicator on first token
              if (payload.text) {
                if (!firstTokenReceived) {
                  firstTokenReceived = true;
                  clearStatusTimers();
                  // Don't wipe existing tool-call bubbles - just append text after them
                }
                fullText += payload.text;
                let textNode = textEl.querySelector('.chat-text-final');
                if (!textNode) {
                  textNode = document.createElement('div');
                  textNode.className = 'chat-text-final';
                  textEl.appendChild(textNode);
                }
                textNode.textContent = fullText;
                this.modal.querySelector('#poseidon-chat-messages').scrollTop = 999999;
              }
            }
          } catch (e) {
            console.warn('SSE parse:', e, data);
          }
        }
      }
      
      clearStatusTimers();
      this.history[assistantIdx].content = fullText || '(no response)';
    } catch (err) {
      clearStatusTimers();
      // Friendly message for common errors
      let friendly = err.message;
      if (/Invalid GGUF magic/i.test(err.message)) {
        friendly = 'The model file is not a valid GGUF (it may be a placeholder or corrupted). Open the Models panel and use Browse Files or Download HF to get a real .gguf file.';
      } else if (/context size.*too large|out of memory|VRAM/i.test(err.message)) {
        friendly = err.message + '\n\nTip: Open Models panel > Edit Params and set Context Length to 4096 or 2048.';
      } else if (/No sequences left|sequence/i.test(err.message)) {
        friendly = 'Chat session exhausted. Click "Reset" or close and reopen this chat. (Model stays loaded.)';
      } else if (/No model assigned/i.test(err.message)) {
        friendly = 'No model is assigned to Poseidon. Open the Models panel and click "Use as Poseidon" on an imported model.';
      } else if (/Model file is missing/i.test(err.message)) {
        friendly = 'The model file no longer exists on disk. Re-import from the Models panel.';
      }
      this.history[assistantIdx].content = friendly;
      textEl.textContent = friendly;
      textEl.style.color = 'var(--danger)';
    } finally {
      this.currentRequest = null;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  },
  
  async resetConversation() {
    if (!confirm('Clear conversation history? (Keeps model loaded)')) return;
    try {
      await fetch('/api/v2/poseidon/reset-session', { method: 'POST' });
      this.history = [];
      const messagesEl = this.modal.querySelector('#poseidon-chat-messages');
      if (messagesEl) messagesEl.innerHTML = '<div class="poseidon-msg system">Conversation reset.</div>';
    } catch (err) {
      alert('Reset failed: ' + err.message);
    }
  },
  
  close() {
    if (this.modal) this.modal.classList.add('hidden');
  },
  
  /**
   * Append a "tool call" bubble showing what function was invoked.
   * Looks like: ▸ create_agent({display_name: "Bob", ...})
   */
  _appendToolCall(textEl, name, args) {
    const div = document.createElement('div');
    div.className = 'chat-tool-bubble chat-tool-pending';
    const argsStr = this._formatArgs(args);
    div.innerHTML = `
      <span class="chat-tool-icon">▸</span>
      <span class="chat-tool-name">${this._escape(name)}</span>
      <span class="chat-tool-args">${this._escape(argsStr)}</span>
      <span class="chat-tool-spinner">…</span>
    `;
    div.dataset.toolName = name;
    div.dataset.callTime = Date.now();
    textEl.appendChild(div);
  },
  
  /**
   * Update the most recent matching tool bubble with the result.
   */
  _appendToolResult(textEl, name, ok, summary, duration_ms) {
    // Find last pending bubble with this name
    const bubbles = textEl.querySelectorAll(`.chat-tool-bubble.chat-tool-pending[data-tool-name="${this._escape(name)}"]`);
    const bubble = bubbles[bubbles.length - 1];
    if (bubble) {
      bubble.classList.remove('chat-tool-pending');
      bubble.classList.add(ok ? 'chat-tool-ok' : 'chat-tool-fail');
      const spinner = bubble.querySelector('.chat-tool-spinner');
      if (spinner) {
        spinner.innerHTML = `<span class="chat-tool-status">${ok ? '✓' : '✗'}</span><span class="chat-tool-result">${this._escape(summary || (ok ? 'done' : 'failed'))}</span>${duration_ms ? `<span class="chat-tool-duration">${duration_ms}ms</span>` : ''}`;
      }
    } else {
      // No matching pending bubble - just append a finished one
      const div = document.createElement('div');
      div.className = `chat-tool-bubble ${ok ? 'chat-tool-ok' : 'chat-tool-fail'}`;
      div.innerHTML = `
        <span class="chat-tool-icon">${ok ? '✓' : '✗'}</span>
        <span class="chat-tool-name">${this._escape(name)}</span>
        <span class="chat-tool-result">${this._escape(summary || '')}</span>
      `;
      textEl.appendChild(div);
    }
  },
  
  _formatArgs(args) {
    if (!args || typeof args !== 'object') return '';
    const keys = Object.keys(args);
    if (keys.length === 0) return '()';
    return '(' + keys.map(k => {
      let v = args[k];
      if (typeof v === 'string') v = `"${v.slice(0, 40)}${v.length > 40 ? '…' : ''}"`;
      else if (typeof v === 'object') v = JSON.stringify(v).slice(0, 40);
      return `${k}: ${v}`;
    }).join(', ') + ')';
  },

  _updateTurnCounter(turn, threshold) {
    const el = this.modal?.querySelector('#poseidon-turn-counter');
    if (!el) return;
    el.textContent = `turn ${turn}/${threshold}`;
    // Color shift as we approach wipe
    if (turn === 0) {
      el.className = 'poseidon-turn-counter wipe';
      el.title = 'Context just wiped - brain.json freshly reloaded';
      setTimeout(() => { el.className = 'poseidon-turn-counter'; }, 2000);
    } else if (turn >= threshold - 1) {
      el.className = 'poseidon-turn-counter near-limit';
      el.title = 'Context will wipe next exchange';
    } else {
      el.className = 'poseidon-turn-counter';
      el.title = `Context auto-wipes at turn ${threshold} (model stays loaded)`;
    }
  },
  
  _escape(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  }
};

window.PoseidonChat = PoseidonChat;
console.log('[OK] PoseidonChat loaded');
