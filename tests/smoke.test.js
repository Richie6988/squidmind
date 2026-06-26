/**
 * smoke.test.js — minimal smoke tests for IAQUA critical paths.
 *
 * Run: node tests/smoke.test.js
 *
 * No test framework — exits non-zero on first failure with a clear message.
 * Targets only structural integrity: server boots, registries readable,
 * task ID generation is race-safe, key endpoints respond.
 */

const http = require('http');
const path = require('path');
const fs   = require('fs');

const PORT = 3001;
const BASE = `http://localhost:${PORT}`;
let serverProcess = null;
let pass = 0, fail = 0;

function log(name, ok, detail = '') {
  const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${tag} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(BASE + path, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json };
}

async function waitForBoot(maxMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(BASE + '/api/v2/livez');
      if (r.ok) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

async function startServer() {
  const { spawn } = require('child_process');
  process.env.PORT = String(PORT);
  process.env.IAQUA_CORS_ORIGIN = '*';
  process.env.LOG_LEVEL = 'WARN';
  serverProcess = spawn('node', [path.join(__dirname, '..', 'server', 'index.js')], {
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProcess.stdout.on('data', d => { if (process.env.VERBOSE) process.stdout.write(d); });
  serverProcess.stderr.on('data', d => { if (process.env.VERBOSE) process.stderr.write(d); });

  if (!(await waitForBoot())) throw new Error('Server failed to boot within 30s');
}

async function stopServer() {
  if (!serverProcess) return;
  serverProcess.kill('SIGTERM');
  await new Promise(r => setTimeout(r, 2000));
  if (!serverProcess.killed) serverProcess.kill('SIGKILL');
}

// ── Tests ──────────────────────────────────────────────────────────────────

async function testLivez() {
  const { status, body } = await fetchJson('/api/v2/livez');
  log('GET /livez returns 200 alive', status === 200 && body.status === 'alive');
}

async function testReadyz() {
  const { status, body } = await fetchJson('/api/v2/readyz');
  log('GET /readyz returns 200 ready', status === 200 && body.status === 'ready');
}

async function testHealth() {
  const { status, body } = await fetchJson('/api/v2/health');
  log('GET /health returns up/degraded', status === 200 && ['up', 'degraded'].includes(body.status), `status=${body.status}`);
  log('GET /health includes checks', body.checks && Object.keys(body.checks).length > 0);
  log('GET /health response_time_ms reported', typeof body.response_time_ms === 'number');
}

async function testAgentsRoute() {
  const { status, body } = await fetchJson('/api/v2/agents');
  log('GET /agents returns 200', status === 200);
  log('GET /agents returns array or registry', Array.isArray(body) || Array.isArray(body.agents) || body.registry);
}

async function testProjectsRoute() {
  const { status, body } = await fetchJson('/api/v2/projects');
  log('GET /projects returns 200', status === 200);
}

async function testTasksRoute() {
  const { status, body } = await fetchJson('/api/v2/tasks');
  log('GET /tasks returns 200', status === 200);
}

async function testRaceSafeTaskIds() {
  // Hit a non-existent batch endpoint — point is to verify the route responds 404 cleanly
  // (we can't actually create tasks without Poseidon loaded). Instead check registry directly.
  const RegistryManager = require(path.join(__dirname, '..', 'server', 'services', 'RegistryManager'));
  const aquarium = require(path.join(__dirname, '..', 'server', 'aquarium'));
  const rm = new RegistryManager(aquarium.ROOT);

  // Generate 10 IDs in parallel — verify all unique
  const ids = await Promise.all(Array(10).fill(0).map(() => rm.generateNextId('TASKS/tasks_registry.json')));
  const unique = new Set(ids);
  log('generateNextId race-safe: 10 parallel calls produce 10 unique IDs', unique.size === 10, `got ${unique.size}/10 unique`);
  log('Task IDs follow task_NNNN format', ids.every(id => /^task_\d{4}$/.test(id)), `sample=${ids[0]}`);
}

async function testBackupsList() {
  const { status, body } = await fetchJson('/api/v2/backups');
  log('GET /backups returns 200', status === 200);
  log('GET /backups has hourly+daily arrays', Array.isArray(body.hourly) && Array.isArray(body.daily));
}

async function testCors() {
  const res = await fetch(BASE + '/api/v2/livez', { method: 'OPTIONS', headers: { 'Origin': 'http://localhost:3000', 'Access-Control-Request-Method': 'GET' } });
  log('CORS preflight allows configured origin', res.status === 204 || res.status === 200);
}

// ── Runner ─────────────────────────────────────────────────────────────────

(async () => {
  console.log('Starting IAQUA smoke tests…\n');
  try {
    await startServer();
    console.log('Server booted on port', PORT, '\n');

    await testLivez();
    await testReadyz();
    await testHealth();
    await testAgentsRoute();
    await testProjectsRoute();
    await testTasksRoute();
    await testRaceSafeTaskIds();
    await testBackupsList();
    await testCors();

    console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  } catch (e) {
    console.error('\n\x1b[31mFATAL:\x1b[0m', e.message);
    fail++;
  } finally {
    await stopServer();
    process.exit(fail > 0 ? 1 : 0);
  }
})();
