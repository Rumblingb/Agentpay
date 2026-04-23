# Agency OS Hermes Cron Map

Hermes runs local-only Agency OS jobs. These jobs write artifacts and board updates; they do not send, publish, spend, charge, deploy, commit, discount, refund, or move money.

Bill remains a separate Hedge lane.

## Jobs

| Job | Cadence | Owns | Primary artifacts |
| --- | --- | --- | --- |
| `agency-os-chief-of-staff` | daily 07:00 IST | merged company operating priority | relevant cell file, relevant board, `STATUS.md` |
| `agency-os-outbound-packet` | daily 09:30 IST | reachable outbound and follow-up | `boards/crm.json`, `boards/send_queue.json`, `cells/outbound-ops.md` |
| `agency-os-revenue-ops` | daily 10:00 IST | payment requests, collections, conversion, renewal | `boards/revenue.json`, `boards/crm.json`, `boards/send_queue.json`, `cells/revenue-ops.md` |
| `agency-os-customer-success` | daily 11:30 IST | design partner/customer loop | `boards/customer_success.json`, `boards/crm.json`, `cells/customer-ops.md` |
| `agency-os-partner-packet` | Mon/Wed/Fri 15:00 IST | provider, host, API, and channel partner packets | `boards/partnerships.json`, `cells/partnerships-ops.md` |
| `agency-os-content-draft` | daily 16:30 IST | media, launch, and distribution drafts | `boards/content_queue.json`, `cells/media-ops.md` |
| `agency-os-weekly-review` | Friday 17:00 IST | weekly startup operating review | `WEEKLY_REVIEW.md`, `STATUS.md` |
| `agency-os-ad-experiment` | Tuesday 14:00 IST | no-spend ad experiment packets | `boards/ads_experiments.json`, `cells/ads-ops.md` |

## Control Boards

- `boards/product_truth.json`: repo/demo/product proof and blockers.
- `boards/approvals.json`: founder approval queue.
- `boards/pnl.json`: revenue, cost, and reinvestment controls.
- `boards/platform_submissions.json`: OpenAI/Claude/MCP directory submission tracker.
- `boards/research_backlog.json`: research questions assigned to cells.

## Runtime Rule

Every job should run `ops/mac-mini/bin/agency-os-sync` after a meaningful update so founder-facing status stays current.
