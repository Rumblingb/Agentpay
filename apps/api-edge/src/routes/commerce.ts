import { Hono } from 'hono';

import type { Env, Variables } from '../types';
import {
  CommerceDecisionError,
  evaluateCommerceDecision,
  signCommerceDecision,
  verifyCommerceDecisionSignature,
  type CommerceDecision,
} from '../lib/commerceDecision';
import { authenticateApiKey } from '../middleware/auth';
import { auditCatalogTruth, CatalogTruthError } from '../lib/catalogTruth';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

router.get('/capabilities', (c) => c.json({
  schema: 'agentpay.commerce-capabilities/1.0',
  product: 'AgentPay Choice Receipt',
  role: 'neutral buyer trust and execution control plane',
  protocols: ['MCP', 'AP2', 'ACP', 'UCP-ready merchant handoff'],
  hardControls: [
    'currency',
    'budget',
    'category',
    'merchant allowlist/blocklist',
    'refundability',
    'return window',
    'delivery time',
    'evidence freshness',
    'human approval',
  ],
  retention: 'Evaluation requests and choice receipts are not stored by this endpoint.',
}));

router.use('/evaluate', authenticateApiKey);
router.use('/catalog/audit', authenticateApiKey);

router.post('/catalog/audit', async (c) => {
  try {
    return c.json({ report: auditCatalogTruth(await c.req.json()) });
  } catch (error: unknown) {
    if (error instanceof CatalogTruthError || error instanceof SyntaxError) {
      return c.json({
        error: 'INVALID_REQUEST',
        message: error instanceof CatalogTruthError ? error.message : 'A JSON body is required',
      }, 400);
    }
    console.error('[commerce] catalog audit failed');
    return c.json({ error: 'INTERNAL_ERROR', message: 'Could not audit catalog truth' }, 500);
  }
});

router.post('/evaluate', async (c) => {
  try {
    const body = await c.req.json();
    const decision = await evaluateCommerceDecision(body);
    const value = await signCommerceDecision(decision, c.env.AGENTPAY_SIGNING_SECRET);
    return c.json({
      decision,
      signature: {
        algorithm: 'HMAC-SHA256',
        keyId: 'agentpay-commerce-v1',
        value,
      },
      nextAction: decision.proposedMandate
        ? {
            type: decision.approval.required ? 'approval_required' : 'mandate_ready',
            mandate: decision.proposedMandate,
          }
        : {
            type: 'research_required',
            rejected: decision.rejected.map((item) => ({
              candidateId: item.candidate.id,
              reasonCodes: item.reasons.map((reason) => reason.code),
            })),
          },
    });
  } catch (error: unknown) {
    if (error instanceof CommerceDecisionError) {
      const status = error.code === 'SIGNING_UNAVAILABLE' ? 503 : 400;
      return c.json({ error: error.code, message: error.message }, status);
    }
    if (error instanceof SyntaxError) return c.json({ error: 'INVALID_REQUEST', message: 'A JSON body is required' }, 400);
    console.error('[commerce] decision evaluation failed');
    return c.json({ error: 'INTERNAL_ERROR', message: 'Could not evaluate the purchase decision' }, 500);
  }
});

router.post('/verify', async (c) => {
  try {
    const body = await c.req.json() as { decision?: CommerceDecision; signature?: string };
    if (!body.decision || typeof body.signature !== 'string') {
      return c.json({ error: 'INVALID_REQUEST', message: 'decision and signature are required' }, 400);
    }
    const valid = await verifyCommerceDecisionSignature(
      body.decision,
      body.signature,
      c.env.AGENTPAY_SIGNING_SECRET,
    );
    return c.json({ valid, decisionId: body.decision.decisionId ?? null });
  } catch (error: unknown) {
    if (error instanceof CommerceDecisionError && error.code === 'SIGNING_UNAVAILABLE') {
      return c.json({ error: error.code, message: error.message }, 503);
    }
    return c.json({ error: 'INVALID_REQUEST', message: 'A valid JSON body is required' }, 400);
  }
});

export { router as commerceRouter };
