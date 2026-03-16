import { normalizePassport } from '../adapters/passport/passportAdapter';
import type { AgentPassport } from '../interfaces/passport';

export function getPublicPassport(p: AgentPassport): AgentPassport {
  return normalizePassport(p);
}
