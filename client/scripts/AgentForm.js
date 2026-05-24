/**
 * AgentForm - User-friendly form for editing agents
 * 
 * NO JSON visible. Just text inputs, dropdowns, checkboxes.
 * Behind the scenes: builds a list of changes, sends as PATCH requests to V2 API.
 * Every change logged automatically by backend.
 */

const AgentForm = {
  modal: null,
  agentId: null,
  brain: null,        // squid_brain_NNN.json content
  registry: null,     // agent_registry.json content
  toolRegistry: null, // tool_registry.json content
  modelRegistry: null,// model_registry.json content
  dirty: new Map(),   // fieldPath -> { file, newValue }

  /**
   * Open form for editing an agent
   */
  async open(agentId) {
    this.agentId = agentId;
    this.dirty = new Map();
    
    try {
      // Load everything in parallel
      const [agentRes, toolsRes, modelsRes] = await Promise.all([
        window.ApiV2.agents.get(agentId),
        window.ApiV2.tools.list(),
        window.ApiV2.models.list()
      ]);
      this.brain = agentRes.agent.brain;
      this.registry = agentRes.agent.registry_entry;
      this.toolRegistry = toolsRes.registry;
      this.modelRegistry = modelsRes.registry;
    } catch (err) {
      alert('Failed to load agent: ' + err.message);
      return;
    }
    
    this._buildModal();
    this._render();
  },

  _buildModal() {
    if (this.modal) {
      this.modal.classList.remove('hidden');
      return;
    }
    this.modal = document.createElement('div');
    this.modal.className = 'modal agent-form-modal';
    this.modal.innerHTML = `
      <div class="modal-content agent-form-content">
        <div class="modal-header agent-form-header">
          <h2 class="agent-form-title">Edit Agent</h2>
          <button class="btn-close" onclick="AgentForm.close()">x</button>
        </div>
        <div class="modal-body agent-form-body"></div>
        <div class="agent-form-footer">
          <span class="agent-form-status"></span>
          <button class="btn-secondary" onclick="AgentForm.close()">Cancel</button>
          <button class="btn-primary agent-form-save" onclick="AgentForm.save()" disabled>Save Changes (0)</button>
        </div>
      </div>
    `;
    document.body.appendChild(this.modal);
  },

  _render() {
    const title = this.modal.querySelector('.agent-form-title');
    title.textContent = `Edit Agent: ${this.registry.display_name}`;
    
    const body = this.modal.querySelector('.agent-form-body');
    body.innerHTML = '';
    
    // ===== IDENTITY SECTION =====
    this._addSection(body, 'Identity', [
      this._textField('Display Name', this.registry.display_name, val =>
        this._markDirty('agents/agent_registry.json', `agents.${this.agentId}.display_name`, val)
      ),
      this._textField('Role', this.brain.identity.role, val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'identity.role', val)
      ),
      this._selectField('Specialization', this.registry.specialization || 'general', [
        'general', 'frontend_specialist', 'backend_specialist', 'fullstack_dev',
        'data_analyst', 'devops', 'qa_tester', 'designer', 'researcher'
      ], val =>
        this._markDirty('agents/agent_registry.json', `agents.${this.agentId}.specialization`, val)
      ),
      this._selectField('Status', this.registry.status, [
        'sleeping', 'active', 'thinking', 'blocked', 'archived'
      ], val =>
        this._markDirty('agents/agent_registry.json', `agents.${this.agentId}.status`, val)
      )
    ]);
    
    // ===== BRAIN CONFIG =====
    const cfg = this.brain.brain_config || {};
    const inf = cfg.inference_params || {};
    const modelOptions = ['(none)', ...Object.keys(this.modelRegistry.models || {})];
    
    this._addSection(body, 'Brain Configuration', [
      this._selectField('Preferred Model', cfg.model_binding?.preferred_model_id || '(none)', modelOptions, val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'brain_config.model_binding.preferred_model_id', val === '(none)' ? null : val)
      ),
      this._numberField('Temperature', inf.temperature ?? 0.7, 0, 2, 0.1, val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'brain_config.inference_params.temperature', val)
      ),
      this._numberField('Top P', inf.top_p ?? 0.9, 0, 1, 0.05, val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'brain_config.inference_params.top_p', val)
      ),
      this._numberField('Max Tokens per Response', inf.max_tokens_per_response ?? 2048, 64, 8192, 64, val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'brain_config.inference_params.max_tokens_per_response', val)
      ),
      this._textareaField('System Prompt', cfg.system_prompt || '', val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'brain_config.system_prompt', val)
      )
    ]);
    
    // ===== CAPABILITIES =====
    const skills = Object.keys(this.brain.capabilities?.skills || {});
    const allTools = Object.values(this.toolRegistry.tools || {}).map(t => ({
      id: t.tool_id,
      name: t.name,
      type: t.type,
      label: `${t.name} (${t.type})`
    }));
    const allowedTools = this.brain.capabilities?.tools_allowed || [];
    const allSkillOptions = [
      'frontend_dev', 'backend_dev', 'fullstack', 'data_analysis',
      'code_review', 'documentation', 'ui_design', 'devops',
      'testing', 'security', 'database', 'machine_learning'
    ];
    
    this._addSection(body, 'Capabilities', [
      this._multiSelectField('Skills (specialities)', skills, allSkillOptions, vals =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'capabilities.skills',
          Object.fromEntries(vals.map(s => [s, this.brain.capabilities?.skills?.[s] || { skill_level: 0.5, tasks_completed: 0 }]))
        )
      ),
      this._multiSelectField('Tools Allowed', allowedTools, allTools.map(t => t.name), vals =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'capabilities.tools_allowed', vals),
        allTools.reduce((acc, t) => ({ ...acc, [t.name]: t.label }), {})
      )
    ]);
    
    // ===== APPEARANCE =====
    const app = this.brain.appearance || {};
    const acc = app.accessories || {};
    this._addSection(body, 'Appearance', [
      this._colorField('Primary Color', app.primary_color || '#FF6B9D', val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'appearance.primary_color', val)
      ),
      this._colorField('Secondary Color', app.secondary_color || '#C44569', val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'appearance.secondary_color', val)
      ),
      this._numberField('Size Scale', app.size_scale ?? 1.0, 0.5, 2.0, 0.1, val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'appearance.size_scale', val)
      ),
      this._selectField('Hat', acc.hat || 'none', ['none', 'top_hat', 'cap', 'crown', 'beanie', 'pirate'], val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'appearance.accessories.hat', val)
      ),
      this._selectField('Glasses', acc.glasses || 'none', ['none', 'round', 'sunglasses', 'monocle', 'vr'], val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'appearance.accessories.glasses', val)
      ),
      this._selectField('Eyes', acc.eyes || 'round', ['round', 'happy', 'sleepy', 'angry', 'star', 'heart'], val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'appearance.accessories.eyes', val)
      ),
      this._selectField('Outfit', acc.outfit || 'none', ['none', 'scarf', 'tie', 'cape', 'lab_coat', 'armor'], val =>
        this._markDirty(`agents/${this.registry.brain_file}`, 'appearance.accessories.outfit', val)
      )
    ]);
    
    this._updateSaveButton();
  },

  // ===== FIELD BUILDERS =====

  _addSection(parent, title, fields) {
    const section = document.createElement('div');
    section.className = 'agent-form-section';
    section.innerHTML = `<h3>${title}</h3>`;
    for (const f of fields) section.appendChild(f);
    parent.appendChild(section);
  },

  _row(label, input) {
    const row = document.createElement('div');
    row.className = 'agent-form-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    row.appendChild(lbl);
    row.appendChild(input);
    return row;
  },

  _textField(label, value, onChange) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value || '';
    input.addEventListener('input', () => onChange(input.value));
    return this._row(label, input);
  },

  _textareaField(label, value, onChange) {
    const ta = document.createElement('textarea');
    ta.value = value || '';
    ta.rows = 4;
    ta.addEventListener('input', () => onChange(ta.value));
    return this._row(label, ta);
  },

  _numberField(label, value, min, max, step, onChange) {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value;
    input.min = min;
    input.max = max;
    input.step = step;
    input.addEventListener('input', () => onChange(parseFloat(input.value)));
    return this._row(label, input);
  },

  _selectField(label, value, options, onChange) {
    const sel = document.createElement('select');
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      if (opt === value) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(sel.value));
    return this._row(label, sel);
  },

  _colorField(label, value, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'agent-form-color-wrap';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = value;
    const text = document.createElement('input');
    text.type = 'text';
    text.value = value;
    text.style.width = '90px';
    picker.addEventListener('input', () => { text.value = picker.value; onChange(picker.value); });
    text.addEventListener('input', () => {
      if (/^#[0-9A-Fa-f]{6}$/.test(text.value)) {
        picker.value = text.value;
        onChange(text.value);
      }
    });
    wrap.appendChild(picker);
    wrap.appendChild(text);
    return this._row(label, wrap);
  },

  _multiSelectField(label, selected, options, onChange, displayMap = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'agent-form-multiselect';
    const selectedSet = new Set(selected);
    for (const opt of options) {
      const id = `ms-${label}-${opt}`.replace(/\W/g, '_');
      const item = document.createElement('label');
      item.className = 'agent-form-checkbox';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selectedSet.has(opt);
      cb.id = id;
      cb.addEventListener('change', () => {
        if (cb.checked) selectedSet.add(opt);
        else selectedSet.delete(opt);
        onChange(Array.from(selectedSet));
      });
      item.appendChild(cb);
      const span = document.createElement('span');
      span.textContent = displayMap[opt] || opt;
      item.appendChild(span);
      wrap.appendChild(item);
    }
    return this._row(label, wrap);
  },

  // ===== DIRTY TRACKING =====

  _markDirty(file, fieldPath, newValue) {
    const key = `${file}::${fieldPath}`;
    this.dirty.set(key, { file, fieldPath, newValue });
    this._updateSaveButton();
    
    // LIVE PREVIEW for appearance changes
    this._livePreview(fieldPath, newValue);
  },

  _livePreview(fieldPath, value) {
    // Find the squid this agent represents and update its visuals immediately
    if (!window.squids) return;
    const squid = window.squids.find(s => s.agent_id === this.agentId || s.agentId === this.agentId);
    if (!squid) return;
    
    if (fieldPath === 'appearance.primary_color') squid.color = value;
    if (fieldPath === 'appearance.secondary_color') squid.colorDark = value;
    if (fieldPath === 'appearance.size_scale') squid.baseSize = value;
    if (fieldPath.startsWith('appearance.accessories.')) {
      if (!squid.accessories) squid.accessories = {};
      const slot = fieldPath.split('.').pop();
      squid.accessories[slot] = value === 'none' ? null : value;
    }
  },

  _updateSaveButton() {
    const btn = this.modal?.querySelector('.agent-form-save');
    if (!btn) return;
    btn.textContent = `Save Changes (${this.dirty.size})`;
    btn.disabled = this.dirty.size === 0;
  },

  // ===== SAVE =====

  async save() {
    const status = this.modal.querySelector('.agent-form-status');
    status.textContent = `Saving ${this.dirty.size} change(s)...`;
    status.className = 'agent-form-status';
    
    let success = 0;
    const errors = [];
    for (const { file, fieldPath, newValue } of this.dirty.values()) {
      try {
        await window.ApiV2._fetch('/field', {
          method: 'PATCH',
          body: JSON.stringify({
            filePath: file,
            fieldPath,
            newValue,
            reason: 'edited via AgentForm UI'
          })
        });
        success++;
      } catch (err) {
        errors.push(`${fieldPath}: ${err.message}`);
      }
    }
    
    if (errors.length === 0) {
      status.textContent = `Saved ${success} change(s). All synced.`;
      status.className = 'agent-form-status success';
      this.dirty.clear();
      // Reload to show updated values
      setTimeout(() => this.open(this.agentId), 800);
    } else {
      status.textContent = `${success} saved, ${errors.length} failed. ${errors[0]}`;
      status.className = 'agent-form-status error';
    }
  },

  close() {
    if (this.modal) this.modal.classList.add('hidden');
    this.dirty.clear();
  }
};

window.AgentForm = AgentForm;
console.log('[OK] AgentForm loaded');
