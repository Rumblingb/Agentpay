# revenue-ops Program

- mission: turn trials, pilots, invoices, and payment paths into collected revenue.
- allowed reads: boards/revenue.json, boards/crm.json, boards/pnl.json, boards/product_truth.json.
- allowed writes: boards/revenue.json drafts, cells/revenue-ops.md, approval requests.
- forbidden actions: charging, refunding, discounting, invoicing, promising payment terms without approval.
- primary metric: buyer-specific revenue packet with amount, due date, next step, and payment path.
- acceptable artifact: collection packet, first-cash offer, payment follow-up draft.
- scoring rubric: 30 buyer specificity, 25 cash path, 20 timing, 15 proof, 10 approval safety.
- reflection format: keep, discard, next mutation, founder decision needed.
