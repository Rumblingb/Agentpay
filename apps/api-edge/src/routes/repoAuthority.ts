/**
 * Repo Authority — /api/repos/*
 *
 * Agent-only marketplace workflows need a narrow way to ask a human which
 * repositories an agent may touch. This route is deliberately fail-closed:
 * it records scoped authority and emits a hosted human step, but it never
 * stores or returns raw GitHub/GitLab tokens.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { authenticateApiKey } from '../middleware/auth';
import { createDb, parseJsonb } from '../lib/db';
import { createHostedActionSession, isSafeHostedActionResumeUrl } from '../lib/hostedActionSessions';

const router = new Hono<{ Bindings: Env; Variables: Variables }>();

type RepoProvider = 'github' | 'gitlab';
type RepoOperation = 'read' | 'contents_write' | 'pull_request' | 'issues' | 'actions';

const VALID_PROVIDERS = new Set<RepoProvider>(['github', 'gitlab']);
const VALID_OPERATIONS = new Set<RepoOperation>(['read', 'contents_write', 'pull_request', 'issues', 'actions']);

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
}

function normalizeProvider(value: unknown): RepoProvider {
  const provider = asString(value) ?? 'github';
  return VALID_PROVIDERS.has(provider as RepoProvider) ? provider as RepoProvider : 'github';
}

function normalizeOperations(value: unknown): RepoOperation[] {
  const requested = asStringArray(value, 10)
    .filter((operation): operation is RepoOperation => VALID_OPERATIONS.has(operation as RepoOperation));
  return requested.length ? requested : ['read'];
}

function mapRequest(row: Record<string, unknown>) {
  return {
    requestId: row.id,
    principalId: row.principal_id,
    operatorId: row.operator_id,
    provider: row.provider,
    purpose: row.purpose,
    requestedRepos: parseJsonb(row.requested_repos, []),
    requestedOperations: parseJsonb(row.requested_operations, []),
    status: row.status,
    actionSessionId: row.action_session_id,
    expiresAt: row.expires_at,
    approvedAt: row.approved_at,
    deniedAt: row.denied_at,
    createdAt: row.created_at,
  };
}

function mapLease(row: Record<string, unknown>) {
  return {
    leaseId: row.id,
    requestId: row.request_id,
    principalId: row.principal_id,
    operatorId: row.operator_id,
    provider: row.provider,
    selectedRepos: parseJsonb(row.selected_repos, []),
    approvedOperations: parseJsonb(row.approved_operations, []),
    status: row.status,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    metadata: parseJsonb(row.metadata, {}),
  };
}

router.use('*', authenticateApiKey);

router.post('/access-requests', async (c) => {
  const merchant = c.get('merchant');
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const principalId = asString(body.principalId);
  const purpose = asString(body.purpose);
  const operatorId = asString(body.operatorId);
  const provider = normalizeProvider(body.provider);
  const requestedRepos = asStringArray(body.requestedRepos, 25);
  const requestedOperations = normalizeOperations(body.requestedOperations);
  const resumeUrl = asString(body.resumeUrl);
  if (!principalId) return c.json({ error: 'principalId is required' }, 400);
  if (!purpose) return c.json({ error: 'purpose is required' }, 400);
  if (resumeUrl && !isSafeHostedActionResumeUrl(resumeUrl)) {
    return c.json({ error: 'resumeUrl must be a valid https URL or localhost URL' }, 400);
  }

  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<Record<string, unknown>>>(
      `INSERT INTO repo_access_requests
         (merchant_id, principal_id, operator_id, provider, purpose,
          requested_repos, requested_operations, status, metadata, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'pending',$8::jsonb, now() + interval '30 minutes')
       RETURNING *`,
      [
        merchant.id,
        principalId,
        operatorId,
        provider,
        purpose,
        JSON.stringify(requestedRepos),
        JSON.stringify(requestedOperations),
        JSON.stringify({ source: 'agentpay_repo_authority' }),
      ],
    );
    const request = rows[0];
    if (!request?.id) return c.json({ error: 'Failed to create repo access request' }, 500);

    const action = await createHostedActionSession(c.env, {
      merchant,
      actionType: 'approval_required',
      entityType: 'repo_access_request',
      entityId: String(request.id),
      title: 'Choose repository access',
      summary: purpose,
      resumeUrl,
      displayPayload: {
        provider,
        requestedRepos,
        requestedOperations,
        purpose,
        warning: 'Only approve repositories and operations needed for this task.',
      },
      metadata: {
        repoAccessRequestId: String(request.id),
        principalId,
        operatorId,
      },
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    await sql.unsafe(
      `UPDATE repo_access_requests
       SET action_session_id = $1, updated_at = now()
       WHERE id = $2`,
      [action.session.sessionId, String(request.id)],
    );

    return c.json({
      success: true,
      request: mapRequest({ ...request, action_session_id: action.session.sessionId }),
      nextAction: {
        type: 'repo_selection_required',
        title: 'Choose repository access',
        summary: purpose,
        sessionId: action.session.sessionId,
        statusUrl: action.statusUrl,
        displayPayload: {
          provider,
          requestedRepos,
          requestedOperations,
          approvalUrl: action.publicResumeUrl,
        },
      },
      failSafe: 'No repo lease or provider token has been granted yet.',
    }, 201);
  } finally {
    await sql.end().catch(() => {});
  }
});

router.post('/access-requests/:requestId/approve', async (c) => {
  const merchant = c.get('merchant');
  const requestId = c.req.param('requestId') ?? '';
  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (body.humanConfirmed !== true) {
    return c.json({ error: 'humanConfirmed=true is required to create a repo lease' }, 400);
  }

  const selectedRepos = asStringArray(body.selectedRepos, 25);
  const approvedOperations = normalizeOperations(body.approvedOperations);
  if (selectedRepos.length === 0) {
    return c.json({ error: 'selectedRepos must include at least one owner/repo value' }, 400);
  }

  const ttlMinutes = typeof body.ttlMinutes === 'number' && Number.isFinite(body.ttlMinutes)
    ? Math.max(5, Math.min(Math.round(body.ttlMinutes), 24 * 60))
    : 60;

  const sql = createDb(c.env);
  try {
    const requestRows = await sql.unsafe<Array<Record<string, unknown>>>(
      `SELECT *
       FROM repo_access_requests
       WHERE id = $1 AND merchant_id = $2 AND status = 'pending'
       LIMIT 1`,
      [requestId, merchant.id],
    );
    const request = requestRows[0];
    if (!request) return c.json({ error: 'Repo access request not found or already closed' }, 404);

    const requestedRepos = parseJsonb<string[]>(request.requested_repos, []);
    const disallowed = requestedRepos.length
      ? selectedRepos.filter((repo) => !requestedRepos.includes(repo))
      : [];
    if (disallowed.length > 0) {
      return c.json({ error: 'Selected repos were not part of the original request', disallowed }, 400);
    }

    const leaseRows = await sql.unsafe<Array<Record<string, unknown>>>(
      `INSERT INTO repo_access_leases
         (request_id, merchant_id, principal_id, operator_id, provider,
          selected_repos, approved_operations, status, metadata, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'active',$8::jsonb, now() + ($9 || ' minutes')::interval)
       RETURNING *`,
      [
        requestId,
        merchant.id,
        String(request.principal_id ?? ''),
        typeof request.operator_id === 'string' ? request.operator_id : null,
        String(request.provider ?? 'github'),
        JSON.stringify(selectedRepos),
        JSON.stringify(approvedOperations),
        JSON.stringify({
          source: 'repo_access_request_approval',
          noRawProviderToken: true,
        }),
        ttlMinutes,
      ],
    );

    await sql.unsafe(
      `UPDATE repo_access_requests
       SET status = 'approved', approved_at = now(), updated_at = now()
       WHERE id = $1 AND merchant_id = $2`,
      [requestId, merchant.id],
    );

    return c.json({
      success: true,
      lease: mapLease(leaseRows[0]),
      failSafe: 'This lease records scoped authority only. Execution still requires a vault-backed GitHub App/provider token path.',
    }, 201);
  } finally {
    await sql.end().catch(() => {});
  }
});

router.get('/leases', async (c) => {
  const merchant = c.get('merchant');
  const status = asString(c.req.query('status')) ?? 'active';
  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<Record<string, unknown>>>(
      `SELECT *
       FROM repo_access_leases
       WHERE merchant_id = $1
         AND ($2 = 'all' OR status = $2)
       ORDER BY created_at DESC
       LIMIT 50`,
      [merchant.id, status],
    );
    return c.json({
      success: true,
      leases: rows.map(mapLease),
      summary: {
        total: rows.length,
        active: rows.filter((row) => row.status === 'active').length,
      },
    });
  } finally {
    await sql.end().catch(() => {});
  }
});

router.post('/leases/:leaseId/revoke', async (c) => {
  const merchant = c.get('merchant');
  const leaseId = c.req.param('leaseId') ?? '';
  const sql = createDb(c.env);
  try {
    const rows = await sql.unsafe<Array<Record<string, unknown>>>(
      `UPDATE repo_access_leases
       SET status = 'revoked', revoked_at = now(), updated_at = now()
       WHERE id = $1 AND merchant_id = $2
       RETURNING *`,
      [leaseId, merchant.id],
    );
    if (!rows[0]) return c.json({ error: 'Repo access lease not found' }, 404);
    return c.json({ success: true, revoked: true, lease: mapLease(rows[0]) });
  } finally {
    await sql.end().catch(() => {});
  }
});

export { router as repoAuthorityRouter };
