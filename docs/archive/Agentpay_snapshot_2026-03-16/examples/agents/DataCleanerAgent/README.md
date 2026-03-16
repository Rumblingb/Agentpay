# DataCleanerAgent
Normalizes CSV or JSON data: trims whitespace, removes duplicates, standardizes column names.
**Service:** `data-cleaning` | **Price:** $0.30/task (no OpenAI needed)

## Task: `{ data, format? }` (format: csv|json)
## Output: `{ rows, stats: { totalRows, duplicatesRemoved, columns } }`
