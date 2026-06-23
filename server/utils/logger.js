/**
 * logger.js — minimal structured logger for IAQUA.
 *
 * Drop-in replacement for console.log/warn/error with:
 *   • Levels: DEBUG, INFO, WARN, ERROR
 *   • LOG_LEVEL env var filters output (default INFO)
 *   • JSON output when LOG_FORMAT=json (for log aggregators)
 *   • Pretty output otherwise (default, dev-friendly)
 *   • Scope tagging via createLogger('Scope') wrapper
 *
 * Usage:
 *   const log = require('./utils/logger').createLogger('TaskRunner');
 *   log.info('Task %s started', taskId);
 *   log.warn('Retry %d/%d', attempt, max);
 *   log.error('Task failed', { taskId, error: err.message });
 */

const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40 };
const LEVEL  = LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] || LEVELS.INFO;
const FORMAT = (process.env.LOG_FORMAT || 'pretty').toLowerCase(); // 'json' | 'pretty'

const COLORS = {
  DEBUG: '\x1b[90m',  // grey
  INFO:  '\x1b[36m',  // cyan
  WARN:  '\x1b[33m',  // yellow
  ERROR: '\x1b[31m',  // red
  RESET: '\x1b[0m',
};

function format(level, scope, args) {
  const ts = new Date().toISOString();
  if (FORMAT === 'json') {
    const last = args[args.length - 1];
    const meta = (last && typeof last === 'object' && !(last instanceof Error)) ? args.pop() : {};
    return JSON.stringify({ ts, level, scope, msg: args.join(' '), ...meta });
  }
  const color = COLORS[level] || '';
  const reset = COLORS.RESET;
  const tag = scope ? `[${scope}]` : '';
  return `${color}${ts.slice(11, 19)} ${level.padEnd(5)}${reset} ${tag} ${args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : a
  ).join(' ')}`;
}

function log(level, scope, args) {
  if (LEVELS[level] < LEVEL) return;
  const line = format(level, scope, [...args]);
  if (level === 'ERROR' || level === 'WARN') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

function createLogger(scope) {
  return {
    debug: (...a) => log('DEBUG', scope, a),
    info:  (...a) => log('INFO',  scope, a),
    warn:  (...a) => log('WARN',  scope, a),
    error: (...a) => log('ERROR', scope, a),
    child: (subScope) => createLogger(scope ? `${scope}/${subScope}` : subScope),
  };
}

module.exports = {
  createLogger,
  LEVELS,
  // Direct logger (no scope) — for index.js bootstrap
  debug: (...a) => log('DEBUG', null, a),
  info:  (...a) => log('INFO',  null, a),
  warn:  (...a) => log('WARN',  null, a),
  error: (...a) => log('ERROR', null, a),
};
