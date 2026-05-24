const EventEmitter = require('events');
const Agent = require('../models/Agent');
const Group = require('../models/Group');

/**
 * Team Coordinator - Advanced multi-agent team management
 * 
 * Features:
 * - Team creation & management
 * - Role assignment (Leader, Worker, Specialist)
 * - Workflow orchestration
 * - Inter-agent communication
 * - Task delegation & distribution
 * - Team performance tracking
 * - Consensus & voting
 */
class TeamCoordinator extends EventEmitter {
  constructor() {
    super();
    
    this.activeTeams = new Map(); // teamId -> team state
    this.workflows = new Map();   // workflowId -> workflow
    
    // Built-in team roles
    this.roles = {
      leader: {
        name: 'Team Leader',
        permissions: ['assign_tasks', 'approve', 'coordinate'],
        description: 'Coordinates team, assigns tasks, makes final decisions'
      },
      specialist: {
        name: 'Specialist',
        permissions: ['execute_complex', 'review', 'advise'],
        description: 'Handles specialized tasks, provides expert advice'
      },
      worker: {
        name: 'Worker',
        permissions: ['execute', 'report'],
        description: 'Executes assigned tasks, reports results'
      },
      reviewer: {
        name: 'Reviewer',
        permissions: ['review', 'approve', 'reject'],
        description: 'Reviews work, provides feedback, quality control'
      },
      researcher: {
        name: 'Researcher',
        permissions: ['research', 'gather_info', 'synthesize'],
        description: 'Gathers information, conducts research'
      }
    };

    // Built-in workflows
    this.workflowTemplates = {
      code_review_pipeline: {
        name: 'Code Review Pipeline',
        steps: [
          { role: 'researcher', task: 'gather_requirements' },
          { role: 'worker', task: 'implement' },
          { role: 'reviewer', task: 'review_code' },
          { role: 'specialist', task: 'security_audit' },
          { role: 'leader', task: 'approve_deploy' }
        ]
      },
      data_analysis_workflow: {
        name: 'Data Analysis Workflow',
        steps: [
          { role: 'researcher', task: 'collect_data' },
          { role: 'worker', task: 'clean_data' },
          { role: 'specialist', task: 'deep_analysis' },
          { role: 'reviewer', task: 'validate_results' },
          { role: 'leader', task: 'present_insights' }
        ]
      },
      content_creation: {
        name: 'Content Creation Pipeline',
        steps: [
          { role: 'researcher', task: 'research_topic' },
          { role: 'worker', task: 'draft_content' },
          { role: 'specialist', task: 'enhance_quality' },
          { role: 'reviewer', task: 'edit_proofread' },
          { role: 'leader', task: 'publish' }
        ]
      }
    };
  }

  /**
   * Create operational team
   */
  async createTeam(options) {
    const {
      name,
      description,
      leader_id,
      members = [],
      workflow = null,
      auto_assign_roles = true
    } = options;

    const team = {
      id: `team_${Date.now()}`,
      name,
      description,
      leader_id,
      members: [],
      roles: {},
      workflow: workflow ? this.workflowTemplates[workflow] : null,
      status: 'idle',
      current_task: null,
      task_history: [],
      communication_log: [],
      performance: {
        tasks_completed: 0,
        success_rate: 0,
        avg_completion_time: 0
      },
      created_at: new Date()
    };

    // Add leader
    if (leader_id) {
      team.members.push(leader_id);
      team.roles[leader_id] = 'leader';
    }

    // Add members
    for (const memberId of members) {
      if (!team.members.includes(memberId)) {
        team.members.push(memberId);
        
        if (auto_assign_roles) {
          // Auto-assign role based on agent specialty
          const role = await this.determineRole(memberId, team);
          team.roles[memberId] = role;
        }
      }
    }

    this.activeTeams.set(team.id, team);
    this.emit('team_created', team);

    console.log(`👥 Team created: ${name} (${team.members.length} members)`);

    return team;
  }

  /**
   * Determine best role for agent based on skills
   */
  async determineRole(agentId, team) {
    const agent = await Agent.findById(agentId);
    if (!agent) return 'worker';

    // Check brain expertise
    if (agent.brain_id) {
      const Brain = require('../models/Brain');
      const brain = await Brain.findById(agent.brain_id);
      
      if (brain && brain.identity.expertise) {
        const expertise = brain.identity.expertise.join(' ').toLowerCase();
        
        if (expertise.includes('review') || expertise.includes('quality')) {
          return 'reviewer';
        }
        if (expertise.includes('research') || expertise.includes('analysis')) {
          return 'researcher';
        }
        if (expertise.includes('security') || expertise.includes('expert')) {
          return 'specialist';
        }
      }
    }

    // Check stats
    if (agent.stats.average_quality > 9) {
      return 'specialist';
    }
    if (agent.stats.total_executions > 100) {
      return 'reviewer';
    }

    return 'worker';
  }

  /**
   * Execute team task with workflow
   */
  async executeTeamTask(teamId, task) {
    const team = this.activeTeams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    console.log(`👥 Team "${team.name}" starting task: ${task.title || 'Untitled'}`);

    team.status = 'working';
    team.current_task = {
      ...task,
      started_at: new Date(),
      current_step: 0,
      results: []
    };

    this.emit('team_task_started', { team, task });

    try {
      if (team.workflow) {
        // Execute workflow
        await this.executeWorkflow(team, task);
      } else {
        // Delegate to all members in parallel
        await this.delegateToMembers(team, task);
      }

      team.status = 'idle';
      team.current_task.completed_at = new Date();
      team.task_history.push(team.current_task);
      team.performance.tasks_completed++;

      console.log(`✅ Team "${team.name}" completed task`);
      this.emit('team_task_completed', { team, task });

      return team.current_task;

    } catch (error) {
      team.status = 'error';
      team.current_task.error = error.message;
      
      console.error(`❌ Team "${team.name}" task failed:`, error);
      this.emit('team_task_failed', { team, task, error });
      
      throw error;
    }
  }

  /**
   * Execute predefined workflow
   */
  async executeWorkflow(team, task) {
    const workflow = team.workflow;
    
    for (let i = 0; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      team.current_task.current_step = i;

      console.log(`  Step ${i + 1}/${workflow.steps.length}: ${step.task} (${step.role})`);

      // Find agent with this role
      const agentId = Object.keys(team.roles).find(id => team.roles[id] === step.role);
      
      if (!agentId) {
        console.warn(`⚠️  No agent with role "${step.role}", skipping step`);
        continue;
      }

      // Execute step
      const result = await this.executeAgentStep(agentId, step, task, team);
      
      team.current_task.results.push({
        step: i,
        role: step.role,
        agent_id: agentId,
        task: step.task,
        result
      });

      // Log communication
      this.logCommunication(team, {
        from: agentId,
        to: 'team',
        type: 'step_completed',
        content: `Completed ${step.task}`,
        timestamp: new Date()
      });
    }
  }

  /**
   * Execute single workflow step
   */
  async executeAgentStep(agentId, step, task, team) {
    const UnifiedOrchestrator = require('./UnifiedOrchestrator');
    const orchestrator = new UnifiedOrchestrator();

    // Build context from previous steps
    const previousResults = team.current_task.results
      .map(r => `${r.role}: ${r.result.output}`)
      .join('\n\n');

    const stepInput = `
Task: ${task.input}

Your role: ${step.role}
Your responsibility: ${step.task}

${previousResults ? `Previous team work:\n${previousResults}` : ''}

Execute your part now.
    `.trim();

    const result = await orchestrator.executeAgent(agentId, stepInput, {
      force_single: true // Don't chunk workflow steps
    });

    return result;
  }

  /**
   * Delegate to all members in parallel
   */
  async delegateToMembers(team, task) {
    const UnifiedOrchestrator = require('./UnifiedOrchestrator');
    const orchestrator = new UnifiedOrchestrator();

    const results = await Promise.all(
      team.members.map(async (agentId) => {
        const role = team.roles[agentId] || 'worker';
        const agent = await Agent.findById(agentId);
        
        return {
          agent_id: agentId,
          agent_name: agent.name,
          role,
          result: await orchestrator.executeAgent(agentId, task.input)
        };
      })
    );

    team.current_task.results = results;
  }

  /**
   * Agent consensus - team votes on decision
   */
  async teamConsensus(teamId, question, options) {
    const team = this.activeTeams.get(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    console.log(`🗳️  Team consensus: ${question}`);

    const UnifiedOrchestrator = require('./UnifiedOrchestrator');
    const orchestrator = new UnifiedOrchestrator();

    const votes = {};
    const explanations = {};

    // Each agent votes
    for (const agentId of team.members) {
      const votePrompt = `
Question: ${question}

Options:
${options.map((opt, i) => `${i + 1}. ${opt}`).join('\n')}

Vote for the best option and explain why. 
Format: "Vote: [number]. Reason: [explanation]"
      `.trim();

      const result = await orchestrator.executeAgent(agentId, votePrompt, {
        force_single: true
      });

      // Parse vote
      const voteMatch = result.output.match(/Vote:\s*(\d+)/i);
      if (voteMatch) {
        const vote = parseInt(voteMatch[1]) - 1;
        votes[agentId] = vote;
        explanations[agentId] = result.output;
      }
    }

    // Count votes
    const voteCounts = {};
    Object.values(votes).forEach(vote => {
      voteCounts[vote] = (voteCounts[vote] || 0) + 1;
    });

    // Determine winner
    const winner = parseInt(Object.keys(voteCounts).reduce((a, b) => 
      voteCounts[a] > voteCounts[b] ? a : b
    ));

    const consensus = {
      question,
      options,
      votes,
      explanations,
      vote_counts: voteCounts,
      winner: options[winner],
      winner_index: winner,
      total_votes: team.members.length,
      timestamp: new Date()
    };

    this.logCommunication(team, {
      from: 'system',
      to: 'team',
      type: 'consensus',
      content: consensus,
      timestamp: new Date()
    });

    console.log(`✅ Consensus reached: "${options[winner]}" (${voteCounts[winner]}/${team.members.length} votes)`);

    return consensus;
  }

  /**
   * Log team communication
   */
  logCommunication(team, message) {
    team.communication_log.push(message);
    
    // Keep only last 100 messages
    if (team.communication_log.length > 100) {
      team.communication_log.shift();
    }

    this.emit('team_communication', { team, message });
  }

  /**
   * Get team status
   */
  getTeamStatus(teamId) {
    const team = this.activeTeams.get(teamId);
    if (!team) return null;

    return {
      id: team.id,
      name: team.name,
      status: team.status,
      members: team.members.length,
      roles: team.roles,
      current_task: team.current_task ? {
        title: team.current_task.title,
        current_step: team.current_task.current_step,
        total_steps: team.workflow?.steps.length || 0
      } : null,
      performance: team.performance
    };
  }

  /**
   * List all teams
   */
  listTeams() {
    return Array.from(this.activeTeams.values()).map(team => ({
      id: team.id,
      name: team.name,
      members: team.members.length,
      status: team.status,
      workflow: team.workflow?.name
    }));
  }
}

// Singleton instance
const teamCoordinator = new TeamCoordinator();

module.exports = teamCoordinator;
