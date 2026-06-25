'use strict';

/**
 * aquarium.js — Single source of truth for all data paths.
 *
 * Root: <repo>/aquarium/
 * Layout: uppercase subdirectories (BRAIN, AGENTS, MODELS, PROJECTS, TASKS,
 * LOGS, TOOLS, SKILLS, CHANNELS).
 *
 * resolve(logical) translates older lowercase paths (main/, agents/, models/,
 * projects/, tasks/, logs/, tools/) and a few historical filenames
 * (main/context_checkpoint.json → BRAIN/dream_memory.json) onto the canonical
 * uppercase layout so services that still pass legacy paths to rm.read/.write
 * keep working without churn.
 */

const path = require('path');
const fs   = require('fs');

const log = require('./utils/logger').createLogger('Aquarium');
const SERVER_DIR = __dirname;
const REPO_ROOT  = path.join(SERVER_DIR, '..');
const AQ_ROOT    = path.join(REPO_ROOT, 'aquarium');

fs.mkdirSync(AQ_ROOT, { recursive: true });

function detectModelsDir() {
  const aquariumModels = path.join(AQ_ROOT, 'MODELS');
  const repoModels     = path.join(REPO_ROOT, 'models');  // some setups keep big GGUFs outside aquarium/
  const hasGguf = (dir) => {
    try { return fs.readdirSync(dir).some(f => f.endsWith('.gguf')); } catch { return false; }
  };
  if (hasGguf(aquariumModels)) return aquariumModels;
  if (hasGguf(repoModels))     return repoModels;
  return aquariumModels;  // default — will be created on first import
}

// ── Logical-path translator ───────────────────────────────────────────────────
// Maps older lowercase paths → canonical uppercase layout. Allows services to
// keep passing 'main/poseidon_brain.json' etc. while we resolve to BRAIN/.
const LEGACY_TO_AQ = [
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

function resolvePath(logical) {
  if (/^(MODELS|AGENTS|PROJECTS|TASKS|LOGS|TOOLS|SKILLS|BRAIN|CHANNELS)[\/]/.test(logical)) {
    return logical;  // already canonical
  }
  for (const [from, to] of LEGACY_TO_AQ) {
    if (logical.startsWith(from)) return logical.replace(from, to);
  }
  return logical;
}

// ── Exported constants ────────────────────────────────────────────────────────

const AQUARIUM = {
  ROOT:     AQ_ROOT,
  MODELS:   path.join(AQ_ROOT, 'MODELS'),
  AGENTS:   path.join(AQ_ROOT, 'AGENTS'),
  PROJECTS: path.join(AQ_ROOT, 'PROJECTS'),
  TASKS:    path.join(AQ_ROOT, 'TASKS'),
  IMAGES:   path.join(AQ_ROOT, 'TASKS/IMAGES'),
  OUTPUT:   path.join(AQ_ROOT, 'TASKS/OUTPUT'),
  LOGS:     path.join(AQ_ROOT, 'LOGS'),
  TOOLS:    path.join(AQ_ROOT, 'TOOLS'),
  SKILLS:   path.join(AQ_ROOT, 'SKILLS'),
  SKILLS_SEED: path.join(SERVER_DIR, 'skills'),
  BRAIN:    path.join(AQ_ROOT, 'BRAIN'),
  CHANNELS: path.join(AQ_ROOT, 'CHANNELS'),
  MODELS_DIR: detectModelsDir(),

  // Path helpers
  brain:    (...p) => path.join(AQ_ROOT, 'BRAIN',    ...p),
  agents:   (...p) => path.join(AQ_ROOT, 'AGENTS',   ...p),
  projects: (...p) => path.join(AQ_ROOT, 'PROJECTS', ...p),
  tasks:    (...p) => path.join(AQ_ROOT, 'TASKS',    ...p),
  skills:   (...p) => path.join(AQ_ROOT, 'SKILLS',   ...p),
  channels: (...p) => path.join(AQ_ROOT, 'CHANNELS', ...p),
  logs:     (...p) => path.join(AQ_ROOT, 'LOGS',     ...p),
  models:   (...p) => path.join(AQ_ROOT, 'MODELS',   ...p),

  resolve: resolvePath,

  // Well-known file paths
  POSEIDON_BRAIN:   path.join(AQ_ROOT, 'BRAIN/poseidon_brain.json'),
  DREAM_MEMORY:     path.join(AQ_ROOT, 'BRAIN/dream_memory.json'),
  SOUL:             path.join(AQ_ROOT, 'BRAIN/soul.json'),
  TEMP_LOG:         path.join(AQ_ROOT, 'BRAIN/temp.md'),
  COMMS_CONFIG:     path.join(AQ_ROOT, 'CHANNELS/comms_config.json'),
  AGENT_REGISTRY:   path.join(AQ_ROOT, 'AGENTS/agent_registry.json'),
  PROJECT_REGISTRY: path.join(AQ_ROOT, 'PROJECTS/project_registry.json'),
  TASKS_REGISTRY:   path.join(AQ_ROOT, 'TASKS/tasks_registry.json'),
  RESULTS_LOG:      path.join(AQ_ROOT, 'TASKS/results_log.json'),
  MODEL_REGISTRY:   path.join(AQ_ROOT, 'MODELS/model_registry.json'),
  TOOL_REGISTRY:    path.join(AQ_ROOT, 'TOOLS/tool_registry.json'),
  LOGS_FILE:        path.join(AQ_ROOT, 'LOGS/logs.json'),
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
          log.warn(`Could not seed ${seed}:`, e.message);
        }
      } else {
        log.warn(`Missing seed file: ${srcPath}`);
      }
    }
  }
  if (seeded > 0) log.info(`Bootstrapped ${seeded} missing files from server/seed/`);

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
      if (n > 0) log.info(`Seeded ${n} new skills from server/skills/`);
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
      log.info(`skills_registry.json rebuilt (${Object.keys(entries).length} skills)`);
    } catch (e) { log.warn('Could not build skills_registry.json:', e.message); }
    } catch {}
})();

log.info(`Root: ${AQ_ROOT}`);
log.info(`Models: ${AQUARIUM.MODELS_DIR}`);

module.exports = AQUARIUM;
