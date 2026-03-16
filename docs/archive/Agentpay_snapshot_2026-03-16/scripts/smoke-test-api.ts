// Simple smoke test script for key public APIs
// Run with: npx tsx scripts/smoke-test-api.ts

const endpoints = [
  { path: '/api/agents/leaderboard', label: 'leaderboard' },
  { path: '/api/agents/feed', label: 'feed' },
  { path: '/api/v1/trust/events', label: 'trust events' },
];

async function check(url: string, label: string) {
  try {
    const res = await fetch(url, { method: 'GET' });
    const text = await res.text().catch(() => null);
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    if (res.ok) {
      console.log(`✓ ${label} OK`);
      return { label, ok: true, status: res.status };
    }

    // Detect intentional beta-gating: many handlers return 503 with a JSON
    // body like { status: 'beta', message: 'Coming soon' } when BETA_MODE=true.
    if (res.status === 503) {
      const isBetaGated =
        typeof body === 'object' && (body.status === 'beta' || (body.message && String(body.message).toLowerCase().includes('coming soon')))
        || (typeof body === 'string' && body.toLowerCase().includes('coming soon'));

      if (isBetaGated) {
        console.log(`⚠ ${label} BETA-GATED (503) - intentional`);
        return { label, ok: false, status: 503, reason: 'beta-gated', body };
      }

      console.log(`✗ ${label} 503 Service Unavailable`);
      return { label, ok: false, status: 503, reason: 'service-unavailable', body };
    }

    console.log(`✗ ${label} ${res.status}`);
    return { label, ok: false, status: res.status, body };
  } catch (err: any) {
    const msg = String(err ?? 'unknown error');
    // Classify common unreachable/connection errors
    const unreachable = msg.includes('ECONNREFUSED') || msg.includes('connect') || msg.includes('ENOTFOUND') || msg.includes('network') || msg.includes('timeout');
    if (unreachable) {
      console.log(`✗ ${label} UNREACHABLE: ${msg}`);
      return { label, ok: false, error: 'unreachable', message: msg };
    }

    console.log(`✗ ${label} ERROR: ${msg}`);
    return { label, ok: false, error: msg };
  }
}

async function run() {
  const base = process.env.AGENTPAY_API_BASE_URL ?? 'http://localhost:3000';
  console.log(`Running smoke tests against ${base}`);
  const results = [] as any[];
  for (const e of endpoints) {
    const url = new URL(e.path, base).toString();
    // small timeout wrapper
    const p = Promise.race([
      check(url, e.label),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
    ]).catch((err) => ({ label: e.label, ok: false, error: String(err) }));
    results.push(await p);
  }
  const failures = results.filter((r) => !r.ok);
  if (failures.length > 0) {
    console.error('\nSome smoke tests failed:');
    for (const f of failures) console.error(` - ${f.label}: ${f.status ?? f.error}`);
    process.exitCode = 2;
  } else {
    console.log('\nAll smoke tests passed');
  }
}

run();
