# Content Engine Staging Registry
Date staged: 2026-06-21 (by Hermes, Bee-dispatched content-engine task)

## Directory layout

```
ops/content-engine/staged/
├── README.md               ← this file
├── x-posts/                ← X / Twitter (destination-bound)
│   ├── x-001-build-note.md        [PUBLISHED: 2026-06-20]
│   ├── x-002-bee-hackathon.md     [STAGED]
│   ├── x-003-voice-trio-live.md   [STAGED]
│   ├── x-004-power-cabinet-fable.md [STAGED]
│   └── x-005-ledger-design.md     [STAGED]
├── linkedin-posts/         ← LinkedIn (destination-bound)
│   ├── linkedin-001-week-in-review.md      [STAGED]
│   ├── linkedin-002-governed-execution.md  [STAGED]
│   └── linkedin-003-ledger-build.md        [STAGED]
├── bulls-bears/            ← YouTube Shorts @bullvvbear
│   ├── bb-001-ai-capex.md       [PUBLISHED: 2026-06-19]
│   ├── bb-002-bitcoin-flush.md  [PUBLISHED: 2026-06-19]
│   └── bb-003-oil-head-fake.md  [PUBLISHED: 2026-06-19]
├── bee-hackathon/          ← Build-log / hackathon framing
│   ├── bee-001-hackathon-thesis.md  [STAGED]
│   └── bee-002-butterfly-built.md  [STAGED]
├── voice-launch/           ← Voice trio store launch
│   ├── voice-001-trio-store-launch.md  [STAGED]
│   └── voice-002-oqd-android.md        [STAGED]
└── shortform-pipeline/     ← Shorts/YouTube pipeline
    └── pipeline-001-shortform-gate.md  [STAGED]
```

Total staged: 15 posts across 6 channels.
Already published: 4 (x-001, bb-001/002/003).
Requires action-time approval before publish: 11.

## Channel routing contract

| Post ID         | Channel | Destination                                        | Gate                        |
|-----------------|---------|----------------------------------------------------|-----------------------------|
| x-001-build-note| X       | @baskaran_r9798 via x_4106d81b… (native, fallback)| PUBLISHED                   |
| x-002-bee-hackathon | X   | @baskaran_r9798 via x_4106d81b…                   | STAGED – approval required  |
| x-003-voice-trio-live | X  | @baskaran_r9798 via x_4106d81b…                   | STAGED – approval required  |
| x-004-power-cabinet-fable | X | @baskaran_r9798 via x_4106d81b… | STAGED – approval required  |
| x-005-ledger-design | X   | @baskaran_r9798 via x_4106d81b…                   | STAGED – approval required  |
| linkedin-001    | LinkedIn| Rajiv Baskaran via cmossyk7o0001szlrcuao3zxu     | STAGED – approval required  |
| linkedin-002    | LinkedIn| Rajiv Baskaran via cmossyk7o0001szlrcuao3zxu     | STAGED – approval required  |
| linkedin-003    | LinkedIn| Rajiv Baskaran via cmossyk7o0001szlrcuao3zxu     | STAGED – approval required  |
| bb-001/002/003 | YT Shorts| @bullvvbear / UC0gcAWsLyM6V4E2dlDzl5dg         | PUBLISHED                   |
| bee-001/002    | X       | @baskaran_r9798 via x_4106d81b…                   | STAGED – approval required  |
| voice-001/002  | X + LI  | X → x_4106d81b…; LI → cmossyk7o0001szlrcuao3zxu  | STAGED – approval required  |
| pipeline-001   | X       | @baskaran_r9798 via x_4106d81b…                   | STAGED – approval required  |

## Non-publishable channels (not staged, no draft issued)

- **WC 2026 Clips** — HOLD per `DISTRIBUTION_RELEASE_BOARD_2026-06-18.md`. Subtitle repair + full-watch/audio QA outstanding. No draft issued.
- **TikTok / Instagram / Facebook** — no verified Postiz destination. No draft issued until OAuth + lane proof completes.
- **Bull & Bear future batches (V19, V20)** — HOLD per existing gates. No new drafts.

## Safety notes

- No draft was sent to any external API, email, Discord, or OAuth session.
- No hedge/Bill/trading material was read, authored, or referenced.
- No git commit was made.
- All STAGED posts include destination-bound `destination_id` for the bridge `/social-post` approval guard already in production.
