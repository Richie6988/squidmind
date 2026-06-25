/**
 * SquidMind API Client
 *
 * Single point of access to all registry endpoints under /api/v2/*.
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
    create: (data) => api._fetch('/agents', { method: 'POST', body: JSON.stringify(data) }),
    // Returns agents as a flat array (transforms the registry-keyed map for canvas/iter usage)
    async flat() {
      const r = await api._fetch('/agents');
      return Object.values(r.registry?.agents || {});
    }
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
};

window.api = api;
console.log('[OK] api client loaded');
