import { NextRequest, NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api';
import { isSafeIdentifier } from '@/lib/requestBody';

function betaResponse() {
  return NextResponse.json(
    { status: 'beta', message: 'Coming soon' },
    { status: 503 }
  );
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ agentId: string }> }
) {
  if (process.env.BETA_MODE === 'true') {
    return betaResponse();
  }

  const { agentId } = await context.params;
  if (!isSafeIdentifier(agentId)) return NextResponse.json({ error: 'Invalid agent id' }, { status: 400 });

  try {
    const res = await fetch(`${API_BASE}/api/agentrank/${encodeURIComponent(agentId)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);

    return NextResponse.json(data, {
      status: res.status,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch AgentRank' },
      { status: 500 }
    );
  }
}
