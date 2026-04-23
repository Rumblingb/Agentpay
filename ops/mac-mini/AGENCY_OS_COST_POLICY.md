# Agency OS Cost Policy

Agency OS should stay cheap by default and spend more only when the task has real product or revenue leverage.

## Runtime order

1. Native tools first
- repo search
- tests
- build systems
- scripts
- dashboards
- docs and artifacts already on disk

2. Local light model second
- task triage
- extraction
- note cleanup
- summarization
- route shaping

3. Local heavy model third
- bounded coding
- QA planning
- integration review
- launch copy refinement

4. Cloud review last
- architecture reviews
- launch-critical copy or UX critique
- high-stakes customer or pricing decisions
- cross-functional synthesis when the local pass is not good enough

## Default stack

- local light: `ollama/qwen2.5-coder:7b`
- local heavy: `ollama/qwen2.5-coder:14b`
- cloud review: `openai/gpt-5.4-mini`
- deep cloud review: `openai/gpt-5.4`

## Cost rules

- Do not schedule daily heavy-model chatter.
- Prefer one bounded review pass over repeated conversational looping.
- Use cloud models when the expected value is obvious: launch quality, architecture risk, conversion surfaces, or release safety.
- Batch growth and research work after hours when Bill is not the priority lane.
