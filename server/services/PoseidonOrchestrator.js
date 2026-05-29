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
      githubToken,
      modelService: modelService   // needed for image generation
    });
  }

  /** Called from server/index.js after pool is created */
  setAgentWorkerPool(pool) {
    this.agentWorkerPool = pool;
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

  /**
   * Build the system prompt SMALL by default.
   *
   * Strategy (the user's call: short context wins):
   *   - data/main/poseidon_brain.json is the SINGLE SOURCE OF TRUTH.
   *     Identity, rules, soul, processes, tools_catalog all live there.
   *     Code reads from brain.json - it never embeds prompt text inline.
   *   - The initial system prompt is intentionally TIGHT (~2k chars):
   *       ABSOLUTE_RULES (always - hard rules)
   *       FINE_TUNING_BRIEF (always - 1-2 lines of vibe + learned user context)
   *       TOOLS_POINTER (always - 1-line "you have N tools across M categories;
   *                       call read_my_brain('processes.X') for recipes")
   *       CURRENT_STATE (always - live agent/project/task snapshot)
   *   - PROCESSES are NOT included by default. The model fetches the specific
   *     one it needs via the read_my_brain(section_path) tool. This is the
   *     "smart thematic chunks" the user asked for.
   *
   * Empirically this drops the prompt from ~5500 chars to ~2000 chars,
   * which should fix the 'context shift strategy' errors with qwen3-5-9b
   * at ctx=15000.
   */
  async buildSystemPrompt() {
    this.rm.invalidateCache();
    const brain = await this.rm.getPoseidonBrain();
    
    const [agentReg, projectReg, taskReg] = await Promise.all([
      this.rm.read('agents/agent_registry.json').catch(() => ({ agents: {} })),
      this.rm.read('projects/project_registry.json').catch(() => ({ projects: {} })),
      this.rm.read('tasks/tasks_registry.json').catch(() => ({ tasks: {} }))
    ]);
    
    const sections = [
      this._sectionAbsoluteRules(brain),
      this._sectionFineTuningBrief(brain),
      this._sectionToolsPointer(brain),
      this._sectionCurrentState(brain, agentReg, projectReg, taskReg)
    ];
    return sections.join('\n\n' + '─'.repeat(60) + '\n\n');
  }
  
  /**
   * Section 1: ABSOLUTE_RULES - read directly from brain.absolute_rules.
   * brain.json is the source of truth, not this file.
   */
  _sectionAbsoluteRules(brain) {
    const rules = brain.absolute_rules || [
      "You ARE Poseidon. Use your tools - never describe a command you could call.",
      "Never invent facts about the user.",
      "Confirm before destructive operations.",
      "Match the user's language and tone."
    ];
    const lines = ['# ABSOLUTE_RULES (never broken)'];
    rules.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    return lines.join('\n');
  }
  
  /**
   * Section 2 (small): FINE_TUNING_BRIEF.
   * One-line vibe + whatever we've learned about the user.
   * Full soul/boundaries available on demand via read_my_brain('fine_tuning').
   */
  _sectionFineTuningBrief(brain) {
    const lines = ['# YOU'];
    lines.push(`Vibe: ${brain.fine_tuning?.vibe || brain.soul?.vibe || 'Direct, concise, action-oriented.'}`);
    
    const ctx = brain.user?.context || {};
    const prefs = brain.user?.preferences || {};
    const hasUserData = Object.keys(ctx).length > 0 || Object.keys(prefs).length > 0;
    
    if (!hasUserData) {
      lines.push(`User: unknown so far. Learn over time via update_user_context.`);
    } else {
      lines.push('What you know about the user:');
      for (const [k, v] of Object.entries(ctx)) {
        lines.push(`- ${k}: ${v}`);
      }
      for (const [k, v] of Object.entries(prefs)) {
        lines.push(`- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
    }
    lines.push('');
    lines.push(`(For your full core_truths + boundaries call read_my_brain('fine_tuning').)`);
    return lines.join('\n');
  }
  
  /**
   * Section 3 (small): TOOLS_POINTER.
   * Just lists tool CATEGORIES from brain.tools_catalog. The model already
   * has full function signatures injected by node-llama-cpp's function-calling
   * protocol - we don't need to repeat them in the prompt.
   * For the process recipes the model calls read_my_brain('processes.X').
   */
  _sectionToolsPointer(brain) {
    const catalog = brain.tools_catalog || {};
    const lines = ['# TOOLS'];
    
    let totalTools = 0;
    const catSummary = [];
    for (const [cat, tools] of Object.entries(catalog)) {
      const count = Array.isArray(tools) ? tools.length : 0;
      totalTools += count;
      catSummary.push(`${cat.replace(/_/g, ' ')} (${count})`);
    }
    
    if (totalTools === 0) {
      lines.push('Tool catalog empty in brain.json. Function signatures still injected by runtime.');
    } else {
      lines.push(`You have ${totalTools} callable functions across ${Object.keys(catalog).length} categories:`);
      lines.push(catSummary.map(s => `- ${s}`).join('\n'));
      lines.push('');
      lines.push(`Full schemas are injected automatically. For step-by-step recipes, call:`);
      lines.push(`  read_my_brain('processes.create_agent')`);
      lines.push(`  read_my_brain('processes.research_flow')`);
      lines.push(`  read_my_brain('processes.code_edit_flow')`);
      lines.push(`  read_my_brain('processes.git_workflow')`);
      lines.push(`  read_my_brain('processes.archive_project')`);
      lines.push(`Or read_my_brain('tools_catalog') to see all tools by category.`);
      lines.push('');
      lines.push('KEY TOOL: dispatch_to_agent(agent_id, task_message, task_id?)');
      lines.push('  → Runs an agent autonomously in parallel. Use list_agents to pick the right one.');
      lines.push('  → The agent uses its own model session, personality, skills, and tools_allowed.');
      lines.push('  → Returns immediately; task runs in background and is logged.');
    }
    return lines.join('\n');
  }
  
  // OLD section methods preserved below for backward compat if something still
  // references them, but buildSystemPrompt() no longer uses them.
  
  _sectionFineTuning(brain) {
    const lines = [
      '# FINE_TUNING (your identity + learned style)',
      '',
      `System ID: ${brain.identity?.system_id || 'poseidon_main'}`,
      `Awakening #${(brain.identity?.total_awakening_count || 0) + 1}`,
      '',
      '## Core truths (your unchanging soul)'
    ];
    (brain.soul?.core_truths || ['Be genuinely helpful, not performatively helpful.']).forEach(t => lines.push(`- ${t}`));
    lines.push('');
    lines.push('## Boundaries');
    (brain.soul?.boundaries || ['Private things stay private.']).forEach(b => lines.push(`- ${b}`));
    lines.push('');
    lines.push(`Vibe: ${brain.soul?.vibe || 'direct, concise, action-oriented'}`);
    lines.push('');
    lines.push('## What you have learned about your user');
    
    const ctx = brain.user?.context || {};
    const prefs = brain.user?.preferences || {};
    const patterns = brain.user?.learned_patterns || [];
    
    if (Object.keys(ctx).length === 0 && Object.keys(prefs).length === 0 && patterns.length === 0) {
      lines.push('(You don\'t know your user yet. Learn over time. When they reveal a stable preference, call update_user_context to record it.)');
    } else {
      if (Object.keys(ctx).length > 0) {
        lines.push('');
        lines.push('Context:');
        for (const [k, v] of Object.entries(ctx)) lines.push(`- ${k}: ${v}`);
      }
      if (Object.keys(prefs).length > 0) {
        lines.push('');
        lines.push('Preferences:');
        for (const [k, v] of Object.entries(prefs)) lines.push(`- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
      }
      if (patterns.length > 0) {
        lines.push('');
        lines.push('Observed patterns:');
        patterns.slice(0, 5).forEach(p => lines.push(`- ${p.pattern || p}`));
      }
    }
    return lines.join('\n');
  }
  
  /**
   * Section 3: PROCESSES - step-by-step recipes for common tasks.
   * The model needs concrete walkthroughs, not abstract advice.
   */
  _sectionProcesses() {
    return `# PROCESSES (step-by-step recipes)

## Creating an agent
1. Pick a display_name (short, descriptive).
2. Pick specialization from: frontend_specialist, backend_specialist,
   fullstack_dev, data_analyst, devops, qa_tester, designer, researcher,
   ml_engineer, security, documentation, general.
3. Call create_agent(...).
4. Call log_decision summarizing why this agent was created.
5. Report the new agent_id to the user.

## Archiving a project
1. Confirm with user: "Archive PROJECT_NAME? Hidden but recoverable."
2. On yes: call archive_project(project_name).
3. Call log_decision.
4. Suggest next steps (reassign agents that were on it, etc.).

## Research flow
1. web_search(focused_query) - get top 5 hits.
2. Pick 1-3 best URLs from titles + snippets.
3. web_fetch(url) on the most promising one for full content.
4. Synthesize a tight answer. Cite source URLs.
5. Don't pad with irrelevant quotes.

## Code editing
1. read_file to see current state.
2. Small change → edit_file with a unique search_text + replacement.
3. Brand new file → write_file.
4. Overwriting existing file fully → CONFIRM with user first.
5. github_diff to verify changes look right.
6. github_commit("clear message: what changed and why").

## Git workflow
1. github_status - see what's changed.
2. github_diff - inspect specifics.
3. github_commit("type: subject").
4. github_push when user is ready.

## Responding to requests (the deciding question)
First ask yourself: is this a QUESTION (answer in text) or a REQUEST (call tool)?
- Question: answer directly.
- Request: call the tool FIRST, then summarize what you did.
Never describe a bash command you could call instead.`;
  }
  
  /**
   * Section 4: TOOLS - the full catalog the model can call.
   */
  _sectionTools() {
    return `# TOOLS (real functions you can call right now)

## Agent management
- create_agent(display_name, specialization, role, primary_color)
- delete_agent(agent_id)
- list_agents()
- update_agent_field(agent_id, field_path, new_value, reason)

## Project management
- create_project(name, vision)
- archive_project(project_name)
- list_projects()

## Task management
- create_task(title, description, project, assigned_agent_id?, priority?)
- list_tasks(status?, project?)

## Web / research
- web_search(query, num_results?)  Top results: title, url, snippet
- web_fetch(url)  Download and return text content of a URL

## Code editor (workspace-scoped)
- read_file(path)
- write_file(path, content)  For new files (confirm before overwriting)
- edit_file(path, search_text, replace_text)  search_text MUST appear exactly once
- list_files(path)

## Git
- github_status()  Branch, modified files, ahead/behind
- github_diff(path?)  Working tree + staged
- github_commit(message, files?)  Stages all (or specific) + commits
- github_push(remote?, branch?)
- github_pull(remote?, branch?)

## System / memory
- get_system_state()  Live CPU, RAM, agent counts
- log_decision(summary, reasoning, affected_entities?)
- update_user_context(key, value)  Record a stable fact about the user`;
  }
  
  /**
   * Section 5: CURRENT_STATE - live snapshot of the system.
   */
  _sectionCurrentState(brain, agentReg, projectReg, taskReg) {
    const agentList = Object.values(agentReg.agents || {});
    const projectList = Object.values(projectReg.projects || {}).filter(p => p.status !== 'archived');
    const taskList = Object.values(taskReg.tasks || {});
    const openTasks = taskList.filter(t => t.status !== 'completed' && t.status !== 'archived');
    
    const lines = [
      '# CURRENT_STATE (live snapshot, refreshed each session start)',
      '',
      '## System load',
      `- Active agents: ${brain.current_state?.active_agents_count ?? 0}`,
      `- Sleeping agents: ${brain.current_state?.sleeping_agents_count ?? 0}`,
      `- Tasks in progress: ${brain.current_state?.tasks_in_progress ?? 0}`,
      `- Tasks queued: ${brain.current_state?.tasks_queued ?? 0}`,
      `- CPU: ${Math.round(brain.current_state?.system_load?.cpu_percent ?? 0)}%`,
      `- RAM: ${Math.round(brain.current_state?.system_load?.ram_percent ?? 0)}%`
    ];
    if (brain.current_state?.is_overloaded) {
      lines.push('- ⚠ SYSTEM OVERLOADED - be cautious spawning more work');
    }
    
    lines.push('');
    lines.push(`## Agents (${agentList.length})`);
    if (agentList.length === 0) {
      lines.push('(none yet - the user can create some via "+ New Squid", or you can with create_agent)');
    } else {
      agentList.slice(0, 30).forEach(a => {
        lines.push(`- ${a.agent_id}: ${a.display_name} | ${a.specialization || 'general'} | ${a.status} | ${a.performance_summary?.tasks_completed || 0} tasks done`);
      });
    }
    
    lines.push('');
    lines.push(`## Projects (${projectList.length} active)`);
    if (projectList.length === 0) {
      lines.push('(none yet)');
    } else {
      projectList.forEach(p => {
        const agents = (p.assigned_agents || []).length;
        lines.push(`- ${p.project_id}: ${p.name} | ${p.metrics?.completion_percent || 0}% done | ${agents} agent${agents === 1 ? '' : 's'} assigned`);
      });
    }
    
    lines.push('');
    lines.push(`## Open tasks (${openTasks.length})`);
    if (openTasks.length === 0) {
      lines.push('(none open)');
    } else {
      openTasks.slice(0, 15).forEach(t => {
        lines.push(`- ${t.task_id}: ${t.title} | ${t.status} | ${t.project_name || 'no project'}${t.assigned_to ? ' | →' + t.assigned_to : ''}`);
      });
    }
    
    lines.push('');
    lines.push('## Session info');
    lines.push(`- Context wipes every ${this.modelService?.contextWipeThreshold ?? 5} exchanges; your brain.json survives the wipe.`);
    lines.push(`- After multi-step work, call log_decision so next-life-you knows what happened.`);
    
    return lines.join('\n');
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
      }),
      
      read_my_brain: defineChatSessionFunction({
        description: 'Fetch a specific section of your own brain.json. Use this for process recipes (e.g. "processes.create_agent"), tool details ("tools_catalog"), or your full soul ("fine_tuning"). Returns just that section so you do not blow context.',
        params: {
          type: 'object',
          properties: {
            section_path: {
              type: 'string',
              description: 'Dot-path inside brain.json. Examples: "processes.create_agent", "processes.research_flow", "fine_tuning", "absolute_rules", "tools_catalog", "user", "current_state".'
            }
          },
          required: ['section_path']
        },
        handler: async (params) => self._readMyBrain(params)
      }),

      // ============ IMAGE GENERATION ============

      generate_image: defineChatSessionFunction({
        description: 'Generate an image from a text prompt using an image-type GGUF model (Stable Diffusion, FLUX, etc.). Saves the PNG to project outputs and returns a viewable URL. Only call this when the agent has an image model assigned.',
        params: {
          type: 'object',
          properties: {
            model_id:        { type: 'string',  description: 'ID of the image model to use (must be model_type: image)' },
            prompt:          { type: 'string',  description: 'Text description of the image to generate' },
            project_id:      { type: 'string',  description: 'Project ID where the image is saved, e.g. project_001' },
            filename:        { type: 'string',  description: 'Output filename like banner.png (optional)' },
            negative_prompt: { type: 'string',  description: 'Things to avoid in the image (optional)' },
            width:           { type: 'integer', description: 'Width in pixels (default 512)' },
            height:          { type: 'integer', description: 'Height in pixels (default 512)' },
            steps:           { type: 'integer', description: 'Inference steps (default 20)' },
            cfg_scale:       { type: 'number',  description: 'CFG guidance scale (default 7)' },
            seed:            { type: 'integer', description: 'Random seed (-1 = random)' }
          },
          required: ['model_id', 'prompt', 'project_id']
        },
        handler: async (params) => self.tools.generateImage(params)
      }),

      dispatch_to_agent: defineChatSessionFunction({
        description: 'Dispatch a task to a specific agent. The agent will execute it autonomously using its own model session, personality, skills, and tools. Returns immediately with a job_id; results stream in the background. Use list_agents to pick the right agent_id.',
        params: {
          type: 'object',
          properties: {
            agent_id:    { type: 'string', description: 'Agent ID (e.g. "agent_001")' },
            task_message:{ type: 'string', description: 'Clear task description for the agent. Be specific: include context, expected output format, and any constraints.' },
            task_id:     { type: 'string', description: 'Optional task_id from tasks_registry to link this run to a tracked task' }
          },
          required: ['agent_id', 'task_message']
        },
        handler: async ({ agent_id, task_message, task_id }) => {
          if (!self.agentWorkerPool) {
            return { ok: false, error: 'AgentWorkerPool not initialized. Server may still be starting.' };
          }
          try {
            // Mark task as in_progress if task_id provided
            if (task_id) {
              try {
                const reg = await self.rm.read('tasks/tasks_registry.json');
                if (reg.tasks?.[task_id]) {
                  reg.tasks[task_id].lifecycle = reg.tasks[task_id].lifecycle || {};
                  reg.tasks[task_id].lifecycle.status = 'in_progress';
                  reg.tasks[task_id].lifecycle.started_at = new Date().toISOString();
                  await self.rm.write('tasks/tasks_registry.json', reg);
                }
              } catch {}
            }

            // Fire-and-forget: run in background, log result
            const gen = await self.agentWorkerPool.dispatch(agent_id, task_message);
            let fullText = '';
            let toolCalls = 0;
            // Consume generator in background
            (async () => {
              try {
                for await (const ev of gen) {
                  if (ev.type === 'text') fullText += ev.chunk;
                  if (ev.type === 'tool_call') toolCalls++;
                  if (ev.type === 'error') {
                    await self.rm.log({ event_type: 'agent_error', actor: { type: 'agent', id: agent_id },
                      subject: { type: 'task', id: task_id || 'unknown' }, action: ev.error });
                  }
                }
                // Mark task done + save full result
                if (task_id) {
                  try {
                    const now = new Date().toISOString();
                    const reg = await self.rm.read('tasks/tasks_registry.json');
                    if (reg.tasks?.[task_id]) {
                      reg.tasks[task_id].lifecycle.status       = 'completed';
                      reg.tasks[task_id].lifecycle.completed_at = now;
                      reg.tasks[task_id].result_summary         = fullText.slice(0, 500);
                      reg.tasks[task_id].result_file            = `tasks/results/${task_id}.txt`;
                      await self.rm.write('tasks/tasks_registry.json', reg);
                    }
                    // Write full result to dedicated file
                    const fs = require('fs').promises;
                    const path = require('path');
                    const resultsDir = path.join(self.rm.dataRoot, 'tasks', 'results');
                    await fs.mkdir(resultsDir, { recursive: true });
                    const header = [
                      `Task: ${task_id}`,
                      `Title: ${reg.tasks?.[task_id]?.title || ''}`,
                      `Agent: ${agent_id}`,
                      `Completed: ${now}`,
                      `Tool calls: ${toolCalls}`,
                      '─'.repeat(60),
                      ''
                    ].join('\n');
                    await fs.writeFile(path.join(resultsDir, `${task_id}.txt`), header + fullText, 'utf8');
                  } catch (e) {
                    console.warn('[dispatch_to_agent] result save error:', e.message);
                  }
                }
                await self.rm.log({ event_type: 'task_completed', actor: { type: 'agent', id: agent_id },
                  subject: { type: 'task', id: task_id || 'adhoc' },
                  action: `Agent \${agent_id} completed task (\${toolCalls} tool calls)`,
                  context: { result_preview: fullText.slice(0, 200) }
                });
              } catch (bgErr) {
                console.error('[dispatch_to_agent] background error:', bgErr.message);
              }
            })();

            return {
              ok: true,
              agent_id,
              task_id: task_id || null,
              message: `Agent \${agent_id} is now running the task. Results will be logged. Monitor via /api/v2/agents/\${agent_id}/worker-status`,
              stream_url: `/api/v2/agents/\${agent_id}/run`
            };
          } catch (err) {
            return { ok: false, error: err.message };
          }
        }
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
      // Resolve agent name for display
      let agentName = null;
      if (assigned_agent_id) {
        try {
          const agentReg = await this.rm.read('agents/agent_registry.json');
          agentName = agentReg.agents?.[assigned_agent_id]?.display_name || assigned_agent_id;
        } catch {}
      }

      reg.tasks[taskId] = {
        task_id: taskId,
        title,
        description: description || '',
        project_name: project || null,
        priority: priority || 'medium',
        created_at: new Date().toISOString(),
        created_by: 'poseidon_main',
        lifecycle: {
          status: assigned_agent_id ? 'planned' : 'open'
        },
        assignment: {
          assigned_to: assigned_agent_id || null,
          assigned_name: agentName
        }
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
      
      return { ok: true, task_id: taskId, title, message: `Created task ${taskId}: "${title}"${assigned_agent_id ? ` assigned to ${agentName || assigned_agent_id}` : ''}.` };
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

  /**
   * Look up a section inside brain.json by dot-path. The model uses this
   * for lazy-loading: instead of putting everything in the system prompt,
   * we just expose pointers and the model fetches the chunk it needs.
   *
   * Examples:
   *   "processes.create_agent"  -> { summary, when_to_use, steps, tools_used }
   *   "fine_tuning"             -> { core_truths, boundaries, vibe, continuity }
   *   "tools_catalog"           -> { agent_management: [...], ... }
   *   "user"                    -> { name, role, preferences, context, ... }
   */
  async _readMyBrain({ section_path }) {
    try {
      if (!section_path || typeof section_path !== 'string') {
        return { ok: false, error: 'section_path required (e.g. "processes.create_agent")' };
      }
      this.rm.invalidateCache();
      const brain = await this.rm.getPoseidonBrain();
      
      // Walk dot-path
      const parts = section_path.split('.').filter(Boolean);
      let node = brain;
      const traversed = [];
      for (const p of parts) {
        if (node && typeof node === 'object' && p in node) {
          node = node[p];
          traversed.push(p);
        } else {
          // Help the model recover - list available keys at the depth it failed
          const available = (node && typeof node === 'object') ? Object.keys(node) : [];
          return {
            ok: false,
            error: `Path "${section_path}" not found. Stopped at "${traversed.join('.') || '(root)'}". Available keys here: ${available.join(', ') || '(none)'}`
          };
        }
      }
      
      // Return the section. Truncate if huge to protect context.
      const serialized = JSON.stringify(node, null, 2);
      const MAX = 4000;
      const truncated = serialized.length > MAX;
      return {
        ok: true,
        section_path,
        char_count: serialized.length,
        truncated,
        content: truncated ? serialized.slice(0, MAX) + '\n... (truncated)' : serialized
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
