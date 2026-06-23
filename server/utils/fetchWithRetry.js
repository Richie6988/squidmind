/**
 * fetchWithRetry — robust HTTP wrapper for external services.
 *
 * Retries on transient failures (network errors, 5xx, 429, 408) with
 * exponential backoff + jitter. Honours Retry-After header on 429.
 *
 * Aborts cleanly on signal. Total timeout enforced via Promise.race.
 *
 * Usage:
 *   const { fetchWithRetry } = require('./utils/fetchWithRetry');
 *   const r = await fetchWithRetry('https://api.example.com', {
 *     retries: 3, timeoutMs: 30000, signal: controller.signal,
 *   });
 */

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

async function fetchWithRetry(url, opts = {}) {
  const {
    retries     = 3,
    baseDelayMs = 500,
    maxDelayMs  = 8000,
    timeoutMs   = 30_000,
    signal      = null,
    onRetry     = null, // ({attempt, error, willRetryIn}) => void
    ...fetchOpts
  } = opts;

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (signal?.aborted) throw new Error('Aborted');

    const ctl = new AbortController();
    const t   = setTimeout(() => ctl.abort(), timeoutMs);
    const onParentAbort = () => ctl.abort();
    if (signal) signal.addEventListener('abort', onParentAbort, { once: true });

    try {
      const res = await fetch(url, { ...fetchOpts, signal: ctl.signal });
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onParentAbort);

      if (res.ok) return res;
      if (!RETRYABLE_STATUS.has(res.status) || attempt === retries) return res;

      // Honour Retry-After (seconds OR HTTP-date)
      const ra = res.headers.get('retry-after');
      let waitMs = computeBackoff(attempt, baseDelayMs, maxDelayMs);
      if (ra) {
        const s = parseInt(ra, 10);
        if (!isNaN(s)) waitMs = Math.min(s * 1000, 60_000);
      }
      lastError = new Error(`HTTP ${res.status}`);
      if (onRetry) onRetry({ attempt: attempt + 1, error: lastError, willRetryIn: waitMs });
      await sleep(waitMs);
    } catch (err) {
      clearTimeout(t);
      if (signal) signal.removeEventListener('abort', onParentAbort);
      lastError = err;
      if (attempt === retries || err.name === 'AbortError' && signal?.aborted) throw err;
      const waitMs = computeBackoff(attempt, baseDelayMs, maxDelayMs);
      if (onRetry) onRetry({ attempt: attempt + 1, error: err, willRetryIn: waitMs });
      await sleep(waitMs);
    }
  }
  throw lastError || new Error('fetchWithRetry exhausted');
}

function computeBackoff(attempt, base, max) {
  const expo   = Math.min(base * Math.pow(2, attempt), max);
  const jitter = Math.random() * expo * 0.3;
  return Math.round(expo + jitter);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { fetchWithRetry };
