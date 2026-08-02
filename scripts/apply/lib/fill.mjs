/**
 * The fill engine.
 *
 * Hard rule, enforced by omission: nothing in this file clicks a submit
 * control. There is no submit selector anywhere in the codebase. The runner
 * fills the form and hands you the tab; you read it and submit it yourself.
 * That keeps a human on the decision, avoids fighting bot checks, and means a
 * bad field map wastes a minute rather than an application.
 */
import { detect, FIELD } from './ats.mjs';

const FILL_TIMEOUT = 2500;

/** Tries each candidate selector in turn; returns the first that is present and editable. */
async function firstEditable(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if ((await locator.count()) === 0) continue;
      if (!(await locator.isVisible({ timeout: FILL_TIMEOUT }))) continue;
      if (!(await locator.isEditable({ timeout: FILL_TIMEOUT }))) continue;
      return locator;
    } catch {
      // Selector did not resolve in time — move on to the next candidate.
    }
  }
  return null;
}

async function fillField(page, selectors, value) {
  if (!value) return { status: 'no-value' };
  const target = await firstEditable(page, selectors);
  if (!target) return { status: 'not-found' };
  try {
    await target.fill(String(value));
    return { status: 'filled' };
  } catch (err) {
    return { status: 'error', detail: err.message };
  }
}

async function attachResume(page, selectors, resumePath) {
  if (!resumePath) return { status: 'no-value' };
  for (const selector of selectors) {
    const input = page.locator(selector).first();
    try {
      if ((await input.count()) === 0) continue;
      await input.setInputFiles(resumePath);
      return { status: 'filled' };
    } catch {
      // Some forms hide the real input behind a button; try the next candidate.
    }
  }
  return { status: 'not-found' };
}

/**
 * Finds free-text boxes the field map does not cover — "why this company",
 * "tell us about a project". These carry the most weight and are the ones
 * worth writing yourself, so they are surfaced rather than auto-filled unless
 * the queue entry supplies an explicit answer.
 */
async function surfaceOpenQuestions(page, answers = {}) {
  const textareas = page.locator('textarea:visible');
  const count = await textareas.count();
  const found = [];

  for (let i = 0; i < count; i++) {
    const box = textareas.nth(i);
    const label =
      (await box.getAttribute('aria-label')) ||
      (await box.getAttribute('name')) ||
      (await box.getAttribute('placeholder')) ||
      `textarea ${i + 1}`;

    const key = Object.keys(answers).find((k) => label.toLowerCase().includes(k.toLowerCase()));
    if (key) {
      try {
        await box.fill(answers[key]);
        found.push({ label, status: 'filled-from-queue' });
        continue;
      } catch {
        /* fall through to manual */
      }
    }
    found.push({ label, status: 'needs-you' });
  }
  return found;
}

/**
 * Fills what it can and reports honestly on the rest.
 * Returns a per-field report so the runner can print real coverage instead of
 * claiming success.
 */
export async function fillApplication(page, { profile, role }) {
  const ats = detect(page.url());

  if (ats.manualOnly) {
    return { ats, manualOnly: true, reason: ats.reason, fields: {}, questions: [] };
  }

  const values = {
    [FIELD.FIRST_NAME]: profile.firstName,
    [FIELD.LAST_NAME]: profile.lastName,
    [FIELD.FULL_NAME]: [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    [FIELD.EMAIL]: profile.email,
    [FIELD.PHONE]: profile.phone,
    [FIELD.LOCATION]: profile.location,
    [FIELD.LINKEDIN]: profile.links?.linkedin,
    [FIELD.GITHUB]: profile.links?.github,
    [FIELD.WEBSITE]: profile.links?.website,
  };

  const fields = {};
  for (const [key, selectors] of Object.entries(ats.fields)) {
    fields[key] = await fillField(page, selectors, values[key]);
  }

  fields[FIELD.RESUME] = await attachResume(page, ats.resume, role.cv);
  const questions = await surfaceOpenQuestions(page, role.answers);

  return { ats, manualOnly: false, fields, questions };
}

export function summarise(report) {
  const entries = Object.entries(report.fields);
  const filled = entries.filter(([, r]) => r.status === 'filled').length;
  const missing = entries.filter(([, r]) => r.status === 'not-found').map(([k]) => k);
  const open = report.questions.filter((q) => q.status === 'needs-you').map((q) => q.label);
  return { filled, total: entries.length, missing, open };
}
