/**
 * ThumbService — cached downscaled thumbnails for image grids.
 *
 * The gallery used to load full-size PNGs (1-2 MB each for a 1024² render)
 * into 150px cells: dozens of megabytes to paint a screen. Now the grid
 * asks for thumbnails and only the lightbox pulls the original.
 *
 * Cache: <project>/.thumbs/<base>__w<width>.<jpg|png>
 *   - dot-prefixed so it never shows in file listings (which read
 *     input/ and output/, and skip dotfiles anyway)
 *   - keyed by width so several sizes can coexist
 *   - invalidated by mtime: a regenerated source (img2img, upscale
 *     overwriting in place) produces a newer file than its thumb
 *   - alpha preserved as PNG, everything else JPEG q80 (photos and
 *     AI renders are opaque — JPEG is several times lighter)
 *
 * Jimp is already a dependency (UpscaleService uses it), so this adds no
 * install surface.
 */

const path = require('path');
const fs   = require('fs').promises;
const log  = require('../utils/logger').createLogger('ThumbService');

const MAX_SOURCE_MB = 64;   // refuse absurd files rather than OOM the server

class ThumbService {
  constructor() {
    this._inflight = new Map();   // path|w → Promise (coalesce concurrent grid hits)
  }

  /**
   * @param {string} projDir  absolute project folder
   * @param {string} fileName sanitized file name inside output/
   * @param {number} width    target width in px
   * @returns {{ok:true, path:string} | {ok:false, error:string, code:number}}
   */
  async get(projDir, fileName, width = 320) {
    const srcPath = path.join(projDir, 'output', fileName);
    let srcStat;
    try {
      srcStat = await fs.stat(srcPath);
    } catch {
      return { ok: false, error: 'source not found', code: 404 };
    }
    if (srcStat.size > MAX_SOURCE_MB * 1024 ** 2) {
      return { ok: false, error: 'source too large to thumbnail', code: 413 };
    }

    const base    = fileName.replace(/\.[^.]+$/, '');
    const thumbDir = path.join(projDir, '.thumbs');
    // Extension decided after decode (alpha check) — probe both.
    const stem    = path.join(thumbDir, `${base}__w${width}`);

    for (const ext of ['jpg', 'png']) {
      const p = `${stem}.${ext}`;
      try {
        const st = await fs.stat(p);
        // Fresh only if the thumb is newer than the source it came from.
        if (st.mtimeMs >= srcStat.mtimeMs) return { ok: true, path: p };
      } catch { /* miss */ }
    }

    const key = `${srcPath}|${width}`;
    if (this._inflight.has(key)) return this._inflight.get(key);
    const job = this._generate(srcPath, thumbDir, stem, width)
      .finally(() => this._inflight.delete(key));
    this._inflight.set(key, job);
    return job;
  }

  async _generate(srcPath, thumbDir, stem, width) {
    try {
      const Jimp = require('jimp');
      const img  = await Jimp.read(srcPath);
      if (img.bitmap.width > width) img.resize(width, Jimp.AUTO);
      const useAlpha = typeof img.hasAlpha === 'function' ? img.hasAlpha() : false;
      const outPath  = `${stem}.${useAlpha ? 'png' : 'jpg'}`;
      if (!useAlpha) img.quality(80);
      await fs.mkdir(thumbDir, { recursive: true });
      await img.writeAsync(outPath);
      return { ok: true, path: outPath };
    } catch (e) {
      log.warn(`thumb generation failed for ${path.basename(srcPath)}: ${e.message}`);
      // Caller falls back to the original — a heavy grid beats a broken one.
      return { ok: false, error: e.message, code: 500 };
    }
  }
}

module.exports = new ThumbService();
