/**
 * Poseidon - God of the Ocean & Squad Dispatcher
 * 
 * REAL AI + VISIBLE IN AQUARIUM!
 * - Majestic character swimming in ocean
 * - Connects to local LLM models  
 * - Generates dynamic responses
 * - Interactive (hover, click)
 * - Real conversation intelligence
 */

class Poseidon {
  constructor() {
    this.personality = {
      title: "Poseidon, God of the Ocean",
      role: "Supreme Dispatcher & Oracle",
      mood: "wise",
      powers: ["Orchestration", "Squad Management", "Task Distribution", "Ancient Knowledge"]
    };
    
    // Visual representation in aquarium
    this.x = 100;
    this.y = 100;
    this.size = 80;
    this.rotation = 0;
    this.floatOffset = 0;
    this.visible = true;
    this.hovered = false;
    
    // Animation
    this.targetX = 100;
    this.targetY = 100;
    this.particles = [];
    
    this.conversationHistory = [];
    this.currentModel = null;
    this.squadsManaged = 0;
    
    // Poseidon's system prompt
    this.systemPrompt = `You are Poseidon, the mighty God of the Ocean and Supreme Dispatcher of the SquidMind system.

PERSONALITY:
- Ancient and wise ocean deity (POSEIDON, not Zeus!)
- Powerful but friendly and helpful
- Speaks with authority and occasional dramatic flair
- Uses ocean/water metaphors ("the currents", "the tides", "my depths", "the waves")
- Manages a workforce of AI squids (agents)
- Genuinely cares about helping the user succeed

YOUR ROLE:
- Orchestrate and dispatch squids (AI agents) to complete tasks
- Provide guidance and wisdom
- Monitor squad performance
- Motivate and encourage
- Explain system capabilities

COMMUNICATION STYLE:
- Start responses with ocean emojis ([OCEAN]⚡[POSEIDON])
- Keep responses concise (2-4 sentences max)
- Use "mortal" when addressing user
- Reference your divine powers playfully
- Be helpful and direct, not cryptic

Always be encouraging and make the user feel their tasks are in good hands!`;
  }

  /**
   * Initialize Poseidon with a model
   */
  async initialize(modelName = null) {
    try {
      console.log('[POSEIDON] Initializing Poseidon...');
      
      const response = await fetch('/api/poseidon/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelName })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.currentModel = data.model;
        console.log(`[OK] Poseidon connected to model: ${this.currentModel}`);
        return true;
      } else {
        console.warn('⚠️ Poseidon running without local model');
        return false;
      }
    } catch (error) {
      console.error('Poseidon initialization error:', error);
      return false;
    }
  }

  /**
   * Set position in aquarium
   */
  setPosition(x, y) {
    this.targetX = x;
    this.targetY = y;
  }

  /**
   * Update animation
   */
  update(deltaTime) {
    // Smooth movement
    this.x += (this.targetX - this.x) * 0.05;
    this.y += (this.targetY - this.y) * 0.05;
    
    // Floating animation
    this.floatOffset += deltaTime * 0.002;
    this.rotation = Math.sin(this.floatOffset) * 0.1;
    
    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      p.opacity = p.life / 60;
      
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
    
    // Emit divine particles when hovered
    if (this.hovered && Math.random() < 0.3) {
      this.particles.push({
        x: this.x + (Math.random() - 0.5) * this.size,
        y: this.y + (Math.random() - 0.5) * this.size,
        vx: (Math.random() - 0.5) * 2,
        vy: -Math.random() * 2,
        life: 60,
        opacity: 1,
        color: '#FFD700'
      });
    }
  }

  /**
   * Draw Poseidon in aquarium
   */
  draw(ctx, canvas) {
    if (!this.visible) return;
    
    // Draw particles
    this.particles.forEach(p => {
      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    
    ctx.save();
    
    // Position with floating
    const floatY = this.y + Math.sin(this.floatOffset) * 15;
    
    ctx.translate(this.x, floatY);
    ctx.rotate(this.rotation);
    
    // Hover glow
    if (this.hovered) {
      const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * 1.5);
      glow.addColorStop(0, 'rgba(255, 215, 0, 0.3)');
      glow.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(-this.size * 1.5, -this.size * 1.5, this.size * 3, this.size * 3);
    }
    
    // Draw majestic Poseidon
    this.drawPoseidon(ctx);
    
    ctx.restore();
    
    // Name tag
    ctx.fillStyle = this.hovered ? '#FFD700' : '#06FFA5';
    ctx.font = '12px "Press Start 2P"';
    ctx.textAlign = 'center';
    ctx.fillText('POSEIDON', this.x, floatY + this.size + 20);
    
    // Level indicator
    ctx.fillStyle = '#888';
    ctx.font = '8px "Press Start 2P"';
    ctx.fillText(`Divine Level ∞`, this.x, floatY + this.size + 35);
  }

  /**
   * Draw Poseidon character - MAJESTIC GOD with beard, crown, trident!
   */
  drawPoseidon(ctx) {
    const scale = this.hovered ? 1.1 : 1;
    ctx.scale(scale, scale);
    
    // Divine aura (larger!)
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size * 1.3);
    glow.addColorStop(0, 'rgba(30, 144, 255, 0.6)');
    glow.addColorStop(0.5, 'rgba(255, 215, 0, 0.3)');
    glow.addColorStop(1, 'rgba(30, 144, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(-this.size * 1.3, -this.size * 1.3, this.size * 2.6, this.size * 2.6);
    
    // Body (divine robes - ocean blue with gold trim)
    ctx.fillStyle = '#1E90FF';
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, this.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // CROWN (three points - classic god crown)
    ctx.fillStyle = '#FFD700';
    ctx.strokeStyle = '#FFA500';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Base of crown
    ctx.moveTo(-this.size * 0.4, -this.size * 0.45);
    ctx.lineTo(this.size * 0.4, -this.size * 0.45);
    // Left point
    ctx.lineTo(this.size * 0.3, -this.size * 0.65);
    // Middle point (tallest)
    ctx.lineTo(0, -this.size * 0.75);
    // Right point
    ctx.lineTo(-this.size * 0.3, -this.size * 0.65);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Crown gems
    ctx.fillStyle = '#FF1493'; // Pink gem
    ctx.beginPath();
    ctx.arc(0, -this.size * 0.68, this.size * 0.08, 0, Math.PI * 2);
    ctx.fill();
    
    // Eyes (wise and powerful)
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(-this.size * 0.2, -this.size * 0.1, this.size * 0.12, 0, Math.PI * 2);
    ctx.arc(this.size * 0.2, -this.size * 0.1, this.size * 0.12, 0, Math.PI * 2);
    ctx.fill();
    
    // Pupils (deep blue)
    ctx.fillStyle = '#000080';
    ctx.beginPath();
    ctx.arc(-this.size * 0.2, -this.size * 0.1, this.size * 0.05, 0, Math.PI * 2);
    ctx.arc(this.size * 0.2, -this.size * 0.1, this.size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    
    // BEARD (flowing, majestic!)
    ctx.fillStyle = '#E0E0E0'; // White/silver beard
    ctx.strokeStyle = '#C0C0C0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Beard shape (three flowing sections)
    ctx.moveTo(-this.size * 0.3, this.size * 0.15);
    ctx.quadraticCurveTo(-this.size * 0.4, this.size * 0.4, -this.size * 0.25, this.size * 0.55);
    ctx.quadraticCurveTo(0, this.size * 0.65, this.size * 0.25, this.size * 0.55);
    ctx.quadraticCurveTo(this.size * 0.4, this.size * 0.4, this.size * 0.3, this.size * 0.15);
    ctx.lineTo(this.size * 0.2, this.size * 0.1);
    ctx.lineTo(-this.size * 0.2, this.size * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    
    // Beard details (flowing lines)
    ctx.strokeStyle = '#A0A0A0';
    ctx.lineWidth = 1;
    for (let i = -2; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * this.size * 0.08, this.size * 0.15);
      ctx.quadraticCurveTo(i * this.size * 0.12, this.size * 0.4, i * this.size * 0.1, this.size * 0.6);
      ctx.stroke();
    }
    
    // TRIDENT (ICONIC!)
    ctx.save();
    ctx.translate(this.size * 0.6, 0);
    
    // Trident shaft (golden)
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, -this.size * 0.3);
    ctx.lineTo(0, this.size * 0.9);
    ctx.stroke();
    
    // Trident prongs (three sharp points)
    ctx.strokeStyle = '#FFD700';
    ctx.lineWidth = 4;
    ctx.beginPath();
    // Middle prong (longest)
    ctx.moveTo(0, -this.size * 0.6);
    ctx.lineTo(0, -this.size * 0.3);
    // Left prong
    ctx.moveTo(-this.size * 0.15, -this.size * 0.5);
    ctx.lineTo(-this.size * 0.15, -this.size * 0.25);
    ctx.lineTo(0, -this.size * 0.3);
    // Right prong
    ctx.moveTo(this.size * 0.15, -this.size * 0.5);
    ctx.lineTo(this.size * 0.15, -this.size * 0.25);
    ctx.lineTo(0, -this.size * 0.3);
    ctx.stroke();
    
    // Prong tips (sharp!)
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.arc(0, -this.size * 0.6, this.size * 0.05, 0, Math.PI * 2);
    ctx.arc(-this.size * 0.15, -this.size * 0.5, this.size * 0.05, 0, Math.PI * 2);
    ctx.arc(this.size * 0.15, -this.size * 0.5, this.size * 0.05, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.restore();
  }

  /**
   * Check if point is over Poseidon
   */
  isPointOver(x, y) {
    const dx = x - this.x;
    const dy = y - this.y;
    return Math.sqrt(dx * dx + dy * dy) < this.size;
  }

  /**
   * Handle click
   */
  handleClick() {
    // V2: Open the streaming chat with poseidon_brain context
    if (typeof PoseidonChat !== 'undefined') {
      PoseidonChat.open();
      return;
    }
    // Fallback to legacy panel if V2 chat not loaded
    if (typeof ui !== 'undefined') {
      ui.showPanel('poseidon');
    }
  }

  /**
   * Generate Poseidon's response using REAL AI
   */
  async respond(userMessage, context = {}) {
    const { agents = [], activeTask = null, systemStatus = {} } = context;

    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    try {
      const contextInfo = this.buildContextInfo(agents, systemStatus);
      
      const response = await fetch('/api/poseidon/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          context: contextInfo,
          history: this.conversationHistory.slice(-6)
        })
      });
      
      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'Poseidon response failed');
      }
      
      const aiResponse = data.response;
      
      this.conversationHistory.push({
        role: 'poseidon',
        content: aiResponse,
        timestamp: new Date()
      });
      
      const suggestions = this.generateSmartSuggestions(userMessage, agents);
      
      return {
        message: aiResponse,
        intent: data.intent || 'general',
        suggestions
      };
      
    } catch (error) {
      console.error('Poseidon response error:', error);
      
      const fallbackResponse = this.getFallbackResponse(userMessage, agents);
      
      this.conversationHistory.push({
        role: 'poseidon',
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
      context += "- No squids available yet!\n";
    }
    
    return context;
  }

  generateSmartSuggestions(userMessage, agents) {
    const lower = userMessage.toLowerCase();
    
    if (lower.includes('create') || lower.includes('build') || lower.includes('make')) {
      return ['Show task progress', 'Check squad status', 'Assign another task'];
    }
    
    if (lower.includes('status') || lower.includes('how')) {
      return ['Create new squid', 'Assign a task', 'View squad details'];
    }
    
    if (agents.length === 0) {
      return ['Create my first squid', 'What can squids do?', 'How does this work?'];
    }
    
    return ['Show my squids', 'Assign a task', 'Check status'];
  }

  getFallbackResponse(message, agents) {
    const lower = message.toLowerCase();
    
    if (lower.match(/^(hi|hello|hey|greetings)/)) {
      return "[OCEAN] Greetings, mortal! I am Poseidon, though my full AI powers await a model connection. How may I assist you?";
    }
    
    if (lower.includes('status')) {
      return `[POSEIDON] **Ocean Status:**\n\n[SQUID] Squids: ${agents.length}\n💤 Idle: ${agents.filter(a => a.status === 'idle').length}\n⚡ Working: ${agents.filter(a => a.status === 'working').length}\n\nThe tides are in your favor!`;
    }
    
    if (agents.length === 0) {
      return "[OCEAN] Your ocean is empty, mortal! Create your first squid to harness the power of the deep!";
    }
    
    return "⚡ I sense your intent! Once my divine model is loaded, I shall respond with the wisdom of the ocean depths!";
  }

  getMoodEmoji() {
    return this.personality.mood === 'wise' ? '[POSEIDON]' : '[OCEAN]';
  }

  isModelLoaded() {
    return this.currentModel !== null;
  }

  getModelInfo() {
    return {
      loaded: this.isModelLoaded(),
      model: this.currentModel,
      mode: this.currentModel ? 'AI-Powered' : 'Fallback Mode'
    };
  }

  /**
   * Load model selected from dropdown
   */
  async loadSelectedModel(modelPath) {
    if (!modelPath) {
      this.currentModel = null;
      console.log('[POSEIDON] Poseidon: Model unloaded');
      return;
    }
    
    console.log('[POSEIDON] Poseidon loading model from path:', modelPath);
    
    // Simple validation
    if (typeof modelPath !== 'string') {
      console.error('[ERROR] Invalid model path type:', typeof modelPath);
      alert('Invalid model path');
      return;
    }
    
    try {
      const response = await fetch('/api/models/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          path: modelPath,
          modelPath: modelPath // Send both for compatibility
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.currentModel = modelPath;
        console.log('[OK] Poseidon model loaded:', modelPath);
        alert('Model loaded successfully for Poseidon!');
      } else {
        console.error('[ERROR] Failed to load model:', data.error);
        alert('Failed to load model: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('[ERROR] Model load error:', error);
      alert('Error loading model: ' + error.message);
    }
  }

  /**
   * Populate model dropdown from Models panel
   */
  async populateModelDropdown() {
    const select = document.getElementById('poseidon-model-select');
    if (!select) return;
    
    try {
      // Fetch available models from server
      const response = await fetch('/api/models/list');
      const data = await response.json();
      
      // Clear current options
      select.innerHTML = '<option value="">-- No model loaded --</option>';
      
      // Add models
      if (data.success && data.models && data.models.length > 0) {
        data.models.forEach(model => {
          const option = document.createElement('option');
          option.value = model.path;
          option.textContent = model.name;
          
          // Mark if currently loaded
          if (model.path === this.currentModel) {
            option.selected = true;
          }
          
          select.appendChild(option);
        });
        
        console.log(`[POSEIDON] Populated dropdown with ${data.models.length} models`);
      }
    } catch (error) {
      console.error('[ERROR] Failed to populate model dropdown:', error);
    }
  }
}

// Export singleton
const poseidon = new Poseidon();

// Make available globally
if (typeof window !== 'undefined') {
  window.poseidon = poseidon;
}

console.log('[POSEIDON] Poseidon loaded');
