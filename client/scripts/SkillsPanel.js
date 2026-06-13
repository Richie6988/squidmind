'use strict';
/**
 * SkillsPanel — IAQUA Skills Metacognition UI
 * 
 * Shows all skills Poseidon has learned, their version/health, triggers,
 * and allows editing or deleting individual skills.
 * 
 * Access: via the SKILLS button in the main dock or right panel.
 */

const SkillsPanel = {
  _modal: null,
  _skills: [],
  _editingId: null,

  async open() {
    if (this._modal) { this._modal.remove(); this._modal = null; }
    const modal = document.createElement('div');
    modal.className = 'modal skills-modal';
    modal.style.zIndex = '18000';
    modal.innerHTML = `
<div class="skills-content">
  <div class="skills-header">
    <div class="skills-title">
      <span class="skills-icon">&#9670;</span>
      <span>SKILLS LIBRARY</span>
    </div>
    <div class="skills-header-right">
      <button class="skills-new-btn" onclick="SkillsPanel._openEditor(null)">+ NEW SKILL</button>
      <button class="skills-refresh-btn" onclick="SkillsPanel._load()" title="Refresh">&#8634;</button>
      <button class="skills-close-btn" onclick="SkillsPanel.close()">&#10005;</button>
    </div>
  </div>
  <div class="skills-desc">
    Skills are Poseidon's long-term procedural memory. Each skill is a named workflow with steps, 
    triggers, and version history. Higher version = more battle-tested.
  </div>
  <div class="skills-body" id="skills-body">
    <div class="skills-loading">Loading skills...</div>
  </div>
</div>`;
    document.body.appendChild(modal);
    this._modal = modal;
    modal.addEventListener('click', e => { if (e.target === modal) this.close(); });
    await this._load();
  },

  close() {
    if (this._modal) { this._modal.remove(); this._modal = null; }
  },

  async _load() {
    const body = document.getElementById('skills-body');
    if (!body) return;
    body.innerHTML = '<div class="skills-loading">Loading...</div>';
    try {
      const r = await window.ApiV2._fetch('/skills');
      this._skills = r.skills || [];
      this._render(body);
    } catch (e) {
      body.innerHTML = `<div class="skills-err">Failed: ${e.message}</div>`;
    }
  },

  _render(body) {
    if (!this._skills.length) {
      body.innerHTML = '<div class="skills-empty">No skills yet. Poseidon will create skills as it learns.</div>';
      return;
    }

    // Group by health: version >= 3 = mature, version == 2 = developing, version == 1 = draft
    const health = s => s.version >= 5 ? 'mastered' : s.version >= 3 ? 'mature' : s.version >= 2 ? 'developing' : 'draft';
    const healthColor = { mastered: '#06ffa5', mature: '#4facfe', developing: '#fbbf24', draft: '#64748b' };

    body.innerHTML = `
<div class="skills-stats">
  <div class="skills-stat"><span>${this._skills.length}</span><label>TOTAL SKILLS</label></div>
  <div class="skills-stat"><span>${this._skills.filter(s => s.version >= 5).length}</span><label>MASTERED</label></div>
  <div class="skills-stat"><span>${this._skills.filter(s => s.version >= 3 && s.version < 5).length}</span><label>MATURE</label></div>
  <div class="skills-stat"><span>${this._skills.filter(s => s.version < 2).length}</span><label>DRAFTS</label></div>
</div>
<div class="skills-grid">
${this._skills.map(s => {
  const h = health(s);
  const col = healthColor[h];
  const stepsCount = s.steps?.length || 0;
  const triggersHtml = (s.triggers || []).slice(0, 4).map(t => `<span class="skill-trigger">${this._esc(t)}</span>`).join('');
  const updatedAgo = s.updated_at ? this._elapsed(s.updated_at) : '';
  return `<div class="skill-card" style="border-top:2px solid ${col}">
  <div class="skill-card-head">
    <span class="skill-name">${this._esc(s.name)}</span>
    <span class="skill-version" style="color:${col}">v${s.version || 1}</span>
  </div>
  <div class="skill-id">${this._esc(s.skill_id)}</div>
  <div class="skill-summary">${this._esc(s.summary || '')}</div>
  <div class="skill-meta">
    <span class="skill-health" style="color:${col}">${h.toUpperCase()}</span>
    <span class="skill-steps">${stepsCount} steps</span>
    ${updatedAgo ? `<span class="skill-age">${updatedAgo}</span>` : ''}
  </div>
  <div class="skill-triggers">${triggersHtml}</div>
  <div class="skill-actions">
    <button class="skill-btn skill-btn-edit" onclick="SkillsPanel._openEditor('${this._esc(s.skill_id)}')">EDIT</button>
    <button class="skill-btn skill-btn-del" onclick="SkillsPanel._delete('${this._esc(s.skill_id)}', '${this._esc(s.name)}')">DEL</button>
  </div>
</div>`;
}).join('')}
</div>`;
  },

  async _openEditor(skillId) {
    const existing = skillId ? this._skills.find(s => s.skill_id === skillId) : null;
    const editorModal = document.createElement('div');
    editorModal.className = 'modal skills-editor-modal';
    editorModal.style.zIndex = '19000';
    const stepsJson = existing ? JSON.stringify(existing.steps || [], null, 2) : JSON.stringify([
      { order: 1, action: 'STEP 1', note: 'Description' }
    ], null, 2);
    const notesJson = existing ? JSON.stringify(existing.notes || [], null, 2) : '[]';
    const triggersVal = (existing?.triggers || []).join(', ');

    editorModal.innerHTML = `
<div class="skills-editor-content">
  <div class="skills-header">
    <div class="skills-title"><span>${existing ? 'EDIT SKILL' : 'NEW SKILL'}</span></div>
    <button class="skills-close-btn" onclick="this.closest('.modal').remove()">&#10005;</button>
  </div>
  <div class="skills-editor-body">
    <div class="skill-field">
      <label>SKILL ID (snake_case)</label>
      <input id="ske-id" type="text" value="${this._esc(existing?.skill_id || '')}" ${existing ? 'readonly' : ''} placeholder="e.g. web_scraping_flow">
    </div>
    <div class="skill-field">
      <label>NAME</label>
      <input id="ske-name" type="text" value="${this._esc(existing?.name || '')}" placeholder="Human-readable name">
    </div>
    <div class="skill-field">
      <label>SUMMARY (one sentence)</label>
      <input id="ske-summary" type="text" value="${this._esc(existing?.summary || '')}" placeholder="What this skill does">
    </div>
    <div class="skill-field">
      <label>TRIGGERS (comma-separated phrases)</label>
      <input id="ske-triggers" type="text" value="${this._esc(triggersVal)}" placeholder="web scrape, fetch url, download page">
    </div>
    <div class="skill-field">
      <label>STEPS (JSON array)</label>
      <textarea id="ske-steps" rows="8" spellcheck="false">${this._esc(stepsJson)}</textarea>
    </div>
    <div class="skill-field">
      <label>NOTES (JSON array of strings)</label>
      <textarea id="ske-notes" rows="3" spellcheck="false">${this._esc(notesJson)}</textarea>
    </div>
    <div class="skill-field-err" id="ske-err" style="display:none;"></div>
  </div>
  <div class="skills-editor-footer">
    <button class="btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
    <button class="btn-primary" onclick="SkillsPanel._saveEditor(this.closest('.modal'))">SAVE SKILL</button>
  </div>
</div>`;
    document.body.appendChild(editorModal);
    editorModal.addEventListener('click', e => { if (e.target === editorModal) editorModal.remove(); });
  },

  async _saveEditor(modal) {
    const errEl = modal.querySelector('#ske-err');
    const show = msg => { errEl.style.display = 'block'; errEl.textContent = msg; };
    const id      = modal.querySelector('#ske-id')?.value.trim();
    const name    = modal.querySelector('#ske-name')?.value.trim();
    const summary = modal.querySelector('#ske-summary')?.value.trim();
    const triggers = (modal.querySelector('#ske-triggers')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
    let steps, notes;
    try { steps = JSON.parse(modal.querySelector('#ske-steps')?.value || '[]'); } catch { return show('Steps JSON invalid'); }
    try { notes = JSON.parse(modal.querySelector('#ske-notes')?.value || '[]'); } catch { return show('Notes JSON invalid'); }
    if (!id || !name || !summary) return show('ID, name and summary are required');
    if (!/^[a-z0-9_]+$/.test(id)) return show('Skill ID must be snake_case (a-z, 0-9, _)');
    try {
      await window.ApiV2._fetch('/skills/' + id, {
        method: 'PUT',
        body: JSON.stringify({ name, summary, triggers, steps, notes })
      });
      modal.remove();
      await this._load();
    } catch (e) { show('Save failed: ' + e.message); }
  },

  async _delete(skillId, skillName) {
    if (!await SquidModal.confirm(`Delete skill "${skillName}"?\nThis cannot be undone.`)) return;
    try {
      await window.ApiV2._fetch('/skills/' + skillId, { method: 'DELETE' });
      await this._load();
    } catch (e) { await SquidModal.alert('Delete failed: ' + e.message); }
  },

  _elapsed(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h ago';
    return Math.floor(h / 24) + 'd ago';
  },

  _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
};
