import { Hono } from 'hono';
import type { Env, Variables } from '../types';

export const supportRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

function broLog(event: string, data: Record<string, unknown>) {
  console.log(JSON.stringify({ event, ...data, ts: new Date().toISOString() }));
}

/**
 * POST /api/support/issue
 * Accepts an issue report from the Bro app and fires to Make.com webhook.
 * Authenticated via x-bro-key (same gate as /api/concierge/intent).
 */
supportRouter.post('/issue', async (c) => {
  if (c.env.BRO_CLIENT_KEY) {
    const clientKey = c.req.header('x-bro-key') ?? '';
    if (clientKey !== c.env.BRO_CLIENT_KEY) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
  }
  const body = await c.req.json<{
    intentId: string;
    bookingRef?: string | null;
    description: string;
    hirerId?: string;
  }>();

  const { intentId, bookingRef, description, hirerId } = body ?? {};
  if (!intentId || !description) {
    return c.json({ error: 'intentId and description required' }, 400);
  }

  broLog('issue_report', { intentId, bookingRef, hirerId, descriptionLen: description.length });

  if (c.env.MAKECOM_WEBHOOK_URL) {
    c.executionCtx.waitUntil(
      fetch(c.env.MAKECOM_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'issue_report',
          intentId,
          bookingRef: bookingRef ?? null,
          description,
          hirerId: hirerId ?? null,
          reportedAt: new Date().toISOString(),
        }),
      }).catch(() => {}),
    );
  }

  return c.json({ ok: true });
});
