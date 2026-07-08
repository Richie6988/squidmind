#!/usr/bin/env node
'use strict';

/**
 * doctor.js — checks the runtime environment and reports what optional
 * features are ready vs need attention. Run with `npm run doctor`.
 *
 * Nothing here is fatal — SquidMind runs without any of the optional
 * pieces. This just tells the operator what's available so features like
 * image upscale (jimp), Office export (pptxgenjs/docx), email
 * (nodemailer), and voice (a container runtime for Speaches) don't fail
 * mysteriously later.
 */

const { execSync } = require('child_process');

const GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', DIM = '\x1b[2m', RST = '\x1b[0m';
const ok   = (m) => console.log(`${GREEN}  ✓${RST} ${m}`);
const warn = (m) => console.log(`${YEL}  !${RST} ${m}`);
const bad  = (m) => console.log(`${RED}  ✗${RST} ${m}`);

console.log('\nSquidMind environment check\n' + '─'.repeat(40));

// Node modules that back optional features
const mods = [
  ['jimp',       'image upscale (real Lanczos/bicubic resize)'],
  ['pptxgenjs',  'PowerPoint (.pptx) generation'],
  ['docx',       'Word (.docx) generation'],
  ['nodemailer', 'send_email tool'],
  ['node-llama-cpp', 'local model inference (REQUIRED)'],
];
console.log('\nNode packages:');
for (const [m, desc] of mods) {
  try { require.resolve(m); ok(`${m} — ${desc}`); }
  catch { (m === 'node-llama-cpp' ? bad : warn)(`${m} MISSING — ${desc}. Run: npm install`); }
}

// Container runtime for voice (Speaches autostart)
console.log('\nContainer runtime (for voice / Speaches autostart):');
let runtime = null;
for (const bin of ['docker', 'podman']) {
  try {
    const p = execSync(`bash -lc 'command -v ${bin}'`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (p) { runtime = p; ok(`${bin} found at ${p}`); break; }
  } catch { /* keep looking */ }
}
if (!runtime) {
  warn('No docker/podman on the login PATH.');
  console.log(`${DIM}     Voice needs a Speaches server. Either install Docker, or run Speaches`);
  console.log(`     elsewhere and set SPEACHES_URL=http://<host>:8000 in your .env.${RST}`);
}

// GPU (optional, for faster inference + image gen)
console.log('\nGPU:');
try {
  const out = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  if (out) ok(`NVIDIA GPU: ${out}`);
  else warn('nvidia-smi ran but returned nothing.');
} catch {
  warn('No NVIDIA GPU detected (CPU inference will work but be slower).');
}

console.log('\n' + '─'.repeat(40));
console.log('Done. Warnings above are optional features; none block startup.\n');
