'use strict';

/**
 * tests/stream.test.js — in-process verification of ReasoningBus + per-task SSE.
 *
 * Wires the real ReasoningBus singleton + the real /tasks/:id/stream route
 * into a minimal Express app, then drives the bus directly and asserts the
 * SSE client sees each chunk before the next is pushed.
 */

const http = require('http');
const express = require('express');

const ReasoningBus = require('../server/utils/ReasoningBus');
const RegistryManager = require('../server/services/RegistryManager');
const buildRegistryRoutes = require('../server/routes/registryRoutes');
const AQUARIUM = require('../server/aquarium');

const results = [];
function log(label, ok, detail = '') {
  results.push({ label, ok, detail });
  const tag = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${tag} ${label}${detail ? ' — ' + detail : ''}`);
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

function makeSSEClient(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`Status ${res.statusCode}`));
      const events = [];
      let buf = '';
      let pending = null;
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.startsWith('event: ')) {
            pending = { type: line.slice(7).trim(), ts: Date.now() };
          } else if (line.startsWith('data: ')) {
            if (pending) {
              try { pending.data = JSON.parse(line.slice(6)); } catch { pending.data = line.slice(6); }
              events.push(pending);
              pending = null;
            }
          }
        }
      });
      resolve({ events, end: () => { try { res.destroy(); req.destroy(); } catch {} } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // ── Bus unit checks ─────────────────────────────────────────────────────────
  log('Bus singleton has push',           typeof ReasoningBus.push === 'function');
  log('Bus has subscribeForTask',         typeof ReasoningBus.subscribeForTask === 'function');
  log('Bus has unsubscribeForTask',       typeof ReasoningBus.unsubscribeForTask === 'function');
  log('Bus has addListener',              typeof ReasoningBus.addListener === 'function');

  // Test in-memory filter without HTTP first
  const collected = [];
  const fakeRes = { write: (d) => collected.push(d) };
  const unsub = ReasoningBus.subscribeForTask('task_X', fakeRes);
  ReasoningBus.push({ type: 'text', task_id: 'task_X',     chunk: 'matched' });
  ReasoningBus.push({ type: 'text', task_id: 'task_OTHER', chunk: 'NOT matched' });
  ReasoningBus.push({ type: 'text', task_id: 'task_X',     chunk: 'matched2' });
  log('Per-task filter receives only matching events', collected.length === 2);
  log('Filter preserves order', collected[0].includes('matched') && collected[1].includes('matched2'));
  unsub();
  log('Unsubscribe removes from bus', ReasoningBus.getStats().task_streams === 0);

  // ── Mount real route, drive a real SSE client ──────────────────────────────
  const sharedRm = new RegistryManager(AQUARIUM.ROOT);
  const app = express();
  app.use(express.json());
  app.use('/api/v2', buildRegistryRoutes(sharedRm, {}));

  const server = app.listen(0);
  const port = server.address().port;

  // Use a task_id that does NOT exist yet — should subscribe and stay open
  const sse = await makeSSEClient(port, '/api/v2/tasks/task_LIVE_TEST/stream');
  await wait(150);
  log('SSE opens with "open" event', sse.events[0]?.type === 'open');

  // Push chunks live, one by one with delays, verify each arrives before next push
  const t0 = Date.now();
  ReasoningBus.push({ type: 'text', task_id: 'task_LIVE_TEST', chunk: 'Hello ' });
  await wait(80);
  const after1 = sse.events.length;
  ReasoningBus.push({ type: 'text', task_id: 'task_LIVE_TEST', chunk: 'world ' });
  await wait(80);
  const after2 = sse.events.length;
  ReasoningBus.push({ type: 'tool_call', task_id: 'task_LIVE_TEST', name: 'read_file', args: { path: 'foo' } });
  await wait(80);
  const after3 = sse.events.length;
  // Cross-talk: this should NOT reach our subscriber
  ReasoningBus.push({ type: 'text', task_id: 'task_OTHER', chunk: 'cross-talk' });
  await wait(50);
  const after4 = sse.events.length;

  log('Chunk 1 arrived in real time',  after1 >= 2, `events=${after1}`);
  log('Chunk 2 arrived in real time',  after2 >= 3, `events=${after2}`);
  log('tool_call event mapped through',after3 >= 4 && sse.events.find(e => e.type === 'tool_call'));
  log('Cross-task event filtered out', after3 === after4, `after3=${after3} after4=${after4}`);

  // Verify event payload integrity
  const chunkEvents = sse.events.filter(e => e.type === 'chunk');
  log('First chunk payload is "Hello "', chunkEvents[0]?.data?.text === 'Hello ');
  log('Second chunk payload is "world "', chunkEvents[1]?.data?.text === 'world ');

  // Terminal lifecycle should trigger 'done' + close
  ReasoningBus.push({ type: 'task_lifecycle', task_id: 'task_LIVE_TEST', status: 'completed' });
  await wait(150);
  const done = sse.events.find(e => e.type === 'done');
  log('task_lifecycle completed triggers "done"', !!done, `status=${done?.data?.status}`);

  // After terminal, server should have closed — bus should have 0 task subscribers
  await wait(100);
  log('Bus has 0 task subscribers after terminal',
      ReasoningBus.getStats().task_streams === 0,
      `stats=${JSON.stringify(ReasoningBus.getStats())}`);

  sse.end();
  await new Promise(r => server.close(r));

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n\x1b[1m${passed} passed, ${failed} failed\x1b[0m`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
