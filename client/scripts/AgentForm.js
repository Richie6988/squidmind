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
        window.api.agents.get(agentId),
        window.api.tools.list(),
        window.api.models.list()
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
      display_name: 'New Agent',
      specialization: 'general',
      status: 'sleeping'
    };
    this.brain = this._defaultBrainTemplate();
    this.registry = {
      display_name: 'New Agent',
      specialization: 'general',
      status: 'sleeping',
      brain_file: '__pending__',  // server assigns real file name
      reports_to: null
    };
    
    try {
      const [toolsRes, modelsRes] = await Promise.all([
        window.api.tools.list(),
        window.api.models.list()
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
          <button class="btn-secondary agent-form-delete" onclick="AgentForm.deleteAgent()" style="display:none; background:rgba(230,57,70,0.15); border-color:var(--danger); color:var(--danger);">Delete</button>
          <button class="btn-secondary agent-form-duplicate" onclick="AgentForm.duplicateAgent()" style="display:none;">Duplicate</button>
          <span class="agent-form-status"></span>
          <button class="btn-secondary" onclick="AgentForm.close()" title="Discard changes and close (Esc)">Cancel</button>
          <button class="btn-primary agent-form-save" onclick="AgentForm.save()" disabled>Save (0)</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
  },

  _render() {
    const title = this.modal.querySelector('.agent-form-title');
    title.textContent = this.isCreating
      ? 'Create New Agent'
      : `Edit Agent: ${this.registry.display_name || this.agentId}`;
    
    // Update save button text too
    const saveBtn = this.modal.querySelector('.agent-form-save');
    if (saveBtn) {
      saveBtn.dataset.mode = this.isCreating ? 'create' : 'edit';
    }
    
    // Show/hide delete + duplicate based on mode
    const deleteBtn = this.modal.querySelector('.agent-form-delete');
    const duplicateBtn = this.modal.querySelector('.agent-form-duplicate');
    if (deleteBtn) deleteBtn.style.display = this.isCreating ? 'none' : 'inline-block';
    if (duplicateBtn) duplicateBtn.style.display = this.isCreating ? 'none' : 'inline-block';

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
    // Personality + skills ARE now injected into the agent's system prompt at runtime
    const _infoEl = document.createElement('div');
    _infoEl.style.cssText = 'background:rgba(6,255,165,0.07);border:1px solid rgba(6,255,165,0.25);border-radius:4px;padding:8px 12px;margin:0 0 12px 0;font-size:10px;color:#06ffa5;line-height:1.5;';
    _infoEl.innerHTML = '✅ <b>Live:</b> Personality traits, communication style, and skills are injected into this agent\u2019s system prompt when it runs a task via <code style="background:rgba(0,0,0,0.3);padding:1px 4px;border-radius:2px;">dispatch_to_agent</code>. Changes here take effect on the next task run.';
    body.appendChild(_infoEl);
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
      <canvas id="af-preview-canvas" width="200" height="200" class="af-preview-canvas"></canvas>
    `;
    body.appendChild(previewRow);

    // Accessory pickers - each with pixel art tiles
    const hatOpts     = ['none', 'top_hat', 'cap', 'crown', 'beanie', 'pirate', 'wizard_hat', 'headphones', 'beret', 'halo', 'antenna', 'devil_horns', 'ninja_mask', 'sombrero'];
    const glassesOpts = ['none', 'round', 'sunglasses', 'monocle', 'vr', 'pixel_glasses', '3d_glasses', 'eyepatch'];
    const eyesOpts    = ['round', 'happy', 'sleepy', 'angry', 'star', 'heart', 'dizzy', 'wink', 'surprised', 'laser'];
    const outfitOpts  = ['none', 'scarf', 'tie', 'cape', 'lab_coat', 'armor', 'hoodie', 'kimono', 'cloak'];

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
      canvas.width = 80; canvas.height = 80;
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

  _drawAccessoryPreview(canvas, key, opt) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const bg = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W/1.5);
    bg.addColorStop(0, '#0d2340'); bg.addColorStop(1, '#020810');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    if (!opt || opt === 'none') {
      ctx.fillStyle = '#334155'; ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('–', W/2, H/2);
      return;
    }

    const SA = window.SquidAccessories;
    if (!SA) return;

    // Inventory-style: draw ONLY the item, centred in the tile. Each accessory
    // drawer has its own internal translate relative to a "squid origin" — we
    // counter-translate so the item lands at the tile centre regardless.
    // (Hat is drawn at -size*0.87 from origin; outfit at +size*1.5 etc.)
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();

    try {
      if (key === 'hat') {
        // Hat: drawer translates to (0, -size*0.87). Move squid origin DOWN
        // by that much so the hat lands at canvas centre.
        const size = W * 0.62;
        ctx.translate(W/2, H/2 + size * 0.87);
        SA.drawHat(ctx, opt, size);
      } else if (key === 'glasses') {
        // Glasses sit on the eye line (y=0 in drawer space) — centre directly.
        const size = W * 0.85;
        ctx.translate(W/2, H/2);
        SA.drawGlasses(ctx, opt, size);
      } else if (key === 'eyes') {
        // 'round' is a no-op in drawEyes (it's the squid's default rendering).
        // The picker still needs a visible tile, so call the dedicated helper.
        const size = W * 0.85;
        ctx.translate(W/2, H/2);
        if (opt === 'round' && typeof SA.drawRoundEyes === 'function') {
          SA.drawRoundEyes(ctx, size);
        } else {
          SA.drawEyes(ctx, opt, size);
        }
      } else if (key === 'outfit') {
        // Outfit = 6 shoes placed at tentacle tips. Drawing them all radially
        // would shrink each to a few pixels. Instead, sample the bottom-most
        // shoe (tentacle facing down = i=0 in the loop after PI/2 offset) by
        // calling the internal drawer directly when available, else fall back
        // to drawing the radial group at large size with the canvas centred
        // on the tentacle ring.
        const size = W * 0.55;
        const TENTACLES = 6;
        // Pick the bottom tentacle (i = TENTACLES/2 ≈ 3 → angle = π → pointing down)
        // and render a single shoe enlarged for clarity.
        const map = {
          'scarf':    '_shoeSneaker',
          'tie':      '_shoeLoafer',
          'cape':     '_shoeBoots',
          'lab_coat': '_shoeLabShoe',
          'armor':    '_shoeArmorBoot',
          'hoodie':   '_shoeHoodie',
          'kimono':   '_shoeKimono',
          'cloak':    '_shoeCloak',
        };
        const fn = map[opt] && SA[map[opt]];
        ctx.translate(W/2, H/2);
        if (typeof fn === 'function') {
          // Single enlarged shoe in the centre of the tile.
          fn.call(SA, ctx, size, 0);
        } else {
          // Unknown outfit name — fall back to the radial group, scaled small.
          SA.drawOutfit(ctx, opt, size * 0.45, 0);
        }
      }
    } catch (e) {
      console.warn('[tile preview]', key, opt, e.message);
    }
    ctx.restore();
  },
  _updateAppearancePreview() {
    const canvas = this.modal?.querySelector('#af-preview-canvas');
    if (!canvas || typeof Squid === 'undefined') return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background: same gradient as the aquarium scene
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a1628'); bg.addColorStop(1, '#020810');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Faint grid (matches aquarium overlay)
    ctx.strokeStyle = 'rgba(79,172,254,0.04)'; ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 16) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 16) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const app = this.brain?.appearance || {};
    try {
      // Same Squid construction the aquarium uses — appearance + accessories
      // straight from the brain, default aquarium baseSize (1.0). Output
      // visually identical to what the user will see once the agent loads.
      const sq = new Squid({
        id: '__preview__',
        name: this.brain?.identity?.display_name || this.brain?.display_name || 'Agent',
        appearance: { ...app, size: 'medium' },
        accessories: app.accessories || null,
        status: 'idle',
        x: W/2, y: H * 0.42,    // sit slightly above centre so nametag (drawn 35px below body) fits
      });
      // Freeze animation state so the preview is a still frame
      sq.animFrame = 0; sq.bobOffset = 0; sq.glowPulse = 0;
      sq.isSleeping = false; sq.isHovered = false; sq.alpha = 1;
      sq.insideTemple = null; sq.jumpHeight = 0; sq.heartParticles = []; sq.isDragging = false;
      // Use aquarium default baseSize so the preview matches in-canvas exactly
      sq.baseSize = 1.0;

      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
      sq.draw(ctx);
      ctx.restore();
    } catch (e) {
      console.warn('[preview]', e.message);
    }
  },
  _addToolsGrid(parent, allTools, allowedTools, brainFile) {
    const section = document.createElement('div');
    section.className = 'agent-form-section';

    const enabledCount = allowedTools.filter(t => allTools.find(a => a.name === t)).length;
    section.innerHTML = `<h3 class="agent-form-section-title" style="display:flex;align-items:center;gap:6px;">${window.PixelIcons?.inline('tools',13)||''} Tools <span style="font-weight:400;color:var(--text-secondary);font-size:10px;">(${enabledCount} enabled / ${allTools.length} available)</span></h3>`;

    if (allTools.length === 0) {
      section.innerHTML += '<p class="hint" style="font-size:10px;color:var(--text-secondary);">No tools in registry. Restart server to sync built-in tools.</p>';
      parent.appendChild(section);
      return;
    }

    // Header bar with select-all / clear
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';
    bar.innerHTML = `
      <span style="font-size:10px;color:var(--text-secondary);flex:1;">Click a tool to enable/disable it. Hover for details.</span>
      <button class="btn-secondary" style="font-size:9px;padding:2px 8px;" id="af-tools-all">Enable all</button>
      <button class="btn-secondary" style="font-size:9px;padding:2px 8px;" id="af-tools-none">Clear all</button>
    `;
    section.appendChild(bar);

    // Category icons & colors
    const PI = window.PixelIcons;
    const catMeta = {
      ai:                  { icon: PI?.inline('brain',13)||'◉',       color: '#7c3aed' },
      code:                { icon: PI?.inline('code_model',13)||'<>', color: '#0ea5e9' },
      custom:              { icon: PI?.inline('bolt',13)||'⚡',        color: '#f59e0b' },
      filesystem:          { icon: PI?.inline('data',13)||'◈',        color: '#10b981' },
      information_retrieval:{ icon: PI?.inline('logs',13)||'◈',       color: '#06b6d4' },
      network:             { icon: PI?.inline('ocean',13)||'~',        color: '#3b82f6' },
      shell:               { icon: PI?.inline('system',13)||'>_',      color: '#6b7280' },
      version_control:     { icon: PI?.inline('create',13)||'⊕',      color: '#f97316' },
      data:                { icon: PI?.inline('stats',13)||'◈',        color: '#ec4899' },
      system:              { icon: PI?.inline('cpu',13)||'◈',          color: '#94a3b8' },
      general:             { icon: PI?.inline('target',13)||'◈',       color: '#64748b' },
    };

    // Group by category
    const byCategory = {};
    allTools.forEach(t => {
      const cat = t.category || 'general';
      (byCategory[cat] = byCategory[cat] || []).push(t);
    });

    const allowedSet = new Set(allowedTools);

    const recount = () => {
      const n = section.querySelectorAll('.af-tool-row.enabled').length;
      const h = section.querySelector('h3');
      if (h) h.innerHTML = `${window.PixelIcons?.inline('tools',13)||''} Tools <span style="font-weight:400;color:var(--text-secondary);font-size:10px;">(${n} enabled / ${allTools.length} available)</span>`;
    };

    const saveAllowed = () => {
      const newAllowed = [...section.querySelectorAll('.af-tool-row.enabled')].map(r => r.dataset.tool);
      this._markDirty(brainFile, 'capabilities.tools_allowed', newAllowed);
      recount();
    };

    Object.entries(byCategory).sort().forEach(([cat, tools]) => {
      const meta = catMeta[cat] || { icon: window.PixelIcons?.inline('tools',13)||'⚙', color: '#64748b' };

      const catWrap = document.createElement('div');
      catWrap.style.cssText = 'margin-bottom:14px;';

      const catLabel = document.createElement('div');
      catLabel.style.cssText = `display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:4px 8px;
        border-left:3px solid ${meta.color};background:rgba(255,255,255,0.03);border-radius:0 4px 4px 0;`;
      const enabledInCat = tools.filter(t => allowedSet.has(t.name)).length;
      catLabel.innerHTML = `
        <span style="display:inline-flex;align-items:center;">${meta.icon}</span>
        <span style="font-size:11px;font-weight:600;color:#e2e8f0;text-transform:capitalize;">${cat.replace(/_/g,' ')}</span>
        <span style="font-size:9px;color:var(--text-secondary);margin-left:auto;">${enabledInCat}/${tools.length}</span>
      `;
      catWrap.appendChild(catLabel);

      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

      tools.forEach(tool => {
        const row = document.createElement('div');
        row.className = 'af-tool-row' + (allowedSet.has(tool.name) ? ' enabled' : '');
        row.dataset.tool = tool.name;
        const desc = (tool.description || '').slice(0, 90);
        const paramCount = tool.parameters ? Object.keys(tool.parameters).length : 0;
        row.innerHTML = `
          <div class="af-tool-row-left">
            <div class="af-tool-toggle"></div>
            <div>
              <div class="af-tool-row-name">${this._escape(tool.name)}</div>
              <div class="af-tool-row-desc">${this._escape(desc)}${desc.length >= 90 ? '…' : ''}</div>
            </div>
          </div>
          <div class="af-tool-row-meta">
            ${paramCount ? `<span class="af-tool-badge">${paramCount} param${paramCount>1?'s':''}</span>` : ''}
            <span class="af-tool-badge">${tool.type || 'fn'}</span>
          </div>
        `;
        row.addEventListener('click', () => {
          row.classList.toggle('enabled');
          allowedSet[row.classList.contains('enabled') ? 'add' : 'delete'](tool.name);
          // update cat counter
          const enabled = list.querySelectorAll('.af-tool-row.enabled').length;
          catLabel.querySelector('span:last-child').textContent = `${enabled}/${tools.length}`;
          saveAllowed();
        });
        list.appendChild(row);
      });

      catWrap.appendChild(list);
      section.appendChild(catWrap);
    });

    // Select all / clear all handlers
    bar.querySelector('#af-tools-all').addEventListener('click', () => {
      section.querySelectorAll('.af-tool-row').forEach(r => { r.classList.add('enabled'); allowedSet.add(r.dataset.tool); });
      saveAllowed();
    });
    bar.querySelector('#af-tools-none').addEventListener('click', () => {
      section.querySelectorAll('.af-tool-row').forEach(r => { r.classList.remove('enabled'); allowedSet.delete(r.dataset.tool); });
      saveAllowed();
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
      const result = await window.api._fetch('/agents', {
        method: 'POST',
        body: JSON.stringify({
          display_name: this.registry.display_name || 'New Agent',
          specialization: this.registry.specialization || 'general',
          status: this.registry.status || 'sleeping',
          brain: this.brain
        })
      });
      
      status.textContent = `Created ${result.agent?.agent_id || 'agent'}`;
      status.className = 'agent-form-status success';

      // Reload squids from registry — this handles positioning and avoids
      // duplicates (don't call addSquid directly, it bypasses deduplication)
      if (window.aquarium?.loadSquids) {
        setTimeout(() => window.aquarium.loadSquids(), 100);
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
        await window.api._fetch('/field', {
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

  async deleteAgent() {
    if (!this.agentId || this.isCreating) return;
    const name  = this.registry.display_name || this.agentId;
    const aid   = this.agentId;

    if (!window.UndoManager) {
      if (!confirm(`Delete ${name}?\nThis removes the registry entry AND the brain file.`)) return;
      try {
        await window.api._fetch(`/agents/${aid}`, { method: 'DELETE' });
        if (window.aquarium?.loadSquids) await window.aquarium.loadSquids();
        this.close();
      } catch (err) {
        const status = this.modal.querySelector('.agent-form-status');
        status.textContent = 'Delete failed: ' + err.message;
        status.className = 'agent-form-status error';
      }
      return;
    }

    // Optimistic: close modal immediately and hide squid from canvas
    this.close();
    if (window.aquarium?.hideSquid) window.aquarium.hideSquid(aid);
    else if (window.aquarium?.loadSquids) await window.aquarium.loadSquids();

    window.UndoManager.scheduleDelete({
      label: 'Agent "' + name + '"',
      delay: 8000,  // longer than tasks — agents are more destructive
      onCommit: async () => {
        try {
          await window.api._fetch(`/agents/${aid}`, { method: 'DELETE' });
          if (window.aquarium?.loadSquids) await window.aquarium.loadSquids();
        } catch (e) {
          if (window.aquarium?.loadSquids) await window.aquarium.loadSquids();
          throw e;
        }
      },
      onCancel: async () => {
        // Restore by reloading the canvas (registry untouched)
        if (window.aquarium?.loadSquids) await window.aquarium.loadSquids();
      },
    });
  },
  
  async duplicateAgent() {
    if (!this.agentId || this.isCreating) return;
    
    const status = this.modal.querySelector('.agent-form-status');
    status.textContent = 'Duplicating...';
    try {
      // Build a clone of the current brain (server will assign new IDs)
      const clone = JSON.parse(JSON.stringify(this.brain));
      // Reset stateful fields
      if (clone.current_state) clone.current_state = { status: 'sleeping', current_task_id: null, last_action_at: null };
      if (clone.assignments) clone.assignments = { projects: [], active_tasks: [], task_queue: [] };
      if (clone.inbox) clone.inbox = { messages: [], unread_count: 0 };
      if (clone.history) clone.history = { completed_tasks_log: [], wake_sleep_events: [] };
      if (clone.performance) clone.performance = { lifetime: {}, last_30_days: {}, by_skill: {} };
      
      const result = await window.api._fetch('/agents', {
        method: 'POST',
        body: JSON.stringify({
          display_name: (this.registry.display_name || 'Squid') + ' (copy)',
          specialization: this.registry.specialization || 'general',
          status: 'sleeping',
          brain: clone,
          cloned_from: this.agentId
        })
      });
      
      status.textContent = `Cloned as ${result.agent?.agent_id || 'new agent'}`;
      status.className = 'agent-form-status success';
      
      if (window.aquarium?.loadSquids) await window.aquarium.loadSquids();
      
      setTimeout(() => this.close(), 600);
    } catch (err) {
      status.textContent = 'Duplicate failed: ' + err.message;
      status.className = 'agent-form-status error';
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
