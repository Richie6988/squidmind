/**
 * toolforge_runner — executes ONE forged tool out-of-process.
 * argv[2] = tool file path; stdin = JSON args; stdout last line = JSON result.
 * The parent (ToolForge) enforces the hard timeout and output cap; this
 * process just runs the handler and reports. Any throw → {ok:false, error}.
 */
'use strict';

const toolFile = process.argv[2];

let stdin = '';
process.stdin.on('data', d => stdin += d);
process.stdin.on('end', async () => {
  let args = {};
  try { args = JSON.parse(stdin || '{}'); } catch {}
  const ctx = {
    aquarium: process.env.AQUARIUM_ROOT || process.cwd(),
  };
  try {
    const handler = require(toolFile);
    if (typeof handler !== 'function') throw new Error('tool module does not export a function');
    const result = await handler(args, ctx);
    // Result must be JSON-serializable; cap at ~48KB to stay under the
    // parent's output limit with room for the envelope.
    let payload;
    try { payload = JSON.stringify({ ok: true, result }); }
    catch { payload = JSON.stringify({ ok: true, result: String(result).slice(0, 48000) }); }
    if (payload.length > 48000) {
      payload = JSON.stringify({ ok: true, result: payload.slice(0, 47000) + '…[truncated]' });
    }
    process.stdout.write('\n' + payload + '\n');
    process.exit(0);
  } catch (e) {
    process.stdout.write('\n' + JSON.stringify({ ok: false, error: String(e && e.message || e).slice(0, 500) }) + '\n');
    process.exit(1);
  }
});
