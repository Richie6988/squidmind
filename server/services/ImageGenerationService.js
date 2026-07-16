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

const { spawn, exec, execSync } = require('child_process');
const log = require('../utils/logger').createLogger('ImageGenerationService');
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
      'sd-diffusion',          // recommended install name
      'sd-cli',                // actual binary name in newer stable-diffusion.cpp builds
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
          log.info(`Skipping ${bin} — this is the Rust sd tool, not stable-diffusion.cpp`);
          continue;
        }
        this._backend = { type: 'sd', bin };
        log.info(`Backend found: ${bin}`);
        return this._backend;
      } catch {}
    }

    this._backend = { type: 'none', bin: null };
    log.warn('No image generation backend found (sd / stable-diffusion.cpp)');
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
  async generate({ modelPath, prompt, outputPath, width = 512, height = 512, steps = 20, cfg = 7, seed = -1, negativePrompt = '', initImage = null, strength = 0.75 }) {
    const isFlux = /flux/i.test(path.basename(modelPath));

    // Apply Flux-specific defaults only when user hasn't overridden them
    // Flux = flow-matching model: cfg=1.0, steps=4 is optimal
    // SD1.5/SDXL = diffusion: cfg=7, steps=20 is standard quality
    if (isFlux) {
      if (cfg   === 7)  cfg   = 1.0;  // Flux ignores CFG > 1
      if (steps === 20) steps = 8;    // 8 steps = better quality than 4, still fast
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
      return this._generateWithSd({ bin: backend.bin, modelPath, prompt, negativePrompt, outputPath, width, height, steps, cfg, seed, initImage, strength });
    }

    return { ok: false, error: `Unknown backend type: ${backend.type}` };
  }

  /**
   * Spawn stable-diffusion.cpp CLI to generate.
   */
  _generateWithSd({ bin, modelPath, prompt, negativePrompt, outputPath, width, height, steps, cfg, seed, initImage, strength }) {
    return new Promise((resolve) => {
      const path2 = require('path');
      const fs2   = require('fs');
      const modelFile = path2.basename(modelPath).toLowerCase();
      const modelDir  = path2.dirname(modelPath);

      // Flux / DiT models are standalone diffusion transformers — use --diffusion-model
      const isFluxModel = /flux/i.test(modelFile);
      const isDiT       = /dit|mmdit/i.test(modelFile);
      const modelFlag   = (isFluxModel || isDiT) ? '--diffusion-model' : '--model';

      const args = [
        modelFlag, modelPath,
        '--prompt', prompt,
        '--output', outputPath,
        '--width',  String(width),
        '--height', String(height),
        '--steps',  String(steps),
        '--cfg-scale', String(cfg),
        '--seed',   String(seed),
      ];
      // img2img: sd-diffusion accepts --init-img + --strength (0..1, 1=noise, 0=input).
      // Since the recent sd-diffusion update, mode="img2img" no longer exists;
      // valid modes are [img_gen, vid_gen, convert, upscale, metadata].
      // img2img is now driven by --init-img on a normal img_gen run.
      if (initImage && fs2.existsSync(initImage)) {
        args.push('--mode', 'img_gen');
        args.push('--init-img', initImage);
        args.push('--strength', String(strength ?? 0.75));
      }

      // Q4_K_M / Q4_0 and larger quantizations need too much VRAM on 8GB GPUs
      // Use full CPU for Q4+ to avoid cublas OOM during inference
      // Regex catches: flux1-schnell-q4_0.gguf, model_Q4_K_M.gguf, model-q4_k.gguf
      const quantMatch = modelFile.match(/[_-]q(\d+)/i);
      const quantNum   = quantMatch ? parseInt(quantMatch[1]) : 0;

      // VRAM estimate: pixels * 4 bytes * ~16 (activations) → bytes → GB
      // Flux attention at 512x512 needs ~1GB extra, 768x768 ~2.2GB, 1024x1024 ~4GB
      const pixelCount    = width * height;
      const vramEstimate  = (pixelCount * 4 * 16) / (1024 ** 3);  // rough GB
      // Flux needs T5+CLIP+VAE companions (~3GB baseline) so budget is much lower
      const VRAM_BUDGET   = isFluxModel ? 2.5 : 5.5;
      const resolutionOOM = vramEstimate > VRAM_BUDGET;

      // REAL free-VRAM check — the resolution/quant heuristics never looked
      // at what is actually free. With the LLM resident (GPU layers + a big
      // KV cache) the GPU run that used to fit gets its CUDA allocs killed
      // → "exited with code null". Degrade to CPU instead of crashing.
      let freeVramGb = 0;
      try {
        const out = execSync('nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits',
          { timeout: 3000, encoding: 'utf8' });
        freeVramGb = parseInt(String(out).trim(), 10) / 1024 || 0;
      } catch {}
      let modelSizeGb = 0;
      try { modelSizeGb = fs2.statSync(path2.join(modelDir, modelFile)).size / 1024 ** 3; } catch {}
      const needGb = modelSizeGb * 1.15 + vramEstimate + 0.4; // weights + activations + runtime
      const vramShort = freeVramGb > 0 && freeVramGb < needGb;
      if (vramShort) log.warn(`Insufficient free VRAM for GPU diffusion: ${freeVramGb.toFixed(1)}GB free, ~${needGb.toFixed(1)}GB needed (LLM resident?) — falling back to CPU`);

      // Force CPU when: Q4+ quantization OR resolution too large for VRAM
      // OR not enough VRAM actually free right now
      const forceCPU = quantNum >= 4 || resolutionOOM || vramShort;
      if (forceCPU) {
        const reason = quantNum >= 4 ? `Q${quantNum} quant` : `${width}x${height} resolution (~${vramEstimate.toFixed(1)}GB est.)`;
        log.info('Forcing CPU:', reason, '(avoids VRAM OOM)');
      }

      if (forceCPU) {
        // --max-vram 0 forces stable-diffusion.cpp to allocate ZERO VRAM → all tensors on RAM/CPU
        // This is the ONLY reliable way to prevent CUDA OOM — --rng std_default alone does NOT force CPU
        args.push('--max-vram', '0');
        args.push('--vae-on-cpu');
        args.push('--clip-on-cpu');
      }

      if (isFluxModel) {
        args.push('--sampling-method', 'euler');
        if (!forceCPU) {
          // GPU: only move encoders to CPU, keep diffusion on GPU
          args.push('--clip-on-cpu');
          args.push('--vae-on-cpu');
        }

        // Auto-locate companion files in same dir as model
        // Scan directory and match by pattern — handles any filename variant
        let dirFiles = [];
        try { dirFiles = fs2.readdirSync(modelDir); } catch {}
        const scanFind = (tests) => {
          for (const t of tests) {
            const f = dirFiles.find(name => t.test(name));
            if (f) return path2.join(modelDir, f);
          }
          return null;
        };
        const vae  = scanFind([/^ae\.safetensors$/i, /^ae\.sft$/i]);
        const clip = scanFind([/clip_l\.safetensors$/i, /clip_l\.sft$/i]);
        const t5   = scanFind([/t5.*encoder.*\.gguf$/i, /t5xxl.*\.gguf$/i,
                                /t5xxl_fp8/i, /t5xxl_fp16/i, /t5xxl\.safetensors$/i]);
        log.info('companion scan in ' + modelDir + ':',
          dirFiles.filter(f => /ae|clip|t5/i.test(f)).join(', ') || 'none',
          '| vae:', vae ? 'found' : 'MISSING',
          '| clip:', clip ? 'found' : 'MISSING',
          '| t5:', t5 ? path2.basename(t5) : 'MISSING');

        if (vae)  args.push('--vae',    vae);
        if (clip) args.push('--clip_l', clip);
        if (t5)   args.push('--t5xxl',  t5);
        // Note: --t5xxl-on-cpu not supported in this build; CPU forced via --max-vram 0

        if (!vae || !clip || !t5) {
          const missing = [!vae&&'ae.safetensors', !clip&&'clip_l.safetensors', !t5&&'t5-v1_1-xxl-encoder-Q4_K_M.gguf (or t5xxl_fp8_e4m3fn.safetensors)'].filter(Boolean);
          log.warn(`Flux missing companion files: ${missing.join(', ')} — download to ${modelDir}`);
          return resolve({ ok: false, error:
            `Flux requires companion files in ${modelDir}:\n` +
            missing.map(f => `  Missing: ${f}`).join('\n') + '\n\n' +
            'Download:\n' +
            '  wget https://huggingface.co/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors\n' +
            '  wget https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors\n' +
            '  wget https://huggingface.co/city96/t5-v1_1-xxl-encoder-gguf/resolve/main/t5-v1_1-xxl-encoder-Q4_K_M.gguf  (recommended, 2.3GB)'
          });
        }
      } else {
        if (!forceCPU) args.push('--rng', 'cuda');
      }
      // negativePrompt applies to both Flux and SD
      if (negativePrompt) args.push('--negative-prompt', negativePrompt);

      log.info(`Spawning: ${bin} ${args.slice(0, 4).join(' ')} ... forceCPU=${forceCPU}`);
      // When forceCPU: set CUDA_VISIBLE_DEVICES="" to blind the process to all GPUs at driver level
      // This works regardless of sd.cpp version — no CUDA backend = no CUDA OOM
      const spawnEnv = forceCPU
        ? { ...process.env, CUDA_VISIBLE_DEVICES: '', CUDA_DEVICE_ORDER: 'PCI_BUS_ID' }
        : process.env;
      const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv });

      let stderr = '';
      child.stderr.on('data', d => { stderr += d.toString(); });

      child.on('error', err => resolve({ ok: false, error: `Failed to spawn sd: ${err.message}` }));

      child.on('close', async (code) => {
        if (code !== 0) {
          let errMsg = `sd-diffusion exited with code ${code}.\n${stderr.slice(-500)}`;
          // Detect common CUDA OOM during inference
          if (/cublas.*failed|cudaMalloc.*out of memory|alloc.*CUDA.*buffer/i.test(stderr)) {
            errMsg = 'CUDA out of memory during generation.\n' +
              'Fix: use a smaller quantization (Q2_K instead of Q4_0)\n' +
              'or reduce resolution (256x256 instead of 512x512).\n\n' + errMsg;
          }
          return resolve({ ok: false, error: errMsg });
        }
        try {
          const stat = await fs.stat(outputPath);
          resolve({ ok: true, outputPath, bytes: stat.size });
        } catch {
          resolve({ ok: false, error: `sd exited OK but output file not found at ${outputPath}` });
        }
      });

      // No hard timeout — CPU generation (Flux Q4 etc.) can take 30-60 min
      // The process will naturally exit when done or on error
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
