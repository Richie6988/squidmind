#!/usr/bin/env node
/**
 * migrate.js — one-shot migration script
 *
 * Run ONCE on the server after `git pull`:
 *   node migrate.js
 *
 * What it does:
 *   1. Rename ./data → ./workspace (if ./data exists)
 *   2. Rename agent brain files: squid_brain_003.json → news_runner_013.json
 *      Update agent_registry.json brain_file references
 *   3. Rename project folders: PROJECT_001 → newsroom
 *      Update project_registry.json folder + memory_file references
 *   4. Migrate tasks from flat tasks_registry.json → per-task folders
 *      workspace/tasks/<task_id>/details.json + results/
 *
 * Safe to run multiple times (idempotent — skips already-migrated items).
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const DATA_OLD  = path.join(ROOT, 'data');
const WORKSPACE = path.join(ROOT, 'workspace');

// ── Slug helper ───────────────────────────────────────────────────────────────

function toSlug(name) {
  return (name || 'unknown')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'item';
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}
function exists(p) {
  return fs.existsSync(p);
}

// ── Step 1: data → workspace ──────────────────────────────────────────────────

function step1_renameDataToWorkspace() {
  if (exists(DATA_OLD) && !exists(WORKSPACE)) {
    fs.renameSync(DATA_OLD, WORKSPACE);
    console.log('✅ Step 1: renamed ./data → ./workspace');
  } else if (exists(WORKSPACE)) {
    console.log('ℹ️  Step 1: ./workspace already exists, skipping rename');
  } else {
    console.log('⚠️  Step 1: ./data not found and ./workspace not found — nothing to rename');
    fs.mkdirSync(WORKSPACE, { recursive: true });
    console.log('   Created empty ./workspace');
  }
}

// ── Step 2: rename agent brain files ─────────────────────────────────────────

function step2_renameAgentBrainFiles() {
  const agentsDir  = path.join(WORKSPACE, 'agents');
  const regPath    = path.join(agentsDir, 'agent_registry.json');
  if (!exists(regPath)) { console.log('ℹ️  Step 2: no agent_registry.json — skip'); return; }

  const reg = readJson(regPath);
  const agents = reg.agents || {};
  let changed = 0;

  for (const [agentId, entry] of Object.entries(agents)) {
    const oldBrain = entry.brain_file;
    if (!oldBrain) continue;

    const idNum  = agentId.replace(/\D/g, '');
    const slug   = toSlug(entry.display_name || entry.name || agentId);
    const newBrain = `${slug}_${idNum}.json`;

    if (oldBrain === newBrain) continue; // already migrated

    const oldPath = path.join(agentsDir, oldBrain);
    const newPath = path.join(agentsDir, newBrain);

    if (exists(oldPath) && !exists(newPath)) {
      fs.renameSync(oldPath, newPath);
      console.log(`  🔁 Agent ${agentId}: ${oldBrain} → ${newBrain}`);
    } else if (exists(newPath)) {
      console.log(`  ⏭  Agent ${agentId}: ${newBrain} already exists`);
    } else {
      console.log(`  ⚠️  Agent ${agentId}: brain file ${oldBrain} not found — updating registry only`);
    }

    entry.brain_file = newBrain;
    changed++;
  }

  if (changed > 0) {
    writeJson(regPath, reg);
    console.log(`✅ Step 2: updated ${changed} agent brain file references`);
  } else {
    console.log('ℹ️  Step 2: agent brain files already up to date');
  }
}

// ── Step 3: rename project folders ───────────────────────────────────────────

function step3_renameProjectFolders() {
  const projectsDir = path.join(WORKSPACE, 'projects');
  const regPath     = path.join(projectsDir, 'project_registry.json');
  if (!exists(regPath)) { console.log('ℹ️  Step 3: no project_registry.json — skip'); return; }

  const reg = readJson(regPath);
  const projects = reg.projects || {};
  let changed = 0;

  for (const [pid, entry] of Object.entries(projects)) {
    const oldFolder = entry.folder;
    if (!oldFolder) continue;

    const slug      = toSlug(entry.name || pid);
    const newFolder = slug;

    if (oldFolder === newFolder) continue;

    const oldPath = path.join(projectsDir, oldFolder);
    const newPath = path.join(projectsDir, newFolder);

    if (exists(oldPath) && !exists(newPath)) {
      fs.renameSync(oldPath, newPath);
      console.log(`  🔁 Project ${pid}: ${oldFolder} → ${newFolder}`);
    } else if (exists(newPath)) {
      console.log(`  ⏭  Project ${pid}: ${newFolder} already exists`);
    } else {
      console.log(`  ⚠️  Project ${pid}: folder ${oldFolder} not found — updating registry only`);
    }

    entry.folder      = newFolder;
    entry.memory_file = `${newFolder}/project_memory.json`;
    changed++;
  }

  if (changed > 0) {
    writeJson(regPath, reg);
    console.log(`✅ Step 3: updated ${changed} project folder references`);
  } else {
    console.log('ℹ️  Step 3: project folders already up to date');
  }
}

// ── Step 4: migrate tasks flat → per-folder ───────────────────────────────────

function step4_migrateTasksToFolders() {
  const tasksDir  = path.join(WORKSPACE, 'tasks');
  const regPath   = path.join(tasksDir, 'tasks_registry.json');
  const resultsOld = path.join(tasksDir, 'results');

  if (!exists(tasksDir)) {
    fs.mkdirSync(tasksDir, { recursive: true });
    console.log('ℹ️  Step 4: created tasks/ dir');
  }

  let tasks = {};
  if (exists(regPath)) {
    try { tasks = readJson(regPath).tasks || {}; } catch {}
  }

  let migrated = 0;
  for (const [taskId, task] of Object.entries(tasks)) {
    const taskDir    = path.join(tasksDir, taskId);
    const detailPath = path.join(taskDir, 'details.json');
    if (exists(detailPath)) continue; // already migrated

    fs.mkdirSync(taskDir, { recursive: true });
    fs.mkdirSync(path.join(taskDir, 'results'), { recursive: true });
    writeJson(detailPath, task);

    // Move existing result file if any
    const oldResult = path.join(resultsOld, `${taskId}.txt`);
    if (exists(oldResult)) {
      fs.copyFileSync(oldResult, path.join(taskDir, 'results', 'output.txt'));
      fs.unlinkSync(oldResult);
    }
    migrated++;
  }

  // Keep tasks_registry.json as a backward-compat index (will be rebuilt dynamically)
  if (migrated > 0) {
    console.log(`✅ Step 4: migrated ${migrated} tasks to per-folder structure`);
  } else {
    console.log('ℹ️  Step 4: tasks already in per-folder format (or no tasks)');
  }

  // Clean up old results dir if empty
  if (exists(resultsOld)) {
    try {
      const rem = fs.readdirSync(resultsOld);
      if (rem.length === 0) {
        fs.rmdirSync(resultsOld);
        console.log('  🗑  Removed empty tasks/results/ dir');
      }
    } catch {}
  }
}

// ── Step 5: ensure processes dir exists ──────────────────────────────────────

function step5_ensureProcessesDir() {
  const processesDir = path.join(WORKSPACE, 'main', 'processes');
  if (!exists(processesDir)) {
    fs.mkdirSync(processesDir, { recursive: true });
    console.log('✅ Step 5: created workspace/main/processes/');
  } else {
    console.log('ℹ️  Step 5: processes/ already exists');
  }
}

// ── Run all steps ─────────────────────────────────────────────────────────────

console.log('\n🦑 SquidMind migration starting...\n');
step1_renameDataToWorkspace();
step2_renameAgentBrainFiles();
step3_renameProjectFolders();
step4_migrateTasksToFolders();
step5_ensureProcessesDir();
console.log('\n✅ Migration complete. Restart the server.\n');
