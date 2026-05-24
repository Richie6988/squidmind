# 🔌 SquidMind MCP Server

## What is MCP?

**Model Context Protocol (MCP)** allows AI assistants like Claude Desktop to interact with external tools and data sources. SquidMind's MCP server exposes all its functionality to MCP-compatible clients.

---

## ✨ Features Exposed via MCP

### 🦑 Agent Management
- List all agents
- Create new agents
- Execute agents with input
- Get agent status and logs

### 🧠 Brain Access
- List available brain templates
- Get brain details
- Create agents from brains

### 👥 Group Management
- List agent groups
- Create team groups
- Manage group members

### 🔧 Tool Execution
- List all SquidMind tools
- Execute tools directly
- Access filesystem, web, calculator tools

---

## 🚀 Setup for Claude Desktop

### Step 1: Install SquidMind

```bash
cd squidmind
npm install
```

### Step 2: Configure Claude Desktop

**On macOS:**
```bash
nano ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**On Windows:**
```powershell
notepad %APPDATA%\Claude\claude_desktop_config.json
```

**On Linux:**
```bash
nano ~/.config/Claude/claude_desktop_config.json
```

### Step 3: Add SquidMind MCP Server

Add this configuration:

```json
{
  "mcpServers": {
    "squidmind": {
      "command": "node",
      "args": [
        "/absolute/path/to/squidmind/server/mcp-server.js"
      ],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

**⚠️ Important:** Replace `/absolute/path/to/squidmind` with your actual path!

**Example (macOS/Linux):**
```json
{
  "mcpServers": {
    "squidmind": {
      "command": "node",
      "args": [
        "/Users/richard/squidmind/server/mcp-server.js"
      ]
    }
  }
}
```

**Example (Windows):**
```json
{
  "mcpServers": {
    "squidmind": {
      "command": "node",
      "args": [
        "C:\\Users\\Richard\\squidmind\\server\\mcp-server.js"
      ]
    }
  }
}
```

### Step 4: Restart Claude Desktop

1. Quit Claude Desktop completely
2. Relaunch Claude Desktop
3. Look for the 🔌 icon in the bottom-right
4. Click it to see "squidmind" server

---

## 🎮 Using SquidMind in Claude Desktop

Once configured, you can interact with SquidMind directly in Claude:

### Example Conversations

**List your agents:**
```
You: Show me all my SquidMind agents
Claude: [Uses list_agents tool]
```

**Create an agent:**
```
You: Create a code reviewer agent using the brain_code_reviewer brain
Claude: [Uses create_agent tool]
```

**Execute an agent:**
```
You: Execute agent squid_123 with input "Review this code: function add(a,b){return a+b}"
Claude: [Uses execute_agent tool]
```

**Use SquidMind tools:**
```
You: Use SquidMind to search the web for "latest AI news"
Claude: [Uses execute_squidmind_tool with web_search]
```

**Check agent status:**
```
You: What's the status of my agents?
Claude: [Uses get_agent_status for each agent]
```

---

## 🔧 Available MCP Tools

### Agent Tools
- `list_agents` - List all SquidMind agents
- `create_agent` - Create a new agent
- `execute_agent` - Run an agent with input
- `get_agent_status` - Get current agent status
- `get_agent_logs` - View execution logs

### Brain Tools
- `list_brains` - List available brain templates
- `get_brain` - Get brain details

### Group Tools
- `list_groups` - List agent groups
- `create_group` - Create a team group

### Tool Tools
- `list_squidmind_tools` - List filesystem, web, calculator tools
- `execute_squidmind_tool` - Execute any SquidMind tool

---

## 📊 MCP Resources

SquidMind exposes resources you can read:

### Agent Resources
```
squidmind://agents/{agent_id}
```

Returns full agent configuration including:
- Name, type, status
- Brain reference
- Memory (KANBAN, etc.)
- Execution history

### Brain Resources
```
squidmind://brains/{brain_id}
```

Returns brain template including:
- Identity (role, expertise)
- System prompts
- Tool configuration
- Model settings

---

## 🎯 Use Cases

### 1. Code Review Workflow

```
You: Create a code review agent
Claude: [Creates agent with brain_code_reviewer]

You: Use it to review server/index.js
Claude: [Executes agent, reads file, provides review]

You: Show me the logs
Claude: [Gets execution logs]
```

### 2. Data Analysis

```
You: Create a data analyst agent
Claude: [Creates agent with brain_data_analyst]

You: Analyze the file data/sales.json
Claude: [Reads file using tool, analyzes with agent]
```

### 3. Multi-Agent Coordination

```
You: Create a group called "DevOps Team" with agents squid_1 and squid_2
Claude: [Creates group]

You: List all my groups
Claude: [Shows groups and members]
```

---

## 🐛 Troubleshooting

### MCP Server Not Showing Up

**Check the path:**
```bash
# macOS/Linux
which node
# Should output: /usr/local/bin/node or similar

# Then use full path in config:
{
  "command": "/usr/local/bin/node",
  "args": ["/full/path/to/squidmind/server/mcp-server.js"]
}
```

**Test the server manually:**
```bash
cd squidmind
node server/mcp-server.js
# Should output: SquidMind MCP Server running on stdio
# Press Ctrl+C to exit
```

### Permission Errors

```bash
# Make script executable
chmod +x server/mcp-server.js
```

### Node Not Found

```bash
# Install Node.js if missing
# macOS: brew install node
# Ubuntu: sudo apt install nodejs npm
# Windows: Download from nodejs.org
```

### Check Claude Desktop Logs

**macOS:**
```bash
tail -f ~/Library/Logs/Claude/mcp*.log
```

**Windows:**
```powershell
Get-Content $env:APPDATA\Claude\logs\mcp*.log -Tail 50 -Wait
```

---

## 🔐 Security Notes

- MCP server runs locally (no network access)
- Only accessible by Claude Desktop on your machine
- Has access to SquidMind data directory
- Can execute SquidMind tools (file read/write, web search)

**Recommendations:**
- Keep SquidMind in a dedicated directory
- Review tool permissions in Brain configs
- Use `disabled` tools list to restrict access

---

## 🎨 Example: Full Workflow

### Terminal (Start SquidMind web UI):
```bash
cd squidmind
npm start
# Runs on http://localhost:3000
```

### Claude Desktop (MCP-connected):
```
You: List my SquidMind agents
Claude: You have 2 agents:
1. Code Reviewer (squid_001) - idle
2. Data Analyst (squid_002) - idle

You: Create a new agent called "DevOps Monitor" using brain_code_reviewer
Claude: Created agent "DevOps Monitor" (squid_003)

You: Execute DevOps Monitor with input "Check server health"
Claude: Agent executed. Result: [output]

You: Show me the execution logs
Claude: [Shows logs with timing, input, output]
```

---

## 🆚 MCP vs Web UI vs API

**Use MCP when:**
- Working in Claude Desktop
- Want natural language control
- Need quick agent execution
- Combining with other MCP tools

**Use Web UI when:**
- Managing many agents visually
- Monitoring system dashboard
- Creating complex brain configs
- Watching squid animations 🦑

**Use API when:**
- Building integrations
- Automating workflows
- External tools calling SquidMind
- Programmatic access

---

## 📚 Resources

- **MCP Documentation:** https://modelcontextprotocol.io
- **Claude Desktop:** https://claude.ai/download
- **SquidMind Docs:** See README.md

---

**Status:** ✅ MCP Server Ready
**Compatibility:** Claude Desktop, Cline, Continue, any MCP client
**Protocol Version:** MCP 1.0

**Your agents are now accessible from Claude Desktop!** 🦑🔌✨
