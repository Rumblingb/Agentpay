/**
 * RCM Daily Briefing Cron — fires within the hourly `0 * * * *` slot,
 * gated to UTC hour 14 (2:00–2:59 PM UTC / 10:00 AM ET).
 *
 * For each merchant with at least one active RCM workspace, queries the
 * same work-item / exception data used by GET /api/rcm/daily-briefing,
 * generates a 3–5 sentence AI briefing via Haiku (or plain-text fallback),
 * then sends the result to the merchant's registered email via Resend.
 */

import type { Env } from '../types';
import { createDb } from '../lib/db';

type MerchantRow = { merchant_id: string; email: string | null; workspace_name: string };
type BriefingUrgentRow = { title: string; payer_name: string | null; amount_at_risk: string | null; priority: string };
type BriefingExcRow = { severity: string; count: string };
type BriefingCountRow = { count: string };

export async function runRcmDailyBriefing(env: Env): Promise<void> {
  if (new Date().getUTCHours() !== 14) return;
  if (!env.RESEND_API_KEY) { console.warn('[rcm-briefing-cron] RESEND_API_KEY not set — skipping'); return; }

  const sql = createDb(env);
  try {
    const merchants = await sql<MerchantRow[]>`
      SELECT DISTINCT w.merchant_id, m.email, w.name AS workspace_name
      FROM rcm_workspaces w
      JOIN merchants m ON m.id = w.merchant_id
      WHERE w.status = 'active'
      LIMIT 50
    `;

    for (const merchant of merchants) {
      try {
        if (!merchant.email) continue;

        const [urgentItems, exceptionStats, autoClosedLast24h] = await Promise.all([
          sql<BriefingUrgentRow[]>`
            SELECT title, payer_name, amount_at_risk, priority
            FROM rcm_work_items
            WHERE merchant_id = ${merchant.merchant_id}
              AND status IN ('human_review_required','awaiting_qa','blocked')
              AND priority IN ('urgent','high')
            ORDER BY
              CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
              amount_at_risk DESC NULLS LAST
            LIMIT 5
          `,
          sql<BriefingExcRow[]>`
            SELECT e.severity, COUNT(*)::text AS count
            FROM rcm_exceptions e
            JOIN rcm_work_items w ON e.work_item_id = w.work_item_id
            WHERE w.merchant_id = ${merchant.merchant_id}
              AND e.resolved_at IS NULL
            GROUP BY e.severity
          `,
          sql<BriefingCountRow[]>`
            SELECT COUNT(*)::text AS count
            FROM rcm_work_items
            WHERE merchant_id = ${merchant.merchant_id}
              AND status = 'auto_closed'
              AND updated_at > NOW() - INTERVAL '24 hours'
          `,
        ]);

        const autoCount = Number(autoClosedLast24h[0]?.count ?? 0);
        const criticalExc = Number(exceptionStats.find(e => e.severity === 'critical')?.count ?? 0);
        const highExc = Number(exceptionStats.find(e => e.severity === 'high')?.count ?? 0);

        let briefingText: string;

        if (env.ANTHROPIC_API_KEY) {
          const itemsSummary = urgentItems.length > 0
            ? urgentItems
                .map(i => `- ${i.title}${i.payer_name ? ` (${i.payer_name})` : ''}, $${i.amount_at_risk ?? 0}, ${i.priority}`)
                .join('\n')
            : 'No urgent items.';

          try {
            const resp = await fetch('https://api.anthropic.com/v1/messages', {
              method: 'POST',
              headers: {
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 256,
                system: [{ type: 'text', text: 'You write morning briefings for a medical billing manager. 3–5 sentences. Start with most urgent. Concise, specific, no pleasantries.', cache_control: { type: 'ephemeral' } }],
                messages: [{ role: 'user', content: `Today:\nUrgent/high items needing attention (${urgentItems.length}):\n${itemsSummary}\n\nOpen exceptions: ${criticalExc} critical, ${highExc} high\nAuto-resolved in last 24h: ${autoCount}` }],
              }),
              signal: AbortSignal.timeout(20_000),
            });
            const data = await resp.json() as { content?: Array<{ text: string }> };
            briefingText = data?.content?.[0]?.text ?? '';
          } catch {
            briefingText = '';
          }

          if (!briefingText) {
            briefingText = `${urgentItems.length} item${urgentItems.length !== 1 ? 's' : ''} need attention · ${autoCount} auto-resolved today`;
          }
        } else {
          briefingText = `${urgentItems.length} item${urgentItems.length !== 1 ? 's' : ''} need attention · ${autoCount} auto-resolved today`;
        }

        const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#000000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:520px;margin:0 auto;padding:32px 24px">
    <p style="color:#4ade80;font-size:12px;font-weight:600;letter-spacing:0.08em;margin:0 0 24px 0;text-transform:uppercase">Daily Briefing</p>
    <h1 style="color:#f8fafc;font-size:20px;font-weight:600;margin:0 0 8px 0">${merchant.workspace_name}</h1>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 32px 0">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</p>
    <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:24px;margin-bottom:24px">
      <p style="color:#f8fafc;font-size:15px;line-height:1.6;margin:0">${briefingText.replace(/\n/g, '<br>')}</p>
    </div>
    <div style="display:flex;gap:16px;margin-bottom:32px">
      <div style="flex:1;background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;text-align:center">
        <p style="color:#f8fafc;font-size:24px;font-weight:700;margin:0 0 4px 0">${urgentItems.length}</p>
        <p style="color:#94a3b8;font-size:12px;margin:0">Items need attention</p>
      </div>
      <div style="flex:1;background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;text-align:center">
        <p style="color:#f8fafc;font-size:24px;font-weight:700;margin:0 0 4px 0">${criticalExc + highExc}</p>
        <p style="color:#94a3b8;font-size:12px;margin:0">Open exceptions</p>
      </div>
      <div style="flex:1;background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;text-align:center">
        <p style="color:#4ade80;font-size:24px;font-weight:700;margin:0 0 4px 0">${autoCount}</p>
        <p style="color:#94a3b8;font-size:12px;margin:0">Auto-resolved today</p>
      </div>
    </div>
    <a href="https://app.agentpay.so/rcm" style="display:block;background:#4ade80;color:#000000;font-weight:600;font-size:14px;text-align:center;padding:14px 24px;border-radius:12px;text-decoration:none">View dashboard →</a>
    <p style="color:#334155;font-size:12px;text-align:center;margin-top:24px">Ace Billing · AgentPay</p>
  </div>
</body>
</html>`.trim();

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'Ace Billing <notifications@agentpay.so>',
            to: [merchant.email],
            subject: `Your billing briefing — ${merchant.workspace_name}`,
            html,
          }),
        });

        console.info(`[rcm-briefing-cron] sent to merchant_id ${merchant.merchant_id}`);
      } catch (err) {
        console.error(`[rcm-briefing-cron] failed for merchant_id ${merchant.merchant_id}:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    await sql.end();
  }
}
