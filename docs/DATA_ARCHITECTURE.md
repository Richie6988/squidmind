# SQUIDMIND DATA ARCHITECTURE - NEURONAL DESIGN

## 🎯 PHILOSOPHY

**Registries are indexes. Files are content. Logs are history.**

Every folder has:
1. **Registry** - Who/what exists, IDs, metrics
2. **Files** - Individual entity details
3. **Updates logged** - Every change recorded

## 📁 STRUCTURE

```
data/
├── main/
│   └── poseidon_brain.json          # CONDUCTOR - knows all registries
│
├── agents/
│   ├── agent_registry.json          # Index of all agents
│   ├── squid_brain_001.json         # Agent 001 config
│   ├── squid_brain_002.json         # Agent 002 config
│   └── ...
│
├── teams/
│   └── team_registry.json           # All teams (general + project-specific)
│
├── logs/
│   └── logs.json                    # ALL decisions, creations, deletions, updates
│
├── models/
│   ├── model_registry.json          # Active/archived models
│   └── *.gguf                       # Model files
│
├── projects/
│   ├── project_registry.json        # Index of all projects
│   ├── PROJECT_001/
│   │   ├── project_memory.json      # Project state
│   │   ├── input/                   # Project inputs
│   │   └── output/                  # Project outputs
│   └── PROJECT_002/
│       └── ...
│
├── tools/
│   ├── tool_registry.json           # Index of all tools
│   ├── web_search.json              # Tool spec
│   ├── code_execution.json          # Tool spec
│   └── ...
│
└── tasks/
    └── tasks_registry.json          # All tasks (planned/active/completed)
```

## 🔢 ID SYSTEM - INCREMENTAL

### Format:
`{type}_{incremental_3_digit}`

### Examples:
- `project_001`, `project_002`, `project_003`
- `agent_001`, `agent_002`, `agent_003`
- `task_001`, `task_002`, `task_003`
- `team_001`, `team_002`

### Storage:
Each registry tracks:
```json
{
  "metadata": {
    "last_id": 3,
    "next_id": 4,
    "total_created": 5,
    "total_archived": 2
  }
}
```

## 🔗 CONNECTION PATTERNS

### 1. FORWARD REFERENCE (Registry → Entity)
```json
// agent_registry.json
{
  "agents": {
    "agent_001": {
      "name": "Marina",
      "file": "squid_brain_001.json",
      "status": "active"
    }
  }
}
```

### 2. BACKWARD REFERENCE (Entity → Registry)
```json
// squid_brain_001.json
{
  "agent_id": "agent_001",
  "registered_in": "agents/agent_registry.json",
  "assigned_projects": ["project_001", "project_002"]
}
```

### 3. CROSS REFERENCE (Entity ↔ Entity)
```json
// project_memory.json
{
  "project_id": "project_001",
  "assigned_agents": ["agent_001", "agent_003"],
  "assigned_team": "team_001"
}

// squid_brain_001.json
{
  "agent_id": "agent_001",
  "assigned_projects": ["project_001"]
}
```

## 📊 REGISTRY TEMPLATES

### poseidon_brain.json (CONDUCTOR)
```json
{
  "system_id": "poseidon_main",
  "version": "2.0.0",
  "initialized": "2025-01-20T17:00:00Z",
  
  "soul": { /* core truths, boundaries, vibe */ },
  "identity": { /* who Poseidon is */ },
  "user": { /* about Richard */ },
  
  "environment": {
    "data_root": "data/",
    "registries": {
      "agents": "agents/agent_registry.json",
      "projects": "projects/project_registry.json",
      "teams": "teams/team_registry.json",
      "tasks": "tasks/tasks_registry.json",
      "tools": "tools/tool_registry.json",
      "models": "models/model_registry.json",
      "logs": "logs/logs.json"
    }
  },
  
  "process": {
    "on_startup": [
      "Load all registries",
      "Count active agents/projects/tasks",
      "Check for pending tasks",
      "Update metrics"
    ],
    "on_user_input": [
      "Parse intent",
      "Check relevant registries",
      "Assign to agent or self",
      "Log decision"
    ],
    "on_task_complete": [
      "Update task status in tasks_registry",
      "Update agent performance in agent_registry",
      "Update project progress in project_memory",
      "Log completion in logs.json"
    ]
  },
  
  "current_state": {
    "active_agents": 0,
    "active_projects": 4,
    "pending_tasks": 0,
    "loaded_model": null
  }
}
```

### agent_registry.json
```json
{
  "metadata": {
    "last_id": 3,
    "next_id": 4,
    "total_active": 3,
    "total_archived": 0,
    "total_created": 3
  },
  
  "agents": {
    "agent_001": {
      "name": "Marina",
      "nickname": "Marina",
      "file": "squid_brain_001.json",
      "status": "active",
      "created": "2025-01-20T10:00:00Z",
      "last_active": "2025-01-20T16:00:00Z",
      "assigned_projects": ["project_001"],
      "performance": {
        "tasks_completed": 28,
        "tasks_failed": 2,
        "success_rate": 0.93
      }
    },
    "agent_002": {
      "name": "Atlas",
      "status": "sleeping",
      "file": "squid_brain_002.json"
    }
  }
}
```

### project_registry.json
```json
{
  "metadata": {
    "last_id": 4,
    "next_id": 5,
    "total_active": 4,
    "total_archived": 0
  },
  
  "projects": {
    "project_001": {
      "name": "AQUARIUM",
      "folder": "PROJECT_001",
      "status": "active",
      "created": "2025-01-20T10:00:00Z",
      "assigned_agents": ["agent_001"],
      "assigned_team": null,
      "metrics": {
        "completion": 0.88,
        "commits": 48,
        "tasks_completed": 31,
        "tasks_pending": 3
      }
    },
    "project_002": {
      "name": "TRADING",
      "folder": "PROJECT_002",
      "status": "planned"
    }
  }
}
```

### team_registry.json
```json
{
  "metadata": {
    "last_id": 2,
    "next_id": 3,
    "total_active": 2
  },
  
  "teams": {
    "team_001": {
      "name": "General Squad",
      "type": "general",
      "members": ["agent_001", "agent_002", "agent_003"],
      "status": "active"
    },
    "team_002": {
      "name": "AQUARIUM Dev Team",
      "type": "project",
      "project": "project_001",
      "members": ["agent_001"],
      "status": "active"
    }
  }
}
```

### tasks_registry.json
```json
{
  "metadata": {
    "last_id": 15,
    "next_id": 16,
    "total_planned": 3,
    "total_active": 2,
    "total_completed": 10
  },
  
  "tasks": {
    "task_001": {
      "title": "Remove all emojis",
      "project": "project_001",
      "assigned_to": "agent_001",
      "status": "completed",
      "priority": "HIGH",
      "started": "2025-01-20T15:00:00Z",
      "completed": "2025-01-20T16:30:00Z",
      "duration_minutes": 90,
      "appreciation": "Excellent - systematic approach, verified results"
    },
    "task_002": {
      "title": "Implement bubble columns",
      "project": "project_001",
      "assigned_to": "agent_001",
      "status": "planned",
      "priority": "HIGH"
    }
  }
}
```

### tool_registry.json
```json
{
  "metadata": {
    "total_available": 5
  },
  
  "tools": {
    "web_search": {
      "file": "web_search.json",
      "status": "active",
      "category": "information_retrieval"
    },
    "code_execution": {
      "file": "code_execution.json",
      "status": "active",
      "category": "development"
    }
  }
}
```

### model_registry.json
```json
{
  "metadata": {
    "total_active": 1,
    "total_archived": 2
  },
  
  "models": {
    "model_001": {
      "name": "llama-3.2-1b",
      "file": "llama-3.2-1b.gguf",
      "size_gb": 1.2,
      "status": "active",
      "loaded": true,
      "usage_count": 145
    }
  }
}
```

### logs.json
```json
{
  "metadata": {
    "total_entries": 245,
    "last_entry_id": 245
  },
  
  "entries": [
    {
      "id": 245,
      "timestamp": "2025-01-20T16:30:00Z",
      "type": "task_completed",
      "actor": "agent_001",
      "action": "Completed task_001 (Remove emojis)",
      "changes": {
        "tasks_registry": "task_001 status: planned → completed",
        "agent_registry": "agent_001 performance updated",
        "project_memory": "project_001 progress updated"
      }
    },
    {
      "id": 244,
      "timestamp": "2025-01-20T16:00:00Z",
      "type": "json_update",
      "actor": "poseidon",
      "file": "main/poseidon_brain.json",
      "changes": {
        "soul": "Added core truths section"
      }
    }
  ]
}
```

## 🔄 PROCESS FLOWS

### POSEIDON STARTUP (Model Just Connected)
```
1. Load main/poseidon_brain.json
2. Read environment.registries paths
3. Load each registry:
   - agents/agent_registry.json → count active
   - projects/project_registry.json → count active
   - tasks/tasks_registry.json → count pending
   - models/model_registry.json → check loaded
4. Update current_state
5. Log startup in logs.json
6. READY - knows entire environment
```

### AGENT AWAKENING (Sleeping → Active)
```
1. Load agents/agent_registry.json
2. Find agent_ID entry
3. Load agents/squid_brain_{ID}.json
4. Check assigned_projects
5. For each project:
   - Load projects/project_registry.json
   - Load PROJECT_{ID}/project_memory.json
   - Read current state
6. Check pending tasks in tasks_registry.json
7. Update status: sleeping → active
8. Log awakening in logs.json
9. READY - knows context & assignments
```

### USER INPUT → TASK CREATION
```
1. Poseidon receives input
2. Parse intent
3. Generate task_ID (next_id from tasks_registry)
4. Create task entry in tasks_registry.json
5. Assign to agent (update agent_registry)
6. If project-related:
   - Update project_memory.json
7. Log creation in logs.json
8. Notify assigned agent
```

### TASK COMPLETION
```
1. Agent completes task
2. Update tasks_registry.json:
   - status: active → completed
   - Add completion time, duration, appreciation
3. Update agent_registry.json:
   - Increment tasks_completed
   - Recalculate success_rate
4. Update project_memory.json:
   - Add to completed objectives
   - Update metrics
5. Update project_registry.json:
   - Update metrics
6. Log in logs.json:
   - Record all changes made
7. Sync complete
```

## ✅ BENEFITS

1. **Self-documenting** - Every registry explains itself
2. **Auditable** - logs.json has full history
3. **Recoverable** - Can rebuild state from logs
4. **Scalable** - Add agents/projects without conflicts
5. **Debuggable** - Clear paths, readable IDs
6. **Fast startup** - Load registries, not all files
7. **Efficient queries** - Check registry first, load file if needed

