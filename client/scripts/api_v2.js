/**
 * SquidMind API v2 Client - Neuronal Architecture
 * 
 * Single point of access to all registries.
 * See docs/WHY_THIS_ARCHITECTURE.md for design rationale.
 */

const ApiV2 = {
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
    get: () => ApiV2._fetch('/poseidon'),
    wake: () => ApiV2._fetch('/poseidon/wake', { method: 'POST' })
  },

  // AGENTS
  agents: {
    list: () => ApiV2._fetch('/agents'),
    get: (id) => ApiV2._fetch('/agents/' + id),
    create: (data) => ApiV2._fetch('/agents', { method: 'POST', body: JSON.stringify(data) })
  },

  // PROJECTS
  projects: {
    list: () => ApiV2._fetch('/projects'),
    get: (id) => ApiV2._fetch('/projects/' + id)
  },

  // TASKS
  tasks: {
    list: () => ApiV2._fetch('/tasks'),
    create: (data) => ApiV2._fetch('/tasks', { method: 'POST', body: JSON.stringify(data) }),
    close: (id, closureData) => ApiV2._fetch('/tasks/' + id + '/close', {
      method: 'POST',
      body: JSON.stringify(closureData)
    })
  },

  // LOGS
  logs: {
    recent: (limit = 50) => ApiV2._fetch('/logs?limit=' + limit)
  },

  // TOOLS
  tools: {
    list: () => ApiV2._fetch('/tools'),
    spec: (name) => ApiV2._fetch('/tools/' + name)
  },

  // MODELS
  models: {
    list: () => ApiV2._fetch('/models')
  }
};

window.ApiV2 = ApiV2;
console.log('[OK] ApiV2 client loaded');
