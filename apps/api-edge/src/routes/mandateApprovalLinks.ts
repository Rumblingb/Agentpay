/**
 * mandateApprovalLinks.ts — public mandate approval link handling.
 * Serves the human-readable approval page at /api/public/mandates/:intentId
 *
 * The intentId IS the access token — UUID v4 (~122 bits entropy) is not guessable.
 * No API key required; this is the human-in-the-loop surface.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

interface IntentRow {
  id: string;
  principal_id: string;
  operator_id: string;
  source: string;
  objective: string;
  constraints_json: unknown;
  status: string;
  recommendation_json: unknown;
  actor_id: string | null;
  approved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function statusLabel(status: string): { text: string; color: string } {
  const map: Record<string, { text: string; color: string }> = {
    draft: { text: 'Draft', color: '#6b7280' },
    planned: { text: 'Awaiting Approval', color: '#f59e0b' },
    awaiting_approval: { text: 'Awaiting Approval', color: '#f59e0b' },
    approved: { text: 'Approved', color: '#10b981' },
    executing: { text: 'Executing', color: '#3b82f6' },
    completed: { text: 'Completed', color: '#10b981' },
    rejected: { text: 'Rejected', color: '#ef4444' },
    cancelled: { text: 'Cancelled', color: '#6b7280' },
    failed: { text: 'Failed', color: '#ef4444' },
  };
  return map[status] ?? { text: status, color: '#6b7280' };
}

function formatConstraints(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const c = raw as Record<string, unknown>;
  const lines: string[] = [];
  if (c.budget) lines.push(`Budget cap: ${JSON.stringify(c.budget)}`);
  if (c.currency) lines.push(`Currency: ${c.currency}`);
  if (c.maxAmountPence) lines.push(`Max amount: ${Number(c.maxAmountPence) / 100} ${c.currency ?? 'GBP'}`);
  if (c.deadline) lines.push(`Deadline: ${c.deadline}`);
  if (c.approvalThreshold) lines.push(`Approval threshold: ${c.approvalThreshold}`);
  const rest = Object.entries(c).filter(([k]) => !['budget', 'currency', 'maxAmountPence', 'deadline', 'approvalThreshold'].includes(k));
  for (const [k, v] of rest) lines.push(`${k}: ${JSON.stringify(v)}`);
  return lines.join('\n');
}

function renderPage(intent: IntentRow, message?: string, messageType?: 'success' | 'error'): string {
  const { text: statusText, color: statusColor } = statusLabel(intent.status);
  const isApprovable = ['planned', 'awaiting_approval'].includes(intent.status);
  const constraints = formatConstraints(intent.constraints_json);
  const rec = intent.recommendation_json && typeof intent.recommendation_json === 'object'
    ? (intent.recommendation_json as Record<string, unknown>)
    : null;
  const recSummary = rec?.summary ?? rec?.recommendation ?? rec?.plan ?? null;
  const createdDate = new Date(intent.created_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AgentPay — Mandate Approval</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #050607; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; min-height: 100vh; display: flex; align-items: flex-start; justify-content: center; padding: 32px 16px; }
  .card { background: #0d0d0d; border: 1px solid #1c1c1c; border-radius: 16px; padding: 32px; max-width: 560px; width: 100%; }
  .logo { display: flex; align-items: center; gap: 8px; margin-bottom: 24px; }
  .logo-mark { width: 28px; height: 28px; background: #22c55e; border-radius: 6px; }
  .logo-text { font-size: 15px; font-weight: 700; color: #f9fafb; letter-spacing: -0.02em; }
  h1 { font-size: 20px; font-weight: 700; color: #f9fafb; margin-bottom: 4px; letter-spacing: -0.02em; }
  .sub { font-size: 13px; color: #6b7280; margin-bottom: 24px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 4px 10px; border-radius: 20px; border: 1px solid currentColor; margin-bottom: 24px; }
  .section { margin-bottom: 20px; }
  .section-label { font-size: 11px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 6px; }
  .section-value { font-size: 14px; color: #d1d5db; line-height: 1.6; white-space: pre-wrap; }
  .divider { border: none; border-top: 1px solid #1c1c1c; margin: 24px 0; }
  .form-label { font-size: 13px; color: #9ca3af; margin-bottom: 6px; display: block; }
  input[type=text], input[type=email] { width: 100%; background: #0b0b0b; border: 1px solid #2a2a2a; border-radius: 8px; padding: 10px 14px; color: #f9fafb; font-size: 14px; outline: none; transition: border-color 0.15s; }
  input:focus { border-color: #22c55e; }
  .btn-row { display: flex; gap: 12px; margin-top: 20px; }
  .btn { flex: 1; padding: 12px; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; border: none; transition: opacity 0.15s; }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn-approve { background: #22c55e; color: #050607; }
  .btn-approve:hover:not(:disabled) { background: #16a34a; }
  .btn-reject { background: transparent; color: #ef4444; border: 1px solid #ef4444; }
  .btn-reject:hover:not(:disabled) { background: rgba(239,68,68,0.08); }
  .msg { padding: 12px 16px; border-radius: 10px; font-size: 13px; margin-bottom: 20px; }
  .msg-success { background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.2); color: #6ee7b7; }
  .msg-error { background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2); color: #fca5a5; }
  .footer { margin-top: 28px; font-size: 11px; color: #374151; text-align: center; }
  .meta-row { display: flex; gap: 24px; margin-bottom: 20px; }
  .meta-item { flex: 1; }
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <div class="logo-mark"></div>
    <span class="logo-text">AgentPay</span>
  </div>

  <h1>Mandate Approval</h1>
  <p class="sub">An AI agent is requesting your authorisation before executing this action.</p>

  <div class="badge" style="color:${statusColor}">
    <span style="width:6px;height:6px;border-radius:50%;background:${statusColor};display:inline-block"></span>
    ${statusText}
  </div>

  ${message ? `<div class="msg msg-${messageType ?? 'success'}">${message}</div>` : ''}

  <div class="section">
    <div class="section-label">What the agent wants to do</div>
    <div class="section-value">${intent.objective.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>

  ${constraints ? `
  <div class="section">
    <div class="section-label">Constraints &amp; budget</div>
    <div class="section-value" style="font-family:monospace;font-size:13px">${constraints.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>` : ''}

  ${recSummary ? `
  <div class="section">
    <div class="section-label">Agent's plan</div>
    <div class="section-value">${String(recSummary).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
  </div>` : ''}

  <div class="meta-row">
    <div class="meta-item">
      <div class="section-label">Requested by</div>
      <div class="section-value" style="font-family:monospace;font-size:12px">${intent.principal_id.replace(/</g, '&lt;')}</div>
    </div>
    <div class="meta-item">
      <div class="section-label">Created</div>
      <div class="section-value">${createdDate}</div>
    </div>
  </div>

  ${isApprovable ? `
  <hr class="divider" />
  <form id="approvalForm">
    <label class="form-label" for="actorId">Your name or email (confirms who approved)</label>
    <input type="text" id="actorId" name="actorId" placeholder="e.g. jane@example.com" autocomplete="email" required />
    <div class="btn-row">
      <button type="submit" name="action" value="approve" class="btn btn-approve" id="approveBtn">Approve</button>
      <button type="submit" name="action" value="reject" class="btn btn-reject" id="rejectBtn">Reject</button>
    </div>
  </form>
  <script>
    const form = document.getElementById('approvalForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const action = e.submitter?.value ?? 'approve';
      const actorId = document.getElementById('actorId').value.trim();
      if (!actorId) { alert('Please enter your name or email.'); return; }
      document.getElementById('approveBtn').disabled = true;
      document.getElementById('rejectBtn').disabled = true;
      try {
        const res = await fetch(window.location.pathname + '/' + action, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ actorId }),
        });
        const data = await res.json();
        if (res.ok) {
          window.location.reload();
        } else {
          alert(data.error ?? 'Something went wrong. Please try again.');
          document.getElementById('approveBtn').disabled = false;
          document.getElementById('rejectBtn').disabled = false;
        }
      } catch {
        alert('Network error. Please try again.');
        document.getElementById('approveBtn').disabled = false;
        document.getElementById('rejectBtn').disabled = false;
      }
    });
  </script>` : intent.status === 'approved' ? `
  <hr class="divider" />
  <div class="msg msg-success">Approved by ${(intent.actor_id ?? 'unknown').replace(/</g, '&lt;')} on ${intent.approved_at ? new Date(intent.approved_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</div>` : ''}

  <div class="footer">Secured by AgentPay &middot; agentpay.so</div>
</div>
</body>
</html>`;
}

// GET /api/public/mandates/:intentId — render HTML approval page
router.get('/:intentId', async (c) => {
  const intentId = c.req.param('intentId');
  const sql = createDb(c.env);
  try {
    const rows = await sql<IntentRow[]>`
      SELECT * FROM ace_intents WHERE id = ${intentId}::uuid LIMIT 1
    `;
    if (!rows.length) {
      return c.html(`<!doctype html><html><body style="background:#050607;color:#e5e7eb;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;"><div style="text-align:center"><h2>Mandate not found</h2><p style="color:#6b7280;margin-top:8px">This link may have expired or the mandate ID is invalid.</p></div></body></html>`, 404);
    }
    return c.html(renderPage(rows[0]));
  } catch {
    return c.html(`<!doctype html><html><body style="background:#050607;color:#e5e7eb;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;"><div style="text-align:center"><h2>Error loading mandate</h2><p style="color:#6b7280;margin-top:8px">Please try again.</p></div></body></html>`, 500);
  } finally {
    await sql.end();
  }
});

// POST /api/public/mandates/:intentId/approve — approve the intent
router.post('/:intentId/approve', async (c) => {
  const intentId = c.req.param('intentId');
  let body: { actorId?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const actorId = typeof body.actorId === 'string' ? body.actorId.trim() : '';
  if (!actorId) return c.json({ error: 'actorId is required' }, 400);

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string; status: string }>>`
      SELECT id, status FROM ace_intents WHERE id = ${intentId}::uuid LIMIT 1
    `;
    if (!rows.length) return c.json({ error: 'Mandate not found' }, 404);
    const intent = rows[0];
    if (!['planned', 'awaiting_approval'].includes(intent.status)) {
      return c.json({ error: `Cannot approve a mandate in '${intent.status}' status` }, 409);
    }
    const updated = await sql<Array<{ id: string; approved_at: Date }>>`
      UPDATE ace_intents
      SET status = 'approved', actor_id = ${actorId}, approved_at = now(), updated_at = now()
      WHERE id = ${intentId}::uuid
      RETURNING id, approved_at
    `;
    return c.json({ intentId: updated[0].id, status: 'approved', approvedAt: updated[0].approved_at });
  } catch {
    return c.json({ error: 'Failed to approve mandate' }, 500);
  } finally {
    await sql.end();
  }
});

// POST /api/public/mandates/:intentId/reject — reject the intent
router.post('/:intentId/reject', async (c) => {
  const intentId = c.req.param('intentId');
  let body: { actorId?: unknown };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  const actorId = typeof body.actorId === 'string' ? body.actorId.trim() : '';
  if (!actorId) return c.json({ error: 'actorId is required' }, 400);

  const sql = createDb(c.env);
  try {
    const rows = await sql<Array<{ id: string; status: string }>>`
      SELECT id, status FROM ace_intents WHERE id = ${intentId}::uuid LIMIT 1
    `;
    if (!rows.length) return c.json({ error: 'Mandate not found' }, 404);
    const intent = rows[0];
    if (!['planned', 'awaiting_approval', 'approved'].includes(intent.status)) {
      return c.json({ error: `Cannot reject a mandate in '${intent.status}' status` }, 409);
    }
    const updated = await sql<Array<{ id: string }>>`
      UPDATE ace_intents
      SET status = 'rejected', actor_id = ${actorId}, updated_at = now()
      WHERE id = ${intentId}::uuid
      RETURNING id
    `;
    return c.json({ intentId: updated[0].id, status: 'rejected' });
  } catch {
    return c.json({ error: 'Failed to reject mandate' }, 500);
  } finally {
    await sql.end();
  }
});

export { router as mandateApprovalLinksRouter };
