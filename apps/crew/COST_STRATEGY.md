# AI Agency — Cost Strategy

## Current per-booking AI cost (Bro)

| Step | Model | Tokens (est) | Cost |
|---|---|---|---|
| Phase 1 — plan + narrate | Claude opus-4-6 | ~3,000 in / 800 out | ~$0.051 |
| Phase 2 — confirm narration | Claude opus-4-6 | ~1,500 in / 300 out | ~$0.024 |
| STT (voice) | CF Workers AI Whisper | ~0.5MB audio | ~$0.0002 |
| **Total per booking** | | | **~$0.075** |

At £0 service fee (beta), this is absorbed cost. At 40 bookings/month = **~$3/month** in AI.

---

## Crew AI cost (three-agent pipeline)

| Agent | Model | Cost per run |
|---|---|---|
| Darwin (reason) | Claude opus-4-6 | ~$0.05 |
| Codex (extract) | GPT-4o | ~$0.005 |
| Claw (fulfill) | GPT-4o-mini | ~$0.0005 |
| **Total per crew run** | | **~$0.056** |

Crew is only used for complex multi-step tasks — not every Bro message.

---

## Free / cheap model alternatives

### Tier 1 — Truly free (no API cost)
| Model | Where | Use case |
|---|---|---|
| **Nemotron Super 49B** | NVIDIA API (free tier, 40 req/day) | Reasoning fallback |
| **Llama 3.3 70B** | CF Workers AI (included in Workers plan) | Classification, simple tasks |
| **Gemini 1.5 Flash** | Google AI Studio (free tier: 1,500 req/day) | Fast responses, cheap extraction |
| **Mistral 7B** | CF Workers AI (included) | Short summaries |

### Tier 2 — Cheap (sub-cent per call)
| Model | Cost per 1M tokens | Best for |
|---|---|---|
| GPT-4o-mini | $0.15 in / $0.60 out | Classification, formatting |
| Claude haiku-4-5 | $0.80 in / $4 out | Fast reasoning, cheaper than Opus |
| Gemini 1.5 Flash | $0.075 in / $0.30 out | Extraction, quick answers |

---

## Recommended cost-optimised routing

```
User message
    │
    ▼
[classify] ← GPT-4o-mini ($0.0001) or CF Workers AI Llama (free)
    │
    ├── simple followup / status check
    │       → Claude haiku (fast, cheap: ~$0.002)
    │
    ├── train search + booking
    │       → Claude opus (best reasoning: ~$0.05)
    │
    └── data extraction only
            → GPT-4o-mini (~$0.001) or Gemini Flash (free tier)
```

**Savings vs current:** Routing simple followups to Haiku instead of Opus saves ~60% per session.

---

## Immediate changes to make

### 1. Add Claude Haiku for simple turns
In `concierge.ts` — if the intent is `followup` or `query_info`, use `claude-haiku-4-5-20251001` instead of `claude-opus-4-6`.

**Saving: ~$0.03 per simple message (60% of all messages)**

### 2. Use CF Workers AI Llama for classification
CF Workers AI is included in the Workers paid plan ($5/month flat).
Use `@cf/meta/llama-3.3-70b-instruct-fp8-fast` for intent classification — **free**.

### 3. Gemini Flash for extraction
Google AI Studio free tier: 1,500 requests/day free.
Use for the Codex agent's extraction task in the crew pipeline.

### 4. Cap crew pipeline usage
Only trigger the full three-agent crew for:
- New booking requests (not followups)
- Requests with ambiguous routing (multiple stations, date unclear)

Estimated crew usage: ~20% of sessions → **crew cost is ~$0.011 per session average**.

---

## Monthly cost at scale

| Volume | Current (all Opus) | Optimised routing |
|---|---|---|
| 40 bookings | ~$3 | ~$1.20 |
| 200 bookings | ~$15 | ~$6 |
| 1,000 bookings | ~$75 | ~$30 |
| 10,000 bookings | ~$750 | ~$300 |

**Break-even with £5 service fee:** ~6 bookings/month (optimised).

---

## Action items

- [ ] Switch classification in `concierge.ts` to `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (free)
- [ ] Add `claude-haiku-4-5-20251001` path for `followup` / `query_info` intents
- [ ] Add Gemini Flash key to crew `.env` for extraction tasks (free 1,500/day)
- [ ] Set NVIDIA NIM API key for Nemotron fallback (free 40 req/day)
- [ ] Monitor token usage via CF Workers logs — add token count to `broLog`
