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
  async getLogs(filters = {}) {
    const params = new URLSearchParams(filters);
    return this.request(`/api/logs?${params}`);
  },
  async getHealth() {
    return this.request('/api/system/health');
  }
};
