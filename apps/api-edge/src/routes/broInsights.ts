/**
 * broInsights — /api/admin/insights/*
 *
 * Founder-facing recovery dashboard for failed/pending jobs.
 *
 * GET  /api/admin/insights/queue        — list failed/pending jobs from last 7 days
 * POST /api/admin/insights/retry/:jobId — re-queue a job for the next cron run
 *
 * All endpoints require: x-admin-key header matching ADMIN_SECRET_KEY
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';

export const broInsightsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Auth helper ───────────────────────────────────────────────────────────────

function checkAdminKey(c: { req: { header: (k: string) => string | undefined }; env: Env }): boolean {
  const key = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key') ?? '';
  return !!key && key === c.env.ADMIN_SECRET_KEY;
}

// ── GET /api/admin/insights/queue ─────────────────────────────────────────────
// Lists failed/pending jobs created in the last 7 days (max 50).

broInsightsRouter.get('/queue', async (c) => {
  if (!checkAdminKey(c as any)) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const sql = createDb(c.env);
  try {
    const rows = await sql<{
      id: string;
      status: string;
      provider: string | null;
      corridor: string | null;
      created_at: string;
      recoveryAttemptCount: string | null;
      recommendedAction: string | null;
    }[]>`
      SELECT
        id,
        status,
        metadata->>'provider'              AS provider,
        metadata->>'corridor'              AS corridor,
        created_at,
        metadata->>'recoveryAttemptCount'  AS "recoveryAttemptCount",
        metadata->>'recommendedAction'     AS "recommendedAction"
      FROM payment_intents
      WHERE status IN ('failed', 'pending')
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 50
    `.catch(() => []);

    return c.json(rows);
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── POST /api/admin/insights/retry/:jobId ─────────────────────────────────────
// Resets a failed/pending job so the next cron run picks it up.

broInsightsRouter.post('/retry/:jobId', async (c) => {
  if (!checkAdminKey(c as any)) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const jobId = c.req.param('jobId');
  if (!jobId) return c.json({ error: 'jobId required' }, 400);

  const sql = createDb(c.env);
  try {
    // Verify the job exists
    const rows = await sql`
      SELECT id FROM payment_intents WHERE id = ${jobId} LIMIT 1
    `.catch(() => []);

    if (rows.length === 0) return c.json({ error: 'Job not found' }, 404);

    // Reset recoveryAttemptCount to 0 and re-queue by setting status = 'pending'.
    // The next cron run will pick it up for automatic recovery.
    await sql`
      UPDATE payment_intents
      SET status   = 'pending',
          metadata = jsonb_set(metadata, '{recoveryAttemptCount}', '0')
      WHERE id = ${jobId}
    `;

    return c.json({ ok: true, jobId });
  } finally {
    await sql.end().catch(() => {});
  }
});

// ── GET /api/admin/insights ───────────────────────────────────────────────────
// Dashboard HTML — founder-facing recovery UI.

broInsightsRouter.get('/', async (c) => {
  if (!checkAdminKey(c as any)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const sql = createDb(c.env);
  type QueueRow = { id: string; status: string; provider: string | null; corridor: string | null; created_at: string; recoveryAttemptCount: string | null; recommendedAction: string | null };
  let rows: QueueRow[] = [];
  try {
    rows = await sql<QueueRow[]>`
      SELECT
        id,
        status,
        metadata->>'provider'              AS provider,
        metadata->>'corridor'              AS corridor,
        created_at,
        metadata->>'recoveryAttemptCount'  AS "recoveryAttemptCount",
        metadata->>'recommendedAction'     AS "recommendedAction"
      FROM payment_intents
      WHERE status IN ('failed', 'pending')
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 50
    `.catch(() => [] as QueueRow[]);
  } finally {
    await sql.end().catch(() => {});
  }

  const rows_html = rows.map(r => `
    <tr>
      <td style="padding:8px 6px;font-family:monospace;font-size:12px">${r.id.slice(0, 16)}…</td>
      <td style="padding:8px 6px"><span style="background:${r.status === 'failed' ? '#fef2f2' : '#fffbeb'};color:${r.status === 'failed' ? '#dc2626' : '#d97706'};padding:2px 8px;border-radius:4px;font-size:12px">${r.status}</span></td>
      <td style="padding:8px 6px;font-size:12px">${r.provider ?? '—'}</td>
      <td style="padding:8px 6px;font-size:12px">${r.corridor ?? '—'}</td>
      <td style="padding:8px 6px;font-size:12px">${r.recoveryAttemptCount ?? '0'}</td>
      <td style="padding:8px 6px;font-size:12px;color:#6b7280">${r.created_at ? new Date(r.created_at).toLocaleString() : '—'}</td>
      <td style="padding:8px 6px">
        <button
          onclick="retryJob('${r.id}')"
          style="background:#2563eb;color:#fff;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:12px">
          Retry
        </button>
      </td>
    </tr>
  `).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bro Recovery Queue</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f9fafb; color: #111; padding: 32px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .sub { color: #6b7280; font-size: 13px; margin-bottom: 28px; }
    .card { background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.06); padding: 24px; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f3f4f6; }
    thead th { text-align: left; padding: 8px 6px; font-size: 12px; font-weight: 600; color: #374151; border-bottom: 1px solid #e5e7eb; }
    tbody tr:hover { background: #f9fafb; }
    .btn-run { background: #16a34a; color: #fff; border: none; border-radius: 6px; padding: 10px 20px; cursor: pointer; font-size: 14px; font-weight: 600; margin-bottom: 20px; }
    .btn-run:hover { background: #15803d; }
    #status { margin-top: 12px; font-size: 13px; color: #374151; min-height: 20px; }
  </style>
</head>
<body>
  <h1>Recovery Queue</h1>
  <p class="sub">Failed and pending jobs from the last 7 days. Reset a job to re-queue it for the next cron run.</p>

  <button class="btn-run" onclick="runAutoRecovery()">Run Auto Recovery</button>
  <div id="status"></div>

  <div class="card">
    <table>
      <thead>
        <tr>
          <th>Job ID</th>
          <th>Status</th>
          <th>Provider</th>
          <th>Corridor</th>
          <th>Attempts</th>
          <th>Created</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody id="queueBody">
        ${rows_html || '<tr><td colspan="7" style="padding:20px;text-align:center;color:#9ca3af">No failed or pending jobs in the last 7 days.</td></tr>'}
      </tbody>
    </table>
  </div>

  <script>
    function getAdminKey() {
      return prompt('Enter admin key:') || '';
    }
    let _adminKey = '';

    async function retryJob(jobId) {
      if (!_adminKey) _adminKey = getAdminKey();
      const res = await fetch('/api/admin/insights/retry/' + jobId, {
        method: 'POST',
        headers: { 'x-admin-key': _adminKey },
      });
      const data = await res.json();
      document.getElementById('status').textContent = data.ok
        ? 'Queued job ' + jobId + ' for recovery.'
        : 'Error: ' + (data.error || 'unknown');
      if (data.ok) {
        const btn = event.target;
        btn.textContent = 'Queued';
        btn.disabled = true;
        btn.style.background = '#6b7280';
      }
    }

    async function runAutoRecovery() {
      if (!_adminKey) _adminKey = getAdminKey();
      document.getElementById('status').textContent = 'Fetching queue…';
      const res = await fetch('/api/admin/insights/queue', {
        headers: { 'x-admin-key': _adminKey },
      });
      const jobs = await res.json();
      if (!Array.isArray(jobs) || jobs.length === 0) {
        document.getElementById('status').textContent = 'Queue is empty — nothing to recover.';
        return;
      }
      document.getElementById('status').textContent = 'Re-queuing ' + jobs.length + ' job(s)…';
      let ok = 0;
      for (const job of jobs) {
        const r = await fetch('/api/admin/insights/retry/' + job.id, {
          method: 'POST',
          headers: { 'x-admin-key': _adminKey },
        });
        const d = await r.json();
        if (d.ok) ok++;
      }
      document.getElementById('status').textContent = 'Done — re-queued ' + ok + ' of ' + jobs.length + ' jobs.';
    }
  </script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
});
