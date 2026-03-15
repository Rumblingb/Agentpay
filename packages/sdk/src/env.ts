export function readEnv(): { apiKey: string; baseUrl?: string } {
  const apiKey = process.env.AGENTPAY_API_KEY ?? '';
  const baseUrl = process.env.AGENTPAY_BASE_URL;
  if (!apiKey) {
    throw new Error('AGENTPAY_API_KEY is required for AgentPayClient.fromEnv()');
  }
  return { apiKey, baseUrl };
}
