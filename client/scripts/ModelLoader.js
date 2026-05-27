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
    // If we have a cached reference but it was removed from DOM, rebuild
    if (this.modal && !document.body.contains(this.modal)) {
      this.modal = null;
    }
    if (this.modal) {
      this.modal.classList.remove('hidden');
      return;
    }
    this.modal = document.createElement('div');
    this.modal.className = 'modal model-loader-modal';
    this.modal.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:900px; max-height:88vh; display:flex; flex-direction:column;">
        <div class="modal-header">
          <h2>Model Library</h2>
          <div class="ml-tabs">
            <button class="ml-tab active" data-tab="library" onclick="ModelLoader._switchTab('library')">Library</button>
            <button class="ml-tab" data-tab="browse" onclick="ModelLoader._switchTab('browse')">Browse Files</button>
            <button class="ml-tab" data-tab="download" onclick="ModelLoader._switchTab('download')">Download HF</button>
          </div>
          <button class="btn-close" onclick="ModelLoader.close()">x</button>
        </div>
        <div class="modal-body" style="flex:1; overflow-y:auto; padding:16px;">
          
          <!-- TAB: Library -->
          <div id="ml-tab-library" class="ml-tab-content active">
            <p class="hint" style="font-size:9px; color:var(--text-secondary); margin-bottom:12px;">
              Models registered in your library. Loading happens automatically when Poseidon needs them.
            </p>
            <div id="ml-library"></div>
          </div>
          
          <!-- TAB: Browse computer -->
          <div id="ml-tab-browse" class="ml-tab-content" style="display:none;">
            <p class="hint" style="font-size:9px; color:var(--text-secondary); margin-bottom:16px;">
              Pick a .gguf file from your computer. The file stays where it is — only its path is registered.
            </p>
            <label class="ml-filepick-label" onclick="document.getElementById('ml-native-file-input').click()">
              📂 Open File Explorer
            </label>
            <input id="ml-native-file-input" type="file" accept=".gguf" style="display:none;"
              onchange="ModelLoader._onNativeFilePicked(this)">
            <div id="ml-browse-picked" style="margin-top:16px; display:none;">
              <div class="ml-picked-info">
                <span id="ml-picked-name" style="color:var(--accent); font-weight:bold;"></span>
                <span id="ml-picked-size" style="color:var(--text-secondary); font-size:9px; margin-left:8px;"></span>
              </div>
              <div style="margin-top:8px; font-size:9px; color:var(--text-secondary);">
                <strong>Path:</strong> <span id="ml-picked-path" style="word-break:break-all;"></span>
              </div>
              <div style="margin-top:4px; font-size:8px; color:var(--text-secondary);">
                Note: Browser security hides the full path. Paste the absolute path below if you need to import from a specific location.
              </div>
            </div>
            <div style="margin-top:20px;">
              <p style="font-size:9px; color:var(--text-secondary); margin-bottom:6px;">Or paste the full path directly:</p>
              <div style="display:flex; gap:6px;">
                <input id="ml-browse-path" type="text" placeholder="/home/user/models/mymodel.gguf or C:\Models\model.gguf"
                  style="flex:1;">
                <button class="btn-primary" onclick="ModelLoader._importFromPathInput()">Import</button>
              </div>
            </div>
          </div>
          
          <!-- TAB: HuggingFace download -->
          <div id="ml-tab-download" class="ml-tab-content" style="display:none;">
            <p class="hint" style="font-size:9px; color:var(--text-secondary); margin-bottom:12px;">
              Download a .gguf model from HuggingFace or any direct URL.
            </p>
            <div class="agent-form-row">
              <label>URL or repo/file</label>
              <input id="ml-dl-url" type="text" placeholder="e.g. TheBloke/Llama-2-7B-GGUF/llama-2-7b.Q4_K_M.gguf or full https URL">
            </div>
            <div class="agent-form-row">
              <label>Save as (optional)</label>
              <input id="ml-dl-name" type="text" placeholder="Leave blank to auto-detect">
            </div>
            <p class="hint" style="font-size:8px; color:var(--text-secondary);">
              Shorthand: <code>org/repo/filename.gguf</code> resolves to HuggingFace's resolve/main URL.
            </p>
            <button class="btn-primary" onclick="ModelLoader._startDownload()">Start Download</button>
            <div id="ml-downloads-list" style="margin-top:16px;"></div>
          </div>
          
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
    
    // Wire path input enter key
    const pathInput = this.modal.querySelector('#ml-browse-path');
    if (pathInput) {
      pathInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this._importFromPathInput();
      });
    }
  },
  
  _switchTab(name) {
    // Update active tab styling
    this.modal.querySelectorAll('.ml-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    this.modal.querySelectorAll('.ml-tab-content').forEach(c => c.style.display = 'none');
    this.modal.querySelector(`#ml-tab-${name}`).style.display = 'block';
    
    // Auto-load tab content
    if (name === 'browse' && !this._browseCurrentPath) this._browseHome();
    if (name === 'download') this._refreshDownloads();
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
    const sizeStr = m.file_size_gb > 0 ? `${m.file_size_gb} GB` : `${m.size_bytes || 0} bytes`;
    const isMissing = m.status === 'missing';
    const isInvalid = m.is_valid_gguf === false && !isMissing;
    
    let statusBadge = '';
    if (m.is_poseidon) statusBadge += '<span class="model-poseidon-pill">POSEIDON</span>';
    if (m.is_loaded) statusBadge += '<span class="model-loaded-pill">IN MEMORY</span>';
    if (isMissing) statusBadge += '<span class="model-missing-pill">FILE MISSING</span>';
    if (isInvalid) statusBadge += '<span class="model-missing-pill">INVALID GGUF</span>';
    if (!m.imported && !isMissing && !isInvalid) statusBadge += '<span class="model-notimport-pill">NOT IMPORTED</span>';
    // model_type badge (text vs image)
    const mtype = m.config?.model_type || m.model_type || 'text';
    statusBadge += mtype === 'image'
      ? '<span class="model-imgtype-pill">🖼 IMAGE MODEL</span>'
      : '<span class="model-texttype-pill">💬 TEXT</span>';
    
    let actions = '';
    if (isInvalid) {
      actions = `<button class="btn-secondary danger-action" onclick="ModelLoader.removeFile('${this._escape(m.file_name)}')">Delete Bad File</button>`;
    } else if (!m.imported) {
      actions = `<button class="btn-primary" onclick="ModelLoader.showImportDialog('${this._escape(m.file_name)}')">Import to Library</button>`;
    } else {
      const curType = m.config?.model_type || m.model_type || 'text';
      const toggleLabel = curType === 'image' ? '→ Text Model' : '→ Image Model';
      const nextType    = curType === 'image' ? 'text' : 'image';
      actions = `
        ${!m.is_poseidon ? `<button class="btn-secondary" onclick="ModelLoader.assignPoseidon('${m.model_id}')">Use as Poseidon</button>` : ''}
        <button class="btn-secondary" onclick="ModelLoader.showImportDialog('${this._escape(m.file_name)}', '${m.model_id}')">Edit Params</button>
        <button class="btn-secondary" title="Toggle between text and image generation mode" onclick="ModelLoader.setModelType('${m.model_id}','${nextType}')">${toggleLabel}</button>
        ${m.is_loaded ? `<button class="btn-secondary" onclick="ModelLoader.unload('${m.model_id}')">Unload from Memory</button>` : ''}
        <button class="btn-secondary danger-action" onclick="ModelLoader.remove('${m.model_id}')">Remove</button>
      `;
    }
    
    let paramsSection = '';
    if (m.config) {
      const isRunning = m.is_loaded && m.runtime_config;
      const showCfg = isRunning ? m.runtime_config : m.config;
      const savedHint = isRunning && (
        m.config.contextLength !== m.runtime_config.contextLength ||
        m.config.gpuLayers !== m.runtime_config.gpuLayers
      ) ? ` <span class="ml-hint">(saved: ctx=${m.config.contextLength}, gpu_layers=${m.config.gpuLayers})</span>` : '';
      paramsSection = `
        <div class="model-params">
          <div class="model-params-row">ctx=<strong>${showCfg.contextLength}</strong> | gpu_layers=<strong>${showCfg.gpuLayers}</strong> | threads=<strong>${showCfg.cpuThreads}</strong>${savedHint}</div>
          <div class="model-params-row">batch=<strong>${showCfg.batchSize}</strong> | TTL=<strong>${showCfg.autoUnloadIdleMinutes}m</strong> | flash=${showCfg.flashAttention ? 'yes' : 'no'} | mmap=${showCfg.useMmap ? 'yes' : 'no'} | mlock=${showCfg.useMlock ? 'yes' : 'no'}</div>
        </div>`;
    }
    
    let runtimeSection = '';
    if (m.runtime && m.runtime.loaded_at) {
      const ctxStr = m.runtime_config?.contextLength ? ` | ctx=${m.runtime_config.contextLength}` : '';
      runtimeSection = `
        <div class="model-runtime">
          loaded ${this._timeAgo(m.runtime.loaded_at)} | last used ${this._timeAgo(m.runtime.last_used_at)}
          | ${m.runtime.total_requests} requests | ${m.runtime.total_tokens_generated} tokens${ctxStr}
        </div>`;
    }
    
    let warningSection = '';
    if (isInvalid) {
      warningSection = `<div class="model-warning">File is not a valid .gguf (wrong magic bytes). It's likely a placeholder or corrupted. Delete it and use Browse Files or Download HF.</div>`;
    } else if (mtype === 'image' && m.is_poseidon) {
      warningSection = `<div class="model-warning">⚠ This model is tagged as IMAGE (encoder/diffusion component). It cannot be used as a chat model. Remove it from Poseidon and assign a text LLM instead.</div>`;
    } else if (mtype === 'text' && m.imported && m.file_size_gb && m.file_size_gb < 0.8) {
      warningSection = `<div class="model-warning">⚠ Very small model (${m.file_size_gb} GB) — likely an encoder component (T5, CLIP, VAE), not a text LLM. Consider tagging as Image Model.</div>`;
    }
    
    return `
      <div class="model-library-card ${m.is_poseidon ? 'is-poseidon' : ''} ${isInvalid ? 'is-invalid' : ''}">
        <div class="model-card-header">
          <strong>${this._escape(m.file_name)}</strong>
          <span class="model-id-pill">${m.model_id}</span>
          <span class="model-size-pill">${sizeStr}</span>
          ${statusBadge}
        </div>
        ${warningSection}
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
      contextLength: 'auto', gpuLayers: 'auto', cpuThreads: 4, batchSize: 512,
      flashAttention: true, useMmap: true, useMlock: false,
      randomSeed: true, autoUnloadIdleMinutes: 15
    };
    // Find file size for estimation
    const fileEntry = this.library.models.find(m => m.file_name === fileName);
    const fileSizeGb = fileEntry?.file_size_gb || 0;
    
    // Helper: format current value for input (auto -> "auto", number -> number)
    const ctxValue = cfg.contextLength === 'auto' ? 'auto' : String(cfg.contextLength ?? 'auto');
    const gpuValue = cfg.gpuLayers === 'auto' ? 'auto' : (cfg.gpuLayers === 'max' ? 'max' : String(cfg.gpuLayers ?? 'auto'));
    
    const dlg = document.createElement('div');
    dlg.className = 'modal model-load-config-modal';
    dlg.innerHTML = `
      <div class="modal-content" style="width:90vw; max-width:620px;">
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
          
          <!-- COMPUTE ESTIMATION (live) -->
          <div id="ml-estimate" class="ml-estimate-box"></div>
          
          <div class="agent-form-row"><label>Context length</label>
            <input id="ml-ctx" type="text" value="${this._escape(ctxValue)}" placeholder="auto, or a number like 8192">
          </div>
          <div class="agent-form-row"><label>GPU layers</label>
            <input id="ml-gpu" type="text" value="${this._escape(gpuValue)}" placeholder="auto, max, or a number">
          </div>
          <div class="agent-form-row"><label>&nbsp;</label>
            <span class="hint" style="font-size:8px; color:var(--accent);">
              Recommended: 'auto' for both fields. SquidMind probes your free VRAM
              at load time and picks: gpu_layers to fit ~70% of free VRAM, ctx to
              fill the remainder (min 4096, max 32768). Specify numbers to override.
            </span>
          </div>
          
          <div class="agent-form-row"><label>Flash Attention</label>
            <label class="agent-form-checkbox" style="flex:0 0 auto;">
              <input id="ml-flash" type="checkbox" ${cfg.flashAttention !== false ? 'checked' : ''}>
              <span>Enable (~50% smaller KV cache, fastest)</span></label></div>
          <div class="agent-form-row"><label>Use mmap</label>
            <label class="agent-form-checkbox" style="flex:0 0 auto;">
              <input id="ml-mmap" type="checkbox" ${cfg.useMmap !== false ? 'checked' : ''}>
              <span>Enable (faster load, OS shares memory)</span></label></div>
          <div class="agent-form-row"><label>Keep in memory (mlock)</label>
            <label class="agent-form-checkbox" style="flex:0 0 auto;">
              <input id="ml-mlock" type="checkbox" ${cfg.useMlock === true ? 'checked' : ''}>
              <span>Force pin in RAM/VRAM (don't swap out)</span></label></div>
          
          <div class="agent-form-row"><label>CPU threads</label>
            <input id="ml-threads" type="number" min="1" max="32" value="${cfg.cpuThreads}"></div>
          <div class="agent-form-row"><label>Batch size</label>
            <input id="ml-batch" type="number" min="32" max="2048" value="${cfg.batchSize}"></div>
          <div class="agent-form-row"><label>Auto-unload idle (min)</label>
            <input id="ml-ttl" type="number" min="1" max="240" value="${cfg.autoUnloadIdleMinutes}"></div>
          <div class="agent-form-row"><label>Random seed</label>
            <label class="agent-form-checkbox" style="flex:0 0 auto;">
              <input id="ml-seed" type="checkbox" ${cfg.randomSeed !== false ? 'checked' : ''}>
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
    
    // === LIVE ESTIMATION ===
    const estimate = () => {
      const ctxRaw = dlg.querySelector('#ml-ctx').value.trim().toLowerCase();
      const gpuRaw = dlg.querySelector('#ml-gpu').value.trim().toLowerCase();
      const flash = dlg.querySelector('#ml-flash').checked;
      
      // For estimation purposes, treat auto as 8192 (typical) and max gpu as 36
      const ctx = (ctxRaw === 'auto' || isNaN(parseInt(ctxRaw))) ? 8192 : parseInt(ctxRaw, 10);
      const gpu = (gpuRaw === 'auto' || gpuRaw === 'max') ? 36 : (isNaN(parseInt(gpuRaw)) ? 36 : parseInt(gpuRaw, 10));
      
      // Flash attention cuts KV cache ~50%
      const kvMultiplier = flash ? 0.03 : 0.06;
      const kvCacheGb = (ctx / 1024) * kvMultiplier * Math.max(1, fileSizeGb);
      
      const gpuLayersClamped = Math.min(gpu, 36);
      const layerFrac = gpuLayersClamped / 36;
      const weightsOnGpu = fileSizeGb * layerFrac;
      const weightsOnCpu = fileSizeGb * (1 - layerFrac);
      const kvOnGpu = kvCacheGb * layerFrac;  // KV follows layer placement
      const kvOnCpu = kvCacheGb - kvOnGpu;
      
      const totalVram = weightsOnGpu + kvOnGpu;
      const totalRam = weightsOnCpu + kvOnCpu;
      
      let speedHint, speedClass;
      const isAuto = ctxRaw === 'auto' && (gpuRaw === 'auto' || gpuRaw === '');
      if (isAuto) {
        speedHint = 'Auto - llama-cpp will pick the optimal split (recommended)';
        speedClass = 'ok';
      } else if (gpu === 0) {
        speedHint = 'CPU only - very slow (1-3 tok/s)';
        speedClass = 'warn';
      } else if (layerFrac < 0.5) {
        speedHint = 'Mostly CPU - slow (3-8 tok/s)';
        speedClass = 'warn';
      } else if (layerFrac >= 0.9) {
        speedHint = 'Mostly GPU - fast (30-80 tok/s)';
        speedClass = 'ok';
      } else {
        speedHint = 'Split GPU/CPU - moderate (10-25 tok/s)';
        speedClass = 'ok';
      }
      
      const fmt = n => n < 0.1 ? '<0.1' : n.toFixed(2);
      
      dlg.querySelector('#ml-estimate').innerHTML = `
        <div class="ml-estimate-header">Estimated Memory Usage</div>
        <div class="ml-estimate-row">
          <span class="ml-estimate-label">VRAM (GPU):</span>
          <span class="ml-estimate-val">${fmt(totalVram)} GB</span>
          <span class="ml-estimate-detail">${flash ? 'with flash attention' : '(enable flash attention to save ~50% KV)'}</span>
        </div>
        <div class="ml-estimate-row">
          <span class="ml-estimate-label">RAM (CPU):</span>
          <span class="ml-estimate-val">${fmt(totalRam)} GB</span>
        </div>
        <div class="ml-estimate-row">
          <span class="ml-estimate-label">Speed:</span>
          <span class="ml-estimate-val ${speedClass}">${speedHint}</span>
        </div>
        <div class="ml-estimate-hint">
          File size: ${fileSizeGb} GB. With 'auto' both fields, SquidMind reads your
          free VRAM at load time and picks gpu_layers (~70% VRAM for weights) +
          contextLength (remaining for KV cache, min 4096). Resolved values are
          shown after load and used as starting point for retries on OOM.
        </div>
      `;
    };
    
    // Recompute on any change
    ['#ml-ctx', '#ml-gpu', '#ml-flash'].forEach(sel => {
      dlg.querySelector(sel).addEventListener('input', estimate);
      dlg.querySelector(sel).addEventListener('change', estimate);
    });
    estimate();
    
    dlg.querySelector('#ml-save-btn').addEventListener('click', async () => {
      // Parse values - allow 'auto' / 'max' as special strings
      const ctxRaw = dlg.querySelector('#ml-ctx').value.trim().toLowerCase();
      const gpuRaw = dlg.querySelector('#ml-gpu').value.trim().toLowerCase();
      const params = {
        contextLength: ctxRaw === 'auto' ? 'auto' : (parseInt(ctxRaw, 10) || 'auto'),
        gpuLayers: gpuRaw === 'auto' ? 'auto' : (gpuRaw === 'max' ? 'max' : (isNaN(parseInt(gpuRaw)) ? 'auto' : parseInt(gpuRaw, 10))),
        cpuThreads: parseInt(dlg.querySelector('#ml-threads').value, 10),
        batchSize: parseInt(dlg.querySelector('#ml-batch').value, 10),
        autoUnloadIdleMinutes: parseInt(dlg.querySelector('#ml-ttl').value, 10),
        flashAttention: dlg.querySelector('#ml-flash').checked,
        useMmap: dlg.querySelector('#ml-mmap').checked,
        useMlock: dlg.querySelector('#ml-mlock').checked,
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
  
  async setModelType(modelId, model_type) {
    try {
      await window.ApiV2._fetch(`/models/${modelId}/type`, {
        method: 'PATCH',
        body: JSON.stringify({ model_type })
      });
      await this._refresh();
    } catch (err) {
      await SquidModal.alert('Failed to update model type: ' + err.message);
    }
  },

  async assignPoseidon(modelId) {
    try {
      await window.ApiV2._fetch(`/models/${modelId}/assign-poseidon`, { method: 'POST' });
      await this._refresh();
    } catch (err) {
      await SquidModal.alert('Assignment failed: ' + err.message);
    }
  },
  
  async unload(modelId) {
    if (!await SquidModal.confirm(`Unload ${modelId} from memory? (will auto-reload on next request)`)) return;
    try {
      await window.ApiV2._fetch(`/models/${modelId}/unload`, { method: 'POST' });
      await this._refresh();
    } catch (err) {
      await SquidModal.alert('Unload failed: ' + err.message);
    }
  },
  
  async remove(modelId) {
    if (!await SquidModal.confirm(`Remove ${modelId} from library? (file on disk is kept)`)) return;
    try {
      await window.ApiV2._fetch(`/models/${modelId}`, { method: 'DELETE' });
      await this._refresh();
    } catch (err) {
      await SquidModal.alert('Remove failed: ' + err.message);
    }
  },
  
  async removeFile(fileName) {
    if (!await SquidModal.confirm(`DELETE the file ${fileName} from disk? This cannot be undone.`)) return;
    try {
      await window.ApiV2._fetch('/models/delete-file', {
        method: 'POST',
        body: JSON.stringify({ fileName })
      });
      await this._refresh();
    } catch (err) {
      await SquidModal.alert('Delete failed: ' + err.message);
    }
  },
  
  // === FILESYSTEM BROWSER ===
  
  _browseCurrentPath: null,
  _browseData: null,
  
  async _onNativeFilePicked(input) {
    const file = input.files?.[0];
    if (!file) return;
    const picked   = document.getElementById('ml-browse-picked');
    const pathInput = document.getElementById('ml-browse-path');
    document.getElementById('ml-picked-name').textContent = file.name;
    document.getElementById('ml-picked-size').textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB';
    picked.style.display = 'block';

    // Fetch the server's models directory and construct the likely full path.
    // The user almost certainly browsed to the models dir to pick the file.
    try {
      const data = await window.ApiV2._fetch('/models/dir');
      const sep  = data.dir.includes('\\') ? '\\' : '/';
      const fullPath = data.dir + sep + file.name;
      pathInput.value = fullPath;
      document.getElementById('ml-picked-path').textContent = fullPath;
    } catch {
      // Fallback: can't get server dir — user must paste manually
      pathInput.placeholder = '/absolute/path/to/' + file.name;
      document.getElementById('ml-picked-path').textContent =
        'Could not auto-detect path. Paste the absolute path in the field below.';
    }
    pathInput.focus();
    pathInput.select();
  },

  async _importFromPathInput() {
    const p = document.getElementById('ml-browse-path')?.value?.trim();
    if (!p) { await SquidModal.alert('Enter a file path first'); return; }
    await this._importFromPath(p);
  },

  async _browseHome() { await this._browseGo(null); },
  
  async _browseUp() {
    if (this._browseData?.parent_path) {
      await this._browseGo(this._browseData.parent_path);
    }
  },
  
  async _browseEnter() {
    const p = this.modal.querySelector('#ml-browse-path').value.trim();
    if (p) await this._browseGo(p);
  },
  
  async _browseGo(targetPath) {
    const list = this.modal.querySelector('#ml-browse-list');
    list.innerHTML = '<p class="hint" style="font-size:9px; padding:8px;">Loading...</p>';
    
    try {
      const url = targetPath
        ? `/models/browse?path=${encodeURIComponent(targetPath)}`
        : '/models/browse';
      const data = await window.ApiV2._fetch(url);
      this._browseCurrentPath = data.current_path;
      this._browseData = data;
      
      this.modal.querySelector('#ml-browse-path').value = data.current_path;
      this.modal.querySelector('#ml-browse-up').disabled = !data.parent_path;
      
      let html = `<p style="font-size:8px; color:var(--text-secondary); margin-bottom:6px;">
        ${data.current_path} <span style="color:var(--accent);">(${data.dir_count} dirs, ${data.gguf_count} .gguf)</span>
      </p>`;
      
      if (data.entries.length === 0) {
        html += '<p class="hint" style="font-size:9px; padding:8px;">No subdirectories or .gguf files here. Use the path bar to navigate.</p>';
      } else {
        html += data.entries.map(e => {
          if (e.type === 'directory') {
            return `<div class="ml-browse-entry ml-dir" onclick="ModelLoader._browseGo('${this._escapePath(e.path)}')">
              <span class="ml-entry-icon">DIR</span>
              <span class="ml-entry-name">${this._escape(e.name)}</span>
            </div>`;
          } else {
            return `<div class="ml-browse-entry ml-file">
              <span class="ml-entry-icon">GGUF</span>
              <span class="ml-entry-name">${this._escape(e.name)}</span>
              <span class="ml-entry-size">${e.size_gb} GB</span>
              <button class="btn-primary" style="font-size:8px; padding:3px 8px;"
                      onclick="ModelLoader._importFromPath('${this._escapePath(e.path)}')">Add to Library</button>
            </div>`;
          }
        }).join('');
      }
      
      list.innerHTML = html;
    } catch (err) {
      list.innerHTML = `<p style="color:var(--danger); font-size:10px; padding:8px;">Failed: ${this._escape(err.message)}</p>`;
    }
  },
  
  async _importFromPath(sourcePath) {
    try {
      await window.ApiV2._fetch('/models/import-from-path', {
        method: 'POST',
        body: JSON.stringify({
          sourcePath,
          contextLength: 25000, gpuLayers: 32, cpuThreads: 4, batchSize: 512,
          offloadKqvToGpu: false, randomSeed: true, autoUnloadIdleMinutes: 15
        })
      });
      await SquidModal.alert(`Added "${sourcePath.split('/').pop()}" to library. Switch to Library tab.`);
      await this._refresh();
      this._switchTab('library');
    } catch (err) {
      await SquidModal.alert('Import failed: ' + err.message);
    }
  },
  
  // === HUGGINGFACE DOWNLOAD ===
  
  _downloadPollInterval: null,
  
  async _startDownload() {
    const url = this.modal.querySelector('#ml-dl-url').value.trim();
    const fileName = this.modal.querySelector('#ml-dl-name').value.trim() || null;
    if (!url) { await SquidModal.alert('URL required'); return; }
    
    try {
      const res = await window.ApiV2._fetch('/models/download', {
        method: 'POST',
        body: JSON.stringify({ url, fileName })
      });
      this.modal.querySelector('#ml-dl-url').value = '';
      this.modal.querySelector('#ml-dl-name').value = '';
      
      // Start polling
      this._refreshDownloads();
      if (!this._downloadPollInterval) {
        this._downloadPollInterval = setInterval(() => this._refreshDownloads(), 1500);
      }
    } catch (err) {
      await SquidModal.alert('Download failed: ' + err.message);
    }
  },
  
  async _refreshDownloads() {
    const list = this.modal.querySelector('#ml-downloads-list');
    if (!list) return;
    try {
      const res = await window.ApiV2._fetch('/models/downloads');
      if (res.downloads.length === 0) {
        list.innerHTML = '';
        if (this._downloadPollInterval) {
          clearInterval(this._downloadPollInterval);
          this._downloadPollInterval = null;
        }
        return;
      }
      
      list.innerHTML = '<h3 style="font-size:10px; color:var(--accent); margin-top:12px;">Downloads</h3>' +
        res.downloads.map(d => this._renderDownload(d)).join('');
      
      // If all complete or failed, stop polling and refresh library
      const inProgress = res.downloads.some(d => d.status === 'downloading' || d.status === 'starting');
      if (!inProgress) {
        if (this._downloadPollInterval) {
          clearInterval(this._downloadPollInterval);
          this._downloadPollInterval = null;
        }
        // Auto-refresh library so newly downloaded files appear
        await this._refresh();
      }
    } catch (err) {
      // silent
    }
  },
  
  _renderDownload(d) {
    let badge = '', actions = '';
    if (d.status === 'downloading') badge = '<span style="color:#3B82F6;">downloading</span>';
    else if (d.status === 'completed') badge = '<span style="color:var(--success);">complete</span>';
    else if (d.status === 'failed') badge = `<span style="color:var(--danger);">failed: ${this._escape(d.error || '')}</span>`;
    else if (d.status === 'cancelled') badge = '<span style="color:var(--text-secondary);">cancelled</span>';
    else badge = `<span>${d.status}</span>`;
    
    if (d.status === 'downloading' || d.status === 'starting') {
      actions = `<button class="btn-secondary" style="font-size:8px; padding:3px 8px;" onclick="ModelLoader._cancelDownload('${d.downloadId}')">Cancel</button>`;
    }
    
    const sizeStr = d.totalBytes
      ? `${(d.bytesDownloaded / (1024**3)).toFixed(2)} / ${(d.totalBytes / (1024**3)).toFixed(2)} GB`
      : `${(d.bytesDownloaded / (1024**2)).toFixed(1)} MB`;
    
    return `
      <div class="ml-download-row">
        <div class="ml-download-row1">
          <strong>${this._escape(d.fileName)}</strong> ${badge} ${actions}
        </div>
        <div class="ml-download-row2">
          <div class="ml-download-bar"><div class="ml-download-bar-fill" style="width:${d.percentage}%"></div></div>
          <span style="font-size:8px;">${d.percentage.toFixed(1)}% &middot; ${sizeStr}</span>
        </div>
      </div>
    `;
  },
  
  async _cancelDownload(downloadId) {
    try {
      await window.ApiV2._fetch(`/models/downloads/${downloadId}/cancel`, { method: 'POST' });
      await this._refreshDownloads();
    } catch {}
  },
  
  _escapePath(p) {
    return p.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  },
  
  close() {
    if (this.modal) this.modal.classList.add('hidden');
    if (this._downloadPollInterval) {
      clearInterval(this._downloadPollInterval);
      this._downloadPollInterval = null;
    }
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
