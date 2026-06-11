'use strict';

/**
 * aquarium.js — Single source of truth for all data paths.
 *
 * The Aquarium is the root data directory.
 * All server code imports paths from here — never hardcodes 'data/', 'workspace/', etc.
 *
 * Auto-detects the correct root in order:
 *   1. aquarium/  (post-migration, preferred)
 *   2. workspace/ (intermediate)
 *   3. data/      (legacy)
 */

const path = require('path');
const fs   = require('fs');

const SERVER_DIR = __dirname;
const REPO_ROOT  = path.join(SERVER_DIR, '..');

function detectRoot() {
  const aqRoot = path.join(REPO_ROOT, 'aquarium');

  // aquarium/ always wins if it exists at all — never fall back to data/ or workspace/
  if (fs.existsSync(aqRoot)) return aqRoot;

  // Legacy fallback (pre-migration only): data/ or workspace/
  for (const legacy of ['data', 'workspace']) {
    const dir = path.join(REPO_ROOT, legacy);
    if (fs.existsSync(path.join(dir, 'main', 'poseidon_brain.json')) ||
        fs.existsSync(path.join(dir, 'agents', 'agent_registry.json'))) {
      console.warn(`[Aquarium] ⚠️  Using legacy root ${legacy}/ — run: node migrate_aquarium.js`);
      return dir;
    }
  }

  return aqRoot; // default
}

function detectModelsDir(root) {
  // Use whichever models dir has actual .gguf files
  const candidates = [
    path.join(REPO_ROOT, 'aquarium', 'MODELS'),
    path.join(REPO_ROOT, 'data', 'models'),
    path.join(REPO_ROOT, 'workspace', 'models'),
    path.join(root, 'MODELS'),
    path.join(root, 'models'),
  ];
  const hasGguf = (dir) => {
    try { return fs.readdirSync(dir).some(f => f.endsWith('.gguf')); } catch { return false; }
  };
  return candidates.find(hasGguf) || path.join(REPO_ROOT, 'aquarium', 'MODELS');
}

const AQ_ROOT = detectRoot();
const isAquarium = AQ_ROOT.endsWith('aquarium');

// ── Path resolver ─────────────────────────────────────────────────────────────
// Maps logical names to physical paths under AQ_ROOT
// Works for all three layouts: aquarium/, workspace/, data/

// Maps legacy relative paths → Aquarium paths, and vice versa.
// Works transparently regardless of which layout is active.
const LEGACY_TO_AQ = [
  // must be ordered: most specific first
  ['main/context_checkpoint.json', 'BRAIN/dream_memory.json'],
  ['main/poseidon_brain.json',     'BRAIN/poseidon_brain.json'],
  ['main/comms_config.json',       'CHANNELS/comms_config.json'],
  ['main/skills/',                 'SKILLS/'],
  ['main/processes/',              'SKILLS/'],
  ['main/',                        'BRAIN/'],
  ['agents/',                      'AGENTS/'],
  ['models/',                      'MODELS/'],
  ['projects/',                    'PROJECTS/'],
  ['tasks/',                       'TASKS/'],
  ['logs/',                        'LOGS/'],
  ['tools/',                       'TOOLS/'],
];

const AQ_TO_LEGACY = [
  ['BRAIN/dream_memory.json',   'main/context_checkpoint.json'],
  ['BRAIN/poseidon_brain.json', 'main/poseidon_brain.json'],
  ['CHANNELS/',                 'main/'],
  ['SKILLS/',                   'main/skills/'],
  ['AGENTS/',                   'agents/'],
  ['MODELS/',                   'models/'],
  ['PROJECTS/',                 'projects/'],
  ['TASKS/',                    'tasks/'],
  ['LOGS/',                     'logs/'],
  ['TOOLS/',                    'tools/'],
  ['BRAIN/',                    'main/'],
];

function resolvePath(logical) {
  if (isAquarium) {
    // Already an aquarium path? pass through
    if (/^(MODELS|AGENTS|PROJECTS|TASKS|LOGS|TOOLS|SKILLS|BRAIN|CHANNELS)[\/]/.test(logical)) {
      return logical;
    }
    // Translate legacy → aquarium
    for (const [from, to] of LEGACY_TO_AQ) {
      if (logical.startsWith(from)) return logical.replace(from, to);
    }
    return logical;
  } else {
    // Legacy layout: translate aquarium → legacy if needed
    if (/^(MODELS|AGENTS|PROJECTS|TASKS|LOGS|TOOLS|SKILLS|BRAIN|CHANNELS)[\/]/.test(logical)) {
      for (const [from, to] of AQ_TO_LEGACY) {
        if (logical.startsWith(from)) return logical.replace(from, to);
      }
    }
    return logical;
  }
}

// ── Exported constants ────────────────────────────────────────────────────────

const AQUARIUM = {
  ROOT:     AQ_ROOT,
  MODELS:   path.join(AQ_ROOT, isAquarium ? 'MODELS'   : 'models'),
  AGENTS:   path.join(AQ_ROOT, isAquarium ? 'AGENTS'   : 'agents'),
  PROJECTS: path.join(AQ_ROOT, isAquarium ? 'PROJECTS' : 'projects'),
  TASKS:    path.join(AQ_ROOT, isAquarium ? 'TASKS'    : 'tasks'),
  LOGS:     path.join(AQ_ROOT, isAquarium ? 'LOGS'     : 'logs'),
  TOOLS:    path.join(AQ_ROOT, isAquarium ? 'TOOLS'    : 'tools'),
  // Skills: use aquarium/SKILLS/ at runtime; server/skills/ is the seeded source in the repo
  SKILLS:   path.join(AQ_ROOT, isAquarium ? 'SKILLS'   : 'main/skills'),
  SKILLS_SEED: path.join(SERVER_DIR, 'skills'),
  BRAIN:    path.join(AQ_ROOT, isAquarium ? 'BRAIN'    : 'main'),
  CHANNELS: path.join(AQ_ROOT, isAquarium ? 'CHANNELS' : 'main'),
  MODELS_DIR: detectModelsDir(AQ_ROOT),

  // Path helpers
  brain:    (...p) => path.join(AQ_ROOT, isAquarium ? 'BRAIN'    : 'main',   ...p),
  agents:   (...p) => path.join(AQ_ROOT, isAquarium ? 'AGENTS'   : 'agents', ...p),
  projects: (...p) => path.join(AQ_ROOT, isAquarium ? 'PROJECTS' : 'projects', ...p),
  tasks:    (...p) => path.join(AQ_ROOT, isAquarium ? 'TASKS'    : 'tasks',  ...p),
  skills:   (...p) => path.join(AQ_ROOT, isAquarium ? 'SKILLS'   : 'main/skills', ...p),
  channels: (...p) => path.join(AQ_ROOT, isAquarium ? 'CHANNELS' : 'main',   ...p),
  logs:     (...p) => path.join(AQ_ROOT, isAquarium ? 'LOGS'     : 'logs',   ...p),
  models:   (...p) => path.join(AQ_ROOT, isAquarium ? 'MODELS'   : 'models', ...p),

  // Relative path resolver for RegistryManager.read/write
  // Translates old relative paths to new ones
  resolve: resolvePath,

  // Well-known file paths
  POSEIDON_BRAIN:       path.join(AQ_ROOT, isAquarium ? 'BRAIN/poseidon_brain.json'    : 'main/poseidon_brain.json'),
  DREAM_MEMORY:         path.join(AQ_ROOT, isAquarium ? 'BRAIN/dream_memory.json'      : 'main/context_checkpoint.json'),
  COMMS_CONFIG:         path.join(AQ_ROOT, isAquarium ? 'CHANNELS/comms_config.json'   : 'main/comms_config.json'),
  AGENT_REGISTRY:       path.join(AQ_ROOT, isAquarium ? 'AGENTS/agent_registry.json'   : 'agents/agent_registry.json'),
  PROJECT_REGISTRY:     path.join(AQ_ROOT, isAquarium ? 'PROJECTS/project_registry.json' : 'projects/project_registry.json'),
  TASKS_REGISTRY:       path.join(AQ_ROOT, isAquarium ? 'TASKS/tasks_registry.json'    : 'tasks/tasks_registry.json'),
  MODEL_REGISTRY:       path.join(AQ_ROOT, isAquarium ? 'MODELS/model_registry.json'   : 'models/model_registry.json'),
  TOOL_REGISTRY:        path.join(AQ_ROOT, isAquarium ? 'TOOLS/tool_registry.json'     : 'tools/tool_registry.json'),
  LOGS_FILE:            path.join(AQ_ROOT, isAquarium ? 'LOGS/logs.json'               : 'logs/logs.json'),
};

// Seed aquarium/SKILLS/ from server/skills/ if empty
;(function seedSkills() {
  const dst = path.join(AQ_ROOT, isAquarium ? 'SKILLS' : 'main/skills');
  const src = path.join(SERVER_DIR, 'skills');
  try {
    fs.mkdirSync(dst, { recursive: true });
    const existing = fs.readdirSync(dst).filter(f => f.endsWith('.json'));
    if (existing.length === 0 && fs.existsSync(src)) {
      for (const f of fs.readdirSync(src)) {
        if (f.endsWith('.json')) {
          fs.copyFileSync(path.join(src, f), path.join(dst, f));
        }
      }
      console.log(`[Aquarium] Seeded ${fs.readdirSync(src).filter(f=>f.endsWith('.json')).length} skills from server/skills/`);
    }
  } catch {}
})();

console.log(`[Aquarium] Root: ${AQ_ROOT} (${isAquarium ? 'aquarium layout' : 'legacy layout — run node migrate_aquarium.js'})`);
console.log(`[Aquarium] Models: ${AQUARIUM.MODELS_DIR}`);

module.exports = AQUARIUM;
