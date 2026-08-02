# Application assistant

Drives **your own signed-in Chrome** through a queue of job applications: opens each
posting, works out which applicant tracking system it is, fills every field it can
from your profile, attaches the CV written for that role — then stops and hands you
the tab.

**It never clicks submit.** There is no submit selector anywhere in this codebase.
You read the form and submit it yourself.

That is a deliberate design choice, not a limitation:

- The slow part of applying is filling, not clicking. This removes the slow part.
- A human stays on the decision, so a bad field map costs a minute rather than an application.
- Nothing has to defeat a bot check, because a person is completing the action.
- Employers' terms generally prohibit automated submission. Filling your own forms in
  your own browser and submitting them yourself does not cross that line.

## Why it attaches to a running Chrome

Session cookies are the hard part. A freshly launched automated browser is signed
out of Indeed, Greenhouse and Ashby, and logging it in means handling credentials and
2FA. Attaching to a browser you already signed into sidesteps all of that.

## Setup

**1. Install Playwright** (the only dependency):

```bash
npm i -D playwright
```

**2. Launch Chrome with debugging on a dedicated profile.**

Chrome 136 and later refuse `--remote-debugging-port` against your default
`--user-data-dir`, so this must be a separate profile. Sign into Indeed once inside
it and the session persists.

```bash
# macOS
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-apply-profile"

# Linux
google-chrome --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.chrome-apply-profile"
```

**3. Fill in your profile:**

```bash
cp scripts/apply/profile.example.json scripts/apply/profile.json
```

Replace every `TODO`. The runner will not start while any remain — including the
education fields, which are the same gap flagged on every CV.

**4. Put the CVs on disk.** Most ATS want a PDF upload, not a Drive link. Export each
document from the [Drive folder](https://drive.google.com/drive/folders/1fUhOcTcUuaTqcw8WIMCIqy-dGW4FFJKF)
as PDF into `scripts/apply/cvs/`, named to match the `cv` field in `queue.json`
(`reflection-fde.pdf`, `plaud-evals.pdf`, and so on). The runner checks they all
exist before opening the browser, so you find out up front rather than mid-run.

## Running

```bash
npm run apply                                  # walk everything still pending
npm run apply -- --only wintermute-mlr         # just one, or a comma-separated set
npm run apply -- --dry-run                     # list what would be opened, no browser
npm run apply:status                           # what has happened so far
```

For each role you get a coverage report — fields filled, fields the map missed, and
any free-text question that needs you — then a prompt:

```
[s]ubmitted · s[k]ip · [m]anual follow-up · [q]uit >
```

Your answer is written to `state.json`, so the next run picks up where you left off.
That file is plain JSON: open it and correct it by hand if you need to.

## Supported ATS

| ATS | Behaviour |
| --- | --- |
| Greenhouse | Full field map |
| Ashby | Full field map |
| Lever | Full field map |
| Workday | Detected, opened for manual completion — it is account-gated and multi-step |
| Anything else | Detected, opened for manual completion |

Greenhouse and Ashby cover most of the current queue. Adding an ATS means adding a
detector and a field map in `lib/ats.mjs`; nothing else changes.

Selectors drift when vendors redesign. When a field stops filling, the run tells you
which one — the fix is a new candidate selector in that map's array, and the existing
ones stay in place as fallbacks.

## Free-text answers

Questions like "why this company" carry the most weight and are the ones worth
writing yourself, so they are surfaced rather than auto-filled. If you do want one
prefilled, add an `answers` object to that role in `queue.json`, keyed on a substring
of the question label:

```json
{
  "id": "wintermute-mlr",
  "answers": {
    "why": "Your alpha pipeline work is the closest thing on the market to..."
  }
}
```

## Files

```
scripts/apply/
  run.mjs                 walk the queue
  status.mjs              current state
  queue.json              roles, CV paths, per-role cautions
  profile.example.json    template — copy to profile.json (gitignored)
  lib/browser.mjs         attach to your Chrome over CDP
  lib/ats.mjs             ATS detection and field maps
  lib/fill.mjs            the fill engine — no submit, by design
  lib/state.mjs           run state
  cvs/                    exported PDFs (gitignored)
  screenshots/            per-role capture after filling (gitignored)
```
