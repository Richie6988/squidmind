/**
 * ModelLoader UI - Manage the model library.
 * 
 * User workflow:
 *   1. See list of .gguf files detected in data/models/
 *   2. For each file: "Import" (configure params + add to library)
 *   3. Imported models: can edit params, remove, or assign to Poseidon
 *   4. Loading happens AUTOMATICALLY when Poseidon/agent needs to chat
 *      (no manual "Load" button needed)
 */

const ModelLoader = {
  modal: null,
  library: null,
  
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
      <div class="modal-content" style="width:90vw; max-width:820px; max-height:85vh; display:flex; flex-direction:column;">
        <div class="modal-header">
          <h2>Model Library</h2>
          <button class="btn-secondary" onclick="ModelLoader._refresh()" style="font-size:9px;">Refresh</button>
          <button class="btn-close" onclick="ModelLoader.close()">x</button>
        </div>
        <div class="modal-body" style="flex:1; overflow-y:auto; padding:16px;">
          <p class="hint" style="font-size:9px; color:var(--text-secondary); margin-bottom:12px;">
            Models in <code>data/models/*.gguf</code>. Import a model to register loading parameters;
            loading into memory happens automatically when Poseidon or an agent needs to chat.
          </p>
          <div id="ml-library"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
  },
  
  async _refresh() {
    const container = this.modal.querySelector('#ml-library');
    container.innerHTML = '<p style="color:var(--text-secondary); font-size:10px;">Loading...</p>';
    try {
      const lib = await window.ApiV2._fetch('/models/library');
      this.library = lib;
      this._render();
    } catch (err) {
      container.innerHTML = `<p style="color:var(--danger); font-size:10px;">Failed: ${err.message}</p>`;
    }
  },
  
  _render() {
    const container = this.modal.querySelector('#ml-library');
    if (!this.library.models.length) {
      container.innerHTML = `
        <p style="color:var(--text-secondary); font-size:10px; padding:20px; text-align:center;">
          No .gguf files found in data/models/.<br>
          Drop a .gguf file there and click Refresh.
        </p>`;
      return;
    }
    
    container.innerHTML = this.library.models.map(m => this._renderModelCard(m)).join('');
  },
  
  _renderModelCard(m) {
    const sizeStr = m.file_size_gb > 0 ? `${m.file_size_gb} GB` : '(empty file)';
    const isMissing = m.status === 'missing';
    
    let statusBadge = '';
    if (m.is_poseidon) statusBadge += '<span class="model-poseidon-pill">POSEIDON</span>';
    if (m.is_loaded) statusBadge += '<span class="model-loaded-pill">IN MEMORY</span>';
    if (isMissing) statusBadge += '<span class="model-missing-pill">FILE MISSING</span>';
    if (!m.imported && !isMissing) statusBadge += '<span class="model-notimport-pill">NOT IMPORTED</span>';
    
    let actions = '';
    if (!m.imported) {
      actions = `<button class="btn-primary" onclick="ModelLoader.showImportDialog('${this._escape(m.file_name)}')">Import to Library</button>`;
    } else {
      actions = `
        ${!m.is_poseidon ? `<button class="btn-secondary" onclick="ModelLoader.assignPoseidon('${m.model_id}')">Use as Poseidon</button>` : ''}
        <button class="btn-secondary" onclick="ModelLoader.showImportDialog('${this._escape(m.file_name)}', '${m.model_id}')">Edit Params</button>
        ${m.is_loaded ? `<button class="btn-secondary" onclick="ModelLoader.unload('${m.model_id}')">Unload from Memory</button>` : ''}
        <button class="btn-secondary danger-action" onclick="ModelLoader.remove('${m.model_id}')">Remove</button>
      `;
    }
    
    let paramsSection = '';
    if (m.config) {
      paramsSection = `
        <div class="model-params">
          <div class="model-params-row">ctx=<strong>${m.config.contextLength}</strong> | gpu_layers=<strong>${m.config.gpuLayers}</strong> | threads=<strong>${m.config.cpuThreads}</strong></div>
          <div class="model-params-row">batch=<strong>${m.config.batchSize}</strong> | TTL=<strong>${m.config.autoUnloadIdleMinutes}m</strong> | offload_kqv=${m.config.offloadKqvToGpu ? 'yes' : 'no'} | random_seed=${m.config.randomSeed ? 'yes' : 'no'}</div>
        </div>`;
    }
    
    let runtimeSection = '';
    if (m.runtime && m.runtime.loaded_at) {
      runtimeSection = `
        <div class="model-runtime">
          loaded ${this._timeAgo(m.runtime.loaded_at)} | last used ${this._timeAgo(m.runtime.last_used_at)}
          | ${m.runtime.total_requests} requests | ${m.runtime.total_tokens_generated} tokens
        </div>`;
    }
    
    return `
      <div class="model-library-card ${m.is_poseidon ? 'is-poseidon' : ''}">
        <div class="model-card-header">
          <strong>${this._escape(m.file_name)}</strong>
          <span class="model-id-pill">${m.model_id}</span>
          <span class="model-size-pill">${sizeStr}</span>
          ${statusBadge}
        </div>
        ${paramsSection}
        ${runtimeSection}
        <div class="model-card-actions">${actions}</div>
      </div>
    `;
  },
  
  /**
   * Single dialog for both Import and Edit Params.
   * If existingModelId is provided, we're editing.
   */
  showImportDialog(fileName, existingModelId = null) {
    const isEdit = !!existingModelId;
    const existing = isEdit ? this.library.models.find(m => m.model_id === existingModelId) : null;
    const cfg = existing?.config || {
      contextLength: 25000, gpuLayers: 32, cpuThreads: 4, batchSize: 512,
      offloadKqvToGpu: false, randomSeed: true, autoUnloadIdleMinutes: 15
    };
    
    const dlg = document.createElement('div');
    dlg.className = 'modal model-load-config-modal';
    dlg.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:520px;">
        <div class="modal-header">
          <h2>${isEdit ? 'Edit Params' : 'Import'}: ${this._escape(fileName)}</h2>
          <button class="btn-close" onclick="this.closest('.modal').remove()">x</button>
        </div>
        <div class="modal-body" style="padding:16px;">
          <p class="hint" style="font-size:9px; margin-bottom:12px;">
            ${isEdit
              ? 'Updates the saved loading params. Changes apply on next load.'
              : 'Register this model with loading parameters. Loading happens later, automatically.'}
          </p>
          <div class="agent-form-row"><label>Context length (max ~260k)</label>
            <input id="ml-ctx" type="number" min="512" max="260000" value="${cfg.contextLength}"></div>
          <div class="agent-form-row"><label>GPU layers (32 = full GPU)</label>
            <input id="ml-gpu" type="number" min="0" max="100" value="${cfg.gpuLayers}"></div>
          <div class="agent-form-row"><label>CPU threads</label>
            <input id="ml-threads" type="number" min="1" max="32" value="${cfg.cpuThreads}"></div>
          <div class="agent-form-row"><label>Batch size</label>
            <input id="ml-batch" type="number" min="32" max="2048" value="${cfg.batchSize}"></div>
          <div class="agent-form-row"><label>Auto-unload idle (min)</label>
            <input id="ml-ttl" type="number" min="1" max="240" value="${cfg.autoUnloadIdleMinutes}"></div>
          <div class="agent-form-row"><label>Offload cache to GPU</label>
            <label class="agent-form-checkbox" style="flex:0 0 auto;">
              <input id="ml-kqv" type="checkbox" ${cfg.offloadKqvToGpu ? 'checked' : ''}>
              <span>Enable</span></label></div>
          <div class="agent-form-row"><label>Random seed</label>
            <label class="agent-form-checkbox" style="flex:0 0 auto;">
              <input id="ml-seed" type="checkbox" ${cfg.randomSeed ? 'checked' : ''}>
              <span>Enable (else deterministic)</span></label></div>
        </div>
        <div class="agent-form-footer">
          <span id="ml-save-status" class="agent-form-status"></span>
          <button class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
          <button class="btn-primary" id="ml-save-btn">${isEdit ? 'Save Changes' : 'Import'}</button>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);
    
    dlg.querySelector('#ml-save-btn').addEventListener('click', async () => {
      const params = {
        contextLength: parseInt(dlg.querySelector('#ml-ctx').value, 10),
        gpuLayers: parseInt(dlg.querySelector('#ml-gpu').value, 10),
        cpuThreads: parseInt(dlg.querySelector('#ml-threads').value, 10),
        batchSize: parseInt(dlg.querySelector('#ml-batch').value, 10),
        autoUnloadIdleMinutes: parseInt(dlg.querySelector('#ml-ttl').value, 10),
        offloadKqvToGpu: dlg.querySelector('#ml-kqv').checked,
        randomSeed: dlg.querySelector('#ml-seed').checked
      };
      const status = dlg.querySelector('#ml-save-status');
      const btn = dlg.querySelector('#ml-save-btn');
      btn.disabled = true;
      status.textContent = isEdit ? 'Saving...' : 'Importing...';
      try {
        if (isEdit) {
          await window.ApiV2._fetch(`/models/${existingModelId}/params`, {
            method: 'PATCH',
            body: JSON.stringify(params)
          });
        } else {
          await window.ApiV2._fetch('/models/import', {
            method: 'POST',
            body: JSON.stringify({ fileName, ...params })
          });
        }
        await this._refresh();
        dlg.remove();
      } catch (err) {
        status.textContent = 'Failed: ' + err.message;
        status.className = 'agent-form-status error';
        btn.disabled = false;
      }
    });
  },
  
  async assignPoseidon(modelId) {
    try {
      await window.ApiV2._fetch(`/models/${modelId}/assign-poseidon`, { method: 'POST' });
      await this._refresh();
    } catch (err) {
      alert('Assignment failed: ' + err.message);
    }
  },
  
  async unload(modelId) {
    if (!confirm(`Unload ${modelId} from memory? (will auto-reload on next request)`)) return;
    try {
      await window.ApiV2._fetch(`/models/${modelId}/unload`, { method: 'POST' });
      await this._refresh();
    } catch (err) {
      alert('Unload failed: ' + err.message);
    }
  },
  
  async remove(modelId) {
    if (!confirm(`Remove ${modelId} from library? (file on disk is kept)`)) return;
    try {
      await window.ApiV2._fetch(`/models/${modelId}`, { method: 'DELETE' });
      await this._refresh();
    } catch (err) {
      alert('Remove failed: ' + err.message);
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

// === Status indicator for right panel ===
async function updateModelStatusIndicator() {
  const el = document.getElementById('monitor-model-status');
  if (!el) return;
  try {
    const lib = await window.ApiV2._fetch('/models/library');
    if (lib.poseidon_model_id) {
      const loadedNote = lib.currently_loaded.includes(lib.poseidon_model_id) ? ' (in memory)' : ' (auto-loads on chat)';
      el.innerHTML = `Poseidon: <strong style="color:var(--success)">${lib.poseidon_model_id}</strong>${loadedNote}`;
    } else if (lib.models.some(m => m.imported)) {
      el.innerHTML = `<span style="color:#FBBF24">No model assigned to Poseidon</span>`;
    } else {
      el.textContent = 'No models in library';
      el.style.color = 'var(--text-secondary)';
    }
  } catch (err) {
    el.textContent = 'Status unavailable';
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(updateModelStatusIndicator, 1000);
    setInterval(updateModelStatusIndicator, 8000);
  });
} else {
  setTimeout(updateModelStatusIndicator, 1000);
  setInterval(updateModelStatusIndicator, 8000);
}

window.ModelLoader = ModelLoader;
console.log('[OK] ModelLoader (library workflow) loaded');
