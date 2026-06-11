# Process: Code Edit Flow

## When to use
User asks to modify, create, or review code files.

## Steps
1. `read_file(path)` — see current state before touching anything
2. Small targeted change → `edit_file(path, search_text, replace_text)`
   - `search_text` MUST appear exactly once in the file
3. Brand new file → `write_file(path, content)`
4. Overwriting existing file fully → CONFIRM with user first
5. `github_diff()` to verify the change looks right
6. `github_commit("type: clear message about what changed and why")`

## Notes
- Workspace root = `aquarium/` directory
- Never write outside the workspace without explicit user instruction
- Prefer surgical edits (`edit_file`) over full rewrites
