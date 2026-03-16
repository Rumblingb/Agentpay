# `@agentpay/adapters`

Runtime-neutral capability wrappers for AgentPay.

## Capability adapter surface

The base adapter implementation in `src/` exposes a thin wrapper around
`@agentpay/sdk`:

- `createPayment(intent)`
- `verifyPayment(paymentId, txHash)`
- `handleWebhook(event)`
- `getPassport(agentId)` *(optional)*
- `attachPassport(agentId)` *(optional)*

## Tool contract layer

This package also provides a universal tool/function surface in `src/tools/`:

- Tool names: `create_payment`, `verify_payment`, `handle_webhook`, `get_passport` *(optional)*
- JSON-schema style input definitions
- Normalized tool outputs
- Tool registry + runtime-neutral executor

## Files

- `src/types.ts` – capability interfaces/types.
- `src/agentPayCapabilityAdapter.ts` – thin SDK-backed capability implementation.
- `src/tools/contracts.ts` – tool names, inputs/outputs, and schema types.
- `src/tools/registry.ts` – tool definitions and `registerAgentPayTools(...)`.
- `src/tools/executor.ts` – `executeAgentPayTool(...)`.
- `src/index.ts` – package exports.

Examples:

- `examples/adapters/genericAgentExample.ts` (capability-level create + verify flow)
- `examples/adapters/toolCallingAgentExample.ts` (tool-calling flow)
