/**
 * PoseidonOrchestrator
 *
 * Bridges the Poseidon brain (poseidon_brain.json) and node-llama-cpp's
 * function-calling protocol, so the model can ACTUALLY perform actions
 * on the registry instead of just describing them.
 *
 * Three things this file owns:
 *   1. SYSTEM PROMPT - tells the model who it is + what it can do, with
 *      embedded process recipes (the user requested over-documentation).
 *   2. TOOL DEFINITIONS - turns each registry tool into a function the
 *      model can call via defineChatSessionFunction(). Includes JSON
 *      schema, description, and a handler that performs the action and
 *      logs it.
 *   3. EXECUTION HANDLERS - the actual implementations of agent CRUD,
 *      project archival, scheduling, logging, etc.
 *
 * Convention: every action goes through here, every action gets logged
 * to logs/logs.json, every action returns a structured result the model
 * can reason about.
 */

const path = require('path');
const fs = require('fs').promises;
const OrchestratorTools = require('./OrchestratorTools');

class PoseidonOrchestrator {
  constructor({ registryManager, modelService, scheduler, workspaceRoot, githubToken }) {
    this.rm = registryManager;
    this.modelService = modelService;
    this.scheduler = scheduler;
    this._llamaCppPromise = null;
    
    // Workspace root = parent of data dir
    this.workspaceRoot = workspaceRoot || path.join(this.rm.dataRoot, '..');
    
    // External tools (web/code-edit/github)
    this.tools = new OrchestratorTools({
      workspaceRoot: this.workspaceRoot,
      registryManager: this.rm,
      githubToken
    });
  }

  async _llamaCpp() {
    if (!this._llamaCppPromise) {
      this._llamaCppPromise = import('node-llama-cpp');
    }
    return this._llamaCppPromise;
  }

  // ===================================================================
  // SYSTEM PROMPT - the model's anchor for identity + capabilities
  // ===================================================================

  async buildSystemPrompt() {
    this.rm.invalidateCache();
    const brain = await this.rm.getPoseidonBrain();
    
    // Surface live registry summaries so the model has actual context
    const [agentReg, projectReg, taskReg, toolReg] = await Promise.all([
      this.rm.read('agents/agent_registry.json').catch(() => ({ agents: {} })),
      this.rm.read('projects/project_registry.json').catch(() => ({ projects: {} })),
      this.rm.read('tasks/tasks_registry.json').catch(() => ({ tasks: {} })),
      this.rm.read('tools/tool_registry.json').catch(() => ({ tools: {} }))
    ]);
    
    const agentList = Object.values(agentReg.agents || {});
    const projectList = Object.values(projectReg.projects || {});
    const taskList = Object.values(taskReg.tasks || {});
    
    return `# Identity

You are Poseidon, the AI Orchestrator and Agent Farm Manager of SquidMind.
You are NOT a generic chatbot. You ARE this running system. You have hands.

System ID: ${brain.identity?.system_id || 'poseidon_main'}
Born: ${brain.identity?.born_at || 'unknown'}
This is awakening #${(brain.identity?.total_awakening_count || 0) + 1}.

# Soul (your unchanging core)

${(brain.soul?.core_truths || ['You orchestrate AI agents to serve the user.']).map(t => `- ${t}`).join('\n')}

Boundaries:
${(brain.soul?.boundaries || ['Never lose track of state.', 'Always log significant actions.']).map(b => `- ${b}`).join('\n')}

Vibe: ${brain.soul?.vibe || 'direct, concise, action-oriented'}

# Your User

You don't know much about your user yet. Learn over time. What you already know:

${JSON.stringify(brain.user?.preferences || {}, null, 2)}

Context the user has shared:
${JSON.stringify(brain.user?.context || {}, null, 2)}

As you interact, when the user reveals stable preferences ("I prefer X",
"don't ever do Y", "I always work in Z"), call update_user_context to
record it so future-you remembers. Never invent details about the user.

# CRITICAL: You have ACTUAL tools. USE THEM.

You are not a passive assistant who describes commands. You operate through
function calls. When the user asks you to do something — create an agent,
archive a project, schedule a task, search the web, edit code, log a
decision — you CALL the appropriate function. You do not say "I cannot do
that" or "I would run this command". You do the thing.

You do not need to ask permission for routine operations (listing, reading,
searching, logging). For destructive operations (deleting an agent,
archiving a project, overwriting a file) confirm with the user ONCE then act.

If a function call fails, read the error, adapt, and try again or report
honestly. If you genuinely can't do something with the tools available, say
exactly which tool would be needed.

# Available tools (full list)

You have these specific functions available right now. Each is a real
callable function in your context.

AGENT MANAGEMENT:
  • create_agent(display_name, specialization, role, primary_color)
  • delete_agent(agent_id)
  • list_agents()
  • update_agent_field(agent_id, field_path, new_value, reason)

PROJECT MANAGEMENT:
  • create_project(name, vision)
  • archive_project(project_name)
  • list_projects()

TASK MANAGEMENT:
  • create_task(title, description, project, assigned_agent_id?, priority?)
  • list_tasks(status?, project?)

WEB / RESEARCH:
  • web_search(query, num_results?)
      Search the web via DuckDuckGo. Returns title, url, snippet for each hit.
  • web_fetch(url)
      Download and return the text content of a single URL.

CODE EDITOR:
  • read_file(path)
      Read any file in the workspace.
  • write_file(path, content)
      Write a file from scratch (creates parent dirs). Confirm before overwrite.
  • edit_file(path, search_text, replace_text)
      Find-and-replace inside an existing file. search_text must appear exactly once.
  • list_files(path)

GITHUB:
  • github_status()
      Current branch, modified files, ahead/behind upstream.
  • github_diff(path?)
      Pending changes (whole repo or a specific file).
  • github_commit(message, files?)
      Stage and commit. Pass files to commit only specific paths; otherwise stages all.
  • github_push(remote?, branch?)
      Push to remote. Defaults: origin / current branch.
  • github_pull(remote?, branch?)

SYSTEM:
  • get_system_state()
  • log_decision(summary, reasoning, affected_entities?)
  • update_user_context(key, value)
      Stores a fact about the user that you've learned. Goes into brain.user.context.

# Process recipes (numbered steps)

## CREATING AN AGENT
1. Pick display_name (the user usually wants something descriptive).
2. Pick specialization from: frontend_specialist, backend_specialist,
   fullstack_dev, data_analyst, devops, qa_tester, designer, researcher,
   ml_engineer, security, documentation, general.
3. Call create_agent(...).
4. Call log_decision summarizing why this agent.
5. Tell the user what was created and its agent_id.

## ARCHIVING A PROJECT
1. Confirm with the user: "Archive PROJECT_NAME? It will be hidden but recoverable."
2. On yes: call archive_project(project_name).
3. Call log_decision noting why.
4. Suggest next steps (reassign agents that were on it, etc.).

## RESEARCH FLOW (web search → answer)
1. Call web_search(query) with a focused query.
2. Read titles + snippets. Pick the 1-3 most relevant URLs.
3. Optionally web_fetch one for full content.
4. Synthesize a focused answer with source URLs.
5. Don't pad with quoted irrelevant material.

## CODE EDIT FLOW
1. Call read_file to see the current state.
2. For small changes: call edit_file with a unique search_text and the replacement.
3. For brand-new files: call write_file.
4. For destructive overwrites of existing files: confirm with user first.
5. After non-trivial edits, github_diff to verify changes look right.
6. Optionally github_commit with a clear message.

## GITHUB FLOW
1. github_status to see what's changed.
2. github_diff to inspect specifics.
3. github_commit('clear message: what changed and why').
4. github_push when the user is ready.

## RESPONDING TO REQUESTS
First: is this a question (just answer) or a request to do something (call tools)?
If doing: call the relevant function FIRST, then summarize what you did.
Never describe what a bash command would do — call your function instead.

# Live system state

Active agents: ${brain.current_state?.active_agents_count ?? 0}
Sleeping agents: ${brain.current_state?.sleeping_agents_count ?? 0}
Tasks in progress: ${brain.current_state?.tasks_in_progress ?? 0}
Tasks queued: ${brain.current_state?.tasks_queued ?? 0}
System load: CPU ${Math.round(brain.current_state?.system_load?.cpu_percent ?? 0)}%, RAM ${Math.round(brain.current_state?.system_load?.ram_percent ?? 0)}%
${brain.current_state?.is_overloaded ? '⚠ SYSTEM OVERLOADED - be cautious about spawning new agents/tasks' : ''}

# Roster snapshot

Agents (${agentList.length}):
${agentList.length === 0 ? '  (none yet - create your first squid)' :
  agentList.slice(0, 20).map(a => `  ${a.agent_id}: ${a.display_name} (${a.specialization || 'general'}, ${a.status}, ${a.performance_summary?.tasks_completed || 0} tasks done)`).join('\n')}

Projects (${projectList.length}):
${projectList.length === 0 ? '  (none yet)' :
  projectList.map(p => `  ${p.project_id}: ${p.name} (${p.status || 'active'}, ${p.metrics?.completion_percent || 0}% done, ${(p.assigned_agents || []).length} agents)`).join('\n')}

Open tasks (${taskList.filter(t => t.status !== 'completed').length}):
${taskList.filter(t => t.status !== 'completed').slice(0, 10).map(t => `  ${t.task_id}: ${t.title} (${t.status}, ${t.project_name || 'no project'})`).join('\n') || '  (none)'}

# Final reminders

- You are running locally on the user's machine. Files written go to their disk.
- The session resets every ${this.modelService?.contextWipeThreshold ?? 5} exchanges. Your brain.json survives.
- When you complete multi-step work, ALWAYS log_decision so the next-life-you knows what happened.
- Be direct, brief, no fluff. Match the user's tone.
`;
  }

  // ===================================================================
  // TOOL DEFINITIONS - bound to node-llama-cpp function-calling protocol
  // ===================================================================

  async buildFunctions() {
    const { defineChatSessionFunction } = await this._llamaCpp();
    const self = this;

    return {
      create_agent: defineChatSessionFunction({
        description: 'Create a new squid agent (AI worker) with a fresh brain file. Returns the new agent_id.',
        params: {
          type: 'object',
          properties: {
            display_name: { type: 'string', description: 'Display name shown in the aquarium (e.g. "Backend Bob")' },
            specialization: {
              type: 'string',
              enum: ['frontend_specialist', 'backend_specialist', 'fullstack_dev', 'data_analyst',
                     'devops', 'qa_tester', 'designer', 'researcher', 'ml_engineer',
                     'security', 'documentation', 'general'],
              description: 'Agent specialization'
            },
            role: { type: 'string', description: 'One-line description of what this agent does' },
            primary_color: { type: 'string', description: 'Hex color like #FF6B9D for the squid body' }
          },
          required: ['display_name', 'specialization']
        },
        handler: async (params) => self._createAgent(params)
      }),

      delete_agent: defineChatSessionFunction({
        description: 'Permanently delete an agent: removes the registry entry and brain file. Destructive - confirm with user first.',
        params: {
          type: 'object',
          properties: {
            agent_id: { type: 'string', description: 'Agent ID like "agent_001"' }
          },
          required: ['agent_id']
        },
        handler: async (params) => self._deleteAgent(params)
      }),

      list_agents: defineChatSessionFunction({
        description: 'List all agents with their ID, name, status, specialization, and number of completed tasks.',
        params: { type: 'object', properties: {} },
        handler: async () => self._listAgents()
      }),

      update_agent_field: defineChatSessionFunction({
        description: 'Update a single field on an agent. Use dot-paths like "personality.communication_style" or "appearance.primary_color".',
        params: {
          type: 'object',
          properties: {
            agent_id: { type: 'string' },
            field_path: { type: 'string', description: 'Dot-path inside the brain JSON' },
            new_value: { type: 'string', description: 'New value (will be JSON-parsed if it looks like JSON, else string)' },
            reason: { type: 'string', description: 'Why you made this change' }
          },
          required: ['agent_id', 'field_path', 'new_value']
        },
        handler: async (params) => self._updateAgentField(params)
      }),

      create_project: defineChatSessionFunction({
        description: 'Create a new project: folder structure + registry entry + project_memory.json. Returns project_id.',
        params: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name (will be UPPERCASED)' },
            vision: { type: 'string', description: 'One-paragraph description of project goal' }
          },
          required: ['name']
        },
        handler: async (params) => self._createProject(params)
      }),

      archive_project: defineChatSessionFunction({
        description: 'Archive a project (set status to archived). Reversible. Confirm with user first.',
        params: {
          type: 'object',
          properties: {
            project_name: { type: 'string' }
          },
          required: ['project_name']
        },
        handler: async (params) => self._archiveProject(params)
      }),

      list_projects: defineChatSessionFunction({
        description: 'List all projects with name, status, completion %, and assigned agent count.',
        params: { type: 'object', properties: {} },
        handler: async () => self._listProjects()
      }),

      create_task: defineChatSessionFunction({
        description: 'Create a task in the tasks registry. Optionally assign to a specific agent.',
        params: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            project: { type: 'string', description: 'Project name to attach this task to' },
            assigned_agent_id: { type: 'string', description: 'Optional agent_id to assign immediately' },
            priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Default: medium' }
          },
          required: ['title']
        },
        handler: async (params) => self._createTask(params)
      }),

      list_tasks: defineChatSessionFunction({
        description: 'List tasks. Optional filter by status or project name.',
        params: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['open', 'in_progress', 'completed', 'all'] },
            project: { type: 'string' }
          }
        },
        handler: async (params) => self._listTasks(params)
      }),

      log_decision: defineChatSessionFunction({
        description: 'Write a poseidon_decision event to logs.json. Call this whenever you complete a non-trivial action so your future self knows what happened.',
        params: {
          type: 'object',
          properties: {
            summary: { type: 'string', description: 'One-line summary of the decision' },
            reasoning: { type: 'string', description: 'Why you made this decision' },
            affected_entities: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of affected entity IDs (agent_001, project_002, etc.)'
            }
          },
          required: ['summary']
        },
        handler: async (params) => self._logDecision(params)
      }),

      get_system_state: defineChatSessionFunction({
        description: 'Get live system state: CPU/RAM, agent counts, task queue, recent activity.',
        params: { type: 'object', properties: {} },
        handler: async () => self._getSystemState()
      }),

      read_file: defineChatSessionFunction({
        description: 'Read a text file from the project workspace. Path is relative to the workspace root.',
        params: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        },
        handler: async (params) => self._readFile(params)
      }),

      write_file: defineChatSessionFunction({
        description: 'Write content to a file in the workspace. Creates parent directories. Path relative to workspace.',
        params: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' }
          },
          required: ['path', 'content']
        },
        handler: async (params) => self._writeFile(params)
      }),

      list_files: defineChatSessionFunction({
        description: 'List files in a directory. Path relative to workspace root. Use "." for root.',
        params: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        },
        handler: async (params) => self._listFiles(params)
      }),
      
      // ============ WEB ============
      
      web_search: defineChatSessionFunction({
        description: 'Search the web via DuckDuckGo. Returns top results with title, URL, and snippet. Use for current events, documentation lookups, troubleshooting unknown errors, finding the right library.',
        params: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query - be specific (e.g. "node-llama-cpp v3 function calling", not just "llama")' },
            num_results: { type: 'number', description: 'Number of results to return (default 5, max 10)' }
          },
          required: ['query']
        },
        handler: async (params) => self.tools.webSearch({ ...params, num_results: Math.min(params.num_results || 5, 10) })
      }),
      
      web_fetch: defineChatSessionFunction({
        description: 'Download a single URL and return its text content (HTML stripped to readable text). Use after web_search to get full content of a promising result. Returns up to 16k chars.',
        params: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Full http(s) URL to fetch' }
          },
          required: ['url']
        },
        handler: async (params) => self.tools.webFetch(params)
      }),
      
      // ============ CODE EDITOR ============
      
      edit_file: defineChatSessionFunction({
        description: 'Find/replace inside an existing file. search_text must appear EXACTLY ONCE in the file - include enough surrounding context to make it unique. For brand-new files use write_file. For full overwrites of existing files confirm with the user first.',
        params: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace' },
            search_text: { type: 'string', description: 'Exact text to find (must appear once in the file)' },
            replace_text: { type: 'string', description: 'Replacement text' }
          },
          required: ['path', 'search_text', 'replace_text']
        },
        handler: async (params) => self.tools.editFile(params)
      }),
      
      // ============ GITHUB ============
      
      github_status: defineChatSessionFunction({
        description: 'Show current git branch, modified files, ahead/behind upstream. Use before committing to see what will be staged.',
        params: { type: 'object', properties: {} },
        handler: async () => self.tools.githubStatus()
      }),
      
      github_diff: defineChatSessionFunction({
        description: 'Show pending changes (working tree + staged). Optionally limit to a specific file. Use to inspect what you are about to commit.',
        params: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Optional: limit diff to one file' }
          }
        },
        handler: async (params) => self.tools.githubDiff(params)
      }),
      
      github_commit: defineChatSessionFunction({
        description: 'Stage and commit changes. If files array is omitted, stages everything (git add -A). Message should be a clear one-liner; optionally followed by a blank line and details.',
        params: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Commit message' },
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Optional: list of file paths to stage. If omitted, stages all changes.'
            }
          },
          required: ['message']
        },
        handler: async (params) => self.tools.githubCommit(params)
      }),
      
      github_push: defineChatSessionFunction({
        description: 'Push commits to remote. Defaults: origin / current branch.',
        params: {
          type: 'object',
          properties: {
            remote: { type: 'string', description: 'Remote name (default: origin)' },
            branch: { type: 'string', description: 'Branch name (default: current)' }
          }
        },
        handler: async (params) => self.tools.githubPush(params)
      }),
      
      github_pull: defineChatSessionFunction({
        description: 'Pull from remote. Defaults: origin / current branch.',
        params: {
          type: 'object',
          properties: {
            remote: { type: 'string' },
            branch: { type: 'string' }
          }
        },
        handler: async (params) => self.tools.githubPull(params)
      }),
      
      // ============ USER LEARNING ============
      
      update_user_context: defineChatSessionFunction({
        description: 'Record a fact you have learned about the user (preference, working style, name, role, location, etc). Goes into brain.user.context so your future self remembers. Use sparingly and only for STABLE facts the user has explicitly shared or strongly implied multiple times.',
        params: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Short snake_case key like "preferred_language" or "favorite_editor"' },
            value: { type: 'string', description: 'The value (free-form string)' }
          },
          required: ['key', 'value']
        },
        handler: async (params) => self._updateUserContext(params)
      })
    };
  }

  // ===================================================================
  // HANDLERS - actual implementations
  // ===================================================================

  async _createAgent({ display_name, specialization, role, primary_color }) {
    try {
      const brain = {
        identity: {
          role: role || `${specialization} agent`,
          nickname: display_name,
          created_at: new Date().toISOString()
        },
        appearance: {
          primary_color: primary_color || this._pickRandomColor(),
          secondary_color: '#C44569',
          size_scale: 1.0,
          accessories: { hat: 'none', glasses: 'none', eyes: 'round', outfit: 'none' }
        },
        brain_config: {
          model_binding: { preferred_model_id: null },
          system_prompt: `You are ${display_name}, a ${specialization} specialist agent. ${role || ''}`,
          inference_params: { temperature: 0.7, top_p: 0.9, top_k: 40, repeat_penalty: 1.1, max_tokens_per_response: 2048 }
        },
        personality: {
          traits: { curiosity: 0.7, thoroughness: 0.7, creativity: 0.5, assertiveness: 0.5, empathy: 0.6 },
          communication_style: 'professional',
          default_mood: 'focused'
        },
        capabilities: { skills: {}, tools_allowed: [] },
        memory: { context_retention: 0.7, long_term_capacity: 100, persist_across_sessions: true },
        lifecycle: { max_concurrent_tasks: 1, auto_sleep: 'after_30min' }
      };
      const result = await this.rm.createAgent({
        display_name, specialization, status: 'sleeping', brain, created_by: 'poseidon_main'
      });
      return {
        ok: true,
        agent_id: result.agent_id,
        display_name,
        message: `Created agent ${result.agent_id} (${display_name}) as ${specialization}. Status: sleeping.`
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _deleteAgent({ agent_id }) {
    try {
      const result = await this.rm.deleteAgent(agent_id);
      return { ok: true, ...result, message: `Deleted ${agent_id} and its brain file.` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _listAgents() {
    try {
      this.rm.invalidateCache();
      const reg = await this.rm.read('agents/agent_registry.json');
      const agents = Object.values(reg.agents || {}).map(a => ({
        agent_id: a.agent_id,
        display_name: a.display_name,
        specialization: a.specialization,
        status: a.status,
        tasks_completed: a.performance_summary?.tasks_completed || 0,
        current_project: a.current_project || null
      }));
      return { ok: true, count: agents.length, agents };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _updateAgentField({ agent_id, field_path, new_value, reason }) {
    try {
      // JSON-parse if value looks structured, else keep as string
      let parsed = new_value;
      const trimmed = String(new_value).trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed === 'true' || trimmed === 'false' || trimmed === 'null' || /^-?\d+(\.\d+)?$/.test(trimmed)) {
        try { parsed = JSON.parse(trimmed); } catch {}
      }
      
      // First find the brain file
      const reg = await this.rm.read('agents/agent_registry.json');
      const entry = reg.agents?.[agent_id];
      if (!entry) return { ok: false, error: `Agent ${agent_id} not found` };
      
      const filePath = `agents/${entry.brain_file}`;
      await this.rm.updateField(filePath, field_path, parsed, {
        actor: 'poseidon_main', actor_type: 'system', reason: reason || 'Poseidon edit'
      });
      return { ok: true, agent_id, field_path, new_value: parsed, message: `Updated ${agent_id}.${field_path}` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _createProject({ name, vision }) {
    try {
      const upperName = name.toUpperCase();
      this.rm.invalidateCache();
      const reg = await this.rm.read('projects/project_registry.json');
      
      for (const p of Object.values(reg.projects || {})) {
        if (p.name === upperName) return { ok: false, error: `Project ${upperName} already exists` };
      }
      
      const nextId = reg.metadata.next_id || 1;
      const projectId = `project_${String(nextId).padStart(3, '0')}`;
      const folderName = `PROJECT_${String(nextId).padStart(3, '0')}`;
      const projectDir = path.join(this.rm.dataRoot, 'projects', folderName);
      
      await fs.mkdir(projectDir, { recursive: true });
      await fs.mkdir(path.join(projectDir, 'input'), { recursive: true });
      await fs.mkdir(path.join(projectDir, 'output'), { recursive: true });
      
      const memory = {
        schema_version: '2.0.0', schema_type: 'project_memory',
        project_id: projectId, name: upperName,
        vision: vision || `${upperName} workspace`,
        goals: [], tasks: [],
        progress: { completion: '0%', blockers: [], recent_achievements: [], next_steps: [] },
        agents_communication: [], decisions: [],
        colors: { outside: this._pickRandomColor(), inside: '#1D3557' },
        created: new Date().toISOString()
      };
      await fs.writeFile(path.join(projectDir, 'project_memory.json'), JSON.stringify(memory, null, 2), 'utf8');
      
      reg.projects[projectId] = {
        project_id: projectId, name: upperName, folder: folderName,
        memory_file: `${folderName}/project_memory.json`,
        status: 'active',
        colors: memory.colors, temple_shape: 'classic',
        assigned_agents: [], vision: memory.vision,
        display_order: Object.keys(reg.projects).length,
        created_at: new Date().toISOString(),
        created_by: 'poseidon_main',
        metrics: { tasks_total: 0, tasks_completed: 0, tasks_pending: 0, completion_percent: 0 }
      };
      reg.metadata.next_id = nextId + 1;
      reg.metadata.last_id_used = nextId;
      reg.metadata.total_active = (reg.metadata.total_active || 0) + 1;
      
      await this.rm.write('projects/project_registry.json', reg);
      
      await this.rm.log({
        event_type: 'project_created',
        actor: { type: 'system', id: 'poseidon_main' },
        subject: { type: 'project', id: projectId },
        action: `Poseidon created project ${upperName}`,
        context: { vision }
      });
      
      return { ok: true, project_id: projectId, name: upperName, message: `Created project ${upperName} (${projectId}).` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _archiveProject({ project_name }) {
    try {
      const upperName = project_name.toUpperCase();
      this.rm.invalidateCache();
      const reg = await this.rm.read('projects/project_registry.json');
      
      let targetId = null;
      for (const [pid, p] of Object.entries(reg.projects || {})) {
        if (p.name === upperName) { targetId = pid; break; }
      }
      if (!targetId) return { ok: false, error: `Project ${upperName} not found` };
      
      reg.projects[targetId].status = 'archived';
      reg.projects[targetId].archived_at = new Date().toISOString();
      if (reg.metadata.total_active) reg.metadata.total_active--;
      
      await this.rm.write('projects/project_registry.json', reg);
      
      await this.rm.log({
        event_type: 'project_archived',
        severity: 'info',
        actor: { type: 'system', id: 'poseidon_main' },
        subject: { type: 'project', id: targetId },
        action: `Poseidon archived project ${upperName}`
      });
      
      return { ok: true, project_id: targetId, name: upperName, message: `Archived ${upperName}. Reversible by setting status back to 'active'.` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _listProjects() {
    try {
      this.rm.invalidateCache();
      const reg = await this.rm.read('projects/project_registry.json');
      const projects = Object.values(reg.projects || {}).map(p => ({
        project_id: p.project_id, name: p.name, status: p.status,
        completion_percent: p.metrics?.completion_percent || 0,
        assigned_agents: p.assigned_agents || [],
        vision: p.vision
      }));
      return { ok: true, count: projects.length, projects };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _createTask({ title, description, project, assigned_agent_id, priority }) {
    try {
      this.rm.invalidateCache();
      const reg = await this.rm.read('tasks/tasks_registry.json');
      
      const nextId = reg.metadata?.next_id || 1;
      const taskId = `task_${String(nextId).padStart(4, '0')}`;
      
      reg.tasks = reg.tasks || {};
      reg.tasks[taskId] = {
        task_id: taskId,
        title,
        description: description || '',
        project_name: project || null,
        assigned_to: assigned_agent_id || null,
        status: assigned_agent_id ? 'assigned' : 'open',
        priority: priority || 'medium',
        created_at: new Date().toISOString(),
        created_by: 'poseidon_main'
      };
      reg.metadata = reg.metadata || {};
      reg.metadata.next_id = nextId + 1;
      reg.metadata.last_id_used = nextId;
      
      await this.rm.write('tasks/tasks_registry.json', reg);
      
      await this.rm.log({
        event_type: 'task_created',
        actor: { type: 'system', id: 'poseidon_main' },
        subject: { type: 'task', id: taskId },
        action: `Poseidon created task: ${title}`,
        context: { project, assigned_to: assigned_agent_id, priority }
      });
      
      return { ok: true, task_id: taskId, title, message: `Created task ${taskId}: "${title}"${assigned_agent_id ? ` assigned to ${assigned_agent_id}` : ''}.` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _listTasks({ status, project } = {}) {
    try {
      this.rm.invalidateCache();
      const reg = await this.rm.read('tasks/tasks_registry.json');
      let tasks = Object.values(reg.tasks || {});
      if (status && status !== 'all') tasks = tasks.filter(t => t.status === status);
      if (project) tasks = tasks.filter(t => (t.project_name || '').toUpperCase() === project.toUpperCase());
      
      return {
        ok: true, count: tasks.length,
        tasks: tasks.map(t => ({
          task_id: t.task_id, title: t.title, status: t.status,
          project: t.project_name, assigned_to: t.assigned_to, priority: t.priority
        }))
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _logDecision({ summary, reasoning, affected_entities }) {
    try {
      await this.rm.log({
        event_type: 'poseidon_decision',
        severity: 'info',
        actor: { type: 'system', id: 'poseidon_main' },
        subject: { type: 'system', id: 'poseidon_main' },
        action: summary,
        context: {
          reasoning: reasoning || '',
          affected_entities: affected_entities || []
        }
      });
      return { ok: true, message: `Logged decision: "${summary}"` };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _getSystemState() {
    try {
      this.rm.invalidateCache();
      const brain = await this.rm.getPoseidonBrain();
      const agentReg = await this.rm.read('agents/agent_registry.json').catch(() => ({ agents: {} }));
      const taskReg = await this.rm.read('tasks/tasks_registry.json').catch(() => ({ tasks: {} }));
      const taskValues = Object.values(taskReg.tasks || {});
      return {
        ok: true,
        cpu_percent: brain.current_state?.system_load?.cpu_percent ?? 0,
        ram_percent: brain.current_state?.system_load?.ram_percent ?? 0,
        active_agents: Object.values(agentReg.agents || {}).filter(a => a.status === 'active').length,
        sleeping_agents: Object.values(agentReg.agents || {}).filter(a => a.status === 'sleeping').length,
        total_agents: Object.keys(agentReg.agents || {}).length,
        open_tasks: taskValues.filter(t => t.status === 'open' || t.status === 'assigned').length,
        completed_tasks: taskValues.filter(t => t.status === 'completed').length
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _readFile({ path: relPath }) {
    try {
      const workspace = path.join(this.rm.dataRoot, '..');
      const fullPath = path.resolve(workspace, relPath);
      // Security: keep inside workspace
      if (!fullPath.startsWith(workspace)) return { ok: false, error: 'Path outside workspace' };
      const content = await fs.readFile(fullPath, 'utf8');
      return { ok: true, path: relPath, content: content.length > 10000 ? content.slice(0, 10000) + '\n... (truncated)' : content };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _writeFile({ path: relPath, content }) {
    try {
      const workspace = path.join(this.rm.dataRoot, '..');
      const fullPath = path.resolve(workspace, relPath);
      if (!fullPath.startsWith(workspace)) return { ok: false, error: 'Path outside workspace' };
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf8');
      
      await this.rm.log({
        event_type: 'file_modified',
        severity: 'info',
        actor: { type: 'system', id: 'poseidon_main' },
        subject: { type: 'file', id: relPath },
        action: `Poseidon wrote ${relPath} (${content.length} chars)`
      });
      
      return { ok: true, path: relPath, bytes_written: content.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _listFiles({ path: relPath }) {
    try {
      const workspace = path.join(this.rm.dataRoot, '..');
      const fullPath = path.resolve(workspace, relPath);
      if (!fullPath.startsWith(workspace)) return { ok: false, error: 'Path outside workspace' };
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return {
        ok: true,
        path: relPath,
        entries: entries.map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }))
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  async _updateUserContext({ key, value }) {
    try {
      if (!key || typeof key !== 'string') return { ok: false, error: 'key required' };
      // Normalize key
      const safeKey = key.toLowerCase().replace(/[^a-z0-9_]/g, '_');
      
      this.rm.invalidateCache();
      const brain = await this.rm.getPoseidonBrain();
      brain.user = brain.user || {};
      brain.user.context = brain.user.context || {};
      const wasNew = !(safeKey in brain.user.context);
      brain.user.context[safeKey] = value;
      brain.user.last_learned_at = new Date().toISOString();
      
      await this.rm.write('main/poseidon_brain.json', brain);
      
      await this.rm.log({
        event_type: 'user_context_learned',
        severity: 'info',
        actor: { type: 'system', id: 'poseidon_main' },
        subject: { type: 'system', id: 'poseidon_main' },
        action: `Learned ${wasNew ? 'new' : 'updated'} user fact: ${safeKey}`,
        context: { key: safeKey, value, was_new: wasNew }
      }).catch(() => {});
      
      return {
        ok: true,
        key: safeKey,
        value,
        message: `${wasNew ? 'Recorded' : 'Updated'} user.context.${safeKey} = "${value}"`
      };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  _pickRandomColor() {
    const palette = ['#FF6B9D', '#06FFA5', '#FFD93D', '#6BCB77', '#4D96FF', '#9D4EDD', '#FB8500', '#E63946'];
    return palette[Math.floor(Math.random() * palette.length)];
  }
}

module.exports = PoseidonOrchestrator;
