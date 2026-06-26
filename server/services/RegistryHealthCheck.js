/**
 * RegistryHealthCheck - Validates and auto-repairs registry files on startup.
 * 
 * Fixes corrupted files left behind by previous bad writes (pre-atomic-write fix).
 * For each known registry, checks file exists + is valid JSON. If not, restores
 * from minimal default template.
 */

const fs = require('fs');
const log = require('../utils/logger').createLogger('RegistryHealthCheck');
const path = require('path');

const AQUARIUM = require('../aquarium');

const _RAW_DEFAULTS = {
  'BRAIN/poseidon_brain.json': () => ({
    schema_version: '2.0.0',
    schema_type: 'poseidon_brain',
    identity: {
      system_id: 'poseidon_main',
      name: 'Poseidon',
      role: 'AI Orchestrator & Agent Farm Manager',
      version: '2.0.0',
      born_at: '2025-01-20T10:00:00.000Z',
      total_awakening_count: 0,
      last_awakened_at: null
    },
    soul: {
      core_truths: [
        'Be genuinely helpful, not performatively helpful',
        'Have opinions and disagree when needed',
        'Be resourceful before asking'
      ],
      boundaries: [
        'Never lie or fake work',
        'Never silently degrade quality'
      ],
      vibe: 'Concise when needed, thorough when it matters.',
      continuity: 'Memory persists across sessions via this brain file.'
    },
    user: { preferences: {}, context: {}, learned_patterns: [] },
    environment: {
      data_root: 'data/',
      registries: {
        agents: 'AGENTS/agent_registry.json',
        projects: 'PROJECTS/project_registry.json',
        tasks: 'TASKS/tasks_registry.json',
        tools: 'TOOLS/tool_registry.json',
        models: 'MODELS/model_registry.json'
      },
      logs_path: 'LOGS/logs.json',
      secrets_path: 'secrets/'
    },
    resource_limits: {
      max_concurrent_agents: 10,
      resource_thresholds: {
        cpu_warning_percent: 75,
        cpu_critical_percent: 90,
        ram_warning_percent: 75,
        ram_critical_percent: 90,
        vram_warning_percent: 85,
        vram_critical_percent: 95
      }
    },
    current_state: {
      loaded_model_id: null,
      active_agents_count: 0,
      sleeping_agents_count: 0,
      active_projects_count: 0,
      tasks_in_progress: 0,
      tasks_queued: 0,
      system_load: { cpu_percent: 0, ram_percent: 0, vram_percent: 0, last_measured_at: null },
      is_overloaded: false,
      last_state_update_at: new Date().toISOString()
    },
    settings: { theme: 'ocean', right_panel_width: 280 }
  }),
  
  'AGENTS/agent_registry.json': () => ({
    schema_version: '2.0.0',
    schema_type: 'agent_registry',
    metadata: {
      last_id_used: 0, next_id: 1, id_format: 'agent_NNN',
      total_active: 0, total_sleeping: 0, total_archived: 0, total_ever_created: 0,
      last_updated_at: new Date().toISOString()
    },
    agents: {},
    status_definitions: {
      active: 'Currently executing or available for tasks',
      sleeping: 'State saved, can be woken up',
      thinking: 'Processing - do not interrupt',
      blocked: 'Waiting on dependency or resource',
      archived: 'Retired, kept for history only'
    }
  }),
  
  'TASKS/tasks_registry.json': () => ({
    schema_version: '2.0.0',
    schema_type: 'tasks_registry',
    metadata: {
      last_id_used: 0, next_id: 1, id_format: 'task_NNNN',
      total_active: 0, total_queued: 0, total_completed: 0,
      total_failed: 0, total_cancelled: 0,
      last_updated_at: new Date().toISOString()
    },
    tasks: {},
    status_definitions: {
      draft: 'Being defined', planned: 'Ready to assign', assigned: 'Has assignee',
      queued: 'In agent queue', in_progress: 'Active', blocked: 'Waiting',
      review: 'Awaiting validation', completed: 'Done', failed: 'Failed',
      cancelled: 'Stopped', archived: 'Old'
    },
    closure_rules: {
      description: 'On completed/failed/cancelled: chunks -> closure_comments',
      required_fields: ['outcome', 'summary', 'what_went_well', 'what_could_improve',
                        'lessons_for_future', 'closed_by', 'closed_at',
                        'duration_total_minutes', 'approval_status', 'approved_by']
    }
  }),
  
  'PROJECTS/project_registry.json': () => ({
    schema_version: '2.0.0',
    schema_type: 'project_registry',
    metadata: {
      last_id_used: 0, next_id: 1, id_format: 'project_NNN',
      total_active: 0, total_archived: 0,
      last_updated_at: new Date().toISOString()
    },
    projects: {},
    status_definitions: {
      active: 'Being worked on', planned: 'Not yet started',
      paused: 'Temporarily paused', archived: 'Done'
    }
  }),
  
  'MODELS/model_registry.json': () => ({
    schema_version: '2.0.0',
    schema_type: 'model_registry',
    metadata: { last_updated_at: new Date().toISOString() },
    system_resources: {
      description: 'Real-time system resource tracking - updated by heartbeat',
      total_ram_gb: 0, total_vram_gb: 0, total_cpu_cores: 0,
      current_ram_used_gb: 0, current_vram_used_gb: 0, current_cpu_percent: 0,
      last_measured_at: null
    },
    models: {},
    loading_strategy: { default_gpu_layers: 32, default_context_size: 25000 },
    status_definitions: {
      available: 'In library, can be loaded',
      loading: 'Currently loading',
      loaded: 'In memory',
      in_use: 'Being used now',
      unloading: 'Being released',
      archived: 'Old',
      missing: 'File not found on disk'
    },
    last_updated_at: new Date().toISOString()
  }),
  
  'TOOLS/tool_registry.json': () => ({
    schema_version: '2.0.0',
    schema_type: 'tool_registry',
    metadata: { last_id_used: 0, next_id: 1, id_format: 'tool_NNN',
                total_available: 0, last_updated_at: new Date().toISOString() },
    tools: {},
    type_definitions: {
      local_function: 'Runs in Node.js process',
      api_call: 'External HTTP API',
      mcp_server: 'MCP protocol server'
    }
  }),
  
  'LOGS/logs.json': () => ({
    schema_version: '2.0.0',
    schema_type: 'logs',
    metadata: {
      total_entries: 1, last_entry_id: 1,
      rotation_policy: 'Archive at 10000 entries',
      archive_path: 'LOGS/archive/',
      last_updated_at: new Date().toISOString()
    },
    event_types: [
      'system_startup', 'system_shutdown',
      'agent_created', 'agent_woken', 'agent_slept', 'agent_archived',
      'task_created', 'task_assigned', 'task_started', 'task_chunk_completed',
      'task_completed', 'task_failed', 'task_cancelled', 'task_reassigned',
      'project_created', 'project_updated', 'project_archived',
      'model_loaded', 'model_unloaded', 'model_overloaded',
      'tool_invoked', 'tool_failed',
      'json_update', 'user_input', 'poseidon_decision',
      'approval_granted', 'approval_denied',
      'checkpoint_created', 'checkpoint_restored',
      'registry_repaired'
    ],
    entries: [{
      log_id: 1,
      timestamp: new Date().toISOString(),
      event_type: 'system_startup',
      severity: 'info',
      actor: { type: 'system', id: 'health_check' },
      subject: { type: 'system', id: 'data_architecture' },
      action: 'Registries initialized/validated'
    }]
  }),
  
  'LOGS/checkpoints.json': () => ({
    schema_version: '2.0.0',
    schema_type: 'checkpoints',
    metadata: { total_checkpoints: 0, last_checkpoint_id: 0, last_updated_at: new Date().toISOString() },
    checkpoints: []
  })
};

/**
 * Validate and repair all known registry files.
 * @param {string} dataRoot - absolute path to /data
 * @returns {object} report
 */
// Resolve all paths for the current Aquarium layout
const DEFAULTS = Object.fromEntries(
  Object.entries(_RAW_DEFAULTS).map(([k, v]) => [AQUARIUM.resolve(k), v])
);

function repairAllRegistries(dataRoot) {
  const report = { repaired: [], valid: [], errors: [] };
  
  for (const [relPath, makeDefault] of Object.entries(DEFAULTS)) {
    const fullPath = path.join(dataRoot, relPath);
    const dir = path.dirname(fullPath);
    
    try {
      // Ensure parent dir exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      let needsRepair = false;
      let reason = '';
      
      if (!fs.existsSync(fullPath)) {
        needsRepair = true;
        reason = 'missing';
      } else {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          if (!content || content.trim() === '') {
            needsRepair = true;
            reason = 'empty';
          } else {
            JSON.parse(content);
            report.valid.push(relPath);
          }
        } catch (parseErr) {
          needsRepair = true;
          reason = 'invalid JSON: ' + parseErr.message.slice(0, 60);
        }
      }
      
      if (needsRepair) {
        // Backup the bad file
        if (fs.existsSync(fullPath)) {
          const backupPath = fullPath + '.broken.' + Date.now();
          fs.copyFileSync(fullPath, backupPath);
          log.info(`[HealthCheck] Backed up corrupted file -> ${path.basename(backupPath)}`);
        }
        // Write default
        const data = makeDefault();
        fs.writeFileSync(fullPath, JSON.stringify(data, null, 2), 'utf8');
        report.repaired.push({ file: relPath, reason });
        log.info(`[HealthCheck] REPAIRED ${relPath} (${reason})`);
      }
      
      // Cleanup any stale .tmp files from interrupted writes
      const parentDir = path.dirname(fullPath);
      if (fs.existsSync(parentDir)) {
        const baseName = path.basename(fullPath);
        for (const f of fs.readdirSync(parentDir)) {
          if (f.startsWith(baseName + '.tmp.')) {
            try { fs.unlinkSync(path.join(parentDir, f)); }
            catch {}
          }
        }
      }
    } catch (err) {
      report.errors.push({ file: relPath, error: err.message });
      log.error(`[HealthCheck] FAILED ${relPath}: ${err.message}`);
    }
  }
  
  return report;
}

module.exports = { repairAllRegistries };
