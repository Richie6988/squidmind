# Why This Architecture - SquidMind Neuronal Design v2.0

## The Problem We're Solving

Building an agent farm is fundamentally different from building a single AI assistant. We have:
- Multiple agents running concurrently
- Shared resources (models, GPU memory, API quotas)
- Long-running tasks that need to survive crashes
- Inter-agent communication
- Audit and learning requirements
- A human (Richard) who wants control and visibility

A single JSON file can't handle this. A SQL database is overkill. We need something in between.

## The Core Idea: Registries + Files + Logs

**Three types of storage, each with a clear job:**

1. **Registries** are indexes. Small, fast to load. They tell you what exists and where to find details.
2. **Entity files** are content. Loaded only when you need full details about a specific agent, project, or task.
3. **Logs** are history. Append-only record of every state change.

This separation matters because:
- Listing all agents shouldn't require loading 100 brain files
- Updating one agent shouldn't lock the entire system
- Reconstructing what happened yesterday should be trivial

## The Seven Principles

### 1. Separation of Index from Content

When Poseidon wakes up and needs to know "how many active agents?", it shouldn't load every single agent's full brain. It loads `agent_registry.json` (a few KB) and gets counts, IDs, and pointers. Only when it needs to actually USE agent_001 does it load `squid_brain_001.json`.

**Impact:** Startup time stays constant regardless of how many agents exist.

### 2. Single Source of Truth Per Concern

Each piece of information lives in exactly one place:
- Task status -> `tasks_registry.json`
- Agent performance -> `agent_registry.json`
- Model loading state -> `model_registry.json`

No duplication means no sync conflicts.

**Counter-example we avoided:** Storing agent assignments in BOTH `project_memory.json` AND `squid_brain.json` would create drift. Instead, the registry is authoritative; brain file caches a lightweight reference.

### 3. Bidirectional References

Agents know their projects. Projects know their agents. Tasks know everything they touch.

```
agent_001.assigned_projects: ["project_001"]
project_001.assigned_agents: ["agent_001"]
task_001.assigned_to: "agent_001"
task_001.project_id: "project_001"
```

This allows queries from any direction. "Which agents work on AQUARIUM?" and "What projects does Marina work on?" are both O(1) lookups.

### 4. Complete Audit Trail

`logs/logs.json` records every change with:
- What changed (specific fields)
- Who caused it (actor)
- When it happened (timestamp)
- Why it happened (context)

**Why this matters:**
- Debugging: "Why is task_005 in this weird state?" -> Replay logs.
- Learning: "What patterns lead to task failures?" -> Analyze logs.
- Trust: Richard can verify Poseidon's decisions weren't made for bad reasons.

### 5. Checkpoint-Based Resilience

Big tasks are broken into chunks. Each chunk has a checkpoint.

If the model crashes mid-task:
- The task entry survives (in registry)
- The last successful chunk is recorded
- On restart, agent resumes from `chunk_N+1`, not from scratch

This is critical for tasks like "refactor entire codebase" that take hours.

### 6. Resource-Aware Priority

Priority isn't just "how urgent." It factors in:
- **Urgency** (deadline)
- **Importance** (impact)
- **Blocking count** (how many other tasks wait on this)
- **Difficulty** (penalty if resources are tight)
- **Duration** (penalty if quick alternatives exist)
- **Resource saturation** (deprioritize heavy tasks when CPU hot)

**The formula:**
```
score = (urgency * 3) + (importance * 2) + (blocking_count * 5)
      - (difficulty * 1) - (duration_factor * 0.5) - (resource_saturation * 4)
```

This prevents thrashing. When the GPU is already maxed out, scheduling another heavy inference is bad. The formula automatically defers it.

### 7. Human-Readable Throughout

Everything is JSON. Every JSON is in git. Every change is diffable.

Richard can open any file in VS Code and read what's there. No special tools needed. No database queries. No proprietary formats.

**Trade-off accepted:** Slightly larger files than binary formats. Worth it for transparency.

## How Tools Work (Three Types)

Tools are NOT homogeneous. They have fundamentally different shapes:

### Type A: Local Function
A piece of code that runs on this machine. Needs:
- Reference to the actual function
- Permission scope (which paths/operations allowed)
- Sandbox boundaries

Example: `read_file` reads from filesystem. Needs `filesystem_read` permission. Denied paths include `data/secrets/`.

### Type B: API Call
An HTTP endpoint somewhere on the internet. Needs:
- URL and method
- Authentication (token, OAuth, etc.)
- Rate limits to respect

Example: `web_search` hits a search API. Needs API key (from `secrets/`). Limited to 60 requests/minute.

### Type C: MCP Server
A Model Context Protocol compliant service. Needs:
- Server URL and transport (HTTP/SSE/stdio)
- Protocol version
- Capability discovery

Example: `github_mcp` provides GitHub operations via MCP. Discovers capabilities dynamically.

**Why this matters:** When Poseidon decides "I need to fetch information from the web," the answer might be a local function (read cached data), an API call (web search), or an MCP server (specialized service). Same need, three different tool invocations.

## How Secrets Work

**Tokens, API keys, SSH keys are NEVER in committed JSON files.**

Instead:
1. Secrets live in `data/secrets/` which is gitignored
2. JSON files contain references like `"key_ref": "secrets/github/aquarium_fgpat"`
3. At runtime, the system loads the actual secret from disk
4. Logs never include secret contents, only references

**For GitHub specifically:**
- Repository operations use SSH keys (ssh_key_ref)
- API operations use fine-grained PATs (fine_grained_pat_ref)
- PATs have explicit `permissions_granted` array
- PATs have `expires_at` date for rotation reminders

## The Task Lifecycle

A task is born, lives, and dies. Each phase is tracked.

### Birth
1. User says something like "fix the bugs"
2. Poseidon parses intent
3. Generates `task_NNN` (incremental from `next_id`)
4. Computes priority score
5. Assigns to best agent (skill match)
6. Writes to `tasks_registry.json`
7. Logs creation event

### Life
1. Agent picks task from queue
2. Status: `planned` -> `in_progress`
3. Agent breaks task into chunks
4. For each chunk:
   - Execute
   - Save checkpoint
   - Report to Poseidon
   - Wait for approval
   - Continue or stop
5. Periodic priority recalculation as conditions change

### Death (Completion, Failure, or Cancellation)
1. Final outcome determined
2. `chunks` array is **removed**
3. `closure_comments` object is **added** with:
   - Outcome (success/failure/cancelled)
   - Summary of what happened
   - What went well
   - What could improve
   - Lessons for future tasks
   - Final approval status
4. Cascade updates to agent, project, registry
5. Logged in `logs.json`

**Why remove chunks at closure?** They're operational data. Once done, they're noise. The lessons learned are the signal worth keeping.

## How Poseidon Wakes Up

Critical sequence when the model just loaded:

```
T+0ms     Model loaded into memory
T+10ms    Read main/poseidon_brain.json
          -> Loads soul, identity, user, environment paths
T+30ms    Parallel load:
          - agent_registry.json
          - project_registry.json
          - tasks_registry.json
          - model_registry.json
          - tool_registry.json
          - last 100 log entries
T+100ms   Build in-memory state:
          - Active agents map
          - Pending tasks priority queue
          - Resource availability snapshot
T+150ms   Check for critical conditions:
          - Tasks marked in_progress (need recovery?)
          - Agents marked active (need to wake them?)
          - Failed processes from last session?
T+200ms   Wake required agents (those with in-progress work)
T+250ms   Log awakening event
T+300ms   Ready - announce to user
```

Total time independent of total entity count. Scales because we load registries, not full content.

## How An Agent Wakes Up

When Poseidon (or user) signals an agent to wake:

1. Load `agents/agent_registry.json` -> find entry
2. Load `agents/squid_brain_NNN.json` -> full state
3. Status: `sleeping` -> `waking`
4. Load context:
   - Recent log entries involving this agent (last 20)
   - Assigned projects (each `project_memory.json`)
   - Pending tasks (filter `tasks_registry` by assigned_to)
   - Unread messages from inbox
5. Restore working memory from last checkpoint (if any)
6. Status: `waking` -> `active`
7. Log wake event with context summary
8. Report ready to Poseidon

The agent now knows:
- Who it is
- What it was doing
- What's expected of it
- Recent context

## Why Not a Database?

**Considered and rejected.** Reasons:
- Requires setup/maintenance complexity
- Schema migrations are painful
- Not human-readable (can't diff in git)
- Overkill for our scale (10s to 100s of agents, not millions)
- File-based gives us free version control

**When to migrate:** If we hit 1000+ agents or 10000+ tasks, indexing becomes worth it.

## Why Not One Big JSON?

**Considered and rejected.** Reasons:
- Slow loading (must load everything to access anything)
- Concurrency nightmares (one writer locks everything)
- Bloats agent context windows (they don't need everyone's data)
- Hard to backup incrementally
- One corruption ruins everything

## Scalability Analysis

| Scale | Files | Performance | Notes |
|-------|-------|-------------|-------|
| 10 agents, 4 projects | ~30 | Excellent | Current setup |
| 100 agents, 20 projects | ~140 | Excellent | No changes needed |
| 1000 agents, 100 projects | ~1200 | Good | Consider registry indexing |
| 10000+ agents | - | Needs DB | Migrate to PostgreSQL |

## Failure Modes & Recovery

### File corruption
- Each file is independent -> corruption is isolated
- `logs.json` contains last actions -> can replay
- Registries can be rebuilt by scanning individual files

### Process crash mid-task
- Task entry persists in registry
- Last checkpoint indicates where to resume
- No tasks are "lost"

### Data inconsistency
- Validation script scans cross-references
- Auto-repair rebuilds registry from individual files
- Manual review for actual conflicts

## What This Architecture Enables

Because of these design choices, we can do things that would be hard otherwise:

1. **Replay history** - Reconstruct system state at any past moment
2. **Hot swap agents** - Pull one out, put another in, system continues
3. **Time-travel debugging** - "What was task_005 doing at 14:30?"
4. **Selective backup** - Backup only what changed
5. **Multi-machine sync** - Each file is small, fits in git
6. **Audit compliance** - Every action has a paper trail
7. **Learning from history** - Mine logs for patterns

## Summary

We chose this architecture because:
- It separates concerns (index vs content vs history)
- It scales gracefully (constant startup, file-level concurrency)
- It's debuggable (everything human-readable, in git)
- It's resilient (checkpoints, audit trail, can recover from crashes)
- It respects resources (priority formula factors in load)
- It handles tool diversity (three distinct types properly modeled)
- It keeps secrets safe (reference-based, never committed)
- It enables learning (lessons_for_future fields, pattern recognition)

This is not the simplest possible design. But it's the simplest design that handles the actual complexity of running an agent farm well.
