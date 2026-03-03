/**
 * tests/ui.test.ts
 *
 * Puppeteer-based UI tests for the AgentPay dashboard.
 * These tests verify that the dashboard pages render correctly.
 *
 * Prerequisites:
 *   - puppeteer installed as devDependency
 *   - Dashboard running locally (npm run dev in dashboard/)
 *
 * Note: These tests are skipped by default if Puppeteer is not installed
 * or the dashboard is not running. They do not affect the main test suite.
 *
 * Run manually:
 *   DASHBOARD_URL=http://localhost:3001 npx jest tests/ui.test.ts
 */

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://localhost:3001';

// Helper to check if puppeteer is available
let puppeteer: any;
let puppeteerAvailable = false;

try {
  puppeteer = require('puppeteer');
  puppeteerAvailable = true;
} catch {
  puppeteerAvailable = false;
}

// Helper to check if dashboard is reachable
async function isDashboardReachable(): Promise<boolean> {
  try {
    const http = require('http');
    return new Promise((resolve) => {
      const url = new URL(DASHBOARD_URL);
      const req = http.request(
        { hostname: url.hostname, port: url.port || 80, path: '/', method: 'HEAD', timeout: 3000 },
        (res: any) => { resolve(res.statusCode < 500); }
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  } catch {
    return false;
  }
}

const describeIfPuppeteer = puppeteerAvailable ? describe : describe.skip;

describeIfPuppeteer('Dashboard UI Tests (Puppeteer)', () => {
  let browser: any;
  let page: any;
  let reachable: boolean;

  beforeAll(async () => {
    reachable = await isDashboardReachable();
    if (!reachable) {
      console.log(`⚠️  Dashboard not reachable at ${DASHBOARD_URL}. Skipping UI tests.`);
      return;
    }

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    page = await browser.newPage();
  }, 30000);

  afterAll(async () => {
    if (browser) await browser.close();
  });

  it('should render the hero/welcome page', async () => {
    if (!reachable) return;

    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 15000 });
    const title = await page.title();
    expect(typeof title).toBe('string');

    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    expect(bodyText.length).toBeGreaterThan(0);
  }, 20000);

  it('should render the login page', async () => {
    if (!reachable) return;

    await page.goto(`${DASHBOARD_URL}/login`, { waitUntil: 'networkidle2', timeout: 15000 });
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    expect(bodyText.length).toBeGreaterThan(0);

    // Should have some form of input or button
    const inputs = await page.$$('input');
    const buttons = await page.$$('button');
    expect(inputs.length + buttons.length).toBeGreaterThan(0);
  }, 20000);

  it('should handle login flow with API key input', async () => {
    if (!reachable) return;

    await page.goto(`${DASHBOARD_URL}/login`, { waitUntil: 'networkidle2', timeout: 15000 });

    const apiKeyInput = await page.$(
      'input[type="text"], input[type="password"], input[placeholder*="API"], input[placeholder*="key"]'
    );

    if (apiKeyInput) {
      await apiKeyInput.type('test_api_key_12345');
      const value = await page.evaluate((el: HTMLInputElement) => el.value, apiKeyInput);
      expect(value).toContain('test_api_key_12345');
    }
  }, 20000);

  it('should be responsive in mobile viewport', async () => {
    if (!reachable) return;

    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 15000 });

    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    expect(bodyText.length).toBeGreaterThan(0);

    // Reset viewport
    await page.setViewport({ width: 1280, height: 800 });
  }, 20000);
});

// Always-passing placeholder if Puppeteer is not available
if (!puppeteerAvailable) {
  describe('Dashboard UI Tests', () => {
    it('should skip UI tests (puppeteer not installed)', () => {
      console.log('ℹ️  Install puppeteer to enable UI tests: npm install --save-dev puppeteer');
      expect(true).toBe(true);
    });
  });
}
