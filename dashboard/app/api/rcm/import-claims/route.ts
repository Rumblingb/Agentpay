import { NextRequest, NextResponse } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/session';
import { API_BASE } from '@/lib/api';
import { readJsonBody, isBoundedPlainText, isSafeIdentifier } from '@/lib/requestBody';

const CLAIM_TEXT_LIMITS = {
  title: 250,
  payerName: 160,
  claimRef: 160,
  patientRef: 160,
  providerRef: 160,
  amountAtRisk: 48,
  priority: 32,
  dueAt: 64,
} as const;

function isSafeClaim(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const claim = value as Record<string, unknown>;
  const allowed = new Set(Object.keys(CLAIM_TEXT_LIMITS));
  return Object.entries(claim).every(([key, field]) =>
    allowed.has(key)
    && isBoundedPlainText(field, CLAIM_TEXT_LIMITS[key as keyof typeof CLAIM_TEXT_LIMITS]),
  ) && isBoundedPlainText(claim.title, CLAIM_TEXT_LIMITS.title) && claim.title.trim().length > 0;
}

export async function POST(req: NextRequest) {
  const session = await verifySession(req.cookies.get(COOKIE_NAME)?.value ?? '');
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = await readJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  const body = parsed.value;

  const { workspaceId, claims } = body;
  if (typeof workspaceId !== 'string' || !isSafeIdentifier(workspaceId) || !Array.isArray(claims) || claims.length > 500 || !claims.every(isSafeClaim)) {
    return NextResponse.json({ error: 'workspaceId and claims array required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${API_BASE}/api/rcm/workspaces/${encodeURIComponent(String(workspaceId))}/import-claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.apiKey}` },
      body: JSON.stringify({ claims }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: 'Import failed' }, { status: 502 });
  }
}
