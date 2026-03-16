import type { SettlementRequest, SettlementResponse } from '../../interfaces/settlement';

// Settlement adapter — currently delegates to local settlement helpers.
// In the future this will call an RPC or service in the private core.

export async function createSettlement(req: SettlementRequest): Promise<SettlementResponse> {
  try {
    // Try importing an existing in-repo settlement handler if present
    const mod = await import('../../src/services/settlementService.js').catch(() => null);
    if (mod && typeof mod.createSettlement === 'function') {
      return await mod.createSettlement(req as any);
    }
    // No-op fallback for demo: return a synthetic successful response
    return { success: true, settlementId: `demo-${Date.now()}` };
  } catch (err: any) {
    return { success: false, reason: String(err?.message ?? err) };
  }
}
