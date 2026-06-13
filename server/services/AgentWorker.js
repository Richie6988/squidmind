/**
 * AgentWorker — runs a single agent's LLM session.
 *
 * Each worker:
 *  - Reads the agent's brain file (personality, skills, system_prompt, tools_allowed)
 *  - Builds a concrete system prompt that injects those traits
 *  - Lazily creates a LlamaChatSession using the agent's preferred model (or Poseidon's)
 *  - Exposes runTask(task, onEvent) → async generator of SSE-compatible events
 *  - Manages its own session lifecycle independently of Poseidon
 *
 * One AgentWorkerPool (singleton) tracks all live workers.
 */

'use strict';

const EventEmitter = require('events');

// ─── System prompt builder ──────────────────────────────────────────────────

function buildAgentSystemPrompt(brain, agentEntry, skillSummaries = []) {
  const id    = agentEntry.agent_id;
  const name  = brain.identity?.display_name || agentEntry.display_name || id;
  const role  = brain.identity?.role         || agentEntry.specialization || 'general agent';
  // LEAN system prompt — keeps token count low for small context windows
  const base  = brain.brain_config?.system_prompt
    || `You are ${name}, an autonomous agent specializing in ${role}.`;
  const lines = [base, ''];

  // ── Identity ──
  lines.push(`Agent ID: ${id}`);
  lines.push(`Specialization: ${role}`);
  lines.push('');

  // ── Personality traits ──
  const traits = brain.personality?.traits;
  if (traits && Object.keys(traits).length) {
    lines.push('# PERSONALITY TRAITS (0–1 scale, shapes how you work)');
    const desc = {
      curiosity:      'Explore topics deeply; ask clarifying questions',
      thoroughness:   'Double-check results; be exhaustive',
      creativity:     'Propose novel approaches',
      assertiveness:  'Make clear recommendations, hold your position',
      empathy:        'Consider human impact; be considerate in outputs',
    };
    for (const [trait, val] of Object.entries(traits)) {
      const pct  = Math.round(val * 100);
      const note = desc[trait] || trait;
      const intensity = val >= 0.8 ? 'Very high' : val >= 0.6 ? 'High' : val >= 0.4 ? 'Moderate' : 'Low';
      lines.push(`- ${trait}: ${pct}% (${intensity}) → ${note}`);
    }
    lines.push('');
  }

  // ── Communication style & mood ──
  const style = brain.personality?.communication_style;
  const mood  = brain.personality?.default_mood;
  if (style || mood) {
    lines.push('# COMMUNICATION');
    if (style) lines.push(`Communication style: ${style}`);
    if (mood)  lines.push(`Default mood: ${mood}`);
    lines.push('');
  }

  // ── Skills ──
  const skills = brain.capabilities?.skills;
  if (skills && Object.keys(skills).length) {
    lines.push('# SKILLS');
    for (const [skill, meta] of Object.entries(skills)) {
      const lvl = typeof meta === 'object' ? (meta.skill_level ?? 0.5) : meta;
      const pct = Math.round(lvl * 100);
      lines.push(`- ${skill}: ${pct}% proficiency`);
    }
    lines.push('Prioritise tasks that match your strongest skills. Be explicit when a task is outside your skill set.');
    lines.push('');
  }

  // Lean rules — 4 lines max to keep token count low
  lines.push('RULES: Use tools directly. Report failures. Update progress after each step. End with a summary.');

  return lines.join('\n');
}

// ─── Tool → defineChatSessionFunction adapter ───────────────────────────────

async function buildAgentFunctions(toolRegistry, toolsAllowed, defineChatSessionFunction, onToolEvent) {
  if (!toolsAllowed || toolsAllowed.length === 0) return undefined;

  const fns = {};
  for (const toolName of toolsAllowed) {
    const tool = toolRegistry.tools.get(toolName);
    if (!tool) continue;

    // Convert ToolRegistry parameter schema to node-llama-cpp JSON-schema format
    const properties = {};
    const required   = [];
    for (const [pName, pDef] of Object.entries(tool.parameters || {})) {
      properties[pName] = {
        type: pDef.type || 'string',
        description: pDef.description || pName,
      };
      if (pDef.enum)    properties[pName].enum = pDef.enum;
      if (pDef.required) required.push(pName);
    }

    const capturedName = toolName;
    fns[capturedName] = defineChatSessionFunction({
      description: tool.description || capturedName,
      params: { type: 'object', properties, required },
      handler: async (args) => {
        const t0 = Date.now();
        onToolEvent({ type: 'tool_call', name: capturedName, args, at: t0 });
        try {
          const result = await tool.execute(args);
          onToolEvent({ type: 'tool_result', name: capturedName, result, duration_ms: Date.now() - t0 });
          return result;
        } catch (err) {
          const errResult = { ok: false, error: err.message };
          onToolEvent({ type: 'tool_result', name: capturedName, result: errResult, duration_ms: Date.now() - t0 });
          return errResult;
        }
      }
    });
  }

  return Object.keys(fns).length ? fns : undefined;
}

// ─── AgentWorker ─────────────────────────────────────────────────────────────

class AgentWorker extends EventEmitter {
  /**
   * @param {string} agentId
   * @param {object} agentEntry  - from agent_registry.json
   * @param {object} brain       - from agents/<brain_file>.json
   * @param {object} rm          - RegistryManager
   * @param {object} modelService - V2ModelService
   * @param {object} toolRegistry - ToolRegistry singleton
   */
  constructor(agentId, agentEntry, brain, rm, modelService, toolRegistry) {
    super();
    this.agentId      = agentId;
    this.agentEntry   = agentEntry;
    this.brain        = brain;
    this.rm           = rm;
    this.modelService = modelService;
    this.toolRegistry = toolRegistry;
    this.broker       = modelService.broker;  // shared model broker

    this.session      = null;   // LlamaChatSession
    this.sequence     = null;   // context sequence
    this.generating   = false;
    this._brokerToken  = null;  // broker token held during task execution
    this.status       = 'idle'; // idle | running | error
    this._functions   = null;
    this._modelId     = null;
  }

  /** Resolve which model to use: agent's preferred → Poseidon's model */
  _resolveModelId() {
    const preferred = this.brain.brain_config?.model_binding?.preferred_model_id
                   || this.brain.brain_config?.model_binding?.current_model_id;
    // 1. Preferred model explicitly configured and loaded
    if (preferred && this.modelService.loaded.has(preferred)) return preferred;
    // 2. Poseidon's current model — only if actually in VRAM
    if (this.modelService.poseidonModelId && this.modelService.loaded.has(this.modelService.poseidonModelId)) {
      return this.modelService.poseidonModelId;
    }
    // 3. Last resort: first loaded model in the map (whatever is in memory)
    const firstLoaded = [...this.modelService.loaded.keys()][0];
    if (firstLoaded) return firstLoaded;
    // 4. Preferred model configured but not yet loaded — ensureLoaded will handle it
    if (preferred) return preferred;
    // 5. Poseidon's model not loaded — ensureLoaded will handle it
    if (this.modelService.poseidonModelId) return this.modelService.poseidonModelId;
    return null;
  }

  /** Ensure a LlamaChatSession exists for this agent */
  async _ensureSession() {
    if (this.session) return;

    const modelId = this._resolveModelId();
    if (!modelId) throw new Error(`No model available for agent ${this.agentId}`);
    this._modelId = modelId;

    if (!this.modelService.loaded.has(modelId)) {
      await this.modelService.ensureLoaded(modelId);
    }

    const entry = this.modelService.loaded.get(modelId);
    if (!entry) throw new Error(`Model ${modelId} failed to load`);

    // Wait for Poseidon (or another agent) to free the model before grabbing a sequence
    // Acquire model slot through broker — guaranteed sequential access
    const { PRIORITY } = require('./ModelBroker');
    this._brokerToken = await this.broker.acquire(
      PRIORITY.AGENT, this.agentId,
      { timeoutMs: 10 * 60 * 1000 }   // 10 min max wait
    );

    const llamaCpp = await import('node-llama-cpp');
    const { defineChatSessionFunction } = llamaCpp;

    // Slim prompt built below after skills are loaded (see systemPromptWithSkills)

    // Build tool functions from tools_allowed
    // Load aquarium skills for this agent's specialization
    let skillSummaries = [];
    try {
      const fsSync = require('fs');
      const pathM  = require('path');
      const AQUARIUM = require('../aquarium');
      if (fsSync.existsSync(AQUARIUM.SKILLS)) {
        // Keep skill list minimal — agents have small context windows
        skillSummaries = fsSync.readdirSync(AQUARIUM.SKILLS)
          .filter(f => f.endsWith('.json'))
          .slice(0, 5)  // max 5 skills, shortest format
          .map(f => {
            try {
              const s = JSON.parse(fsSync.readFileSync(pathM.join(AQUARIUM.SKILLS, f), 'utf8'));
              return `${s.skill_id}: ${s.summary || s.name}`;  // no triggers = shorter
            } catch { return null; }
          })
          .filter(Boolean);
      }
    } catch {}

    // Rebuild system prompt with skills injected
    const systemPromptWithSkills = buildAgentSystemPrompt(this.brain, this.agentEntry, skillSummaries);

    const toolsAllowed = this.brain.capabilities?.tools_allowed || [];
    const toolEvents = [];
    this._pendingToolEvents = toolEvents;
    this._functions = await buildAgentFunctions(
      this.toolRegistry,
      toolsAllowed,
      defineChatSessionFunction,
      (ev) => toolEvents.push(ev)
    );

    // Share Poseidon's loaded context rather than creating a new one.
    // Creating a second context on the same model OOMs on consumer GPUs (7-8GB VRAM).
    // We reuse entry.context and get a sequence from it. This is safe because
    // the wait-loop above ensures Poseidon is idle before we grab the sequence.
    // The agent disposes the sequence when done, NOT the context (which belongs to Poseidon).
    let sequence;
    let contextLength;
    try {
      sequence      = entry.context.getSequence();
      contextLength = entry.context.contextSize || entry.config?.contextLength || 4096;
      console.log(`[AgentWorker] Sharing Poseidon context for ${this.agentId} on ${modelId} (ctx=${contextLength})`);
    } catch (seqErr) {
      // If getSequence fails (no free slot), wait a bit and retry once
      console.warn(`[AgentWorker] getSequence failed, waiting 3s: ${seqErr.message}`);
      await new Promise(r => setTimeout(r, 3000));
      sequence      = entry.context.getSequence();
      contextLength = entry.context.contextSize || entry.config?.contextLength || 4096;
    }
    this._agentContext = null;  // we do NOT own the context — Poseidon does
    this.sequence      = sequence;
    const ctxTokens   = contextLength;
    // 20% budget for system prompt — leaves 80% for tools schema + task + reply
    const budgetChars = Math.floor(ctxTokens * 0.20) * 4;
    const trimmedPrompt = systemPromptWithSkills.length > budgetChars
      ? systemPromptWithSkills.slice(0, budgetChars) + '\n[prompt trimmed to fit context]'
      : systemPromptWithSkills;

    this.session = new llamaCpp.LlamaChatSession({
      contextSequence: sequence,
      systemPrompt:    trimmedPrompt,
      chatWrapper:     'auto',
    });

    console.log(`[AgentWorker] Session created for ${this.agentId} on model ${modelId} — ${toolsAllowed.length} tools, prompt ${Math.round(trimmedPrompt.length/4)} tok, ctx=${contextLength}`);
  }

  /**
   * Run a task message and stream events.
   * Yields objects: { type, ... } matching PoseidonChat SSE protocol.
   * Types: start, text, tool_call, tool_result, thinking_start, thinking, thinking_end, end, error
   */
  async *runTask(taskMessage) {
    if (this.generating) {
      yield { type: 'error', error: `Agent ${this.agentId} is already running a task.` };
      return;
    }
    this.generating = true;
    this.status     = 'running';

    // Update agent status in registry
    try {
      await this.rm.updateAgentStatus(this.agentId, 'active');
    } catch {}

    try {
      await this._ensureSession();
    } catch (err) {
      this.generating = false;
      this.status = 'error';
      yield { type: 'error', error: err.message };
      return;
    }

    yield { type: 'start', agent_id: this.agentId, model_id: this._modelId };

    const events = this._pendingToolEvents;
    events.length = 0; // clear stale

    const maxTokens = this.brain.brain_config?.inference_params?.max_tokens_per_response || 2048;

    // Think state machine (same as V2ModelService)
    let thinkBuf = '';
    let inThink  = false;

    const promptOpts = {
      maxTokens,
      functions: this._functions,
      onTextChunk: (chunk) => {
        let buf = thinkBuf + chunk;
        thinkBuf = '';
        inThink  = false;
        while (buf.length > 0) {
          if (inThink) {
            const close = buf.indexOf('</think>');
            if (close === -1) {
              events.push({ type: 'thinking', chunk: buf });
              thinkBuf = buf;
              buf = '';
            } else {
              events.push({ type: 'thinking', chunk: buf.slice(0, close) });
              events.push({ type: 'thinking_end' });
              inThink = false;
              buf = buf.slice(close + 8);
            }
          } else {
            const open = buf.indexOf('<think>');
            if (open === -1) {
              events.push({ type: 'text', chunk: buf });
              buf = '';
            } else if (open > 0) {
              events.push({ type: 'text', chunk: buf.slice(0, open) });
              buf = buf.slice(open);
            } else {
              events.push({ type: 'thinking_start' });
              inThink = true;
              buf = buf.slice(7);
            }
          }
        }
      }
    };

    // node-llama-cpp prompt() is not a generator — we interleave via polling
    let done    = false;
    let error   = null;
    let fullText = '';

    const promptPromise = this.session.prompt(taskMessage, promptOpts)
      .then(r => { fullText = r; done = true; })
      .catch(e => { error = e; done = true; });

    // Drain events and yield as they arrive
    while (!done) {
      await new Promise(r => setTimeout(r, 16));
      while (events.length) {
        const ev = events.shift();
        yield ev;
      }
    }
    // Drain remaining
    while (events.length) {
      yield events.shift();
    }

    if (error) {
      yield { type: 'error', error: error.message };
    } else {
      yield { type: 'end', agent_id: this.agentId };
    }

    // Update task completion in registry
    try {
      await this.rm.updateAgentStatus(this.agentId, 'sleeping');
    } catch {}

    this.generating = false;
    this.status     = 'idle';

    // Release model slot — lets next agent/task/dream proceed
    if (this._brokerToken) {
      this.broker.release(this._brokerToken);
      this._brokerToken = null;
    }
    // Null sequence so image gen eviction can't hit a dangling pointer
    this.sequence = null;
  }

  /** Dispose session — releases the sequence back to Poseidon's context pool */
  async dispose() {
    if (this._brokerToken) {
      this.broker.release(this._brokerToken);
      this._brokerToken = null;
    }
    try { await this.session?.dispose?.(); } catch {}
    // IMPORTANT: do NOT dispose this._agentContext — it belongs to Poseidon
    // Only dispose if we actually own a dedicated context (legacy path)
    if (this._agentContext) {
      try { await this._agentContext.dispose(); } catch {}
    }
    this.session       = null;
    this.sequence      = null;
    this._agentContext = null;
    this._functions    = null;
  }
}

// ─── AgentWorkerPool ─────────────────────────────────────────────────────────

class AgentWorkerPool {
  constructor(rm, modelService, toolRegistry) {
    this.rm           = rm;
    this.modelService = modelService;
    this.toolRegistry = toolRegistry;
    this._workers     = new Map(); // agentId → AgentWorker
  }

  /**
   * Get or create a worker for an agent.
   * Always re-reads the brain file so edits in AgentForm are reflected.
   */
  async getWorker(agentId) {
    // Always refresh brain so personality/skills edits take effect
    const registry = await this.rm.getAgentRegistry();
    const entry    = registry.agents?.[agentId];
    if (!entry) throw new Error(`Agent ${agentId} not found in registry`);

    const brain = await this.rm.read(`agents/${entry.brain_file}`);

    const existing = this._workers.get(agentId);

    // Never reuse a session between tasks — same context = same output
    // Each task gets a fresh LlamaChatSession (new conversation history)
    if (existing && existing.status === 'running') {
      throw new Error(`Agent ${agentId} is already running a task.`);
    }

    // Dispose any previous worker (releases sequence back to context pool)
    if (existing) await existing.dispose().catch(() => {});

    const worker = new AgentWorker(
      agentId, entry, brain,
      this.rm, this.modelService, this.toolRegistry
    );
    this._workers.set(agentId, worker);
    return worker;
  }

  /** Dispatch a task string to an agent, return async generator */
  async dispatch(agentId, taskMessage) {
    const worker = await this.getWorker(agentId);
    return worker.runTask(taskMessage);
  }

  /** Status of all workers */
  status() {
    const out = {};
    for (const [id, w] of this._workers) {
      out[id] = { status: w.status, model_id: w._modelId };
    }
    return out;
  }

  async disposeAll() {
    for (const w of this._workers.values()) await w.dispose().catch(() => {});
    this._workers.clear();
  }
}

module.exports = { AgentWorker, AgentWorkerPool, buildAgentSystemPrompt };
