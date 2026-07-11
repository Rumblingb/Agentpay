---
post_id: pipeline-001-shortform-gate
channel: x  (PRIMARY)
handle: @baskaran_r9798
status: STAGED
published_url: null
date: null
char_count: 248
audience: engineering / agent ops
gate: action_time_approval
destination_id: x_4106d81b-2b79-45ca-8e1c-2d7e374fbf8b
---

We rebuilt the YouTube Shorts release gate this week.

Before: drafts landed in a queue with no identity check, no source ledger, no caption or audio clearance.
Now: every release packet must clear six checks — identity, source, caption, audio, creative score, mobile review — before it reaches an approval queue.

Fail-closed. No exceptions.

Addressed: WC clipper now defaults to metadata-only research. Any stamped research output is DO_NOT_PUBLISH. No direct Postiz calls.

Long videos are the monetization bridge. Shorts are the discovery layer.

github.com/Rumblingb
