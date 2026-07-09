'use strict';

/**
 * UpscaleService — real image super-resolution.
 *
 * Two backends, tried in order:
 *
 *  1. Real-ESRGAN (realesrgan-ncnn-vulkan) — a standalone binary that runs
 *     a super-resolution neural net on the GPU via Vulkan. No Python, no
 *     CUDA toolkit needed — works on the user's RTX 5060 out of the box.
 *     This is TRUE upscaling: it reconstructs plausible detail rather than
 *     just interpolating pixels. Preferred when the binary is present.
 *
 *  2. jimp bicubic — pure-JS resampling fallback. Always available (jimp is
 *     a dependency). Enlarges + light sharpen; adds no new detail, but never
 *     fails to install.
 *
 * Binary discovery (first hit wins):
 *   - REALESRGAN_BIN env var (explicit path)
 *   - `command -v realesrgan-ncnn-vulkan` on the login-shell PATH
 *   - bundled at aquarium/TOOLS/realesrgan/realesrgan-ncnn-vulkan
 *   - common locations (/usr/local/bin, ~/.local/bin, /opt/…)
 *
 * Install note (surfaced to the user when the binary is absent): download
 * the release zip from https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan/releases
 * (or the maintained fork), unzip it into aquarium/TOOLS/realesrgan/, and
 * make the binary executable. The bundled models (realesrgan-x4plus etc.)
 * live next to the binary in a models/ folder.
 */

const path = require('path');
const fs   = require('fs');
const fsp  = fs.promises;
const os   = require('os');
const { exec, spawn } = require('child_process');

const log = {
  info: (...a) => console.log('[Upscale]', ...a),
  warn: (...a) => console.warn('[Upscale]', ...a),
};

const BIN_NAME = 'realesrgan-ncnn-vulkan';

class UpscaleService {
  constructor() {
    this._binPath = undefined; // undefined = not probed yet, null = absent
  }

  /** Resolve the Real-ESRGAN binary path, caching the result. */
  async _findBinary() {
    if (this._binPath !== undefined) return this._binPath;

    const candidates = [];
    if (process.env.REALESRGAN_BIN) candidates.push(process.env.REALESRGAN_BIN);

    // bundled inside the aquarium
    try {
      const AQUARIUM = require('../aquarium');
      candidates.push(path.join(AQUARIUM.TOOLS, 'realesrgan', BIN_NAME));
      candidates.push(path.join(AQUARIUM.ROOT, 'TOOLS', 'realesrgan', BIN_NAME));
    } catch { /* aquarium not resolvable in some contexts */ }

    const home = os.homedir();
    candidates.push(
      `/usr/local/bin/${BIN_NAME}`, `/usr/bin/${BIN_NAME}`,
      `${home}/.local/bin/${BIN_NAME}`, `${home}/bin/${BIN_NAME}`,
      `/opt/realesrgan/${BIN_NAME}`,
    );

    for (const c of candidates) {
      try { await fsp.access(c, fs.constants.X_OK); this._binPath = c; log.info('using', c); return c; }
      catch { /* keep looking */ }
    }

    // login-shell PATH lookup
    const viaPath = await new Promise(r =>
      exec(`bash -lc 'command -v ${BIN_NAME}'`, { timeout: 4000 }, (e, out) =>
        r(e ? null : (out || '').trim() || null)));
    if (viaPath) { this._binPath = viaPath; log.info('using', viaPath); return viaPath; }

    this._binPath = null;
    return null;
  }

  /** Is Real-ESRGAN available? */
  async hasRealEsrgan() { return !!(await this._findBinary()); }

  /**
   * Upscale an image. Returns { ok, outputPath, from, to, scale, backend }.
   * @param {string} src        absolute path to source image
   * @param {number} factor     2, 3, or 4
   * @param {string} outputPath where to write the result
   */
  async upscale(src, factor, outputPath) {
    const bin = await this._findBinary();
    if (bin) {
      try {
        return await this._realEsrgan(bin, src, factor, outputPath);
      } catch (e) {
        log.warn('Real-ESRGAN failed, falling back to jimp:', e.message);
        // fall through to jimp
      }
    }
    return await this._jimp(src, factor, outputPath);
  }

  _realEsrgan(bin, src, factor, outputPath) {
    return new Promise((resolve, reject) => {
      // realesrgan-x4plus is the general-purpose 4x model shipped with the
      // release. -s sets the scale (the model is 4x; -s downsamples the
      // result to the requested factor when < 4). -n picks the model.
      const modelDir = path.join(path.dirname(bin), 'models');
      const args = ['-i', src, '-o', outputPath, '-s', String(factor), '-n', 'realesrgan-x4plus'];
      if (fs.existsSync(modelDir)) args.push('-m', modelDir);

      const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', reject);
      child.on('close', async (code) => {
        if (code !== 0 || !fs.existsSync(outputPath)) {
          return reject(new Error(`realesrgan exit ${code}: ${stderr.slice(0, 300)}`));
        }
        // Read back dimensions for the response
        let from = '?', to = '?';
        try {
          const Jimp = require('jimp');
          const [a, b] = await Promise.all([Jimp.read(src), Jimp.read(outputPath)]);
          from = `${a.bitmap.width}x${a.bitmap.height}`;
          to   = `${b.bitmap.width}x${b.bitmap.height}`;
        } catch { /* dimensions are best-effort */ }
        resolve({ ok: true, outputPath, from, to, scale: factor, backend: 'real-esrgan' });
      });
    });
  }

  async _jimp(src, factor, outputPath) {
    const Jimp = require('jimp');
    const img  = await Jimp.read(src);
    const fromW = img.bitmap.width, fromH = img.bitmap.height;
    img.resize(fromW * factor, fromH * factor, Jimp.RESIZE_BICUBIC);
    img.convolute([[0, -0.15, 0], [-0.15, 1.6, -0.15], [0, -0.15, 0]]);
    await img.writeAsync(outputPath);
    return {
      ok: true, outputPath,
      from: `${fromW}x${fromH}`, to: `${fromW * factor}x${fromH * factor}`,
      scale: factor, backend: 'jimp-bicubic',
    };
  }
}

module.exports = { UpscaleService, upscaleService: new UpscaleService() };
