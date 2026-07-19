/**
 * RegistryManager - Centralized access to all neuronal architecture registries
 * 
 * Handles:
 * - Reading registries efficiently (caches in memory)
 * - Incremental ID generation
 * - Cascade updates across registries
 * - Audit logging
 * 
 * @see docs/WHY_THIS_ARCHITECTURE.md
 */

const fs = require('fs').promises;
const path = require('path');

const log = require('../utils/logger').createLogger('RegistryManager');
const AQUARIUM = require('../aquarium');

class RegistryManager {
  /**
   * Convert a display name to a filesystem-safe slug.
   * "News Runner" → "news_runner", "Projet Été" → "projet_ete"
   */
  static toSlug(name) {
    return (name || 'unknown')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40) || 'item';
  }

  constructor(dataRoot) {
    this.dataRoot = dataRoot || AQUARIUM.ROOT;
    this.cache = new Map();
    this.dirty = new Set();
    this.writeLocks = new Map(); // path -> Promise chain (serializes writes per file)
    this._idMutex   = new Map(); // path -> Promise chain (serializes ID generation per registry)
  }

  // ==================== CORE I/O ====================

  async read(relativePath) {
    const rp = AQUARIUM.resolve(relativePath);
    if (this.cache.has(rp)) {
      return JSON.parse(JSON.stringify(this.cache.get(rp)));
    }
    const fullPath = path.join(this.dataRoot, rp);
    
    // Wait for any pending write on this file to settle before reading
    if (this.writeLocks.has(rp)) {
      try { await this.writeLocks.get(rp); } catch {}
    }
    
    // Retry on transient errors (ENOENT during rename, empty file, parse fail)
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        if (!content || content.trim() === '') {
          lastErr = new Error(`Empty file: ${rp}`);
          await new Promise(r => setTimeout(r, 40 * (attempt + 1)));
          continue;
        }
        const data = JSON.parse(content);
        this.cache.set(rp, data);
        return data;
      } catch (err) {
        lastErr = err;
        if (attempt < 4) {
          await new Promise(r => setTimeout(r, 40 * (attempt + 1)));
        }
      }
    }
    throw new Error(`Failed to read ${rp} after 5 attempts: ${lastErr?.message}`);
  }

  async write(relativePath, data) {
    const rp = AQUARIUM.resolve(relativePath);
    // Chain writes to same file - never interleave them
    const previousWrite = this.writeLocks.get(rp) || Promise.resolve();
    const writeOp = previousWrite.catch(() => {}).then(async () => {
      const fullPath = path.join(this.dataRoot, rp);
      data.last_updated_at = new Date().toISOString();
      if (data.metadata) {
        data.metadata.last_updated_at = data.last_updated_at;
      }
      // Ensure parent directory exists
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      const tmpPath = fullPath + '.tmp.' + process.pid + '.' + Date.now() + '.' + Math.random().toString(36).slice(2, 8);
      const json = JSON.stringify(data, null, 2);
      await fs.writeFile(tmpPath, json, 'utf8');
      await fs.rename(tmpPath, fullPath);
      this.cache.set(rp, data);
      this.dirty.delete(rp);
    });
    
    this.writeLocks.set(rp, writeOp);
    try {
      await writeOp;
    } finally {
      if (this.writeLocks.get(rp) === writeOp) {
        this.writeLocks.delete(rp);
      }
    }
  }

  invalidateCache(relativePath) {
    if (relativePath) {
      this.cache.delete(AQUARIUM.resolve(relativePath));
    } else {
      this.cache.clear();
    }
  }

  // ==================== ID GENERATION ====================

  /**
   * Generate next incremental ID for a registry
   * @param {string} registryPath - e.g. 'AGENTS/agent_registry.json'
   * @returns {string} - e.g. 'agent_005'
   */
  async generateNextId(registryPath) {
    const rp = AQUARIUM.resolve(registryPath);

    // ── Per-registry mutex: each call waits for the previous to fully commit ──
    // This prevents the race condition where rapid sequential calls all read
    // the same counter value before any write has landed on disk.
    const prev = this._idMutex.get(rp) || Promise.resolve();
    let resolveMutex;
    const current = new Promise(r => { resolveMutex = r; });
    this._idMutex.set(rp, current);

    try {
      await prev; // wait for previous ID generation to fully commit to disk

      // Always bypass cache — read the freshest counter from disk
      this.invalidateCache();
      const registry = await this.read(registryPath);
      if (!registry.metadata) registry.metadata = {};

      const format = registry.metadata.id_format ?? this._defaultIdFormat(registryPath);

      // last_id_used is the authoritative floor — safe even when tasks are purged
      const entities  = registry.agents || registry.projects || registry.tasks || registry.models || {};
      let maxFromKeys = 0;
      for (const id of Object.keys(entities)) {
        const m = id.match(/(\d+)$/);
        if (m) maxFromKeys = Math.max(maxFromKeys, parseInt(m[1], 10));
      }
      // For task IDs, ALSO scan results_log.json — completed tasks were
      // purged from the live registry (see _writeTaskDetails) but their IDs
      // must not be re-used. Defense in depth against last_id_used drift.
      if (registryPath.includes('task')) {
        try {
          const AQUARIUM = require('../aquarium');
          const path = require('path');
          const fsSync = require('fs');
          const resultsPath = AQUARIUM.RESULTS_LOG;
          if (fsSync.existsSync(resultsPath)) {
            const rl = JSON.parse(fsSync.readFileSync(resultsPath, 'utf8'));
            for (const tid of Object.keys(rl.results || {})) {
              const m = tid.match(/(\d+)$/);
              if (m) maxFromKeys = Math.max(maxFromKeys, parseInt(m[1], 10));
            }
          }
        } catch { /* results_log optional */ }
      }
      const lastUsed = registry.metadata.last_id_used ?? 0;
      const nextNum  = Math.max(maxFromKeys, lastUsed) + 1;

      // Commit the new counter to disk BEFORE releasing the mutex
      registry.metadata.last_id_used = nextNum;
      registry.metadata.next_id      = nextNum + 1;
      registry.metadata.id_format    = format;
      await this.write(registryPath, registry);

      return format.replace(/N+/, String(nextNum).padStart(4, '0'));

    } finally {
      resolveMutex(); // always release — unblocks the next waiting call
      // Clean up resolved promise if no newer call has replaced it (prevents memory leak)
      if (this._idMutex.get(rp) === current) this._idMutex.delete(rp);
    }
  }


  /** Derive a default id_format from the registry path when the field is missing */
  _defaultIdFormat(registryPath) {
    if (registryPath.includes('agent'))   return 'agent_NNN';
    if (registryPath.includes('project')) return 'project_NNN';
    if (registryPath.includes('task'))    return 'task_NNNN';
    if (registryPath.includes('model'))   return 'model_NNN';
    return 'item_NNN';
  }

  // ==================== GENERIC FIELD UPDATES ====================

  /**
   * Read-only field paths - cannot be modified via updateField
   * Path uses dot notation. Wildcards: * matches any key.
   */
  static READ_ONLY_PATHS = [
    'schema_version',
    'schema_type',
    'metadata.last_id_used',
    'metadata.next_id',
    'metadata.id_format',
    'metadata.total_*',
    'metadata.last_updated_at',
    '*.agent_id',
    '*.project_id',
    '*.task_id',
    '*.tool_id',
    '*.model_id',
    '*.created_at',
    '*.last_updated_at',
    '*.priority.score_history',
    '*.performance_summary.success_rate',
    '*.lifecycle.duration_seconds',
    '*.lifecycle.status_history',
    '*.closure_comments.duration_total_minutes',
    '*.closure_comments.closed_at'
  ];

  /**
   * Check if a field path is read-only.
   * Pattern matching rules:
   *   - "*.suffix" matches if path ends with ".suffix" (or equals "suffix")
   *   - "prefix.*" matches if path starts with "prefix."
   *   - exact path matches only itself
   */
  isReadOnly(fieldPath) {
    for (const pattern of RegistryManager.READ_ONLY_PATHS) {
      if (pattern.startsWith('*.')) {
        const suffix = pattern.substring(2);
        if (fieldPath === suffix || fieldPath.endsWith('.' + suffix)) {
          return true;
        }
      } else if (pattern.endsWith('*')) {
        const prefix = pattern.slice(0, -1);
        if (fieldPath.startsWith(prefix)) {
          return true;
        }
      } else if (pattern.includes('*')) {
        // Handle internal wildcards: each * matches one path segment
        const regex = new RegExp(
          '^' + pattern.split('.').map(seg =>
            seg === '*' ? '[^.]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          ).join('\\.') + '$'
        );
        if (regex.test(fieldPath)) return true;
      } else {
        if (fieldPath === pattern) return true;
      }
    }
    return false;
  }

  /**
   * Get a value at a dot-notation path in an object
   * Example: getValueAtPath(obj, 'agents.agent_001.display_name')
   */
  getValueAtPath(obj, path) {
    return path.split('.').reduce((curr, key) => curr?.[key], obj);
  }

  /**
   * Set a value at a dot-notation path in an object
   */
  setValueAtPath(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    const target = keys.reduce((curr, key) => {
      if (curr[key] === undefined) curr[key] = {};
      return curr[key];
    }, obj);
    target[lastKey] = value;
  }

  /**
   * Update any field in any registry file
   * Logs the change with old -> new values
   * 
   * @param {string} filePath - e.g. 'AGENTS/agent_registry.json'
   * @param {string} fieldPath - e.g. 'agents.agent_001.display_name'
   * @param {any} newValue - the new value
   * @param {object} options - { actor, reason }
   */
  async updateField(filePath, fieldPath, newValue, options = {}) {
    // Check read-only
    if (this.isReadOnly(fieldPath)) {
      throw new Error(`Field is read-only: ${fieldPath}`);
    }

    // Route task fields through _writeTaskDetails (name is historical — it
    // writes the FLAT tasks_registry.json; per-folder details.json is gone)
    if (filePath === 'PROJECTS/tasks_registry.json') {
      const parts = fieldPath.split('.');
      if (parts[0] === 'tasks' && parts[1]?.startsWith('task_')) {
        const taskId = parts[1];
        const task   = await this._readTaskDetails(taskId);
        if (!task) throw new Error(`Task ${taskId} not found`);
        const subPath = parts.slice(2).join('.');
        if (subPath) {
          const oldVal = this.getValueAtPath(task, subPath);
          if (JSON.stringify(oldVal) === JSON.stringify(newValue)) return { changed: false, message: 'No change' };
          this.setValueAtPath(task, subPath, newValue);
        }
        await this._writeTaskDetails(taskId, task);
        return { changed: true, taskId, field: subPath, newValue };
      }
    }

    // Load file
    const data = await this.read(filePath);
    const oldValue = this.getValueAtPath(data, fieldPath);

    // Skip if no change
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
      return { changed: false, message: 'No change needed' };
    }

    // Apply change
    this.setValueAtPath(data, fieldPath, newValue);

    // Update last_updated_at on the entity itself if applicable
    const entityKey = fieldPath.split('.').slice(0, 2).join('.');
    if (this.getValueAtPath(data, entityKey + '.last_updated_at') !== undefined) {
      this.setValueAtPath(data, entityKey + '.last_updated_at', new Date().toISOString());
    }

    // Special handling: name change → update name_history
    if (fieldPath.endsWith('.display_name')) {
      const historyPath = fieldPath.replace('.display_name', '.name_history');
      const history = this.getValueAtPath(data, historyPath) || [];
      const now = new Date().toISOString();
      // Mark old name as inactive
      const activeName = history.find(n => n.active);
      if (activeName) {
        activeName.active = false;
        activeName.ended_at = now;
      }
      // Add new name
      history.push({
        name: newValue,
        given_at: now,
        given_by: options.actor || 'human_user',
        active: true
      });
      this.setValueAtPath(data, historyPath, history);
    }

    await this.write(filePath, data);

    // Log the change
    await this.log({
      event_type: 'json_update',
      severity: 'info',
      actor: { type: options.actor_type || 'human', id: options.actor || 'human_user' },
      subject: { type: 'field', id: fieldPath },
      action: `Updated ${filePath}:${fieldPath}`,
      changes: [{
        file: filePath,
        field: fieldPath,
        from: oldValue,
        to: newValue
      }],
      context: { reason: options.reason || 'manual_edit' }
    });

    return { changed: true, oldValue, newValue, fieldPath, filePath };
  }

  /**
   * Build a schema description for a file by introspecting it
   * Returns metadata that frontend uses to render editors
   */
  async getFileSchema(filePath) {
    const data = await this.read(filePath);
    const schema = this.introspectSchema(data, '');
    
    // Add registry-level info for enum lookups
    const enums = {};
    if (data.status_definitions) enums.status = Object.keys(data.status_definitions);
    if (data.type_definitions) enums.type = Object.keys(data.type_definitions);
    if (data.category_definitions) enums.category = Object.keys(data.category_definitions);
    
    return { schema, enums, readOnlyPaths: RegistryManager.READ_ONLY_PATHS };
  }

  /**
   * Recursively analyze object structure
   */
  introspectSchema(value, path) {
    if (value === null) return { type: 'null', path };
    if (Array.isArray(value)) {
      return {
        type: 'array',
        path,
        readOnly: this.isReadOnly(path),
        itemType: value.length > 0 ? typeof value[0] : 'string',
        length: value.length
      };
    }
    if (typeof value === 'object') {
      const fields = {};
      for (const key of Object.keys(value)) {
        const childPath = path ? `${path}.${key}` : key;
        fields[key] = this.introspectSchema(value[key], childPath);
      }
      return { type: 'object', path, fields };
    }
    
    // Primitive
    const result = { type: typeof value, path, readOnly: this.isReadOnly(path), value };
    
    // Detect special string types
    if (typeof value === 'string') {
      if (/^#[0-9A-Fa-f]{6}$/.test(value)) result.hint = 'color';
      else if (/^\d{4}-\d{2}-\d{2}T/.test(value)) result.hint = 'datetime';
      else if (value.length > 100) result.hint = 'textarea';
    }
    
    return result;
  }

  // ==================== POSEIDON BRAIN ====================

  async getPoseidonBrain() {
    return await this.read('BRAIN/poseidon_brain.json');
  }

  async updatePoseidonState(updates) {
    const brain = await this.getPoseidonBrain();
    Object.assign(brain.current_state, updates);
    brain.current_state.last_state_update_at = new Date().toISOString();
    await this.write('BRAIN/poseidon_brain.json', brain);
    return brain;
  }

  // ==================== AGENTS ====================

  async getAgentRegistry() {
    return await this.read('AGENTS/agent_registry.json');
  }

  async getAgent(agentId) {
    const registry = await this.getAgentRegistry();
    const entry = registry.agents[agentId];
    if (!entry) return null;
    const brain = await this.read(`AGENTS/${entry.brain_file}`);
    return { registry_entry: entry, brain };
  }

  async deleteAgent(agentId) {
    const registry = await this.getAgentRegistry();
    const entry = registry.agents[agentId];
    if (!entry) throw new Error(`Agent ${agentId} not found`);
    
    const brainFile = entry.brain_file;
    const displayName = entry.display_name;
    
    // Remove from registry
    delete registry.agents[agentId];
    // Update metadata counters
    if (entry.status === 'active') {
      registry.metadata.total_active = Math.max(0, (registry.metadata.total_active || 1) - 1);
    } else if (entry.status === 'sleeping') {
      registry.metadata.total_sleeping = Math.max(0, (registry.metadata.total_sleeping || 1) - 1);
    }
    await this.write('AGENTS/agent_registry.json', registry);
    
    // Remove brain file from disk. ENOENT is NOT a problem — the desired
    // state (file gone) is already true; only real failures deserve a warn.
    try {
      const brainPath = path.join(this.dataRoot, 'agents', brainFile);
      await fs.unlink(brainPath);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        log.warn(`[deleteAgent] could not delete brain file ${brainFile}:`, err.message);
      }
    }
    
    // Remove from any project's assigned_agents list
    try {
      const pr = await this.read('PROJECTS/project_registry.json');
      let modified = false;
      for (const p of Object.values(pr.projects || {})) {
        if (Array.isArray(p.assigned_agents) && p.assigned_agents.includes(agentId)) {
          p.assigned_agents = p.assigned_agents.filter(a => a !== agentId);
          modified = true;
        }
      }
      if (modified) await this.write('PROJECTS/project_registry.json', pr);
    } catch {}
    
    await this.log({
      event_type: 'agent_archived',
      severity: 'warning',
      actor: { type: 'human', id: 'human_user' },
      subject: { type: 'agent', id: agentId },
      action: `Deleted agent ${displayName} (${agentId})`,
      changes: [
        { file: 'AGENTS/agent_registry.json', operation: 'removed_entry', key: agentId },
        { file: `AGENTS/${brainFile}`, operation: 'deleted' }
      ]
    });
    
    return { agent_id: agentId, display_name: displayName, deleted_brain_file: brainFile };
  }

  async createAgent(agentData) {
    // Generate ID FIRST — this increments next_id on disk.
    // Then read registry fresh so we have the post-increment metadata.
    const agentId  = await this.generateNextId('AGENTS/agent_registry.json');
    this.invalidateCache();
    const registry = await this.getAgentRegistry();
    const idNum    = agentId.split('_').pop();
    const nameSlug = RegistryManager.toSlug(agentData.display_name || agentData.name || 'agent');
    const brainFile = `${nameSlug}_${idNum}.json`;
    const now = new Date().toISOString();

    // Support two payload shapes:
    //   1. Legacy: { name, role, appearance, brain_config, ... }
    //   2. New (from AgentForm.openNew): { display_name, specialization, status, brain: {...} }
    const isNewFormat = agentData.brain && typeof agentData.brain === 'object';
    const displayName = agentData.display_name || agentData.name || 'New Squid';
    const specialization = agentData.specialization || 'general';
    const initialStatus = agentData.status || 'sleeping';

    // Create registry entry
    registry.agents[agentId] = {
      agent_id: agentId,
      display_name: displayName,
      name_history: [{
        name: displayName,
        given_at: now,
        given_by: agentData.created_by || 'human_user',
        active: true
      }],
      brain_file: brainFile,
      status: initialStatus,
      specialization,
      created_at: now,
      first_active_at: null,
      last_active_at: null,
      last_status_change_at: now,
      total_active_time_seconds: 0,
      assigned_projects: [],
      current_task_id: null,
      task_queue: [],
      performance_summary: {
        tasks_completed: 0,
        tasks_failed: 0,
        tasks_cancelled: 0,
        success_rate: 0,
        average_duration_seconds: 0,
        last_30_days_score: 0
      },
      resource_usage: {
        current_model_id: null,
        lifetime_input_tokens: 0,
        lifetime_output_tokens: 0
      }
    };

    // Update metadata
    if (initialStatus === 'sleeping') {
      registry.metadata.total_sleeping = (registry.metadata.total_sleeping || 0) + 1;
    } else if (initialStatus === 'active') {
      registry.metadata.total_active = (registry.metadata.total_active || 0) + 1;
    }
    registry.metadata.total_ever_created = (registry.metadata.total_ever_created || 0) + 1;

    let brain;
    if (isNewFormat) {
      // Use the brain object provided by AgentForm, but inject correct IDs
      brain = {
        schema_version: '2.0.0',
        schema_type: 'agent_brain',
        ...agentData.brain,
        identity: {
          ...(agentData.brain.identity || {}),
          agent_id: agentId,
          display_name: displayName,
          created_at: agentData.brain.identity?.created_at || now,
          created_by: agentData.created_by || 'human_user',
          version: '1.0.0'
        },
        current_state: agentData.brain.current_state || {
          status: initialStatus, current_task_id: null, last_action_at: null
        },
        assignments: agentData.brain.assignments || { projects: [], active_tasks: [], task_queue: [] },
        inbox: agentData.brain.inbox || { messages: [], unread_count: 0 },
        performance: agentData.brain.performance || { lifetime: {}, last_30_days: {}, by_skill: {} },
        history: agentData.brain.history || { completed_tasks_log: [], wake_sleep_events: [] }
      };
    } else {
      // Legacy format - build brain from scattered fields
      brain = {
        schema_version: '2.0.0',
        schema_type: 'agent_brain',
        identity: {
          agent_id: agentId,
          display_name: displayName,
          nickname: agentData.nickname || displayName,
          role: agentData.role || 'General Agent',
          created_at: now,
          created_by: agentData.created_by || 'human_user',
          cloned_from: agentData.cloned_from || null,
          version: '1.0.0'
        },
        appearance: agentData.appearance || {
          primary_color: '#FF6B9D',
          secondary_color: '#C44569',
          size_scale: 1.0,
          accessories: { hat: 'none', glasses: 'none', eyes: 'round', outfit: 'none' }
        },
        brain_config: agentData.brain_config || {
          model_binding: { preferred_model_id: null, current_model_id: null },
          inference_params: { temperature: 0.7, top_p: 0.9, top_k: 40, max_tokens_per_response: 2048 },
          system_prompt: `You are ${displayName}, an AI agent in the SquidMind farm.`
        },
        capabilities: { skills: {}, tools_allowed: [], tools_forbidden: [] },
        current_state: { status: 'sleeping', current_task_id: null, last_action_at: null },
        assignments: { projects: [], active_tasks: [], task_queue: [] },
        inbox: { messages: [], unread_count: 0 },
        performance: { lifetime: {}, last_30_days: {}, by_skill: {} },
        memory: { short_term: {}, long_term: {}, lessons_learned: [] },
        history: { completed_tasks_log: [], wake_sleep_events: [] }
      };
    }

    await this.write(`AGENTS/${brainFile}`, brain);
    await this.write('AGENTS/agent_registry.json', registry);

    await this.log({
      event_type: 'agent_created',
      actor: { type: 'system', id: agentData.created_by || 'human_user' },
      subject: { type: 'agent', id: agentId },
      action: `Created agent: ${displayName}`,
      changes: [
        { file: 'AGENTS/agent_registry.json', operation: 'added_entry', key: agentId },
        { file: `AGENTS/${brainFile}`, operation: 'created' }
      ]
    });

    return { agent_id: agentId, registry_entry: registry.agents[agentId], brain };
  }

  /**
   * Wake an agent: sleeping -> active
   * Loads agent's context (projects, pending tasks) and updates state.
   */
  async wakeAgent(agentId, options = {}) {
    const registry = await this.getAgentRegistry();
    const entry = registry.agents[agentId];
    if (!entry) throw new Error(`Agent ${agentId} not found`);
    if (entry.status === 'active') {
      return { agent_id: agentId, already_active: true };
    }
    if (entry.status === 'archived') {
      throw new Error(`Cannot wake archived agent ${agentId}`);
    }

    const now = new Date().toISOString();
    const previousStatus = entry.status;

    // Update registry entry
    entry.status = 'active';
    entry.last_active_at = now;
    entry.last_status_change_at = now;
    if (!entry.first_active_at) entry.first_active_at = now;

    // Update metadata counters
    if (previousStatus === 'sleeping') registry.metadata.total_sleeping--;
    registry.metadata.total_active++;

    await this.write('AGENTS/agent_registry.json', registry);

    // Update brain file: status + log wake event
    const brain = await this.read(`AGENTS/${entry.brain_file}`);
    if (!brain.current_state) brain.current_state = {};
    brain.current_state.status = 'active';
    brain.current_state.last_action_at = now;
    if (!brain.history) brain.history = {};
    if (!brain.history.wake_sleep_events) brain.history.wake_sleep_events = [];
    brain.history.wake_sleep_events.push({
      event: 'wake',
      at: now,
      by: options.woken_by || 'poseidon',
      reason: options.reason || 'manual_wake',
      from_status: previousStatus
    });
    await this.write(`AGENTS/${entry.brain_file}`, brain);

    // Update poseidon's count
    const pb = await this.getPoseidonBrain();
    pb.current_state.active_agents_count = registry.metadata.total_active;
    pb.current_state.sleeping_agents_count = registry.metadata.total_sleeping;
    await this.write('BRAIN/poseidon_brain.json', pb);

    await this.log({
      event_type: 'agent_woken',
      actor: { type: options.woken_by ? 'human' : 'poseidon', id: options.woken_by || 'poseidon_main' },
      subject: { type: 'agent', id: agentId },
      action: `Woke agent ${entry.display_name} (${previousStatus} -> active)`,
      changes: [
        { file: 'AGENTS/agent_registry.json', field: `agents.${agentId}.status`, from: previousStatus, to: 'active' }
      ],
      context: { agent_id: agentId, reason: options.reason }
    });

    return { agent_id: agentId, status: 'active', context: this._buildAgentContext(brain, entry) };
  }

  /**
   * Put agent to sleep: active -> sleeping
   * Preserves state for later resumption.
   */
  async sleepAgent(agentId, options = {}) {
    const registry = await this.getAgentRegistry();
    const entry = registry.agents[agentId];
    if (!entry) throw new Error(`Agent ${agentId} not found`);
    if (entry.status === 'sleeping') {
      return { agent_id: agentId, already_sleeping: true };
    }
    if (entry.status === 'archived') {
      throw new Error(`Cannot put archived agent ${agentId} to sleep`);
    }

    const now = new Date().toISOString();
    const previousStatus = entry.status;

    // Update registry
    entry.status = 'sleeping';
    entry.last_status_change_at = now;
    if (previousStatus === 'active') {
      registry.metadata.total_active--;
      registry.metadata.total_sleeping++;
    }
    await this.write('AGENTS/agent_registry.json', registry);

    // Update brain
    const brain = await this.read(`AGENTS/${entry.brain_file}`);
    if (!brain.current_state) brain.current_state = {};
    if (!brain.history) brain.history = {};
    brain.current_state.status = 'sleeping';
    if (!brain.history.wake_sleep_events) brain.history.wake_sleep_events = [];
    brain.history.wake_sleep_events.push({
      event: 'sleep',
      at: now,
      by: options.put_to_sleep_by || 'poseidon',
      reason: options.reason || 'idle',
      from_status: previousStatus
    });
    await this.write(`AGENTS/${entry.brain_file}`, brain);

    // Update poseidon counts
    const pb = await this.getPoseidonBrain();
    pb.current_state.active_agents_count = registry.metadata.total_active;
    pb.current_state.sleeping_agents_count = registry.metadata.total_sleeping;
    await this.write('BRAIN/poseidon_brain.json', pb);

    await this.log({
      event_type: 'agent_slept',
      actor: { type: options.put_to_sleep_by ? 'human' : 'poseidon', id: options.put_to_sleep_by || 'poseidon_main' },
      subject: { type: 'agent', id: agentId },
      action: `Agent ${entry.display_name} went to sleep`,
      changes: [
        { file: 'AGENTS/agent_registry.json', field: `agents.${agentId}.status`, from: previousStatus, to: 'sleeping' }
      ]
    });

    return { agent_id: agentId, status: 'sleeping' };
  }

  /**
   * Build agent context for wake-up (what the agent needs to know)
   */
  _buildAgentContext(brain, entry) {
    return {
      agent_id: entry.agent_id,
      display_name: entry.display_name,
      assigned_projects: entry.assigned_projects,
      current_task_id: entry.current_task_id,
      task_queue_count: (entry.task_queue || []).length,
      unread_messages: brain.inbox ? brain.inbox.unread_count : 0,
      preferred_model: brain.brain_config?.model_binding?.preferred_model_id || null
    };
  }

  // ==================== PROJECTS ====================

  /**
   * Canonical folder name for a project = uppercase sanitized name.
   * aquarium/PROJECTS/<FOLDER>/input|output|project_memory.json
   * This is the single source of truth — never use project_id as folder name.
   */
  static projectFolder(nameOrEntry) {
    const name = typeof nameOrEntry === 'string'
      ? nameOrEntry
      : (nameOrEntry.name || nameOrEntry.folder || '');
    return name.toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 48);
  }

  /**
   * Thin wrapper used by TaskRunner and AgentWorker.
   * 'active' → calls wakeAgent, 'sleeping' → calls sleepAgent.
   * Also updates current_task_id on the registry entry when provided.
   */
  async updateAgentStatus(agentId, status, options = {}) {
    try {
      if (status === 'active') {
        await this.wakeAgent(agentId, options);
        // Track which task this agent is working on
        if (options.task_id) {
          const reg = await this.getAgentRegistry();
          if (reg.agents[agentId]) {
            reg.agents[agentId].current_task_id = options.task_id;
            await this.write('AGENTS/agent_registry.json', reg);
          }
        }
      } else if (status === 'sleeping') {
        await this.sleepAgent(agentId, options);
        // Clear current task
        try {
          const reg = await this.getAgentRegistry();
          if (reg.agents[agentId]) {
            reg.agents[agentId].current_task_id = null;
            await this.write('AGENTS/agent_registry.json', reg);
          }
        } catch {}
      }
    } catch (e) {
      // Log but don't throw — agent status update is non-critical
      log.warn(` updateAgentStatus(${agentId}, ${status}) failed:`, e.message);
    }
  }

  /** XP / leveling — called by TaskRunner on task completion.
   *  outcome: 'passed' | 'revised' | 'failed'
   *  score:   review score 1-10 or null. UNVERIFIED (phantom-pass) reviews
   *  must be passed with score=null so they never inflate averages.
   *  XP: passed=100 (+10×score bonus), revised=40, failed=10 (showing up
   *  counts a little). Level = floor(sqrt(xp/100)) — 1 task = lvl1,
   *  4 = lvl2, 9 = lvl3, 25 = lvl5… slows down naturally. */
  async recordAgentOutcome(agentId, { outcome = 'passed', score = null } = {}) {
    if (!agentId || agentId === 'poseidon_main') return null;
    try {
      const reg = await this.getAgentRegistry();
      const agent = reg.agents?.[agentId];
      if (!agent) return null;
      const s = agent.stats = agent.stats || {
        tasks_done: 0, pass_count: 0, revise_count: 0, fail_count: 0,
        score_sum: 0, score_n: 0, xp: 0, level: 1,
      };
      s.tasks_done += 1;
      let gained = 10;
      if (outcome === 'passed')  { s.pass_count += 1;   gained = 100 + (Number.isFinite(score) ? score * 10 : 0); }
      if (outcome === 'revised') { s.revise_count += 1; gained = 40; }
      if (outcome === 'failed')  { s.fail_count += 1;   gained = 10; }
      if (Number.isFinite(score)) { s.score_sum += score; s.score_n += 1; }
      s.xp += gained;
      const newLevel = Math.max(1, Math.floor(Math.sqrt(s.xp / 100)));
      const leveledUp = newLevel > (s.level || 1);
      s.level = newLevel;
      s.avg_score = s.score_n ? Math.round((s.score_sum / s.score_n) * 10) / 10 : null;
      await this.write('AGENTS/agent_registry.json', reg);
      if (leveledUp) {
        await this.log({
          event_type: 'agent_levelup',
          action: `${agent.display_name || agentId} reached level ${newLevel} (${s.xp} XP)`,
          actor: { type: 'agent', id: agentId },
        }).catch(() => {});
      }
      return { xp: s.xp, level: s.level, leveled_up: leveledUp, gained };
    } catch (e) {
      log.warn(` recordAgentOutcome(${agentId}) failed:`, e.message);
      return null;
    }
  }



  async getProjectRegistry() {
    return await this.read('PROJECTS/project_registry.json');
  }

  async getProject(projectId) {
    const registry = await this.getProjectRegistry();
    const entry = registry.projects[projectId];
    if (!entry) return null;
    const folder = RegistryManager.projectFolder(entry);
    const memory = await this.read(`PROJECTS/${folder}/project_memory.json`).catch(() => null);
    return { registry_entry: entry, memory };
  }

  /** Resolve project entry by name OR id. Also repairs stale folder field. */
  async resolveProjectByNameOrId(nameOrId) {
    this.invalidateCache();
    const reg = await this.getProjectRegistry();
    const upper = (nameOrId || '').toUpperCase();
    let found = null;
    // Try by id
    if (reg.projects[nameOrId]) found = { id: nameOrId, entry: reg.projects[nameOrId] };
    // Try by name
    if (!found) {
      const pair = Object.entries(reg.projects || {}).find(
        ([, p]) => p.name === upper || p.name === nameOrId
      );
      if (pair) found = { id: pair[0], entry: pair[1] };
    }
    // Try partial match
    if (!found) {
      const pair = Object.entries(reg.projects || {}).find(
        ([, p]) => (p.name || '').toUpperCase().includes(upper) || upper.includes((p.name || '').toUpperCase())
      );
      if (pair) found = { id: pair[0], entry: pair[1] };
    }
    if (!found) return null;

    // Repair: ensure folder = canonical name (fixes old project_id-named folders
    // or legacy lowercase folders created by toSlug). Also physically rename
    // the directory on disk so existing input/output files come with us.
    const canonical = RegistryManager.projectFolder(found.entry);
    if (found.entry.folder !== canonical) {
      const oldFolder = found.entry.folder;
      try {
        const fs = require('fs').promises;
        const path = require('path');
        const AQUARIUM = require('../aquarium');
        const oldPath = path.join(AQUARIUM.PROJECTS, oldFolder);
        const newPath = path.join(AQUARIUM.PROJECTS, canonical);
        // Only rename if old folder exists AND new folder does not
        // (avoids clobbering data when both somehow co-exist).
        const oldExists = await fs.access(oldPath).then(() => true).catch(() => false);
        const newExists = await fs.access(newPath).then(() => true).catch(() => false);
        if (oldExists && !newExists) {
          await fs.rename(oldPath, newPath);
        } else if (oldExists && newExists) {
          // Both exist — merge: move any files from old → new without overwriting
          const entries = await fs.readdir(oldPath, { withFileTypes: true }).catch(() => []);
          for (const e of entries) {
            const src = path.join(oldPath, e.name);
            const dst = path.join(newPath, e.name);
            const dstExists = await fs.access(dst).then(() => true).catch(() => false);
            if (!dstExists) await fs.rename(src, dst).catch(() => {});
          }
          // Best-effort cleanup of the now-empty old directory
          await fs.rm(oldPath, { recursive: true, force: true }).catch(() => {});
        }
      } catch { /* migration is best-effort */ }

      found.entry.folder = canonical;
      found.entry.memory_file = `${canonical}/project_memory.json`;
      reg.projects[found.id] = found.entry;
      await this.write('PROJECTS/project_registry.json', reg).catch(() => {});
    }
    return found;
  }

  /** Read project_memory.json for a given project */
  async getProjectMemory(projectId) {
    const reg = await this.getProjectRegistry();
    const entry = reg.projects[projectId];
    if (!entry) return null;
    const folder = RegistryManager.projectFolder(entry);
    try {
      return await this.read(`PROJECTS/${folder}/project_memory.json`);
    } catch { return null; }
  }

  /**
   * Update project_memory.json with task completion, agent activity, or Poseidon decisions.
   * section: 'progress' | 'achievement' | 'decision' | 'blocker' | 'agent_sync' | 'next_steps'
   */
  async updateProjectMemory(projectId, section, content, by = 'system') {
    const reg = await this.getProjectRegistry();
    const entry = reg.projects?.[projectId];
    if (!entry?.memory_file) return false;

    const fs   = require('fs').promises;
    const path = require('path');
    const AQUARIUM = require('../aquarium');
    const folder  = RegistryManager.projectFolder(entry);
    const memPath = path.join(AQUARIUM.PROJECTS, folder, 'project_memory.json');
    await fs.mkdir(path.dirname(memPath), { recursive: true });
    let memory;
    try {
      memory = JSON.parse(await fs.readFile(memPath, 'utf8'));
    } catch {
      // Recreate if missing
      memory = {
        schema_version: '2.0.0', schema_type: 'project_memory',
        project_id: projectId, name: entry.name,
        vision: entry.vision || '',
        goals: [], tasks: [],
        progress: { completion: '0%', blockers: [], recent_achievements: [], next_steps: [] },
        agents_communication: [], decisions: [],
        created: new Date().toISOString()
      };
    }

    const now = new Date().toISOString();
    const stamp = { at: now, by };

    switch (section) {
      case 'achievement':
        if (!memory.progress.recent_achievements) memory.progress.recent_achievements = [];
        memory.progress.recent_achievements.unshift({ ...stamp, text: content });
        memory.progress.recent_achievements = memory.progress.recent_achievements.slice(0, 20);
        break;
      case 'blocker':
        if (!memory.progress.blockers) memory.progress.blockers = [];
        memory.progress.blockers.unshift({ ...stamp, text: content });
        break;
      case 'resolve_blocker':
        memory.progress.blockers = (memory.progress.blockers || []).filter(b => !b.text.includes(content));
        break;
      case 'decision':
        if (!memory.decisions) memory.decisions = [];
        memory.decisions.unshift({ ...stamp, text: content });
        memory.decisions = memory.decisions.slice(0, 30);
        break;
      case 'next_steps':
        if (!memory.progress.next_steps) memory.progress.next_steps = [];
        if (Array.isArray(content)) {
          memory.progress.next_steps = content;
        } else {
          memory.progress.next_steps.unshift(content);
          memory.progress.next_steps = memory.progress.next_steps.slice(0, 10);
        }
        break;
      case 'agent_sync':
        if (!memory.agents_communication) memory.agents_communication = [];
        memory.agents_communication.unshift({ ...stamp, message: content });
        memory.agents_communication = memory.agents_communication.slice(0, 40);
        break;
      case 'progress': {
        // Auto-compute completion from tasks
        const all = typeof content === 'object' ? content : null;
        if (all && typeof all.total === 'number') {
          const pct = all.total > 0 ? Math.round((all.done / all.total) * 100) : 0;
          memory.progress.completion = `${pct}%`;
          memory.progress.tasks_total = all.total;
          memory.progress.tasks_done  = all.done;
          memory.progress.tasks_pending = all.total - all.done;
          memory.progress.last_updated = now;
        } else if (typeof content === 'string') {
          memory.progress.completion = content;
        }
        break;
      }
      default:
        memory[section] = content;
    }

    memory.updated_at = now;
    await fs.mkdir(path.dirname(memPath), { recursive: true });
    await fs.writeFile(memPath, JSON.stringify(memory, null, 2), 'utf8');
    // Bypass cache — getProjectMemory reads via this.read() which is cache-aware.
    // Without this, an LLM that calls update_project_memory then read_project_memory
    // in the same conversation sees the pre-update version.
    this.invalidateCache(`PROJECTS/${folder}/project_memory.json`);

    // Also update registry metrics
    if (section === 'progress' && typeof content === 'object') {
      entry.metrics = {
        ...(entry.metrics || {}),
        tasks_total: content.total || 0,
        tasks_completed: content.done || 0,
        tasks_pending: (content.total || 0) - (content.done || 0),
        completion_percent: parseInt(memory.progress.completion) || 0,
        last_updated: now
      };
      await this.write('PROJECTS/project_registry.json', reg);
    }

    return true;
  }

  /**
   * Delete a project: remove from registry, free all assigned agents, log.
   * Does NOT delete task history — tasks keep their project_name for reference.
   */
  /**
   * Seed the two system projects if missing — the canonical homes for
   * projectless content:
   *   GALLERY  — images generated outside any project context
   *   GODSTUFF — Poseidon's ad-hoc files and projectless task outputs
   * Every project feature (temple UI, RUN/TERM, versions, RAG, Ctrl+K,
   * backups) applies to them for free. system:true blocks deletion and
   * excludes them from mission assignment.
   */
  async ensureSystemProjects() {
    const SPECS = [
      { name: 'GALLERY',   folder: 'GALLERY',   description: 'System project — all images generated outside a project land here.' },
      { name: 'GODSTUFF',  folder: 'GODSTUFF',  description: "System project — Poseidon's ad-hoc creations and projectless task outputs." },
    ];
    const fsp = require('fs').promises;
    const pathm = require('path');
    const AQUARIUM = require('../aquarium');
    this.invalidateCache();
    const reg = await this.getProjectRegistry();
    reg.projects = reg.projects || {};
    let created = 0;
    for (const spec of SPECS) {
      const exists = Object.values(reg.projects).some(p => p.name === spec.name || p.folder === spec.folder);
      // Folders always ensured (content may arrive before the registry write)
      for (const sub of ['input', 'output']) {
        await fsp.mkdir(pathm.join(AQUARIUM.PROJECTS, spec.folder, sub), { recursive: true }).catch(() => {});
      }
      if (exists) {
        // Backfill the system flag on pre-existing entries
        const p = Object.values(reg.projects).find(p => p.name === spec.name || p.folder === spec.folder);
        if (p && !p.system) { p.system = true; created++; }
        continue;
      }
      const pid = await this.generateNextId('PROJECTS/project_registry.json');
      this.invalidateCache();
      const fresh = await this.getProjectRegistry();
      fresh.projects[pid] = {
        project_id: pid,
        name: spec.name,
        folder: spec.folder,
        description: spec.description,
        status: 'active',
        system: true,
        assigned_agents: [],
        created_at: new Date().toISOString(),
        created_by: 'system',
      };
      await this.write('PROJECTS/project_registry.json', fresh);
      Object.assign(reg, fresh);
      created++;
    }
    if (created > 0) {
      await this.write('PROJECTS/project_registry.json', reg);
      this.invalidateCache();
    }
    return { created };
  }

  async deleteProject(projectId) {
    this.invalidateCache();
    const reg = await this.getProjectRegistry();
    const entry = reg.projects?.[projectId];
    if (!entry) throw new Error(`Project ${projectId} not found`);
    // System projects (GALLERY, GODSTUFF) are load-bearing — they're the
    // canonical home for projectless content. Refuse deletion.
    if (entry.system) throw new Error(`${entry.name} is a system project and cannot be deleted`);

    const projectName = entry.name;
    const assignedAgents = [...(entry.assigned_agents || [])];
    const folder = entry.folder || projectName?.toUpperCase().replace(/[^A-Z0-9_]/g, '_');

    // Remove project folder from disk (input/, output/, project_memory.json …)
    if (folder) {
      const AQUARIUM = require('../aquarium');
      const path = require('path');
      const fsp  = require('fs').promises;
      const projDir = path.join(AQUARIUM.PROJECTS, folder);
      try { await fsp.rm(projDir, { recursive: true, force: true }); } catch {}
    }

    // Cascade-delete all tasks belonging to this project — without this,
    // tasks remain orphaned in tasks_registry.json + results_log.json after
    // the project disappears, polluting the kanban and the global queue.
    const deletedTaskIds = [];
    try {
      const AQUARIUM = require('../aquarium');
      const path     = require('path');
      const fsp      = require('fs').promises;

      // ── Live registry ──
      const liveTasksPath = AQUARIUM.TASKS_REGISTRY;
      let liveReg = { metadata: { next_id: 1 }, tasks: {} };
      try { liveReg = JSON.parse(await fsp.readFile(liveTasksPath, 'utf8')); } catch {}
      const belongs = (t) =>
        t.project_id          === projectId ||
        t.context?.project_id === projectId ||
        (projectName && (t.project_name === projectName || t.context?.project_name === projectName));
      Object.entries(liveReg.tasks || {}).forEach(([tid, t]) => {
        if (belongs(t)) { deletedTaskIds.push(tid); delete liveReg.tasks[tid]; }
      });
      await fsp.writeFile(liveTasksPath, JSON.stringify(liveReg, null, 2), 'utf8');

      // ── Results log (terminal tasks live here after purge) ──
      const resultsPath = AQUARIUM.RESULTS_LOG;
      let resLog = { results: {} };
      try { resLog = JSON.parse(await fsp.readFile(resultsPath, 'utf8')); } catch {}
      Object.entries(resLog.results || {}).forEach(([tid, t]) => {
        if (belongs(t)) { deletedTaskIds.push(tid); delete resLog.results[tid]; }
      });
      await fsp.writeFile(resultsPath, JSON.stringify(resLog, null, 2), 'utf8');

      // ── Projectless output files (GODSTUFF/output/<id>.<ext>) ──
      const outDir = path.join(AQUARIUM.PROJECTS, 'GODSTUFF', 'output');
      try {
        const entries = await fsp.readdir(outDir).catch(() => []);
        for (const fname of entries) {
          const tid = fname.replace(/\.[^.]+$/, '');
          if (deletedTaskIds.includes(tid)) {
            await fsp.unlink(path.join(outDir, fname)).catch(() => {});
          }
        }
      } catch { /* output dir may not exist */ }

      this.invalidateCache();
      if (deletedTaskIds.length) {
        log.info(`[deleteProject] cascade-deleted ${deletedTaskIds.length} task(s) of ${projectId}`);
      }
    } catch (err) {
      log.warn('[deleteProject] task cascade failed:', err.message);
    }

    // Remove project from registry
    delete reg.projects[projectId];
    await this.write('PROJECTS/project_registry.json', reg);

    // Free all assigned agents: clear their assigned_projects list
    if (assignedAgents.length > 0) {
      try {
        const agentReg = await this.read('AGENTS/agent_registry.json');
        let modified = false;
        for (const agentId of assignedAgents) {
          const agent = agentReg.agents?.[agentId];
          if (!agent) continue;
          agent.assigned_projects = (agent.assigned_projects || []).filter(id => id !== projectId);
          // If agent was sleeping (idle), keep it sleeping. Only change if it was on this project.
          if (agent.current_task_id && agent.status === 'active') {
            // Don't touch actively running agents — Poseidon handles re-assignment
          }
          modified = true;
        }
        if (modified) await this.write('AGENTS/agent_registry.json', agentReg);
      } catch (err) {
        log.warn('[deleteProject] could not free agents:', err.message);
      }
    }

    await this.log({
      event_type: 'project_archived',
      severity: 'warning',
      actor: { type: 'human', id: 'human_user' },
      subject: { type: 'project', id: projectId },
      action: `Deleted project "${projectName}" (${projectId}), freed ${assignedAgents.length} agent(s)`,
      context: { freed_agents: assignedAgents }
    });

    return { project_id: projectId, name: projectName, freed_agents: assignedAgents };
  }

  // ==================== TASKS (per-folder structure) ====================

  /**
   * Task folder: workspace/tasks/<task_id>/
   *   results/      — output files (output.txt, etc.)
   *
   * All task data lives in aquarium/PROJECTS/tasks_registry.json.
   * No per-folder structure. No details.json files. Single flat JSON.
   */

  _taskDir(taskId) {
    // Kept only for output file path resolution — no task data is stored here
    const AQUARIUM = require('../aquarium');
    // SIMPLIFICATION: no per-task folders anymore — projectless work
    // lives in the GODSTUFF system project.
    return require('path').join(AQUARIUM.PROJECTS, 'GODSTUFF', 'output');
  }

  async _readTaskDetails(taskId) {
    try {
      const AQUARIUM = require('../aquarium');
      const path = require('path');
      const flatPath = AQUARIUM.TASKS_REGISTRY;
      const reg = JSON.parse(require('fs').readFileSync(flatPath, 'utf8'));
      if (reg.tasks?.[taskId]) return reg.tasks[taskId];
      // Not in the live registry — it may be a terminal task (completed/
      // failed/cancelled) that was moved to results_log.json. Look there
      // too, so operations like "drag a Done card back to To-Do for a new
      // iteration" can find the task instead of 404-ing with "Task not found".
      const resultsPath = AQUARIUM.RESULTS_LOG;
      if (require('fs').existsSync(resultsPath)) {
        const rl = JSON.parse(require('fs').readFileSync(resultsPath, 'utf8'));
        const found = rl.results?.[taskId] || (Array.isArray(rl.results) ? rl.results.find(r => r.task_id === taskId) : null);
        if (found) return { ...found, task_id: found.task_id || taskId, _fromResultsLog: true };
      }
      return null;
    } catch { return null; }
  }

  async _writeTaskDetails(taskId, task) {
    // CRITICAL: use this.write (which chains through writeLocks) instead of
    // a raw fs.writeFile. Otherwise this can race with generateNextId's
    // write of last_id_used → if we read the file BEFORE generateNextId's
    // write has landed AND the read fails / default kicks in, we clobber
    // last_id_used=48 with last_id_used=0. Next task then generates as
    // task_0001, colliding with the seed.
    const reg = await this.read('PROJECTS/tasks_registry.json').catch(() => null)
              || { metadata: { next_id: 1, id_format: 'task_NNNN' }, tasks: {} };
    if (!reg.metadata) reg.metadata = { next_id: 1, id_format: 'task_NNNN' };
    if (!reg.tasks)    reg.tasks    = {};

    const terminalStatuses = new Set(['done', 'completed', 'cancelled', 'archived', 'failed']);
    const status = task.lifecycle?.status || task.status || '';
    if (terminalStatuses.has(status)) {
      // Remove terminal tasks from registry — output is in result_file on disk
      delete reg.tasks[taskId];
    } else {
      // Non-terminal: (re)insert into the live registry. Strip the marker we
      // add when a task was read out of results_log.
      const clean = { ...task, task_id: task.task_id || taskId };
      delete clean._fromResultsLog;
      reg.tasks[taskId] = clean;
      // If this task was previously terminal (living in results_log), remove
      // it from there so it doesn't exist in both places. This is what makes
      // "drag Done → To-Do" actually re-open the task for a new iteration.
      try {
        const AQUARIUM = require('../aquarium');
        const path = require('path');
        const fsSync = require('fs');
        const resultsPath = AQUARIUM.RESULTS_LOG;
        if (fsSync.existsSync(resultsPath)) {
          const rl = JSON.parse(fsSync.readFileSync(resultsPath, 'utf8'));
          let changed = false;
          if (rl.results && !Array.isArray(rl.results) && rl.results[taskId]) {
            delete rl.results[taskId]; changed = true;
          } else if (Array.isArray(rl.results)) {
            const before = rl.results.length;
            rl.results = rl.results.filter(r => r.task_id !== taskId);
            changed = rl.results.length !== before;
          }
          if (changed) fsSync.writeFileSync(resultsPath, JSON.stringify(rl, null, 2), 'utf8');
        }
      } catch { /* non-fatal */ }
    }

    await this.write('PROJECTS/tasks_registry.json', reg);
  }

  async getTasksRegistry() {
    const fs   = require('fs');
    const path = require('path');
    const AQUARIUM = require('../aquarium');
    const flatPath = AQUARIUM.TASKS_REGISTRY;
    if (!fs.existsSync(flatPath)) {
      return { metadata: { next_id: 1, id_format: 'task_NNNN' }, tasks: {} };
    }
    try { return JSON.parse(fs.readFileSync(flatPath, 'utf8')); }
    catch { return { metadata: { next_id: 1, id_format: 'task_NNNN' }, tasks: {} }; }
  }
  /**
   * Resolve an agent_id to its display_name. Returns null if not found.
   * Used to denormalize assigned_name onto tasks so the UI doesn't need
   * a second agent_registry fetch just to display "Bob" instead of "agent_abc123".
   * Cheap — agent_registry is already cached in this.cache.
   */
  async _resolveAgentName(agentId) {
    if (!agentId) return null;
    try {
      const reg = await this.getAgentRegistry();
      return reg.agents?.[agentId]?.display_name || null;
    } catch { return null; }
  }

  async createTask(taskData) {
    const taskId = await this.generateNextId('PROJECTS/tasks_registry.json');
    const now = new Date().toISOString();

    // A task is ALWAYS bound to an agent. If the caller didn't pick one,
    // auto-assign: least-loaded temple member of the project, else any agent.
    let assignedTo = taskData.assigned_to || null;
    if (!assignedTo) {
      assignedTo = await this.pickDefaultAgent(taskData.project_id || taskData.project_name).catch(() => null);
    }

    // Denormalize agent display_name at assignment time so the UI doesn't
    // need to fetch agent_registry separately to display a friendly name.
    const assignedName = taskData.assigned_name
      || (assignedTo ? await this._resolveAgentName(assignedTo) : null);

    const task = {
      task_id:        taskId,
      title:          taskData.title,
      description:    taskData.description || '',
      task_type:      taskData.task_type || 'text',
      sort_order:     taskData.sort_order ?? 0,   // queue position — lower = runs first (FIFO)
      project_id:     taskData.project_id   || null,
      project_name:   taskData.project_name || null,
      assigned_to:    assignedTo,
      assigned_name:  assignedName,
      image_params:   taskData.image_params || null,
      status:         'todo',
      lifecycle: {
        status:         'todo',
        status_history: [{ status: 'todo', at: now, by: 'poseidon' }],
        started_at:     null,
        completed_at:   null,
      },
      result_file:    null,
      result_summary: null,
      created_at:     now,
    };

    await this._writeTaskDetails(taskId, task);
    return task;
  }

  /**
   * pickDefaultAgent — resolves the default agent for a new task.
   * Priority: least-loaded temple member of the project → least-loaded
   * agent overall → null (Poseidon executes as last resort).
   * "Least-loaded" = fewest live (non-done) tasks currently assigned.
   */
  async pickDefaultAgent(projectRef = null) {
    const areg = await this.getAgentRegistry().catch(() => ({ agents: {} }));
    const allAgents = Object.keys(areg.agents || {}).filter(id => id !== 'poseidon_main');
    if (!allAgents.length) return null;

    let candidates = allAgents;
    if (projectRef) {
      try {
        const proj = await this.resolveProjectByNameOrId(projectRef);
        const members = (proj?.entry?.assigned_agents || []).filter(id => allAgents.includes(id));
        if (members.length) candidates = members;
      } catch { /* fall back to all agents */ }
    }

    // Load = live tasks assigned to the agent (todo/wip, any legacy alias)
    const treg = await this.getTasksRegistry().catch(() => ({ tasks: {} }));
    const load = Object.fromEntries(candidates.map(id => [id, 0]));
    for (const t of Object.values(treg.tasks || {})) {
      if (t.assigned_to && load[t.assigned_to] !== undefined) load[t.assigned_to]++;
    }
    candidates.sort((a, b) => load[a] - load[b]);
    return candidates[0] || null;
  }

  /**
   * Close a task - replaces chunks with closure_comments
   */
  async closeTask(taskId, outcome, closureData) {
    const task = await this._readTaskDetails(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    const now = new Date().toISOString();
    const startTime = task.lifecycle.started_at ? new Date(task.lifecycle.started_at).getTime() : Date.now();
    const durationMin = Math.round((Date.now() - startTime) / 60000);

    // Replace chunks with closure_comments
    delete task.chunks;
    task.closure_comments = {
      outcome,
      summary: closureData.summary,
      what_went_well: closureData.what_went_well || '',
      what_could_improve: closureData.what_could_improve || '',
      lessons_for_future: closureData.lessons_for_future || '',
      closed_by: closureData.closed_by || 'poseidon',
      closed_at: now,
      duration_total_minutes: durationMin,
      approval_status: closureData.approval_status || 'approved',
      approved_by: closureData.approved_by || 'poseidon',
      rating_by_poseidon: closureData.rating_by_poseidon || null,
      rating_by_user: closureData.rating_by_user || null
    };

    task.lifecycle.status = outcome;
    task.lifecycle.completed_at = now;
    task.lifecycle.duration_seconds = Math.round((Date.now() - startTime) / 1000);
    task.lifecycle.status_history?.push({ status: outcome, at: now, by: closureData.closed_by || 'poseidon' });
    task.status = outcome;

    // Persist slim result entry to results_log.json BEFORE registry purge
    try {
      const AQUARIUM = require('../aquarium');
      const fsp = require('fs').promises;
      let rlog = { results: {} };
      try { rlog = JSON.parse(await fsp.readFile(AQUARIUM.RESULTS_LOG, 'utf8')); } catch {}
      rlog.results[taskId] = {
        task_id:       taskId,
        title:         task.title,
        task_type:     task.task_type || 'text',
        status:        outcome,
        result_summary: task.result_summary || closureData.summary || null,
        result_file:   task.result_file || null,
        output_preview: task.output_preview || null,
        completed_at:  now,
        assigned_name: task.assigned_name || task.assigned_to || null,
        project_name:  task.project_name || null,
        lifecycle:     task.lifecycle
      };
      await fsp.writeFile(AQUARIUM.RESULTS_LOG, JSON.stringify(rlog, null, 2), 'utf8');
    } catch (e) { log.warn(' results_log write failed:', e.message); }

    await this._writeTaskDetails(taskId, task);

    // Cascade updates (flat schema — the only schema we use now)
    await this.cascadeTaskClosure(taskId, task, outcome);

    await this.log({
      event_type: `task_${outcome}`,
      actor: { type: closureData.closed_by ? 'agent' : 'poseidon', id: closureData.closed_by || 'poseidon_main' },
      subject: { type: 'task', id: taskId },
      action: `Task ${outcome}: ${task.title}`,
      changes: [
        { file: 'PROJECTS/tasks_registry.json', task: taskId, field: 'status', to: outcome },
        { file: 'PROJECTS/tasks_registry.json', task: taskId, operation: 'chunks_replaced_with_closure_comments' }
      ]
    });

    return task;
  }

  /**
   * cascadeTaskClosure — flat task schema cascade.
   * Tasks have flat fields: task.assigned_to, task.project_id (no more nested .assignment / .context).
   *
   * Updates agent performance_summary (tasks_completed/failed/cancelled + success_rate)
   * and project metrics. Called by TaskRunner._setStatus on terminal statuses.
   */
  async cascadeTaskClosure(taskId, task, status) {
    // ── Agent performance ──────────────────────────────────────────────────
    const agentId = task.assigned_to || null;
    if (agentId && agentId !== 'poseidon_main') {
      try {
        const agentReg = await this.getAgentRegistry();
        const agent    = agentReg.agents?.[agentId];
        if (agent) {
          if (!agent.performance_summary) {
            agent.performance_summary = { tasks_completed: 0, tasks_failed: 0, tasks_cancelled: 0, success_rate: 0 };
          }
          const perf = agent.performance_summary;
          if (status === 'completed') perf.tasks_completed = (perf.tasks_completed || 0) + 1;
          else if (status === 'failed')    perf.tasks_failed    = (perf.tasks_failed    || 0) + 1;
          else if (status === 'cancelled') perf.tasks_cancelled = (perf.tasks_cancelled || 0) + 1;
          const total = (perf.tasks_completed || 0) + (perf.tasks_failed || 0) + (perf.tasks_cancelled || 0);
          perf.success_rate = total > 0 ? perf.tasks_completed / total : 0;
          await this.write('AGENTS/agent_registry.json', agentReg);
          log.info(` cascade: agent ${agentId} → completed=${perf.tasks_completed} failed=${perf.tasks_failed || 0} (this task: ${status})`);
        }
      } catch (e) { log.warn(` cascadeFlat agent update failed:`, e.message); }
    }

    // ── Project metrics ────────────────────────────────────────────────────
    const projectId = task.project_id || task.context?.project_id || null;
    if (projectId) {
      try {
        const projReg = await this.getProjectRegistry();
        const project = projReg.projects?.[projectId];
        if (project) {
          if (!project.metrics) project.metrics = { tasks_completed: 0, tasks_pending: 0, tasks_failed: 0 };
          if (status === 'completed') project.metrics.tasks_completed = (project.metrics.tasks_completed || 0) + 1;
          if (status === 'failed')    project.metrics.tasks_failed    = (project.metrics.tasks_failed    || 0) + 1;
          project.metrics.tasks_pending = Math.max(0, (project.metrics.tasks_pending || 0) - 1);
          await this.write('PROJECTS/project_registry.json', projReg);
        }
      } catch (e) { log.warn(` cascadeFlat project update failed:`, e.message); }
    }
  }

  // ==================== CHUNKED TASK EXECUTION ====================

  /**
   * Agent starts working on a task chunk.
   * Creates a chunk entry, sets task status to in_progress.
   * 
   * @param {string} taskId
   * @param {object} chunkData - { title, description, agent_id }
   * @returns {object} - { chunk_id, awaiting_approval: false }
   */
  async startTaskChunk(taskId, chunkData) {
    const registry = await this.getTasksRegistry();
    const task = registry.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (['completed', 'failed', 'cancelled'].includes(task.lifecycle.status)) {
      throw new Error(`Task ${taskId} is already ${task.lifecycle.status}`);
    }

    const now = new Date().toISOString();
    if (!task.chunks) task.chunks = [];
    const chunkId = `${taskId}_chunk_${String(task.chunks.length + 1).padStart(3, '0')}`;

    const chunk = {
      chunk_id: chunkId,
      title: chunkData.title,
      description: chunkData.description || '',
      status: 'in_progress',
      started_at: now,
      started_by: chunkData.agent_id || task.assigned_to,
      reported_at: null,
      report: null,
      approval_status: 'pending',
      approved_by: null,
      approved_at: null,
      decision_reason: null
    };
    task.chunks.push(chunk);

    // First chunk start -> mark task as in_progress
    if (task.lifecycle.status !== 'in_progress') {
      const previousStatus = task.lifecycle.status;
      task.lifecycle.status = 'in_progress';
      if (!task.lifecycle.started_at) task.lifecycle.started_at = now;
      task.lifecycle.status_history.push({
        status: 'in_progress',
        at: now,
        by: chunkData.agent_id || task.assigned_to
      });

      registry.metadata.total_queued = Math.max(0, registry.metadata.total_queued - 1);
      registry.metadata.total_active++;
    }

    await this.write('PROJECTS/tasks_registry.json', registry);

    await this.log({
      event_type: 'task_started',
      actor: { type: 'agent', id: chunkData.agent_id || task.assigned_to },
      subject: { type: 'chunk', id: chunkId },
      action: `Started chunk: ${chunkData.title}`,
      context: { task_id: taskId, chunk_id: chunkId }
    });

    return { chunk_id: chunkId, status: 'in_progress', awaiting_approval: false };
  }

  /**
   * Agent reports completion of a chunk, requests Poseidon approval to continue.
   * 
   * @param {string} taskId
   * @param {string} chunkId
   * @param {object} report - { summary, files_modified, output_tokens, notes }
   */
  async reportChunkComplete(taskId, chunkId, report) {
    const registry = await this.getTasksRegistry();
    const task = registry.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} not found`);

    const chunk = (task.chunks || []).find(c => c.chunk_id === chunkId);
    if (!chunk) throw new Error(`Chunk ${chunkId} not found in task ${taskId}`);
    if (chunk.status !== 'in_progress') {
      throw new Error(`Chunk ${chunkId} is not in progress (status: ${chunk.status})`);
    }

    const now = new Date().toISOString();
    chunk.status = 'awaiting_approval';
    chunk.reported_at = now;
    chunk.report = {
      summary: report.summary,
      files_modified: report.files_modified || [],
      files_created: report.files_created || [],
      output_tokens: report.output_tokens || 0,
      notes: report.notes || ''
    };

    // Update execution stats on task
    if (!task.execution.files_modified) task.execution.files_modified = [];
    for (const f of (report.files_modified || [])) {
      if (!task.execution.files_modified.includes(f)) task.execution.files_modified.push(f);
    }
    task.execution.output_tokens_used = (task.execution.output_tokens_used || 0) + (report.output_tokens || 0);

    await this.write('PROJECTS/tasks_registry.json', registry);

    await this.log({
      event_type: 'task_chunk_completed',
      actor: { type: 'agent', id: chunk.started_by },
      subject: { type: 'chunk', id: chunkId },
      action: `Reported chunk complete: ${chunk.title}`,
      context: { task_id: taskId, chunk_id: chunkId, summary: report.summary }
    });

    return { chunk_id: chunkId, status: 'awaiting_approval', message: 'Awaiting Poseidon approval' };
  }

  /**
   * Poseidon decides on a reported chunk.
   * 
   * @param {string} taskId
   * @param {string} chunkId
   * @param {string} decision - 'approve_continue' | 'approve_complete' | 'queue' | 'reject_retry' | 'stop_task'
   * @param {string} reason
   */
  async approveChunk(taskId, chunkId, decision, reason = '') {
    const registry = await this.getTasksRegistry();
    const task = registry.tasks[taskId];
    if (!task) throw new Error(`Task ${taskId} not found`);

    const chunk = (task.chunks || []).find(c => c.chunk_id === chunkId);
    if (!chunk) throw new Error(`Chunk ${chunkId} not found`);
    if (chunk.status !== 'awaiting_approval') {
      throw new Error(`Chunk ${chunkId} is not awaiting approval (status: ${chunk.status})`);
    }

    const now = new Date().toISOString();
    chunk.approved_at = now;
    chunk.approved_by = 'poseidon';
    chunk.decision_reason = reason;

    let logEventType = 'approval_granted';

    switch (decision) {
      case 'approve_continue':
        chunk.status = 'approved';
        chunk.approval_status = 'approved_continue';
        break;
      case 'approve_complete':
        chunk.status = 'approved';
        chunk.approval_status = 'approved_complete';
        // Auto-close the whole task
        await this.write('PROJECTS/tasks_registry.json', registry);
        await this.closeTask(taskId, 'completed', {
          summary: reason || 'Task completed successfully after final chunk approval',
          what_went_well: 'Chunks executed and approved sequentially',
          what_could_improve: '',
          lessons_for_future: '',
          closed_by: chunk.started_by,
          approved_by: 'poseidon',
          rating_by_poseidon: 5
        });
        return { chunk_id: chunkId, decision, task_closed: true };
      case 'queue':
        chunk.status = 'approved';
        chunk.approval_status = 'approved_queue';
        // Task goes back to queued state - agent should stop and wait
        task.lifecycle.status = 'queued';
        task.lifecycle.status_history.push({
          status: 'queued',
          at: now,
          by: 'poseidon',
          reason: 'queued by poseidon'
        });
        registry.metadata.total_active = Math.max(0, registry.metadata.total_active - 1);
        registry.metadata.total_queued++;
        break;
      case 'reject_retry':
        chunk.status = 'rejected';
        chunk.approval_status = 'rejected_retry';
        logEventType = 'approval_denied';
        break;
      case 'stop_task':
        chunk.status = 'approved';
        chunk.approval_status = 'task_stopped';
        logEventType = 'approval_denied';
        await this.write('PROJECTS/tasks_registry.json', registry);
        await this.closeTask(taskId, 'cancelled', {
          summary: reason || 'Task stopped by Poseidon',
          what_went_well: '',
          what_could_improve: reason,
          lessons_for_future: '',
          closed_by: 'poseidon',
          approved_by: 'poseidon',
          rating_by_poseidon: null
        });
        return { chunk_id: chunkId, decision, task_closed: true, outcome: 'cancelled' };
      default:
        throw new Error(`Unknown decision: ${decision}`);
    }

    await this.write('PROJECTS/tasks_registry.json', registry);

    await this.log({
      event_type: logEventType,
      actor: { type: 'poseidon', id: 'poseidon_main' },
      subject: { type: 'chunk', id: chunkId },
      action: `Poseidon decision on chunk: ${decision}`,
      context: { task_id: taskId, chunk_id: chunkId, decision, reason }
    });

    return { chunk_id: chunkId, decision, task_closed: false };
  }

  // ==================== LOGS ====================

  async log(event) {
    const logs = await this.read('LOGS/logs.json');
    const nextId = logs.metadata.last_entry_id + 1;
    const entry = {
      log_id: nextId,
      timestamp: new Date().toISOString(),
      severity: event.severity || 'info',
      ...event
    };
    logs.entries.push(entry);
    logs.metadata.total_entries++;
    logs.metadata.last_entry_id = nextId;
    await this.write('LOGS/logs.json', logs);
    return entry;
  }

  // ==================== STARTUP ====================

  /**
   * Poseidon wake-up sequence
   */
  async wakeUp() {
    const brain = await this.getPoseidonBrain();
    const agents = await this.getAgentRegistry();
    const projects = await this.getProjectRegistry();
    const tasks = await this.getTasksRegistry();
    const models = await this.read('MODELS/model_registry.json');

    const now = new Date().toISOString();

    // Update Poseidon state
    brain.current_state = {
      ...brain.current_state,
      active_agents_count: agents.metadata.total_active,
      sleeping_agents_count: agents.metadata.total_sleeping,
      active_projects_count: projects.metadata.total_active,
      tasks_in_progress: tasks.metadata.total_active,
      tasks_queued: tasks.metadata.total_queued,
      last_state_update_at: now
    };
    brain.identity.last_awakening_at = now;
    brain.identity.total_awakening_count++;

    await this.write('BRAIN/poseidon_brain.json', brain);

    await this.log({
      event_type: 'system_startup',
      actor: { type: 'system', id: 'poseidon_main' },
      subject: { type: 'system', id: 'wake_up' },
      action: 'Poseidon awakened',
      context: {
        active_agents: agents.metadata.total_active,
        active_projects: projects.metadata.total_active,
        pending_tasks: tasks.metadata.total_queued
      }
    });

    return {
      poseidon: brain,
      summary: {
        agents: agents.metadata,
        projects: projects.metadata,
        tasks: tasks.metadata,
        models: models.metadata
      }
    };
  }
}

module.exports = RegistryManager;
