/**
 * broInsights - /api/admin/insights/*
 *
 * Founder-facing recovery and mobile telemetry dashboard.
 *
 * GET  /api/admin/insights/queue         - list failed/pending jobs from last 7 days
 * GET  /api/admin/insights/mobile        - JSON summary of Meridian telemetry
 * POST /api/admin/insights/retry/:jobId  - re-queue a job for the next cron run
 *
 * All endpoints require: x-admin-key header matching ADMIN_SECRET_KEY
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { createDb } from '../lib/db';
import { summarizeMobileTelemetry, type MobileTelemetrySummary } from '../lib/mobileTelemetry';

export const broInsightsRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

type QueueRow = {
  id: string;
  status: string;
  provider: string | null;
  corridor: string | null;
  created_at: string;
  recoveryAttemptCount: string | null;
  recommendedAction: string | null;
};

function checkAdminKey(c: { req: { header: (k: string) => string | undefined }; env: Env }): boolean {
  const key = c.req.header('x-admin-key') ?? c.req.header('X-Admin-Key') ?? '';
  return !!key && key === c.env.ADMIN_SECRET_KEY;
}

function clampWindowHours(value: string | undefined, fallback = 24): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(168, Math.max(1, parsed));
}

function escapeHtml(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatRate(value: number | null): string {
  return value == null ? '--' : `${value.toFixed(1)}%`;
}

async function loadQueueRows(sql: ReturnType<typeof createDb>): Promise<QueueRow[]> {
  return sql<QueueRow[]>`
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
}

broInsightsRouter.get('/queue', async (c) => {
  if (!checkAdminKey(c as any)) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const sql = createDb(c.env);
  try {
    const rows = await loadQueueRows(sql);
    return c.json(rows);
  } finally {
    await sql.end().catch(() => {});
  }
});

broInsightsRouter.get('/mobile', async (c) => {
  if (!checkAdminKey(c as any)) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const windowHours = clampWindowHours(c.req.query('windowHours'), 24);
  const sql = createDb(c.env);
  try {
    const summary = await summarizeMobileTelemetry(sql, windowHours);
    return c.json(summary);
  } finally {
    await sql.end().catch(() => {});
  }
});

broInsightsRouter.post('/retry/:jobId', async (c) => {
  if (!checkAdminKey(c as any)) return c.json({ error: 'UNAUTHORIZED' }, 401);

  const jobId = c.req.param('jobId');
  if (!jobId) return c.json({ error: 'jobId required' }, 400);

  const sql = createDb(c.env);
  try {
    const rows = await sql`
      SELECT id FROM payment_intents WHERE id = ${jobId} LIMIT 1
    `.catch(() => []);

    if (rows.length === 0) return c.json({ error: 'Job not found' }, 404);

    await sql`
      UPDATE payment_intents
      SET status = 'pending',
          metadata = jsonb_set(metadata, '{recoveryAttemptCount}', '0')
      WHERE id = ${jobId}
    `;

    return c.json({ ok: true, jobId });
  } finally {
    await sql.end().catch(() => {});
  }
});

broInsightsRouter.get('/', async (c) => {
  if (!checkAdminKey(c as any)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const windowHours = 72;
  const sql = createDb(c.env);
  let rows: QueueRow[] = [];
  let mobileSummary: MobileTelemetrySummary | null = null;
  try {
    rows = await loadQueueRows(sql);
    mobileSummary = await summarizeMobileTelemetry(sql, windowHours).catch(() => null);
  } finally {
    await sql.end().catch(() => {});
  }

  const rowsHtml = rows.map((row) => `
    <tr>
      <td style="padding:8px 6px;font-family:monospace;font-size:12px">${escapeHtml(row.id.slice(0, 16))}...</td>
      <td style="padding:8px 6px"><span style="background:${row.status === 'failed' ? '#fef2f2' : '#fffbeb'};color:${row.status === 'failed' ? '#dc2626' : '#d97706'};padding:2px 8px;border-radius:999px;font-size:12px">${escapeHtml(row.status)}</span></td>
      <td style="padding:8px 6px;font-size:12px">${escapeHtml(row.provider ?? '--')}</td>
      <td style="padding:8px 6px;font-size:12px">${escapeHtml(row.corridor ?? '--')}</td>
      <td style="padding:8px 6px;font-size:12px">${escapeHtml(row.recoveryAttemptCount ?? '0')}</td>
      <td style="padding:8px 6px;font-size:12px;color:#6b7280">${row.created_at ? new Date(row.created_at).toLocaleString() : '--'}</td>
      <td style="padding:8px 6px">
        <button
          onclick="retryJob('${escapeHtml(row.id)}', this)"
          style="background:#2563eb;color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px">
          Retry
        </button>
      </td>
    </tr>
  `).join('');

  const funnelCardsHtml = mobileSummary ? `
    <div class="summary-grid">
      <div class="metric-card">
        <div class="metric-label">Voice to plan</div>
        <div class="metric-value">${mobileSummary.funnel.voiceTranscribed}</div>
        <div class="metric-sub">${formatRate(mobileSummary.funnel.sttSuccessRate)} STT success from ${mobileSummary.funnel.voiceCaptureStarted} starts</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Planning</div>
        <div class="metric-value">${mobileSummary.funnel.planReceived}</div>
        <div class="metric-sub">${formatRate(mobileSummary.funnel.planSuccessRate)} success from ${mobileSummary.funnel.planRequested} requests</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Approvals</div>
        <div class="metric-value">${mobileSummary.funnel.confirmApproved + mobileSummary.funnel.confirmAutoApproved}</div>
        <div class="metric-sub">${formatRate(mobileSummary.funnel.confirmApprovalRate)} approval rate</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Execution</div>
        <div class="metric-value">${mobileSummary.funnel.executeSucceeded}</div>
        <div class="metric-sub">${formatRate(mobileSummary.funnel.executionSuccessRate)} success from ${mobileSummary.funnel.executeStarted} starts</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Reroute offers</div>
        <div class="metric-value">${mobileSummary.recovery.rerouteOfferAccepted}</div>
        <div class="metric-sub">${formatRate(mobileSummary.recovery.rerouteAcceptanceRate)} accepted from ${mobileSummary.recovery.rerouteOfferAvailable} offers</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Wallet opens</div>
        <div class="metric-value">${mobileSummary.recovery.walletOpened}</div>
        <div class="metric-sub">${formatRate(mobileSummary.recovery.walletOpenRate)} open rate from ${mobileSummary.recovery.walletAvailable} available</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Plan latency</div>
        <div class="metric-value">${mobileSummary.performance.planLatencyMsAvg != null ? `${Math.round(mobileSummary.performance.planLatencyMsAvg)}ms` : '--'}</div>
        <div class="metric-sub">P95 ${mobileSummary.performance.planLatencyMsP95 != null ? `${Math.round(mobileSummary.performance.planLatencyMsP95)}ms` : '--'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Voice latency</div>
        <div class="metric-value">${mobileSummary.performance.sttMsAvg != null ? `${Math.round(mobileSummary.performance.sttMsAvg)}ms` : '--'}</div>
        <div class="metric-sub">Capture ${mobileSummary.performance.captureMsAvg != null ? `${Math.round(mobileSummary.performance.captureMsAvg)}ms` : '--'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Execution latency</div>
        <div class="metric-value">${mobileSummary.performance.executeLatencyMsAvg != null ? `${Math.round(mobileSummary.performance.executeLatencyMsAvg)}ms` : '--'}</div>
        <div class="metric-sub">P95 ${mobileSummary.performance.executeLatencyMsP95 != null ? `${Math.round(mobileSummary.performance.executeLatencyMsP95)}ms` : '--'}</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">Server voice share</div>
        <div class="metric-value">${formatRate(mobileSummary.performance.serverVoiceRate)}</div>
        <div class="metric-sub">TTS avg ${mobileSummary.performance.ttsLatencyMsAvg != null ? `${Math.round(mobileSummary.performance.ttsLatencyMsAvg)}ms` : '--'}</div>
      </div>
    </div>
  ` : `
    <div class="card" style="margin-bottom:24px">
      <div style="font-size:14px;color:#6b7280">Meridian mobile telemetry is not available yet.</div>
    </div>
  `;

  const topEventsHtml = mobileSummary ? mobileSummary.topEvents.map((item) => `
    <div class="event-row">
      <span>${escapeHtml(item.event)}</span>
      <strong>${item.count}</strong>
    </div>
  `).join('') : '';

  const screenCountsHtml = mobileSummary ? mobileSummary.screenCounts.slice(0, 8).map((item) => `
    <div class="event-row">
      <span>${escapeHtml(item.screen)}</span>
      <strong>${item.count}</strong>
    </div>
  `).join('') : '';

  const alertRowsHtml = mobileSummary && mobileSummary.recentAlerts.length > 0
    ? mobileSummary.recentAlerts.map((alert) => `
      <div class="alert-row">
        <div class="alert-head">
          <span class="alert-pill alert-${escapeHtml(alert.severity)}">${escapeHtml(alert.severity)}</span>
          <strong>${escapeHtml(alert.event)}</strong>
          <span class="alert-time">${escapeHtml(new Date(alert.createdAt).toLocaleString())}</span>
        </div>
        <div class="alert-body">${escapeHtml(alert.message ?? 'No message')}</div>
        <div class="alert-meta">${escapeHtml(alert.screen)}</div>
      </div>
    `).join('')
    : '<div class="empty">No warning or error telemetry in the current window.</div>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Bro Insights</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f3f6fb; color: #0f172a; padding: 32px; }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 6px; }
    h2 { font-size: 16px; font-weight: 700; margin: 0 0 14px; }
    .sub { color: #64748b; font-size: 13px; margin-bottom: 28px; max-width: 900px; }
    .section { margin-bottom: 28px; }
    .card { background: #fff; border-radius: 14px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); padding: 20px; }
    .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .metric-card { background: linear-gradient(180deg, #ffffff 0%, #f8fbff 100%); border: 1px solid #dbe7f5; border-radius: 14px; padding: 18px; }
    .metric-label { color: #64748b; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px; }
    .metric-value { font-size: 28px; font-weight: 800; color: #0f172a; line-height: 1; margin-bottom: 10px; }
    .metric-sub { font-size: 12px; color: #475569; }
    .stack { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .event-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eef2f7; font-size: 13px; }
    .event-row:last-child { border-bottom: none; }
    .alert-row { border: 1px solid #e5edf8; border-radius: 12px; padding: 12px; margin-bottom: 10px; background: #fbfdff; }
    .alert-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px; margin-bottom: 6px; }
    .alert-pill { border-radius: 999px; padding: 2px 8px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .alert-info { background: #e0f2fe; color: #0369a1; }
    .alert-warning { background: #fef3c7; color: #b45309; }
    .alert-error { background: #fee2e2; color: #b91c1c; }
    .alert-body { font-size: 13px; color: #334155; margin-bottom: 6px; }
    .alert-meta, .alert-time { font-size: 12px; color: #64748b; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f8fafc; }
    thead th { text-align: left; padding: 10px 8px; font-size: 12px; font-weight: 700; color: #475569; border-bottom: 1px solid #e5e7eb; }
    tbody tr:hover { background: #f8fafc; }
    .btn-run { background: #0f766e; color: #fff; border: none; border-radius: 10px; padding: 10px 18px; cursor: pointer; font-size: 14px; font-weight: 700; margin-bottom: 16px; }
    #status { margin-top: 12px; font-size: 13px; color: #334155; min-height: 20px; }
    .toolbar { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom: 16px; }
    .note { color:#64748b; font-size:12px; }
    .empty { color: #94a3b8; font-size: 13px; padding: 8px 0; }
    @media (max-width: 900px) { .stack { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <h1>Bro Insights</h1>
  <p class="sub">Founder-facing recovery queue plus Meridian concierge telemetry. This view shows where the voice funnel breaks, what recovery moments users hit, and which live-trip actions are actually getting used.</p>

  <div class="section">
    <h2>Mobile funnel (${windowHours}h)</h2>
    ${funnelCardsHtml}
    <div class="stack">
      <div class="card">
        <h2>Top mobile events</h2>
        ${topEventsHtml || '<div class="empty">No telemetry events yet.</div>'}
      </div>
      <div class="card">
        <h2>Screen activity</h2>
        ${screenCountsHtml || '<div class="empty">No screen data yet.</div>'}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="card">
      <h2>Recent alerts</h2>
      ${alertRowsHtml}
    </div>
  </div>

  <div class="section">
    <div class="toolbar">
      <div>
        <h2 style="margin-bottom:6px">Recovery queue</h2>
        <div class="note">Failed and pending jobs from the last 7 days. Reset a job to re-queue it for the next cron run.</div>
      </div>
      <button class="btn-run" onclick="runAutoRecovery()">Run auto recovery</button>
    </div>
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
          ${rowsHtml || '<tr><td colspan="7" style="padding:20px;text-align:center;color:#94a3b8">No failed or pending jobs in the last 7 days.</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <script>
    function getAdminKey() {
      return prompt('Enter admin key:') || '';
    }
    let _adminKey = '';

    async function retryJob(jobId, button) {
      if (!_adminKey) _adminKey = getAdminKey();
      const res = await fetch('/api/admin/insights/retry/' + jobId, {
        method: 'POST',
        headers: { 'x-admin-key': _adminKey },
      });
      const data = await res.json();
      document.getElementById('status').textContent = data.ok
        ? 'Queued job ' + jobId + ' for recovery.'
        : 'Error: ' + (data.error || 'unknown');
      if (data.ok && button) {
        button.textContent = 'Queued';
        button.disabled = true;
        button.style.background = '#64748b';
      }
    }

    async function runAutoRecovery() {
      if (!_adminKey) _adminKey = getAdminKey();
      document.getElementById('status').textContent = 'Fetching queue...';
      const res = await fetch('/api/admin/insights/queue', {
        headers: { 'x-admin-key': _adminKey },
      });
      const jobs = await res.json();
      if (!Array.isArray(jobs) || jobs.length === 0) {
        document.getElementById('status').textContent = 'Queue is empty - nothing to recover.';
        return;
      }
      document.getElementById('status').textContent = 'Re-queuing ' + jobs.length + ' job(s)...';
      let ok = 0;
      for (const job of jobs) {
        const retry = await fetch('/api/admin/insights/retry/' + job.id, {
          method: 'POST',
          headers: { 'x-admin-key': _adminKey },
        });
        const data = await retry.json();
        if (data.ok) ok++;
      }
      document.getElementById('status').textContent = 'Done - re-queued ' + ok + ' of ' + jobs.length + ' jobs.';
    }
  </script>
</body>
</html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
});
