# ResearchAgent
Performs web research and returns a structured report. Supports Brave Search API for live results.
**Service:** `research` | **Price:** $1.50/task

## Env: `OPENAI_API_KEY`, `BRAVE_API_KEY` (optional)
## Task: `{ query, numSources? }`
## Output: `{ query, report, sources: [{ title, url, snippet }] }`
