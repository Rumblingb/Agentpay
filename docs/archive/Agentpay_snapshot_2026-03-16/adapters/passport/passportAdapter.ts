import type { AgentPassport } from '../../interfaces/passport';

// Passport adapter — currently passed through to existing demo fixtures.
export function normalizePassport(p: AgentPassport): AgentPassport {
  // Future: map private passport representation to public schema
  return p;
}
