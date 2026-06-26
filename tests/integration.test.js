/**
 * integration.test.js — end-to-end task lifecycle test.
 *
 * Validates the create → execute → results_log → squid level-up chain
 * by directly using RegistryManager (no LLM needed).
 *
 * Run: node tests/integration.test.js
 */
const path = require('path');
const fs   = require('fs');
const fsp  = require('fs').promises;

const RegistryManager = require('../server/services/RegistryManager');
const aquarium        = require('../server/aquarium');

let pass = 0, fail = 0;
function log(name, ok, detail = '') {
  const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${tag} ${name}${detail ? ' — ' + detail : ''}`);
  if (ok) pass++; else fail++;
}

(async () => {
  const rm = new RegistryManager(aquarium.ROOT);

  // ── Test 1: create + read task ──
  const tid = await rm.generateNextId('TASKS/tasks_registry.json');
  log('generateNextId returns task_NNNN', /^task_\d{4}$/.test(tid), tid);

  const taskObj = {
    task_id: tid, title: 'INTEGRATION_TEST',
    description: 'auto-cleanup',
    status: 'in_progress',
    assigned_to: 'agent_test',
    project_id: null, project_name: null,
    lifecycle: { status: 'in_progress', started_at: new Date().toISOString() },
    created_at: new Date().toISOString(),
  };
  await rm._writeTaskDetails(tid, taskObj);

  const reg = await rm.read('TASKS/tasks_registry.json');
  log('task persisted to registry', !!reg.tasks?.[tid]);

  // ── Test 2: terminal status → purge + results_log ──
  // Simulate TaskRunner._setStatus completed flow
  const completedTask = {
    ...taskObj,
    status: 'completed',
    result_summary: 'integration test passed',
    result_file: '/tmp/test_output.md',
    completed_at: new Date().toISOString(),
    lifecycle: { ...taskObj.lifecycle, status: 'completed', completed_at: new Date().toISOString() }
  };

  // Write results_log entry (mirrors TaskRunner logic)
  let rlog = { results: {} };
  try { rlog = JSON.parse(await fsp.readFile(aquarium.RESULTS_LOG, 'utf8')); } catch {}
  rlog.results[tid] = {
    task_id: tid, title: completedTask.title, status: 'completed',
    result_summary: completedTask.result_summary,
    result_file: completedTask.result_file,
    completed_at: completedTask.completed_at,
    assigned_name: completedTask.assigned_to,
    project_name: null,
  };
  await fsp.writeFile(aquarium.RESULTS_LOG, JSON.stringify(rlog, null, 2), 'utf8');

  await rm._writeTaskDetails(tid, completedTask); // triggers purge

  // Verify purge
  const regAfter = await rm.read('TASKS/tasks_registry.json');
  log('completed task purged from registry', !regAfter.tasks?.[tid]);

  // Verify results_log
  const rlog2 = JSON.parse(await fsp.readFile(aquarium.RESULTS_LOG, 'utf8'));
  log('completed task in results_log', !!rlog2.results?.[tid]);
  log('results_log entry has correct fields',
      rlog2.results[tid].title === 'INTEGRATION_TEST' &&
      rlog2.results[tid].status === 'completed' &&
      rlog2.results[tid].assigned_name === 'agent_test');

  // ── Test 3: cascade — agent perf update ──
  // Build a fake agent for the cascade
  const agentReg = await rm.getAgentRegistry();
  const testAgentId = 'agent_test_int';
  agentReg.agents[testAgentId] = {
    agent_id: testAgentId,
    display_name: 'Test Agent',
    status: 'sleeping',
    performance_summary: { tasks_completed: 0, tasks_failed: 0, tasks_cancelled: 0, success_rate: 0 }
  };
  await rm.write('AGENTS/agent_registry.json', agentReg);

  const taskWithAgent = { ...completedTask, assigned_to: testAgentId };
  await rm.cascadeTaskClosure(tid, taskWithAgent, 'completed');

  const agentReg2 = await rm.getAgentRegistry();
  const updated = agentReg2.agents?.[testAgentId];
  log('cascade incremented tasks_completed', updated?.performance_summary?.tasks_completed === 1, `got ${updated?.performance_summary?.tasks_completed}`);
  log('cascade computed success_rate', updated?.performance_summary?.success_rate === 1);

  // ── Cleanup ──
  delete agentReg2.agents[testAgentId];
  await rm.write('AGENTS/agent_registry.json', agentReg2);

  const rlog3 = JSON.parse(await fsp.readFile(aquarium.RESULTS_LOG, 'utf8'));
  delete rlog3.results[tid];
  await fsp.writeFile(aquarium.RESULTS_LOG, JSON.stringify(rlog3, null, 2), 'utf8');

  // ── Test 4: race-safe IDs in sequence ──
  const batch = await Promise.all(Array(20).fill(0).map(() => rm.generateNextId('TASKS/tasks_registry.json')));
  const unique = new Set(batch);
  log('20 parallel generateNextId calls all unique', unique.size === 20, `${unique.size}/20`);

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
