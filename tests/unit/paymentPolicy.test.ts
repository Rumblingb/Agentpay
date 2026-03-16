import { evaluatePolicyConfig } from '../../src/policy/policyEngine';
import { PolicyConfig, PolicyContext } from '../../src/policy/types';

describe('payment policy engine (evaluatePolicyConfig)', () => {
  const mkContext = (amount: number, recipient?: string): PolicyContext => ({ amount, recipientAddress: recipient });

  test('allowed transaction', async () => {
    const cfg: PolicyConfig = { maxAmountPerTransaction: 1000, paymentsEnabled: true, policyVersion: 'v1' };
    const res = await evaluatePolicyConfig(cfg, mkContext(100), async () => 0);
    expect(res.decision).toBe('ALLOW');
    expect(res.reason).toBe('allowed');
    expect(res.policyVersion).toBe('v1');
  });

  test('blocked transaction by blocklist', async () => {
    const cfg: PolicyConfig = { blocklistRecipients: ['BADADDR'], paymentsEnabled: true };
    const res = await evaluatePolicyConfig(cfg, mkContext(50, 'BADADDR'), async () => 0);
    expect(res.decision).toBe('REJECT');
    expect(res.reason).toBe('recipient_blocked');
  });

  test('approval required by amount threshold', async () => {
    const cfg: PolicyConfig = { approvalRequiredAbove: 500, paymentsEnabled: true };
    const res = await evaluatePolicyConfig(cfg, mkContext(600), async () => 0);
    expect(res.decision).toBe('REQUIRES_APPROVAL');
    expect(res.reason).toBe('amount_above_threshold');
  });

  test('payments disabled', async () => {
    const cfg: PolicyConfig = { paymentsEnabled: false };
    const res = await evaluatePolicyConfig(cfg, mkContext(10), async () => 0);
    expect(res.decision).toBe('REJECT');
    expect(res.reason).toBe('payments_disabled');
  });

  test('result includes reason + policyVersion', async () => {
    const cfg: PolicyConfig = { maxAmountPerTransaction: 200, policyVersion: 'policy-42' };
    const res = await evaluatePolicyConfig(cfg, mkContext(50), async () => 0);
    expect(res.policyVersion).toBe('policy-42');
    expect(res.reason).toBe('allowed');
  });
});
