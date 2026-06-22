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
  // A root is "real" if it has a non-empty poseidon_brain that isn't just the seed default.
  // We check this by looking for at least one real registry file beyond the bare seed.
  const hasRealData = (dir) => {
    // Check for poseidon_brain in either layout
    const hasBrain = fs.existsSync(path.join(dir, 'BRAIN', 'poseidon_brain.json'))
                  || fs.existsSync(path.join(dir, 'main', 'poseidon_brain.json'));
    if (!hasBrain) return false;
    // Also require at least one other sign of real data (models or projects populated)
    const hasModels   = fs.existsSync(path.join(dir, 'MODELS', 'model_registry.json'))
                     || fs.existsSync(path.join(dir, 'models', 'model_registry.json'));
    const hasProjects = fs.existsSync(path.join(dir, 'PROJECTS', 'project_registry.json'))
                     || fs.existsSync(path.join(dir, 'projects', 'project_registry.json'));
    return hasModels || hasProjects;
  };

  // Prefer whichever root has real data — aquarium > data > workspace
  for (const name of ['aquarium', 'data', 'workspace']) {
    const dir = path.join(REPO_ROOT, name);
    if (hasRealData(dir)) {
      if (name !== 'aquarium') {
        console.warn(`[Aquarium] ⚠️  Using ${name}/ (has real data) — run: node migrate_aquarium.js --fresh to upgrade to aquarium/`);
      }
      return dir;
    }
  }

  // Nothing has real data — use aquarium/ (will be seeded)
  const aqRoot = path.join(REPO_ROOT, 'aquarium');
  fs.mkdirSync(aqRoot, { recursive: true });
  return aqRoot;
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
  IMAGES:   path.join(AQ_ROOT, isAquarium ? 'TASKS/IMAGES' : 'tasks/images'),
  OUTPUT:   path.join(AQ_ROOT, isAquarium ? 'TASKS/OUTPUT' : 'tasks/output'),
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
  SOUL:                 path.join(AQ_ROOT, isAquarium ? 'BRAIN/soul.json'               : 'main/soul.json'),
  TEMP_LOG:             path.join(AQ_ROOT, isAquarium ? 'BRAIN/temp.md'                 : 'main/temp.md'),
  COMMS_CONFIG:         path.join(AQ_ROOT, isAquarium ? 'CHANNELS/comms_config.json'   : 'main/comms_config.json'),
  AGENT_REGISTRY:       path.join(AQ_ROOT, isAquarium ? 'AGENTS/agent_registry.json'   : 'agents/agent_registry.json'),
  PROJECT_REGISTRY:     path.join(AQ_ROOT, isAquarium ? 'PROJECTS/project_registry.json' : 'projects/project_registry.json'),
  TASKS_REGISTRY:       path.join(AQ_ROOT, isAquarium ? 'TASKS/tasks_registry.json'    : 'tasks/tasks_registry.json'),
  RESULTS_LOG:          path.join(AQ_ROOT, isAquarium ? 'TASKS/results_log.json'       : 'tasks/results_log.json'),
  MODEL_REGISTRY:       path.join(AQ_ROOT, isAquarium ? 'MODELS/model_registry.json'   : 'models/model_registry.json'),
  TOOL_REGISTRY:        path.join(AQ_ROOT, isAquarium ? 'TOOLS/tool_registry.json'     : 'tools/tool_registry.json'),
  LOGS_FILE:            path.join(AQ_ROOT, isAquarium ? 'LOGS/logs.json'               : 'logs/logs.json'),
};

// Seed aquarium/SKILLS/ from server/skills/ if empty
;(function bootstrap() {
  const SEED_DIR = path.join(SERVER_DIR, 'seed');
  const SKILLS_SEED = path.join(SERVER_DIR, 'skills');

  // Map: seed filename → aquarium destination path
  const FILES = [
    { seed: 'poseidon_brain.json',   dst: AQUARIUM.brain('poseidon_brain.json') },
    { seed: 'agent_registry.json',   dst: AQUARIUM.agents('agent_registry.json') },
    { seed: 'project_registry.json', dst: AQUARIUM.projects('project_registry.json') },
    { seed: 'model_registry.json',   dst: AQUARIUM.models('model_registry.json') },
    { seed: 'tool_registry.json',    dst: path.join(AQUARIUM.TOOLS, 'tool_registry.json') },
    { seed: 'logs.json',             dst: AQUARIUM.logs('logs.json') },
    { seed: 'tasks_registry.json',   dst: AQUARIUM.tasks('tasks_registry.json') },
    { seed: 'comms_config.json',     dst: AQUARIUM.channels('comms_config.json') },
    { seed: 'soul.json',             dst: AQUARIUM.SOUL },
    { seed: 'temp.md',               dst: AQUARIUM.TEMP_LOG },
  ];

  let seeded = 0;
  for (const { seed, dst } of FILES) {
    if (!fs.existsSync(dst)) {
      const srcPath = path.join(SEED_DIR, seed);
      if (fs.existsSync(srcPath)) {
        try {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(srcPath, dst);
          seeded++;
        } catch (e) {
          console.warn(`[Aquarium] Could not seed ${seed}:`, e.message);
        }
      } else {
        console.warn(`[Aquarium] Missing seed file: ${srcPath}`);
      }
    }
  }
  if (seeded > 0) console.log(`[Aquarium] Bootstrapped ${seeded} missing files from server/seed/`);

  // Seed skills — copy ONLY if file absent (first install). Never re-seed deleted skills.
  try {
    fs.mkdirSync(AQUARIUM.SKILLS, { recursive: true });
    fs.mkdirSync(AQUARIUM.OUTPUT, { recursive: true });

    if (fs.existsSync(SKILLS_SEED)) {
      // Load deletion blocklist — skills deleted via DELETE route are never re-seeded
      const blocklistPath = path.join(AQUARIUM.SKILLS, '.skills_deleted');
      let deletedSet = new Set();
      try {
        const bl = JSON.parse(fs.readFileSync(blocklistPath, 'utf8'));
        if (Array.isArray(bl)) bl.forEach(id => deletedSet.add(id));
      } catch {}
      AQUARIUM.skillsDeletedPath = blocklistPath; // expose for DELETE route

      let n = 0;
      for (const f of fs.readdirSync(SKILLS_SEED)) {
        if (!f.endsWith('.json')) continue;
        const skillId = f.replace('.json', '');
        if (deletedSet.has(skillId)) continue; // respect user deletion
        const dst = path.join(AQUARIUM.SKILLS, f);
        if (!fs.existsSync(dst)) { fs.copyFileSync(path.join(SKILLS_SEED, f), dst); n++; }
      }
      if (n > 0) console.log(`[Aquarium] Seeded ${n} new skills from server/skills/`);
    }

    // Rebuild skills_registry.json = positive list of skills present on disk
    try {
      const regPath = path.join(AQUARIUM.SKILLS, 'skills_registry.json');
      const entries = {};
      for (const f of fs.readdirSync(AQUARIUM.SKILLS)) {
        if (!f.endsWith('.json') || f === 'skills_registry.json') continue;
        try {
          const s = JSON.parse(fs.readFileSync(path.join(AQUARIUM.SKILLS, f), 'utf8'));
          const id = s.skill_id || f.replace('.json', '');
          entries[id] = {
            skill_id: id, name: s.name || id, version: s.version || 1,
            summary: s.summary || '', triggers: s.triggers || [],
            steps_count: (s.steps || []).length, created_by: s.created_by || 'system',
            file: f
          };
        } catch {}
      }
      fs.writeFileSync(regPath, JSON.stringify({ skills: entries, updated_at: new Date().toISOString() }, null, 2), 'utf8');
      console.log(`[Aquarium] skills_registry.json rebuilt (${Object.keys(entries).length} skills)`);
    } catch (e) { console.warn('[Aquarium] Could not build skills_registry.json:', e.message); }
    } catch {}
})();

console.log(`[Aquarium] Root: ${AQ_ROOT} (${isAquarium ? 'aquarium layout' : 'legacy layout — run node migrate_aquarium.js'})`);
console.log(`[Aquarium] Models: ${AQUARIUM.MODELS_DIR}`);

module.exports = AQUARIUM;
