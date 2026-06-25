/**
 * Format — consistent humanization helpers used across the UI.
 * Loaded early so any module can use window.Format.
 */
(function () {
  // Relative time: "just now", "3m ago", "2h ago", "Yesterday", "3d ago", or absolute date.
  function relativeTime(input) {
    if (!input) return '';
    const t = input instanceof Date ? input : new Date(input);
    if (isNaN(t)) return String(input).slice(0, 16);
    const diffMs = Date.now() - t.getTime();
    const s = Math.floor(diffMs / 1000);
    if (s < 0)        return 'in ' + relativeTime(new Date(Date.now() - Math.abs(diffMs))).replace(/ ago$/, '');
    if (s < 10)       return 'just now';
    if (s < 60)       return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60)       return m + 'm ago';
    const h = Math.floor(m / 60);
    if (h < 24)       return h + 'h ago';
    const d = Math.floor(h / 24);
    if (d === 1)      return 'yesterday';
    if (d < 7)        return d + 'd ago';
    if (d < 30)       return Math.floor(d / 7) + 'w ago';
    return t.toISOString().slice(0, 10);
  }

  // Bytes: "12 B", "4.2 KB", "1.3 MB", "850 MB", "12.3 GB"
  function bytes(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    if (n < 1024 ** 2) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 ** 3) return (n / 1024 ** 2).toFixed(1) + ' MB';
    return (n / 1024 ** 3).toFixed(2) + ' GB';
  }

  // Duration: 45 → "45s", 132 → "2m 12s", 4830 → "1h 20m"
  function duration(seconds) {
    const s = Math.floor(Number(seconds) || 0);
    if (s < 60)   return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  }

  // Number with thousands separator: 1234 → "1,234"
  function num(n) {
    if (n === null || n === undefined) return '';
    return Number(n).toLocaleString('en-US');
  }

  // Truncate: "long text here" → "long text…"
  function truncate(s, max = 60) {
    if (!s) return '';
    s = String(s);
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
  }

  // Title case: "AGENT_REGISTRY" → "Agent Registry"
  function title(s) {
    if (!s) return '';
    return String(s).replace(/[_-]+/g, ' ').replace(/\w\S*/g,
      w => w[0].toUpperCase() + w.slice(1).toLowerCase());
  }

  window.Format = { relativeTime, bytes, duration, num, truncate, title };
  console.log('[OK] Format ready');
})();
