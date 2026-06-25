/**
 * SquidMind API Client
 *
 * Single point of access to all registries (V2 neuronal architecture).
 * URL paths stay /api/v2/... — only the client namespace was renamed from ApiV2 → api.
 * See docs/WHY_THIS_ARCHITECTURE.md for design rationale.
 */

const api = {
  baseUrl: '/api/v2',

  async _fetch(path, options = {}) {
    const res = await fetch(this.baseUrl + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'API error');
    return data;
  },

  // POSEIDON
  poseidon: {
    get: () => api._fetch('/poseidon'),
    wake: () => api._fetch('/poseidon/wake', { method: 'POST' })
  },

  // AGENTS
  agents: {
    list: () => api._fetch('/agents'),
    get: (id) => api._fetch('/agents/' + id),
    create: (data) => api._fetch('/agents', { method: 'POST', body: JSON.stringify(data) })
  },

  // PROJECTS
  projects: {
    list: () => api._fetch('/projects'),
    get: (id) => api._fetch('/projects/' + id)
  },

  // TASKS
  tasks: {
    list: () => api._fetch('/tasks'),
    create: (data) => api._fetch('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    close: (id, closureData) => api._fetch('/tasks/' + id + '/close', {
      method: 'POST',
      body: JSON.stringify(closureData)
    })
  },

  // LOGS
  logs: {
    recent: (limit = 50) => api._fetch('/logs?limit=' + limit)
  },

  // TOOLS
  tools: {
    list: () => api._fetch('/tools'),
    spec: (name) => api._fetch('/tools/' + name)
  },

  // MODELS
  models: {
    list: () => api._fetch('/models')
  },

  // ── Legacy compat methods (4 callsites in aquarium.js + ui.js depend on these) ──
  // Kept as flat methods so old code `api.getAgents()` keeps working without refactor.
  async getAgents() {
    try {
      const r = await fetch('/api/agents');
      const data = await r.json();
      return data.success ? data : { success: true, agents: data.agents || [] };
    } catch (e) { return { success: false, error: e.message, agents: [] }; }
  },
  async getAgent(id) {
    try {
      const r = await fetch('/api/v2/agents/' + id);
      return await r.json();
    } catch (e) { return { success: false, error: e.message }; }
  },
  async getTaskStatus() {
    try {
      const r = await fetch('/api/v2/tasks');
      return await r.json();
    } catch (e) { return { tasks: [] }; }
  },
};

window.api = api;
console.log('[OK] api client loaded');
