/**
 * POST /api/rcm/workspaces
 *
 * Creates an RCM workspace for a newly onboarded billing manager.
 * Proxies to the backend with the caller's API key from the session cookie.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';

export async function POST(req: NextRequest) {
  const sessionCookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = sessionCookie ? await verifySession(sessionCookie) : null;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/rcm/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify({
        name: body.practiceName ?? body.name ?? 'My Practice',
        specialty: body.specialty ?? null,
        workspaceType: body.workspaceType ?? 'professional_rcm',
        config: {
          claimsPerMonth: body.claimsPerMonth,
          mainPayer: body.mainPayer,
          mainProblem: body.mainProblem,
          npi: body.npi,
          plan: body.plan ?? null,
          onboardedVia: 'ace_voice',
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    // Network/timeout — surface as a real error so the onboarding UI can
    // retry. Previously we silently returned ok=true with
    // note=workspace_deferred, which let users land on an empty dashboard
    // with no workspace and no idea why.
    console.error('[rcm/workspaces] upstream fetch failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Could not reach billing service. Please try again.' },
      { status: 503 },
    );
  }

  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }

  if (!res.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof (data as Record<string, unknown>).error === 'string'
        ? (data as { error: string }).error
        : `Workspace creation failed (${res.status}).`;
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const payload =
    typeof data === 'object' && data !== null
      ? { ...(data as Record<string, unknown>), ok: true }
      : { ok: true };

  return NextResponse.json(payload, { status: res.status });
}
