const cron = require('node-cron');
const Agent = require('../models/Agent');
const AgentOrchestrator = require('./AgentOrchestrator');

class Scheduler {
  constructor() {
    this.jobs = new Map(); // agentId -> cron job
    this.orchestrator = new AgentOrchestrator();
  }

  async initialize() {
    console.log('🔄 Initializing scheduler...');
    const agents = await Agent.findAll();
    
    for (const agent of agents) {
      if (agent.schedule.enabled && agent.schedule.cron) {
        await this.registerAgent(agent);
      }
    }
    
    console.log(`✅ Scheduler initialized with ${this.jobs.size} scheduled agents`);
  }

  async registerAgent(agent) {
    // Validate cron expression
    if (!cron.validate(agent.schedule.cron)) {
      console.error(`Invalid cron expression for agent ${agent.id}: ${agent.schedule.cron}`);
      return false;
    }

    // Unregister existing job if any
    this.unregisterAgent(agent.id);

    // Create new cron job
    const job = cron.schedule(
      agent.schedule.cron,
      async () => {
        console.log(`⏰ Executing scheduled task for ${agent.name} (${agent.id})`);
        
        try {
          const result = await this.orchestrator.executeAgent(agent.id);
          
          if (result.success) {
            console.log(`✅ ${agent.name} completed successfully`);
            
            // Send notification if configured
            await this.sendNotification(agent, 'completion', result.output);
          } else {
            console.error(`❌ ${agent.name} failed:`, result.error);
            
            // Send error notification
            await this.sendNotification(agent, 'error', result.error);
          }
        } catch (error) {
          console.error(`❌ Unexpected error executing ${agent.name}:`, error);
          await this.sendNotification(agent, 'error', error.message);
        }
      },
      {
        scheduled: true,
        timezone: agent.schedule.timezone || 'Europe/Paris'
      }
    );

    this.jobs.set(agent.id, job);
    console.log(`📅 Registered cron job for ${agent.name}: ${agent.schedule.cron}`);
    return true;
  }

  unregisterAgent(agentId) {
    const job = this.jobs.get(agentId);
    if (job) {
      job.stop();
      this.jobs.delete(agentId);
      console.log(`🛑 Unregistered cron job for agent ${agentId}`);
      return true;
    }
    return false;
  }

  async sendNotification(agent, eventType, message) {
    // Check if we should notify for this event type
    if (!agent.reporting.notify_on.includes(eventType)) {
      return;
    }

    console.log(`📢 Notification for ${agent.name} [${eventType}]: ${message}`);

    // TODO: Implement actual notification system
    // - If destination is 'main_squid': send to main squid's queue
    // - If destination is 'slack_channel_ops': post to Slack
    // - If destination is email: send email
    
    // For now, just log
    for (const destination of agent.reporting.destinations) {
      console.log(`  → ${destination}: ${message.substring(0, 100)}...`);
    }
  }

  getUpcomingTasks(limit = 10) {
    const tasks = [];
    
    for (const [agentId, job] of this.jobs.entries()) {
      // Note: node-cron doesn't provide next execution time directly
      // This is a placeholder - would need to calculate based on cron expression
      tasks.push({
        agent_id: agentId,
        // next_run: calculateNextRun(cronExpression)
      });
    }
    
    return tasks.slice(0, limit);
  }

  getStatus() {
    return {
      total_jobs: this.jobs.size,
      active_jobs: Array.from(this.jobs.keys())
    };
  }
}

module.exports = Scheduler;
