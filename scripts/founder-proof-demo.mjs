import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function usage() {
  return `AgentPay founder proof demo runner

Usage:
  npm run demo:founder-proof -- --api-key <key> --principal-id <id> [options]

Required:
  --api-key <key>             Merchant API key. Can also come from AGENTPAY_API_KEY.
  --principal-id <id>         Principal identifier. Can also come from AGENTPAY_PRINCIPAL_ID.

Options:
  --base-url <url>            API base URL. Default: AGENTPAY_BASE_URL or https://api.agentpay.so
  --provider <name>           Provider to resolve. Default: databento
  --subject-type <type>       merchant | principal | agent | workspace. Default: workspace
  --subject-ref <value>       Subject reference. Default: workbench id
  --operator-id <id>          Optional operator id
  --workbench-id <id>         Workbench id. Default: founder-proof-<provider>
  --workbench-label <label>   Workbench label. Default: current folder name
  --resume-url <url>          Hosted action resume URL. Default: http://localhost:3000/agentpay-resume
  --contact-email <email>     Optional customer contact email
  --contact-name <name>       Optional customer contact name
  --issue-workbench-lease     Request a reusable lease during access resolve. Default: true
  --no-issue-workbench-lease  Do not request a workbench lease
  --poll-seconds <n>          Poll hosted action / execution attempt status for up to n seconds
  --poll-interval <n>         Poll interval in seconds. Default: 5
  --execute-method <verb>     Execute request method. Default: POST
  --execute-path <path>       Relative capability path to execute
  --execute-body-json <json>  Inline JSON body for execute calls
  --execute-body-file <file>  JSON file with body for execute calls
  --allow-paid-usage          Set allowPaidUsage=true on execute calls. Default: true
  --no-allow-paid-usage       Set allowPaidUsage=false
  --transcript-path <path>    Markdown transcript path. Default: ops/founder-demo/latest-proof-demo.md
  --json-path <path>          JSON transcript path. Default: ops/founder-demo/latest-proof-demo.json
  --help                      Show this help

Examples:
  npm run demo:founder-proof -- --api-key sk_live_... --principal-id principal_1 --execute-path /timeseries/get_range --execute-body-file ops/founder-demo/request-body.template.json
  node scripts/founder-proof-demo.mjs --api-key sk_live_... --principal-id principal_1 --poll-seconds 120
`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    if (key === 'help' || key === 'issue-workbench-lease' || key === 'no-issue-workbench-lease' || key === 'allow-paid-usage' || key === 'no-allow-paid-usage') {
      args[key] = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function sanitizeValue(value, key = '') {
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => {
        if (/(api[_-]?key|authorization|secret|token|password)/i.test(entryKey) && !/sessionId|attemptId|leaseId/i.test(entryKey)) {
          return [entryKey, '[redacted]'];
        }
        return [entryKey, sanitizeValue(entryValue, entryKey)];
      }),
    );
  }
  if (typeof value === 'string') {
    let sanitized = value.replace(/(token=)[^&]+/gi, '$1[redacted]');
    if (/(api[_-]?key|authorization|secret|token|password)/i.test(key) && !/sessionId|attemptId|leaseId/i.test(key)) {
      sanitized = '[redacted]';
    }
    return sanitized;
  }
  return value;
}

function printStep(title, payload) {
  process.stdout.write(`\n=== ${title} ===\n`);
  if (payload !== undefined) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  }
}

function ensureAbsolute(baseUrl, endpoint) {
  return endpoint.startsWith('http://') || endpoint.startsWith('https://')
    ? endpoint
    : new URL(endpoint, baseUrl).toString();
}

async function readJsonInput(config) {
  if (config.executeBodyJson) {
    return JSON.parse(config.executeBodyJson);
  }
  if (config.executeBodyFile) {
    const raw = await readFile(path.resolve(config.executeBodyFile), 'utf8');
    return JSON.parse(raw);
  }
  return undefined;
}

async function apiRequest(config, endpoint, init = {}) {
  const url = ensureAbsolute(config.baseUrl, endpoint);
  const headers = new Headers(init.headers ?? {});
  headers.set('authorization', `Bearer ${config.apiKey}`);
  if (!headers.has('content-type') && init.body !== undefined) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(url, {
    ...init,
    headers,
  });

  let body = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    url,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  };
}

async function pollUntil(config, endpoint, predicate, label) {
  const timeoutMs = Math.max(Number(config.pollSeconds) || 0, 0) * 1000;
  if (!timeoutMs) return null;
  const intervalMs = Math.max(Number(config.pollIntervalSeconds) || 5, 1) * 1000;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const result = await apiRequest(config, endpoint, { method: 'GET' });
    if (predicate(result.body)) {
      printStep(`${label} resolved`, sanitizeValue(result.body));
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

function toMarkdown(config, transcript, summary) {
  const lines = [
    '# AgentPay Founder Proof Demo Transcript',
    '',
    `- Generated: ${new Date().toISOString()}`,
    `- Base URL: ${config.baseUrl}`,
    `- Provider: ${config.provider}`,
    `- Workbench: ${config.workbenchId}`,
    `- Subject: ${config.subjectType}:${config.subjectRef}`,
    '',
    '## Summary',
    '',
    ...summary.map((line) => `- ${line}`),
    '',
    '## Steps',
    '',
  ];

  for (const entry of transcript) {
    lines.push(`### ${entry.step}`);
    lines.push('');
    lines.push(`- Status: ${entry.status}`);
    lines.push(`- Endpoint: ${entry.endpoint}`);
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(entry.payload, null, 2));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  const config = {
    baseUrl: args['base-url'] ?? process.env.AGENTPAY_BASE_URL ?? 'https://api.agentpay.so',
    apiKey: args['api-key'] ?? process.env.AGENTPAY_API_KEY,
    principalId: args['principal-id'] ?? process.env.AGENTPAY_PRINCIPAL_ID,
    operatorId: args['operator-id'] ?? process.env.AGENTPAY_OPERATOR_ID ?? null,
    provider: args.provider ?? process.env.AGENTPAY_PROVIDER ?? 'databento',
    subjectType: args['subject-type'] ?? process.env.AGENTPAY_SUBJECT_TYPE ?? 'workspace',
    workbenchId: args['workbench-id'] ?? process.env.AGENTPAY_WORKBENCH_ID ?? `founder-proof-${args.provider ?? process.env.AGENTPAY_PROVIDER ?? 'databento'}`,
    workbenchLabel: args['workbench-label'] ?? process.env.AGENTPAY_WORKBENCH_LABEL ?? path.basename(process.cwd()),
    subjectRef: args['subject-ref'] ?? process.env.AGENTPAY_SUBJECT_REF ?? args['workbench-id'] ?? process.env.AGENTPAY_WORKBENCH_ID ?? `founder-proof-${args.provider ?? process.env.AGENTPAY_PROVIDER ?? 'databento'}`,
    resumeUrl: args['resume-url'] ?? process.env.AGENTPAY_RESUME_URL ?? 'http://localhost:3000/agentpay-resume',
    contactEmail: args['contact-email'] ?? process.env.AGENTPAY_CONTACT_EMAIL ?? null,
    contactName: args['contact-name'] ?? process.env.AGENTPAY_CONTACT_NAME ?? null,
    issueWorkbenchLease: args['no-issue-workbench-lease'] ? false : true,
    allowPaidUsage: args['no-allow-paid-usage'] ? false : true,
    executeMethod: args['execute-method'] ?? 'POST',
    executePath: args['execute-path'] ?? null,
    executeBodyJson: args['execute-body-json'] ?? null,
    executeBodyFile: args['execute-body-file'] ?? null,
    pollSeconds: Number(args['poll-seconds'] ?? process.env.AGENTPAY_DEMO_POLL_SECONDS ?? '0'),
    pollIntervalSeconds: Number(args['poll-interval'] ?? process.env.AGENTPAY_DEMO_POLL_INTERVAL ?? '5'),
    transcriptPath: path.resolve(args['transcript-path'] ?? process.env.AGENTPAY_DEMO_TRANSCRIPT_PATH ?? 'ops/founder-demo/latest-proof-demo.md'),
    jsonPath: path.resolve(args['json-path'] ?? process.env.AGENTPAY_DEMO_JSON_PATH ?? 'ops/founder-demo/latest-proof-demo.json'),
  };

  if (!config.apiKey || !config.principalId) {
    throw new Error('Missing required inputs. Provide --api-key and --principal-id, or set AGENTPAY_API_KEY and AGENTPAY_PRINCIPAL_ID.');
  }

  const transcript = [];
  const summary = [];
  const executeBody = await readJsonInput(config);

  const bootstrapQuery = new URLSearchParams({
    principalId: config.principalId,
    subjectType: config.subjectType,
    subjectRef: config.subjectRef,
    workbenchId: config.workbenchId,
  });
  if (config.operatorId) bootstrapQuery.set('operatorId', config.operatorId);

  const bootstrap = await apiRequest(config, `/api/capabilities/authority-bootstrap?${bootstrapQuery.toString()}`, { method: 'GET' });
  transcript.push({
    step: 'Authority bootstrap',
    status: bootstrap.status,
    endpoint: bootstrap.url,
    payload: sanitizeValue(bootstrap.body),
  });
  printStep('Authority bootstrap', sanitizeValue(bootstrap.body));
  summary.push(`Authority bootstrap status: ${bootstrap.body?.status ?? bootstrap.status}`);

  const resolvePayload = {
    provider: config.provider,
    subjectType: config.subjectType,
    subjectRef: config.subjectRef,
    principalId: config.principalId,
    operatorId: config.operatorId,
    workbenchId: config.workbenchId,
    workbenchLabel: config.workbenchLabel,
    resumeUrl: config.resumeUrl,
    issueWorkbenchLease: config.issueWorkbenchLease,
  };

  let resolve = await apiRequest(config, '/api/capabilities/access-resolve', {
    method: 'POST',
    body: JSON.stringify(resolvePayload),
  });
  transcript.push({
    step: 'Access resolve',
    status: resolve.status,
    endpoint: resolve.url,
    payload: sanitizeValue(resolve.body),
  });
  printStep('Access resolve', sanitizeValue(resolve.body));

  if (resolve.body?.status === 'auth_required') {
    const onboardingUrl = resolve.body?.nextAction?.displayPayload?.onboardingUrl;
    const actionSessionId = resolve.body?.actionSession?.sessionId;
    summary.push('AgentPay still needs one hosted setup step before governed access exists.');
    if (onboardingUrl) {
      process.stdout.write(`\nHosted onboarding URL:\n${sanitizeValue(onboardingUrl)}\n`);
    }
    if (actionSessionId && config.pollSeconds > 0) {
      const actionResult = await pollUntil(
        config,
        `/api/actions/${actionSessionId}`,
        (body) => ['completed', 'failed', 'expired'].includes(body?.status),
        'Hosted action session',
      );
      if (actionResult) {
        transcript.push({
          step: 'Hosted action session',
          status: actionResult.status,
          endpoint: actionResult.url,
          payload: sanitizeValue(actionResult.body),
        });
        resolve = await apiRequest(config, '/api/capabilities/access-resolve', {
          method: 'POST',
          body: JSON.stringify(resolvePayload),
        });
        transcript.push({
          step: 'Access resolve after setup',
          status: resolve.status,
          endpoint: resolve.url,
          payload: sanitizeValue(resolve.body),
        });
        printStep('Access resolve after setup', sanitizeValue(resolve.body));
      }
    }
  }

  let leaseToken = resolve.body?.workbenchLease?.token ?? null;
  if (leaseToken) {
    summary.push('Workbench lease issued for same-workbench governed reuse.');
  } else if (resolve.body?.status === 'ready') {
    summary.push('Governed access is ready, but no lease token was issued on this pass.');
  }

  if (resolve.body?.status === 'ready' && config.executePath) {
    const executeEndpoint = resolve.body?.execute?.endpoint ?? `/api/capabilities/${resolve.body?.capability?.id ?? ''}/execute`;
    const executePayload = {
      principalId: config.principalId,
      operatorId: config.operatorId,
      customerEmail: config.contactEmail,
      customerName: config.contactName,
      resumeUrl: config.resumeUrl,
      workbenchId: config.workbenchId,
      method: config.executeMethod,
      path: config.executePath,
      body: executeBody,
      allowPaidUsage: config.allowPaidUsage,
      requestId: `founder_demo_${Date.now()}`,
    };

    const execute = await apiRequest(config, executeEndpoint, {
      method: 'POST',
      body: JSON.stringify(executePayload),
    });
    transcript.push({
      step: 'Direct capability execute',
      status: execute.status,
      endpoint: execute.url,
      payload: sanitizeValue(execute.body),
    });
    printStep('Direct capability execute', sanitizeValue(execute.body));
    summary.push(`Direct execute status: ${execute.body?.status ?? execute.status}`);

    const executionStatusUrl = execute.body?.executionAttempt?.statusUrl ?? execute.body?.nextAction?.executionStatusUrl ?? null;
    if (executionStatusUrl && config.pollSeconds > 0) {
      const executionAttempt = await pollUntil(
        config,
        executionStatusUrl,
        (body) => ['completed', 'failed', 'expired'].includes(body?.attempt?.status),
        'Execution attempt',
      );
      if (executionAttempt) {
        transcript.push({
          step: 'Execution attempt',
          status: executionAttempt.status,
          endpoint: executionAttempt.url,
          payload: sanitizeValue(executionAttempt.body),
        });
      }
    }

    if (!leaseToken && resolve.body?.status === 'ready' && config.issueWorkbenchLease) {
      const refreshed = await apiRequest(config, '/api/capabilities/access-resolve', {
        method: 'POST',
        body: JSON.stringify(resolvePayload),
      });
      transcript.push({
        step: 'Access resolve for lease refresh',
        status: refreshed.status,
        endpoint: refreshed.url,
        payload: sanitizeValue(refreshed.body),
      });
      printStep('Access resolve for lease refresh', sanitizeValue(refreshed.body));
      leaseToken = refreshed.body?.workbenchLease?.token ?? leaseToken;
    }

    if (leaseToken) {
      const leaseExecute = await apiRequest(config, '/api/capabilities/lease-execute', {
        method: 'POST',
        body: JSON.stringify({
          leaseToken,
          workbenchId: config.workbenchId,
          method: config.executeMethod,
          path: config.executePath,
          body: executeBody,
          allowPaidUsage: config.allowPaidUsage,
          requestId: `founder_demo_reuse_${Date.now()}`,
          principalId: config.principalId,
          operatorId: config.operatorId,
          customerEmail: config.contactEmail,
          customerName: config.contactName,
          resumeUrl: config.resumeUrl,
        }),
      });
      transcript.push({
        step: 'Same-workbench lease execute',
        status: leaseExecute.status,
        endpoint: leaseExecute.url,
        payload: sanitizeValue(leaseExecute.body),
      });
      printStep('Same-workbench lease execute', sanitizeValue(leaseExecute.body));
      summary.push(`Same-workbench reuse status: ${leaseExecute.body?.status ?? leaseExecute.status}`);
    }
  } else if (!config.executePath) {
    summary.push('No execute path supplied, so the script stopped after access resolution.');
  }

  await mkdir(path.dirname(config.transcriptPath), { recursive: true });
  await writeFile(config.transcriptPath, toMarkdown(config, transcript, summary), 'utf8');
  await writeFile(config.jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    config: sanitizeValue({
      baseUrl: config.baseUrl,
      provider: config.provider,
      subjectType: config.subjectType,
      subjectRef: config.subjectRef,
      workbenchId: config.workbenchId,
      workbenchLabel: config.workbenchLabel,
      resumeUrl: config.resumeUrl,
      transcriptPath: config.transcriptPath,
      jsonPath: config.jsonPath,
      executePath: config.executePath,
      executeMethod: config.executeMethod,
    }),
    summary,
    transcript,
  }, null, 2), 'utf8');

  process.stdout.write(`\nTranscript written to:\n- ${config.transcriptPath}\n- ${config.jsonPath}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
