const fs = require('fs').promises;
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '../../data/agents');

class Agent {
  constructor(data) {
    this.id = data.id || `squid_${Date.now()}`;
    this.name = data.name || 'Unnamed Squid';
    this.type = data.type || 'worker';
    this.created_at = data.created_at || new Date().toISOString();
    this.status = data.status || 'idle'; // idle, working, thinking, sleeping, error
    this.current_thought = data.current_thought || null;
    this.group_id = data.group_id || null;
    this.brain_id = data.brain_id || null; // Reference to Brain
    
    this.llm = data.llm || {
      provider: 'anthropic',
      model: 'claude-haiku-4-20250514', // Petits modèles par défaut
      temperature: 0.7,
      max_tokens: 500 // Réponses courtes
    };
    
    this.prompt = data.prompt || {
      system: '',
      context: []
    };
    
    this.tools = data.tools || [];
    
    this.schedule = data.schedule || {
      cron: null,
      timezone: 'Europe/Paris',
      enabled: false
    };
    
    this.hierarchy = data.hierarchy || {
      reports_to: 'main_squid',
      can_spawn: false,
      priority: 5
    };
    
    this.reporting = data.reporting || {
      log_level: 'info',
      notify_on: ['error', 'completion'],
      destinations: []
    };
    
    this.memory = data.memory || {
      identity: {
        role: '',
        expertise: [],
        personality_traits: []
      },
      user: {
        preferences: {},
        history: []
      },
      kanban: {
        todo: [],
        in_progress: [],
        done: [],
        blocked: []
      },
      agents: {
        collaborators: [],
        dependencies: []
      },
      projects: {
        active: [],
        completed: []
      },
      knowledge_base: {},
      short_term: {},
      long_term: {},
      max_history: 50
    };
    
    this.visual = data.visual || {
      color: this.type === 'main' ? '#E63946' : '#06FFA5',
      size: this.type === 'main' ? 'large' : 'medium',
      animation_speed: 1.0
    };
  }

  async save() {
    await fs.mkdir(AGENTS_DIR, { recursive: true });
    const filepath = path.join(AGENTS_DIR, `${this.id}.json`);
    await fs.writeFile(filepath, JSON.stringify(this, null, 2));
    return this;
  }

  static async findById(id) {
    try {
      const filepath = path.join(AGENTS_DIR, `${id}.json`);
      const data = await fs.readFile(filepath, 'utf8');
      return new Agent(JSON.parse(data));
    } catch (error) {
      return null;
    }
  }

  static async findAll() {
    try {
      await fs.mkdir(AGENTS_DIR, { recursive: true });
      const files = await fs.readdir(AGENTS_DIR);
      const agents = await Promise.all(
        files
          .filter(f => f.endsWith('.json'))
          .map(async (file) => {
            const data = await fs.readFile(path.join(AGENTS_DIR, file), 'utf8');
            return new Agent(JSON.parse(data));
          })
      );
      return agents;
    } catch (error) {
      return [];
    }
  }

  static async delete(id) {
    try {
      const filepath = path.join(AGENTS_DIR, `${id}.json`);
      await fs.unlink(filepath);
      return true;
    } catch (error) {
      return false;
    }
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      type: this.type,
      created_at: this.created_at,
      status: this.status,
      llm: this.llm,
      prompt: this.prompt,
      tools: this.tools,
      schedule: this.schedule,
      hierarchy: this.hierarchy,
      reporting: this.reporting,
      memory: this.memory,
      visual: this.visual
    };
  }
}

module.exports = Agent;
