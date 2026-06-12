/**
 * ImageGenerationService
 *
 * Handles GGUF-based image generation by delegating to the best available backend:
 *   1. stable-diffusion.cpp CLI  (sd / stable-diffusion)
 *   2. llama.cpp llama-run       (for LLaVA / multimodal models that can output images)
 *
 * Returns a Buffer (PNG/JPEG) or throws with a descriptive error.
 *
 * GGUF image models (Stable Diffusion, FLUX, etc.) cannot be loaded through
 * node-llama-cpp (which is text-only). We spawn the sd CLI instead.
 */

const { spawn, exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class ImageGenerationService {
  constructor() {
    // Cached backend discovery result
    this._backend = null;
  }

  /**
   * Detect which image generation backend is available.
   * Returns { type: 'sd'|'none', bin: string|null }
   */
  async detectBackend() {
    if (this._backend) return this._backend;

    const candidates = [
      'sd-diffusion',          // recommended install name (avoids clash with Rust sd tool)
      'sdcpp',
      'stable-diffusion',
      path.join(os.homedir(), '.local/bin/sd-diffusion'),
      '/usr/local/bin/sd-diffusion',
      '/usr/local/bin/sdcpp',
      path.join(process.cwd(), '../stable-diffusion.cpp/build/bin/sd'),
      path.join(os.homedir(), 'stable-diffusion.cpp/build/bin/sd'),
      '/opt/sd/sd',
      'sd',                    // last resort — check it's actually stable-diffusion.cpp
    ];

    for (const bin of candidates) {
      try {
        const { stdout } = await execAsync(`"${bin}" --version 2>&1`, { timeout: 3000 });
        // Rust 'sd' tool prints "sd v1.0.0 An intuitive find & replace CLI" — skip it
        if (/find.replace|replace.cli|intuitive/i.test(stdout)) {
          console.log(`[ImageGen] Skipping ${bin} — this is the Rust sd tool, not stable-diffusion.cpp`);
          continue;
        }
        this._backend = { type: 'sd', bin };
        console.log(`[ImageGen] Backend found: ${bin}`);
        return this._backend;
      } catch {}
    }

    this._backend = { type: 'none', bin: null };
    console.warn('[ImageGen] No image generation backend found (sd / stable-diffusion.cpp)');
    return this._backend;
  }

  /**
   * Generate an image from a prompt using the given GGUF model file.
   *
   * @param {object} opts
   *   modelPath  - absolute path to the .gguf model file
   *   prompt     - text prompt
   *   outputPath - absolute path where the PNG should be written
   *   width      - image width  (default 512)
   *   height     - image height (default 512)
   *   steps      - inference steps (default 20)
   *   cfg        - CFG scale (default 7)
   *   seed       - seed (-1 = random)
   * @returns {Promise<{ ok: true, outputPath: string, bytes: number }|{ ok: false, error: string }>}
   */
  async generate({ modelPath, prompt, outputPath, width = 512, height = 512, steps = 20, cfg = 7, seed = -1, negativePrompt = '' }) {
    // Flux models use cfg=1.0 and need far fewer steps (flow matching, not diffusion)
    const isFlux = /flux/i.test(path.basename(modelPath));
    if (isFlux) {
      if (cfg === 7)  cfg   = 1.0;   // Flux ignores CFG > 1 — override default
      if (steps === 20) steps = 4;   // Flux works great at 4 steps
    }
    const backend = await this.detectBackend();

    if (backend.type === 'none') {
      return {
        ok: false,
        error: 'stable-diffusion.cpp not found.\n' +
          'After building, install as: sudo cp build/bin/sd /usr/local/bin/sd-diffusion\n' +
          '(use sd-diffusion to avoid clash with Rust sd tool)\n' +
          'Docs: https://github.com/leejet/stable-diffusion.cpp'
      };
    }

    // Ensure output directory exists
    await fs.mkdir(path.dirname(outputPath), { recursive: true });

    if (backend.type === 'sd') {
      return this._generateWithSd({ bin: backend.bin, modelPath, prompt, negativePrompt, outputPath, width, height, steps, cfg, seed });
    }

    return { ok: false, error: `Unknown backend type: ${backend.type}` };
  }

  /**
   * Spawn stable-diffusion.cpp CLI to generate.
   */
  _generateWithSd({ bin, modelPath, prompt, negativePrompt, outputPath, width, height, steps, cfg, seed }) {
    return new Promise((resolve) => {
      const args = [
        '--model', modelPath,
        '--prompt', prompt,
        '--output', outputPath,
        '--width', String(width),
        '--height', String(height),
        '--steps', String(steps),
        '--cfg-scale', String(cfg),
        '--seed', String(seed),
        '--rng', 'cuda',
      ];
      if (negativePrompt) args.push('--negative-prompt', negativePrompt);

      console.log(`[ImageGen] Spawning: ${bin} ${args.slice(0, 4).join(' ')} ...`);
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });

      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });

      child.on('error', err => resolve({ ok: false, error: `Failed to spawn sd: ${err.message}` }));

      child.on('close', async (code) => {
        if (code !== 0) {
          return resolve({ ok: false, error: `sd exited with code ${code}. stderr: ${stderr.slice(-400)}` });
        }
        try {
          const stat = await fs.stat(outputPath);
          resolve({ ok: true, outputPath, bytes: stat.size });
        } catch {
          resolve({ ok: false, error: `sd exited OK but output file not found at ${outputPath}` });
        }
      });

      // Timeout after 5 min
      setTimeout(() => {
        child.kill();
        resolve({ ok: false, error: 'Image generation timed out after 5 minutes' });
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Detect if a GGUF filename looks like an image generation model.
   * Heuristic: filename contains known image model markers.
   */
  static detectModelType(fileName) {
    const lower = (fileName || '').toLowerCase();

    // Known image-pipeline components (encoders, VAEs, diffusion models)
    const imageMarkers = [
      // Diffusion models
      'stable-diffusion', 'stablediffusion', 'sd-', 'sd_',
      'flux', 'sdxl', 'sd1', 'sd2', 'sd3',
      'dreamshaper', 'animagine', 'realistic', 'anything-v',
      'waifu-diffusion', 'deliberate', 'openjourney',
      'image-gen', 'txt2img', 't2i',
      // Encoder/decoder components — NEVER text LLMs
      't5xxl', 't5-xxl', 't5_xxl',          // T5 text encoder for FLUX/SD3
      'clip_l', 'clip-l', 'clip_g', 'clip-g', // CLIP encoders
      'vae', 'ae.safetensors',               // VAEs
      'unet', 'u-net',                       // UNet diffusion
      'controlnet', 'control_net',           // ControlNet
      'lora', 'locon', 'lycoris',            // LoRA adapters
      'esrgan', 'upscal',                    // upscalers
    ];
    if (imageMarkers.some(m => lower.includes(m))) return 'image';
    return 'text';
  }
}

module.exports = ImageGenerationService;
