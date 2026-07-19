/**
 * TemplateGallery — the style memory for generated documents.
 *
 * Storage IS the TEMPLATES system project (the temple is the gallery UI:
 * upload via + ADD, preview, versions — all for free). Convention over
 * configuration:
 *
 *   TEMPLATES/output/default.pptx   → auto-applied to every generate_pptx
 *   TEMPLATES/output/default.docx   → auto-applied to every generate_docx
 *   TEMPLATES/output/<name>.pptx    → selectable via template:"<name>"
 *
 * Generation with a template goes through python-pptx / python-docx in the
 * IAQUA venv — the ONLY way to truly inherit slide masters, layouts, logos,
 * fonts and theme colors from a reference file. Deps are installed lazily
 * through PyEnvService on first use.
 */

const path = require('path');
const fs   = require('fs');
const AQUARIUM = require('../aquarium');

const TPL_DIR = path.join(AQUARIUM.PROJECTS, 'TEMPLATES', 'output');

class TemplateGallery {
  /** All templates grouped by extension, defaults flagged. */
  list() {
    let files = [];
    try { files = fs.readdirSync(TPL_DIR).filter(f => !f.startsWith('.')); } catch {}
    const byExt = {};
    for (const f of files) {
      const ext = (f.split('.').pop() || '').toLowerCase();
      if (!['pptx', 'docx', 'xlsx'].includes(ext)) continue;
      (byExt[ext] = byExt[ext] || []).push({
        name: f.replace(/\.[^.]+$/, ''),
        file: f,
        is_default: f.toLowerCase() === `default.${ext}`,
      });
    }
    return { ok: true, dir: 'TEMPLATES/output', templates: byExt };
  }

  /**
   * Resolve a template for a format.
   *  name === 'none'      → explicit opt-out, returns null
   *  name provided        → TEMPLATES/output/<name>.<ext> (error if missing)
   *  name omitted         → default.<ext> if present, else null (plain gen)
   */
  resolve(ext, name) {
    ext = String(ext || '').toLowerCase();
    if (name === 'none') return { path: null };
    if (name) {
      const p = path.join(TPL_DIR, `${String(name).replace(/[^\w.\- ]/g, '_')}.${ext}`);
      if (!fs.existsSync(p)) {
        const avail = (this.list().templates[ext] || []).map(t => t.name).join(', ') || 'none';
        return { error: `Template "${name}.${ext}" not found in TEMPLATES/output. Available ${ext} templates: ${avail}` };
      }
      return { path: p, name };
    }
    const def = path.join(TPL_DIR, `default.${ext}`);
    return fs.existsSync(def) ? { path: def, name: 'default' } : { path: null };
  }
}

module.exports = new TemplateGallery();
