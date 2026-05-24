const api = {
  baseUrl: window.location.origin,

  async request(endpoint, options = {}) {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        },
        ...options
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }
      
      return data;
    } catch (error) {
      console.error('API Error:', error);
      throw error;
    }
  },

  // Agent endpoints
  async getAgents() {
    return this.request('/api/agents');
  },

  async getAgent(id) {
    return this.request(`/api/agents/${id}`);
  },

  async createAgent(data) {
    return this.request('/api/agents', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  },

  async updateAgent(id, data) {
    return this.request(`/api/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  },

  async deleteAgent(id) {
    return this.request(`/api/agents/${id}`, {
      method: 'DELETE'
    });
  },

  async executeAgent(id, input = '', mcpServers = []) {
    return this.request(`/api/agents/${id}/execute`, {
      method: 'POST',
      body: JSON.stringify({ input, mcp_servers: mcpServers })
    });
  },

  // Log endpoints
  async getLogs(filters = {}) {
    const params = new URLSearchParams(filters);
    return this.request(`/api/logs?${params}`);
  },

  // Task endpoints
  async getTaskStatus() {
    return this.request('/api/tasks/status');
  },

  async getUpcomingTasks(limit = 10) {
    return this.request(`/api/tasks/upcoming?limit=${limit}`);
  },

  // System endpoints
  async getHealth() {
    return this.request('/api/system/health');
  }
};
