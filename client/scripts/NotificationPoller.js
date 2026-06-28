/**
 * NotificationPoller — polls registries every 5s, fires toasts on lifecycle events.
 *
 * Detects:
 *   • Task completed/failed (results_log delta)
 *   • Agent status changes (active ↔ sleeping)
 *   • Dream cycle completed (dream_memory last_updated delta)
 *
 * Lightweight: a single fetch per poll, ETag-ish via timestamp comparison.
 */
(function () {
  const POLL_MS = 5000;
  const seen = {
    results:  new Set(),     // task_ids already toasted
    agents:   new Map(),     // agent_id → last status
    dreamAt:  null,          // last dream_memory.last_updated
  };
  let initialized = false;
  let initialResults = null; // capture initial state to avoid flooding on first poll

  async function poll() {
    try {
      // 1. Results (completed/failed tasks)
      const r = await fetch('/api/v2/tasks/results');
      if (r.ok) {
        const data = await r.json();
        const results = data.results || data || {};
        const entries = Object.values(results);

        if (!initialized) {
          initialResults = new Set(entries.map(e => e.task_id));
          entries.forEach(e => seen.results.add(e.task_id));
        } else {
          for (const e of entries) {
            if (seen.results.has(e.task_id)) continue;
            seen.results.add(e.task_id);
            const ok = e.status === 'completed';
            window.ToastManager?.show({
              id: 'result_' + e.task_id,
              type: ok ? 'success' : 'error',
              icon: ok ? '✓' : '✗',
              title: ok ? 'Task completed' : 'Task failed',
              body: (e.title || e.task_id).slice(0, 80) +
                    (e.assigned_name ? ' · ' + e.assigned_name : ''),
              action: ok && e.result_file ? {
                label: 'VIEW',
                onClick: () => {
                  if (window.TaskQueueUI?.openTaskResult) window.TaskQueueUI.openTaskResult(e.task_id);
                }
              } : null,
              duration: 8000,
            });
          }
        }
      }

      // 2. Agents — status transitions
      const ag = await fetch('/api/v2/agents');
      if (ag.ok) {
        const data = await ag.json();
        const agents = data.agents || data.registry?.agents || (Array.isArray(data) ? data : {});
        const arr = Array.isArray(agents) ? agents : Object.values(agents);
        for (const a of arr) {
          const aid = a.agent_id || a.id;
          if (!aid) continue;
          const prev = seen.agents.get(aid);
          if (prev !== undefined && prev !== a.status && initialized) {
            // Only toast meaningful transitions
            if ((prev === 'sleeping' && a.status === 'active') ||
                (prev === 'active'   && a.status === 'sleeping')) {
              window.ToastManager?.show({
                type: 'info',
                icon: a.status === 'active' ? '◉' : '☾',
                title: `${a.display_name || aid} ${a.status === 'active' ? 'woke up' : 'went to sleep'}`,
                duration: 4000,
              });
            }
          }
          seen.agents.set(aid, a.status);
        }
      }

      // 3. Dream cycle — dedicated endpoint that returns 200 even when no
      //    dream has happened yet (avoids 404 spam from /api/files/read).
      try {
        const dm = await fetch('/api/v2/dream-state');
        if (dm.ok) {
          const dmJson = await dm.json();
          const updatedAt = dmJson.saved_at || dmJson.last_updated;
          if (seen.dreamAt && updatedAt && updatedAt !== seen.dreamAt && initialized) {
            window.ToastManager?.show({
              type: 'dream',
              icon: '☾',
              title: 'Dream cycle completed',
              body: dmJson.type === 'soul_update'
                ? 'Soul updated' + (dmJson.skills_updated ? ` · ${dmJson.skills_updated} skill(s)` : '')
                : (dmJson.reflection?.slice(0, 80) || 'Memory consolidated'),
              duration: 7000,
            });
          }
          seen.dreamAt = updatedAt;
        }
      } catch {}

      initialized = true;
    } catch (e) {
      // Network or parse error — ignore, retry next tick
    }
  }

  // ── Real-time lifecycle channel via SSE (instant, no 5s poll lag) ──
  function connectSSE() {
    try {
      const sse = new EventSource('/api/v2/reasoning/stream');
      sse.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.type === 'task_lifecycle') {
            const tid = data.task_id;
            if (seen.results.has(tid)) return;
            seen.results.add(tid);
            const ok = data.status === 'completed';
            window.ToastManager?.show({
              id: 'result_' + tid,
              type: ok ? 'success' : 'error',
              icon: ok ? '✓' : '✗',
              title: ok ? 'Task completed' : 'Task ' + data.status,
              body: (data.title || tid).slice(0, 80) +
                    (data.assigned_name ? ' · ' + data.assigned_name : ''),
              action: ok && data.result_file ? {
                label: 'VIEW',
                onClick: () => {
                  if (window.TaskQueueUI?.openTaskResult) window.TaskQueueUI.openTaskResult(tid);
                }
              } : null,
              duration: 8000,
            });
          } else if (data.type === 'bg_task_complete' && data.kind === 'project_audit') {
            // Project audit finished — let the user know
            const projId = (data.task_id || '').replace(/^audit_/, '');
            window.ToastManager?.show({
              type: 'info',
              icon: '🔍',
              title: 'Project audit complete',
              body: 'Poseidon updated next_steps for ' + (projId || 'a project'),
              duration: 5000,
            });
          }
        } catch {}
      };
      sse.onerror = () => {
        // Reconnect with backoff
        try { sse.close(); } catch {}
        setTimeout(connectSSE, 5000);
      };
    } catch (e) {
      setTimeout(connectSSE, 5000);
    }
  }

  // Start polling after page is interactive
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    poll(); setInterval(poll, POLL_MS);
    connectSSE();
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      poll(); setInterval(poll, POLL_MS);
      connectSSE();
    });
  }
  console.log('[OK] NotificationPoller started (poll + SSE)');
})();
