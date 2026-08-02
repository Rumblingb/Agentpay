/**
 * Run state, so a second pass does not reopen work you have already dealt with.
 * Deliberately a plain JSON file next to the queue: you should be able to open
 * it, see what happened, and correct it by hand.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = resolve(HERE, '..', 'state.json');

export const STATUS = {
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  SKIPPED: 'skipped',
  MANUAL: 'needs-manual',
};

export async function loadState() {
  if (!existsSync(STATE_PATH)) return {};
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf8'));
  } catch {
    console.warn(`! ${STATE_PATH} is not valid JSON — starting from empty state.`);
    return {};
  }
}

export async function saveState(state) {
  await writeFile(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);
}

export async function record(id, status, note) {
  const state = await loadState();
  state[id] = { status, note, at: new Date().toISOString() };
  await saveState(state);
  return state;
}

export function isDone(state, id) {
  const entry = state[id];
  return entry?.status === STATUS.SUBMITTED || entry?.status === STATUS.SKIPPED;
}
