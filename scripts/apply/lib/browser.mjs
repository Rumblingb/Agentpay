/**
 * Attaches to a Chrome you already launched and signed into, rather than
 * starting a fresh browser. That is the whole point: the session cookies for
 * Indeed, Greenhouse and Ashby live in your profile, and a clean automated
 * browser has none of them.
 *
 * Launch Chrome first (see README). Chrome 136+ refuses --remote-debugging-port
 * against the default user-data-dir, so the profile must be a dedicated one.
 */
const DEFAULT_ENDPOINT = process.env.APPLY_CDP_ENDPOINT || 'http://localhost:9222';

/**
 * Imported lazily so that --dry-run and the profile validation still work
 * before Playwright is installed, and so a missing dependency reports itself
 * as one line rather than a module resolution stack trace.
 */
async function loadChromium() {
  try {
    return (await import('playwright')).chromium;
  } catch (cause) {
    throw new Error('Playwright is not installed. Run:  npm i -D playwright', { cause });
  }
}

export async function attach({ endpoint = DEFAULT_ENDPOINT } = {}) {
  const chromium = await loadChromium();

  let browser;
  try {
    browser = await chromium.connectOverCDP(endpoint);
  } catch (cause) {
    throw new Error(
      `Could not attach to Chrome at ${endpoint}.\n` +
        `Start it with:\n\n` +
        `  google-chrome --remote-debugging-port=9222 \\\n` +
        `    --user-data-dir="$HOME/.chrome-apply-profile"\n\n` +
        `then sign into Indeed once in that window.`,
      { cause }
    );
  }

  const context = browser.contexts()[0];
  if (!context) {
    await browser.close();
    throw new Error('Chrome is running but has no open context. Open a tab and retry.');
  }

  return { browser, context };
}

/** Reuses a blank tab if one is going spare, otherwise opens a new one. */
export async function openTab(context) {
  const spare = context.pages().find((p) => p.url() === 'about:blank');
  return spare ?? (await context.newPage());
}
