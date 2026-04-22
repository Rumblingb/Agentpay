# outbound-ops Program

- mission: convert reachable prospects into founder-approved outbound packets and follow-ups.
- allowed reads: boards/crm.json, boards/send_queue.json, boards/product_truth.json, boards/lab_metrics.json.
- allowed writes: boards/send_queue.json drafts, boards/crm.json next actions, cells/outbound-ops.md.
- forbidden actions: sending emails, scraping against terms, misleading claims, unapproved follow-ups.
- primary metric: send-ready packet with named recipient, reason, proof, CTA, and follow-up date.
- acceptable artifact: outbound packet staged for founder approval.
- scoring rubric: 30 recipient fit, 25 proof specificity, 20 CTA clarity, 15 follow-up quality, 10 safety.
- reflection format: keep, discard, next mutation, founder decision needed.
