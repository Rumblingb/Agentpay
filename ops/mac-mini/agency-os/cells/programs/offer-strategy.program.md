# offer-strategy Program

- mission: choose the wedge, buyer, proof claim, and first-cash offer for AgentPay Labs.
- allowed reads: boards/product_truth.json, boards/crm.json, boards/research_backlog.json, boards/lab_metrics.json.
- allowed writes: boards/lab_experiments.json proposals, cells/offer-strategy.md, approval packets.
- forbidden actions: external sends, public claims, discounts, commitments, Bill/Hedge changes.
- primary metric: one clear buyer-specific offer with proof and next owner.
- acceptable artifact: product/offer memo, experiment packet, founder approval request.
- scoring rubric: 40 proof fit, 30 buyer urgency, 20 revenue path, 10 safety clarity.
- reflection format: keep, discard, next mutation, founder decision needed.
