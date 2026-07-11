#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const targets = [
  {
    name: 'docs website',
    args: ['audit', '--workspace', 'apps/docs', '--json'],
    allowModerate: true,
  },
  {
    name: 'API edge',
    args: ['audit', '--workspace', 'apps/api-edge', '--json'],
    allowModerate: false,
  },
  {
    name: 'CLI and Node SDK',
    args: ['audit', '--workspace', 'cli/agentpay', '--workspace', 'packages/sdk-node', '--json'],
    allowModerate: false,
  },
];

function runAudit(target) {
  const result = spawnSync('npm', target.args, {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
  });

  if (!result.stdout.trim()) {
    throw new Error(`${target.name}: npm audit returned no JSON output\n${result.stderr}`);
  }

  const report = JSON.parse(result.stdout);
  const counts = report.metadata?.vulnerabilities ?? {};
  const critical = counts.critical ?? 0;
  const high = counts.high ?? 0;
  const moderate = counts.moderate ?? 0;
  const total = counts.total ?? 0;
  const fail =
    critical > 0 ||
    high > 0 ||
    (!target.allowModerate && moderate > 0);

  return {
    name: target.name,
    counts: { critical, high, moderate, total },
    vulnerabilities: Object.keys(report.vulnerabilities ?? {}),
    fail,
    allowModerate: target.allowModerate,
  };
}

const results = targets.map(runAudit);

console.log('AgentPay release-surface audit\n');
for (const result of results) {
  const { critical, high, moderate, total } = result.counts;
  const status = result.fail ? 'FAIL' : 'PASS';
  console.log(`${status} ${result.name}: ${total} total (${critical} critical, ${high} high, ${moderate} moderate)`);
  if (result.vulnerabilities.length > 0) {
    console.log(`  advisories: ${result.vulnerabilities.join(', ')}`);
  }
  if (result.allowModerate && moderate > 0 && high === 0 && critical === 0) {
    console.log('  note: moderate advisories are currently tolerated for docs only; root audit still tracks them.');
  }
}

const failed = results.filter(result => result.fail);
if (failed.length > 0) {
  console.error('\nRelease-surface audit failed.');
  process.exit(1);
}

console.log('\nRelease-surface audit passed: no high/critical findings on the checked deployable surfaces.');
