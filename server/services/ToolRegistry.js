const fs = require('fs').promises;
const path = require('path');
const log = require('../utils/logger').createLogger('ToolRegistry');
const axios = require('axios');
const cheerio = require('cheerio');
const { evaluate } = require('mathjs');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return;
    
    // Initialize filesystem tools
    const filesystemTools = require('./FilesystemTools');
    await filesystemTools.init();
    
    // Register all tools
    this.registerBuiltinTools();
    
    this.initialized = true;
  }

  /**
   * Register all built-in tools
   */
  registerBuiltinTools() {
    // ═══════════════════════════════════════════════════════════════════════
    // Canonical tool manifest — mirrors PoseidonOrchestrator's live tools.
    // This drives the AgentForm UI (Design tab → Tools section) so users can
    // see and toggle exactly what an agent may use. Handlers here are stubs:
    // Poseidon owns the runtime dispatch via defineChatSessionFunction; this
    // registry is the SOURCE OF TRUTH for what exists, its category, and
    // its human-readable description.
    // ═══════════════════════════════════════════════════════════════════════
    const stub = async () => ({ success: false, error: 'Dispatched by orchestrator' });
    const T = (name, category, description) => {
      this.registerTool({ name, category, description, execute: stub });
    };

    // ── META (Poseidon introspection & skill authoring) ──────────────────
    T('read_my_brain',       'meta', 'Read a section of your own brain (identity, current_state, boundaries, fine_tuning, skills, environment). Use it before big decisions.');
    T('update_brain_field',  'meta', 'Update a leaf field in your own brain by dot-path. Rare — reserved for self-refinement.');
    T('write_skill',         'meta', 'Author a new reusable skill (a named recipe of steps + expected output). Skills are shared platform-wide.');
    T('list_skills',         'meta', 'List available skills across the platform. Filter by category or query.');
    T('delete_skill',        'meta', 'Remove a broken skill by id.');
    T('record_skill_outcome','meta', 'After using a skill: record success | partial | fail with a short note. Feeds the skill ranking.');

    // ── AGENTS (temple population) ───────────────────────────────────────
    T('create_agent',       'agents', 'Spawn a new agent with a role, system prompt, and tool whitelist.');
    T('delete_agent',       'agents', 'Retire an agent permanently.');
    T('list_agents',        'agents', 'List all agents with id, name, role, status.');
    T('update_agent_field', 'agents', 'Update an agent field by dot-path (persona.description, brain_config.system_prompt, capabilities.tools_allowed, …).');
    T('dispatch_to_agent',  'agents', 'Hand a specific message to a named agent NOW, bypass the task queue. Use for direct 1:1 delegation.');

    // ── PROJECTS ─────────────────────────────────────────────────────────
    T('create_project',        'projects', 'Create a new project with name + mission (vision).');
    T('list_projects',         'projects', 'List projects with status, completion %, and agent count.');
    T('plan_project',          'projects', 'THE tool for project kickoffs and restarts: generates a validated task plan with acceptance criteria and agent assignments. Use ONCE per multi-task goal.');
    T('update_project',        'projects', 'Update a project: field=name | vision | status (active|archived|deleted) | assign_agent | unassign_agent | agent_model | review_model. One tool for the whole project lifecycle.');
    T('update_project_memory', 'projects', 'Write to a project living memory. section=achievement | decision | blocker | resolve_blocker | next_steps | agent_sync.');
    T('read_project_memory',   'projects', 'Read a project living memory (summary + recent achievements/decisions/blockers/next_steps).');
    T('audit_project',         'projects', 'Deep audit of a project: task health, blocker density, agent load, next steps consistency.');

    // ── TASKS ────────────────────────────────────────────────────────────
    T('create_task',   'tasks', 'Create a task (always bound to an agent — auto-assigned if omitted).');
    T('list_tasks',    'tasks', 'List tasks. Filter by status (todo|wip|done) and/or project.');
    T('update_task',   'tasks', 'Update a task field by name (title, description, status, priority, acceptance_criteria, assigned_to, …). Status is normalized to todo|wip|done.');
    T('delete_task',   'tasks', 'Delete a task permanently.');

    // ── FILES ────────────────────────────────────────────────────────────
    T('read_file',   'files', 'Read a text file from the workspace. Path relative to workspace root.');
    T('write_file',  'files', 'Overwrite a file (creates parent dirs). Use output/ for deliverables, work/ for intermediates.');
    T('list_files',  'files', 'List files in a workspace folder (with PATH ALIASES like PROJECTS/NEWSROOM/output).');
    T('edit_file',   'files', 'Search/replace inside an existing file. search_text must appear EXACTLY ONCE — include enough surrounding context.');

    // ── WEB & FETCH (consolidated: 6 → 2) ───────────────────────────────
    T('web_search', 'web', 'Search the web. mode="text" (default) returns page results; mode="image" returns direct image URLs embeddable as ![alt](url).');
    T('web_fetch',  'web', 'Read a URL. Default: page text (HTML stripped). extract="image" returns the best image URL. save_as="filename" persists the body to the output folder.');

    // ── GIT (consolidated: 4 → 1) ───────────────────────────────────────
    T('git', 'git', 'Git ops. action="status" | "diff" | "commit" | "push". commit takes {message, files?}, push takes {remote?, branch?}, diff takes {path?}.');

    // ── MULTIMEDIA / GENERATION ─────────────────────────────────────────
    T('generate_image', 'media', 'Generate an image from a prompt (SDXL or similar local model). Saves to output/.');
    T('edit_image',     'media', 'Edit an existing image with instructions (inpaint/img2img).');
    T('generate_pptx',  'media', 'Generate a PowerPoint deck from a structured outline.');
    T('generate_docx',  'media', 'Generate a Word document from a markdown or structured outline.');
    T('list_models',    'media', 'List models in the local library with id, family, size, capabilities.');

    // ── COMMS & EXTERNALS ───────────────────────────────────────────────
    T('send_email',       'comms', 'Send an email via configured SMTP. Requires to, subject, body.');
    T('list_mcp_servers', 'comms', 'List connected MCP servers and their tools.');
    T('call_mcp_tool',    'comms', 'Invoke a tool exposed by an MCP server: {server, tool, args}.');
    T('execute_bash',     'comms', 'Run a shell command in the workspace root (bounded timeout). Prefer specific tools where possible.');

    // ── LOGGING / USER CONTEXT ──────────────────────────────────────────
    T('get_logs',            'system', 'Read recent log entries (event_type, actor, limit).');
    T('update_user_context', 'system', 'Record a stable fact about the user (preference, role, working style). Sparingly.');

    log.info(`✅ Registered ${this.tools.size} canonical tools (mirrors PoseidonOrchestrator)`);
  }

  /**
   * Register a custom tool
   */
  /**
   * Mirror all in-memory tools into data/tools/tool_registry.json so the
   * V2 AgentForm "Tools Allowed" dropdown shows them.
   */
  async syncToRegistryFile(sharedRm) {
    if (!sharedRm) return;
    try {
      sharedRm.invalidateCache();
      const registry = await sharedRm.read('TOOLS/tool_registry.json').catch(() => ({
        schema_version: '2.0.0',
        schema_type: 'tool_registry',
        metadata: { last_id_used: 0, next_id: 1, id_format: 'tool_NNN', total_available: 0, last_updated_at: new Date().toISOString() },
        tools: {}
      }));
      
      registry.tools = registry.tools || {};
      let nextId = registry.metadata?.next_id || 1;
      let added = 0;
      
      for (const [name, tool] of this.tools.entries()) {
        // Check if already in registry by name
        const exists = Object.values(registry.tools).find(t => t.name === name);
        if (exists) continue;
        
        const toolId = `tool_local_${String(nextId).padStart(3, '0')}`;
        registry.tools[toolId] = {
          tool_id: toolId,
          name: name,
          type: 'local_function',
          category: tool.category || 'general',
          description: tool.description || '',
          parameters: tool.parameters || {},
          available: true,
          registered_at: new Date().toISOString()
        };
        nextId++;
        added++;
      }
      
      if (added > 0) {
        registry.metadata.next_id = nextId;
        registry.metadata.last_id_used = nextId - 1;
        registry.metadata.total_available = Object.keys(registry.tools).length;
        await sharedRm.write('TOOLS/tool_registry.json', registry);
        log.info(`Synced ${added} built-in tools to V2 registry (total: ${registry.metadata.total_available})`);
      }
    } catch (err) {
      log.warn('syncToRegistryFile failed:', err.message);
    }
  }

  registerTool(tool) {
    if (!tool.name || !tool.execute) {
      throw new Error('Tool must have name and execute function');
    }

    this.tools.set(tool.name, {
      name: tool.name,
      description: tool.description || '',
      parameters: tool.parameters || {},
      execute: tool.execute,
      category: tool.category || 'custom'
    });
  }

  /**
   * Execute a tool
   */
  async executeTool(toolName, parameters = {}) {
    const tool = this.tools.get(toolName);
    
    if (!tool) {
      return { 
        success: false, 
        error: `Tool '${toolName}' not found` 
      };
    }

    try {
      log.info(`🔧 Executing tool: ${toolName}`);
      const result = await tool.execute(parameters);
      return result;
    } catch (error) {
      log.error(`Tool execution error (${toolName}):`, error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * Get tool definition (for LLM)
   */
  getToolDefinition(toolName) {
    const tool = this.tools.get(toolName);
    if (!tool) return null;

    return {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    };
  }

  /**
   * Get all tool definitions
   */
  getAllToolDefinitions() {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      category: tool.category
    }));
  }

  /**
   * List available tools
   */
  listTools(category = null) {
    const tools = Array.from(this.tools.values());
    
    if (category) {
      return tools.filter(t => t.category === category);
    }
    
    return tools;
  }

  /**
   * Remove a tool
   */
  unregisterTool(toolName) {
    return this.tools.delete(toolName);
  }
}

// Singleton instance
const toolRegistry = new ToolRegistry();

module.exports = toolRegistry;
