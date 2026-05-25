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
          <button class="btn-secondary" onclick="ModelLoader.open()" style="font-size:9px;">Manage Models</button>
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
        statusEl.innerHTML = `no model assigned - <a href="#" onclick="ModelLoader.open(); return false;">assign one</a>`;
        statusEl.className = 'poseidon-chat-status warn';
      } else {
        statusEl.innerHTML = `no models loaded - <a href="#" onclick="ModelLoader.open(); return false;">load one</a>`;
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
              // done
            } else {
              // chunk
              if (payload.text) {
                fullText += payload.text;
                textEl.textContent = fullText;
                this.modal.querySelector('#poseidon-chat-messages').scrollTop = 999999;
              }
            }
          } catch (e) {
            console.warn('SSE parse:', e, data);
          }
        }
      }
      
      this.history[assistantIdx].content = fullText || '(no response)';
    } catch (err) {
      // Friendly message for common errors
      let friendly = err.message;
      if (/Invalid GGUF magic/i.test(err.message)) {
        friendly = 'The model file is not a valid GGUF (it may be a placeholder or corrupted). Open the Models panel and use Browse Files or Download HF to get a real .gguf file.';
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
  
  close() {
    if (this.modal) this.modal.classList.add('hidden');
  },
  
  _escape(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  }
};

window.PoseidonChat = PoseidonChat;
console.log('[OK] PoseidonChat loaded');
