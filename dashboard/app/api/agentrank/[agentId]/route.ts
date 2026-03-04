import { NextRequest, NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api';

/**
 * GET /api/agentrank/[agentId]
 *
 * Proxies the AgentRank lookup to the backend API.
 * This is a public endpoint — no session / auth required.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;

  if (!agentId || agentId.trim().length === 0) {
    return NextResponse.json({ error: 'Invalid agentId' }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/agentrank/${encodeURIComponent(agentId)}`,
    );

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.error || 'Agent not found' },
        { status: res.status },
      );
    }

    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch AgentRank' },
      { status: 502 },
    );
  }
}
