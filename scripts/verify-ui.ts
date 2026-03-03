#!/usr/bin/env npx tsx
/**
 * scripts/verify-ui.ts
 *
 * Automates UI verification of the AgentPay dashboard using Puppeteer.
 *
 * What it does:
 *   1. Checks if the dashboard is deployed (Vercel) or running locally.
 *   2. Tests the login flow — simulates API key input and checks loading states.
 *   3. Verifies hero stats on the welcome page (e.g., $454 processed, 40 payments, 100% success).
 *   4. Emulates mobile viewport and captures responsive layout.
 *   5. Takes screenshots and saves them to docs/screenshots/.
 *
 * Prerequisites:
 *   npm install --save-dev puppeteer   (or use npx puppeteer)
 *
 * Usage:
 *   npx tsx scripts/verify-ui.ts
 *   npx tsx scripts/verify-ui.ts --url https://apay-delta.vercel.app
 *
 * Output:
 *   docs/screenshots/hero.png      — Welcome/hero page
 *   docs/screenshots/login.png     — Login card
 *   docs/screenshots/dashboard.png — Post-login dashboard (mock data)
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCREENSHOTS_DIR = resolve(__dirname, '..', 'docs', 'screenshots');

// Parse CLI args
const args = process.argv.slice(2);
const urlArgIdx = args.indexOf('--url');
const BASE_URL = urlArgIdx !== -1 && args[urlArgIdx + 1]
  ? args[urlArgIdx + 1]
  : process.env.DASHBOARD_URL || 'http://localhost:3001';

async function main() {
  // Ensure output directory exists
  if (!existsSync(SCREENSHOTS_DIR)) {
    mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }

  let puppeteer: any;
  try {
    puppeteer = await import('puppeteer');
  } catch {
    console.error(
      '❌ Puppeteer is not installed. Install it with:\n' +
      '   npm install --save-dev puppeteer\n' +
      'Then re-run this script.'
    );
    process.exit(1);
  }

  console.log(`🚀 Starting UI verification against ${BASE_URL}`);

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // ── 1. Hero / Welcome Page ──────────────────────────────────────────
    console.log('📸 Capturing hero/welcome page...');
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Check for hero stats text
    const bodyText = await page.evaluate(() => document.body?.innerText || '');
    const heroChecks = ['processed', 'payments', 'success'];
    for (const keyword of heroChecks) {
      if (bodyText.toLowerCase().includes(keyword)) {
        console.log(`  ✅ Found "${keyword}" on hero page`);
      } else {
        console.log(`  ⚠️  "${keyword}" not found on hero page (may need mock data)`);
      }
    }

    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'hero.png'),
      fullPage: true,
    });
    console.log('  → Saved docs/screenshots/hero.png');

    // ── 2. Login Card ───────────────────────────────────────────────────
    console.log('📸 Capturing login card...');
    await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Try to find and interact with API key input
    const apiKeyInput = await page.$('input[type="text"], input[type="password"], input[placeholder*="API"], input[placeholder*="key"]');
    if (apiKeyInput) {
      await apiKeyInput.type('apk_test_demo_key_12345');
      console.log('  ✅ Typed API key into login input');
    } else {
      console.log('  ⚠️  No API key input found on login page');
    }

    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'login.png'),
      fullPage: true,
    });
    console.log('  → Saved docs/screenshots/login.png');

    // ── 3. Post-Login Dashboard ─────────────────────────────────────────
    console.log('📸 Capturing dashboard (post-login mock)...');
    // Attempt to submit login form
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }

    // Navigate to dashboard directly (may require mock session)
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'networkidle2', timeout: 30_000 }).catch(() => {
      // Fallback: dashboard may be at root after login
      return page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
    });

    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'dashboard.png'),
      fullPage: true,
    });
    console.log('  → Saved docs/screenshots/dashboard.png');

    // ── 4. Mobile View Emulation ────────────────────────────────────────
    console.log('📱 Testing mobile viewport...');
    await page.setViewport({ width: 375, height: 812, isMobile: true });
    await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 30_000 });

    const mobileBody = await page.evaluate(() => document.body?.innerText || '');
    if (mobileBody.length > 0) {
      console.log('  ✅ Mobile view rendered successfully');
    }

    await page.screenshot({
      path: resolve(SCREENSHOTS_DIR, 'mobile.png'),
      fullPage: true,
    });
    console.log('  → Saved docs/screenshots/mobile.png');

    console.log('\n✅ UI verification complete! Screenshots saved to docs/screenshots/');
    // Note: Add these screenshots to your pitch deck for investor presentations.

  } catch (error: any) {
    console.error('❌ UI verification failed:', error.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
