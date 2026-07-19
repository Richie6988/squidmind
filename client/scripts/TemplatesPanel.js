/**
 * TemplatesPanel — manage the style templates that generated documents
 * inherit. Header button, modal panel (same chrome family as SkillsPanel).
 *
 * Files live in aquarium/TEMPLATES/ (system assets — like models, skills).
 * Per format (PPTX / DOCX / XLSX): upload with a human name, pick which
 * one is the DEFAULT (auto-applied to every generate_pptx/generate_docx),
 * delete. The default is a manifest pointer server-side — renaming files
 * is never needed.
 */

const TemplatesPanel = {
  _modal: null,
  _data: null,

  async open() {
    if (this._modal) { this._modal.remove(); this._modal = null; }
    const modal = document.createElement('div');
    modal.className = 'modal skills-modal';
    modal.style.zIndex = '18000';
    modal.innerHTML = `
<div class="skills-content" style="max-width:720px;">
  <div class="skills-header">
    <div class="skills-title">
      <span class="skills-icon">&#9646;</span>
      <span>STYLE TEMPLATES</span>
    </div>
    <div class="skills-header-right">
      <label class="skills-new-btn" style="cursor:pointer;">
        + UPLOAD
        <input type="file" accept=".pptx,.docx,.xlsx" multiple style="display:none"
          onchange="TemplatesPanel._upload(event)">
      </label>
      <button class="skills-refresh-btn" onclick="TemplatesPanel._load()" title="Refresh">&#8634;</button>
      <button class="skills-close-btn" onclick="TemplatesPanel.close()">&#10005;</button>
    </div>
  </div>
  <div class="skills-desc">
    Drop your reference documents here. The <b>DEFAULT</b> of each format is automatically
    inherited by every generated document — masters, layouts, fonts, colors, logos.
    Named variants are selectable by name ("use the bi_workshop template").
  </div>
  <div class="skills-body" id="tpl-body">
    <div class="skills-loading">Loading templates…</div>
  </div>
</div>`;
    document.body.appendChild(modal);
    this._modal = modal;
    modal.addEventListener('click', e => { if (e.target === modal) this.close(); });
    await this._load();
  },

  close() { if (this._modal) { this._modal.remove(); this._modal = null; } },

  async _load() {
    const body = document.getElementById('tpl-body');
    if (!body) return;
    try {
      const r = await window.api._fetch('/templates');
      this._data = r;
      this._render(body);
    } catch (e) {
      body.innerHTML = `<div class="skills-loading">Failed to load: ${this._esc(e.message)}</div>`;
    }
  },

  _render(body) {
    const t = this._data?.templates || {};
    const FORMATS = [
      { ext: 'pptx', label: 'PPTX — Presentations', k: 'media' },
      { ext: 'docx', label: 'DOCX — Documents',     k: 'doc' },
      { ext: 'xlsx', label: 'XLSX — Spreadsheets',  k: 'data' },
    ];
    const secs = FORMATS.map(f => {
      const items = t[f.ext] || [];
      const rows = items.length ? items.map(it => `
        <div class="tpl-row">
          <i class="ti-fk" data-k="${f.k}">${f.ext.toUpperCase()}</i>
          <span class="tpl-name" title="${this._esc(it.file)}">${this._esc(it.name)}</span>
          <span class="tpl-meta">${this._fmtSize(it.size)}</span>
          ${it.is_default
            ? `<span class="tpl-default-on" title="Auto-applied to every generated ${f.ext}">★ DEFAULT</span>`
            : `<button class="tpl-btn" onclick="TemplatesPanel._setDefault('${f.ext}','${this._esc(it.file)}')" title="Make this the auto-applied ${f.ext} style">SET DEFAULT</button>`}
          <button class="tpl-btn tpl-del" onclick="TemplatesPanel._delete('${this._esc(it.file)}')">X</button>
        </div>`).join('')
        : `<div class="tpl-empty">No ${f.ext} template yet — upload one to give generated ${f.ext === 'pptx' ? 'decks' : f.ext === 'docx' ? 'documents' : 'sheets'} your style.</div>`;
      return `<div class="tpl-section"><div class="tpl-section-head">${f.label}</div>${rows}</div>`;
    }).join('');
    body.innerHTML = secs;
  },

  async _upload(ev) {
    const files = [...(ev.target?.files || [])];
    ev.target.value = '';
    for (const f of files) {
      if (!/\.(pptx|docx|xlsx)$/i.test(f.name)) continue;
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      try {
        const resp = await fetch('/api/v2/templates', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: f.name, content: b64, encoding: 'base64' }),
        }).then(x => x.json());
        if (!resp.success) window.ToastManager?.show?.({ type: 'error', title: resp.error || 'upload failed' });
      } catch (e) {
        window.ToastManager?.show?.({ type: 'error', title: e.message });
      }
    }
    await this._load();
  },

  async _setDefault(ext, file) {
    try {
      await fetch('/api/v2/templates/default', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ext, file }),
      });
    } catch {}
    await this._load();
  },

  async _delete(file) {
    if (!(await SquidModal.confirm(`Delete template "${file}"?`))) return;
    try { await fetch(`/api/v2/templates/${encodeURIComponent(file)}`, { method: 'DELETE' }); } catch {}
    await this._load();
  },

  _fmtSize(n) {
    if (!n) return '';
    if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n > 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  },

  _esc(s) { return String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]); },
};
