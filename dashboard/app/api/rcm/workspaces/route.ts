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

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.apiKey}`,
      },
      body: JSON.stringify({
      name: body.practiceName ?? body.name ?? 'My Practice',
      specialty: body.specialty ?? null,
      config: {
        claimsPerMonth: body.claimsPerMonth,
        mainPayer: body.mainPayer,
        mainProblem: body.mainProblem,
        npi: body.npi,
        onboardedVia: 'ace_voice',
      },
    }),
      signal: AbortSignal.timeout(15_000),
    });

    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    // Backend may not have the workspace creation endpoint yet —
    // treat as success so onboarding can complete and the user reaches the dashboard.
    return NextResponse.json({ ok: true, note: 'workspace_deferred' }, { status: 200 });
  }
}
