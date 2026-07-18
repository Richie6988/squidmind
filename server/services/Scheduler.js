/**
 * Scheduler — the TIME trigger. Completes the four activation classes:
 * conversational (chat), event-driven (InputWatcher), autonomous
 * (MissionControl), and now TEMPORAL.
 *
 * A schedule = a task template + a recurrence expression. Every minute the
 * tick fires due schedules by creating a normal task (TaskRunner does the
 * rest). Expressions are deliberately simple and human-readable — cron
 * syntax is powerful but a 9B model mangles it; these four forms cover
 * every real IAQUA use case and are trivially validated:
 *
 *   daily@HH:MM            every day at HH:MM
 *   weekly:mon@HH:MM       every <mon..sun> at HH:MM
 *   hourly@:MM             every hour at minute MM
 *   every:Nh / every:Nm    every N hours / minutes (N ≥ 5m)
 *
 * Idempotence: the created task title gets a date (or date+hour) suffix —
 * same-period restarts dedup via the existing title guard, next period
 * generates a fresh title. next_run is computed AFTER firing and persisted,
 * so a restart never double-fires and never misses more than one period
 * (catch-up policy: fire ONCE if overdue, then realign — no storms after
 * a week offline).
 */

const AQUARIUM = require('../aquarium');
const log = require('../utils/logger').createLogger('Scheduler');

const REG_PATH = 'BRAIN/schedules.json';
const TICK_MS  = 60_000;
const DOW = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 0 };
const EXPR_RE = /^(daily@([01]?\d|2[0-3]):([0-5]\d)|weekly:(mon|tue|wed|thu|fri|sat|sun)@([01]?\d|2[0-3]):([0-5]\d)|hourly@:([0-5]\d)|every:(\d{1,3})(h|m))$/;

function computeNextRun(expr, from = Date.now()) {
  const m = EXPR_RE.exec(expr);
  if (!m) return null;
  const d = new Date(from);
  if (expr.startsWith('daily@')) {
    const [hh, mm] = [Number(m[2]), Number(m[3])];
    const next = new Date(d); next.setHours(hh, mm, 0, 0);
    if (next.getTime() <= from) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  if (expr.startsWith('weekly:')) {
    const dow = DOW[m[4]]; const [hh, mm] = [Number(m[5]), Number(m[6])];
    const next = new Date(d); next.setHours(hh, mm, 0, 0);
    let delta = (dow - next.getDay() + 7) % 7;
    if (delta === 0 && next.getTime() <= from) delta = 7;
    next.setDate(next.getDate() + delta);
    return next.getTime();
  }
  if (expr.startsWith('hourly@')) {
    const mm = Number(m[7]);
    const next = new Date(d); next.setMinutes(mm, 0, 0);
    if (next.getTime() <= from) next.setHours(next.getHours() + 1);
    return next.getTime();
  }
  // every:Nh / every:Nm
  const n = Number(m[8]); const unit = m[9];
  const stepMs = unit === 'h' ? n * 3600_000 : n * 60_000;
  if (unit === 'm' && n < 5) return null;   // floor: 5 minutes
  return from + stepMs;
}

class Scheduler {
  constructor(rm, orchestrator) {
    this.rm = rm;
    this.orchestrator = orchestrator;
    this._timer = null;
    this._ticking = false;
  }

  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tick().catch(e => log.warn('tick:', e.message)), TICK_MS);
    log.info('Scheduler started (1min tick)');
  }
  stop() { if (this._timer) clearInterval(this._timer); this._timer = null; }

  async _read()  { return await this.rm.read(REG_PATH).catch(() => null) || { schedules: {} }; }
  async _write(r) { await this.rm.write(REG_PATH, r); }

  async create({ expr, title, description, project, assigned_agent_id, priority = 'medium' }) {
    if (!EXPR_RE.test(expr || ''))
      return { ok: false, error: `Invalid expr "${expr}". Formats: daily@HH:MM · weekly:mon@HH:MM · hourly@:MM · every:Nh · every:Nm (min 5m)` };
    if (!title || title.length < 6) return { ok: false, error: 'title required (min 6 chars)' };
    const next = computeNextRun(expr);
    if (!next) return { ok: false, error: `Could not compute next run for "${expr}" (every:Nm needs N ≥ 5)` };
    const reg = await this._read();
    if (Object.keys(reg.schedules).length >= 30)
      return { ok: false, error: 'Max 30 schedules — delete unused ones first (schedule_task action=list / delete)' };
    const id = `sched_${String((reg.metadata?.next_id || Object.keys(reg.schedules).length + 1)).padStart(4, '0')}`;
    reg.metadata = { next_id: (reg.metadata?.next_id || Object.keys(reg.schedules).length + 1) + 1 };
    reg.schedules[id] = {
      schedule_id: id, expr, title: title.slice(0, 120),
      description: (description || '').slice(0, 2000),
      project: project || null, assigned_agent_id: assigned_agent_id || null,
      priority, enabled: true,
      created_at: new Date().toISOString(),
      last_run: null, next_run: new Date(next).toISOString(),
      run_count: 0,
    };
    await this._write(reg);
    log.info(`⏰ ${id} created: "${title}" ${expr} → next ${new Date(next).toISOString()}`);
    return { ok: true, schedule_id: id, next_run: reg.schedules[id].next_run,
      message: `Schedule ${id} created — "${title}" (${expr}). First run: ${new Date(next).toLocaleString('fr-FR')}. Tasks appear in the kanban like any other; scheduled runs are listed in the morning brief.` };
  }

  async list() {
    const reg = await this._read();
    const items = Object.values(reg.schedules).map(s => ({
      id: s.schedule_id, expr: s.expr, title: s.title, project: s.project,
      enabled: s.enabled, next_run: s.next_run, run_count: s.run_count,
      ...(s.last_run ? { last_run: s.last_run } : {}),
    }));
    return { ok: true, count: items.length, schedules: items };
  }

  async remove(id) {
    const reg = await this._read();
    if (!reg.schedules[id]) return { ok: false, error: `No schedule ${id}` };
    delete reg.schedules[id];
    await this._write(reg);
    return { ok: true, message: `Schedule ${id} deleted.` };
  }

  async setEnabled(id, enabled) {
    const reg = await this._read();
    const s = reg.schedules[id];
    if (!s) return { ok: false, error: `No schedule ${id}` };
    s.enabled = !!enabled;
    if (enabled) s.next_run = new Date(computeNextRun(s.expr)).toISOString();  // realign, no catch-up storm
    await this._write(reg);
    return { ok: true, message: `Schedule ${id} ${enabled ? `enabled — next run ${s.next_run}` : 'disabled'}.` };
  }

  async tick() {
    if (this._ticking) return;
    if (require('./PauseControl').isPaused()) return;   // global pause
    this._ticking = true;
    try {
      const reg = await this._read();
      const now = Date.now();
      let dirty = false;
      for (const s of Object.values(reg.schedules)) {
        if (!s.enabled || !s.next_run) continue;
        if (Date.parse(s.next_run) > now) continue;
        // Fire ONCE even if long overdue, then realign to the future.
        await this._fire(s).catch(e => log.warn(`${s.schedule_id} fire failed: ${e.message}`));
        s.last_run  = new Date().toISOString();
        s.run_count = (s.run_count || 0) + 1;
        s.next_run  = new Date(computeNextRun(s.expr, now + 1000)).toISOString();
        dirty = true;
      }
      if (dirty) await this._write(reg);
    } finally { this._ticking = false; }
  }

  async _fire(s) {
    // Title suffix = idempotence period key: date for daily/weekly,
    // date+hour for hourly/every — restarts inside a period dedup,
    // the next period generates a fresh title.
    const d = new Date();
    const dateKey = d.toISOString().slice(0, 10);
    const fine = /^(hourly|every)/.test(s.expr) ? ` ${String(d.getHours()).padStart(2, '0')}h` : '';
    const title = `${s.title} — ${dateKey}${fine}`;
    const r = await this.orchestrator._createTaskInner({
      title,
      description: s.description || s.title,
      project: s.project || undefined,
      assigned_agent_id: s.assigned_agent_id || undefined,
      priority: s.priority || 'medium',
    });
    if (r?.ok === false && /already exists/i.test(r?.error || r?.message || '')) {
      log.info(`⏰ ${s.schedule_id}: task already exists for this period (restart dedup)`);
      return;
    }
    log.info(`⏰ ${s.schedule_id} fired → "${title}"`);
    await this.rm.log({
      event_type: 'scheduler',
      actor: { type: 'system', id: 'scheduler' },
      subject: { type: 'task', id: r?.task_id || title },
      action: `Schedule ${s.schedule_id} fired: ${title}`,
    }).catch(() => {});
  }
}

module.exports = { Scheduler, computeNextRun, EXPR_RE };
