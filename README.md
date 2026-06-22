# IAQUA — Intelligent Aquarium Orchestration System

**Local-first AI orchestration platform with pixel-art interface.**

Poseidon (master LLM orchestrator) manages a squad of autonomous AI agents (Squids) that execute tasks, write code, browse the web, generate images, and consolidate knowledge — entirely on your own hardware via GGUF models loaded with node-llama-cpp.

The interface is a living aquarium: agents swim as animated pixel-art squids, projects open as Temples, and the whole system runs in a single browser tab with no build step.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Layer — aquarium/](#2-data-layer--aquarium)
3. [server/aquarium.js — Path Registry](#3-serveraquariumjs--path-registry)
4. [server/index.js — Bootstrap & API Surface](#4-serverindexjs--bootstrap--api-surface)
5. [Server Services](#5-server-services)
6. [Server Routes](#6-server-routes)
7. [Client UI Modules](#7-client-ui-modules)
8. [Established Processes & Data Flows](#8-established-processes--data-flows)
9. [Skills Catalog](#9-skills-catalog)
10. [Agent Tool Registry](#10-agent-tool-registry)
11. [Poseidon Tool Registry (39 Chat Tools)](#11-poseidon-tool-registry-39-chat-tools)
12. [Pixel Art & Visual System](#12-pixel-art--visual-system)
13. [Installation & Running](#13-installation--running)

---

## 1. Architecture Overview

```
Browser (Vanilla JS + Canvas — no build step)
        │  HTTP REST + Server-Sent Events (SSE)
        ▼
Express 5 — server/index.js  (Node 22, port 3000)
        │
        ├── V2ModelService        GGUF model loader via node-llama-cpp v3; manages
        │                         per-model LlamaContext + ChatSession; single context
        │                         slot per model (sequences:1 for KV budget discipline)
        │
        ├── ModelBroker           One inference slot total. Priority queue (0=CHAT,
        │                         1=IMAGE, 2=AGENT, 3=POSEIDON_BG, 4=DREAM).
        │                         Serialises all generation — no concurrent LLM calls.
        │
        ├── PoseidonOrchestrator  Builds Poseidon's system prompt from soul.json,
        │                         dream_memory.json, session_state.json, temp.md and
        │                         live registry state. Exposes 39 tool functions.
        │
        ├── AgentWorker / Pool    One AgentWorker per task execution. Each worker
        │                         gets its own session, loads skills, runs tools,
        │                         writes output to project/output/ or TASKS/OUTPUT/.
        │
        ├── TaskRunner            Polls every 5 s. Picks the oldest planned task not
        │                         already running. Enforces one task per agent at a time.
        │                         Persists _done.json. MAX_RETRIES = 3.
        │
        ├── HeartbeatService      5 s tick. Reads CPU/RAM/VRAM. Triggers dream cycle
        │                         when Poseidon idle ≥ 10 min and broker free, with
        │                         ≥ 30 min cooldown between dreams.
        │
        ├── BotService            Telegram long-polling. Routes messages to Poseidon.
        │
        ├── RegistryManager       All JSON r/w with per-file Promise-chained writeLocks
        │                         + per-registry _idMutex for atomic ID generation.
        │
        └── ToolRegistry          24 tools callable by agents: filesystem, web, code
                                  execution, HuggingFace, model introspection.
```

**Stack:**

| Layer | Technology |
|---|---|
| Runtime | Node.js 22, Express 5 |
| LLM inference | node-llama-cpp v3.18.1 — GGUF (Qwen3, Mistral, DeepSeek, etc.) |
| Image generation | stable-diffusion.cpp CLI (separate binary, called via shell) |
| Voice | Speaches (Docker) — Whisper STT + Kokoro TTS via HTTP |
| Telegram | node-telegram-bot-api long-polling |
| Storage | JSON flat files in `aquarium/` — no database |
| Client | Vanilla JS + HTML5 Canvas — zero build step, zero npm on client |

---

## 2. Data Layer — aquarium/

All persistent state lives in `aquarium/`. The layout uses UPPER_CASE sub-directories (post-migration from legacy `data/` or `workspace/`).

```
aquarium/
├── BRAIN/
│   ├── poseidon_brain.json      Poseidon's identity, personality, user context
│   ├── soul.json                Stable long-term character: values, patterns,
│   │                            user preferences, skill insights. Updated by dreams.
│   ├── temp.md                  Rolling interaction log (user↔Poseidon turns).
│   │                            Appended on every chat turn. Cleared after each dream.
│   │                            Injected into system prompt on context reload so
│   │                            Poseidon can resume seamlessly after OOM reset.
│   ├── dream_memory.json        Last dream's summary + metadata (type, saved_at,
│   │                            reflection excerpt, soul_updated flag).
│   └── session_state.json       Checkpoint written on emergency session reset:
│                                turn count, context%, last user message, recovery note.
│
├── AGENTS/
│   └── agent_registry.json      All agents. Each entry contains: agent_id, display_name,
│                                status (active|sleeping), specialization, tools allowed,
│                                model_id, appearance, performance_summary, accessories.
│
├── PROJECTS/
│   ├── project_registry.json    All projects: id, name, folder, assigned_agents,
│   │                            colors (inside/outside), metrics.
│   └── <FOLDER_NAME>/           One folder per project (uppercase sanitised name)
│       ├── input/               User-uploaded reference files
│       ├── output/              Agent-written results (.md, .json, .py, ...)
│       │                        Relative timestamps shown in Temple file list.
│       └── project_memory.json  Structured memory sections: goals, progress,
│                                decisions, blockers, next_steps, references.
│
├── TASKS/
│   ├── tasks_registry.json      Flat registry: ALL active/planned/in-progress tasks.
│   │                            Completed and cancelled tasks are REMOVED from this
│   │                            file on closeTask() to keep it lean.
│   ├── results_log.json         Completed task slim records (task_id, title, status,
│   │                            result_summary, result_file, completed_at,
│   │                            assigned_name, project_name). Populated before
│   │                            purge. Read by Control Tower Results pane.
│   ├── _done.json               Persistent set of task IDs never to re-run.
│   │                            Survives server restarts (fixes ghost re-execution).
│   └── OUTPUT/                  Task output files for tasks without a project:
│                                <taskId>.md or <taskId>.json
│
├── MODELS/
│   └── model_registry.json      Imported model configs: contextLength, gpuLayers,
│                                cpuThreads, batchSize, flashAttention, useMmap,
│                                useMlock, autoUnloadIdleMinutes, display_name,
│                                model_type (text|image), runtime stats.
│
├── SKILLS/
│   ├── skills_registry.json     Auto-rebuilt at startup: positive list of skills
│   │                            present on disk (name, version, summary, triggers,
│   │                            steps_count). Deleted skills stay deleted (no re-seed).
│   └── <skill_id>.json          Individual skill files — see §9.
│
├── TOOLS/
│   └── tool_registry.json       Custom user-defined tools (supplemental to ToolRegistry).
│
├── LOGS/
│   └── logs.json                Append-only event log: event_type, actor, subject,
│                                action, severity, timestamp. Max 2000 entries (rolling).
│
└── CHANNELS/
    └── comms_config.json        Telegram token, chat_id, voice config (Speaches URL,
                                 STT model, TTS model/voice/speed, language, enabled).
```

**Key invariants:**

- `project_registry.json` uses `folder` field (uppercase sanitised project name) — never `project_id` for disk paths.
- `resolveProjectByNameOrId()` auto-repairs stale `folder` fields on access.
- Task IDs use `generateNextId()` with a per-registry `_idMutex` Promise chain — concurrent batch creation never produces duplicates. Counter persists via `last_id_used` metadata field, survives task purges.
- `write_file` tool silently redirects paths targeting `projects/.../input/` to `projects/.../output/`.

---

## 3. server/aquarium.js — Path Registry

**Single source of truth for all data paths.** All server code imports from here.

**Auto-detection order** at startup:
1. `aquarium/` — preferred (post-migration)
2. `data/` — legacy
3. `workspace/` — intermediate

Detection requires a `BRAIN/poseidon_brain.json` + at least one of `MODELS/model_registry.json` or `PROJECTS/project_registry.json` to be present (not just seeds).

**Exported constants:**

```
AQUARIUM.ROOT              — absolute path to aquarium/
AQUARIUM.MODELS            — aquarium/MODELS/
AQUARIUM.AGENTS            — aquarium/AGENTS/
AQUARIUM.PROJECTS          — aquarium/PROJECTS/
AQUARIUM.TASKS             — aquarium/TASKS/
AQUARIUM.OUTPUT            — aquarium/TASKS/OUTPUT/
AQUARIUM.SKILLS            — aquarium/SKILLS/
AQUARIUM.BRAIN             — aquarium/BRAIN/
AQUARIUM.CHANNELS          — aquarium/CHANNELS/
AQUARIUM.SOUL              — aquarium/BRAIN/soul.json
AQUARIUM.TEMP_LOG          — aquarium/BRAIN/temp.md
AQUARIUM.RESULTS_LOG       — aquarium/TASKS/results_log.json
AQUARIUM.TASKS_REGISTRY    — aquarium/TASKS/tasks_registry.json
AQUARIUM.MODEL_REGISTRY    — aquarium/MODELS/model_registry.json
AQUARIUM.POSEIDON_BRAIN    — aquarium/BRAIN/poseidon_brain.json
AQUARIUM.DREAM_MEMORY      — aquarium/BRAIN/dream_memory.json
AQUARIUM.COMMS_CONFIG      — aquarium/CHANNELS/comms_config.json
```

**Startup bootstrap sequence:**

1. `detectRoot()` — finds or creates `aquarium/`
2. `detectModelsDir()` — finds `.gguf` files in candidates
3. Creates all subdirectories (`MODELS`, `AGENTS`, `PROJECTS`, `TASKS`, `TASKS/IMAGES`, `TASKS/OUTPUT`, `LOGS`, `TOOLS`, `SKILLS`, `BRAIN`, `CHANNELS`)
4. Seeds missing files from `server/seed/` (poseidon_brain, agent_registry, project_registry, model_registry, logs, tasks_registry, comms_config, soul.json, temp.md)
5. Seeds skills from `server/skills/` — copies only if file absent on disk (never overwrites, never resurrects deleted skills)
6. Rebuilds `skills_registry.json` from all `.json` files in `SKILLS/`

---

## 4. server/index.js — Bootstrap & API Surface

**866 lines.** Entry point. Wires all services together, defines remaining API routes not handled by sub-routers.

**Service wiring order:**
```
RegistryManager → RegistryHealthCheck (background repair)
             → V2ModelService (holds ref to rm)
             → PoseidonOrchestrator (holds ref to rm + v2ModelService)
             → ModelBroker (held by V2ModelService)
             → AgentWorkerPool (holds ref to v2ModelService + rm)
             → TaskRunner (holds ref to rm + agentPool + services)
             → HeartbeatService (holds ref to rm + modelService + taskRunner)
             → BotService (holds ref to rm + v2ModelService)
```

After wiring, at startup:
- `TaskRunner.loadDone()` — restores persistent _done set
- `HeartbeatService.start()` — begins 5 s tick loop
- `BotService.start()` — begins Telegram long-polling (if token set)

**Direct routes in index.js (not sub-routers):**

| Method | Path | Description |
|---|---|---|
| POST | `/api/v2/repair` | Force-repairs all registries via RegistryHealthCheck |
| GET | `/api/v2/health` | CPU/RAM/VRAM + model status + broker state |
| POST | `/api/v2/heartbeat` | Manual heartbeat trigger (UI refresh) |
| POST | `/api/v2/poseidon/chat` | SSE streaming chat to Poseidon (builds system prompt, runs inference, appends to temp.md) |
| POST | `/api/v2/poseidon/abort` | Stop current Poseidon generation |
| GET | `/api/v2/poseidon/session-state` | Current session: turns, context%, last message |
| POST | `/api/v2/poseidon/reset-session` | Force-dispose Poseidon LLM session |
| POST | `/api/v2/poseidon/chat-active` | Signal UI open/closed (releases broker slot after 3 s grace when closed, unless generating) |
| GET | `/api/v2/voice/config` | Current Speaches config |
| PATCH | `/api/v2/voice/config` | Update Speaches config |
| POST | `/api/v2/voice/stt` | Whisper STT via Speaches (multipart WebM → text) |
| POST | `/api/v2/voice/tts` | Kokoro TTS via Speaches (text → audio/mpeg stream) |
| GET | `/api/v2/reasoning/stream` | SSE stream of Poseidon thinking chunks (Temple live panel) |
| GET | `/api/v2/projects/:id/outputs` | List output files with name, size, mtime |
| GET | `/api/v2/projects/:id/inputs` | List input files |
| POST | `/api/v2/projects/:id/inputs` | Upload file to project input/ |
| DELETE | `/api/v2/projects/:id/inputs/:filename` | Remove input file |
| GET | `/api/v2/projects/:id/inputs/:filename` | Serve input file |
| GET | `/api/v2/projects/:id/outputs/:filename` | Serve output file |
| GET | `/api/files/read` | Serve arbitrary file by absolute path |
| POST | `/api/files/browse` | Directory listing for file browser |

---

## 5. Server Services

### 5.1 RegistryManager (1543 lines)

Central data access layer. All reads and writes go through here. Never use `fs` directly from routes.

**Core I/O:**
- `read(relativePath)` — reads JSON, caches in-memory, waits for any pending write on same file, 5 retries on transient errors (ENOENT, empty file, parse fail). Path resolution via `AQUARIUM.resolve()` maps legacy paths to new layout.
- `write(relativePath, data)` — Promise-chained writeLock per file (serialises concurrent writes). Atomically updates cache. Cleans lock after settle.
- `invalidateCache(path?)` — clears cache entry (or all). Called before reads that need fresh state.
- `generateNextId(registryPath)` — per-registry `_idMutex` Promise chain. Each call `await prev` before reading, writes `last_id_used` to disk, releases mutex. Guarantees unique 4-digit IDs even under concurrent batch creation (`task_0120`, `task_0121`, ...).

**Agent management:**
- `createAgent(data)` — generates `agent_XXX` ID, creates brain file, registers, sets status=sleeping
- `wakeAgent(agentId)` — sets status=active, acquires model if needed, sets `woken_at`
- `sleepAgent(agentId)` — sets status=sleeping, logs, notifies via BotService
- `updateAgentStatus(agentId, status)` — thin wrapper, logs event
- `deleteAgent(agentId)` — removes from registry, deletes brain file

**Project management:**
- `getProjectRegistry()` / `getProject(id)` / `resolveProjectByNameOrId(nameOrId)` — resolves by both name and id, auto-repairs stale `folder` field
- `createProject(data)` — generates `proj_XXX` ID, creates `PROJECTS/<FOLDER>/input/` and `output/`, registers
- `deleteProject(id)` — removes registry entry + deletes entire project folder from disk
- `getProjectMemory(id)` / `updateProjectMemory(id, section, content, by)` — reads/writes structured memory sections

**Task management:**
- `createTask(data)` — uses `generateNextId`, writes to flat `tasks_registry.json`
- `_writeTaskDetails(taskId, task)` — writes task to registry; if status is terminal (completed/cancelled/archived), REMOVES from registry and persists slim entry to `results_log.json` before removal
- `closeTask(taskId, outcome, closureData)` — sets lifecycle fields, persists to results_log, removes from registry, calls `cascadeTaskClosure()`
- `cascadeTaskClosure(task)` — updates agent performance stats + project metrics

**Schema introspection:**
- `getFileSchema(filePath)` — introspects JSON structure, returns editable fields
- `updateField(filePath, fieldPath, newValue)` — validates against READ_ONLY_PATHS, applies deep field update with optional log

---

### 5.2 V2ModelService (1903 lines)

Manages GGUF model loading, session lifecycle, and inference.

**Model entry structure** (one per loaded model in `this.loaded` Map):
```javascript
{
  model, context, session,        // node-llama-cpp objects
  config,                         // resolved numeric config
  modelId, isLoaded,
  generating, dreaming,           // mutex flags
  sessionTurns, contextPct,
  contextUsedTokens, totalTokensGenerated,
  totalRequests, lastUsedAt,
  _abortRequested,
  _currentSequence
}
```

**Key methods:**
- `loadModel(modelId)` — reads config from registry, resolves 'auto' values (contextLength from VRAM, gpuLayers from VRAM), creates LlamaContext with `sequences:1`, creates QwenChatWrapper session (or generic ChatWrapper for non-Qwen models)
- `unloadModel(modelId)` — disposes session, context, model objects; clears from `this.loaded`
- `chat(modelId, messages, opts)` — acquires broker token at CHAT priority, creates/reuses session, streams tokens via SSE, tracks context%, appends to temp.md on every Poseidon turn
- `runAgentTask(agentId, taskId, systemPrompt, userMessage, tools)` — acquires broker at AGENT priority, runs single-turn inference with tools, returns complete response
- `triggerDream()` — see §8.5
- `getStatus()` — returns loaded_models array with context stats for Control Tower
- `_emergencyReset(entry)` — on OOM or context overflow: saves recovery note to session_state.json, disposes session, resets turn counter. Does NOT reload model — next chat call will recreate session.
- `checkTtl()` — called by HeartbeatService. Unloads models idle longer than `autoUnloadIdleMinutes`.

**Context auto-sizing:**
When `contextLength = 'auto'`, V2ModelService queries available VRAM and uses:
- GQA models (Qwen3): 38 KB/token
- Standard MHA: 60 KB/token
- Applies a 0.65 GB margin for overhead

---

### 5.3 ModelBroker (267 lines)

**One slot, one inference at a time.** All generation passes through here.

**Priority levels:**
```
CHAT (0)         — Poseidon user-facing chat, highest priority
IMAGE (1)        — image generation (needs full VRAM, evicts LLM)
AGENT (2)        — autonomous agent task execution
POSEIDON_BG (3)  — Poseidon background tasks
DREAM (4)        — metacognition cycle, lowest priority
```

**acquire(priority, ownerId, opts)** — returns a token Promise. If slot free: grants immediately. If busy: queues the request. Higher priority waiters jump ahead of lower priority ones in the queue. Dream is only granted if no other waiter exists. Hard timeout: 10 min.

**release(token)** — frees slot, dequeues and grants next highest-priority waiter.

**isDreamAllowed()** — returns true only if queue is empty and slot is free.

---

### 5.4 PoseidonOrchestrator (2283 lines)

Builds Poseidon's system prompt and defines all 39 chat-mode tools.

**buildSystemPrompt(bgMode)** assembles these sections (in order):
1. `_sectionUnrestricted()` — no-refusal declaration, AI identity
2. `_sectionAbsoluteRules(brain)` — orchestrator constraints, task decomposition rules, project delegation rules (never execute project work directly — always create tasks), clarification gate for large plans
3. `_sectionFineTuningBrief(brain)` — personality, voice, values from poseidon_brain.json
4. `checkpointSection` — last dream summary from dream_memory.json (injected if < 3 h old)
5. `sessionStateSection` — emergency reset recovery note from session_state.json
6. `tempMdSection` — last 3000 chars of temp.md (recent interaction history, injected on context reload so Poseidon resumes seamlessly)
7. `_sectionToolsPointer(brain)` — tool usage rules and skill references
8. `_sectionCurrentState(brain, agentReg, projectReg, taskReg)` — live snapshot of all agents, projects, tasks

**bgMode=true** strips verbose sections and reduces to 16 tools (saves ~1500 context tokens for background tasks).

**buildFunctions(mode)** — returns tool definitions as `defineChatSessionFunction` objects. Chat mode: 39 tools. BG mode: 16 tools.

**Private task methods:** `_createTask`, `_listTasks`, `_updateTask`, `_deleteTask`, `_assignAgent`, `_createProject`, `_archiveProject`, `_listSkills`, `_deleteSkill`, `_writeSkill`, `_updateBrainField`, `_dispatchToAgent` — all call RegistryManager methods.

---

### 5.5 TaskRunner (758 lines)

Executes planned tasks from the registry.

**tick() — called every 5 s by HeartbeatService:**
1. Returns immediately if any task is running (`this._running.size > 0`)
2. Reads full task registry
3. Filters runnable: status not terminal, not in `_running`, not in `_done`, fails < MAX_RETRIES (3), retry delay elapsed, assigned agent not already running a task
4. Sorts by `sort_order` (FIFO)
5. Picks the first runnable task
6. Sets status=in_progress, sets `started_at`
7. Adds to `_running`
8. Dispatches to `AgentWorkerPool.run(taskId, task)`
9. On completion: calls `RegistryManager.closeTask()`, saves output to project/output/ or TASKS/OUTPUT/, calls `markDeleted()` to add to _done

**_saveOutput(taskId, text):**
- If task has project: writes to `PROJECTS/<FOLDER>/output/<taskId>.md`
- Otherwise: writes to `TASKS/OUTPUT/<taskId>.<md|json>`
- `write_file` tool auto-redirects `input/` paths to `output/` for project files

**_done persistence:** Stored in `TASKS/_done.json`. Loaded at startup. Persisted after every mutation. Prevents completed tasks from re-running after server restart.

---

### 5.6 AgentWorker (477 lines)

Runs a single task for a single agent.

**run(taskId, task) flow:**
1. Load agent entry from registry
2. Load agent brain file
3. Load applicable skills (match task title/description against skill triggers)
4. Build system prompt from agent personality + skills
5. Build user message from task title + description + project context
6. Call `V2ModelService.runAgentTask()` — streams tokens
7. Write result to output file
8. Call `closeTask()` with summary

**System prompt sections for agents:** identity, specialization, role, personality traits, current task, project context, skill list with steps.

**AgentWorkerPool (417 lines):** Manages concurrent workers. Enforces the single-task-per-agent constraint already enforced by TaskRunner filter. Emits events on task start/complete/fail.

---

### 5.7 HeartbeatService (254 lines)

Runs every **5000 ms**.

**tick() actions:**
1. Read CPU/RAM/VRAM metrics (CPU via `/proc/stat` delta, RAM via `process.memoryUsage()`, VRAM via nvidia-smi or AQUARIUM files)
2. Broadcast metrics to SSE clients
3. If model overloaded: trigger `RegistryHealthCheck.repair()`
4. If Poseidon idle ≥ 10 min AND broker IDLE AND no tasks running AND cooldown ≥ 30 min: call `V2ModelService.triggerDream()`
5. Trigger `TaskRunner.tick()`

---

### 5.8 BotService (943 lines)

Telegram bot via long-polling. Routes all messages to Poseidon's streaming chat endpoint. Sends responses back to the configured `chat_id`. Respects `enabled` flag in comms_config.json.

---

### 5.9 RegistryHealthCheck (292 lines)

Background repair: validates structure of all registries, heals missing fields, removes orphaned entries, patches corrupted JSON. Called on startup and on overload events.

---

### 5.10 ToolRegistry (658 lines)

Registers 24 tools available to **agents** (not Poseidon — Poseidon has its own 39 tools via PoseidonOrchestrator):

| Tool | Description |
|---|---|
| `read_file` | Read file by path, returns content string |
| `write_file` | Write file; auto-redirects project `input/` → `output/` |
| `list_files` | List directory contents |
| `delete_file` | Delete file from disk |
| `web_search` | DuckDuckGo search, returns top results |
| `web_fetch` | Fetch URL, returns page text |
| `calculator` | Evaluate math expression (mathjs) |
| `get_datetime` | Current ISO timestamp + timezone |
| `json_parse` | Parse JSON string |
| `json_stringify` | Stringify with optional indent |
| `create_directory` | mkdir -p |
| `directory_tree` | Recursive tree listing |
| `search_files` | Grep-style content search in directory |
| `get_file_info` | stat() — size, mtime, type |
| `move_file` | Rename/move file |
| `run_javascript` | Execute JS in Node.js sandbox (60 s max) |
| `run_bash` | Execute shell command on machine (120 s max, cwd configurable) |
| `read_media_file` | Read image/audio as base64 |
| `hf_search_models` | Search HuggingFace model hub |
| `hf_generate` | Run HuggingFace Inference API |
| `hf_generate_code` | HF code generation |
| `scan_local_models` | List all .gguf files in MODELS/ |
| `find_local_model` | Find model by name pattern |
| `get_model_stats` | Get runtime stats for a loaded model |

---

### 5.11 Other Services

**LocalModelScanner (325 lines):** Scans MODELS_DIR for `.gguf` files, validates magic bytes, extracts metadata, matches against registry.

**ModelDownloader (192 lines):** Downloads models from HuggingFace Hub with progress tracking. Writes to MODELS/ directory.

**ImageGenerationService (289 lines):** Calls stable-diffusion.cpp CLI with prompt/negative/steps/cfg params. Saves PNG to TASKS/OUTPUT/.

**HuggingFaceInference (336 lines):** HTTP client for HF Inference API — text generation, code generation, embeddings.

**FilesystemTools (513 lines):** Implements `run_javascript` sandbox (temp file + `node` subprocess). Implements `read_media_file` base64 encoder.

**FilesystemBrowser (154 lines):** Directory listing with file type detection, size, used by model file browser in UI.

**OrchestratorTools (619 lines):** Standalone tool handlers for GitHub integration (status, commit, push), web operations (search, fetch, save), and direct file manipulation called by Poseidon tools.

---

## 6. Server Routes

### 6.1 registryRoutes.js (615 lines) — `/api/v2`

| Method | Path | Description |
|---|---|---|
| POST | `/poseidon/wake` | Wake Poseidon (sets model, loads if needed) |
| GET | `/agents` | List all agents |
| GET | `/agents/:id` | Single agent with brain |
| POST | `/agents` | Create agent |
| PATCH | `/agents/:id` | Update agent field |
| DELETE | `/agents/:id` | Delete agent + brain file |
| POST | `/agents/:id/wake` | Wake agent |
| POST | `/agents/:id/sleep` | Sleep agent |
| POST | `/agents/:id/run` | SSE: run a task message through agent |
| GET | `/projects` | List all projects |
| POST | `/projects` | Create project (generates folder on disk) |
| DELETE | `/projects/:id` | Delete project + folder from disk |
| GET | `/tasks` | Full task registry |
| GET | `/tasks/results` | Results log (completed tasks) |
| DELETE | `/tasks/results/:id` | Dismiss result from log |
| GET | `/tasks/:id/result` | Serve task result file |
| DELETE | `/tasks/:id` | Delete task + output files + results_log entry |
| GET | `/skills` | List skills |
| GET | `/skills/:id` | Single skill |
| PUT | `/skills/:id` | Create/update skill (rebuilds registry) |
| DELETE | `/skills/:id` | Delete skill + seed file + rebuild registry |
| GET | `/tasks/:id/stream` | SSE: stream live output from running agent task |

### 6.2 modelRoutes.js (569 lines) — `/api/v2/models`

| Method | Path | Description |
|---|---|---|
| GET | `/status` | All loaded models + broker state + poseidon_model_id |
| GET | `/library` | Full model library (imported + unimported .gguf files) including display_name |
| POST | `/import` | Import a .gguf file into registry |
| DELETE | `/:modelId` | Unload and remove from registry |
| PATCH | `/:modelId/params` | Update config params |
| PATCH | `/:modelId/rename` | Set display_name |
| PATCH | `/:modelId/type` | Set model_type (text|image) |
| PATCH | `/:modelId/assign-poseidon` | Assign model as Poseidon's LLM |
| POST | `/delete-file` | Delete .gguf from disk |
| POST | `/:modelId/generate-image` | Generate image via SD.cpp |
| GET | `/downloads/status` | Active download progress |
| POST | `/downloads/start` | Start HF download |
| POST | `/downloads/cancel` | Cancel download |
| GET | `/browse` | Directory tree for file browser |

### 6.3 agentRoutes.js (105 lines) — `/api/v2`

Single route: `POST /agents/:id/run` — SSE streaming of a single agent inference turn.

### 6.4 commsRoutes.js (105 lines) — `/api/v2/comms`

| Method | Path | Description |
|---|---|---|
| GET | `/config` | Full comms config |
| PATCH | `/config` | Update Telegram / voice settings |
| POST | `/:platform/test` | Send test message via bot |

---

## 7. Client UI Modules

All scripts loaded in `client/index.html`. No bundler. No npm. Pure ES5-compatible vanilla JS with some ES6+ syntax (browser executes directly).

### 7.1 aquarium.js (382 lines)

**HTML5 Canvas animation loop** for the main aquarium view.

- `init()` — creates canvas, starts `requestAnimationFrame` loop
- `_drawBackground()` — ocean gradient layers (deep blue → teal horizon)
- `_bgBubbles(W, H, t)` — 3-layer depth parallax bubble system:
  - **Far** (22 bubbles): r=0.4–1.1px, speed=slow, alpha=0.04–0.10
  - **Mid** (14 bubbles): r=1.2–2.6px, medium speed, alpha=0.10–0.22
  - **Near** (7 bubbles): r=3.0–5.5px, fast, alpha=0.18–0.35, with glow
  - 6 colour palettes: cyan, blue, violet, teal, aqua, green
  - Each bubble: radial gradient body + rim stroke + specular highlight + secondary glint
- `loadSquids()` — fetches agent registry, instantiates Squid objects, positions them
- `_drawVignette()` — subtle dark edge vignette

### 7.2 Squid.js (1007 lines)

**Animated pixel-art agent visualization.** Each agent = one Squid instance.

**Constructor initialises:**
- `stats.level` — computed from `tasks_completed` using formula: `floor(sqrt(tasks_completed)) + 1`
- `stats.tasks_to_next` — tasks needed for next level: `(next_level-1)² - current`
- `baseSize` — from `getSizeMultiplier()`: `size_scale` (0.5–2.0) or named sizes (small=0.8, medium=1.0, large=1.3)
- `accessories` — hat, glasses, eyes, outfit from agent registry

**draw(ctx) rendering pipeline:**
1. `ctx.translate(this.x, this.y)` — all drawing is body-centred
2. Bob animation: sinusoidal vertical offset
3. `drawTentacles()` — 4 tentacles, wavy with phase offsets, tip-to-body gradient
4. `drawBody()` — radial gradient sphere, outline stroke, primary/accent colours
5. Eyes rendering based on `eyes` type (round, happy, sleepy, angry, star, heart, dizzy, wink, surprised, laser)
6. SquidAccessories draw calls: hat above body, glasses at eye level, outfit on tentacles
7. Name tag with level indicator
8. Glow pulse (sinusoidal shadowBlur)
9. Sleep animation: Zzz particles when status=sleeping
10. Confetti particles on level-up

**Interaction states:** hovering (scale up), dragging (offset position), double-click (celebrate confetti), sleeping (Zzz particles).

**Level-up system:** Each completed task increments `tasks_completed`. Level formula ensures increasing task requirements: Lv2=1 task, Lv3=4, Lv4=9, Lv5=16, etc.

### 7.3 SquidAccessories.js (685 lines)

Draws pixel-art accessories on a squid's canvas context, pre-translated to body centre.

**All drawing methods receive `ctx` (translated to body centre) and `size` (body diameter in px):**

| Category | Items |
|---|---|
| Hats (13) | top_hat, cap, crown, beanie, pirate, wizard_hat, headphones, beret, halo, antenna, devil_horns, ninja_mask, sombrero |
| Glasses (7) | round, sunglasses, monocle, vr, pixel_glasses, 3d_glasses, eyepatch |
| Eyes (10) | round, happy, sleepy, angry, star, heart, dizzy, wink, surprised, laser |
| Outfit (8) | scarf, tie, cape, lab_coat, armor, hoodie, kimono, cloak |

Note: "outfit" items are drawn at tentacle tips (all 4), not on the body.

Internal helpers: `_r(ctx, x, y, w, h, fill, c)` — fills a rectangle at grid-coordinate (x,y) with cell size `c`. `_rb(ctx, ...)` — rounded rectangle variant.

### 7.4 SquidInteractionSystem.js (854 lines) / SquidInteractions.js (315 lines)

**Mouse and touch event handling** for the aquarium canvas.

- Hit-testing squids by distance to body centre
- Single-click: show agent info card
- Double-click: confetti celebration
- Drag: reposition squid (updates this.x, this.y)
- Hover: highlight + scale
- Right-click: context menu (wake/sleep/edit/assign task)

### 7.5 PixelIcons.js (634 lines)

**SVG pixel-art icon library.** All icons are 16×16 grids defined as arrays of `"paletteIdx x y w h"` rectangle strings.

**render(name, opts)** — returns an SVG DOM element.
**inline(name, size)** — returns an SVG HTML string for embedding in innerHTML.
**replaceTags(el)** — replaces `[TAG]` text nodes with icon SVGs.

**Icon catalog (38 icons):** squid, temple, poseidon, system, cpu, stats, tasks, target, config, plus, brain, logs, team, models, data, ocean, launch, ok, error, info, create, mouse, interact, clean, text_model, vlm, tools, think, code_model, embed, math_model, image_model, bolt, moon, and more.

**TAG_MAP:** `[SQUID]` → squid, `[TEMPLE]` → temple, `[BRAIN]` → brain, `[BOLT]` → bolt, `[MOON]` → moon, etc.

### 7.6 PoseidonChat.js (1187 lines)

**Poseidon chat modal UI** — full overlay chat interface.

**Layout:** modal overlay covers aquarium exactly (tracks `aquarium-wrapper` bounds via `ResizeObserver`). Positioned dynamically: `left/top/width/bottom` set from `aquarium-wrapper.getBoundingClientRect()`. Updates on control-tower resize or window resize.

**_syncOverlayBounds():** measures `aquarium-wrapper` bounding rect each time modal opens and on resize events. Updates inline styles — adapts dynamically to control tower width changes.

**Message rendering:** Poseidon's responses rendered with inline markdown (bold, italic, code, links, blockquotes). Tool calls displayed as expandable blocks with full arg key:value pairs (200-char truncation per value) and result summaries (400-char truncation).

**Tool call display (`_addToolCall` / `_resolveToolCall`):**
- Pending: yellow border card, tool name + full args block
- Resolved: green (ok) or red (fail) border, status icon + summary + timing (ms)

**Status bar:** shows "Connecting…", "Loading model into VRAM…", "Still loading — large model…", elapsed time.

**Send button:** dark gradient background (#1a3a6a → #0f2340), cyan glowing arrow, hidden during generation (STOP button takes over). Stream continues in background if modal closed mid-generation.

**Voice settings panel:** accessible via 🎙 Voice button in header. Configures Speaches URL, STT model, TTS model, voice, speed, language. Enable/disable toggle persisted to comms_config.json.

**Model tag:** shows `display_name` from model library (fetched from `/models/library`) — not the raw file ID.

### 7.7 TempleInterior.js (2045 lines)

**Project workspace overlay** — opens when a project card is clicked/entered.

**Layout (3-column flex):**

```
┌──────────────┬──────────────────────────┬──────────────┐
│ LEFT         │ CENTER                   │ RIGHT        │
│              │                          │              │
│ FILES tab    │ Tab bar: [file1] [file2] │ KANBAN tab   │
│  INPUT/      │ File toolbar: fname SAVE │              │
│  OUTPUT/     │              CLOSE ALL   │ TODO │ PROG  │
│              ├──────────────────────────│ DONE columns │
│ POSEIDON     │ CONTENT AREA (flex:1)    │              │
│ INSTRUCTIONS │  • Reasoning panel       │ Tasks by     │
│  chat box    │    (always streaming,    │ lifecycle    │
│              │    z-index:1 behind)     │ status       │
│ AGENTS       │  • Editor overlay        │              │
│  pixel squid │    (z-index:2, code      │              │
│  animations  │    files: IDE dark bg,   │              │
│              │    .md: preview iframe)  │              │
└──────────────┴──────────────────────────┴──────────────┘
```

**Center panel (IDE):**
- Always streams reasoning (auto-started, no toggle)
- File tabs: single-click to open, middle-click or × to close, CLOSE ALL button
- **Markdown (.md):** full-width rendered preview iframe — custom HTML renderer (no external deps)
- **HTML (.html):** live preview in iframe
- **Code (.py/.js/.ts/etc.):** textarea with dark IDE theme (`background:#1e2127`, `color:#abb2bf`, JetBrains Mono font, blue left border), via CSS `data-lang` attribute selectors
- **JSON:** yellow-on-dark theme (`#e6db74` on `#1a1a2e`)
- Single click opens a file (async load → `_ideActivate()` called after fetch)

**Left panel:**
- FILES tab: input files list + output files list with relative timestamps ("2h ago", "45m ago")
- MEMORY tab: project memory sections viewer
- Poseidon Instructions chatbox: sends to `/api/v2/poseidon/chat` SSE, streams response token-by-token
- Agents section: compact animated squid renderings, ASSIGN AGENT button

**Right panel (Kanban):**
- Three columns: TODO / PROGRESS / DONE
- Task cards with title, agent badge, status indicator
- Cards clickable for task detail modal

**Inside color theming (`_applyTempleColor`):**
- Applies solid `#020810` base (prevents aquarium bleed-through)
- Tints left panel, right panel, tabbar, header, chatbox with the project's `inside` colour
- Sets glow on active tabs, section headers, LIVE button border

### 7.8 ModelLoader.js (1546 lines)

**Model library modal.** Three tabs: Library, Browse Files, Download HF.

**Library tab:**
- Cards show `display_name` (or filename if no rename), capability badges (auto-detected from filename heuristics), params as key=value pill badges (CTX / GPU LAYERS / THREADS / BATCH / TTL / FLASH / MMAP / MLOCK), runtime stats when loaded
- Capability detection: TEXT, VLM, TOOLS, THINK, CODE, EMBED, MATH, IMAGE badges with pixel icons
- Actions: USE AS POSEIDON, EDIT PARAMS, RENAME (SquidModal.prompt), → IMAGE MODEL / → TEXT MODEL toggle, REMOVE

**HuggingFace tab:**
- Search HF hub, display results with capability badges (same pixel icon system)
- Select file to download, track progress via polling

**Browse Files tab:**
- Directory browser starting from MODELS/, file size display, IMPORT button

### 7.9 TaskQueueUI.js (842 lines)

**Control Tower task management panes.** Two-pane resizable layout.

**Queue pane:** Active tasks sorted by sort_order. Shows task title, type badge (project name or type), agent, status indicator, elapsed timer for in-progress tasks. Delete button per task.

**Results pane:** Reads from `results_log.json` (completed tasks purged from main registry). Handles flat structure (status/completed_at/assigned_name at root level). ✓/✗ icon, agent, relative timestamp, 120-char summary. Click to open full result modal (loads file content from disk). Dismiss (✕) calls `DELETE /tasks/results/:id` to remove from log.

**Image tasks:** Pinned at top of results with thumbnail. Regular tasks: list items.

### 7.10 ControlTowerLive.js (182 lines)

**Live metrics panel** in the right-side Control Tower.

- **Resources section:** CPU%, RAM%, VRAM% progress bars (colour-coded: green < 60%, yellow < 85%, red ≥ 85%)
- **Model section:** Poseidon's assigned model display_name + LOADED/NOT LOADED status + context bar (used/total tokens with %, fill colour by usage level, turn count, tokens generated — zeros hidden before first turn)
- **Squad section:** ACT (green, active agent count) + ZZZ (blue, sleeping count) in monospace
- Polls `/api/v2/health` every 5 s, falls back gracefully on error

### 7.11 ProjectsPanel.js (369 lines)

**Right-side projects list.** Shows all projects as cards with name, agent count, task count, custom inside/outside colours. Clicking a project enters the Temple. `+ NEW PROJECT` button at top.

### 7.12 AgentForm.js (927 lines)

**Agent creation/editing modal.** Multi-tab form.

**IDENTITY tab:** display_name, specialization, role description, personality traits.

**APPEARANCE tab:**
- Color pickers (primary, accent), size scale slider
- Live preview canvas (200×200, `baseSize=0.36`) — renders full squid with current accessories, name label at bottom, grid background
- Accessory pickers (Hat×13, Glasses×7, Eyes×10, Outfit×8) — tile canvases (60×60) draw **only the accessory** using `SquidAccessories.drawHat/drawGlasses/drawEyes/drawOutfit` directly (no body/tentacles), centred on canvas

**TOOLS tab:** Grid of all 24 agent tools organised by category. Category header shows pixel icon + count. Enable/disable toggle per tool.

**ADVANCED tab:** Model assignment, context budget, custom system prompt additions.

### 7.13 Other Client Modules

| File | Lines | Purpose |
|---|---|---|
| `ui.js` | 569 | Event log rendering, live monitor panel wiring, log event → pixel icon mapping (29 event types) |
| `api_v2.js` | 68 | `window.ApiV2` — `_fetch()` wrapper (Content-Type: application/json, throws on `!data.success`), agents/projects/tasks/models namespaced methods |
| `api.js` | — | Legacy v1 API client (deprecated, kept for compatibility) |
| `SquidModal.js` | 86 | `await SquidModal.alert(msg)`, `confirm(msg)`, `prompt(title, placeholder, default)` — styled overlays with `stopPropagation` on all mouse events to prevent parent modal close |
| `Poseidon.js` | 296 | Poseidon avatar in the aquarium canvas — animated trident wielder, larger than agent squids |
| `CommsPanel.js` | 404 | Telegram + voice settings UI; tests connection; shows last N messages |
| `SkillsPanel.js` | 207 | Skills list modal; view/edit/delete skills; create new skill |
| `Scheduler.js` | 234 | Task scheduling UI; cron-like future task scheduling |
| `EditorBrowser.js` | 161 | General-purpose file editor/browser for arbitrary aquarium files |
| `JsonEditor.js` | 310 | In-line JSON editor with schema validation |
| `PanelResizer.js` | 90 | Drag-to-resize for the right-side control tower panel |
| `pixel.css` | 7522 | Single global stylesheet. Ocean colour palette CSS vars, all component styles, pixel-art rendering hints (`image-rendering: pixelated`), animations |

---

## 8. Established Processes & Data Flows

### 8.1 Startup Sequence

```
node server/index.js
  │
  ├─ 1. aquarium.js bootstrap
  │     • detectRoot() → finds or creates aquarium/
  │     • Creates all subdirectories
  │     • Seeds missing files from server/seed/
  │     • Seeds missing skills from server/skills/ (no overwrite of existing)
  │     • Rebuilds skills_registry.json
  │
  ├─ 2. Service construction
  │     RegistryManager → RegistryHealthCheck (background repair)
  │     → V2ModelService → ModelBroker
  │     → PoseidonOrchestrator
  │     → AgentWorkerPool → TaskRunner
  │     → HeartbeatService → BotService
  │
  ├─ 3. TaskRunner.loadDone()
  │     Reads TASKS/_done.json → populates in-memory _done Set
  │
  ├─ 4. HeartbeatService.start()
  │     Begins 5 s tick loop
  │
  ├─ 5. BotService.start()
  │     Begins Telegram long-polling (if token configured)
  │
  └─ 6. Express listens on port 3000
```

### 8.2 User Chat with Poseidon

```
User types message → POST /api/v2/poseidon/chat  (SSE response)
  │
  ├─ 1. Acquire ModelBroker at CHAT priority (0)
  │
  ├─ 2. PoseidonOrchestrator.buildSystemPrompt()
  │     Reads: poseidon_brain.json, soul.json, dream_memory.json,
  │            session_state.json, temp.md (last 3000 chars),
  │            agent_registry.json, project_registry.json, tasks_registry.json
  │
  ├─ 3. V2ModelService: load model if needed (lazy), create session if needed
  │
  ├─ 4. Stream tokens back to client via SSE
  │     Tool calls dispatched inline (create_task, read_project_memory, etc.)
  │
  ├─ 5. Append full exchange to BRAIN/temp.md
  │
  └─ 6. Release broker
```

### 8.3 Task Execution Flow

```
Task created (by Poseidon tool or user)
  → status: planned, written to tasks_registry.json
  │
  HeartbeatService.tick() (every 5 s)
  → TaskRunner.tick()
    ├─ Filter runnable tasks (not in _done, not in _running, agent not busy)
    ├─ Pick first by sort_order
    ├─ Set status=in_progress, update registry
    │
    AgentWorkerPool.run(taskId, task)
    ├─ 1. Load agent brain
    ├─ 2. Acquire ModelBroker at AGENT priority (2)
    ├─ 3. Match skills by trigger keywords
    ├─ 4. Build system prompt (identity + specialization + skills)
    ├─ 5. Run inference with ToolRegistry tools
    ├─ 6. Write output to project/output/<taskId>.md (or TASKS/OUTPUT/)
    │
    ├─ 7. RegistryManager.closeTask(taskId, 'completed', {...})
    │     • Appends slim entry to TASKS/results_log.json
    │     • Removes task from tasks_registry.json
    │     • Updates agent performance_summary
    │     • Updates project metrics
    │
    ├─ 8. TaskRunner.markDeleted(taskId) → adds to _done Set → persists _done.json
    │
    └─ 9. Release broker
```

### 8.4 Model Loading & Context Management

```
First chat request after server start:
  V2ModelService.loadModel(modelId)
  ├─ Read config from model_registry.json
  ├─ Resolve 'auto' contextLength from available VRAM
  │   (GQA models: 38 KB/tok, MHA: 60 KB/tok, margin: 0.65 GB)
  ├─ LlamaModel.load() → LlamaContext.create(sequences:1)
  ├─ Create QwenChatWrapper session
  └─ Register in this.loaded Map

Subsequent chat turns:
  Session persists across turns (no per-turn reload).
  contextPct tracked after each response.

Context overflow / OOM:
  _emergencyReset(entry):
  ├─ Write recovery note to BRAIN/session_state.json
  │   (turn count, context%, last user message)
  ├─ Dispose session, context, sequences
  └─ Next buildSystemPrompt() injects session_state + last 3000 chars of temp.md
     so Poseidon resumes naturally

TTL auto-unload:
  HeartbeatService → V2ModelService.checkTtl()
  If model idle > autoUnloadIdleMinutes → unloadModel()
```

### 8.5 Dream Cycle (Metacognition)

Triggered by HeartbeatService when: `idle ≥ 10 min AND broker IDLE AND cooldown ≥ 30 min`

```
V2ModelService.triggerDream()
  │
  ├─ 1. Check: temp.md not empty and not starting with <!-- marker
  │           (if empty/cleared, skip cleanly and release broker)
  │
  ├─ 2. Acquire ModelBroker at DREAM priority (4)
  │
  ├─ 3. Read BRAIN/temp.md (last 12 000 chars if very long)
  │
  ├─ 4. Read BRAIN/soul.json (current stable character)
  │
  ├─ 5. Read SKILLS/ (all skill summaries)
  │
  ├─ 6. Dispose Poseidon chat session to free sequence slot
  │
  ├─ 7. Get dream sequence from context
  │
  ├─ 8. Run LLM inference with dream protocol prompt:
  │     PHASE 1 — OBSERVE: read temp.md, note patterns
  │     PHASE 2 — REFLECT: what to update in soul.json
  │     PHASE 3 — ACT: output complete updated soul.json in ```json block
  │     PHASE 4 — SKILLS: list 0-2 SKILL_UPDATE lines
  │
  ├─ 9. Parse ```json block → write to BRAIN/soul.json
  │     (increments dream_count, sets last_updated)
  │
  ├─ 10. Parse SKILL_UPDATE lines → write up to 2 skill files
  │      (increments skill version)
  │
  ├─ 11. Clear BRAIN/temp.md (write <!-- cleared marker --> header)
  │      — done in try/catch, ALWAYS executes even on parse failure
  │      — also executed in catch block on any error (prevents infinite skip loop)
  │
  ├─ 12. Write BRAIN/dream_memory.json (summary, soul_updated flag, skills_updated count)
  │
  └─ 13. Release broker
```

### 8.6 Voice Pipeline

```
User clicks record → MediaRecorder captures WebM audio
  → POST /api/v2/voice/stt (multipart)
  → Server proxies to Speaches Whisper endpoint
  → Returns { text: "transcribed text" }
  → Inserted into Poseidon chat input

Poseidon response → POST /api/v2/voice/tts { text }
  → Server proxies to Speaches Kokoro endpoint
  → Streams audio/mpeg back
  → Browser plays via Audio element

Docker run: docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cu124
Enable: 🎙 Voice → enable checkbox → save config
```

### 8.7 Project Temple Workflow

```
User enters project temple:
  1. TempleInterior._buildShell() — creates 3-column layout
  2. _applyTempleColor() — tints all panels with project inside colour
  3. _startReasoningStream() — connects SSE to /api/v2/reasoning/stream
  4. _renderAgentsCompact() — renders assigned squids with animations
  5. _renderFiles() — loads input/output file lists with timestamps
  6. _renderKanban() — loads tasks into TODO/PROGRESS/DONE columns

Opening a file:
  Click → _openFile() → fetch file content → _ideActivate(idx)
  .md  → full-width markdown preview (custom renderer, no deps)
  .html → live iframe preview
  .py/.js/etc → IDE dark theme editor (data-lang CSS selectors)
  .json → yellow-on-dark editor

Poseidon instruction (chatbox below agent list):
  Ctrl+Enter → fetch POST /api/v2/poseidon/chat SSE
  Response streams token-by-token into chat log
```

### 8.8 Task ID Generation (Race-Safe)

```
Multiple simultaneous create_task calls (e.g., Poseidon creates 8 tasks):

Call 1: acquires _idMutex[tasks_registry] → reads last_id_used=119
        → nextNum=120 → writes last_id_used=120 → releases mutex
Call 2: awaits Call 1 completion → reads last_id_used=120
        → nextNum=121 → writes → releases
Call 3: awaits Call 2 → reads 121 → returns task_0122 ...

Result: task_0120, task_0121, task_0122, task_0123, ... (guaranteed unique)
```

---

## 9. Skills Catalog

Skills are JSON instruction sets stored in `server/skills/` (seeded once) and `aquarium/SKILLS/` (runtime, editable). Each skill has triggers (keywords that activate it), ordered steps, and a version number.

| Skill ID | Name | Purpose |
|---|---|---|
| `research_flow` | Research Flow | Web search + multi-source synthesis with citations |
| `code_edit_flow` | Code Edit Flow | Read → analyse → edit → verify code files |
| `dispatch_task` | Dispatch Task | Create and assign tasks to agents with context |
| `create_agent` | Create Agent | Full agent creation with identity, tools, and assignment |
| `manage_agents` | Manage Agents | Wake/sleep/edit/delete agents |
| `manage_projects` | Manage Projects | Create/archive/update projects and memory sections |
| `manage_tasks` | Manage Tasks | Create/update/delete/list tasks |
| `manage_skills` | Manage Skills | List/write/update/delete skills |
| `archive_project` | Archive Project | Complete project closure with memory consolidation |
| `project_clarification` | Project Clarification | Gate: ask 2–4 questions before creating tasks for large plans |
| `generate_image` | Generate Image | Stable diffusion prompt engineering + generation |
| `find_image` | Find Image | Web image search + download to project |
| `metacognition` | Metacognition | Self-reflection on quality, errors, improvement |
| `self_improve` | Self-Improve | Update own soul.json / skills based on performance |

**Skill file structure:**
```json
{
  "skill_id": "research_flow",
  "name": "Research Flow",
  "version": 1,
  "summary": "Search the web and synthesize a concise, cited answer.",
  "triggers": ["search", "find info", "research", "look up"],
  "steps": [
    { "order": 1, "action": "web_search", "params": { "query": "...", "num_results": 5 } },
    { "order": 2, "action": "web_fetch",  "params": { "url": "{{result.url}}" } },
    { "order": 3, "action": "synthesize", "params": { "format": "markdown_with_sources" } }
  ],
  "created_by": "system",
  "updated_at": "..."
}
```

Skills are loaded during agent task execution: triggers are matched against task title + description. Matching skills are injected into the agent's system prompt as step-by-step instructions.

Poseidon can write/update skills via the `write_skill` tool. Dream cycle can update up to 2 skills per night. Each update increments `version`. Manually deleted skills never re-seed on restart.

---

## 10. Agent Tool Registry

24 tools registered in `server/services/ToolRegistry.js`. Available to agents (not Poseidon — Poseidon uses its own 39 tools via PoseidonOrchestrator).

| Tool | Category | Key Detail |
|---|---|---|
| `read_file` | filesystem | Returns full file content as string |
| `write_file` | filesystem | Creates parent dirs; redirects `project/input/` → `output/` |
| `list_files` | filesystem | Returns file names in directory |
| `delete_file` | filesystem | Unlinks file |
| `create_directory` | filesystem | mkdir -p |
| `directory_tree` | filesystem | Recursive listing with type info |
| `search_files` | filesystem | grep-style search by content pattern |
| `get_file_info` | filesystem | stat(): size, mtime, type |
| `move_file` | filesystem | rename() |
| `read_media_file` | filesystem | Returns base64-encoded image/audio |
| `run_javascript` | code | Node.js subprocess sandbox, 60 s timeout |
| `run_bash` | code | Shell command, configurable cwd, 120 s max timeout |
| `web_search` | network | DuckDuckGo results |
| `web_fetch` | network | HTTP GET, returns text content |
| `calculator` | data | mathjs expression evaluator |
| `get_datetime` | information | ISO timestamp + timezone |
| `json_parse` | data | Parses JSON string → object |
| `json_stringify` | data | Stringifies with optional indent |
| `hf_search_models` | ai | Search HuggingFace model hub |
| `hf_generate` | ai | HF Inference API text generation |
| `hf_generate_code` | ai | HF code generation endpoint |
| `scan_local_models` | ai | List all .gguf in MODELS/ |
| `find_local_model` | ai | Match model by name pattern |
| `get_model_stats` | ai | Runtime stats for loaded model |

---

## 11. Poseidon Tool Registry (39 Chat Tools)

Defined in `PoseidonOrchestrator.buildFunctions()`. These are the tools Poseidon can call during user chat or BG tasks.

| Tool | Purpose |
|---|---|
| `create_agent` | Create new agent with full config |
| `delete_agent` | Remove agent |
| `list_agents` | Get all agents with status |
| `update_agent_field` | Update specific agent field |
| `create_project` | Create project (folder + registry) |
| `archive_project` | Archive project |
| `delete_project` | Delete project + disk folder |
| `list_projects` | All projects |
| `create_task` | Create task (uses mutex-safe generateNextId) |
| `list_tasks` | Filter by status/project/agent |
| `update_task` | Modify task fields |
| `delete_task` | Remove task |
| `assign_agent` | Assign agent to project |
| `unassign_agent` | Remove agent from project |
| `update_project` | Update project metadata |
| `update_project_memory` | Write to specific memory section |
| `read_project_memory` | Read project memory section |
| `list_skills` | List all skills |
| `delete_skill` | Remove skill |
| `get_logs` | Recent system event logs |
| `log_decision` | Append a decision to logs |
| `get_system_state` | Full snapshot of system state |
| `read_file` | Read file from disk |
| `write_file` | Write file to disk |
| `list_files` | List directory |
| `web_search` | DuckDuckGo search |
| `web_fetch` | Fetch URL content |
| `fetch_and_save` | Fetch URL + save to project output |
| `fetch_image_url` | Download image by URL |
| `edit_file` | Line-range edit of existing file |
| `github_status` | Git status of repo |
| `github_commit` | Stage, commit, push changes |
| `update_user_context` | Update persistent_context in brain |
| `write_skill` | Create/update a skill file |
| `update_brain_field` | Modify specific poseidon_brain.json field |
| `read_my_brain` | Read brain sections (tasks/projects/agents/skills/soul) |
| `list_models` | All available models |
| `generate_image` | Run stable-diffusion.cpp |
| `dispatch_to_agent` | Create + assign task in one call |

**BG mode (16 tools, used for background tasks):** create_task, list_tasks, update_task, assign_agent, read_project_memory, update_project_memory, read_file, write_file, list_files, web_search, web_fetch, fetch_and_save, log_decision, write_skill, read_my_brain, generate_image.

---

## 12. Pixel Art & Visual System

### Colour Palette (CSS variables in pixel.css)

```css
--ocean-deep:   #020810   /* deepest background */
--ocean-mid:    #060f1e   /* mid-depth */
--ui-accent:    #4facfe   /* primary cyan accent */
--success:      #06ffa5   /* green */
--danger:       #ef4444   /* red */
--border:       #1e3a5f   /* panel borders */
--text-primary: #e2e8f0
--text-secondary: #94a3b8
```

### Typography
- **Headers:** `'Press Start 2P'` — retro pixel font (Google Fonts)
- **Code/monospace:** `'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New'`
- **UI labels:** `'Courier New', monospace` — uppercase letter-spacing

### Rendering
All canvas graphics use `ctx.imageSmoothingEnabled = false` for crisp pixel art. SVG icons use `shape-rendering="crispEdges"`.

### Squids in the Aquarium
- Squids bob sinusoidally (random phase offset per squid)
- Sleep Zzz particles float upward
- Glow pulse (shadowBlur sinusoidal)
- Confetti on level-up (coloured rectangles with gravity + fade)
- Drag with mouse to reposition
- Right-click context menu for agent actions

---

## 13. Installation & Running

### Requirements
- Node.js 22+
- A GGUF model file (Qwen3, Mistral, DeepSeek, etc.)
- GPU recommended (VRAM ≥ 6 GB for 9B models at Q4)

### Quick Start

```bash
git clone https://github.com/Richie6988/squidmind
cd squidmind
npm install
npm start
# → http://localhost:3000
```

### First-run setup

1. Open http://localhost:3000
2. Click **MODELS** → Browse Files or Download HF → import a .gguf model
3. In the model card, click **USE AS POSEIDON** to assign it as the master LLM
4. Click the trident ⬡ avatar or the POSEIDON button to open the chat
5. Click **+ NEW AGENT** to create your first agent with tools and appearance

### Voice (Optional — Speaches)

```bash
docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cu124
```
Then in Poseidon chat → 🎙 Voice → enable → set URL to `http://localhost:8000` → save.

### Telegram Bot (Optional)

1. Create a bot via @BotFather → get token
2. In IAQUA → COMMS → enter token + your chat ID → enable → save

### Rebuild llama.cpp native bindings (after Node upgrade)

```bash
npm run rebuild-llama
# or: bash scripts/rebuild-llama.sh
```

### Migrate from legacy data/ layout

```bash
node migrate_aquarium.js
```

---

## Repository Map

```
squidmind/
├── README.md                         This file
├── package.json                      Dependencies + scripts
├── migrate_aquarium.js               One-time migration: data/ → aquarium/
│
├── server/
│   ├── index.js                      Express app, bootstrap, API routes
│   ├── aquarium.js                   All data paths (single source of truth)
│   │
│   ├── routes/
│   │   ├── registryRoutes.js         /api/v2 registry CRUD (agents, projects, tasks, skills)
│   │   ├── modelRoutes.js            /api/v2/models (library, import, rename, download)
│   │   ├── agentRoutes.js            /api/v2/agents/:id/run (SSE agent inference)
│   │   └── commsRoutes.js            /api/v2/comms (Telegram + voice config)
│   │
│   ├── services/
│   │   ├── V2ModelService.js         GGUF loading, sessions, streaming, dream cycle
│   │   ├── ModelBroker.js            Single-slot priority queue (CHAT→IMAGE→AGENT→BG→DREAM)
│   │   ├── PoseidonOrchestrator.js   System prompt builder + 39 Poseidon tools
│   │   ├── RegistryManager.js        JSON r/w with write-locks + ID mutex
│   │   ├── TaskRunner.js             5s tick → dispatches planned tasks
│   │   ├── AgentWorker.js            Per-task agent inference runner
│   │   ├── HeartbeatService.js       5s health loop, dream trigger, TTL
│   │   ├── BotService.js             Telegram long-polling
│   │   ├── ToolRegistry.js           24 agent tools
│   │   ├── OrchestratorTools.js      Poseidon tool implementations (GitHub, web, files)
│   │   ├── LocalModelScanner.js      .gguf file discovery + validation
│   │   ├── ModelDownloader.js        HuggingFace download with progress
│   │   ├── ImageGenerationService.js stable-diffusion.cpp CLI wrapper
│   │   ├── HuggingFaceInference.js   HF Inference API client
│   │   ├── FilesystemTools.js        JS sandbox + media reader
│   │   ├── FilesystemBrowser.js      Directory listing for UI file browser
│   │   └── RegistryHealthCheck.js    Registry integrity repair
│   │
│   ├── seed/                         Initial data files copied once at startup
│   │   ├── poseidon_brain.json
│   │   ├── soul.json
│   │   ├── agent_registry.json
│   │   ├── project_registry.json
│   │   ├── model_registry.json
│   │   ├── tasks_registry.json
│   │   ├── logs.json
│   │   ├── comms_config.json
│   │   ├── tool_registry.json
│   │   └── temp.md
│   │
│   ├── skills/                       Skill definitions (seeded once, editable at runtime)
│   │   ├── research_flow.json
│   │   ├── code_edit_flow.json
│   │   ├── dispatch_task.json
│   │   ├── create_agent.json
│   │   ├── manage_agents.json
│   │   ├── manage_projects.json
│   │   ├── manage_tasks.json
│   │   ├── manage_skills.json
│   │   ├── archive_project.json
│   │   ├── project_clarification.json
│   │   ├── generate_image.json
│   │   ├── find_image.json
│   │   ├── metacognition.json
│   │   └── self_improve.json
│   │
│   ├── utils/
│   │   └── idGenerator.js            Legacy ID utility (superceded by RegistryManager)
│   │
│   └── models/
│       └── Agent.js                  Agent data model class
│
├── client/
│   ├── index.html                    Single-page app shell, all script tags
│   ├── styles/
│   │   └── pixel.css                 7522-line unified stylesheet
│   └── scripts/
│       ├── aquarium.js               Canvas animation loop + bubble system
│       ├── Squid.js                  Agent pixel-art avatar (levelling, accessories, physics)
│       ├── SquidAccessories.js       Hat/glasses/eyes/outfit drawing (33 items, 4 categories)
│       ├── SquidInteractionSystem.js Mouse/touch handling for canvas squids
│       ├── SquidInteractions.js      High-level interaction handlers (click, drag, context menu)
│       ├── PixelIcons.js             38-icon SVG pixel-art library
│       ├── SquidModal.js             alert/confirm/prompt styled overlays
│       ├── PoseidonChat.js           Poseidon chat modal (SSE, tool display, voice, overlay sync)
│       ├── TempleInterior.js         Project workspace (IDE, kanban, file manager, reasoning)
│       ├── ModelLoader.js            Model library modal (import, rename, capabilities)
│       ├── TaskQueueUI.js            Control Tower task queue + results pane
│       ├── ControlTowerLive.js       Live metrics (CPU/RAM/VRAM, model, squad stats)
│       ├── ProjectsPanel.js          Projects list sidebar
│       ├── AgentForm.js              Agent create/edit form (appearance, tools, identity)
│       ├── CommsPanel.js             Telegram + voice config UI
│       ├── SkillsPanel.js            Skills manager
│       ├── Scheduler.js              Task scheduling UI
│       ├── EditorBrowser.js          General file editor
│       ├── JsonEditor.js             In-line JSON editor
│       ├── PanelResizer.js           Right panel drag-to-resize
│       ├── Poseidon.js               Poseidon avatar canvas animation
│       ├── ui.js                     Event log, live monitor wiring, icon mappings
│       ├── api_v2.js                 ApiV2 HTTP client wrapper
│       └── api.js                    Legacy v1 client (kept for compatibility)
│
├── docs/
│   ├── DATA_ARCHITECTURE.md
│   ├── JSON_ARCHITECTURE.md
│   └── WHY_THIS_ARCHITECTURE.md
│
└── aquarium/                         Runtime data root (gitignored)
    ├── BRAIN/                        poseidon_brain.json, soul.json, temp.md,
    │                                 dream_memory.json, session_state.json
    ├── AGENTS/                       agent_registry.json
    ├── PROJECTS/                     project_registry.json + per-project folders
    ├── TASKS/                        tasks_registry.json, results_log.json, _done.json
    │                                 OUTPUT/  IMAGES/
    ├── MODELS/                       model_registry.json + .gguf files (or symlinks)
    ├── SKILLS/                       skills_registry.json + individual skill files
    ├── TOOLS/                        tool_registry.json
    ├── LOGS/                         logs.json
    └── CHANNELS/                     comms_config.json
```

---

*IAQUA — Built by Richard. Stack: Node 22 + Express 5 + node-llama-cpp v3 + Vanilla JS + HTML5 Canvas.*
