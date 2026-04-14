import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';

const root = '/Users/baskar_viji/.openclaw';
const billWorkspace = path.join(root, 'workspace-bill');
const agencyWorkspace = path.join(root, 'workspace-agency-os');
const laneIds = ['jack', 'bigb', 'digital-you'];
const billHistory = '/Users/baskar_viji/hedge/.rumbling-hedge/logs/prediction-cycle-history.jsonl';
const now = new Date();

function fmtAge(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

async function readText(file) {
  if (!existsSync(file)) return '';
  return fs.readFile(file, 'utf8');
}

async function readJson(file) {
  if (!existsSync(file)) return null;
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

function tailSection(text, lines = 8) {
  if (!text.trim()) return 'none';
  return text.trim().split(/\r?\n/).slice(-lines).join('\n');
}

async function latestSession(agentId) {
  const store = await readJson(path.join(root, 'agents', agentId, 'sessions', 'sessions.json'));
  if (!store) return null;
  const items = Object.values(store);
  if (!items.length) return null;
  items.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  return items[0];
}

function launchdBillState() {
  try {
    const raw = execSync(`launchctl print gui/${process.getuid()}/com.agentpay.bill.prediction-cycle`, { encoding: 'utf8' });
    const rawState = raw.match(/state = ([^\n]+)/)?.[1]?.trim() ?? 'unknown';
    const runs = raw.match(/runs = ([^\n]+)/)?.[1]?.trim() ?? '0';
    const exitCode = raw.match(/last exit code = ([^\n]+)/)?.[1]?.trim() ?? 'unknown';
    const state = rawState === 'not running' && exitCode === '0' ? 'idle' : rawState;
    return { state, runs, exitCode };
  } catch {
    return { state: 'missing', runs: '0', exitCode: 'unknown' };
  }
}

async function latestBillIteration() {
  if (!existsSync(billHistory)) return null;
  const raw = await fs.readFile(billHistory, 'utf8');
  const rows = raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return rows.at(-1) ?? null;
}

function line(label, value = '') {
  return `${label.padEnd(16)} ${value}`;
}

const billSession = await latestSession('bill');
const billIteration = await latestBillIteration();
const billInbox = await readText(path.join(billWorkspace, 'INBOX.md'));
const billOutbox = await readText(path.join(billWorkspace, 'OUTBOX.md'));
const billLaunchd = launchdBillState();

const agencySessions = await Promise.all(laneIds.map(async (id) => [id, await latestSession(id)]));
const agencyInbox = await readText(path.join(agencyWorkspace, 'INBOX.md'));
const agencyOutbox = await readText(path.join(agencyWorkspace, 'OUTBOX.md'));

console.log(`Stack Monitor  ${now.toLocaleString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' })} IST`);
console.log(line('Host', os.hostname()));
console.log('');
console.log('Bill');
console.log(line('Launchd', `${billLaunchd.state} · runs ${billLaunchd.runs} · exit ${billLaunchd.exitCode}`));
if (billSession?.updatedAt) {
  console.log(line('Agent activity', fmtAge(now.getTime() - billSession.updatedAt)));
}
if (billIteration) {
  console.log(line('Cycle posture', billIteration.posture ?? 'unknown'));
  console.log(line('Venue counts', JSON.stringify(billIteration.collect?.venueCounts ?? {})));
  console.log(line('Counts', JSON.stringify(billIteration.scan?.counts ?? {})));
  console.log(line('Top candidate', billIteration.topCandidate ? JSON.stringify(billIteration.topCandidate) : 'none'));
}
console.log(line('Inbox', path.join(billWorkspace, 'INBOX.md')));
console.log(line('Outbox', path.join(billWorkspace, 'OUTBOX.md')));
console.log('Bill inbox tail');
console.log(tailSection(billInbox, 6));
console.log('Bill outbox tail');
console.log(tailSection(billOutbox, 6));
console.log('');
console.log('Agency OS');
for (const [id, session] of agencySessions) {
  const advice = await readText(path.join(root, `workspace-${id}`, 'MAIN_ADVICE.md'));
  const postureLine = advice.split(/\r?\n/).find((row) => row.startsWith('- current posture:')) ?? 'no posture';
  console.log(line(id, `${session?.updatedAt ? fmtAge(now.getTime() - session.updatedAt) : 'never'} · ${postureLine.replace('- current posture: ', '')}`));
}
console.log(line('Inbox', path.join(agencyWorkspace, 'INBOX.md')));
console.log(line('Outbox', path.join(agencyWorkspace, 'OUTBOX.md')));
console.log('Agency inbox tail');
console.log(tailSection(agencyInbox, 8));
console.log('Agency outbox tail');
console.log(tailSection(agencyOutbox, 8));
console.log('');
console.log('Files');
console.log(line('Bill history', billHistory));
console.log(line('Bill summary', path.join(billWorkspace, 'memory')));
console.log(line('Agency status', path.join(agencyWorkspace, 'STATUS.md')));
console.log(line('Monitor cmd', '/Users/baskar_viji/Agentpay/ops/mac-mini/bin/stack-watch 10'));
