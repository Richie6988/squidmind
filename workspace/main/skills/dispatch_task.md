# Skill: Dispatch Task to Agent

## When to use
User asks to start a task, run a cron job, or have an agent work on something.

## Steps
1. `list_tasks(status="open")` — find the task or confirm it exists
2. `list_agents()` — pick the best agent by specialization
3. `dispatch_to_agent(agent_id, task_message, task_id)`
   - `task_message`: clear description with context, expected output, constraints
   - `task_id`: link to tracked task if one exists
4. Report back: "Dispatched to <agent_name> — running in background"
5. User can monitor via task queue in the UI

## Notes
- Agent uses its OWN model session + personality + tools_allowed
- Results saved to `aquarium/TASKS/<task_id>/results/output.txt`
- Task lifecycle: open → in_progress → completed
