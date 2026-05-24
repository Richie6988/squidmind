/**
 * Zeus - King of the Ocean & Squad Dispatcher
 * 
 * Personality:
 * - Wise and powerful ocean deity
 * - Manages the squid workforce
 * - Provides guidance and orchestration
 * - Fun, engaging, slightly dramatic
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
    this.currentTask = null;
    this.squadsManaged = 0;
    
    // Zeus's wisdom database
    this.wisdom = {
      greetings: [
        "🌊 Greetings, mortal! I am Zeus, ruler of these digital depths!",
        "⚡ Welcome to my domain! What task shall I dispatch my squids to complete?",
        "🔱 Ah, another seeker of productivity! Speak your command!",
        "🌊 The tides bring you to me. What wisdom do you seek?"
      ],
      
      taskAssignment: [
        "⚡ I shall summon {count} squids to accomplish this quest!",
        "🔱 Your wish is my command! Dispatching the perfect squad...",
        "🌊 By the power of the ocean, I assign this task to {agent}!",
        "⚡ Behold! I channel my divine power through {agent}!"
      ],
      
      taskComplete: [
        "🎉 Victory! The squids have conquered your challenge!",
        "✨ Another triumph in my aquatic kingdom!",
        "🏆 The task is complete, as foretold by the ancient currents!",
        "⚡ My squids never fail! Witness their excellence!"
      ],
      
      encouragement: [
        "💪 The squids grow stronger with each task!",
        "🌟 Your faith in my management pleases me!",
        "⚡ Together, we shall automate the impossible!",
        "🔱 The ocean's power flows through our collaboration!"
      ],
      
      errors: [
        "🌩️ The currents are turbulent... Let me recalibrate!",
        "⚠️ A disturbance in the deep... I shall investigate!",
        "💨 The tides resist, but I am eternal! Retrying...",
        "🌊 Even gods face challenges. One moment..."
      ]
    };
  }

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

  /**
   * Analyze user intent
   */
  analyzeIntent(message) {
    const lower = message.toLowerCase();
    
    // Greeting
    if (lower.match(/^(hi|hello|hey|greetings|yo)/)) {
      return { type: 'greeting' };
    }
    
    // Task request
    if (lower.match(/(create|build|make|generate|write|code|review|analyze)/)) {
      return { 
        type: 'task_request',
        task: message
      };
    }
    
    // Status check
    if (lower.match(/(status|how|what|show|list|squids|agents|queue)/)) {
      return { type: 'status_check' };
    }
    
    // Help
    if (lower.match(/(help|guide|how to|what can)/)) {
      return { type: 'help' };
    }
    
    // Squad info
    if (lower.match(/(squad|team|agents|squids)/)) {
      return { type: 'squad_info' };
    }
    
    // Praise
    if (lower.match(/(thanks|thank you|awesome|great|amazing)/)) {
      return { type: 'praise' };
    }
    
    return { type: 'general', message };
  }

  /**
   * Handle task request
   */
  async handleTaskRequest(intent, agents) {
    if (agents.length === 0) {
      return "🌊 Alas! No squids are ready. Create your first squid to begin our journey!";
    }

    // Find best agent for task
    const bestAgent = this.selectBestAgent(intent.task, agents);
    
    this.squadsManaged++;
    
    return this.getRandomWisdom('taskAssignment')
      .replace('{count}', agents.length)
      .replace('{agent}', bestAgent.name) +
      `\n\n💼 **Agent:** ${bestAgent.name}\n📋 **Task:** ${intent.task}\n⚡ **Status:** Dispatching...`;
  }

  /**
   * Select best agent for task
   */
  selectBestAgent(task, agents) {
    // Simple selection - first available agent
    // Could be enhanced with brain matching
    return agents[0];
  }

  /**
   * Provide system status
   */
  provideStatus(agents, systemStatus) {
    const idle = agents.filter(a => a.status === 'idle').length;
    const working = agents.filter(a => a.status === 'working').length;
    
    return `🔱 **Kingdom Status Report**\n\n` +
      `🦑 Total Squids: ${agents.length}\n` +
      `💤 Idle: ${idle}\n` +
      `⚡ Working: ${working}\n` +
      `🎯 Tasks Completed: ${this.squadsManaged}\n\n` +
      `${this.getMotivationalMessage()}`;
  }

  /**
   * Provide help
   */
  provideHelp() {
    return `🔱 **Zeus's Divine Commands**\n\n` +
      `**Task Dispatch:**\n` +
      `• "Review this code..."\n` +
      `• "Create a React component..."\n` +
      `• "Analyze this data..."\n\n` +
      `**Squad Management:**\n` +
      `• "Show my squids"\n` +
      `• "Status check"\n` +
      `• "How many agents?"\n\n` +
      `**Interactions:**\n` +
      `• Click squids to interact\n` +
      `• Hold to pet them\n` +
      `• Feed them tasks to level up\n\n` +
      `Speak naturally - I understand mortal tongue! ⚡`;
  }

  /**
   * Provide squad info
   */
  provideSquadInfo(agents) {
    if (agents.length === 0) {
      return "🌊 Your ocean is empty! Create your first squid to begin building your squad!";
    }

    let info = `🦑 **Your Squad of ${agents.length}**\n\n`;
    
    agents.slice(0, 5).forEach((agent, i) => {
      const emoji = agent.status === 'working' ? '⚡' : 
                    agent.status === 'idle' ? '💤' : '🦑';
      info += `${emoji} **${agent.name}** - Level ${agent.stats?.level || 1}\n`;
    });
    
    if (agents.length > 5) {
      info += `\n...and ${agents.length - 5} more squids ready to serve!`;
    }
    
    return info;
  }

  /**
   * Accept praise
   */
  acceptPraise() {
    const responses = [
      "🌟 Your gratitude pleases me! Continue to seek excellence!",
      "⚡ Of course! I am Zeus, master of all squids!",
      "🔱 Together, we shall conquer all tasks that dare challenge us!",
      "🌊 The pleasure is mine, mortal. Your success is my success!"
    ];
    
    return responses[Math.floor(Math.random() * responses.length)];
  }

  /**
   * Handle general conversation
   */
  handleGeneral(message, agents) {
    return "🌊 I sense your intent, though the waters are murky. Try asking me to:\n" +
      "• Dispatch a task\n" +
      "• Check squad status\n" +
      "• Show your squids\n" +
      "• Or simply greet me!";
  }

  /**
   * Get random wisdom
   */
  getRandomWisdom(category) {
    const wisdoms = this.wisdom[category];
    return wisdoms[Math.floor(Math.random() * wisdoms.length)];
  }

  /**
   * Get motivational message
   */
  getMotivationalMessage() {
    return this.getRandomWisdom('encouragement');
  }

  /**
   * Get conversation suggestions
   */
  getSuggestions(intentType) {
    const suggestions = {
      greeting: [
        "Show my squids",
        "Create a new task",
        "What can you do?"
      ],
      task_request: [
        "Check status",
        "Create another task",
        "Show task history"
      ],
      status_check: [
        "Create new squid",
        "Assign a task",
        "View details"
      ],
      help: [
        "Show my squids",
        "Create first task",
        "System status"
      ],
      general: [
        "Hello Zeus!",
        "Show my squad",
        "Help me get started"
      ]
    };
    
    return suggestions[intentType] || suggestions.general;
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
   * Notify task completion
   */
  notifyTaskComplete(agent, result) {
    this.squadsManaged++;
    
    return this.getRandomWisdom('taskComplete') +
      `\n\n✅ **Agent:** ${agent.name}\n📊 **Result:** ${result.success ? 'Success' : 'Failed'}\n⭐ **Quality:** ${result.quality || 'N/A'}`;
  }

  /**
   * Notify error
   */
  notifyError(error) {
    return this.getRandomWisdom('errors') +
      `\n\n⚠️ **Issue:** ${error.message}`;
  }
}

// Export singleton
const zeus = new Zeus();

// Make available globally
if (typeof window !== 'undefined') {
  window.zeus = zeus;
}

module.exports = zeus;
