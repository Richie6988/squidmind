const fs = require('fs').promises;
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '../../data/agents');

class Agent {
  constructor(data) {
    this.id = data.id || `squid_${Date.now()}`;
    this.name = data.name || 'Unnamed Squid';
    this.nickname = data.nickname || null; // Pokemon-style nickname
    this.type = data.type || 'worker';
    this.created_at = data.created_at || new Date().toISOString();
    this.status = data.status || 'idle'; // idle, working, thinking, sleeping, error
    this.specialization = data.specialization || null;
    this.current_thought = data.current_thought || null;
    this.group_id = data.group_id || null;
    this.brain_id = data.brain_id || null; // Reference to Brain
    
    // Visual customization (Pokemon-style)
    this.appearance = data.appearance || {
      body_color: '#FF6B9D', // Main squid color
      accent_color: '#FFE66D', // Secondary color
      eye_style: 'round', // round, cute, sleepy, sharp
      tentacle_style: 'wavy', // wavy, straight, curly
      size: 'medium', // small, medium, large
      glow_intensity: 0.5 // 0-1
    };
    
    // V2 accessories (also nested in appearance.accessories)
    this.accessories = data.accessories || (data.appearance && data.appearance.accessories) || null;
    
    // Outfit/Accessories (unlock system)
    this.outfit = data.outfit || {
      hat: null, // 'wizard_hat', 'crown', 'cap', 'headphones'
      accessory: null, // 'glasses', 'bowtie', 'scarf', 'necklace'
      tool: null, // 'wand', 'laptop', 'magnifying_glass'
      background_effect: null // 'sparkles', 'code_rain', 'flames'
    };
    
    // Stats & Performance (for marketplace)
    this.stats = data.stats || {
      level: 1,
      experience: 0,
      total_executions: 0,
      success_count: 0,
      average_quality: 0, // 0-10 rating
      speed_rating: 0, // tokens/second
      specialization_score: 0, // How good at its brain specialty
      user_ratings: [], // Array of {user_id, rating, comment}
      badges: [] // Earned achievements
    };
    
    // V2 performance summary from agent_registry - drives level calculation
    this.performance_summary = data.performance_summary || null;
    
    // Personality & Behavior (Pokemon-style traits)
    this.personality = data.personality || {
      mood: 'happy', // happy, focused, tired, excited, grumpy
      energy: 100, // 0-100, decreases with use
      affection: 50, // 0-100, increases with interaction
      traits: [], // 'curious', 'careful', 'speedy', 'thorough'
      favorite_tasks: [], // Track what it likes doing
      animation_style: 'bouncy' // bouncy, smooth, energetic, calm
    };
    
    // Marketplace data
    this.marketplace = data.marketplace || {
      is_for_sale: false,
      price: 0,
      owner_id: null,
      clone_count: 0, // How many times cloned/sold
      original_creator: null,
      royalty_percentage: 10 // % to original creator on resale
    };

    this.llm = data.llm || {
      provider: 'anthropic',
      model: 'claude-haiku-4-20250514',
      temperature: 0.7,
      max_tokens: 500
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
      
      // SINGLE SOURCE OF TRUTH: agent_registry.json. We iterate registered
      // agents and load each brain file by its registered brain_file path.
      // Stale brain JSON files lying around in the directory are IGNORED -
      // this fixes the "hardcoded agents keep showing up" bug.
      let registry = { agents: {} };
      try {
        const regRaw = await fs.readFile(path.join(AGENTS_DIR, 'agent_registry.json'), 'utf8');
        registry = JSON.parse(regRaw);
      } catch {
        return [];  // no registry = no agents
      }
      
      const entries = Object.values(registry.agents || {});
      const agents = await Promise.all(entries.map(async (entry) => {
        try {
          const brainPath = path.join(AGENTS_DIR, entry.brain_file);
          const data = await fs.readFile(brainPath, 'utf8');
          const brain = JSON.parse(data);
          
          // Registry is authoritative for these fields
          brain.id = entry.agent_id;
          brain.name = entry.display_name || brain.identity?.display_name;
          brain.status = entry.status || 'sleeping';
          brain.specialization = entry.specialization;
          if (entry.performance_summary) brain.performance_summary = entry.performance_summary;
          
          return new Agent(brain);
        } catch (err) {
          console.warn(`[Agent.findAll] Could not load ${entry.agent_id} (${entry.brain_file}):`, err.message);
          return null;
        }
      }));
      return agents.filter(Boolean);
    } catch (error) {
      console.warn('[Agent.findAll]', error.message);
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
      nickname: this.nickname,
      type: this.type,
      created_at: this.created_at,
      status: this.status,
      specialization: this.specialization,
      current_thought: this.current_thought,
      group_id: this.group_id,
      brain_id: this.brain_id,
      // V2 fields - critical for canvas rendering
      appearance: this.appearance,
      outfit: this.outfit,
      accessories: this.accessories || (this.appearance && this.appearance.accessories) || null,
      stats: this.stats,
      personality: this.personality,
      performance_summary: this.performance_summary || null,  // V2 task counters -> drives level
      // Legacy V1 fields
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
