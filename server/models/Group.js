const fs = require('fs').promises;
const path = require('path');

const GROUPS_DIR = path.join(__dirname, '../../data/groups');

class Group {
  constructor(data) {
    this.id = data.id || `group_${Date.now()}`;
    this.name = data.name || 'Unnamed Group';
    this.description = data.description || '';
    this.created_at = data.created_at || new Date().toISOString();
    this.status = data.status || 'active'; // active, paused, completed
    
    // Members
    this.members = data.members || []; // Array of agent IDs
    this.leader_id = data.leader_id || null;
    
    // Task coordination
    this.shared_task = data.shared_task || {
      description: '',
      deadline: null,
      priority: 5
    };
    
    // Communication
    this.chat_history = data.chat_history || [];
    this.shared_memory = data.shared_memory || {};
    
    // Scheduling
    this.schedule = data.schedule || {
      cron: null,
      enabled: false
    };
  }

  async save() {
    await fs.mkdir(GROUPS_DIR, { recursive: true });
    const filepath = path.join(GROUPS_DIR, `${this.id}.json`);
    await fs.writeFile(filepath, JSON.stringify(this, null, 2));
    return this;
  }

  static async findById(id) {
    try {
      const filepath = path.join(GROUPS_DIR, `${id}.json`);
      const data = await fs.readFile(filepath, 'utf8');
      return new Group(JSON.parse(data));
    } catch (error) {
      return null;
    }
  }

  static async findAll() {
    try {
      await fs.mkdir(GROUPS_DIR, { recursive: true });
      const files = await fs.readdir(GROUPS_DIR);
      const groups = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async (file) => {
            const data = await fs.readFile(path.join(GROUPS_DIR, file), 'utf8');
            return new Group(JSON.parse(data));
          })
      );
      return groups;
    } catch (error) {
      return [];
    }
  }

  static async delete(id) {
    try {
      const filepath = path.join(GROUPS_DIR, `${id}.json`);
      await fs.unlink(filepath);
      return true;
    } catch (error) {
      return false;
    }
  }

  addMember(agentId) {
    if (!this.members.includes(agentId)) {
      this.members.push(agentId);
    }
  }

  removeMember(agentId) {
    this.members = this.members.filter(id => id !== agentId);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      created_at: this.created_at,
      status: this.status,
      members: this.members,
      leader_id: this.leader_id,
      shared_task: this.shared_task,
      chat_history: this.chat_history,
      shared_memory: this.shared_memory,
      schedule: this.schedule
    };
  }
}

module.exports = Group;
