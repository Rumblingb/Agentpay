# Post-PR7 Adapter Implementation Plan

This short plan outlines next steps for adapter implementations after PR7:

1. Implement `Adapter.init()` and `createPayment()` for each provider.
2. Add adapter config + credential storage in `packages/adapters`.
3. Wire adapters into the Worker reconciliation/verify flows behind feature flags.
4. Add focused adapter integration tests and e2e smoke tests.

The goal is to keep adapter work out of PR7 core scope and land it in follow-up
PRs where integration and credentials can be managed safely.
