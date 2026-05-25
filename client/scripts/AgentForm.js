/**
 * AgentForm - Comprehensive agent editor mapping every field of the
 * squid_brain_NNN.json schema to a proper UI control.
 *
 * Sections: Identity / Brain / Inference / Personality / Capabilities /
 *           Tools (grid) / Memory / Appearance / Lifecycle
 *
 * - Model is a dropdown sourced from data/models/model_registry.json
 * - Tools render as a video-game inventory grid with hover hints
 * - Accessories show 2D pixel-art previews (no emojis)
 */

const AgentForm = {
  modal: null,
  agentId: null,
  brain: null,
  registry: null,
  toolRegistry: null,
  modelRegistry: null,
  dirty: new Map(),
  isCreating: false,        // true = creating a new squid, false = editing existing
  newSquidDraft: null,      // staged values for creation

  async open(agentId) {
    this.agentId = agentId;
    this.isCreating = false;
    this.newSquidDraft = null;
    this.dirty = new Map();
    try {
      const [agentRes, toolsRes, modelsRes] = await Promise.all([
        window.ApiV2.agents.get(agentId),
        window.ApiV2.tools.list(),
        window.ApiV2.models.list()
      ]);
      this.brain = agentRes.agent.brain || {};
      this.registry = agentRes.agent.registry_entry || {};
      this.toolRegistry = toolsRes.registry || {};
      this.modelRegistry = modelsRes.registry || {};
    } catch (err) {
      alert('Failed to load agent: ' + err.message);
      return;
    }
    this._buildModal();
    this._render();
  },
  
  /**
   * Open the same form to CREATE a new squid (instead of editing existing).
   * Same UI - just starts with default values and on save POSTs to create.
   */
  async openNew() {
    this.agentId = null;
    this.isCreating = true;
    this.dirty = new Map();
    
    // Default brain template + registry entry for a new squid
    this.newSquidDraft = {
      display_name: 'New Squid',
      specialization: 'general',
      status: 'sleeping'
    };
    this.brain = this._defaultBrainTemplate();
    this.registry = {
      display_name: 'New Squid',
      specialization: 'general',
      status: 'sleeping',
      brain_file: '__pending__',  // server assigns real file name
      reports_to: null
    };
    
    try {
      const [toolsRes, modelsRes] = await Promise.all([
        window.ApiV2.tools.list(),
        window.ApiV2.models.list()
      ]);
      this.toolRegistry = toolsRes.registry || {};
      this.modelRegistry = modelsRes.registry || {};
    } catch (err) {
      this.toolRegistry = { tools: {} };
      this.modelRegistry = { models: {} };
    }
    
    this._buildModal();
    this._render();
  },
  
  _defaultBrainTemplate() {
    return {
      identity: {
        agent_id: '__pending__',
        nickname: '',
        role: 'Versatile helper',
        story: '',
        created_at: new Date().toISOString()
      },
      brain_config: {
        model_binding: { preferred_model_id: null },
        system_prompt: 'You are a helpful squid agent. Be concise and direct.',
        inference_params: {
          temperature: 0.7,
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.1,
          max_tokens_per_response: 2048
        }
      },
      personality: {
        traits: {
          curiosity: 0.7, thoroughness: 0.7, creativity: 0.5,
          assertiveness: 0.5, empathy: 0.6
        },
        communication_style: 'professional',
        default_mood: 'neutral'
      },
      capabilities: {
        skills: {},
        tools_allowed: []
      },
      memory: {
        context_retention: 0.7,
        long_term_capacity: 100,
        persist_across_sessions: true
      },
      appearance: {
        primary_color: '#FF6B9D',
        secondary_color: '#C44569',
        size_scale: 1.0,
        accessories: {}
      },
      lifecycle: {
        max_concurrent_tasks: 1,
        auto_sleep: 'after_30min'
      }
    };
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
    this.modal.className = 'modal agent-form-modal';
    this.modal.innerHTML = `
      <div class="modal-content agent-form-content" style="width:96vw; max-width:1100px;">
        <div class="modal-header agent-form-header">
          <h2 class="agent-form-title">Edit Agent</h2>
          <button class="btn-close" onclick="AgentForm.close()">x</button>
        </div>
        <div class="modal-body agent-form-body"></div>
        <div class="agent-form-footer">
          <span class="agent-form-status"></span>
          <button class="btn-secondary" onclick="AgentForm.close()">Cancel</button>
          <button class="btn-primary agent-form-save" onclick="AgentForm.save()" disabled>Save (0)</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
  },

  _render() {
    const title = this.modal.querySelector('.agent-form-title');
    title.textContent = this.isCreating
      ? 'Create New Squid'
      : `Edit Agent: ${this.registry.display_name || this.agentId}`;
    
    // Update save button text too
    const saveBtn = this.modal.querySelector('.agent-form-save');
    if (saveBtn) {
      saveBtn.dataset.mode = this.isCreating ? 'create' : 'edit';
    }

    const body = this.modal.querySelector('.agent-form-body');
    body.innerHTML = '';

    const brain = this.brain;
    const reg = this.registry;
    const brainFile = `agents/${reg.brain_file || 'squid_brain_001.json'}`;

    // ===== IDENTITY =====
    this._addSection(body, 'Identity', [
      this._textField('Display Name', reg.display_name || '', v =>
        this._markDirty('agents/agent_registry.json', `agents.${this.agentId}.display_name`, v)),
      this._textField('Nickname', brain.identity?.nickname || '', v =>
        this._markDirty(brainFile, 'identity.nickname', v)),
      this._textField('Role', brain.identity?.role || '', v =>
        this._markDirty(brainFile, 'identity.role', v)),
      this._textareaField('Personal Story', brain.identity?.story || '', v =>
        this._markDirty(brainFile, 'identity.story', v)),
      this._selectField('Specialization', reg.specialization || 'general', [
        'general', 'frontend_specialist', 'backend_specialist', 'fullstack_dev',
        'data_analyst', 'devops', 'qa_tester', 'designer', 'researcher',
        'ml_engineer', 'security', 'documentation'
      ], v => this._markDirty('agents/agent_registry.json', `agents.${this.agentId}.specialization`, v)),
      this._selectField('Status', reg.status || 'sleeping',
        ['sleeping', 'active', 'thinking', 'blocked', 'archived'],
        v => this._markDirty('agents/agent_registry.json', `agents.${this.agentId}.status`, v))
    ]);

    // ===== BRAIN: MODEL BINDING (dropdown from imported models) =====
    const cfg = brain.brain_config || {};
    const inf = cfg.inference_params || {};
    const importedModels = Object.entries(this.modelRegistry.models || {})
      .map(([id, m]) => ({ id, label: `${id} (${m.file_size_gb || '?'} GB)` }));
    const modelOpts = ['(use Poseidon default)', ...importedModels.map(m => m.id)];
    const modelLabels = importedModels.reduce((acc, m) => ({ ...acc, [m.id]: m.label }), { '(use Poseidon default)': '(use Poseidon default)' });

    this._addSection(body, 'Model Binding', [
      this._selectField('Model',
        cfg.model_binding?.preferred_model_id || '(use Poseidon default)',
        modelOpts,
        v => this._markDirty(brainFile, 'brain_config.model_binding.preferred_model_id', v === '(use Poseidon default)' ? null : v),
        modelLabels),
      importedModels.length === 0
        ? this._infoNote('No models imported yet. Open the Models panel to import one.')
        : null
    ].filter(Boolean));

    // ===== BRAIN: INFERENCE =====
    this._addSection(body, 'Inference Parameters', [
      this._numberField('Temperature (creativity)', inf.temperature ?? 0.7, 0, 2, 0.05, v =>
        this._markDirty(brainFile, 'brain_config.inference_params.temperature', v)),
      this._numberField('Top P (nucleus sampling)', inf.top_p ?? 0.9, 0, 1, 0.05, v =>
        this._markDirty(brainFile, 'brain_config.inference_params.top_p', v)),
      this._numberField('Top K', inf.top_k ?? 40, 1, 200, 1, v =>
        this._markDirty(brainFile, 'brain_config.inference_params.top_k', v)),
      this._numberField('Repeat Penalty', inf.repeat_penalty ?? 1.1, 0.5, 2.0, 0.05, v =>
        this._markDirty(brainFile, 'brain_config.inference_params.repeat_penalty', v)),
      this._numberField('Max Tokens per Response', inf.max_tokens_per_response ?? 2048, 64, 8192, 64, v =>
        this._markDirty(brainFile, 'brain_config.inference_params.max_tokens_per_response', v)),
      this._textareaField('System Prompt', cfg.system_prompt || '', v =>
        this._markDirty(brainFile, 'brain_config.system_prompt', v))
    ]);

    // ===== PERSONALITY =====
    const per = brain.personality || {};
    const traits = per.traits || {};
    this._addSection(body, 'Personality', [
      this._sliderField('Curiosity', traits.curiosity ?? 0.7, v =>
        this._markDirty(brainFile, 'personality.traits.curiosity', v)),
      this._sliderField('Thoroughness', traits.thoroughness ?? 0.7, v =>
        this._markDirty(brainFile, 'personality.traits.thoroughness', v)),
      this._sliderField('Creativity', traits.creativity ?? 0.5, v =>
        this._markDirty(brainFile, 'personality.traits.creativity', v)),
      this._sliderField('Assertiveness', traits.assertiveness ?? 0.5, v =>
        this._markDirty(brainFile, 'personality.traits.assertiveness', v)),
      this._sliderField('Empathy', traits.empathy ?? 0.6, v =>
        this._markDirty(brainFile, 'personality.traits.empathy', v)),
      this._selectField('Communication Style', per.communication_style || 'professional',
        ['professional', 'casual', 'verbose', 'concise', 'playful', 'analytical'],
        v => this._markDirty(brainFile, 'personality.communication_style', v)),
      this._selectField('Default Mood', per.default_mood || 'neutral',
        ['neutral', 'happy', 'focused', 'serious', 'curious', 'enthusiastic'],
        v => this._markDirty(brainFile, 'personality.default_mood', v))
    ]);

    // ===== CAPABILITIES (skills) =====
    const cap = brain.capabilities || {};
    const skills = Object.keys(cap.skills || {});
    const allSkillOptions = [
      'frontend_dev', 'backend_dev', 'fullstack', 'data_analysis', 'code_review',
      'documentation', 'ui_design', 'devops', 'testing', 'security', 'database',
      'machine_learning', 'cloud', 'mobile', 'research', 'project_management'
    ];

    this._addSection(body, 'Skills', [
      this._multiSelectField('Skills', skills, allSkillOptions, vals =>
        this._markDirty(brainFile, 'capabilities.skills',
          Object.fromEntries(vals.map(s => [s, cap.skills?.[s] || { skill_level: 0.5, tasks_completed: 0 }]))
        ))
    ]);

    // ===== TOOLS GRID =====
    const allTools = Object.values(this.toolRegistry.tools || {});
    const allowedTools = cap.tools_allowed || [];
    this._addToolsGrid(body, allTools, allowedTools, brainFile);

    // ===== MEMORY =====
    const mem = brain.memory || {};
    this._addSection(body, 'Memory', [
      this._sliderField('Context Retention', mem.context_retention ?? 0.7, v =>
        this._markDirty(brainFile, 'memory.context_retention', v)),
      this._numberField('Long-term Memory Slots', mem.long_term_capacity ?? 100, 10, 1000, 10, v =>
        this._markDirty(brainFile, 'memory.long_term_capacity', v)),
      this._checkboxField('Remember Across Sessions', mem.persist_across_sessions ?? true, v =>
        this._markDirty(brainFile, 'memory.persist_across_sessions', v))
    ]);

    // ===== APPEARANCE (with pixel-art previews) =====
    this._addAppearanceSection(body, brain.appearance || {}, brainFile);

    // ===== LIFECYCLE / REPORTING =====
    const life = brain.lifecycle || {};
    this._addSection(body, 'Lifecycle', [
      this._selectField('Reports To', reg.reports_to || '(none)',
        ['(none)', 'poseidon', ...this._getOtherAgentIds()],
        v => this._markDirty('agents/agent_registry.json', `agents.${this.agentId}.reports_to`, v === '(none)' ? null : v)),
      this._numberField('Max Concurrent Tasks', life.max_concurrent_tasks ?? 1, 1, 10, 1, v =>
        this._markDirty(brainFile, 'lifecycle.max_concurrent_tasks', v)),
      this._selectField('Auto-sleep When Idle', life.auto_sleep || 'after_30min',
        ['never', 'after_5min', 'after_30min', 'after_2h'],
        v => this._markDirty(brainFile, 'lifecycle.auto_sleep', v))
    ]);

    this._updateSaveButton();
  },

  _getOtherAgentIds() {
    return Object.keys((this.registry && this.registry.parent_registry?.agents) || {});
  },

  // ===== APPEARANCE WITH PIXEL ART PREVIEWS =====

  _addAppearanceSection(parent, app, brainFile) {
    const acc = app.accessories || {};
    const section = document.createElement('div');
    section.className = 'agent-form-section';
    section.innerHTML = `<h3 class="agent-form-section-title">Appearance</h3>`;
    const body = document.createElement('div');
    body.className = 'agent-form-section-body';
    section.appendChild(body);

    // Color + size in one row
    const topRow = document.createElement('div');
    topRow.className = 'agent-form-row';
    topRow.innerHTML = `
      <label>Colors &amp; Size</label>
      <div class="agent-form-inline-fields">
        <span><span style="font-size:8px; color:var(--text-secondary)">Primary</span><br>
          <input type="color" id="af-app-primary" value="${this._escape(app.primary_color || '#FF6B9D')}"></span>
        <span><span style="font-size:8px; color:var(--text-secondary)">Accent</span><br>
          <input type="color" id="af-app-secondary" value="${this._escape(app.secondary_color || '#C44569')}"></span>
        <span><span style="font-size:8px; color:var(--text-secondary)">Size scale</span><br>
          <input type="number" id="af-app-size" min="0.5" max="2.0" step="0.1" value="${app.size_scale ?? 1.0}" style="width:60px;"></span>
      </div>
    `;
    body.appendChild(topRow);

    // Live preview canvas (drawn squid)
    const previewRow = document.createElement('div');
    previewRow.className = 'agent-form-row';
    previewRow.innerHTML = `
      <label>Live Preview</label>
      <canvas id="af-preview-canvas" width="180" height="180" class="af-preview-canvas"></canvas>
    `;
    body.appendChild(previewRow);

    // Accessory pickers - each with pixel art tiles
    const hatOpts = ['none', 'top_hat', 'cap', 'crown', 'beanie', 'pirate', 'wizard_hat', 'headphones'];
    const glassesOpts = ['none', 'round', 'sunglasses', 'monocle', 'vr'];
    const eyesOpts = ['round', 'happy', 'sleepy', 'angry', 'star', 'heart'];
    const outfitOpts = ['none', 'scarf', 'tie', 'cape', 'lab_coat', 'armor'];

    this._addAccessoryPicker(body, 'Hat', 'hat', hatOpts, acc.hat || 'none', brainFile);
    this._addAccessoryPicker(body, 'Glasses', 'glasses', glassesOpts, acc.glasses || 'none', brainFile);
    this._addAccessoryPicker(body, 'Eyes', 'eyes', eyesOpts, acc.eyes || 'round', brainFile);
    this._addAccessoryPicker(body, 'Outfit', 'outfit', outfitOpts, acc.outfit || 'none', brainFile);

    parent.appendChild(section);

    // Wire color/size inputs
    section.querySelector('#af-app-primary').addEventListener('input', e => {
      this._markDirty(brainFile, 'appearance.primary_color', e.target.value);
      this._updateAppearancePreview();
    });
    section.querySelector('#af-app-secondary').addEventListener('input', e => {
      this._markDirty(brainFile, 'appearance.secondary_color', e.target.value);
      this._updateAppearancePreview();
    });
    section.querySelector('#af-app-size').addEventListener('input', e => {
      this._markDirty(brainFile, 'appearance.size_scale', parseFloat(e.target.value));
      this._updateAppearancePreview();
    });

    // Initial draw
    setTimeout(() => this._updateAppearancePreview(), 50);
  },

  _addAccessoryPicker(parent, label, key, options, current, brainFile) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    row.innerHTML = `<label>${label}</label>`;
    const grid = document.createElement('div');
    grid.className = 'af-accessory-grid';
    options.forEach(opt => {
      const tile = document.createElement('div');
      tile.className = 'af-accessory-tile' + (opt === current ? ' selected' : '');
      tile.dataset.value = opt;
      tile.dataset.key = key;
      tile.title = opt;
      // Canvas with the accessory drawn
      const canvas = document.createElement('canvas');
      canvas.width = 48; canvas.height = 48;
      this._drawAccessoryPreview(canvas, key, opt);
      tile.appendChild(canvas);
      const tag = document.createElement('div');
      tag.className = 'af-accessory-tile-label';
      tag.textContent = opt === 'none' ? '-' : opt.replace(/_/g, ' ');
      tile.appendChild(tag);
      tile.addEventListener('click', () => {
        grid.querySelectorAll('.af-accessory-tile').forEach(t => t.classList.remove('selected'));
        tile.classList.add('selected');
        this._markDirty(brainFile, `appearance.accessories.${key}`, opt === 'none' ? null : opt);
        // Update brain in-place so preview reflects it
        if (!this.brain.appearance) this.brain.appearance = {};
        if (!this.brain.appearance.accessories) this.brain.appearance.accessories = {};
        this.brain.appearance.accessories[key] = opt === 'none' ? null : opt;
        this._updateAppearancePreview();
      });
      grid.appendChild(tile);
    });
    row.appendChild(grid);
    parent.appendChild(row);
  },

  _drawAccessoryPreview(canvas, key, value) {
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a2540';
    ctx.fillRect(0, 0, 48, 48);
    if (value === 'none' || !value) {
      ctx.fillStyle = '#3B4252';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('none', 24, 28);
      return;
    }
    if (typeof SquidAccessories === 'undefined') return;
    ctx.save();
    ctx.translate(24, 28);
    try {
      const size = 28;
      if (key === 'hat') SquidAccessories.drawHat(ctx, value, size);
      else if (key === 'glasses') SquidAccessories.drawGlasses(ctx, value, size);
      else if (key === 'eyes') {
        // Eyes need a faux face to look reasonable
        ctx.translate(0, 6);
        SquidAccessories.drawEyes(ctx, value, size);
      }
      else if (key === 'outfit') {
        ctx.translate(0, 8);
        SquidAccessories.drawOutfit(ctx, value, size);
      }
    } catch (e) {
      ctx.fillStyle = '#888';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', 0, 4);
    }
    ctx.restore();
  },

  _updateAppearancePreview() {
    const canvas = this.modal?.querySelector('#af-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a2540';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Build temporary squid-like object for drawing
    const app = this.brain.appearance || {};
    const acc = app.accessories || {};
    const sizeScale = app.size_scale ?? 1.0;
    const size = 36 * sizeScale;
    const primary = app.primary_color || '#FF6B9D';
    const accent = app.secondary_color || '#C44569';
    
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 + 5);
    
    // Body
    ctx.fillStyle = primary;
    ctx.fillRect(-size * 0.4, -size * 0.5, size * 0.8, size * 0.6);
    // Belly
    ctx.fillStyle = '#FFC4D6';
    ctx.fillRect(-size * 0.3, -size * 0.1, size * 0.6, size * 0.2);
    // Tentacles
    for (let i = -2; i <= 2; i++) {
      ctx.fillStyle = i % 2 === 0 ? primary : accent;
      ctx.fillRect(i * size * 0.18 - size * 0.05, size * 0.1, size * 0.12, size * 0.4);
    }
    // Eyes default
    ctx.fillStyle = 'white';
    ctx.fillRect(-size * 0.2, -size * 0.3, size * 0.15, size * 0.15);
    ctx.fillRect(size * 0.05, -size * 0.3, size * 0.15, size * 0.15);
    ctx.fillStyle = 'black';
    ctx.fillRect(-size * 0.15, -size * 0.27, size * 0.08, size * 0.08);
    ctx.fillRect(size * 0.1, -size * 0.27, size * 0.08, size * 0.08);
    
    // Apply accessories
    if (typeof SquidAccessories !== 'undefined') {
      try {
        if (acc.eyes && acc.eyes !== 'round') SquidAccessories.drawEyes(ctx, acc.eyes, size);
        if (acc.outfit && acc.outfit !== 'none') SquidAccessories.drawOutfit(ctx, acc.outfit, size);
        if (acc.hat && acc.hat !== 'none') SquidAccessories.drawHat(ctx, acc.hat, size);
        if (acc.glasses && acc.glasses !== 'none') SquidAccessories.drawGlasses(ctx, acc.glasses, size);
      } catch {}
    }
    
    ctx.restore();
  },

  // ===== TOOLS GRID =====

  _addToolsGrid(parent, allTools, allowedTools, brainFile) {
    const section = document.createElement('div');
    section.className = 'agent-form-section';
    section.innerHTML = `<h3 class="agent-form-section-title">Tools (${allTools.length} available)</h3>`;
    
    if (allTools.length === 0) {
      section.innerHTML += '<p class="hint" style="font-size:9px;">No tools in registry. Restart server to sync built-in tools.</p>';
      parent.appendChild(section);
      return;
    }
    
    const desc = document.createElement('p');
    desc.className = 'hint';
    desc.style.cssText = 'font-size:9px; color:var(--text-secondary); margin:0 0 8px 0;';
    desc.textContent = `Click tools to allow this agent to use them. Hover for description.`;
    section.appendChild(desc);
    
    // Group by category
    const byCategory = {};
    allTools.forEach(t => {
      const cat = t.category || 'general';
      (byCategory[cat] = byCategory[cat] || []).push(t);
    });
    
    const allowedSet = new Set(allowedTools);
    
    Object.entries(byCategory).sort().forEach(([cat, tools]) => {
      const catHeader = document.createElement('div');
      catHeader.className = 'af-tools-cat-header';
      catHeader.textContent = cat;
      section.appendChild(catHeader);
      
      const grid = document.createElement('div');
      grid.className = 'af-tools-grid';
      tools.forEach(tool => {
        const tile = document.createElement('div');
        tile.className = 'af-tool-tile' + (allowedSet.has(tool.name) ? ' selected' : '');
        tile.dataset.tool = tool.name;
        // Tooltip with description
        const desc = tool.description || '(no description)';
        const params = tool.parameters ? Object.keys(tool.parameters).join(', ') : '';
        tile.title = `${tool.name}\n\n${desc}${params ? '\n\nParams: ' + params : ''}\nType: ${tool.type || 'local_function'}`;
        // Icon based on category
        const iconMap = {
          filesystem: 'FS', network: 'NET', code: 'CODE', shell: 'SH',
          data: 'DAT', search: 'SCH', system: 'SYS', general: '*', custom: '*'
        };
        const icon = iconMap[cat] || '*';
        tile.innerHTML = `
          <div class="af-tool-icon">${icon}</div>
          <div class="af-tool-name">${this._escape(tool.name)}</div>
        `;
        tile.addEventListener('click', () => {
          tile.classList.toggle('selected');
          // Recompute current selected set
          const newAllowed = Array.from(section.querySelectorAll('.af-tool-tile.selected'))
            .map(t => t.dataset.tool);
          this._markDirty(brainFile, 'capabilities.tools_allowed', newAllowed);
        });
        grid.appendChild(tile);
      });
      section.appendChild(grid);
    });
    
    parent.appendChild(section);
  },

  // ===== FIELD BUILDERS =====

  _addSection(parent, title, fields) {
    const section = document.createElement('div');
    section.className = 'agent-form-section';
    section.innerHTML = `<h3 class="agent-form-section-title">${this._escape(title)}</h3>`;
    const body = document.createElement('div');
    body.className = 'agent-form-section-body';
    fields.forEach(f => body.appendChild(f));
    section.appendChild(body);
    parent.appendChild(section);
  },

  _infoNote(text) {
    const div = document.createElement('div');
    div.className = 'agent-form-row';
    div.innerHTML = `<label>&nbsp;</label><span class="hint" style="font-size:9px; color:var(--accent); font-style:italic;">${this._escape(text)}</span>`;
    return div;
  },

  _textField(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    row.innerHTML = `<label>${this._escape(label)}</label><input type="text" value="${this._escape(value || '')}">`;
    row.querySelector('input').addEventListener('input', e => onChange(e.target.value));
    return row;
  },

  _textareaField(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    row.innerHTML = `<label>${this._escape(label)}</label><textarea rows="3">${this._escape(value || '')}</textarea>`;
    row.querySelector('textarea').addEventListener('input', e => onChange(e.target.value));
    return row;
  },

  _numberField(label, value, min, max, step, onChange) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    row.innerHTML = `<label>${this._escape(label)}</label><input type="number" min="${min}" max="${max}" step="${step}" value="${value}">`;
    row.querySelector('input').addEventListener('input', e => onChange(parseFloat(e.target.value)));
    return row;
  },

  _sliderField(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    row.innerHTML = `
      <label>${this._escape(label)}</label>
      <div class="agent-form-slider-wrap">
        <input type="range" min="0" max="1" step="0.05" value="${value}">
        <span class="agent-form-slider-val">${(value * 100).toFixed(0)}%</span>
      </div>
    `;
    const range = row.querySelector('input');
    const valEl = row.querySelector('.agent-form-slider-val');
    range.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      valEl.textContent = (v * 100).toFixed(0) + '%';
      onChange(v);
    });
    return row;
  },

  _selectField(label, current, options, onChange, labelMap = null) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    const opts = options.map(o => `<option value="${this._escape(o)}" ${o === current ? 'selected' : ''}>${this._escape(labelMap?.[o] || o)}</option>`).join('');
    row.innerHTML = `<label>${this._escape(label)}</label><select>${opts}</select>`;
    row.querySelector('select').addEventListener('change', e => onChange(e.target.value));
    return row;
  },

  _checkboxField(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    row.innerHTML = `<label>${this._escape(label)}</label>
      <label class="agent-form-checkbox" style="flex:0 0 auto;">
        <input type="checkbox" ${value ? 'checked' : ''}>
        <span>${value ? 'Enabled' : 'Disabled'}</span>
      </label>`;
    const cb = row.querySelector('input[type=checkbox]');
    const span = row.querySelector('span');
    cb.addEventListener('change', e => {
      span.textContent = e.target.checked ? 'Enabled' : 'Disabled';
      onChange(e.target.checked);
    });
    return row;
  },

  _multiSelectField(label, current, options, onChange, labelMap = {}) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    const set = new Set(current);
    row.innerHTML = `<label>${this._escape(label)}</label>
      <div class="agent-form-multi">${options.map(o => `
        <label class="agent-form-multi-item">
          <input type="checkbox" value="${this._escape(o)}" ${set.has(o) ? 'checked' : ''}>
          <span>${this._escape(labelMap[o] || o)}</span>
        </label>
      `).join('')}</div>`;
    row.querySelectorAll('input[type=checkbox]').forEach(cb => {
      cb.addEventListener('change', () => {
        const vals = Array.from(row.querySelectorAll('input[type=checkbox]:checked')).map(c => c.value);
        onChange(vals);
      });
    });
    return row;
  },

  // ===== DIRTY TRACKING + SAVE =====

  _markDirty(filePath, fieldPath, newValue) {
    if (this.isCreating) {
      // In create mode: don't send PATCHes (agent doesn't exist yet).
      // Just stage values on our in-memory brain/registry so save() can POST them.
      this._stageValue(filePath, fieldPath, newValue);
    }
    const key = `${filePath}::${fieldPath}`;
    this.dirty.set(key, { filePath, fieldPath, newValue });
    this._updateSaveButton();
  },
  
  _stageValue(filePath, fieldPath, newValue) {
    // Walk the path on the appropriate object
    let target;
    if (filePath === 'agents/agent_registry.json') {
      target = this.registry;
      // Path like "agents.null.display_name" - strip the agents.X prefix
      const parts = fieldPath.split('.');
      if (parts[0] === 'agents') {
        // skip 'agents.<id>'
        return this._setNested(this.registry, parts.slice(2), newValue);
      }
      return this._setNested(this.registry, parts, newValue);
    } else {
      // Brain file
      return this._setNested(this.brain, fieldPath.split('.'), newValue);
    }
  },
  
  _setNested(obj, path, value) {
    if (path.length === 0) return;
    let cur = obj;
    for (let i = 0; i < path.length - 1; i++) {
      if (!cur[path[i]] || typeof cur[path[i]] !== 'object') cur[path[i]] = {};
      cur = cur[path[i]];
    }
    cur[path[path.length - 1]] = value;
  },

  _updateSaveButton() {
    const btn = this.modal?.querySelector('.agent-form-save');
    if (!btn) return;
    const count = this.dirty.size;
    if (this.isCreating) {
      btn.disabled = false;  // always allow create (use defaults if nothing changed)
      btn.textContent = `Hatch Squid${count > 0 ? ` (${count} customized)` : ''}`;
    } else {
      btn.disabled = count === 0;
      btn.textContent = count === 0 ? 'Save (0)' : `Save (${count})`;
    }
  },

  async save() {
    if (this.isCreating) {
      return await this._createAgent();
    }
    return await this._updateAgent();
  },
  
  async _createAgent() {
    const status = this.modal.querySelector('.agent-form-status');
    const btn = this.modal.querySelector('.agent-form-save');
    btn.disabled = true;
    status.textContent = 'Creating...';
    
    try {
      // POST to V2 agents endpoint - registers in agent_registry + writes squid_brain_NNN.json
      const result = await window.ApiV2._fetch('/agents', {
        method: 'POST',
        body: JSON.stringify({
          display_name: this.registry.display_name || 'New Squid',
          specialization: this.registry.specialization || 'general',
          status: this.registry.status || 'sleeping',
          brain: this.brain
        })
      });
      
      status.textContent = `Created ${result.agent?.agent_id || 'agent'}`;
      status.className = 'agent-form-status success';
      
      // Reload squids on canvas
      if (window.aquarium?.loadSquids) {
        await window.aquarium.loadSquids();
      }
      
      this.dirty.clear();
      setTimeout(() => this.close(), 800);
    } catch (err) {
      status.textContent = 'Create failed: ' + err.message;
      status.className = 'agent-form-status error';
      btn.disabled = false;
    }
  },
  
  async _updateAgent() {
    const status = this.modal.querySelector('.agent-form-status');
    const btn = this.modal.querySelector('.agent-form-save');
    btn.disabled = true;
    status.textContent = 'Saving...';
    let failed = 0;
    for (const { filePath, fieldPath, newValue } of this.dirty.values()) {
      try {
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({ filePath, fieldPath, newValue, reason: 'AgentForm edit' })
        });
      } catch (err) {
        console.warn('PATCH failed:', filePath, fieldPath, err);
        failed++;
      }
    }
    if (failed > 0) {
      status.textContent = `${this.dirty.size - failed} saved, ${failed} failed`;
      status.className = 'agent-form-status error';
    } else {
      status.textContent = `Saved ${this.dirty.size} changes`;
      status.className = 'agent-form-status success';
    }
    this.dirty.clear();
    this._updateSaveButton();
    // Reload squids on canvas so changes apply visually
    if (window.aquarium?.loadSquids) {
      setTimeout(() => window.aquarium.loadSquids(), 400);
    }
  },

  close() {
    if (this.modal) this.modal.classList.add('hidden');
  },

  _escape(s) {
    if (s == null) return '';
    return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
  }
};

window.AgentForm = AgentForm;
console.log('[OK] AgentForm v2 loaded');
