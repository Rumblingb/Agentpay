import { NextResponse } from 'next/server';
import demo from '../../../_lib/demoData';

// Read-only demo endpoint exposing the canonical Founding Era flow.
export async function GET() {
  const payload = {
    foundingAgents: demo.FOUNDING_ECONOMIC_AGENTS,
    constitutionalAgents: demo.CONSTITUTIONAL_AGENTS,
    passports: demo.SAMPLE_PASSPORTS,
    canonicalEvents: demo.getCanonicalFlowTrace(),
    canonicalTrace: demo.getCanonicalFlowTrace(),
  };

  return NextResponse.json(payload, { status: 200 });
}
