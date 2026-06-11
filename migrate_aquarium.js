#!/usr/bin/env node
/**
 * migrate_aquarium.js — one-shot migration to the Aquarium folder structure
 *
 * Run ONCE after git pull:
 *   node migrate_aquarium.js
 *
 * Maps:
 *   data/models/           → aquarium/MODELS/
 *   data/tools/            → aquarium/TOOLS/
 *   data/main/comms_config.json → aquarium/CHANNELS/comms_config.json
 *   data/projects/         → aquarium/PROJECTS/
 *   data/tasks/            → aquarium/TASKS/
 *   data/agents/           → aquarium/AGENTS/
 *   data/logs/             → aquarium/LOGS/
 *   data/main/skills/ or workspace/main/skills/ → aquarium/SKILLS/
 *   data/main/poseidon_brain.json  → aquarium/BRAIN/poseidon_brain.json
 *   data/main/context_checkpoint.json → aquarium/BRAIN/context_checkpoint.json
 *   workspace/ (anything remaining) → merged in
 *
 * Agent brain files renamed to slug_id.json if not already.
 * Project folders renamed to slug if not already.
 * Tasks migrated to per-folder structure.
 *
 * Safe to run multiple times (idempotent).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const AQ   = path.join(ROOT, 'aquarium');

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSlug(name) {
  return (name || 'unknown')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'item';
}

function rj(p)  { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function wj(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8'); }
function ex(p)  { return fs.existsSync(p); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }

function copyDir(src, dst) {
  if (!ex(src)) return 0;
  mkdir(dst);
  let count = 0;
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    if (ent.name === '.gitkeep') continue;
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) {
      count += copyDir(s, d);
    } else if (!ex(d)) {
      fs.copyFileSync(s, d);
      count++;
    }
  }
  return count;
}

// ── Find source roots ─────────────────────────────────────────────────────────

function findSourceRoot() {
  const candidates = [
    path.join(ROOT, 'data'),
    path.join(ROOT, 'workspace'),
  ].filter(ex);
  // Prefer the one with actual data files
  for (const c of candidates) {
    if (ex(path.join(c, 'main', 'poseidon_brain.json')) ||
        ex(path.join(c, 'agents', 'agent_registry.json'))) {
      return c;
    }
  }
  return candidates[0] || path.join(ROOT, 'data');
}

// ── Main migration ────────────────────────────────────────────────────────────

// --fresh flag: wipe aquarium/ before migrating (clean slate)
if (process.argv.includes('--fresh')) {
  if (ex(AQ)) {
    const { execSync } = require('child_process');
    execSync(`rm -rf "${AQ}"`);
    console.log('🗑  --fresh: wiped existing aquarium/');
  }
}

console.log('\n🦑 Aquarium migration starting...\n');

const SRC = findSourceRoot();
const SRC_WS = path.join(ROOT, 'workspace');
const SRC_DATA = path.join(ROOT, 'data');
console.log(`Source root: ${SRC}`);

// Step 1 — Create Aquarium structure
const dirs = ['MODELS','TOOLS','CHANNELS','PROJECTS','TASKS','AGENTS','LOGS','SKILLS','BRAIN'];
dirs.forEach(d => mkdir(path.join(AQ, d)));
console.log('✅ Created aquarium/ structure');

// Step 2 — MODELS
{
  const n = copyDir(path.join(SRC, 'models'), path.join(AQ, 'MODELS'));
  // Also check data/models if SRC is workspace
  if (SRC !== SRC_DATA) copyDir(path.join(SRC_DATA, 'models'), path.join(AQ, 'MODELS'));
  console.log(`✅ MODELS: copied files`);
}

// Step 3 — TOOLS
{
  copyDir(path.join(SRC, 'tools'), path.join(AQ, 'TOOLS'));
  if (SRC !== SRC_DATA) copyDir(path.join(SRC_DATA, 'tools'), path.join(AQ, 'TOOLS'));
  console.log('✅ TOOLS: copied');
}

// Step 4 — CHANNELS (comms config)
{
  const src = path.join(SRC, 'main', 'comms_config.json');
  const dst = path.join(AQ, 'CHANNELS', 'comms_config.json');
  if (ex(src) && !ex(dst)) { fs.copyFileSync(src, dst); console.log('✅ CHANNELS: comms_config.json copied'); }
  else if (!ex(dst)) { wj(dst, { telegram: { enabled: false, token: '', allowed_chat_ids: [] }, discord: { enabled: false, token: '', allowed_channel_ids: [], allowed_user_ids: [] }, history: [] }); console.log('✅ CHANNELS: created default comms_config.json'); }
  else console.log('ℹ️  CHANNELS: already exists');
}

// Step 5 — AGENTS: always create Bobby as the single clean agent
{
  const dstAgentsDir = path.join(AQ, 'AGENTS');
  const dstRegistry  = path.join(dstAgentsDir, 'agent_registry.json');
  mkdir(dstAgentsDir);

  // Only create Bobby if registry doesn't already exist (idempotent)
  if (!ex(dstRegistry)) {
    const bobby = {
      schema_version: '2.0', schema_type: 'agent_brain',
      identity: { agent_id: 'agent_001', display_name: 'Bobby', specialization: 'general',
        role: 'Versatile general-purpose agent. Handles research, file tasks, coordination, and anything Poseidon delegates.' },
      brain_config: {
        system_prompt: "You are Bobby, a capable and autonomous AI agent working inside SquidMind. You are Poseidon's right hand — reliable, thorough, and direct. You complete tasks fully and report results clearly. You never pretend to have done something you haven't.",
        model_binding: { preferred_model_id: null },
        inference_params: { max_tokens_per_response: 2048, temperature: 0.7 }
      },
      personality: {
        traits: { curiosity: 0.75, thoroughness: 0.85, creativity: 0.6, assertiveness: 0.65, empathy: 0.5 },
        communication_style: 'professional', default_mood: 'focused'
      },
      capabilities: {
        skills: { research: 0.8, file_management: 0.75, data_analysis: 0.7, code_review: 0.6, documentation: 0.8 },
        tools_allowed: ['web_search','web_fetch','read_file','write_file','list_files','get_datetime','calculator','json_parse','json_stringify','get_file_info']
      },
      appearance: { primary_color: '#4facfe', accent_color: '#00f2fe', size_scale: 1.0,
        accessories: { hat: 'cap', glasses: 'none', eyes: 'happy', outfit: 'none' } },
      status: 'sleeping', assigned_projects: [],
      created_at: new Date().toISOString(), created_by: 'system_init'
    };
    wj(path.join(dstAgentsDir, 'bobby_001.json'), bobby);
    wj(dstRegistry, {
      schema_version: '2.0', schema_type: 'agent_registry',
      metadata: { total_agents: 1, last_updated_at: new Date().toISOString() },
      agents: { agent_001: { agent_id: 'agent_001', display_name: 'Bobby', specialization: 'general',
        status: 'sleeping', brain_file: 'bobby_001.json', assigned_projects: [],
        created_at: new Date().toISOString() } }
    });
    console.log('✅ AGENTS: Bobby (agent_001) created fresh');
  } else {
    console.log('ℹ️  AGENTS: registry already exists, skipping');
  }
}

// Step 6 — PROJECTS (with slug folder rename)
{
  const srcProjDir = path.join(SRC, 'projects');
  const dstProjDir = path.join(AQ, 'PROJECTS');
  const regSrc     = path.join(srcProjDir, 'project_registry.json');

  if (ex(regSrc)) {
    const reg = rj(regSrc);
    let changed = 0;
    for (const [pid, entry] of Object.entries(reg.projects || {})) {
      const oldFolder = entry.folder;
      if (!oldFolder) continue;
      const slug      = toSlug(entry.name || pid);
      const newFolder = slug;
      const oldPath   = path.join(srcProjDir, oldFolder);
      const newPath   = path.join(dstProjDir, newFolder);
      if (ex(oldPath) && !ex(newPath)) {
        copyDir(oldPath, newPath);
        console.log(`  🔁 Project ${pid}: ${oldFolder} → ${newFolder}`);
      } else if (!ex(newPath)) {
        mkdir(path.join(newPath, 'input'));
        mkdir(path.join(newPath, 'output'));
        // Create default memory
        wj(path.join(newPath, 'project_memory.json'), { project_id: pid, name: entry.name, created_at: new Date().toISOString(), notes: [] });
      }
      entry.folder      = newFolder;
      entry.memory_file = `${newFolder}/project_memory.json`;
      changed++;
    }
    mkdir(dstProjDir);
    wj(path.join(dstProjDir, 'project_registry.json'), reg);
    console.log(`✅ PROJECTS: ${changed} projects migrated`);
  } else {
    mkdir(dstProjDir);
    console.log('ℹ️  PROJECTS: no registry found');
  }
}

// Step 7 — TASKS (per-folder structure)
{
  const srcTasksDir = path.join(SRC, 'tasks');
  const dstTasksDir = path.join(AQ, 'TASKS');
  mkdir(path.join(dstTasksDir, 'OUTPUT'));

  const regSrc = path.join(srcTasksDir, 'tasks_registry.json');
  let tasks = {};
  if (ex(regSrc)) {
    try { tasks = rj(regSrc).tasks || {}; } catch {}
  }

  // Also scan existing per-folder tasks
  if (ex(srcTasksDir)) {
    for (const ent of fs.readdirSync(srcTasksDir, { withFileTypes: true })) {
      if (!ent.isDirectory() || !ent.name.startsWith('task_')) continue;
      const detailSrc = path.join(srcTasksDir, ent.name, 'details.json');
      if (ex(detailSrc)) {
        try { tasks[ent.name] = rj(detailSrc); } catch {}
      }
    }
  }

  let migrated = 0;
  for (const [taskId, task] of Object.entries(tasks)) {
    const taskDir    = path.join(dstTasksDir, taskId);
    const detailDst  = path.join(taskDir, 'details.json');
    if (!ex(detailDst)) {
      mkdir(path.join(taskDir, 'results'));
      wj(detailDst, task);
      // Copy existing result if any
      const oldResult = path.join(srcTasksDir, taskId, 'results', 'output.txt');
      const oldResult2 = path.join(srcTasksDir, 'results', `${taskId}.txt`);
      const dstResult  = path.join(taskDir, 'results', 'output.txt');
      if (ex(oldResult) && !ex(dstResult)) fs.copyFileSync(oldResult, dstResult);
      else if (ex(oldResult2) && !ex(dstResult)) fs.copyFileSync(oldResult2, dstResult);
      migrated++;
    }
  }
  console.log(`✅ TASKS: ${migrated} tasks migrated to per-folder structure`);
}

// Step 8 — LOGS
{
  copyDir(path.join(SRC, 'logs'), path.join(AQ, 'LOGS'));
  if (SRC !== SRC_DATA) copyDir(path.join(SRC_DATA, 'logs'), path.join(AQ, 'LOGS'));
  console.log('✅ LOGS: copied');
}

// Step 9 — SKILLS
{
  // Try workspace/main/skills first, then data/main/skills, then workspace/main/processes
  const candidates = [
    path.join(ROOT, 'workspace', 'main', 'skills'),
    path.join(SRC, 'main', 'skills'),
    path.join(ROOT, 'workspace', 'main', 'processes'),
    path.join(SRC, 'main', 'processes'),
  ];
  let copied = 0;
  for (const c of candidates) {
    if (ex(c)) { copied += copyDir(c, path.join(AQ, 'SKILLS')); }
  }
  console.log(`✅ SKILLS: ${copied} files copied`);
}

// Step 10 — BRAIN
{
  const brainDst = path.join(AQ, 'BRAIN');
  mkdir(brainDst);

  // poseidon_brain.json
  const brainSrc = path.join(SRC, 'main', 'poseidon_brain.json');
  const brainDst2 = path.join(brainDst, 'poseidon_brain.json');
  if (ex(brainSrc) && !ex(brainDst2)) {
    fs.copyFileSync(brainSrc, brainDst2);
    console.log('  ✅ BRAIN: poseidon_brain.json copied');
  }

  // context_checkpoint.json → dream_memory.json (the "dream" memory concept)
  const checkSrc = path.join(SRC, 'main', 'context_checkpoint.json');
  const dreamDst = path.join(brainDst, 'dream_memory.json');
  if (ex(checkSrc) && !ex(dreamDst)) {
    fs.copyFileSync(checkSrc, dreamDst);
    console.log('  ✅ BRAIN: context_checkpoint.json → dream_memory.json');
  } else if (!ex(dreamDst)) {
    wj(dreamDst, { note: 'Populated by Poseidon before session wipes', summary: null, saved_at: null });
  }

  console.log('✅ BRAIN: done');
}

// Step 11 — .gitkeep all empty dirs
{
  for (const d of dirs) {
    const p = path.join(AQ, d, '.gitkeep');
    if (!ex(p)) fs.writeFileSync(p, '');
  }
}

console.log('\n✅ Aquarium migration complete!');
console.log('👉 Next: restart the server (npm start)');
console.log('👉 When confirmed working: remove data/ and workspace/ folders\n');
