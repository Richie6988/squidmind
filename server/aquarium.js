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
  const candidates = [
    { dir: path.join(REPO_ROOT, 'aquarium'), marker: 'BRAIN/poseidon_brain.json' },
    { dir: path.join(REPO_ROOT, 'aquarium'), marker: 'AGENTS/agent_registry.json' },
    { dir: path.join(REPO_ROOT, 'aquarium'), marker: 'MODELS/model_registry.json' },
    { dir: path.join(REPO_ROOT, 'workspace'), marker: 'main/poseidon_brain.json' },
    { dir: path.join(REPO_ROOT, 'workspace'), marker: 'agents/agent_registry.json' },
    { dir: path.join(REPO_ROOT, 'data'), marker: 'main/poseidon_brain.json' },
    { dir: path.join(REPO_ROOT, 'data'), marker: 'agents/agent_registry.json' },
  ];

  for (const { dir, marker } of candidates) {
    if (fs.existsSync(path.join(dir, marker))) return dir;
  }

  // Default to aquarium/ even if empty (will be populated on first run)
  return path.join(REPO_ROOT, 'aquarium');
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

function resolvePath(logical) {
  if (isAquarium) {
    // New layout: aquarium/MODELS, aquarium/AGENTS, etc.
    const MAP = {
      'models':   'MODELS',
      'agents':   'AGENTS',
      'projects': 'PROJECTS',
      'tasks':    'TASKS',
      'logs':     'LOGS',
      'tools':    'TOOLS',
      'skills':   'SKILLS',
      'brain':    'BRAIN',
      'channels': 'CHANNELS',
    };
    // Map relative path strings used in rm.read/write
    const seg = logical.split('/')[0].toLowerCase();
    if (MAP[seg]) {
      return logical.replace(new RegExp(`^${seg}/`, 'i'), MAP[seg] + '/');
    }
    // Handle legacy paths like 'main/poseidon_brain.json'
    if (logical.startsWith('main/')) {
      const file = logical.slice(5);
      if (file === 'poseidon_brain.json' || file === 'dream_memory.json' || file === 'context_checkpoint.json') {
        return 'BRAIN/' + (file === 'context_checkpoint.json' ? 'dream_memory.json' : file);
      }
      if (file === 'comms_config.json') return 'CHANNELS/comms_config.json';
      if (file.startsWith('skills/') || file.startsWith('processes/')) {
        return 'SKILLS/' + file.replace(/^(skills|processes)\//, '');
      }
      return 'BRAIN/' + file;
    }
    return logical;
  } else {
    // Legacy layout: translate AQUARIUM paths back to old paths if needed
    const REV_MAP = {
      'MODELS/':   'models/',
      'AGENTS/':   'agents/',
      'PROJECTS/': 'projects/',
      'TASKS/':    'tasks/',
      'LOGS/':     'logs/',
      'TOOLS/':    'tools/',
      'SKILLS/':   'main/skills/',
      'BRAIN/poseidon_brain.json': 'main/poseidon_brain.json',
      'BRAIN/dream_memory.json':   'main/context_checkpoint.json',
      'CHANNELS/': 'main/',
    };
    for (const [aqPfx, legPfx] of Object.entries(REV_MAP)) {
      if (logical.startsWith(aqPfx)) return logical.replace(aqPfx, legPfx);
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
  SKILLS:   path.join(AQ_ROOT, isAquarium ? 'SKILLS'   : 'main/skills'),
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

console.log(`[Aquarium] Root: ${AQ_ROOT} (${isAquarium ? 'aquarium layout' : 'legacy layout — run node migrate_aquarium.js'})`);
console.log(`[Aquarium] Models: ${AQUARIUM.MODELS_DIR}`);

module.exports = AQUARIUM;
