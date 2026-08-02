#!/usr/bin/env node
/** Prints the queue and what has happened to each role so far. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadState, STATUS } from './lib/state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const MARK = {
  [STATUS.SUBMITTED]: '✓',
  [STATUS.SKIPPED]: '–',
  [STATUS.MANUAL]: '!',
  [STATUS.PENDING]: '·',
};

const queue = JSON.parse(await readFile(resolve(HERE, 'queue.json'), 'utf8'));
const state = await loadState();

const counts = { submitted: 0, skipped: 0, manual: 0, pending: 0 };
const rows = queue.roles.map((role) => {
  const status = state[role.id]?.status ?? STATUS.PENDING;
  if (status === STATUS.SUBMITTED) counts.submitted++;
  else if (status === STATUS.SKIPPED) counts.skipped++;
  else if (status === STATUS.MANUAL) counts.manual++;
  else counts.pending++;
  return { role, status, note: state[role.id]?.note };
});

const width = Math.max(...queue.roles.map((r) => r.company.length));

console.log(`\n${queue.label ?? 'Application queue'}\n`);
for (const { role, status, note } of rows) {
  const mark = MARK[status] ?? '·';
  console.log(
    `  ${mark} ${role.company.padEnd(width)}  ${role.title}${note ? `  — ${note}` : ''}`
  );
}
console.log(
  `\n  ${counts.submitted} submitted · ${counts.pending} pending · ` +
    `${counts.manual} need manual follow-up · ${counts.skipped} skipped\n`
);
