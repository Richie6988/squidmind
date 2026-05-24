# 🦑 SquidMind

**Multi-Agent Aquarium Orchestration System**

Manage your AI agents through a playful pixel art aquarium interface. Each squid represents an autonomous agent powered by Claude, capable of executing scheduled tasks, using MCP tools, and coordinating with other squids.

![Pixel Art Ocean Theme](https://via.placeholder.com/800x200/0A2239/06FFA5?text=🦑+SquidMind+Aquarium)

---

## ✨ Features

- **🎨 Pixel Art Aquarium**: Beautiful retro-style interface where squids swim and work
- **🤖 AI Agents**: Each squid is powered by Claude (Sonnet/Opus/Haiku)
- **⏰ Cron Scheduling**: Automate tasks with flexible scheduling
- **🔧 MCP Integration**: Connect to GitHub, Slack, Gmail, and more
- **📊 Real-time Logs**: Track all agent executions
- **🎮 Interactive**: Click squids to execute, edit, or delete
- **💾 JSON Storage**: Simple file-based persistence (no database required)

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** v18+ (v20+ recommended)
- **Anthropic API Key** ([Get one here](https://console.anthropic.com))

### Installation

1. **Clone or download** the project:
```bash
cd squidmind
```

2. **Install dependencies**:
```bash
npm install
```

3. **Configure environment**:
```bash
# Copy template
cp .env.template .env

# Edit .env and add your API key
nano .env
```

4. **Add your Anthropic API key** to `.env`:
```env
ANTHROPIC_API_KEY=your_api_key_here
```

5. **Start the server**:
```bash
npm start
```

6. **Open your browser**:
```
http://localhost:3000
```

You should see the aquarium! 🌊

---

## 🎮 Usage Guide

### Creating Your First Squid

1. Click the **"+ New Squid"** button
2. Fill in the form:
   - **Name**: e.g., "Code Reviewer"
   - **System Prompt**: What the squid does
   - **Model**: Choose Claude version
   - **Schedule**: Optional cron expression (e.g., `0 9 * * *` for 9 AM daily)
3. Click **"🦑 Hatch Squid"**

Your new squid appears in the aquarium!

### Interacting with Squids

- **Click a squid** → Opens detail panel
- **Execute Now** → Runs the agent immediately
- **Edit** → Modify configuration (coming soon)
- **Delete** → Remove the squid

### Cron Scheduling

Examples:
```
0 9 * * *        → Every day at 9 AM
*/15 * * * *     → Every 15 minutes
0 0 * * 1        → Every Monday at midnight
0 */2 * * *      → Every 2 hours
```

[Full cron syntax guide](https://crontab.guru)

---

## 🦑 Example Agents

### 1. GitHub PR Reviewer
```
Name: Code Reviewer
Prompt: "Review new pull requests for bugs, security issues, and style violations. Comment with findings."
Schedule: 0 */2 * * * (every 2 hours)
Tools: GitHub MCP
```

### 2. Slack Standup Bot
```
Name: Standup Bot
Prompt: "Check GitHub issues assigned to the team. Post a daily standup summary to Slack."
Schedule: 0 9 * * 1-5 (weekdays at 9 AM)
Tools: GitHub MCP, Slack MCP
```

### 3. Data Sync Agent
```
Name: Data Syncer
Prompt: "Fetch latest sales data from API and update the local JSON file."
Schedule: 0 0 * * * (midnight daily)
Tools: Web fetch
```

---

## 🔧 MCP Integration

### Adding MCP Servers

1. **Get your MCP server URL** (e.g., GitHub, Slack)
2. **Add credentials** to `.env`:
```env
GITHUB_TOKEN=github_pat_...
GITHUB_MCP_URL=https://github-mcp.example.com/sse
```

3. **Pass MCP servers** when executing agents:
```javascript
// In AgentOrchestrator.executeAgent()
const mcpServers = [
  {
    type: "url",
    url: process.env.GITHUB_MCP_URL,
    name: "github"
  }
];
```

### Supported MCP Servers

- ✅ **GitHub**: PR reviews, issues, CI/CD
- ✅ **Slack**: Notifications, messages
- ✅ **Gmail**: Email monitoring
- ✅ **Google Drive**: File operations
- 🔜 **Custom**: Add any MCP-compliant server

---

## 📁 Project Structure

```
squidmind/
├── server/
│   ├── index.js                # Express server
│   ├── models/
│   │   ├── Agent.js            # Agent data model
│   │   └── Log.js              # Execution logs
│   └── services/
│       ├── AgentOrchestrator.js # Claude API client
│       └── Scheduler.js        # Cron manager
├── client/
│   ├── index.html              # Main page
│   ├── styles/pixel.css        # Retro UI styles
│   └── scripts/
│       ├── api.js              # Backend API client
│       ├── Squid.js            # Squid entity class
│       ├── aquarium.js         # Canvas renderer
│       └── ui.js               # UI controller
├── data/
│   ├── agents/                 # Agent JSON files
│   ├── logs/                   # Execution logs
│   └── tasks/                  # Scheduled tasks
└── package.json
```

---

## 🎨 Design Philosophy

**Pixel Art Aesthetic**: Inspired by Dofus, Tamagotchi, and Stardew Valley  
**Ocean Theme**: Deep blues, bioluminescent accents, cozy underwater vibes  
**Font**: "Press Start 2P" for that authentic retro feel  
**Animations**: Smooth squid swimming, bubble particles, glow effects

---

## 🛠️ Development

### Running in Dev Mode
```bash
npm run dev
```

### API Endpoints

```
GET    /api/agents          → List all agents
POST   /api/agents          → Create agent
GET    /api/agents/:id      → Get agent
PUT    /api/agents/:id      → Update agent
DELETE /api/agents/:id      → Delete agent
POST   /api/agents/:id/execute → Execute agent
GET    /api/logs            → Query logs
GET    /api/tasks/status    → Scheduler status
GET    /api/system/health   → Health check
```

### Testing API
```bash
# Create an agent
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Squid",
    "prompt": { "system": "You are a helpful assistant" },
    "llm": { "model": "claude-sonnet-4-20250514" }
  }'

# Execute manually
curl -X POST http://localhost:3000/api/agents/squid_123/execute \
  -H "Content-Type: application/json" \
  -d '{ "input": "Hello squid!" }'
```

---

## 🚧 Roadmap

- [x] Phase 0: Project setup
- [x] Phase 1: Core backend (Agent, Log, Orchestrator, Scheduler)
- [x] Phase 2: Express server with API routes
- [x] Phase 3: Frontend (HTML, CSS, JavaScript)
- [x] Phase 4: Squid rendering & animation
- [x] Phase 5: Squid creator UI
- [ ] Phase 6: MCP client implementation
- [ ] Phase 7: Advanced scheduling (visual cron builder)
- [ ] Phase 8: Agent hierarchy & reporting
- [ ] Phase 9: Analytics dashboard
- [ ] Phase 10: Mobile companion app

---

## 🤝 Contributing

This is currently a personal project, but contributions are welcome!

Ideas for improvements:
- More squid animations (sleep, eating, communicating)
- Sound effects (bubbles, splashes)
- Agent templates library
- Drag-and-drop hierarchy editor
- Real-time collaboration (multiple users)

---

## 📝 License

MIT License - feel free to use and modify!

---

## 🙏 Credits

**Inspired by:**
- Visual: Dofus, Tamagotchi, Stardew Valley, Octodad
- Functionality: n8n, Zapier, Home Assistant
- Philosophy: Unix pipes + multi-agent systems + fun UI

**Built with:**
- Node.js + Express
- Claude API (Anthropic)
- HTML5 Canvas
- node-cron
- Love for pixel art 🎨

---

## 📞 Support

Questions? Issues? Ideas?

- **GitHub Issues**: [Create an issue](#)
- **Email**: your-email@example.com
- **Twitter**: @YourHandle

---

**Made with 🦑 by Richard**

*"Because managing AI agents should be as fun as raising digital pets"*
