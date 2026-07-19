/**
 * MissionControl — bounded autonomy for IAQUA.
 *
 * A mission = a GOAL + a BUDGET. Poseidon plans tasks, agents execute,
 * the quality review judges — and MissionControl closes the loop: when all
 * tasks are terminal, it runs a BG-Poseidon AUDIT turn that decides
 * "GOAL ACHIEVED" or creates the next wave of tasks. No user approval
 * inside the bounds; hard stops when any bound is hit.
 *
 * Bounds (all enforced in code, not by the model):
 *   max_tasks       total tasks the mission may create   (default 8, cap 20)
 *   max_iterations  plan→execute→audit cycles            (default 3, cap 6)
 *   deadline_hours  wall-clock kill switch               (default 12, cap 48)
 *
 * Storage: BRAIN/missions.json — { missions: { mission_XXXX: {...} } }
 * Tick: every 2 min (cheap registry reads; the audit turn only runs when
 * every mission task is terminal AND the broker is free of user chat).
 * Final report: PROJECTS/<x>/output/MISSION_REPORT_<id>.md (code-built
 * skeleton + the audit turn's verdict text). Morning brief lists missions.
 */

const log = require('../utils/logger').createLogger('MissionControl');

const LIMITS = { max_tasks: 20, max_iterations: 6, deadline_hours: 48 };
const TICK_MS = 2 * 60_000;

class MissionControl {
  constructor(rm, modelService, orchestrator) {
    this.rm = rm;
    this.modelService = modelService;
    this.orchestrator = orchestrator;
    this._timer = null;
    this._ticking = false;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick().catch(e => log.warn('tick error:', e.message)), TICK_MS);
    log.info('MissionControl started (tick every 2min)');
  }

  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  async _readReg() {
    return await this.rm.read('BRAIN/missions.json').catch(() => null) || { missions: {} };
  }
  async _writeReg(reg) {
    await this.rm.write('BRAIN/missions.json', reg);
  }

  /** Launch a mission. Called by the launch_mission tool. */
  async launch({ goal, project, max_tasks = 8, max_iterations = 3, deadline_hours = 12 }) {
    if (!goal || !project) return { ok: false, error: 'goal and project are required' };
    // System projects (GALLERY, GODSTUFF) are content homes, not mission
    // territory — an autonomous loop electing domicile in the commons
    // would fill it with unowned work. Missions need a real project.
    try {
      const pe = await this.rm.resolveProjectByNameOrId(project);
      if (pe?.entry?.system) return { ok: false, error: `"${pe.entry.name}" is a system project — create or pick a real project for the mission.` };
    } catch {}
    max_tasks       = Math.min(LIMITS.max_tasks, Math.max(1, Number(max_tasks) || 8));
    max_iterations  = Math.min(LIMITS.max_iterations, Math.max(1, Number(max_iterations) || 3));
    deadline_hours  = Math.min(LIMITS.deadline_hours, Math.max(1, Number(deadline_hours) || 12));

    const reg = await this._readReg();
    // One active mission per project — two autonomous loops fighting over
    // the same task list is chaos, not autonomy.
    const clash = Object.values(reg.missions).find(m => m.project === project && m.status === 'active');
    if (clash) return { ok: false, error: `Mission ${clash.mission_id} is already active on "${project}". One mission per project.` };

    const id = `mission_${String(Object.keys(reg.missions).length + 1).padStart(4, '0')}`;
    reg.missions[id] = {
      mission_id: id, goal, project,
      max_tasks, max_iterations, deadline_hours,
      status: 'active',                 // active | achieved | exhausted | expired | aborted
      iteration: 0,
      tasks_created: [],                // task ids attributed to this mission
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + deadline_hours * 3600_000).toISOString(),
      log: [{ at: new Date().toISOString(), event: 'launched', detail: goal.slice(0, 200) }],
    };
    await this._writeReg(reg);
    await this.rm.log({
      event_type: 'mission_launched',
      actor: { type: 'system', id: 'mission_control' },
      subject: { type: 'project', id: project },
      action: `Mission ${id} launched: "${goal.slice(0, 120)}" (≤${max_tasks} tasks, ≤${max_iterations} iterations, ${deadline_hours}h deadline)`,
    }).catch(() => {});
    log.info(`🚀 ${id} launched on "${project}": ${goal.slice(0, 100)}`);
    // First planning wave immediately (don't wait for the tick)
    setImmediate(() => this._iterate(id).catch(e => log.warn(`${id} first iteration failed: ${e.message}`)));
    return { ok: true, mission_id: id,
      message: `Mission ${id} launched on "${project}". Budget: ${max_tasks} tasks, ${max_iterations} iterations, ${deadline_hours}h. First planning wave starting now — progress lands in the project kanban, final report in output/.` };
  }

  async status(missionId = null) {
    const reg = await this._readReg();
    if (missionId) {
      const m = reg.missions[missionId];
      return m ? { ok: true, mission: m } : { ok: false, error: `No mission ${missionId}` };
    }
    const all = Object.values(reg.missions);
    return { ok: true,
      active: all.filter(m => m.status === 'active').map(this._slim),
      recent: all.filter(m => m.status !== 'active').slice(-5).map(this._slim) };
  }

  _slim(m) {
    return { mission_id: m.mission_id, project: m.project, status: m.status,
      iteration: m.iteration, tasks: m.tasks_created.length, goal: m.goal.slice(0, 120) };
  }

  async abort(missionId) {
    const reg = await this._readReg();
    const m = reg.missions[missionId];
    if (!m) return { ok: false, error: `No mission ${missionId}` };
    if (m.status !== 'active') return { ok: false, error: `Mission is ${m.status}, not active` };
    m.status = 'aborted';
    m.log.push({ at: new Date().toISOString(), event: 'aborted', detail: 'user request' });
    await this._writeReg(reg);
    return { ok: true, message: `Mission ${missionId} aborted. Already-created tasks keep running unless you delete them.` };
  }

  /** Main loop: check deadlines; when a mission's tasks are all terminal,
   *  run the audit/re-plan iteration. */
  async tick() {
    if (this._ticking) return;
    if (require('./PauseControl').isPaused()) return;   // global pause
    this._ticking = true;
    try {
      const reg = await this._readReg();
      const active = Object.values(reg.missions).filter(m => m.status === 'active');
      if (!active.length) return;
      for (const m of active) {
        if (Date.now() > Date.parse(m.deadline_at)) {
          m.status = 'expired';
          m.log.push({ at: new Date().toISOString(), event: 'expired' });
          await this._writeReg(reg);
          await this._finalReport(m, 'DEADLINE EXPIRED — wall-clock bound hit before the goal was confirmed achieved.');
          continue;
        }
        const allTerminal = await this._allTasksTerminal(m);
        if (allTerminal) {
          // Serialize: one iteration at a time across all missions
          await this._iterate(m.mission_id);
        }
      }
    } finally { this._ticking = false; }
  }

  async _allTasksTerminal(m) {
    if (!m.tasks_created.length) return m.iteration > 0;  // iteration 0 = not planned yet → let _iterate run
    const reg = await this.rm.getTasksRegistry().catch(() => ({ tasks: {} }));
    for (const tid of m.tasks_created) {
      const t = reg.tasks?.[tid];
      if (!t) continue;                                    // purged to results = terminal
      const st = t.lifecycle?.status || t.status;
      if (!['done', 'completed', 'failed', 'cancelled'].includes(st)) return false;
    }
    return true;
  }

  /** One plan/audit iteration = one BG-Poseidon turn with tools.
   *  The turn's create_task calls are attributed to the mission by diffing
   *  the task registry before/after. Budget enforcement is OURS: when the
   *  wave would exceed max_tasks, the mission concludes as 'exhausted'. */
  async _iterate(missionId) {
    const reg = await this._readReg();
    const m = reg.missions[missionId];
    if (!m || m.status !== 'active') return;
    if (m.iteration >= m.max_iterations) {
      m.status = 'exhausted';
      m.log.push({ at: new Date().toISOString(), event: 'exhausted', detail: 'iteration budget spent' });
      await this._writeReg(reg);
      await this._finalReport(m, 'ITERATION BUDGET SPENT — the goal was not confirmed achieved within the allowed cycles.');
      return;
    }
    // Never fight the user for the model: only run when the broker is idle.
    const st = this.modelService.getStatus?.() || {};
    if (st.broker?.state && st.broker.state !== 'IDLE') { log.info(`${missionId}: broker busy (${st.broker.owner}) — iteration deferred`); return; }

    m.iteration += 1;
    m.log.push({ at: new Date().toISOString(), event: 'iteration_start', detail: `#${m.iteration}` });
    await this._writeReg(reg);
    log.info(`⚙ ${missionId} iteration ${m.iteration}/${m.max_iterations}`);

    const before = new Set(Object.keys((await this.rm.getTasksRegistry().catch(() => ({ tasks: {} }))).tasks || {}));
    const budgetLeft = m.max_tasks - m.tasks_created.length;
    const prompt =
      `[MISSION CONTROL — iteration ${m.iteration}/${m.max_iterations}, autonomous, no user present]\n` +
      `MISSION GOAL: ${m.goal}\nPROJECT: ${m.project}\nTASK BUDGET LEFT: ${budgetLeft}\n\n` +
      `Protocol, in order:\n` +
      `1. audit_project on "${m.project}" and read_project_memory to see what has been achieved.\n` +
      `2. DECIDE: is the mission goal FULLY achieved by the existing deliverables?\n` +
      `   - If YES: reply with a line "MISSION_VERDICT: ACHIEVED" followed by a 3-5 sentence summary of what was delivered and where the files are. Do NOT create tasks.\n` +
      `   - If NO: create the minimal next wave of tasks (create_task with acceptance_criteria and assigned_agent_id, max ${Math.min(4, budgetLeft)} tasks) that closes the remaining gap, then reply "MISSION_VERDICT: CONTINUING" with one sentence per created task.\n` +
      `Be ruthless about scope: the budget is ${budgetLeft} tasks. Redundant or cosmetic tasks waste the mission.`;

    let text = '';
    try {
      for await (const ev of this.modelService.chatWithPoseidon(prompt, [], { _bgMode: true })) {
        if (ev.type === 'text') text += ev.chunk;
        if (text.length > 4000) break;
      }
    } catch (e) {
      log.warn(`${missionId} iteration turn failed: ${e.message} — will retry next tick`);
      const reg2 = await this._readReg();
      const m2 = reg2.missions[missionId];
      if (m2) { m2.iteration -= 1; m2.log.push({ at: new Date().toISOString(), event: 'iteration_failed', detail: e.message.slice(0, 120) }); await this._writeReg(reg2); }
      return;
    }

    // Attribute new tasks to the mission
    const afterReg = await this.rm.getTasksRegistry().catch(() => ({ tasks: {} }));
    const newIds = Object.keys(afterReg.tasks || {}).filter(id => !before.has(id));
    const reg3 = await this._readReg();
    const m3 = reg3.missions[missionId];
    if (!m3) return;
    m3.tasks_created.push(...newIds);
    const achieved = /MISSION_VERDICT:\s*ACHIEVED/i.test(text);
    const verdictText = (text.match(/MISSION_VERDICT:[\s\S]{0,800}/i) || [text.slice(-600)])[0];

    if (achieved) {
      m3.status = 'achieved';
      m3.log.push({ at: new Date().toISOString(), event: 'achieved', detail: verdictText.slice(0, 200) });
      await this._writeReg(reg3);
      await this._finalReport(m3, verdictText);
      await this.rm.log({
        event_type: 'mission_achieved',
        actor: { type: 'system', id: 'mission_control' },
        subject: { type: 'project', id: m3.project },
        action: `Mission ${missionId} ACHIEVED after ${m3.iteration} iteration(s), ${m3.tasks_created.length} task(s)`,
      }).catch(() => {});
      log.info(`🏁 ${missionId} ACHIEVED`);
    } else if (m3.tasks_created.length >= m3.max_tasks && !newIds.length) {
      m3.status = 'exhausted';
      m3.log.push({ at: new Date().toISOString(), event: 'exhausted', detail: 'task budget spent, goal not confirmed' });
      await this._writeReg(reg3);
      await this._finalReport(m3, 'TASK BUDGET SPENT — goal not confirmed achieved.\n\nLast audit verdict:\n' + verdictText);
    } else {
      m3.log.push({ at: new Date().toISOString(), event: 'iteration_done', detail: `${newIds.length} new task(s): ${newIds.join(', ') || 'none'}` });
      await this._writeReg(reg3);
      log.info(`${missionId}: ${newIds.length} task(s) created this wave — agents take over`);
    }
  }

  /** Code-built report skeleton + verdict, written into the project output. */
  async _finalReport(m, verdictText) {
    try {
      const RegistryManager = require('./RegistryManager');
      const AQUARIUM = require('../aquarium');
      const path = require('path');
      const fs = require('fs').promises;
      const treg = await this.rm.getTasksRegistry().catch(() => ({ tasks: {} }));
      const rows = m.tasks_created.map(tid => {
        const t = treg.tasks?.[tid];
        if (!t) return `- ${tid} — (archived to results)`;
        const st = t.lifecycle?.status || t.status;
        const rv = t.review ? ` · review ${t.review.verdict}${Number.isFinite(t.review.score) ? ` ${t.review.score}/10` : ''}${t.review.unverified ? ' (unverified)' : ''}` : '';
        return `- ${tid} — ${t.title} · ${st}${rv}`;
      });
      const md = [
        `# MISSION REPORT — ${m.mission_id}`,
        ``,
        `**Goal:** ${m.goal}`,
        `**Status:** ${m.status.toUpperCase()}`,
        `**Iterations:** ${m.iteration}/${m.max_iterations} · **Tasks:** ${m.tasks_created.length}/${m.max_tasks}`,
        `**Started:** ${m.started_at} · **Closed:** ${new Date().toISOString()}`,
        ``,
        `## Verdict`,
        verdictText.trim(),
        ``,
        `## Tasks`,
        rows.join('\n') || '(none created)',
        ``,
        `## Timeline`,
        m.log.map(l => `- ${l.at} — ${l.event}${l.detail ? `: ${l.detail}` : ''}`).join('\n'),
      ].join('\n');
      const folder = RegistryManager.projectFolder({ name: m.project });
      const outDir = path.join(AQUARIUM.PROJECTS, folder, 'output');
      await fs.mkdir(outDir, { recursive: true }).catch(() => {});
      await fs.writeFile(path.join(outDir, `MISSION_REPORT_${m.mission_id}.md`), md, 'utf8');
      log.info(`📄 ${m.mission_id} report written to ${folder}/output/`);
    } catch (e) {
      log.warn(`${m.mission_id} report write failed: ${e.message}`);
    }
  }
}

module.exports = MissionControl;
