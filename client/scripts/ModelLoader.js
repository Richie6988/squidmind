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
    // Click on the backdrop (modal itself, not modal-content) closes it
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
            <!-- Address bar -->
            <div class="ml-addr-bar">
              <button class="ml-addr-btn" id="ml-browse-home" title="Home" onclick="ModelLoader._browseGo(null)">⌂</button>
              <button class="ml-addr-btn" id="ml-browse-up" title="Up" onclick="ModelLoader._browseUp()" disabled>↑</button>
              <input id="ml-browse-path" type="text" class="ml-addr-input" placeholder="/home/user/models"
                onkeydown="if(event.key==='Enter') ModelLoader._browseGo(this.value)">
              <button class="ml-addr-btn ml-addr-go" onclick="ModelLoader._browseGo(document.getElementById('ml-browse-path').value)">Go</button>
            </div>
            <!-- File listing -->
            <div id="ml-browse-list" class="ml-browse-list">
              <p style="font-size:9px;color:var(--text-secondary);padding:12px;">Loading...</p>
            </div>
            <!-- Selected file bar -->
            <div id="ml-browse-selected" class="ml-browse-selected" style="display:none;">
              <span class="ml-sel-icon">📦</span>
              <div class="ml-sel-info">
                <span id="ml-sel-name" class="ml-sel-name"></span>
                <span id="ml-sel-size" class="ml-sel-size"></span>
              </div>
              <button class="btn-primary" id="ml-sel-import" onclick="ModelLoader._importSelectedFile()">Import</button>
            </div>
          </div>
          
          <!-- TAB: HuggingFace download -->
          <div id="ml-tab-download" class="ml-tab-content" style="display:none;">
            <!-- Search + filter row -->
            <div class="ml-hf-search-row">
              <input id="ml-hf-query" class="ml-hf-input" type="text"
                placeholder="Search models…"
                onkeydown="if(event.key==='Enter')ModelLoader._hfSearch()">
              <button class="ml-hf-search-btn" onclick="ModelLoader._hfSearch()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </button>
            </div>
            <!-- Type filters -->
            <div class="ml-hf-pills" id="ml-hf-filters">
              <button class="ml-hf-pill active" onclick="ModelLoader._hfQuick(this,'','any')">🔥 All</button>
              <button class="ml-hf-pill" onclick="ModelLoader._hfQuick(this,'','text-generation')">💬 Text</button>
              <button class="ml-hf-pill" onclick="ModelLoader._hfQuick(this,'code','text-generation')">💻 Code</button>
              <button class="ml-hf-pill" onclick="ModelLoader._hfQuick(this,'','text-to-image')">🖼 Image</button>
              <button class="ml-hf-pill" onclick="ModelLoader._hfQuick(this,'','feature-extraction')">📐 Embed</button>
              <button class="ml-hf-pill" onclick="ModelLoader._hfQuick(this,'tool_calling','any')">🔧 Tools</button>
              <button class="ml-hf-pill" onclick="ModelLoader._hfQuick(this,'smol','any')">🌙 Dream</button>
            </div>
            <!-- Size filter -->
            <div class="ml-hf-size-row">
              <span class="ml-hf-size-label">Size:</span>
              <button class="ml-hf-size-pill active" data-min="" data-max="" onclick="ModelLoader._hfSizeFilter(this)">Any</button>
              <button class="ml-hf-size-pill" data-min="" data-max="1.5" onclick="ModelLoader._hfSizeFilter(this)">≤1B</button>
              <button class="ml-hf-size-pill" data-min="1.5" data-max="4" onclick="ModelLoader._hfSizeFilter(this)">1–3B</button>
              <button class="ml-hf-size-pill" data-min="4" data-max="9" onclick="ModelLoader._hfSizeFilter(this)">4–8B</button>
              <button class="ml-hf-size-pill" data-min="9" data-max="15" onclick="ModelLoader._hfSizeFilter(this)">9–14B</button>
              <button class="ml-hf-size-pill" data-min="15" data-max="" onclick="ModelLoader._hfSizeFilter(this)">15B+</button>
            </div>
            <!-- Sort + Language + Quant row -->
            <div class="ml-hf-size-row">
              <span class="ml-hf-size-label">Sort:</span>
              <button class="ml-hf-size-pill active" data-sort="downloads" onclick="ModelLoader._hfSortFilter(this)">&#x2193; Downloads</button>
              <button class="ml-hf-size-pill" data-sort="trending" onclick="ModelLoader._hfSortFilter(this)">&#x1F525; Trending</button>
              <button class="ml-hf-size-pill" data-sort="likes" onclick="ModelLoader._hfSortFilter(this)">&#x2665; Likes</button>
              <button class="ml-hf-size-pill" data-sort="lastModified" onclick="ModelLoader._hfSortFilter(this)">&#x1F553; Recent</button>
            </div>
            <div class="ml-hf-size-row">
              <span class="ml-hf-size-label">Quant:</span>
              <button class="ml-hf-size-pill active" data-quant="" onclick="ModelLoader._hfQuantFilter(this)">Any</button>
              <button class="ml-hf-size-pill" data-quant="Q4" onclick="ModelLoader._hfQuantFilter(this)">Q4</button>
              <button class="ml-hf-size-pill" data-quant="Q5" onclick="ModelLoader._hfQuantFilter(this)">Q5</button>
              <button class="ml-hf-size-pill" data-quant="Q8" onclick="ModelLoader._hfQuantFilter(this)">Q8</button>
              <button class="ml-hf-size-pill" data-quant="F16" onclick="ModelLoader._hfQuantFilter(this)">F16</button>
              <button class="ml-hf-size-pill" data-quant="IQ" onclick="ModelLoader._hfQuantFilter(this)">IQ (iMatrix)</button>
            </div>
            <!-- Results -->
            <div id="ml-hf-results" class="ml-hf-results-list"></div>
            <!-- File picker panel -->
            <div id="ml-hf-files" class="ml-hf-file-panel" style="display:none;">
              <div class="ml-hf-file-header">
                <a id="ml-hf-repo-link" class="ml-hf-repo-link" href="#" target="_blank">↗</a>
                <span id="ml-hf-repo-name" class="ml-hf-repo-title"></span>
                <button class="ml-hf-back-btn" onclick="ModelLoader._hfCloseFiles()">← Back</button>
              </div>
              <div class="ml-hf-file-hint">Pick a quantization — <b>Q4_K_M</b> best balance · <b>Q8</b> highest quality · <b>Q2/IQ2</b> smallest</div>
              <div id="ml-hf-file-list" class="ml-hf-file-list"></div>
            </div>
            <!-- Active downloads -->
            <div id="ml-downloads-list" style="margin-top:8px;"></div>
          </div>
          
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
    // Inject HF search styles if not already present
    if (!document.getElementById('ml-hf-css')) {
      const s = document.createElement('style'); s.id = 'ml-hf-css';
      s.textContent = `
        .ml-hf-search-row{display:flex;gap:6px;margin-bottom:8px;}
        .ml-hf-input{flex:1;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e2e8f0;font-size:10px;padding:6px 10px;outline:none;}
        .ml-hf-input:focus{border-color:rgba(79,172,254,0.5);}
        .ml-hf-search-btn{background:rgba(79,172,254,0.15);border:1px solid rgba(79,172,254,0.35);color:#4facfe;border-radius:8px;padding:6px 10px;cursor:pointer;display:flex;align-items:center;transition:all .15s;}
        .ml-hf-search-btn:hover{background:rgba(79,172,254,0.28);}
        .ml-hf-pills{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px;}
        .ml-hf-pill{font-size:8px;padding:3px 9px;border-radius:10px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:#94a3b8;cursor:pointer;white-space:nowrap;transition:all .12s;}
        .ml-hf-pill.active,.ml-hf-pill:hover{background:rgba(79,172,254,0.18);color:#4facfe;border-color:rgba(79,172,254,0.4);}
        .ml-hf-size-row{display:flex;align-items:center;gap:4px;margin-bottom:10px;flex-wrap:wrap;}
        .ml-hf-size-label{font-size:8px;color:#475569;white-space:nowrap;}
        .ml-hf-size-pill{font-size:8px;padding:2px 7px;border-radius:8px;border:1px solid rgba(255,255,255,0.08);background:rgba(255,255,255,0.02);color:#64748b;cursor:pointer;transition:all .12s;white-space:nowrap;}
        .ml-hf-size-pill.active,.ml-hf-size-pill:hover{background:rgba(167,139,250,0.15);color:#a78bfa;border-color:rgba(167,139,250,0.35);}
        .ml-hf-results-list{max-height:195px;overflow-y:auto;display:flex;flex-direction:column;gap:2px;}
        .ml-hf-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid transparent;transition:all .12s;}
        .ml-hf-row:hover{background:rgba(79,172,254,0.07);border-color:rgba(79,172,254,0.15);}
        .ml-hf-role-badge{width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;background:rgba(255,255,255,0.06);}
        .ml-hf-row-body{flex:1;min-width:0;}
        .ml-hf-row-top{display:flex;align-items:center;gap:6px;margin-bottom:2px;}
        .ml-hf-row-bottom{display:flex;align-items:center;gap:8px;}
        .ml-hf-id{font-size:10px;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}
        .ml-hf-size-hint{font-size:8px;color:#a78bfa;background:rgba(167,139,250,0.1);padding:1px 5px;border-radius:4px;white-space:nowrap;}
        .ml-hf-stat{font-size:8px;color:#64748b;} .ml-hf-date{color:#475569;font-style:italic;}
        .ml-hf-src{font-size:8px;color:#4facfe;text-decoration:none;opacity:0.7;}
        .ml-hf-src:hover{opacity:1;text-decoration:underline;}
        .ml-hf-open-btn{background:rgba(79,172,254,0.1);border:1px solid rgba(79,172,254,0.25);color:#4facfe;border-radius:5px;padding:3px 8px;cursor:pointer;font-size:12px;transition:all .12s;flex-shrink:0;}
        .ml-hf-open-btn:hover{background:rgba(79,172,254,0.25);}
        .ml-hf-file-panel{display:none;flex-direction:column;gap:6px;margin-top:8px;padding:10px;background:rgba(0,0,0,0.25);border-radius:8px;border:1px solid rgba(255,255,255,0.07);}
        .ml-hf-file-header{display:flex;align-items:center;gap:6px;}
        .ml-hf-repo-link{color:#4facfe;font-size:10px;text-decoration:none;flex-shrink:0;}
        .ml-hf-repo-title{flex:1;font-size:9px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .ml-hf-back-btn{background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:5px;padding:2px 8px;font-size:8px;cursor:pointer;}
        .ml-hf-file-hint{font-size:8px;color:#475569;padding:2px 0 4px;}.ml-hf-file-hint b{color:#94a3b8;}
        .ml-hf-file-list{display:flex;flex-direction:column;gap:3px;max-height:180px;overflow-y:auto;}
        .ml-hf-file-row{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-radius:5px;border:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);transition:all .12s;}
        .ml-hf-file-row:hover{background:rgba(79,172,254,0.06);border-color:rgba(79,172,254,0.2);}
        .ml-hf-file-rec{background:rgba(79,172,254,0.06);border-color:rgba(79,172,254,0.25);}
        .ml-hf-file-left{display:flex;align-items:center;gap:6px;flex:1;min-width:0;}
        .ml-hf-file-right{display:flex;align-items:center;gap:6px;flex-shrink:0;}
        .ml-hf-quant{font-size:9px;font-weight:700;min-width:56px;font-family:monospace;}
        .ml-hf-rec{font-size:7px;background:rgba(79,172,254,0.2);color:#4facfe;padding:1px 4px;border-radius:3px;white-space:nowrap;}
        .ml-hf-fname{font-size:8px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .ml-hf-fsize{font-size:9px;color:#64748b;white-space:nowrap;min-width:45px;text-align:right;}
        .ml-hf-dl-btn{background:linear-gradient(135deg,#4facfe,#2563eb);border:none;color:#fff;border-radius:5px;padding:3px 8px;font-size:8px;cursor:pointer;white-space:nowrap;transition:all .12s;}
        .ml-hf-dl-btn:hover{transform:scale(1.04);box-shadow:0 2px 8px rgba(79,172,254,0.4);}
        .ml-hf-cap{font-size:7px;padding:1px 5px;border-radius:4px;background:rgba(99,102,241,0.15);color:#818cf8;border:1px solid rgba(99,102,241,0.25);white-space:nowrap;}
                .ml-hf-loading{color:#64748b;font-size:9px;padding:12px 8px;text-align:center;}
        .ml-hf-empty{color:#64748b;font-size:9px;padding:12px 8px;text-align:center;line-height:1.6;}
        .ml-hf-error{color:#f87171;font-size:9px;padding:8px;}
      `; document.head.appendChild(s);
    }
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
    if (name === 'browse') this._browseGo(this._browseCurrent || null);
    if (name === 'download') {
      this._refreshDownloads();
      // Auto-search on first open
      if (!this._hfCurrentQuery) setTimeout(() => this._hfSearch(), 100);
    }
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
      actions = `
        <button class="btn-primary" onclick="ModelLoader.showImportDialog('${this._escape(m.file_name)}')">Import to Library</button>
        <button class="btn-secondary danger-action" onclick="ModelLoader.removeFile('${this._escape(m.file_name)}')">Delete</button>`;
    } else {
      const curType = m.config?.model_type || m.model_type || 'text';
      const toggleLabel = curType === 'image' ? '→ Text Model' : '→ Image Model';
      const nextType    = curType === 'image' ? 'text' : 'image';
      actions = `
        ${curType === 'image'
          ? `<button class="btn-primary" onclick="ModelLoader.openImageGen('${m.model_id}')">🎨 Generate Image</button>`
          : `${!m.is_poseidon ? `<button class="btn-secondary" onclick="ModelLoader.assignPoseidon('${m.model_id}')">Use as Poseidon</button>` : ''}`
        }
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
          <strong title="${this._escape(m.file_name)}">${this._escape(m.file_name)}</strong>
          <span class="model-size-pill">${sizeStr}</span>
          ${statusBadge}
        </div>
        <div class="model-card-body">
          ${warningSection}${paramsSection}${runtimeSection}
        </div>
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
              Recommended: 'auto' for both fields. IAQUA probes your free VRAM
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
          File size: ${fileSizeGb} GB. With 'auto' both fields, IAQUA reads your
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
  
  _browseCurrent: null,
  _browseParent:  null,

  async _browseUp() {
    if (this._browseParent) await this._browseGo(this._browseParent);
  },

  async _browseGo(targetPath) {
    const list = this.modal?.querySelector('#ml-browse-list');
    if (!list) return;
    list.innerHTML = '<div class="ml-browse-loading">Loading…</div>';

    try {
      const url = targetPath
        ? `/models/browse?path=${encodeURIComponent(targetPath)}`
        : '/models/browse';
      const data = await window.ApiV2._fetch(url);

      this._browseCurrent = data.current_path;
      this._browseParent  = data.parent_path;

      const pathInput = this.modal.querySelector('#ml-browse-path');
      const upBtn     = this.modal.querySelector('#ml-browse-up');
      if (pathInput) pathInput.value = data.current_path;
      if (upBtn)     upBtn.disabled  = !data.parent_path;

      // Hide selected bar when navigating
      const selBar = this.modal.querySelector('#ml-browse-selected');
      if (selBar) selBar.style.display = 'none';

      // Breadcrumb parts
      const parts = data.current_path.split('/').filter(Boolean);
      let breadHtml = '<span class="ml-bread-sep">/</span>';
      let accumulated = '';
      for (const part of parts) {
        accumulated += '/' + part;
        const acc = accumulated;
        breadHtml += `<span class="ml-bread-part" onclick="ModelLoader._browseGo('${this._escapePath(acc)}')">${this._escape(part)}</span><span class="ml-bread-sep">/</span>`;
      }

      let html = `<div class="ml-breadcrumb">${breadHtml}</div>`;
      html += `<div class="ml-browse-meta">${data.dir_count} folder${data.dir_count!==1?'s':''} · ${data.gguf_count} .gguf file${data.gguf_count!==1?'s':''}</div>`;

      if (data.entries.length === 0) {
        html += '<div class="ml-browse-empty">No folders or .gguf files here.</div>';
      } else {
        html += data.entries.map(e => {
          if (e.type === 'directory') {
            return `<div class="ml-browse-entry ml-dir" onclick="ModelLoader._browseGo('${this._escapePath(e.path)}')">
              <span class="ml-entry-icon">📁</span>
              <span class="ml-entry-name">${this._escape(e.name)}</span>
              <span class="ml-entry-arrow">›</span>
            </div>`;
          } else {
            return `<div class="ml-browse-entry ml-file" onclick="ModelLoader._selectFile('${this._escapePath(e.path)}', '${this._escape(e.name)}', '${e.size_gb}')">
              <span class="ml-entry-icon">🧠</span>
              <span class="ml-entry-name">${this._escape(e.name)}</span>
              <span class="ml-entry-size">${e.size_gb} GB</span>
            </div>`;
          }
        }).join('');
      }

      list.innerHTML = html;
    } catch (err) {
      list.innerHTML = `<div class="ml-browse-error">Error: ${this._escape(err.message)}</div>`;
    }
  },

  _selectFile(filePath, fileName, sizeGb) {
    this._selectedFilePath = filePath;
    // Highlight selected
    this.modal.querySelectorAll('.ml-file').forEach(el => el.classList.remove('ml-file-selected'));
    const clicked = [...this.modal.querySelectorAll('.ml-file')].find(el =>
      el.querySelector('.ml-entry-name')?.textContent === fileName
    );
    if (clicked) clicked.classList.add('ml-file-selected');
    // Show bottom bar
    const bar = this.modal.querySelector('#ml-browse-selected');
    this.modal.querySelector('#ml-sel-name').textContent = fileName;
    this.modal.querySelector('#ml-sel-size').textContent = sizeGb + ' GB';
    if (bar) bar.style.display = 'flex';
  },

  async _importSelectedFile() {
    if (!this._selectedFilePath) return;
    await this._importFromPath(this._selectedFilePath);
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
  
  // ── HuggingFace Search & Browse ──────────────────────────────────────────

  _hfCurrentQuery: '', _hfCurrentPipeline: 'any', _hfCurrentRepo: null,
  _hfMinSize: '', _hfMaxSize: '',

  _hfSizeFilter(btn) {
    // Only toggle pills in the same row
    btn.closest('.ml-hf-size-row').querySelectorAll('.ml-hf-size-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    this._hfMinSize = btn.dataset.min || '';
    this._hfMaxSize = btn.dataset.max || '';
    this._hfSearch();
  },

  _hfSortFilter(btn) {
    btn.closest('.ml-hf-size-row').querySelectorAll('.ml-hf-size-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    this._hfSort = btn.dataset.sort || 'downloads';
    this._hfSearch();
  },

  _hfQuantFilter(btn) {
    btn.closest('.ml-hf-size-row').querySelectorAll('.ml-hf-size-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    this._hfQuant = btn.dataset.quant || '';
    this._hfSearch();
  },

  async _hfSearch() {
    const q = this.modal.querySelector('#ml-hf-query')?.value.trim() || '';
    this._hfCurrentQuery = q;
    const el = this.modal.querySelector('#ml-hf-results');
    el.innerHTML = '<div class="ml-hf-loading">Searching HuggingFace…</div>';
    this._hfCloseFiles();
    try {
      const sort = this._hfSort || 'downloads';
      let url = '/models/hf-search?q=' + encodeURIComponent(q) + '&limit=30&sort=' + sort;
      if (this._hfCurrentPipeline && this._hfCurrentPipeline !== 'any') url += '&pipeline=' + encodeURIComponent(this._hfCurrentPipeline);
      if (this._hfMinSize) url += '&minSize=' + this._hfMinSize;
      if (this._hfMaxSize) url += '&maxSize=' + this._hfMaxSize;
      if (this._hfQuant)   url += '&quant=' + encodeURIComponent(this._hfQuant);
      const data = await window.ApiV2._fetch(url);
      if (!data.models?.length) { el.innerHTML = '<div class="ml-hf-empty">No results — try different filters.</div>'; return; }
      el.innerHTML = data.models.map(m => {
        const icons = {chat:'💬',code:'💻',dream:'🌙',embed:'📐',reason:'🧠',image:'🖼',audio:'🎵'};
        const roleIcon = icons[m.role] || '🤖';
        const dl = m.downloads > 1000000 ? (m.downloads/1000000).toFixed(1)+'M'
                 : m.downloads > 1000 ? (m.downloads/1000).toFixed(0)+'k' : (m.downloads||0);
        const lk = m.likes > 1000 ? (m.likes/1000).toFixed(1)+'k' : (m.likes||0);
        const sz = m.size_hint ? `<span class="ml-hf-size-hint">${m.size_hint}</span>` : '';
        const src_link = `https://huggingface.co/${m.id}`;
        const capsHtml = (m.caps||[]).map(c => `<span class="ml-hf-cap">${c}</span>`).join('');
        const updatedStr = m.updated ? new Date(m.updated).toLocaleDateString('fr-FR',{day:'2-digit',month:'2-digit',year:'2-digit'}) : '';
        return `<div class="ml-hf-row" onclick="ModelLoader._hfOpenRepo('${m.id}')">
          <span class="ml-hf-role-badge ml-hf-role-${m.role}">${roleIcon}</span>
          <div class="ml-hf-row-body">
            <div class="ml-hf-row-top"><span class="ml-hf-id">${m.id}</span>${sz}</div>
            <div class="ml-hf-row-bottom">
              ${capsHtml}
              <span class="ml-hf-stat">↓${dl}</span>
              <span class="ml-hf-stat">♥${lk}</span>
              ${updatedStr ? `<span class="ml-hf-stat ml-hf-date">${updatedStr}</span>` : ''}
              <a class="ml-hf-src" href="${src_link}" target="_blank" onclick="event.stopPropagation()">↗ HF</a>
            </div>
          </div>
          <button class="ml-hf-open-btn" title="Browse files">›</button>
        </div>`;
      }).join('');
    } catch(e) { el.innerHTML = '<div class="ml-hf-error">Error: ' + e.message + '</div>'; }
  },

  _hfQuick(btn, q, pipeline) {
    this.modal.querySelectorAll('.ml-hf-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    this.modal.querySelector('#ml-hf-query').value = q;
    this._hfCurrentPipeline = pipeline || 'any';
    this._hfSearch();
  },

  async _hfOpenRepo(repoId) {
    this._hfCurrentRepo = repoId;
    const panel = this.modal.querySelector('#ml-hf-files');
    const fileList = this.modal.querySelector('#ml-hf-file-list');
    this.modal.querySelector('#ml-hf-repo-name').textContent = repoId;
    const link = this.modal.querySelector('#ml-hf-repo-link');
    if (link) link.href = 'https://huggingface.co/' + repoId;
    // Clear old caps
    const oldCaps = this.modal.querySelector('#ml-hf-repo-caps');
    if (oldCaps) oldCaps.remove();
    fileList.innerHTML = '<div class="ml-hf-loading">Loading files…</div>';
    panel.style.display = 'flex';
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    try {
      const data = await window.ApiV2._fetch('/models/hf-files?repo=' + encodeURIComponent(repoId));
      // Show repo capabilities
      if (data.caps?.length || data.pipeline) {
        const capsDiv = document.createElement('div');
        capsDiv.id = 'ml-hf-repo-caps';
        capsDiv.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;padding:4px 0;';
        const items = [...(data.caps||[])];
        if (data.pipeline && !items.some(c => c.includes(data.pipeline))) {
          items.unshift(`<span style="font-size:8px;color:#94a3b8">${data.pipeline}</span>`);
        }
        capsDiv.innerHTML = items.map(c => `<span class="ml-hf-cap">${c}</span>`).join('');
        const hint = panel.querySelector('.ml-hf-file-hint');
        if (hint) hint.insertAdjacentElement('beforebegin', capsDiv);
      }
      if (!data.files?.length) {
        fileList.innerHTML = `<div class="ml-hf-empty">${data.warning||'No .gguf files found.'}<br>
          <a class="ml-hf-src" href="https://huggingface.co/${repoId}" target="_blank">Open on HuggingFace ↗</a></div>`;
        return;
      }
      // Auto-select best quant (Q4_K_M recommended, else first file)
      const best = data.files.find(f => f.recommended) || data.files[0];
      fileList.innerHTML = data.files.map(f => {
        const isBest = f === best;
        const qColor = /Q8|Q6/.test(f.quant)?'#34d399':/Q[45]/.test(f.quant)?'#60a5fa':/Q[23]/.test(f.quant)?'#f59e0b':/IQ/.test(f.quant)?'#a78bfa':'#94a3b8';
        const sizeStr = f.size_gb != null ? f.size_gb + ' GB' : '?';
        const safeUrl = f.url.replace(/'/g,"\'");
        const safeName = f.name.replace(/'/g,"\'");
        return `<div class="ml-hf-file-row${isBest?' ml-hf-file-rec':''}">
          <div class="ml-hf-file-left">
            <span class="ml-hf-quant" style="color:${qColor}">${f.quant}</span>
            ${isBest?'<span class="ml-hf-rec">★ Best</span>':''}
            <span class="ml-hf-fname" title="${f.name}">${f.name}</span>
          </div>
          <div class="ml-hf-file-right">
            <span class="ml-hf-fsize">${sizeStr}</span>
            <button class="ml-hf-dl-btn" onclick="ModelLoader._hfStartDownload('${safeUrl}','${safeName}')">↓ Add</button>
          </div>
        </div>`;
      }).join('');
    } catch(e) { fileList.innerHTML = '<div class="ml-hf-error">' + e.message + '</div>'; }
  },

  _hfCloseFiles() {
    const el = this.modal?.querySelector('#ml-hf-files');
    if (el) el.style.display = 'none';
    this._hfCurrentRepo = null;
  },

  async _hfStartDownload(url, fileName) {
    try {
      await window.ApiV2._fetch('/models/download', { method: 'POST', body: JSON.stringify({ url, fileName }) });
      this._hfCloseFiles();
      this._refreshDownloads();
      if (!this._downloadPollInterval) this._downloadPollInterval = setInterval(() => this._refreshDownloads(), 1500);
    } catch(e) { await SquidModal.alert('Download failed: ' + e.message); }
  },

  _downloadPollInterval: null,
  _downloadPollInterval: null,
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
  
  // Per-model optimal params based on filename
  _imggenAutoParams(fileName) {
    const f = (fileName || '').toLowerCase();
    const isFlux = /flux/i.test(f);
    if (isFlux) {
      const isDev  = /dev/i.test(f);
      // Q2 quant has lower quality ceiling — 850x850 is sweet spot for speed/quality
      // Q4+ can do 1024 but will force CPU anyway; 850 is a safe universal default
      const quantMatch = f.match(/[_-]q(\d+)/i);
      const quant = quantMatch ? parseInt(quantMatch[1]) : 0;
      const defW  = (quant >= 4 || quant === 0) ? 850 : 1024;
      const defH  = defW;
      return { width: defW, height: defH, steps: isDev ? 20 : 8, cfg: 1.0, label: `Flux optimal (${defW}×${defH})` };
    }
    const isXL = /xl|sdxl/i.test(f);
    return isXL
      ? { width: 1024, height: 1024, steps: 30, cfg: 7.5, label: 'SDXL optimal' }
      : { width: 512,  height: 512,  steps: 25, cfg: 7.5, label: 'SD1.5 optimal' };
  },

  // 12 high-quality prompt presets
  _imggenPrompts() {
    return [
      'cinematic portrait of a lone astronaut on a desolate alien mesa, golden hour light, dusty atmosphere, ultra-detailed, 8k, photorealistic',
      'aerial view of a futuristic city at night, neon reflections on wet streets, volumetric fog, drone shot, hyperrealistic',
      'ancient temple ruins in dense tropical jungle, shafts of sunlight through mist, moss-covered stones, cinematic composition',
      'close-up macro of a mechanical eye with iris gears, copper and chrome, biopunk aesthetic, studio lighting, ultra-sharp',
      'vast frozen tundra under aurora borealis, lonely pine tree, long exposure photography, high dynamic range',
      'underwater city with bioluminescent coral skyscrapers, manta rays drifting past windows, deep ocean blues, photorealistic',
      'hyperdetailed portrait of an elderly samurai, weathered face, cherry blossoms falling, golden ratio composition, 8k',
      'surreal library with infinite spiral staircases, warm candlelight, books floating mid-air, Escher-inspired architecture',
      'volcanic eruption at dusk, lava river meeting ocean, dramatic storm sky, national geographic style photography',
      'crystal cave cathedral with towering amethyst pillars, ethereal inner glow, 8k fantasy landscape, cinematic',
      'sci-fi space station interior, workers in exosuits, industrial scale, Syd Mead concept art style, detailed',
      'raindrop on a spiderweb at dawn, golden bokeh background, extreme macro photography, award-winning composition',
    ];
  },

  openImageGen(modelId) {
    const m = this.library?.models?.find(m => m.model_id === modelId);
    if (!m) return;
    const auto = this._imggenAutoParams(m.file_name);
    const prompts = this._imggenPrompts();
    const isFlux = /flux/i.test((m.file_name || '').toLowerCase());
    const S = (v) => String(v).replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'})[c]);

    const promptChips = prompts.map((p) =>
      '<button onclick="var ta=this.closest(\'.modal\').querySelector(\'#imggen-prompt\');if(ta){ta.value=this.dataset.p;ta.style.borderColor=\'#4facfe\';}" ' +
      'data-p="' + S(p) + '" ' +
      'title="' + S(p) + '" ' +
      'style="background:rgba(79,172,254,0.06);border:1px solid rgba(79,172,254,0.2);color:#94a3b8;border-radius:5px;padding:3px 7px;font-size:8px;cursor:pointer;max-width:155px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      S(p.slice(0, 26)) + '…</button>'
    ).join('');

    const cfgTitle  = isFlux ? 'Flux: keep at 1.0 (higher values ignored)' : 'SD: 7-12 for quality';
    const stepTitle = isFlux ? 'Flux schnell: 8, dev: 20. More = slower + marginal gain' : 'SD: 20-30 for quality';

    // Remove any leftover imggen dialog (prevents duplicate #imggen-prompt ids)
    document.querySelectorAll('.modal.imggen-modal').forEach(el => el.remove());
    const dlg = document.createElement('div');
    dlg.className = 'modal imggen-modal';
    dlg.innerHTML =
      '<div class="modal-content" style="width:540px;max-height:90vh;overflow-y:auto;padding:20px;gap:10px;display:flex;flex-direction:column;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px;">' +
          '<strong style="color:#e2e8f0;font-size:12px;">Generate Image — ' + S(m.file_name) + '</strong>' +
          '<button onclick="this.closest(\'.modal\').remove()" style="background:none;border:none;color:#64748b;font-size:16px;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="font-size:8px;color:#64748b;margin-bottom:1px;">Prompt suggestions — click to use:</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:4px;max-height:72px;overflow-y:auto;padding:1px 0;">' + promptChips + '</div>' +
        '<textarea id="imggen-prompt" placeholder="Describe the image…" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e2e8f0;font-size:10px;padding:8px;resize:vertical;min-height:58px;font-family:inherit;"></textarea>' +
        '<input id="imggen-neg" type="text" placeholder="Negative prompt (optional)" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#e2e8f0;font-size:10px;padding:6px 10px;">' +
        '<div style="display:flex;align-items:center;gap:8px;background:rgba(79,172,254,0.07);border:1px solid rgba(79,172,254,0.18);border-radius:7px;padding:6px 10px;">' +
          '<span style="font-size:8px;color:#4facfe;font-weight:700;letter-spacing:.5px;">AUTO</span>' +
          '<span style="font-size:8px;color:#64748b;">' + auto.label + ' — ' + auto.width + '×' + auto.height + ' · ' + auto.steps + ' steps · CFG ' + auto.cfg + '</span>' +
          '<button onclick="ModelLoader._resetAutoParams(this.closest(\'.modal\'))" style="margin-left:auto;background:rgba(79,172,254,0.12);border:1px solid rgba(79,172,254,0.3);color:#4facfe;border-radius:5px;padding:2px 8px;font-size:8px;cursor:pointer;">Reset</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
          '<label style="font-size:9px;color:#64748b;display:flex;flex-direction:column;gap:3px;">Width<input id="imggen-w" type="number" value="' + auto.width + '" min="64" max="2048" step="64" style="width:70px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:10px;padding:4px 6px;"></label>' +
          '<label style="font-size:9px;color:#64748b;display:flex;flex-direction:column;gap:3px;">Height<input id="imggen-h" type="number" value="' + auto.height + '" min="64" max="2048" step="64" style="width:70px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:10px;padding:4px 6px;"></label>' +
          '<label title="' + stepTitle + '" style="font-size:9px;color:#64748b;display:flex;flex-direction:column;gap:3px;">Steps<input id="imggen-steps" type="number" value="' + auto.steps + '" min="1" max="100" style="width:55px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:10px;padding:4px 6px;"></label>' +
          '<label title="' + cfgTitle + '" style="font-size:9px;color:#64748b;display:flex;flex-direction:column;gap:3px;">CFG<input id="imggen-cfg" type="number" value="' + auto.cfg + '" min="0.1" max="30" step="0.1" style="width:55px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:10px;padding:4px 6px;"></label>' +
          '<label title="Seed (-1 = random, set a value to reproduce exact result)" style="font-size:9px;color:#64748b;display:flex;flex-direction:column;gap:3px;">Seed<input id="imggen-seed" type="number" value="-1" min="-1" max="2147483647" style="width:78px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#e2e8f0;font-size:10px;padding:4px 6px;"></label>' +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-top:2px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:7px;padding:6px 10px;">' +
          '<span style="font-size:8px;color:#64748b;">Assign to agent (optional):</span>' +
          '<select id="imggen-agent" style="flex:1;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#e2e8f0;font-size:9px;padding:4px 6px;font-family:inherit;">' +
            '<option value="">— Generate now (direct) —</option>' +
          '</select>' +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:2px;">' +
          '<button onclick="this.closest(\'.modal\').remove()" style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);color:#94a3b8;border-radius:6px;padding:5px 12px;font-size:10px;cursor:pointer;">Cancel</button>' +
          '<button id="imggen-run" onclick="ModelLoader._runImageGen(\'' + modelId + '\', this.closest(\'.modal\'))" style="background:linear-gradient(135deg,#4facfe,#2563eb);border:none;color:#fff;border-radius:6px;padding:5px 16px;font-size:10px;cursor:pointer;font-weight:600;">Generate</button>' +
        '</div>' +
        '<div id="imggen-result" style="display:none;margin-top:8px;text-align:center;"></div>' +
      '</div>';
    document.body.appendChild(dlg);
    // Populate agent selector
    window.ApiV2?._fetch('/agents').then(r => {
      const sel = dlg.querySelector('#imggen-agent');
      if (!sel) return;
      Object.values(r.registry?.agents || {}).forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.agent_id;
        opt.textContent = (a.display_name || a.agent_id) + ' (' + (a.specialization || 'general') + ')';
        sel.appendChild(opt);
      });
    }).catch(() => {});
  },

  _resetAutoParams(dlg) {
    const btn = dlg.querySelector('#imggen-run');
    if (!btn) return;
    const match = btn.getAttribute('onclick')?.match(/\'([^\']+)\'/);
    if (!match) return;
    const modelId = match[1];
    const m = ModelLoader.library?.models?.find(m => m.model_id === modelId);
    if (!m) return;
    const auto = ModelLoader._imggenAutoParams(m.file_name);
    dlg.querySelector('#imggen-w').value     = auto.width;
    dlg.querySelector('#imggen-h').value     = auto.height;
    dlg.querySelector('#imggen-steps').value = auto.steps;
    dlg.querySelector('#imggen-cfg').value   = auto.cfg;
  },

  async _runImageGen(modelId, dlg) {
    const prompt  = dlg.querySelector('#imggen-prompt')?.value.trim();
    const neg     = dlg.querySelector('#imggen-neg')?.value.trim() || '';
    const width   = parseInt(dlg.querySelector('#imggen-w')?.value)     || 850;
    const height  = parseInt(dlg.querySelector('#imggen-h')?.value)     || 850;
    const steps   = parseInt(dlg.querySelector('#imggen-steps')?.value) || 20;
    const cfg     = parseFloat(dlg.querySelector('#imggen-cfg')?.value) || 7;
    const seed    = parseInt(dlg.querySelector('#imggen-seed')?.value)  ?? -1;
    const agentId = dlg.querySelector('#imggen-agent')?.value || null;
    if (!prompt) { await SquidModal.alert('Enter a prompt first'); return; }
    const runBtn  = dlg.querySelector('#imggen-run');
    const result  = dlg.querySelector('#imggen-result');
    runBtn.disabled = true; runBtn.textContent = 'Generating…';
    result.style.display = 'block';
    result.innerHTML = '<div style="color:#94a3b8;font-size:9px;">Starting generation…</div>';

    // Accelerate TaskQueueUI polling during generation (2s instead of 6s)
    let _fastPoll = null;
    const _startFastPoll = () => {
      if (typeof TaskQueueUI !== 'undefined') {
        clearInterval(TaskQueueUI.refreshInterval);
        _fastPoll = setInterval(() => TaskQueueUI._render(), 2000);
        TaskQueueUI.refreshInterval = _fastPoll;
      }
    };
    const _stopFastPoll = () => {
      if (_fastPoll) { clearInterval(_fastPoll); _fastPoll = null; }
      if (typeof TaskQueueUI !== 'undefined') {
        clearInterval(TaskQueueUI.refreshInterval);
        TaskQueueUI.refreshInterval = setInterval(() => TaskQueueUI._render(), 6000);
        TaskQueueUI._render();
      }
    };
    _startFastPoll();

    // If an agent is selected, create a task and let the agent handle generation
    if (agentId) {
      try {
        const taskRes = await window.ApiV2._fetch('/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title: `Generate image: ${prompt.slice(0, 60)}`,
            description: `Image generation task.\nModel: ${modelId}\nPrompt: ${prompt}\nNegative: ${neg}\nSize: ${width}x${height} steps:${steps} cfg:${cfg} seed:${seed}`,
            assigned_to: agentId,
            task_type: 'image_generation'
          })
        });
        _stopFastPoll();
        const taskId = taskRes.task?.task_id;
        dlg.querySelector('#imggen-result').innerHTML =
          '<div style="color:#06ffa5;font-size:9px;padding:8px;background:rgba(6,255,165,0.06);border-radius:6px;">' +
          'Task dispatched to agent' + (taskId ? ' [' + taskId + ']' : '') + '.<br>' +
          'Monitor progress in the Task Queue right panel.</div>';
        runBtn.disabled = false; runBtn.textContent = 'Generate';
        return;
      } catch(e) {
        _stopFastPoll();
        dlg.querySelector('#imggen-result').innerHTML = '<div style="color:#f87171;font-size:9px;">' + e.message + '</div>';
        runBtn.disabled = false; runBtn.textContent = 'Generate';
        return;
      }
    }

    try {
      const data = await window.ApiV2._fetch('/models/generate-image', {
        method: 'POST',
        body: JSON.stringify({ modelId, model_id: modelId, prompt, negativePrompt: neg, width, height, steps, cfg, seed })
      });
      _stopFastPoll();
      if (data.ok && data.url) {
        // Image stored in TASKS/OUTPUT — show in task queue, not here
        result.innerHTML =
          '<div style="color:#06ffa5;font-size:9px;padding:8px;background:rgba(6,255,165,0.06);border-radius:6px;">' +
          'Image generated' + (data.task_id ? ' [' + data.task_id + ']' : '') + '.<br>' +
          'View in the Task Queue &rarr; Recent Results below.</div>';
        // Trigger immediate TaskQueueUI refresh
        if (typeof TaskQueueUI !== 'undefined') { TaskQueueUI._render(); }
      } else {
        result.innerHTML = `<div style="color:#f87171;font-size:9px;padding:8px;background:rgba(248,113,113,0.08);border-radius:6px;">${data.error || 'Unknown error'}</div>`;
      }
    } catch(e) {
      _stopFastPoll();
      result.innerHTML = `<div style="color:#f87171;font-size:9px;">${e.message}</div>`;
    } finally {
      runBtn.disabled = false; runBtn.textContent = 'Generate ✨';
    }
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
