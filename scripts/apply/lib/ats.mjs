/**
 * ATS detection and field maps.
 *
 * Every applicant tracking system names its inputs differently, and the names
 * drift as vendors ship redesigns. So each field carries a list of candidate
 * selectors tried in order, and the filler reports what it could not find
 * rather than pretending the form is complete.
 *
 * To add a new ATS: add a detector and a map. Nothing else needs to change.
 */

/** Field keys map onto profile.json — see profile.example.json. */
export const FIELD = {
  FIRST_NAME: 'firstName',
  LAST_NAME: 'lastName',
  FULL_NAME: 'fullName',
  EMAIL: 'email',
  PHONE: 'phone',
  LOCATION: 'location',
  LINKEDIN: 'linkedin',
  GITHUB: 'github',
  WEBSITE: 'website',
  RESUME: 'resume',
};

const GREENHOUSE = {
  id: 'greenhouse',
  label: 'Greenhouse',
  match: (url) => /(?:job-boards|boards)\.greenhouse\.io/.test(url),
  fields: {
    [FIELD.FIRST_NAME]: ['#first_name', 'input[name="first_name"]'],
    [FIELD.LAST_NAME]: ['#last_name', 'input[name="last_name"]'],
    [FIELD.EMAIL]: ['#email', 'input[name="email"]'],
    [FIELD.PHONE]: ['#phone', 'input[name="phone"]'],
    [FIELD.LOCATION]: ['#candidate-location', 'input[name="location"]', 'input[autocomplete="address-level2"]'],
    [FIELD.LINKEDIN]: ['input[name*="linkedin" i]', 'input[id*="linkedin" i]'],
    [FIELD.GITHUB]: ['input[name*="github" i]', 'input[id*="github" i]'],
    [FIELD.WEBSITE]: ['input[name*="website" i]', 'input[id*="website" i]'],
  },
  resume: ['input[type="file"]#resume', 'input[type="file"][name*="resume" i]', 'input[type="file"]'],
  // Free-text and dropdown questions vary per posting; discovered at runtime.
  questionContainers: ['.field', '[class*="question"]'],
};

const ASHBY = {
  id: 'ashby',
  label: 'Ashby',
  match: (url) => /jobs\.ashbyhq\.com/.test(url),
  fields: {
    [FIELD.FULL_NAME]: ['input[name="_systemfield_name"]', 'input[aria-label="Name"]'],
    [FIELD.EMAIL]: ['input[name="_systemfield_email"]', 'input[type="email"]'],
    [FIELD.PHONE]: ['input[name="_systemfield_phone"]', 'input[type="tel"]'],
    [FIELD.LINKEDIN]: ['input[name*="linkedin" i]'],
    [FIELD.GITHUB]: ['input[name*="github" i]'],
    [FIELD.WEBSITE]: ['input[name*="website" i]'],
  },
  resume: ['input[type="file"][name="_systemfield_resume"]', 'input[type="file"]'],
  questionContainers: ['[class*="_fieldEntry"]', '[class*="ashby-application-form-field"]'],
};

const LEVER = {
  id: 'lever',
  label: 'Lever',
  match: (url) => /jobs\.(?:eu\.)?lever\.co/.test(url),
  fields: {
    [FIELD.FULL_NAME]: ['input[name="name"]'],
    [FIELD.EMAIL]: ['input[name="email"]'],
    [FIELD.PHONE]: ['input[name="phone"]'],
    [FIELD.LOCATION]: ['input[name="location"]'],
    [FIELD.LINKEDIN]: ['input[name="urls[LinkedIn]"]', 'input[name*="LinkedIn"]'],
    [FIELD.GITHUB]: ['input[name="urls[GitHub]"]', 'input[name*="GitHub"]'],
    [FIELD.WEBSITE]: ['input[name="urls[Portfolio]"]', 'input[name*="Portfolio"]'],
  },
  resume: ['input[type="file"][name="resume"]', 'input[type="file"]'],
  questionContainers: ['.application-question', '.application-additional'],
};

/**
 * Workday is multi-step, account-gated and actively hostile to automation.
 * Detected so the runner can say so plainly and hand you the tab, rather than
 * half-filling step one and leaving you to guess what it touched.
 */
const WORKDAY = {
  id: 'workday',
  label: 'Workday',
  match: (url) => /myworkdayjobs\.com/.test(url),
  manualOnly: true,
  reason: 'Workday gates applications behind an account and spans several steps. Opened for you to complete by hand.',
  fields: {},
  resume: [],
  questionContainers: [],
};

const UNKNOWN = {
  id: 'unknown',
  label: 'Unrecognised ATS',
  match: () => true,
  manualOnly: true,
  reason: 'No field map for this host yet. Opened for you to complete by hand — add a map in lib/ats.mjs if it recurs.',
  fields: {},
  resume: [],
  questionContainers: [],
};

const REGISTRY = [GREENHOUSE, ASHBY, LEVER, WORKDAY, UNKNOWN];

export function detect(url) {
  return REGISTRY.find((ats) => ats.match(url)) ?? UNKNOWN;
}

export const registeredAts = REGISTRY.filter((a) => a !== UNKNOWN).map((a) => a.label);
