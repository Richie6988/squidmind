# IAQUA — Intelligent Aquarium Orchestration System

**Local-first AI orchestration platform with pixel-art interface.**  
Poseidon (master orchestrator LLM) manages a squad of autonomous AI agents that execute tasks, write code, conduct research, generate images, and consolidate knowledge — all running locally on your GPU via GGUF models.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Layer — aquarium/](#2-data-layer--aquarium)
3. [Server — Entry Point & Bootstrap](#3-server--entry-point--bootstrap)
4. [Server Services](#4-server-services)
5. [Server Routes (API)](#5-server-routes-api)
6. [Client — UI Modules](#6-client--ui-modules)
7. [Established Processes & Flows](#7-established-processes--flows)
8. [Skills Catalog](#8-skills-catalog)
9. [Tool Registry](#9-tool-registry)
10. [Installation & Running](#10-installation--running)

---

## 1. Architecture Overview

```
Browser (Vanilla JS + Canvas)
        │  HTTP + Server-Sent Events (SSE)
        ▼
Express Server (Node 22) — server/index.js
        │
        ├── V2ModelService        loads GGUF via node-llama-cpp v3, manages sessions
        ├── ModelBroker           single inference slot, priority queue (0=CHAT…4=DREAM)
        ├── PoseidonOrchestrator  Poseidon's system prompt builder + 39 chat tools
        ├── AgentWorker(Pool)     per-agent LLM sessions, tool execution
        ├── TaskRunner            5s tick loop — dispatches planned tasks to agents
        ├── HeartbeatService      5s health checks, dream cycle trigger
        ├── BotService            Telegram bot long-polling
        ├── RegistryManager       all JSON read/write with per-file write-locks + ID mutex
        └── ToolRegistry          24 named tools available to agents
```

**Stack:**
- **Runtime:** Node 22, Express 5
- **Inference:** node-llama-cpp v3.18.1, GGUF models (Qwen3, Mistral, etc.)
- **Image generation:** stable-diffusion.cpp CLI
- **Client:** Vanilla JS, HTML5 Canvas — no frontend build step
- **Storage:** JSON flat files in `aquarium/` directory

---

## 2. Data Layer — `aquarium/`

All persistent state lives under one root directory. The path is auto-detected at startup (`server/aquarium.js`).

```
aquarium/
├── MODELS/
│   └── model_registry.json         # All imported GGUF models: id, config, runtime stats, display_name
│
├── AGENTS/
│   ├── agent_registry.json         # Index of all agents: id, status, appearance, assignments
│   └── <agent_id>.json             # Per-agent brain file (system prompt, specialization, skills)
│
├── PROJECTS/
│   ├── project_registry.json       # All projects: id, name, folder, vision, assigned_agents
│   └── <UPPERCASE_NAME>/
│       ├── input/                  # User-uploaded files (via UI drag-drop)
│       ├── output/                 # Agent-written files, task outputs (.md, .json, .py…)
│       └── project_memory.json     # Living project context: decisions, next_steps, architecture
│
├── TASKS/
│   ├── tasks_registry.json         # Flat registry — only active/planned tasks (completed purged)
│   ├── results_log.json            # Slim completed-task log: title, status, summary, mtime
│   └── OUTPUT/                     # Orphan task outputs (no project): <task_id>.md|.json
│
├── SKILLS/
│   ├── skills_registry.json        # Auto-rebuilt on startup: positive list of present skills
│   └── <skill_id>.json             # Individual skill: triggers, steps, version, summary
│
├── BRAIN/
│   ├── poseidon_brain.json         # Poseidon's full identity, rules, user profile, processes
│   ├── soul.json                   # Stable learned character: values, patterns, user prefs
│   ├── temp.md                     # Raw interaction log — every user↔Poseidon exchange appended
│   ├── dream_memory.json           # Summary of last dream cycle
│   └── session_state.json          # Checkpoint: last turn, context %, emergency notes
│
├── LOGS/
│   └── logs.json                   # Append-only system event log (created, deleted, decided…)
│
├── TOOLS/
│   └── tool_registry.json          # Tool catalog (supplementary to ToolRegistry.js)
│
└── CHANNELS/
    └── comms_config.json           # Telegram bot token, Speaches voice URL/models
```

### Key Design Rules
- **Tasks are purged from `tasks_registry.json` on completion.** Results go to `results_log.json`.
- **`skills_registry.json` is a positive list only.** Deleted skills are removed from both `aquarium/SKILLS/` and `server/skills/` (seed). Skills deleted manually never re-seed on restart.
- **`temp.md` is the short-term memory buffer.** Cleared after every dream cycle (even on error).
- **Task IDs use a per-registry mutex** (`_idMutex`) to guarantee no duplicates under concurrent creation.
- **`write_file` guards project paths:** any write to `projects/.../input/` is silently redirected to `output/`.

---

## 3. Server — Entry Point & Bootstrap

### `server/aquarium.js`
Auto-detects `aquarium/` root (searches parent directories for known folder layout). Exports the `AQUARIUM` constant with all resolved paths. On startup:
1. Creates all required directories if absent.
2. Seeds missing files from `server/seed/` (one-time copy only — never overwrites existing).
3. Seeds skills from `server/skills/` (one-time per file — never re-seeds deleted skills).
4. Rebuilds `SKILLS/skills_registry.json` from disk contents.

### `server/index.js` (866 lines)
Main Express application. Initialises all services, wires all routes, starts listening on port 3000. Key responsibilities:
- Instantiates `RegistryManager`, `V2ModelService`, `ModelBroker`, `PoseidonOrchestrator`, `AgentWorkerPool`, `TaskRunner`, `HeartbeatService`, `BotService`, `ToolRegistry`.
- Registers all API routes (see §5).
- Exposes `AgentWorkerPool` to orchestrator for `dispatch_to_agent` tool.
- Starts `TaskRunner.start()` and `HeartbeatService.start()`.
- Serves `client/` as static files.

### `server/utils/idGenerator.js`
Simple sequential ID formatter — zero-pads integers to 4 digits (`task_0001`, `agent_0002`).

### `server/models/Agent.js`
Data model class for agent entities. Defines schema defaults and validation helpers.

---

## 4. Server Services

### `V2ModelService.js` (1903 lines)
Central model management layer. The only code that directly calls node-llama-cpp.

**Responsibilities:**
- **Loading/unloading** GGUF models on demand. Tracks `loaded` Map (model → entry with session, config, stats).
- **Session management:** one `LlamaSession` per loaded model. Sessions are disposed and recreated as needed. Never reused between tasks (prevents context bleed).
- **Chat inference (`buildPoseidonChatRoute`):** SSE stream — each token yielded as `data: {text}` then `data: [DONE]`. Handles function call round-trips for Poseidon's 39 tools.
- **Agent task execution:** agents call `runAgentTask(agentId, taskId, prompt, tools)` which creates a temporary session, runs to completion, returns result text.
- **Context recovery:** when "No sequences left" error → dispose stale session → wait 400ms → retry. If still stuck → recreate context entirely.
- **TTL auto-unload:** `checkTtl()` called every heartbeat. Unloads models idle ≥ `autoUnloadIdleMinutes` (default 15).
- **`triggerDream()`:** soul consolidation cycle (see §7 — Dream Process).

**Key state per loaded model entry:**
```js
{ session, context, config, generating, dreaming,
  totalTokensGenerated, totalRequests, sessionTurns,
  contextUsedTokens, contextPct, lastUsedAt }
```

---

### `ModelBroker.js` (267 lines)
Single-slot inference serializer. At most **one LLM inference** runs at a time.

**Priority Queue (lower = higher priority):**
```
0  CHAT         — interactive Poseidon ↔ user (preempts everything)
1  AGENT        — agent task execution
2  POSEIDON_BG  — Poseidon running a background task directly
3  DREAM        — metacognition (only when queue empty + idle > threshold)
4  IMAGE        — image generation (evicts LLM from VRAM while running)
```

**API:** `acquire(priority, ownerId, {timeoutMs})` → Promise resolving to token. `release(token)` → unblocks next waiter by priority then FIFO. Watchdog timer releases expired tokens every 30s.

**Special rules:**
- `DREAM` is rejected if any other waiter is in queue.
- `IMAGE` is queued after `CHAT` but before pending `AGENT/BG` work.
- Every acquire/release logged to console with timing.

---

### `PoseidonOrchestrator.js` (2283 lines)
Poseidon's brain at runtime. Not a persistent process — instantiated once and referenced throughout server lifetime.

**`buildSystemPrompt(bgMode)`** assembles the full system prompt from sections:
1. `_sectionUnrestricted()` — operator override, content rules
2. `_sectionAbsoluteRules(brain)` — 17 absolute rules from `poseidon_brain.json`
3. `_sectionFineTuningBrief(brain)` — voice, values, task decomposition rules, **PROJECT WORK RULE** (always delegate via tasks, never execute directly), clarification gate
4. `checkpointSection` — last dream reflection or emergency reset note from `dream_memory.json`
5. `sessionStateSection` — last session turn/context% from `session_state.json`
6. `tempMdSection` — last 3000 chars of `temp.md` for context continuity after reload
7. `_sectionToolsPointer(brain)` — brief tool usage reminders
8. `_sectionCurrentState(brain, agentReg, projectReg, taskReg)` — live snapshot of agents/projects/tasks

**`buildFunctions(mode)`** returns Poseidon's callable tools:
- `chat` mode: 39 tools (all capabilities)
- `bg` mode: 16 tools (stripped of admin/meta tools to save context tokens)

**Poseidon's 39 tools (chat mode):**

| Category | Tools |
|----------|-------|
| Agents | `create_agent`, `delete_agent`, `list_agents`, `update_agent_field`, `wake_agent`, `sleep_agent`, `assign_agent`, `unassign_agent`, `dispatch_to_agent` |
| Projects | `create_project`, `archive_project`, `delete_project`, `list_projects`, `update_project`, `update_project_memory`, `read_project_memory` |
| Tasks | `create_task`, `list_tasks`, `update_task`, `delete_task` |
| Skills | `write_skill`, `list_skills`, `delete_skill` |
| Files | `read_file`, `write_file`, `list_files` |
| Brain | `read_my_brain`, `update_user_context`, `log_decision` |
| System | `get_system_state`, `get_logs` |
| Comms | `send_telegram` |
| Image | `generate_image` |
| Web | `web_search`, `web_fetch` |
| Math | `calculator` |
| Time | `get_datetime` |

**Key orchestration rules enforced by system prompt:**
- **Project work = tasks only.** When a project is mentioned, Poseidon MUST create tasks and delegate — never execute project work inline.
- **Task decomposition:** one task per item (URL, file, person). Never bundle.
- **Clarification gate:** >5 tasks or complex scope → ask 2-4 questions first.
- **Self-improvement:** after every task, check and update skills.
- **Context survival:** update `task.progress` after every step so restarts don't lose work.

---

### `RegistryManager.js` (1543 lines)
Single source of truth for all JSON file I/O. All services go through this class.

**Core I/O:**
- `read(relativePath)` — reads JSON with 5-retry resilience. Uses write-lock chain to avoid dirty reads. Cache-aware.
- `write(relativePath, data)` — atomic write via temp file + rename. Serialized per path via `writeLocks` Map.
- `generateNextId(registryPath)` — **mutex-protected** per registry path via `_idMutex` Map. Guarantees strict sequential IDs even under concurrent batch creation. Uses `last_id_used` as authoritative floor (survives task purge).

**Agent lifecycle:** `createAgent`, `wakeAgent`, `sleepAgent`, `updateAgentStatus`, `deleteAgent`, `getAgentRegistry`.

**Project lifecycle:** `getProject`, `resolveProjectByNameOrId`, `getProjectMemory`, `updateProjectMemory`, `deleteProject` (removes folder from disk).

**Task lifecycle:**
- `createTask` — writes to flat `tasks_registry.json`, no per-task folder.
- `closeTask(taskId, outcome, closureData)` — persists slim entry to `results_log.json` then purges from registry. Outcomes: `completed`, `cancelled`, `archived`.
- `_writeTaskDetails` — for `completed/cancelled/archived` statuses: **deletes from registry** (purge design). For active statuses: upserts.
- `cascadeTaskClosure` — updates agent performance stats and project metrics after task close.

**Chunk system:** `startTaskChunk`, `reportChunkComplete`, `approveChunk` — multi-step task tracking with human-in-the-loop approval gate.

**Logging:** `log(event)` — append to `LOGS/logs.json`. Structured events: `agent_created`, `task_completed`, `skill_updated`, etc.

---

### `TaskRunner.js` (758 lines)
Background tick loop that dispatches planned tasks to agents.

**Tick logic (every 5s):**
1. Read flat `tasks_registry.json`.
2. Build `agentsRunning` set from `_running` (in-memory Set of active task IDs + their assigned agent).
3. Filter `runnable` tasks: status not in TERMINAL, not already running, not in `_done`, not failed too many times, assigned agent not already busy (**one task per agent at a time**), retry delay not elapsed.
4. Sort by `sort_order` FIFO.
5. Pick first runnable task, call `_runTask(taskId)`.

**`_runTask(taskId)`:**
1. Marks task `in_progress` in registry.
2. Acquires `ModelBroker` slot at `AGENT` priority.
3. Calls `AgentWorkerPool.runAgentTask(agentId, taskId, prompt, tools)`.
4. On success: `_saveOutput(text)` → writes `.md` to `PROJECTS/<NAME>/output/` or `TASKS/OUTPUT/`.
5. Calls `RegistryManager.closeTask(taskId, 'completed', {...})`.
6. On failure: increments `_failCounts`, schedules retry after exponential backoff. After `MAX_RETRIES` (3): closes as `failed`.

**`_saveOutput`:** resolves project folder from task metadata. Writes to `project/output/<taskId>.md` (project tasks) or `TASKS/OUTPUT/<taskId>.md` (standalone). Contains guard: any path with `/input/` is silently redirected to `/output/`.

**In-memory state:** `_running` (Set), `_done` (Set — resets on restart), `_failCounts` (Map), `_retryAfter` (Map).

---

### `AgentWorker.js` (477 lines)
Executes individual agent task inference sessions.

**`AgentWorker` class:** created per task execution. Builds agent system prompt from `poseidon_brain.json` specialization + role. Runs LLM inference via `V2ModelService.runAgentTask`. Emits events for tool calls, results, errors.

**`AgentWorkerPool` class:** manages a pool of workers keyed by `agentId`. `runAgentTask(agentId, taskId, prompt, tools)` → creates `AgentWorker`, runs it, returns `{output, toolCalls}`. Exposed to Poseidon's `dispatch_to_agent` tool via `index.js`.

**`buildAgentSystemPrompt(agentEntry, brain)`:** constructs the agent's system prompt:
- Identity: display name, specialization, role, capabilities
- Project context: assigned project name, mission
- Absolute rules inherited from `poseidon_brain.json`
- Tool usage guidance (from `ToolRegistry`)
- Output format instructions

---

### `HeartbeatService.js` (254 lines)
Runs every 5000ms. Monitors system health and triggers automatic processes.

**Every tick:**
1. Calls `V2ModelService.getStatus()` to read model metrics.
2. Updates `RegistryManager` with Poseidon context stats.
3. Calls `TaskRunner.tick()` to process queued tasks.
4. **Dream trigger check:** if Poseidon model loaded AND not generating AND not dreaming AND idle ≥ `dreamIdleMinutes` (10) AND last dream > `dreamCooldownMinutes` (30) ago AND broker is IDLE → calls `V2ModelService.triggerDream()`.
5. Calls `V2ModelService.checkTtl()` to auto-unload idle models.

---

### `ToolRegistry.js` (658 lines)
Registers the 24 tools available to agents. Each tool has: `name`, `description`, `category`, `parameters` schema, `execute` async function.

**Registered tools:**

| Name | Category | Description |
|------|----------|-------------|
| `read_file` | filesystem | Read UTF-8 file content |
| `write_file` | filesystem | Write file (redirects project input/ → output/) |
| `list_files` | filesystem | List directory contents |
| `delete_file` | filesystem | Delete a file |
| `create_directory` | filesystem | mkdir -p |
| `directory_tree` | filesystem | Recursive tree listing |
| `search_files` | filesystem | Glob/keyword search |
| `get_file_info` | filesystem | stat() metadata |
| `move_file` | filesystem | Rename/move |
| `read_media_file` | filesystem | Read image/audio as base64 |
| `web_search` | network | DuckDuckGo-based search |
| `web_fetch` | network | HTTP GET, returns text |
| `calculator` | data | mathjs expression evaluator |
| `get_datetime` | information | Current ISO timestamp |
| `json_parse` | data | Parse JSON string |
| `json_stringify` | data | Stringify to JSON |
| `run_javascript` | code | Execute Node.js in sandbox (60s max) |
| `run_bash` | code | Real shell command on host machine (120s max, cwd configurable) |
| `hf_search_models` | ai | Search Hugging Face model hub |
| `hf_generate` | ai | Run HF Inference API |
| `hf_generate_code` | ai | Code generation via HF |
| `scan_local_models` | ai | List local GGUF files |
| `find_local_model` | ai | Find model by name/capability |
| `get_model_stats` | ai | Model performance stats |

---

### `OrchestratorTools.js` (619 lines)
Helper functions used by `PoseidonOrchestrator` to implement Poseidon's tool handlers. Includes the logic for `dispatch_to_agent` (finds an appropriate agent, acquires broker slot, runs `AgentWorkerPool.runAgentTask`, returns result), `web_search`, `web_fetch`, and multi-step research flows.

---

### `BotService.js` (943 lines)
Telegram bot integration via long-polling (no public webhook required).

**Process:**
1. Reads `CHANNELS/comms_config.json` for token and allowed chat IDs.
2. Starts long-poll loop (`getUpdates` with 30s timeout).
3. On message from allowed chat: routes text to Poseidon via `V2ModelService` chat pipeline (same SSE flow as browser).
4. Streams response back token by token to Telegram (edits same message).
5. Supports: `/start`, `/status`, `/tasks`, `/agents`, arbitrary natural-language messages.

Config: `telegram.enabled`, `telegram.token`, `telegram.allowed_chat_ids`.

---

### `ImageGenerationService.js` (289 lines)
Wraps `stable-diffusion.cpp` CLI binary for local image generation.

**Binary detection:** searches 8 common paths (`~/.local/bin/sd-diffusion`, `/usr/local/bin/sdcpp`, build dirs, etc.).

**`generate({modelPath, prompt, outputPath, width, height, steps, cfg, seed, negativePrompt})`:**
1. Checks binary availability.
2. Spawns `sd` CLI with all parameters.
3. Returns `{ok, outputPath, stderr}`.

Output always written to `TASKS/OUTPUT/<taskId>.png`.

---

### `LocalModelScanner.js` (325 lines)
Scans `aquarium/MODELS/` and the configured models directory for `.gguf` files. Validates magic bytes (`GGUF` = `0x47 0x47 0x55 0x46`). Returns a list with `{model_id, file_name, file_path, file_size_gb, is_valid_gguf}`. Called by model routes to populate the library.

---

### `ModelDownloader.js` (192 lines)
Downloads GGUF models from Hugging Face Hub. Streams to disk with progress tracking. Exposes download queue with cancel support. Downloads go directly to `aquarium/MODELS/`.

---

### `FilesystemTools.js` (513 lines)
Low-level file utilities. `runJavaScript(code, timeoutSeconds)` — executes in a Node.js child process sandbox with stdout capture. Used by the `run_javascript` tool.

---

### `FilesystemBrowser.js` (154 lines)
Directory listing with metadata (size, mtime, type). Used by the temple file browser and model library browser.

---

### `RegistryHealthCheck.js` (292 lines)
Validates JSON registry files for corruption: checks schema, required fields, ID consistency, orphaned references. Called by `POST /api/v2/repair`.

---

### `HuggingFaceInference.js` (336 lines)
HF Inference API client. Supports text generation, code generation, and model search. Used by the `hf_*` tools in ToolRegistry.

---

## 5. Server Routes (API)

All routes prefixed with `/api/v2/` unless noted.

### `server/index.js` (direct routes)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v2/repair` | Run RegistryHealthCheck and fix detected issues |
| GET | `/api/v2/health` | System health: models loaded, broker state, task counts |
| POST | `/api/v2/heartbeat` | Manual heartbeat trigger (used by client ping) |
| POST | `/api/v2/poseidon/chat` | **SSE stream** — chat message → Poseidon response |
| POST | `/api/v2/poseidon/abort` | Abort current Poseidon generation |
| GET | `/api/v2/poseidon/session-state` | Current session turn, context %, last message |
| POST | `/api/v2/poseidon/reset-session` | Dispose session and recreate context |
| POST | `/api/v2/poseidon/chat-active` | Signal UI open/closed (controls BG task slot release) |
| GET | `/api/v2/voice/config` | Voice config (Speaches URL, models, enabled flag) |
| PATCH | `/api/v2/voice/config` | Update voice config |
| POST | `/api/v2/voice/stt` | Speech-to-text via Speaches Whisper |
| POST | `/api/v2/voice/tts` | Text-to-speech via Speaches Kokoro |
| GET | `/api/v2/reasoning/stream` | SSE stream of Poseidon's live thinking chunks |
| GET | `/api/v2/projects/:projectId/outputs` | List project output files with size + mtime |
| GET | `/api/v2/projects/:projectId/inputs` | List project input files |
| POST | `/api/v2/projects/:projectId/inputs` | Upload file to project input/ |
| DELETE | `/api/v2/projects/:projectId/inputs/:filename` | Delete input file |
| GET | `/api/v2/projects/:projectId/outputs/:filename` | Serve output file content |
| GET | `/api/files/read` | Read any file by absolute path |
| POST | `/api/files/browse` | Browse directory |
| POST | `/api/projects/:name/repair` | Repair specific project registry entry |

### `server/routes/registryRoutes.js` — mounted at `/api/v2`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/poseidon/wake` | Wake Poseidon (load model, init session) |
| POST | `/agents` | Create new agent |
| POST | `/agents/:id/wake` | Wake sleeping agent |
| POST | `/agents/:id/sleep` | Put agent to sleep |
| POST | `/tasks/:id/chunks/start` | Start a task chunk (multi-step tracking) |
| POST | `/tasks/:id/chunks/:chunkId/report` | Report chunk progress |
| POST | `/tasks/:id/chunks/:chunkId/decide` | Approve/reject chunk (human gate) |
| PATCH | `/tasks/:id/status` | Quick status update (kanban drag-drop) |
| GET | `/tasks` | List active/planned tasks from flat registry |
| GET | `/tasks/results` | List completed tasks from results_log |
| DELETE | `/tasks/results/:id` | Dismiss a completed result |
| POST | `/tasks` | Create task |
| POST | `/tasks/:id/close` | Manually close a task |
| DELETE | `/tasks/:id` | Hard delete task + output files + results_log entry |
| PATCH | `/tasks/:id/result` | Update task result summary |
| GET | `/tasks/:id/result` | Get task result file content |
| GET | `/tasks/:id/stream` | SSE stream of task output as it's written |
| PATCH | `/field` | Generic field update on any registry JSON |
| PATCH | `/projects/:id/memory` | Update section in project_memory.json |
| GET | `/skills` | List all skills from SKILLS/ |
| GET | `/skills/:id` | Read single skill |
| PUT | `/skills/:id` | Create or update skill |
| DELETE | `/skills/:id` | Delete skill + remove from seed + rebuild registry |

### `server/routes/modelRoutes.js` — mounted at `/api/v2/models`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/library` | Full model library with capabilities, status, display_name |
| GET | `/status` | Currently loaded models, broker state, context stats |
| POST | `/import` | Import GGUF file into registry |
| POST | `/import-from-path` | Import from absolute path |
| POST | `/load` | Manually load model into VRAM |
| POST | `/:modelId/unload` | Unload model |
| POST | `/:modelId/assign-poseidon` | Assign model as Poseidon's LLM |
| PATCH | `/:modelId/rename` | Set display_name |
| PATCH | `/:modelId/params` | Update load parameters (ctx, gpu layers…) |
| PATCH | `/:modelId/type` | Set model_type (text/image) |
| PATCH | `/:modelId/category` | Set category (poseidon/agent/image) |
| POST | `/generate-image` | Generate image via stable-diffusion.cpp |
| POST | `/download` | Start HF model download |
| POST | `/downloads/:id/cancel` | Cancel download |
| POST | `/delete-file` | Delete GGUF file from disk |

### `server/routes/agentRoutes.js` — mounted at `/api/v2/agents`
Agent SSE task streaming and run endpoints.

### `server/routes/commsRoutes.js` — mounted at `/api/v2/comms`
Telegram config test and message send.

---

## 6. Client — UI Modules

The client is fully vanilla JS with no build step. All files loaded via `<script>` tags in `client/index.html`.

### Layout
Single-page app. Three-column layout:
```
[ Poseidon squid | Agents squids ]  [ Aquarium canvas — flex:1 ]  [ Projects panel 200px ]  [ Control Tower ~280px ]
```
Header bar: `+ NEW AGENT | MODELS | LOGS | SKILLS | COMMS`

---

### `client/scripts/aquarium.js` (382 lines)
Canvas animation loop for the main aquarium view.

**Renders every frame:**
1. Ocean gradient background (deep → mid).
2. Caustic light shimmer overlay (animated sine pattern).
3. **Depth-parallax bubbles** (`_bgBubbles`): 3 layers (far/mid/near), 43 total bubbles. Per bubble: radial gradient fill + rim stroke + specular highlight + optional glow. 6 color palettes (cyan, blue, violet, teal, aqua, green). Wobble animation per bubble.
4. Vignette overlay.
5. All `Squid` instances via `sq.draw(ctx)`.
6. Interaction particles (confetti, hearts).

**Squid registry:** loads from `/api/agents`. Poseidon always rendered at fixed top-left position. Agent squids draggable, animate bob and tentacle wave.

---

### `client/scripts/Squid.js` (1007 lines)
Pixel-art squid entity class. One instance per agent in the aquarium.

**Constructor:** takes agent data object. Resolves appearance (primary/accent colors, size, accessories).

**`update(deltaTime)`:** advances `animFrame`, `bobOffset`, `glowPulse`. Handles sleep transition, idle timer (20s → sleep). Manages drag state and target position interpolation.

**`draw(ctx)`:**
- Translates to `(this.x, this.y)`.
- `drawBackgroundEffect` — glow halo.
- `drawShadow` — drop shadow.
- `drawTentacles(ctx, size)` — 6 tentacles with sine wave animation, 3 segments each.
- `drawBody(ctx, size)` — radial gradient sphere.
- `drawEyes` — delegates to `SquidAccessories.drawEyes`.
- Accessories: hat, glasses, outfit via `SquidAccessories`.
- `drawStatusIndicator` — colored dot (active=green, sleeping=blue, busy=orange).
- `drawNameTag` — `Press Start 2P` font label below body.

**Interaction:** `onClick()` → single click shows details popup / double-click triggers confetti. `onPet()` → heart particles. Drag-and-drop via `startDrag/drag/endDrag`.

---

### `client/scripts/SquidAccessories.js` (685 lines)
All pixel-art accessory rendering. Called by `Squid.draw()` and by `AgentForm` tile previews.

**Hats (13):** `top_hat`, `cap`, `crown`, `beanie`, `pirate`, `wizard_hat`, `headphones`, `beret`, `halo`, `antenna`, `devil_horns`, `ninja_mask`, `sombrero`

**Glasses (7):** `round`, `sunglasses`, `monocle`, `vr`, `pixel_glasses`, `3d_glasses`, `eyepatch`

**Eyes (10):** `round`, `happy`, `sleepy`, `angry`, `star`, `heart`, `dizzy`, `wink`, `surprised`, `laser`

**Outfits (8):** `scarf`, `tie`, `cape`, `lab_coat`, `armor`, `hoodie`, `kimono`, `cloak`

Each category method takes a pre-translated canvas context (centered on squid body), `size` param (body radius in pixels). Uses private helper `_r(ctx, x, y, w, h, fill, c)` and `_rb(ctx, x, y, w, h, fill, stroke, c)` for pixel rectangles scaled by `c = size/8`.

---

### `client/scripts/SquidInteractionSystem.js` (854 lines)
Manages all canvas-level interaction events: click, double-click, drag, hover, pet gestures. Dispatches to appropriate `Squid` instance. Tracks `hoveredSquid`, `draggedSquid`. Manages tooltip display and interaction cooldowns.

---

### `client/scripts/SquidInteractions.js` (315 lines)
Higher-level interaction handlers: what happens when you click Poseidon (open chat), click an agent (show details), double-click (celebrate), right-click (context menu). Connects `SquidInteractionSystem` events to UI panels.

---

### `client/scripts/PoseidonChat.js` (1187 lines)
Poseidon's chat modal. Full SSE streaming chat interface.

**Layout:** header (name, model display_name, MODELS/VOICE buttons) → status bar → messages area → input bar (attachment + textarea + send button).

**`open()`:**
- Builds modal DOM if first open.
- Calls `_syncOverlayBounds()` via `requestAnimationFrame`.
- Sets up `ResizeObserver` on `.aquarium-wrapper` and `#right-panel` for dynamic repositioning.
- Auto-loads session history.

**`_syncOverlayBounds()`:** measures `#projects-container.getBoundingClientRect().left` → sets `modal.style.right = window.innerWidth - rect.left + 'px'`. Also reads header bottom for `top`. Ensures overlay covers **only the aquarium area**, excluding projects panel and control tower.

**Send flow:**
1. User submits → `_sendMessage(text, attachments)`.
2. POST `/api/v2/poseidon/chat` with message + history array.
3. Stream reader consumes SSE chunks: `{type: 'text', chunk}`, `{type: 'tool_call', name, args}`, `{type: 'tool_result', name, ok, summary, ms}`, `{type: 'image'}`.
4. Tool calls render as collapsible blocks: pixel icon + tool name + key/value args + result with timing.
5. On stream end: appends to `temp.md` via separate call, updates header model tag.

**During generation:** send button hidden, STOP button shown. `this._generating = true` — closing modal does NOT abort the stream (continues in background).

**Voice settings (`_toggleVoiceSettings`):** panel shows Speaches URL, STT model, TTS voice, speed. PATCH `/api/v2/voice/config` to save.

---

### `client/scripts/TempleInterior.js` (2045 lines)
Project workspace — full-screen overlay triggered by clicking a project card.

**Layout:**
```
[ Header: PROJECT_NAME · stats · + TASK · REFRESH · CLOSE X ]
[ Left: Files/Memory tabs | Poseidon chat | Agents ]
[ Center: tabbar (file tabs) | file toolbar (SAVE · CLOSE ALL) | content area ]
[ Right: Kanban board ]
```

**Center content area** (absolute-positioned children, all `inset:0`):
- `#ti-reasoning-panel` z:1 — live Poseidon thinking stream (always present in background)
- `#ti-editor` z:2 — textarea for text/code files (hidden by default)
- `#ti-preview-frame` z:2 — iframe for md/html preview (hidden by default)

When no file open: reasoning panel at z:3 (front). Tabbar shows "LIVE STREAM". File toolbar hidden.
When file open: toolbar shown with SAVE + CLOSE ALL. Tabs in tabbar. Editor or frame at z:2.

**File handling:**
- `_openFile(name, path, type, folder)` — async fetch file content → calls `_ideActivate(idx)` on load.
- `_ideActivate(idx)` — routes by extension:
  - `.md/.markdown` → iframe with rendered HTML (custom markdown → HTML converter in `_renderMarkdownPreview`)
  - `.html` → iframe with raw srcdoc
  - `.py/.js/.ts/.sh/…` → textarea with IDE dark theme (`#1e2127` bg, `#abb2bf` text, `JetBrains Mono`, `data-lang` attribute)
  - `.json` → textarea with JSON theme (`#1a1a2e` bg, `#e6db74` text)
  - images → iframe with `<img>` centered
- `_closeAllFiles()` — saves current, clears `_openFiles`, restores reasoning panel to front.
- Middle-click on tab → closes that file.

**Output files** display relative timestamp ("2h ago", "45m ago") in blue. Fetched via `/api/v2/projects/:id/outputs` which returns `{name, path, size, mtime}`.

**Kanban board** (`_renderKanban`): TODO / IN PROGRESS / DONE columns. Cards show task title, agent name (with bolt icon if running), priority badge. Drag-drop updates task status.

**Poseidon instruction chatbox** (in left panel, between files and agents):
- Textarea with Ctrl+Enter send.
- Streams to `/api/v2/poseidon/chat` SSE with `[Project: NAME]` prefix.
- Responses render token-by-token in log area.

**`_renderHeader()`:** fetches `/api/v2/tasks`, counts tasks for this project. Shows "▶ N running · done/total" in header.

---

### `client/scripts/ModelLoader.js` (1546 lines)
Model library modal. Tabs: Library / Browse Files / Download HF.

**Library tab:** renders model cards with:
- **Name block:** `display_name` (full word-wrap) + original filename below
- **Capabilities badges** (pixel icon + label): auto-detected from filename via regex:
  - TEXT, VLM (vision), TOOLS (function calling), THINK (reasoning/R1), CODE, EMBED, MATH, INSTRUCT, IMAGE
- **Params grid:** CTX / GPU LAYERS / THREADS / BATCH / TTL / FLASH / MMAP / MLOCK as `<span>` badges
- **Runtime info:** LOADED / LAST USE / REQUESTS / TOKENS when model is in VRAM
- **Actions:** USE AS POSEIDON, EDIT PARAMS, RENAME, → IMAGE MODEL, REMOVE

**Rename:** `SquidModal.prompt()` → PATCH `/api/v2/models/:id/rename` → `_refresh()` in place (does not close modal).

**Browse Files tab:** filesystem browser for `aquarium/MODELS/`. Import files directly.

**Download HF tab:** search Hugging Face → select repo → pick GGUF quantization → download with progress bar.

---

### `client/scripts/TaskQueueUI.js` (842 lines)
Control Tower task panels: QUEUE (active/planned) and RESULTS (completed).

**Poll cycle (every 3s):**
1. Fetch `/api/v2/tasks` → active tasks.
2. Fetch `/api/v2/tasks/results` → completed tasks from `results_log.json`.
3. Render QUEUE: `_makeItem(t)` — shows status dot, title, agent, priority, elapsed time for running tasks.
4. Render RESULTS: `_makeDoneItem(t)` — reads flat `results_log` fields (`status`, `completed_at`, `assigned_name` at top level, not nested).

**`dismissResult(taskId)`:** removes from local state + DELETE `/api/v2/tasks/results/:id`.

**`openTaskResult(taskId)`:** modal with full output content. Checks registry first, falls back to `results_log` for completed tasks.

---

### `client/scripts/ControlTowerLive.js` (182 lines)
Live metrics in the Control Tower right panel.

**Updates every 3s:**
- **Resources:** CPU%, RAM%, VRAM% progress bars (from `/api/v2/health`).
- **Model info** (`_renderModel`): loaded model display_name + LOADED IN VRAM / NOT LOADED status.
- **Context bar** (`_renderContextBar`): progress bar showing context window fill %. Shows "48k ctx" when fresh, "12k/48k (25%)" after use. Hides zero values. Turn count + token count below bar.
- **Squad stats** (`_renderSquad`): `ACT N` (green) / `ZZZ N` (blue) — active vs sleeping agents.

---

### `client/scripts/AgentForm.js` (927 lines)
Agent create/edit modal. Tabs: IDENTITY / APPEARANCE / TOOLS / ADVANCED.

**Appearance tab:**
- Color pickers (primary, accent), size scale slider.
- **Preview canvas (200×200):** renders a real `Squid` instance with `baseSize = 0.36`, frozen at `animFrame=0`. Name label at bottom. Background: dark radial gradient + subtle grid.
- **Accessory pickers** (Hat, Glasses, Eyes, Outfit): grid of 60×60px tiles. Each tile draws **only the accessory** via `SquidAccessories.drawHat/drawGlasses/drawEyes/drawOutfit` centered on canvas — no body or tentacles.
- Selected tile highlighted with green glow border.

**Tools tab:** grouped by category with pixel icons (BRAIN/CODE/DATA/etc). Each tool checkbox. Counter shows "N enabled / 24 available". Live recount on toggle.

---

### `client/scripts/PixelIcons.js` (634 lines)
Pixel-art SVG icon system. All icons are 16×16 grids defined as palette + pixel arrays.

**Icon catalog (30 icons):**
`squid`, `temple`, `poseidon`, `system`, `cpu`, `stats`, `tasks`, `target`, `config`, `plus`, `brain`, `logs`, `team`, `models`, `data`, `ocean`, `launch`, `ok`, `error`, `info`, `create`, `mouse`, `interact`, `clean`, `text_model`, `vlm`, `tools`, `think`, `code_model`, `embed`, `math_model`, `image_model`, `bolt`, `moon`

**`inline(name, size)`** returns SVG string with `shape-rendering="crispEdges"`. Used throughout UI for consistent pixel-art visual identity.

**`replaceTags(el)`** — scans text nodes and replaces `[TAG]` markers with rendered SVG icons.

---

### `client/scripts/ProjectsPanel.js` (369 lines)
Right-side projects panel. Lists all projects as cards showing: name, task counts (todo/progress/done), assigned agents count, last activity. Click → opens `TempleInterior`. `+ NEW PROJECT` button → create form. Project cards show inside color as left border accent.

---

### `client/scripts/SkillsPanel.js` (207 lines)
Skills management modal. Lists skills from `GET /api/v2/skills`. Shows: skill_id, name, version, summary, trigger keywords, step count. Delete button calls `DELETE /api/v2/skills/:id`. Refresh reloads list.

---

### `client/scripts/CommsPanel.js` (404 lines)
Communications settings modal. Telegram section: token input, allowed chat IDs, bot username, enable toggle, test button. Voice section: Speaches URL, STT model selector, TTS model/voice/speed. Save calls `PATCH /api/v2/voice/config` and comms route.

---

### `client/scripts/Poseidon.js` (296 lines)
Poseidon's aquarium-side representation. Handles Poseidon's special squid rendering (larger, trident accessory, gold color scheme). Manages "thinking" animation state when Poseidon is generating.

---

### `client/scripts/ui.js` (569 lines)
Global UI utilities: panel open/close, notification toasts, live event log renderer. **Log event map:** maps server event types (`model_loaded`, `agent_created`, `task_completed`, etc.) to pixel icons and CSS classes. `_renderLog(events)` builds the scrollable log list in the Logs modal.

---

### `client/scripts/SquidModal.js` (86 lines)
Custom modal system replacing browser `alert/confirm/prompt`.

**Methods:**
- `alert(msg)` — dismissable message box.
- `confirm(msg)` → Promise\<boolean\> — yes/no dialog.
- `prompt(title, placeholder, defaultValue)` → Promise\<string|null\> — text input dialog.

All overlays: `z-index:30000`, stop `click/mousedown/mouseup` propagation (prevents closing parent modals).

---

### `client/scripts/api_v2.js`
Thin API client. `_fetch(path, options)` — adds `Content-Type: application/json`, throws on `!data.success`. Provides namespaced helpers: `ApiV2.tasks.list()`, `ApiV2.agents.list()`, etc.

---

### `client/scripts/Scheduler.js` (234 lines)
Client-side cron. Periodic polls for agent registry and project updates. Triggers re-renders when changes detected.

---

### `client/scripts/PanelResizer.js` (90 lines)
Drag-to-resize for the Control Tower right panel. Updates `--right-panel-width` CSS variable. When tower resized, fires `ResizeObserver` in `PoseidonChat._syncOverlayBounds()` so chat overlay adjusts.

---

### `client/scripts/EditorBrowser.js` (161 lines)
Standalone file editor panel (separate from TempleInterior). Used for editing raw JSON registries and config files from the logs/admin panel.

---

### `client/scripts/JsonEditor.js` (310 lines)
In-place JSON editor with syntax validation. Used by `EditorBrowser` and for editing agent brain files.

---

### `client/styles/pixel.css` (7522 lines)
Single CSS file. Organized by component:
- CSS variables: `--ocean-deep`, `--ocean-mid`, `--border`, `--accent`, `--success`, `--danger`, etc.
- Base layout: `header`, `.main-container`, `.aquarium-wrapper`, `.projects-container`, `.right-panel-permanent`.
- Component sections: `.pc-*` (PoseidonChat), `.ti-*` (TempleInterior), `.ml-*` (ModelLoader), `.tq-*` (TaskQueueUI), `.af-*` (AgentForm), `.squid-modal-*`, `.monitor-*`, `.pixel-icon-*`.
- Font: `Press Start 2P` for headers and labels. `Courier New`/`JetBrains Mono` for code/data.

---

## 7. Established Processes & Flows

### A. Chat with Poseidon

```
User types → POST /api/v2/poseidon/chat {message, history}
  → PoseidonOrchestrator.buildSystemPrompt() (reads brain, soul, temp.md, session_state, dream_memory)
  → V2ModelService acquires CHAT(0) broker slot
  → LLM session.prompt() with 39 tools
  → SSE stream: text chunks + tool_call/tool_result events
  → Client renders streaming text + collapsible tool blocks
  → On complete: content appended to aquarium/BRAIN/temp.md
  → Session state saved to session_state.json
  → Broker slot released
```

### B. Task Creation & Execution

```
Poseidon calls create_task({title, description, project, assigned_agent_id})
  → RegistryManager.generateNextId() [per-registry mutex, 4-digit sequential]
  → Task written to tasks_registry.json with status: 'planned'

TaskRunner.tick() [every 5s]
  → Filters runnable tasks (not terminal, agent not busy, no max retries)
  → _runTask(taskId)
    → RegistryManager marks task 'in_progress'
    → ModelBroker.acquire(AGENT=2)
    → AgentWorkerPool.runAgentTask(agentId, taskId, prompt, tools)
      → V2ModelService inference with agent system prompt + 24 tools
      → Agent calls tools (read/write files, web search, bash, etc.)
    → _saveOutput(result) → PROJECT/output/<taskId>.md
    → RegistryManager.closeTask(taskId, 'completed', {summary})
      → Persists to results_log.json (flat: status, completed_at, assigned_name)
      → Purges from tasks_registry.json
    → ModelBroker.release()
```

### C. Dream Cycle (Soul Consolidation)

**Trigger conditions (HeartbeatService, every 5s):**
- Poseidon model loaded and not generating
- Poseidon idle ≥ 10 minutes
- Last dream ≥ 30 minutes ago
- ModelBroker queue completely empty

**Process (V2ModelService.triggerDream):**
```
1. Read aquarium/BRAIN/temp.md (interaction log, last 12k chars)
   → If empty or starts with '<!--' (already cleared): skip cycle
2. Read aquarium/BRAIN/soul.json (current character)
3. Read all skills from aquarium/SKILLS/*.json
4. Dispose current Poseidon chat session (free sequence slot)
5. Acquire ModelBroker at DREAM(4) priority
6. Build dream system prompt (PHASE 1: Observe, PHASE 2: Reflect, PHASE 3: Act)
7. LLM generates: updated soul.json in ```json block + SKILL_UPDATE lines
8. Parse and write new soul.json → aquarium/BRAIN/soul.json
9. Parse SKILL_UPDATE lines (max 2) → write to aquarium/SKILLS/<id>.json
10. Clear temp.md → <!-- cleared after dream on <ISO> -->
    (happens even on error — safety net in catch block)
11. Save dream summary → aquarium/BRAIN/dream_memory.json
12. Release broker
```

**soul.json structure:**
```json
{
  "character": { "voice", "values", "communication_style", "known_user_preferences" },
  "learned_patterns": [],     // max 20 entries
  "skill_insights": [],
  "persistent_context": { "user_name", "user_timezone", "recurring_project_types" },
  "evolution_log": [],        // one entry per dream
  "dream_count": 0,
  "last_updated": "<ISO>"
}
```

### D. Image Generation

```
Poseidon calls generate_image({prompt, width, height, steps})
  → ModelBroker.acquire(IMAGE=4) — evicts text LLM from VRAM
  → ImageGenerationService finds stable-diffusion.cpp binary
  → Spawns sd CLI with prompt, model path, output path
  → Output written to aquarium/TASKS/OUTPUT/<taskId>.png
  → URL returned: /api/files/read?path=...
  → ModelBroker.release()
  → Text LLM re-loads on next chat request
```

### E. Context Recovery After OOM

```
LLM generation throws "No sequences left"
  → Dispose stale session (session.dispose())
  → Wait 400ms
  → Retry getSequence()
  → If still stuck: unload model entirely
  → Recreate context (new LlamaContext)
  → New session with fresh system prompt (includes temp.md for continuity)
```

### F. Project Work Delegation

**Enforced by Poseidon's absolute rules:**
```
User mentions project → Poseidon reads project memory (read_project_memory)
  → Thinks about decomposition
  → Creates N atomic tasks (create_task × N) — ONE task per item
  → Assigns each task to appropriate agent (assigned_agent_id)
  → STOPS and reports: "Created N tasks: [list]"
  → NEVER executes project work inline (write code, run scripts, etc.)

If request has >5 tasks or unclear scope:
  → Asks 2-4 clarifying questions first
  → "Before I break this into tasks, I need a few details:"
  → Waits for reply, THEN creates tasks
```

### G. Skill Self-Improvement

```
After EVERY task completion:
  → Poseidon calls list_skills()
  → Checks if skill exists for this task pattern
  → If pattern is new: calls write_skill() to create
  → If pattern improved: calls write_skill() with same skill_id (version++)
  → Dream cycle later consolidates skill insights into soul.json
```

---

## 8. Skills Catalog

Seed skills in `server/skills/` (one-time copied to `aquarium/SKILLS/` on first run):

| Skill ID | Triggers | Description |
|----------|----------|-------------|
| `metacognition` | after task, reflect, self-improve | 5-step reflection: review task, identify patterns, check skills, update if needed, log decision |
| `self_improve` | improve, optimize, learn, update skill | Pattern for self-directed skill updates and write_skill calls |
| `research_flow` | research, investigate, analyze, find info | Multi-step research: decompose → search → fetch → synthesize → write output |
| `code_edit_flow` | edit code, fix bug, modify file, refactor | Read → understand → plan → surgical edit → verify → commit |
| `create_agent` | new agent, create agent, add worker | Full agent creation: clarify role → create_agent → configure → assign project |
| `manage_agents` | wake, sleep, assign, list agents | CRUD operations on agents with wake/sleep lifecycle |
| `manage_projects` | create project, archive, update project | Project lifecycle management |
| `manage_tasks` | create tasks, list tasks, update task | Task CRUD and status management |
| `manage_skills` | write skill, update skill, list skills | Skill lifecycle and version management |
| `dispatch_task` | assign task, give task to agent, run task | Dispatch workflow: select agent → create task → assign → monitor |
| `archive_project` | archive, close project, finish project | Archive flow: update memory → close tasks → archive project |
| `project_clarification` | plan project, new project, complex request | Clarification gate: ask questions before decomposing into tasks |
| `find_image` | find image, search image, image for | Image search and retrieval workflow |
| `generate_image` | generate image, draw, create image, picture | stable-diffusion.cpp image generation flow |

---

## 9. Tool Registry

### Available to Agents (24 tools)

```
FILESYSTEM:   read_file, write_file*, list_files, delete_file, create_directory,
              directory_tree, search_files, get_file_info, move_file, read_media_file

NETWORK:      web_search, web_fetch

DATA:         calculator, json_parse, json_stringify

INFORMATION:  get_datetime

CODE:         run_javascript (Node.js sandbox, 60s), run_bash (host shell, 120s max)

AI:           hf_search_models, hf_generate, hf_generate_code,
              scan_local_models, find_local_model, get_model_stats
```

`*` `write_file` silently redirects `projects/.../input/` paths to `output/`.

### Available to Poseidon (39 tools, chat mode)

All agent tools above plus:
```
AGENTS:    create_agent, delete_agent, list_agents, update_agent_field,
           wake_agent, sleep_agent, assign_agent, unassign_agent, dispatch_to_agent

PROJECTS:  create_project, archive_project, delete_project, list_projects,
           update_project, update_project_memory, read_project_memory

TASKS:     create_task, list_tasks, update_task, delete_task

SKILLS:    write_skill, list_skills, delete_skill

BRAIN:     read_my_brain, update_user_context, log_decision

SYSTEM:    get_system_state, get_logs

COMMS:     send_telegram

IMAGE:     generate_image
```

**BG mode (16 tools):** strips admin/meta tools. Saves ~1500 context tokens for background task execution.

---

## 10. Installation & Running

### Prerequisites
- Node.js 22+
- A `.gguf` model file (Qwen3, Mistral, Llama3, etc.)
- GPU with VRAM ≥ model size (or CPU offload)
- Optional: `stable-diffusion.cpp` binary for image generation
- Optional: Docker + Speaches image for voice

### Setup

```bash
git clone https://github.com/Richie6988/squidmind.git
cd squidmind
npm install

# If node-llama-cpp native build fails:
bash scripts/rebuild-llama.sh
```

### Run

```bash
node server/index.js
# or with auto-restart:
npm run dev

# Open browser:
http://localhost:3000
```

### First Run
1. `aquarium/` directory is created and seeded automatically.
2. Click **MODELS** → Library tab → Browse Files or Download HF to add a `.gguf`.
3. Import the model, configure context size and GPU layers.
4. Click **USE AS POSEIDON** to assign it as the orchestrator LLM.
5. Click Poseidon's squid to open chat. Say hello.

### Voice (Speaches)
```bash
# Docker:
docker run -p 8000:8000 ghcr.io/speaches-ai/speaches:latest-cu124
# Then in COMMS panel: set Speaches URL to http://localhost:8000 and enable voice.
```

### Telegram Bot
1. Create bot via `@BotFather`, get token.
2. In COMMS panel: enter token + your Telegram chat ID. Enable. Save.
3. Bot starts long-polling automatically (no public URL needed).

### Environment
See `.env.template` for optional overrides (port, model path, HF API key for downloads).

---

## Repository Map

```
squidmind/
├── client/
│   ├── index.html                      Single-page app shell
│   ├── favicon.svg                     Trident logo
│   ├── scripts/                        All client JS (no build step)
│   │   ├── aquarium.js                 Canvas animation loop
│   │   ├── Squid.js                    Squid entity class (1007 lines)
│   │   ├── SquidAccessories.js         Pixel-art hat/glasses/eyes/outfit rendering
│   │   ├── SquidInteractionSystem.js   Click/drag/hover event management
│   │   ├── SquidInteractions.js        High-level interaction handlers
│   │   ├── PoseidonChat.js             Poseidon SSE chat modal
│   │   ├── TempleInterior.js           Project workspace overlay
│   │   ├── ModelLoader.js              Model library modal
│   │   ├── AgentForm.js                Agent create/edit form
│   │   ├── TaskQueueUI.js              Control tower task panels
│   │   ├── ControlTowerLive.js         Live resource metrics
│   │   ├── ProjectsPanel.js            Project cards panel
│   │   ├── SkillsPanel.js              Skills management modal
│   │   ├── CommsPanel.js               Telegram + Voice settings
│   │   ├── PixelIcons.js               SVG pixel-art icon system
│   │   ├── SquidModal.js               Custom alert/confirm/prompt
│   │   ├── Poseidon.js                 Poseidon aquarium rendering
│   │   ├── Scheduler.js                Client-side polling scheduler
│   │   ├── PanelResizer.js             Drag-to-resize control tower
│   │   ├── EditorBrowser.js            File editor panel
│   │   ├── JsonEditor.js               In-place JSON editor
│   │   ├── ui.js                       Global UI utilities, log rendering
│   │   ├── api.js                      Legacy API client
│   │   └── api_v2.js                   V2 API client
│   └── styles/
│       └── pixel.css                   7500-line single stylesheet
│
├── server/
│   ├── index.js                        Express app, all routes, service init (866 lines)
│   ├── aquarium.js                     Path resolution, auto-seed, startup (257 lines)
│   ├── models/
│   │   └── Agent.js                    Agent data model
│   ├── routes/
│   │   ├── registryRoutes.js           Tasks, agents, skills, projects routes
│   │   ├── modelRoutes.js              Model library, load/unload, image gen
│   │   ├── agentRoutes.js              Agent SSE task streaming
│   │   └── commsRoutes.js              Telegram config test
│   ├── services/
│   │   ├── V2ModelService.js           node-llama-cpp v3 model management (1903 lines)
│   │   ├── ModelBroker.js              Priority queue serializer (267 lines)
│   │   ├── PoseidonOrchestrator.js     System prompt builder + 39 tools (2283 lines)
│   │   ├── RegistryManager.js          All JSON I/O with write-locks + ID mutex (1543 lines)
│   │   ├── TaskRunner.js               5s tick loop, task dispatch (758 lines)
│   │   ├── AgentWorker.js              Per-agent inference session (477 lines)
│   │   ├── HeartbeatService.js         Health monitoring, dream trigger (254 lines)
│   │   ├── BotService.js               Telegram long-polling bot (943 lines)
│   │   ├── ToolRegistry.js             24 agent tools (658 lines)
│   │   ├── OrchestratorTools.js        Poseidon tool implementations (619 lines)
│   │   ├── ImageGenerationService.js   stable-diffusion.cpp wrapper (289 lines)
│   │   ├── LocalModelScanner.js        GGUF file scanner + magic byte validator (325 lines)
│   │   ├── ModelDownloader.js          HF model download with progress (192 lines)
│   │   ├── FilesystemTools.js          Node.js sandbox, file utils (513 lines)
│   │   ├── FilesystemBrowser.js        Directory listing with metadata (154 lines)
│   │   ├── RegistryHealthCheck.js      Registry integrity validator (292 lines)
│   │   └── HuggingFaceInference.js     HF Inference API client (336 lines)
│   ├── seed/                           Initial JSON files (one-time copy to aquarium/)
│   │   ├── poseidon_brain.json         Poseidon's full identity + rules
│   │   ├── soul.json                   Empty soul template
│   │   ├── agent_registry.json         Empty agent index
│   │   ├── model_registry.json         Empty model index
│   │   ├── project_registry.json       Empty project index
│   │   ├── tasks_registry.json         Empty task index
│   │   ├── tool_registry.json          Tool catalog
│   │   ├── comms_config.json           Default comms config
│   │   ├── logs.json                   Empty log
│   │   └── temp.md                     Empty interaction buffer
│   ├── skills/                         Seed skills (one-time per file)
│   │   ├── metacognition.json
│   │   ├── self_improve.json
│   │   ├── research_flow.json
│   │   ├── code_edit_flow.json
│   │   ├── create_agent.json
│   │   ├── manage_agents.json
│   │   ├── manage_projects.json
│   │   ├── manage_tasks.json
│   │   ├── manage_skills.json
│   │   ├── dispatch_task.json
│   │   ├── archive_project.json
│   │   ├── project_clarification.json
│   │   ├── find_image.json
│   │   └── generate_image.json
│   └── utils/
│       └── idGenerator.js              Zero-pad ID formatter
│
├── docs/
│   ├── DATA_ARCHITECTURE.md            Legacy data layer docs
│   ├── JSON_ARCHITECTURE.md            Legacy JSON schema docs
│   └── WHY_THIS_ARCHITECTURE.md        Design rationale
│
├── package.json                        Dependencies, npm scripts
├── .env.template                       Environment variable template
├── migrate_aquarium.js                 One-time migration from legacy layout
├── push.sh                             Git push helper
├── PUSH_GUIDE.sh                       Deployment guide
└── scripts/
    └── rebuild-llama.sh                Rebuild node-llama-cpp native module
```
