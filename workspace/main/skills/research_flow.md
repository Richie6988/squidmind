# Skill: Research Flow

## When to use
User asks for information requiring web search or URL fetching.

## Steps
1. `web_search(focused_query, num_results=5)` — get top hits
2. Pick 1–3 most relevant URLs from titles + snippets
3. `web_fetch(url)` on the best one for full content
4. Synthesize a tight answer — cite source URLs inline
5. Don't pad with irrelevant quotes

## Notes
- Keep queries short (3–6 words) and specific
- If first search misses, refine query and retry once
- Prefer primary sources (official docs, papers, gov sites) over aggregators
