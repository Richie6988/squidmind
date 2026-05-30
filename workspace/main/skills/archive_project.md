# Skill: Archive Project

## When to use
User wants to archive / close a project.

## Steps
1. Confirm: "Archive PROJECT_NAME? All assigned agents will be freed."
2. On yes: `archive_project(project_name)`
3. `log_decision("Archived project X", reasoning="...")`
4. Suggest next steps: reassign freed agents, review open tasks

## Notes
- Archive is reversible (set status back to 'active' via update_field)
- Project folder stays at `workspace/projects/<slug>/` — nothing is deleted
- Assigned agents are automatically freed
