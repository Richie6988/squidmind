require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const os = require('os');
const Agent = require('./models/Agent');
const Group = require('./models/Group');
const Log = require('./models/Log');
const AgentOrchestrator = require('./services/AgentOrchestrator');
const Scheduler = require('./services/Scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, '../client')));

// Initialize services
const orchestrator = new AgentOrchestrator();
const scheduler = new Scheduler();

// ==================== AGENT ROUTES ====================

// List all agents
app.get('/api/agents', async (req, res) => {
  try {
    const agents = await Agent.findAll();
    res.json({ success: true, agents });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get single agent
app.get('/api/agents/:id', async (req, res) => {
  try {
    const agent = await Agent.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create agent
app.post('/api/agents', async (req, res) => {
  try {
    const agent = new Agent(req.body);
    await agent.save();
    
    // Register with scheduler if cron is enabled
    if (agent.schedule.enabled && agent.schedule.cron) {
      await scheduler.registerAgent(agent);
    }
    
    res.json({ success: true, agent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update agent
app.put('/api/agents/:id', async (req, res) => {
  try {
    const existingAgent = await Agent.findById(req.params.id);
    if (!existingAgent) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    const updatedAgent = new Agent({ ...existingAgent, ...req.body, id: req.params.id });
    await updatedAgent.save();
    
    // Update scheduler
    scheduler.unregisterAgent(updatedAgent.id);
    if (updatedAgent.schedule.enabled && updatedAgent.schedule.cron) {
      await scheduler.registerAgent(updatedAgent);
    }
    
    res.json({ success: true, agent: updatedAgent });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete agent
app.delete('/api/agents/:id', async (req, res) => {
  try {
    scheduler.unregisterAgent(req.params.id);
    const deleted = await Agent.delete(req.params.id);
    
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Agent not found' });
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Execute agent manually
app.post('/api/agents/:id/execute', async (req, res) => {
  try {
    const { input, mcp_servers } = req.body;
    const result = await orchestrator.executeAgent(req.params.id, input, mcp_servers);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== LOG ROUTES ====================

app.get('/api/logs', async (req, res) => {
  try {
    const filters = {
      agent_id: req.query.agent_id,
      status: req.query.status,
      type: req.query.type,
      days: parseInt(req.query.days) || 7,
      limit: parseInt(req.query.limit) || 100
    };
    
    const logs = await Log.query(filters);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== GROUP ROUTES ====================

app.get('/api/groups', async (req, res) => {
  try {
    const groups = await Group.findAll();
    res.json({ success: true, groups });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/groups', async (req, res) => {
  try {
    const group = new Group(req.body);
    await group.save();
    res.json({ success: true, group });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/groups/:id/members', async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }
    
    const { agent_id, action } = req.body; // action: 'add' | 'remove'
    
    if (action === 'add') {
      group.addMember(agent_id);
    } else if (action === 'remove') {
      group.removeMember(agent_id);
    }
    
    await group.save();
    res.json({ success: true, group });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  try {
    const deleted = await Group.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Group not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== TASK ROUTES ====================

app.get('/api/tasks/status', (req, res) => {
  const status = scheduler.getStatus();
  res.json({ success: true, ...status });
});

app.get('/api/tasks/upcoming', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const tasks = scheduler.getUpcomingTasks(limit);
  res.json({ success: true, tasks });
});

// ==================== SYSTEM ROUTES ====================

app.get('/api/system/health', async (req, res) => {
  const apiConnected = await orchestrator.testConnection();
  res.json({
    success: true,
    status: 'healthy',
    api_connected: apiConnected,
    scheduler_status: scheduler.getStatus()
  });
});

app.get('/api/system/monitor', async (req, res) => {
  try {
    const agents = await Agent.findAll();
    const groups = await Group.findAll();
    
    // CPU & Memory
    const cpuUsage = os.loadavg()[0] / os.cpus().length * 100;
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memUsage = ((totalMem - freeMem) / totalMem) * 100;
    
    // Agent states
    const agentStates = {
      idle: agents.filter(a => a.status === 'idle').length,
      working: agents.filter(a => a.status === 'working').length,
      thinking: agents.filter(a => a.status === 'thinking').length,
      sleeping: agents.filter(a => a.status === 'sleeping').length,
      error: agents.filter(a => a.status === 'error').length
    };
    
    // Active tasks
    const activeTasks = agents.filter(a => 
      a.memory?.kanban?.in_progress?.length > 0
    ).map(a => ({
      agent_id: a.id,
      agent_name: a.name,
      tasks: a.memory.kanban.in_progress
    }));
    
    res.json({
      success: true,
      system: {
        cpu_usage: cpuUsage.toFixed(2),
        memory_usage: memUsage.toFixed(2),
        memory_total_gb: (totalMem / 1024 / 1024 / 1024).toFixed(2),
        memory_free_gb: (freeMem / 1024 / 1024 / 1024).toFixed(2),
        uptime_hours: (os.uptime() / 3600).toFixed(2)
      },
      agents: {
        total: agents.length,
        states: agentStates
      },
      groups: {
        total: groups.length,
        active: groups.filter(g => g.status === 'active').length
      },
      tasks: {
        active: activeTasks,
        total_in_progress: activeTasks.reduce((sum, a) => sum + a.tasks.length, 0)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ==================== SERVE FRONTEND ====================

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ==================== START SERVER ====================

async function start() {
  try {
    console.log('🦑 Starting SquidMind...');
    
    // Test API connection
    const apiConnected = await orchestrator.testConnection();
    if (!apiConnected) {
      console.warn('⚠️  Warning: Claude API connection failed. Check ANTHROPIC_API_KEY in .env');
    } else {
      console.log('✅ Claude API connected');
    }
    
    // Initialize scheduler
    await scheduler.initialize();
    
    // Start server
    app.listen(PORT, () => {
      console.log(`\n🌊 SquidMind is live at http://localhost:${PORT}`);
      console.log('📚 API Docs:');
      console.log('  GET    /api/agents          - List all agents');
      console.log('  POST   /api/agents          - Create agent');
      console.log('  GET    /api/agents/:id      - Get agent');
      console.log('  PUT    /api/agents/:id      - Update agent');
      console.log('  DELETE /api/agents/:id      - Delete agent');
      console.log('  POST   /api/agents/:id/execute - Execute agent');
      console.log('  GET    /api/logs            - Query logs');
      console.log('  GET    /api/tasks/status    - Scheduler status');
      console.log('  GET    /api/system/health   - Health check');
      console.log('\n🎮 Open http://localhost:3000 in your browser!\n');
    });
    
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

start();
