/**
 * TemplateGallery — the style memory for generated documents.
 *
 * Storage: aquarium/TEMPLATES/ (top-level, same class as MODELS/SKILLS —
 * user-provided system assets, NOT work content). Managed through the
 * Templates panel in the header. Files keep their human names; which one
 * is the DEFAULT per format is a pointer in manifest.json:
 *   { "defaults": { "pptx": "BI deck.pptx", "docx": "Rapport client.docx" } }
 * Legacy convention still honored: a file literally named default.<ext>
 * acts as default when the manifest has no entry.
 *
 * Templated generation goes through python-pptx / python-docx in the IAQUA
 * venv — true inheritance of masters, layouts, fonts, colors, logos.
 */

const path = require('path');
const fs   = require('fs');
const AQUARIUM = require('../aquarium');

const TPL_DIR  = AQUARIUM.TEMPLATES;
const MANIFEST = path.join(TPL_DIR, 'manifest.json');
const EXTS = ['pptx', 'docx', 'xlsx'];

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, 'utf8')); }
  catch { return { defaults: {} }; }
}
function writeManifest(m) {
  fs.mkdirSync(TPL_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2), 'utf8');
}

class TemplateGallery {
  /** All templates grouped by extension, defaults flagged from the manifest. */
  list() {
    let files = [];
    try { files = fs.readdirSync(TPL_DIR).filter(f => !f.startsWith('.') && f !== 'manifest.json'); } catch {}
    const man = readManifest();
    const byExt = {};
    for (const f of files) {
      const ext = (f.split('.').pop() || '').toLowerCase();
      if (!EXTS.includes(ext)) continue;
      let size = 0, mtime = null;
      try { const st = fs.statSync(path.join(TPL_DIR, f)); size = st.size; mtime = st.mtime.toISOString(); } catch {}
      (byExt[ext] = byExt[ext] || []).push({
        name: f.replace(/\.[^.]+$/, ''),
        file: f, size, mtime,
        is_default: man.defaults?.[ext] === f || (!man.defaults?.[ext] && f.toLowerCase() === `default.${ext}`),
      });
    }
    return { ok: true, dir: 'TEMPLATES/', templates: byExt, defaults: man.defaults || {} };
  }

  setDefault(ext, file) {
    ext = String(ext || '').toLowerCase();
    if (!EXTS.includes(ext)) return { ok: false, error: `ext must be one of ${EXTS.join('/')}` };
    if (file !== null && !fs.existsSync(path.join(TPL_DIR, String(file)))) {
      return { ok: false, error: `${file} not found in TEMPLATES/` };
    }
    const man = readManifest();
    man.defaults = man.defaults || {};
    if (file === null) delete man.defaults[ext];
    else man.defaults[ext] = String(file);
    writeManifest(man);
    return { ok: true, defaults: man.defaults };
  }

  remove(file) {
    const safe = String(file || '').replace(/[\/\\]/g, '');
    const p = path.join(TPL_DIR, safe);
    if (!fs.existsSync(p)) return { ok: false, error: `${safe} not found` };
    fs.unlinkSync(p);
    // Drop a dangling default pointer
    const man = readManifest();
    for (const [ext, f] of Object.entries(man.defaults || {})) {
      if (f === safe) delete man.defaults[ext];
    }
    writeManifest(man);
    return { ok: true };
  }

  /**
   * Resolve a template for a format.
   *  name === 'none' → explicit opt-out
   *  name provided   → file whose base name matches (error if missing)
   *  name omitted    → manifest default, else literal default.<ext>, else null
   */
  resolve(ext, name) {
    ext = String(ext || '').toLowerCase();
    if (name === 'none') return { path: null };
    if (name) {
      const hit = (this.list().templates[ext] || []).find(t => t.name === name || t.file === name);
      if (!hit) {
        const avail = (this.list().templates[ext] || []).map(t => t.name).join(', ') || 'none';
        return { error: `Template "${name}" (.${ext}) not found. Available: ${avail}. Manage them in the Templates panel.` };
      }
      return { path: path.join(TPL_DIR, hit.file), name: hit.name };
    }
    const man = readManifest();
    const def = man.defaults?.[ext];
    if (def && fs.existsSync(path.join(TPL_DIR, def))) {
      return { path: path.join(TPL_DIR, def), name: def.replace(/\.[^.]+$/, '') };
    }
    const legacy = path.join(TPL_DIR, `default.${ext}`);
    return fs.existsSync(legacy) ? { path: legacy, name: 'default' } : { path: null };
  }
}

module.exports = new TemplateGallery();
