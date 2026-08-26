import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

test('founder proof preflight is non-executing and produces redacted continuity evidence', async () => {
  const requests = [];
  const { server, baseUrl } = await listen(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    requests.push({
      method: request.method,
      path: new URL(request.url, baseUrl).pathname,
      body: body ? JSON.parse(body) : null,
      authorization: request.headers.authorization,
    });

    response.setHeader('content-type', 'application/json');
    if (request.method === 'GET' && request.url.startsWith('/api/capabilities/authority-bootstrap')) {
      response.end(JSON.stringify({ status: 'ready', authorityProfile: { id: 'authority_1' } }));
      return;
    }
    if (request.method === 'POST' && request.url === '/api/capabilities/access-resolve') {
      response.end(JSON.stringify({
        status: 'ready',
        capability: { id: 'capability_1', provider: 'databento' },
        execute: { endpoint: '/api/capabilities/capability_1/execute' },
      }));
      return;
    }
    if (request.method === 'GET' && request.url.startsWith('/api/capabilities/leases')) {
      response.end(JSON.stringify({ summary: { active: 1 }, leases: [{ id: 'lease_1' }] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'unexpected request' }));
  });
  const directory = await mkdtemp(path.join(tmpdir(), 'agentpay-founder-preflight-'));
  const transcriptPath = path.join(directory, 'preflight.md');
  const jsonPath = path.join(directory, 'preflight.json');

  try {
    const result = await run(process.execPath, [
      'scripts/founder-proof-demo.mjs',
      '--preflight',
      '--base-url', baseUrl,
      '--api-key', 'merchant_secret_should_not_appear',
      '--principal-id', 'principal_1',
      '--provider', 'databento',
      '--workbench-id', 'workbench_1',
      '--transcript-path', transcriptPath,
      '--json-path', jsonPath,
    ], { cwd: process.cwd() });

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Same-workbench reuse ready: 1 active governed lease found/);
    assert.deepEqual(requests.map((request) => `${request.method} ${request.path}`), [
      'GET /api/capabilities/authority-bootstrap',
      'POST /api/capabilities/access-resolve',
      'GET /api/capabilities/leases',
    ]);
    assert.equal(requests[0].authorization, 'Bearer merchant_secret_should_not_appear');
    assert.equal(requests[1].body.issueWorkbenchLease, false);

    const artifact = await readFile(jsonPath, 'utf8');
    assert.doesNotMatch(artifact, /merchant_secret_should_not_appear/);
    assert.match(artifact, /"preflight": true/);
    assert.match(artifact, /Same-workbench reuse ready/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
