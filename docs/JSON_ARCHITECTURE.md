# SQUIDMIND JSON ARCHITECTURE & SYNCHRONIZATION

## 🎯 THREE-TIER SYSTEM

```
brain.json (GLOBAL) → Registries, system config, metrics
    ↓
project_memory.json (PER PROJECT) → State, repo, structure  
    ↓
agent_config.json (PER AGENT) → Brain, assignments, performance
```

## 🆔 UNIQUE ID FORMAT

`{type}_{timestamp}_{random4}`

Examples:
- `project_1737386400_a3f9`
- `agent_1737386401_b7k2`
- `task_1737386402_c8m5`

## 🔄 SYNC RULES

1. **ID Propagation**: All IDs registered in brain.json
2. **Update Cascade**: Agent → Project → Brain
3. **Bidirectional**: Agents know projects, projects know agents
4. **Timestamps**: ISO 8601 for all dates
5. **Source of Truth**: brain.json registries

## ✅ BENEFITS

- Unique IDs (no collisions)
- Full traceability
- Easy recovery
- Scalable architecture
