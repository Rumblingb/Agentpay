import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import {
  buildHostedActionResumeRedirect,
  completeHostedActionSession,
  getHostedActionSession,
  type HostedActionSessionStatus,
} from '../lib/hostedActionSessions';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveActionStatus(value: string | null): HostedActionSessionStatus {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'success' || normalized === 'succeeded' || normalized === 'paid') {
    return 'completed';
  }
  if (normalized === 'failed' || normalized === 'failure') return 'failed';
  if (normalized === 'expired') return 'expired';
  return 'completed';
}

router.get('/:sessionId/resume', async (c) => {
  const sessionId = c.req.param('sessionId');
  const resumeToken = asString(c.req.query('token'));
  if (!resumeToken) {
    return c.text('Missing resume token.', 400);
  }

  const providerStatus = asString(c.req.query('status'))
    ?? asString(c.req.query('payment_status'))
    ?? asString(c.req.query('razorpay_payment_link_status'));

  try {
    const session = await completeHostedActionSession(c.env, {
      sessionId,
      resumeToken,
      status: resolveActionStatus(providerStatus),
      resultPayload: Object.fromEntries(
        Array.from(new URL(c.req.url).searchParams.entries())
          .filter(([key]) => key !== 'token'),
      ),
      metadata: {
        resumedFrom: 'public_resume_endpoint',
      },
    });

    return buildHostedActionResumeRedirect(session, {
      fallbackText: 'AgentPay recorded this action. Return to your host to resume the task.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'HOSTED_ACTION_SESSION_INVALID') {
      return c.text('Invalid action session.', 400);
    }
    if (message === 'HOSTED_ACTION_SESSION_EXPIRED') {
      return c.text('This action session has expired. Restart the task from your host.', 410);
    }
    console.error('[actions] resume failed:', message);
    return c.text('Failed to resume this action session.', 500);
  }
});

router.use('*', authenticateApiKey);

router.get('/:sessionId', async (c) => {
  const merchant = c.get('merchant');
  const session = await getHostedActionSession(c.env, merchant.id, c.req.param('sessionId'));
  if (!session) {
    return c.json({ error: 'Action session not found' }, 404);
  }

  return c.json({
    sessionId: session.sessionId,
    actionType: session.actionType,
    title: session.title,
    summary: session.summary,
    status: session.status,
    displayPayload: session.displayPayload,
    resultPayload: session.resultPayload,
    metadata: session.metadata,
    expiresAt: session.expiresAt,
    completedAt: session.completedAt,
    usedAt: session.usedAt,
    updatedAt: session.updatedAt,
  });
});

export { router as actionsRouter };
