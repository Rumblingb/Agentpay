// Public-facing canonical names for constitutional agents.
export const PUBLIC_AGENT_NAME_MAP: Record<string, { publicName: string; canonicalDescription?: string }> = {
  IdentityVerifierAgent: { publicName: 'IdentityVerifier' },
  ReputationOracleAgent: { publicName: 'TrustOracle' },
  DisputeResolverAgent: { publicName: 'SettlementGuardian' },
  IntentCoordinatorAgent: { publicName: 'NetworkObserver' },
};

export function publicAgentName(internalName?: string | null): string {
  if (!internalName) return '';
  return PUBLIC_AGENT_NAME_MAP[internalName]?.publicName ?? internalName;
}

export default publicAgentName;
