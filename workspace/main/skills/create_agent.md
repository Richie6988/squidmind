# Skill: Create Agent

## When to use
User asks to create a new AI agent / squid for a specific role.

## Steps
1. Ask: display_name, specialization, role description, primary_color (if not given, pick from palette)
2. Call `create_agent(display_name, specialization, role, primary_color)`
3. Note the returned `agent_id`
4. Call `log_decision("Created agent X for role Y", reasoning="...")`
5. Report `agent_id` + display_name to user

## Specializations available
frontend_specialist | backend_specialist | fullstack_dev | data_analyst
devops | qa_tester | designer | researcher | ml_engineer | security
documentation | general

## Notes
- Brain file saved as: `aquarium/AGENTS/<slug>_<id>.json`
- Agent starts in `sleeping` status — wake with `update_agent_field`
