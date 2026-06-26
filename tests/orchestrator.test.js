'use strict';

/**
 * tests/orchestrator.test.js — direct unit-style tests for PoseidonOrchestrator handlers.
 *
 * Goals:
 *   - Test the skill-handling code paths added in pack #2 (telemetry) and
 *     touched in pack #1 (cleanup) without spinning up the LLM.
 *   - Lock in current behavior so future refactors break loudly.
 *
 * Strategy: instantiate PoseidonOrchestrator against a real RegistryManager
 * pointed at a TEMP aquarium dir (so tests can't corrupt repo state). The
 * orchestrator's modelService dependency is set to null — none of the
 * skill handlers touch it.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const os = require('os');

const results = [];
function log(label, ok, detail = '') {
  results.push({ label, ok, detail });
  const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${tag} ${label}${detail ? ' — ' + detail : ''}`);
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// ── Set up isolated aquarium BEFORE requiring anything ──────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'iaqua-orch-'));
process.env.IAQUA_DATA_ROOT = TMP;  // some modules read this
// aquarium.js detects via __dirname relative to server/, so we need to seed
// the canonical layout manually before instantiating RegistryManager.
const AQ = path.join(TMP, 'aquarium');
for (const sub of ['BRAIN', 'AGENTS', 'PROJECTS', 'TASKS', 'TASKS/OUTPUT', 'MODELS', 'LOGS', 'TOOLS', 'SKILLS', 'CHANNELS']) {
  fs.mkdirSync(path.join(AQ, sub), { recursive: true });
}
// Minimal seed to avoid bootstrap noise
fs.writeFileSync(path.join(AQ, 'BRAIN', 'poseidon_brain.json'), JSON.stringify({ identity: { name: 'Poseidon' } }, null, 2));
fs.writeFileSync(path.join(AQ, 'AGENTS', 'agent_registry.json'), JSON.stringify({ agents: {} }, null, 2));
fs.writeFileSync(path.join(AQ, 'PROJECTS', 'project_registry.json'), JSON.stringify({ projects: {} }, null, 2));
fs.writeFileSync(path.join(AQ, 'TASKS', 'tasks_registry.json'), JSON.stringify({ tasks: {} }, null, 2));
fs.writeFileSync(path.join(AQ, 'MODELS', 'model_registry.json'), JSON.stringify({ models: {} }, null, 2));
fs.writeFileSync(path.join(AQ, 'LOGS', 'logs.json'), JSON.stringify({
  entries: [],
  metadata: { total_entries: 0, last_entry_id: 0 }
}, null, 2));
fs.writeFileSync(path.join(AQ, 'TOOLS', 'tool_registry.json'), JSON.stringify({ tools: {} }, null, 2));

// PoseidonOrchestrator reads aquarium paths via require('../aquarium'), which
// detects the path at module-load time from __dirname. Our test temp dir won't
// be picked up unless we monkey-patch. Simplest approach: write skills under
// the REAL aquarium dir and clean up at the end. To stay isolated and not
// touch the user's repo, we instead point AQUARIUM.SKILLS into our temp dir
// by intercepting the require.
const ROOT = path.join(__dirname, '..');
const realAquarium = require(path.join(ROOT, 'server', 'aquarium'));
// Override the path constants we touch in the skill handlers
const origSkills = realAquarium.SKILLS;
const origOutput = realAquarium.OUTPUT;
realAquarium.SKILLS = path.join(AQ, 'SKILLS');
realAquarium.OUTPUT = path.join(AQ, 'TASKS', 'OUTPUT');
realAquarium.ROOT   = AQ;

const RegistryManager     = require(path.join(ROOT, 'server', 'services', 'RegistryManager'));
const PoseidonOrchestrator = require(path.join(ROOT, 'server', 'services', 'PoseidonOrchestrator'));

async function cleanup() {
  // Restore aquarium constants so subsequent test runs see real paths
  realAquarium.SKILLS = origSkills;
  realAquarium.OUTPUT = origOutput;
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
}

async function main() {
  const rm = new RegistryManager(AQ);
  const orch = new PoseidonOrchestrator({
    registryManager: rm,
    modelService: null,           // skill handlers don't need it
    workspaceRoot: ROOT,
  });

  // ── 1. _listSkills on empty dir ─────────────────────────────────────────────
  let res = await orch._listSkills();
  log('listSkills returns ok on empty dir', res.ok === true && res.count === 0);
  log('listSkills.skills is an array',      Array.isArray(res.skills) && res.skills.length === 0);

  // ── 2. Seed two skills directly to disk, then list ─────────────────────────
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'alpha.json'), JSON.stringify({
    skill_id: 'alpha', name: 'Alpha', version: 1, summary: 'First test skill',
    triggers: ['first'], steps: [{ order: 1, action: 'do' }]
  }));
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'beta.json'), JSON.stringify({
    skill_id: 'beta', name: 'Beta', version: 2, summary: 'Second test skill',
    triggers: ['second', 'two'], steps: [{ order: 1, action: 'do2' }]
  }));

  res = await orch._listSkills();
  log('listSkills sees both seeded skills', res.count === 2);
  log('listSkills returns expected fields',
      res.skills[0].usage_count === 0 && res.skills[0].last_outcome === null && res.skills[0].success_rate === null);

  // ── 3. _bumpSkillUsage increments and timestamps ───────────────────────────
  await orch._bumpSkillUsage('alpha');
  let raw = JSON.parse(fs.readFileSync(path.join(realAquarium.SKILLS, 'alpha.json'), 'utf8'));
  log('bumpSkillUsage sets usage_count=1', raw.usage_count === 1);
  log('bumpSkillUsage sets last_used_at',  typeof raw.last_used_at === 'string' && raw.last_used_at.includes('T'));

  await orch._bumpSkillUsage('alpha');
  await orch._bumpSkillUsage('alpha');
  raw = JSON.parse(fs.readFileSync(path.join(realAquarium.SKILLS, 'alpha.json'), 'utf8'));
  log('bumpSkillUsage increments on each call', raw.usage_count === 3);

  // ── 4. bumpSkillUsage on missing skill is a no-op (no throw) ───────────────
  let threw = false;
  try { await orch._bumpSkillUsage('does_not_exist'); } catch { threw = true; }
  log('bumpSkillUsage swallows missing skill', !threw);

  // ── 5. _recordSkillOutcome — happy path ────────────────────────────────────
  res = await orch._recordSkillOutcome({ skill_id: 'alpha', outcome: 'success', note: 'worked great' });
  log('recordSkillOutcome ok',           res.ok === true);
  log('recordSkillOutcome echoes id',    res.skill_id === 'alpha' && res.outcome === 'success');
  raw = JSON.parse(fs.readFileSync(path.join(realAquarium.SKILLS, 'alpha.json'), 'utf8'));
  log('recordSkillOutcome writes last_outcome',     raw.last_outcome === 'success');
  log('recordSkillOutcome writes last_outcome_at',  typeof raw.last_outcome_at === 'string');
  log('recordSkillOutcome writes note (truncated)', raw.last_outcome_note === 'worked great');
  log('recordSkillOutcome init counts',  eq(raw.outcome_counts, { success: 1, partial: 0, fail: 0 }));

  await orch._recordSkillOutcome({ skill_id: 'alpha', outcome: 'success' });
  await orch._recordSkillOutcome({ skill_id: 'alpha', outcome: 'fail' });
  raw = JSON.parse(fs.readFileSync(path.join(realAquarium.SKILLS, 'alpha.json'), 'utf8'));
  log('recordSkillOutcome accumulates counts', eq(raw.outcome_counts, { success: 2, partial: 0, fail: 1 }));

  // Note truncation
  const longNote = 'x'.repeat(500);
  await orch._recordSkillOutcome({ skill_id: 'alpha', outcome: 'partial', note: longNote });
  raw = JSON.parse(fs.readFileSync(path.join(realAquarium.SKILLS, 'alpha.json'), 'utf8'));
  log('recordSkillOutcome truncates note to 240 chars', raw.last_outcome_note.length === 240);

  // ── 6. _recordSkillOutcome — error paths ──────────────────────────────────
  res = await orch._recordSkillOutcome({ skill_id: 'alpha', outcome: 'maybe' });
  log('recordSkillOutcome rejects bad outcome', res.ok === false && /outcome must be/.test(res.error));

  res = await orch._recordSkillOutcome({});
  log('recordSkillOutcome rejects missing args', res.ok === false);

  res = await orch._recordSkillOutcome({ skill_id: 'ghost', outcome: 'success' });
  log('recordSkillOutcome rejects missing skill', res.ok === false && /not found/.test(res.error));

  // ── 7. _listSkills sorts by recency, exposes computed success_rate ────────
  res = await orch._listSkills();
  const alpha = res.skills.find(s => s.skill_id === 'alpha');
  const beta  = res.skills.find(s => s.skill_id === 'beta');
  log('listSkills places used skill before unused',
      res.skills[0].skill_id === 'alpha',
      `order: ${res.skills.map(s => s.skill_id).join(', ')}`);
  log('listSkills computes success_rate',
      alpha.success_rate === 50,  // 2 success / (2+1+1 partial) = 50%
      `alpha.success_rate=${alpha.success_rate}`);
  log('listSkills shows null success_rate for unused', beta.success_rate === null);
  log('listSkills exposes last_outcome',  alpha.last_outcome === 'partial');
  log('listSkills exposes usage_count',   alpha.usage_count === 3);

  // ── 8. Skip skills_registry.json (regression test for the bug pack #2 fixed) ──
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'skills_registry.json'),
                   JSON.stringify({ registry: { meta: 'should be ignored' } }));
  res = await orch._listSkills();
  log('listSkills ignores skills_registry.json',
      res.count === 2 && !res.skills.find(s => s.skill_id === 'skills_registry'),
      `count=${res.count}`);

  // ── 9. _deleteSkill ────────────────────────────────────────────────────────
  res = await orch._deleteSkill({ skill_id: 'beta' });
  log('deleteSkill ok',          res.ok === true);
  log('deleteSkill removes file', !fs.existsSync(path.join(realAquarium.SKILLS, 'beta.json')));

  res = await orch._deleteSkill({ skill_id: 'beta' });
  log('deleteSkill on missing fails gracefully', res.ok === false && /not found/.test(res.error));

  // ── 10. write_skill via tool wiring ───────────────────────────────────────
  // Exercises the full path: buildFunctions → defineChatSessionFunction wrapper → handler.
  // node-llama-cpp's defineChatSessionFunction is async-loaded inside buildFunctions,
  // so we can't easily invoke through it here. Instead test the handler logic by
  // calling the handler directly via the function definitions map.
  // For now, validate via direct file ops that write_skill semantics work end-to-end.
  // (Re-run by re-listing after a fresh write below.)

  // Simulate what write_skill does: write a new skill file, then verify list picks it up.
  const newSkill = {
    skill_id: 'gamma', name: 'Gamma', version: 1, summary: 'Created from test',
    triggers: ['test_trigger'], steps: [{ order: 1, action: 'do' }],
    notes: ['careful with X'], created_by: 'poseidon', updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'gamma.json'), JSON.stringify(newSkill, null, 2));
  res = await orch._listSkills();
  const gamma = res.skills.find(s => s.skill_id === 'gamma');
  log('listSkills picks up newly-written skill', !!gamma && gamma.usage_count === 0);

  // ── 11. _readMyBrain skill list path tags telemetry ────────────────────────
  // alpha has 3 uses + outcome, gamma is new
  res = await orch._readMyBrain({ section_path: 'skills' });
  log('readMyBrain(skills) returns content', res.ok === true && typeof res.content === 'string');
  log('readMyBrain(skills) tags used skill with [used Nx]',
      res.content.includes('used 3x') && res.content.includes('alpha'),
      `excerpt: ${res.content.split('\n').find(l => l.includes('alpha'))}`);
  log('readMyBrain(skills) tags new skill with [new]',
      res.content.includes('[new]') && res.content.includes('gamma'));

  // ── 12. _readMyBrain skill-detail bumps usage ──────────────────────────────
  const beforeReads = JSON.parse(fs.readFileSync(path.join(realAquarium.SKILLS, 'gamma.json'), 'utf8')).usage_count || 0;
  res = await orch._readMyBrain({ section_path: 'skills.gamma' });
  // The bump is fire-and-forget — give it a tick to settle
  await new Promise(r => setTimeout(r, 50));
  const afterReads = JSON.parse(fs.readFileSync(path.join(realAquarium.SKILLS, 'gamma.json'), 'utf8')).usage_count || 0;
  log('readMyBrain(skills.<id>) returns content', res.ok === true && res.content.includes('Gamma'));
  log('readMyBrain(skills.<id>) bumps usage_count on read', afterReads === beforeReads + 1,
      `before=${beforeReads}, after=${afterReads}`);
  log('readMyBrain(skills.<id>) includes stats line',
      res.content.includes('Stats:') && /\d+ uses/.test(res.content));

  // ── 13. _readMyBrain skill-detail on missing skill returns helpful error ───
  res = await orch._readMyBrain({ section_path: 'skills.does_not_exist' });
  log('readMyBrain(skills.<missing>) returns ok=false', res.ok === false,
      `err: ${res.error?.slice(0, 80)}`);
  log('readMyBrain(skills.<missing>) tells LLM to call write_skill',
      /write_skill/.test(res.error || ''));
  log('readMyBrain(skills.<missing>) does NOT leak skills_registry into available list',
      !/skills_registry/.test(res.error || ''),
      `err: ${res.error?.slice(0, 120)}`);

  // ── 14. _formatSkillsForDream — telemetry-aware sorting + tier tagging ─────
  // Seed a controlled mix of skills with different telemetry profiles.
  // First clear our temp SKILLS dir to start fresh.
  for (const f of fs.readdirSync(realAquarium.SKILLS)) {
    fs.rmSync(path.join(realAquarium.SKILLS, f));
  }
  // 5 skills covering every tier:
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'broken.json'), JSON.stringify({
    skill_id: 'broken', name: 'Broken', version: 1, summary: 'Often fails',
    triggers: [], steps: [{ order: 1, action: 'x' }],
    usage_count: 10, last_used_at: '2026-06-20T10:00:00Z', last_outcome: 'fail',
    outcome_counts: { success: 2, partial: 0, fail: 8 },
  }));
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'wobbly.json'), JSON.stringify({
    skill_id: 'wobbly', name: 'Wobbly', version: 1, summary: 'Sometimes works',
    triggers: [], steps: [{ order: 1, action: 'x' }],
    usage_count: 6, last_used_at: '2026-06-21T10:00:00Z', last_outcome: 'partial',
    outcome_counts: { success: 3, partial: 2, fail: 1 },  // 50% — mixed boundary
  }));
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'solid.json'), JSON.stringify({
    skill_id: 'solid', name: 'Solid', version: 2, summary: 'Just works',
    triggers: [], steps: [{ order: 1, action: 'x' }],
    usage_count: 20, last_used_at: '2026-06-22T10:00:00Z', last_outcome: 'success',
    outcome_counts: { success: 19, partial: 1, fail: 0 },
  }));
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'new_skill.json'), JSON.stringify({
    skill_id: 'new_skill', name: 'New', version: 1, summary: 'Recently added',
    triggers: [], steps: [{ order: 1, action: 'x' }],
    usage_count: 1, last_used_at: '2026-06-23T10:00:00Z',
    outcome_counts: { success: 0, partial: 0, fail: 0 },
  }));
  fs.writeFileSync(path.join(realAquarium.SKILLS, 'cold.json'), JSON.stringify({
    skill_id: 'cold', name: 'Cold', version: 1, summary: 'Never touched',
    triggers: [], steps: [{ order: 1, action: 'x' }],
  }));

  const dream = await orch._formatSkillsForDream();
  log('formatSkillsForDream returns lines + summary',
      Array.isArray(dream.lines) && typeof dream.summary === 'object');
  const expectedSummary = { unreliable: 1, mixed: 1, untested: 1, cold: 1, reliable: 1 };
  const summaryMatch = Object.keys(expectedSummary).every(k => dream.summary[k] === expectedSummary[k])
                    && Object.keys(dream.summary).length === Object.keys(expectedSummary).length;
  log('formatSkillsForDream counts tiers correctly',
      summaryMatch,
      `summary=${JSON.stringify(dream.summary)}`);

  log('formatSkillsForDream surfaces unreliable FIRST',
      dream.lines[0].includes('broken') && dream.lines[0].includes('⚠ UNRELIABLE'),
      `first line: ${dream.lines[0]}`);
  log('formatSkillsForDream puts mixed second',
      dream.lines[1].includes('wobbly') && dream.lines[1].includes('~ mixed'));
  log('formatSkillsForDream puts reliable LAST',
      dream.lines[dream.lines.length - 1].includes('solid')
      && dream.lines[dream.lines.length - 1].includes('✓ reliable'),
      `last line: ${dream.lines[dream.lines.length - 1]}`);

  // Verify telemetry is embedded in each line
  const brokenLine = dream.lines.find(l => l.includes('broken'));
  log('broken line shows usage count and success rate',
      /10 uses/.test(brokenLine) && /20% success/.test(brokenLine),
      `broken: ${brokenLine}`);
  const coldLine = dream.lines.find(l => l.includes('cold'));
  log('cold line shows "[never used]"', /\[never used\]/.test(coldLine), coldLine);
  const newLine = dream.lines.find(l => l.includes('new_skill'));
  log('untested line shows "no outcomes recorded"',
      /no outcomes recorded/.test(newLine), newLine);

  // Empty catalog edge case
  for (const f of fs.readdirSync(realAquarium.SKILLS)) {
    fs.rmSync(path.join(realAquarium.SKILLS, f));
  }
  const emptyDream = await orch._formatSkillsForDream();
  const expectedEmpty = { unreliable: 0, mixed: 0, reliable: 0, untested: 0, cold: 0 };
  const emptyMatch = Object.keys(expectedEmpty).every(k => emptyDream.summary[k] === expectedEmpty[k]);
  log('formatSkillsForDream handles empty catalog',
      emptyDream.lines.length === 0 && emptyMatch);

  // ── Summary ───────────────────────────────────────────────────────────────
  await cleanup();
  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter(r => !r.ok)) {
      console.log(`  ✗ ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(async err => {
  console.error('Fatal:', err);
  await cleanup();
  process.exit(1);
});
