#!/usr/bin/env node
/**
 * Walks the application queue in your own signed-in Chrome.
 *
 * For each role: open the posting, work out which ATS it is, fill every field
 * it can from your profile, attach the CV written for that role, then stop and
 * hand you the tab. You read it, fix what the map missed, and click submit.
 *
 *   npm run apply
 *   npm run apply -- --only reflection-fde,wintermute-mlr
 *   npm run apply -- --dry-run
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { attach, openTab } from './lib/browser.mjs';
import { fillApplication, summarise } from './lib/fill.mjs';
import { loadState, record, isDone, STATUS } from './lib/state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROFILE_PATH = resolve(HERE, 'profile.json');
const QUEUE_PATH = resolve(HERE, 'queue.json');
const SHOTS_DIR = resolve(HERE, 'screenshots');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = (() => {
  const i = args.indexOf('--only');
  return i === -1 ? null : new Set(args[i + 1]?.split(',').map((s) => s.trim()));
})();

const PLACEHOLDER = /^\s*(TODO|FILL_ME|\[.*\])\s*$/i;

function findPlaceholders(value, path = []) {
  if (typeof value === 'string') return PLACEHOLDER.test(value) ? [path.join('.')] : [];
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => findPlaceholders(v, [...path, k]));
  }
  return [];
}

async function loadJson(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label} at ${path}. Copy profile.example.json to profile.json and fill it in.`);
  }
  return JSON.parse(await readFile(path, 'utf8'));
}

function printReport(role, report) {
  console.log(`\n  ATS: ${report.ats.label}`);

  if (report.manualOnly) {
    console.log(`  ${report.reason}`);
    return;
  }

  const { filled, total, missing, open } = summarise(report);
  console.log(`  Filled ${filled}/${total} mapped fields.`);
  if (missing.length) console.log(`  Not found (fill by hand): ${missing.join(', ')}`);
  if (open.length) {
    console.log(`  Free-text questions needing you:`);
    for (const label of open) console.log(`    · ${label}`);
  }
  console.log(`  CV attached: ${report.fields.resume?.status === 'filled' ? role.cv : 'NOT ATTACHED — do it by hand'}`);
}

async function main() {
  const [profile, queue] = await Promise.all([
    loadJson(PROFILE_PATH, 'profile'),
    loadJson(QUEUE_PATH, 'queue'),
  ]);

  const gaps = findPlaceholders(profile);
  if (gaps.length) {
    console.error(`profile.json still has placeholders — fill these before running:\n`);
    for (const g of gaps) console.error(`  · ${g}`);
    process.exitCode = 1;
    return;
  }

  const state = await loadState();
  let roles = queue.roles.filter((r) => !isDone(state, r.id));
  if (ONLY) roles = roles.filter((r) => ONLY.has(r.id));

  if (!roles.length) {
    console.log('Nothing pending. Run `npm run apply:status` to see the queue.');
    return;
  }

  const missingCvs = roles.filter((r) => r.cv && !existsSync(resolve(HERE, r.cv)));

  // Dry run inspects the plan, so it must work before any CV has been exported.
  // It reports what is missing instead of refusing to run.
  if (DRY_RUN) {
    console.log(`${roles.length} role(s) pending. (dry run — no browser)\n`);
    for (const role of roles) {
      const cvReady = !role.cv || existsSync(resolve(HERE, role.cv));
      console.log(`  ${cvReady ? '✓' : '·'} ${role.id} — ${role.title} @ ${role.company}`);
      if (role.caution) console.log(`      caution: ${role.caution}`);
    }
    if (missingCvs.length) {
      console.log(`\n  ${missingCvs.length} CV(s) not yet exported to scripts/apply/cvs/ — see README.`);
    }
    return;
  }

  // A real run needs every CV present. Fail now, not with a browser open.
  if (missingCvs.length) {
    console.error('These CVs are not on disk — export them from Drive first (see README):\n');
    for (const r of missingCvs) console.error(`  · ${r.id} → ${r.cv}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${roles.length} role(s) pending.`);

  const { browser, context } = await attach();
  const rl = createInterface({ input: stdin, output: stdout });

  try {
    for (const [index, role] of roles.entries()) {
      console.log(`\n${'─'.repeat(64)}`);
      console.log(`[${index + 1}/${roles.length}] ${role.title} — ${role.company}`);
      console.log(`  ${role.url}`);

      const page = await openTab(context);
      await page.bringToFront();

      try {
        await page.goto(role.url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await page.waitForTimeout(1500); // let client-rendered forms settle
      } catch (err) {
        console.log(`  ! Could not load the page: ${err.message}`);
        await record(role.id, STATUS.MANUAL, 'page failed to load');
        continue;
      }

      const resolvedRole = { ...role, cv: role.cv ? resolve(HERE, role.cv) : null };
      let report;
      try {
        report = await fillApplication(page, { profile, role: resolvedRole });
        printReport(resolvedRole, report);
      } catch (err) {
        console.log(`  ! Fill failed: ${err.message}`);
        await record(role.id, STATUS.MANUAL, `fill error: ${err.message}`);
        continue;
      }

      try {
        await page.screenshot({ path: resolve(SHOTS_DIR, `${role.id}.png`), fullPage: true });
      } catch {
        // A screenshot is a convenience, never a reason to stop.
      }

      console.log('\n  Review the tab, finish anything above, then submit it yourself.');
      const answer = (
        await rl.question('  [s]ubmitted · s[k]ip · [m]anual follow-up · [q]uit > ')
      ).trim().toLowerCase();

      if (answer === 'q') {
        console.log('Stopped. Progress saved.');
        break;
      }
      const status =
        answer === 's' ? STATUS.SUBMITTED : answer === 'k' ? STATUS.SKIPPED : STATUS.MANUAL;
      await record(role.id, status);
      console.log(`  Recorded: ${status}`);
    }
  } finally {
    rl.close();
    // Detach only — never close a browser we did not launch.
    await browser.close().catch(() => {});
  }

  console.log('\nDone. `npm run apply:status` for the current picture.');
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  if (err.cause) console.error(err.cause.message);
  process.exitCode = 1;
});
