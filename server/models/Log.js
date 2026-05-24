const fs = require('fs').promises;
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../../data/logs');

class Log {
  constructor(data) {
    this.id = data.id || `log_${Date.now()}`;
    this.agent_id = data.agent_id;
    this.agent_name = data.agent_name;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.type = data.type || 'execution'; // execution, error, communication
    this.status = data.status || 'pending'; // pending, success, error
    this.input = data.input || '';
    this.output = data.output || '';
    this.error = data.error || null;
    this.duration_ms = data.duration_ms || 0;
    this.metadata = data.metadata || {};
  }

  async save() {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    const date = new Date().toISOString().split('T')[0];
    const filepath = path.join(LOGS_DIR, `${date}.jsonl`);
    const logLine = JSON.stringify(this) + '\n';
    await fs.appendFile(filepath, logLine);
    return this;
  }

  static async query(filters = {}) {
    try {
      await fs.mkdir(LOGS_DIR, { recursive: true });
      const files = await fs.readdir(LOGS_DIR);
      const logFiles = files.filter(f => f.endsWith('.jsonl')).sort().reverse();
      
      let logs = [];
      
      // Read last N days (default 7)
      const daysToRead = filters.days || 7;
      for (let i = 0; i < Math.min(daysToRead, logFiles.length); i++) {
        const content = await fs.readFile(path.join(LOGS_DIR, logFiles[i]), 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        logs.push(...lines.map(line => new Log(JSON.parse(line))));
      }
      
      // Apply filters
      if (filters.agent_id) {
        logs = logs.filter(log => log.agent_id === filters.agent_id);
      }
      if (filters.status) {
        logs = logs.filter(log => log.status === filters.status);
      }
      if (filters.type) {
        logs = logs.filter(log => log.type === filters.type);
      }
      
      // Limit results
      const limit = filters.limit || 100;
      return logs.slice(0, limit);
    } catch (error) {
      console.error('Error querying logs:', error);
      return [];
    }
  }

  static async prune(daysToKeep = 30) {
    try {
      const files = await fs.readdir(LOGS_DIR);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const fileDate = new Date(file.replace('.jsonl', ''));
        if (fileDate < cutoffDate) {
          await fs.unlink(path.join(LOGS_DIR, file));
        }
      }
    } catch (error) {
      console.error('Error pruning logs:', error);
    }
  }
}

module.exports = Log;
