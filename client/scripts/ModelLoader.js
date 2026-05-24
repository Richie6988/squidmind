/**
 * ModelLoader UI - Browse available GGUF files, load with config dialog,
 * see currently loaded models, assign one to Poseidon.
 */

const ModelLoader = {
  modal: null,
  models: [],     // scanned models
  status: null,   // currently loaded
  
  async open() {
    this._buildModal();
    await this._refresh();
  },
  
  _buildModal() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      return;
    }
    this.modal = document.createElement('div');
    this.modal.className = 'modal model-loader-modal';
    this.modal.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:880px; max-height:85vh; display:flex; flex-direction:column;">
        <div class="modal-header">
          <h2>Model Loader</h2>
          <button class="btn-close" onclick="ModelLoader.close()">x</button>
        </div>
        <div class="modal-body" style="flex:1; overflow-y:auto; padding:16px;">
          <div class="model-loader-section">
            <h3>Currently Loaded</h3>
            <div id="ml-loaded">Loading...</div>
          </div>
          <div class="model-loader-section">
            <h3>Available Models (data/models/*.gguf)</h3>
            <div id="ml-available">Loading...</div>
            <p class="hint" style="font-size:9px; color:var(--text-secondary); margin-top:8px;">
              Drop .gguf files into the data/models/ folder, then click Refresh.
            </p>
            <button class="btn-secondary" onclick="ModelLoader._refresh()" style="margin-top:4px; font-size:10px;">Refresh</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
  },
  
  async _refresh() {
    try {
      const [availRes, statusRes] = await Promise.all([
        window.ApiV2._fetch('/models/available'),
        window.ApiV2._fetch('/models/status')
      ]);
      this.models = availRes.models;
      this.status = statusRes;
      this._renderLoaded();
      this._renderAvailable();
    } catch (err) {
      console.error('[ModelLoader] refresh failed:', err);
    }
  },
  
  _renderLoaded() {
    const el = this.modal.querySelector('#ml-loaded');
    if (!this.status || this.status.loaded_count === 0) {
      el.innerHTML = '<p style="font-size:10px; color:var(--text-secondary);">No models loaded.</p>';
      return;
    }
    el.innerHTML = this.status.loaded_models.map(m => `
      <div class="model-loaded-card">
        <div class="model-loaded-row1">
          <strong>${this._escape(m.file_name)}</strong>
          <span class="model-id-pill">${m.model_id}</span>
          ${m.model_id === this.status.poseidon_model_id ? '<span class="model-poseidon-pill">POSEIDON</span>' : ''}
        </div>
        <div class="model-loaded-row2">
          ctx=${m.config.contextLength} | gpu_layers=${m.config.gpuLayers} | threads=${m.config.cpuThreads} | batch=${m.config.batchSize} | TTL=${m.config.autoUnloadIdleMinutes}m
        </div>
        <div class="model-loaded-row3">
          loaded ${this._timeAgo(m.loaded_at)} | last used ${this._timeAgo(m.last_used_at)} | idle ${m.idle_minutes}m | ${m.total_requests} req | ${m.total_tokens_generated} tok
          ${m.generating ? ' | <span style="color:var(--accent)">GENERATING...</span>' : ''}
        </div>
        <div class="model-loaded-actions">
          ${m.model_id !== this.status.poseidon_model_id ? `<button class="btn-secondary" onclick="ModelLoader.assignPoseidon('${m.model_id}')">Use as Poseidon</button>` : ''}
          <button class="btn-secondary" onclick="ModelLoader.unload('${m.model_id}')" style="background:var(--danger); color:white;">Unload</button>
        </div>
      </div>
    `).join('');
  },
  
  _renderAvailable() {
    const el = this.modal.querySelector('#ml-available');
    if (!this.models.length) {
      el.innerHTML = '<p style="font-size:10px; color:var(--text-secondary);">No .gguf files in data/models/</p>';
      return;
    }
    const loadedIds = new Set((this.status?.loaded_models || []).map(m => m.model_id));
    el.innerHTML = this.models.map(m => `
      <div class="model-available-card">
        <div style="flex:1;">
          <strong>${this._escape(m.file_name)}</strong>
          <div style="font-size:9px; color:var(--text-secondary);">
            ${m.file_size_gb} GB | id: ${m.model_id}
          </div>
        </div>
        ${loadedIds.has(m.model_id)
          ? '<span style="color:var(--success); font-size:10px;">Already loaded</span>'
          : `<button class="btn-primary" onclick="ModelLoader.showLoadDialog('${this._escape(m.file_name)}')">Load...</button>`}
      </div>
    `).join('');
  },
  
  showLoadDialog(fileName) {
    const dlg = document.createElement('div');
    dlg.className = 'modal model-load-config-modal';
    dlg.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:520px;">
        <div class="modal-header">
          <h2>Load: ${this._escape(fileName)}</h2>
          <button class="btn-close" onclick="this.closest('.modal').remove()">x</button>
        </div>
        <div class="modal-body" style="padding:16px;">
          <p class="hint" style="font-size:9px; margin-bottom:12px;">Configure how the model is loaded:</p>
          
          <div class="agent-form-row"><label>Context length (max ~260k)</label>
            <input id="ml-ctx" type="number" min="512" max="260000" value="25000"></div>
          
          <div class="agent-form-row"><label>GPU layers (32 for full GPU)</label>
            <input id="ml-gpu" type="number" min="0" max="100" value="32"></div>
          
          <div class="agent-form-row"><label>CPU threads</label>
            <input id="ml-threads" type="number" min="1" max="32" value="4"></div>
          
          <div class="agent-form-row"><label>Batch size</label>
            <input id="ml-batch" type="number" min="32" max="2048" value="512"></div>
          
          <div class="agent-form-row"><label>Auto-unload idle (min)</label>
            <input id="ml-ttl" type="number" min="1" max="240" value="15"></div>
          
          <div class="agent-form-row"><label>Offload cache to GPU</label>
            <label class="agent-form-checkbox" style="flex:0 0 auto;">
              <input id="ml-kqv" type="checkbox">
              <span>Enable</span>
            </label></div>
          
          <div class="agent-form-row"><label>Random seed</label>
            <label class="agent-form-checkbox" style="flex:0 0 auto;">
              <input id="ml-seed" type="checkbox" checked>
              <span>Enable (otherwise deterministic)</span>
            </label></div>
        </div>
        <div class="agent-form-footer">
          <span id="ml-load-status" class="agent-form-status">Defaults match your specified config.</span>
          <button class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
          <button class="btn-primary" id="ml-load-btn">Load Model</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    
    dlg.querySelector('#ml-load-btn').addEventListener('click', async () => {
      const status = dlg.querySelector('#ml-load-status');
      const btn = dlg.querySelector('#ml-load-btn');
      btn.disabled = true;
      status.textContent = 'Loading model... (may take 30-90s for large models)';
      status.className = 'agent-form-status';
      try {
        await window.ApiV2._fetch('/models/load', {
          method: 'POST',
          body: JSON.stringify({
            fileName,
            contextLength: parseInt(dlg.querySelector('#ml-ctx').value, 10),
            gpuLayers: parseInt(dlg.querySelector('#ml-gpu').value, 10),
            cpuThreads: parseInt(dlg.querySelector('#ml-threads').value, 10),
            batchSize: parseInt(dlg.querySelector('#ml-batch').value, 10),
            autoUnloadIdleMinutes: parseInt(dlg.querySelector('#ml-ttl').value, 10),
            offloadKqvToGpu: dlg.querySelector('#ml-kqv').checked,
            randomSeed: dlg.querySelector('#ml-seed').checked
          })
        });
        status.textContent = 'Loaded successfully!';
        status.className = 'agent-form-status success';
        await this._refresh();
        setTimeout(() => dlg.remove(), 1200);
      } catch (err) {
        status.textContent = 'Load failed: ' + err.message;
        status.className = 'agent-form-status error';
        btn.disabled = false;
      }
    });
  },
  
  async unload(modelId) {
    if (!confirm(`Unload ${modelId}?`)) return;
    try {
      await window.ApiV2._fetch(`/models/${modelId}/unload`, { method: 'POST' });
      await this._refresh();
    } catch (err) {
      alert('Unload failed: ' + err.message);
    }
  },
  
  async assignPoseidon(modelId) {
    try {
      await window.ApiV2._fetch(`/models/${modelId}/assign-poseidon`, { method: 'POST' });
      await this._refresh();
    } catch (err) {
      alert('Assignment failed: ' + err.message);
    }
  },
  
  close() {
    if (this.modal) this.modal.classList.add('hidden');
  },
  
  _escape(s) {
    if (!s) return '';
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  },
  
  _timeAgo(iso) {
    if (!iso) return 'never';
    const seconds = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }
};

window.ModelLoader = ModelLoader;
console.log('[OK] ModelLoader loaded');

// === Status indicator for right panel ===
async function updateModelStatusIndicator() {
  const el = document.getElementById('monitor-model-status');
  if (!el) return;
  try {
    const s = await window.ApiV2._fetch('/models/status');
    if (s.loaded_count === 0) {
      el.textContent = 'No models loaded';
      el.style.color = 'var(--text-secondary)';
    } else if (s.poseidon_model_id) {
      el.innerHTML = `Poseidon: <strong style="color:var(--success)">${s.poseidon_model_id}</strong>`;
    } else {
      el.innerHTML = `${s.loaded_count} loaded, none assigned`;
      el.style.color = '#FBBF24';
    }
  } catch (err) {
    el.textContent = 'API not ready';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(updateModelStatusIndicator, 1000);
    setInterval(updateModelStatusIndicator, 10000);
  });
} else {
  setTimeout(updateModelStatusIndicator, 1000);
  setInterval(updateModelStatusIndicator, 10000);
}
