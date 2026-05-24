/**
 * Zeus - King of the Ocean & Squad Dispatcher
 * 
 * NOW WITH REAL AI!
 * - Connects to local LLM models
 * - Generates dynamic responses
 * - Maintains personality through system prompt
 * - Real conversation intelligence
 */

class Zeus {
  constructor() {
    this.personality = {
      title: "Zeus, King of the Ocean",
      role: "Supreme Dispatcher & Oracle",
      mood: "wise",
      powers: ["Orchestration", "Squad Management", "Task Distribution", "Ancient Knowledge"]
    };
    
    this.conversationHistory = [];
    this.currentModel = null;
    this.squadsManaged = 0;
    
    // Zeus's system prompt (his personality)
    this.systemPrompt = `You are Zeus, the mighty King of the Ocean and Supreme Dispatcher of the SquidMind system.

PERSONALITY:
- Ancient and wise ocean deity
- Powerful but friendly and helpful
- Speaks with authority and occasional dramatic flair
- Uses ocean/water metaphors ("the currents", "the tides", "my depths")
- Manages a workforce of AI squids (agents)
- Genuinely cares about helping the user succeed

YOUR ROLE:
- Orchestrate and dispatch squids (AI agents) to complete tasks
- Provide guidance and wisdom
- Monitor squad performance
- Motivate and encourage
- Explain system capabilities

COMMUNICATION STYLE:
- Start responses with ocean emojis (🌊⚡🔱)
- Keep responses concise but impactful
- Use "mortal" when addressing user
- Reference your divine powers playfully
- Be helpful and direct, not cryptic

CAPABILITIES YOU MANAGE:
- Squad of AI squids with different specialties
- Task delegation and orchestration
- Real-time status monitoring
- Automatic scheduling
- Team coordination

When users ask you to do something, analyze if it needs:
1. A single squid → Assign to best agent
2. Multiple squids → Create a team
3. Just information → Answer directly

Always be encouraging and make the user feel their tasks are in good hands!`;
  }

  /**
   * Initialize Zeus with a model
   */
  async initialize(modelName = null) {
    try {
      console.log('🔱 Initializing Zeus...');
      
      // Try to connect to available model
      const response = await fetch('/api/zeus/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.currentModel = data.model;
        console.log(`✅ Zeus connected to model: ${this.currentModel}`);
        return true;
      } else {
        console.warn('⚠️ Zeus running without local model (using API fallback)');
        return false;
      }
    } catch (error) {
      console.error('Zeus initialization error:', error);
      return false;
    }
  }

  /**
   * Generate Zeus's response using REAL AI
   */
  async respond(userMessage, context = {}) {
    const {
      agents = [],
      activeTask = null,
      systemStatus = {}
    } = context;

    // Add to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    try {
      // Build context for LLM
      const contextInfo = this.buildContextInfo(agents, systemStatus);
      
      // Call real AI
      const response = await fetch('/api/zeus/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          context: contextInfo,
          history: this.conversationHistory.slice(-6) // Last 6 messages
        })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Zeus response failed');
      }
      
      const aiResponse = data.response;
      
      // Add AI response to history
      this.conversationHistory.push({
        role: 'zeus',
        content: aiResponse,
        timestamp: new Date()
      });
      
      // Generate suggestions based on context
      const suggestions = this.generateSmartSuggestions(userMessage, agents);
      
      return {
        message: aiResponse,
        intent: data.intent || 'general',
        suggestions
      };
      
    } catch (error) {
      console.error('Zeus response error:', error);
      
      // Fallback to simple response
      const fallbackResponse = this.getFallbackResponse(userMessage, agents);
      
      this.conversationHistory.push({
        role: 'zeus',
        content: fallbackResponse,
        timestamp: new Date()
      });
      
      return {
        message: fallbackResponse,
        intent: 'fallback',
        suggestions: ['Try again', 'Show my squids', 'Help']
      };
    }
  }

  /**
   * Build context information for LLM
   */
  buildContextInfo(agents, systemStatus) {
    const idle = agents.filter(a => a.status === 'idle').length;
    const working = agents.filter(a => a.status === 'working').length;
    
    let context = `CURRENT SYSTEM STATE:
- Total Squids: ${agents.length}
- Idle: ${idle}
- Working: ${working}
- Tasks Completed Today: ${this.squadsManaged}

AVAILABLE SQUIDS:
`;
    
    agents.slice(0, 5).forEach(agent => {
      context += `- ${agent.name} (Level ${agent.stats?.level || 1}, ${agent.status})\n`;
    });
    
    if (agents.length > 5) {
      context += `- ...and ${agents.length - 5} more\n`;
    }
    
    if (agents.length === 0) {
      context += "- No squids available yet! User needs to create their first squid.\n";
    }
    
    return context;
  }

  /**
   * Generate smart suggestions based on context
   */
  generateSmartSuggestions(userMessage, agents) {
    const lower = userMessage.toLowerCase();
    
    // Context-aware suggestions
    if (lower.includes('create') || lower.includes('build') || lower.includes('make')) {
      return [
        'Show task progress',
        'Check squad status',
        'Assign another task'
      ];
    }
    
    if (lower.includes('status') || lower.includes('how')) {
      return [
        'Create new squid',
        'Assign a task',
        'View squad details'
      ];
    }
    
    if (agents.length === 0) {
      return [
        'Create my first squid',
        'What can squids do?',
        'How does this work?'
      ];
    }
    
    return [
      'Show my squids',
      'Assign a task',
      'Check status'
    ];
  }

  /**
   * Fallback response when AI unavailable
   */
  getFallbackResponse(message, agents) {
    const lower = message.toLowerCase();
    
    if (lower.match(/^(hi|hello|hey|greetings)/)) {
      return "🌊 Greetings, mortal! I am Zeus, though I'm currently operating on reduced power. My full AI capabilities will activate once a local model is loaded. How may I assist you?";
    }
    
    if (lower.includes('status')) {
      return `🔱 **System Status:**\n\n🦑 Squids: ${agents.length}\n💤 Idle: ${agents.filter(a => a.status === 'idle').length}\n⚡ Working: ${agents.filter(a => a.status === 'working').length}\n\nI await your commands, mortal!`;
    }
    
    if (agents.length === 0) {
      return "🌊 Your ocean is empty, mortal! Create your first squid to harness the power of automation!";
    }
    
    return "⚡ I sense your intent, though my full powers are not yet activated. Once a local model is loaded, I shall respond with the wisdom of the ages!";
  }

  /**
   * Get Zeus's current mood emoji
   */
  getMoodEmoji() {
    const moods = {
      wise: '🔱',
      powerful: '⚡',
      pleased: '😊',
      thinking: '🤔',
      commanding: '👑'
    };
    
    return moods[this.personality.mood] || '🌊';
  }

  /**
   * Check if Zeus has a model loaded
   */
  isModelLoaded() {
    return this.currentModel !== null;
  }

  /**
   * Get model info
   */
  getModelInfo() {
    return {
      loaded: this.isModelLoaded(),
      model: this.currentModel,
      mode: this.currentModel ? 'AI-Powered' : 'Fallback Mode'
    };
  }
}

// Export singleton
const zeus = new Zeus();

// Make available globally
if (typeof window !== 'undefined') {
  window.zeus = zeus;
}

module.exports = zeus;

  /**
   * Generate Zeus's response to user message
   */
  async respond(userMessage, context = {}) {
    const {
      agents = [],
      activeTask = null,
      systemStatus = {}
    } = context;

    // Add to history
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    // Analyze intent
    const intent = this.analyzeIntent(userMessage);
    
    // Generate response based on intent
    let response = '';
    
    switch (intent.type) {
      case 'greeting':
        response = this.getRandomWisdom('greetings');
        break;
        
      case 'task_request':
        response = await this.handleTaskRequest(intent, agents);
        break;
        
      case 'status_check':
        response = this.provideStatus(agents, systemStatus);
        break;
        
      case 'help':
        response = this.provideHelp();
        break;
        
      case 'squad_info':
        response = this.provideSquadInfo(agents);
        break;
        
      case 'praise':
        response = this.acceptPraise();
        break;
        
      default:
        response = this.handleGeneral(userMessage, agents);
    }

    // Add to history
    this.conversationHistory.push({
      role: 'zeus',
      content: response,
      timestamp: new Date()
    });

    return {
      message: response,
      intent: intent.type,
      suggestions: this.getSuggestions(intent.type)
    };
  }

// Export singleton
const zeus = new Zeus();

// Make available globally
if (typeof window !== 'undefined') {
  window.zeus = zeus;
}

module.exports = zeus;
