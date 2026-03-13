const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const outDir = path.resolve(__dirname, '..', 'screenshots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const chromePaths = [
      process.env.CHROME_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ].filter(Boolean);

    let launchOptions = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    if (chromePaths.length > 0) launchOptions.executablePath = chromePaths[0];

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    const base = process.env.DASHBOARD_CAPTURE_BASE || 'http://localhost:3000';

    // 1. Full-page desktop
    await page.setViewport({ width: 1440, height: 1200 });
    await page.goto(`${base}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(outDir, 'full_desktop_home.png'), fullPage: true });
    console.log('Saved full_desktop_home.png');

    // 2. Hero + living network section (use hero section bounding box + globe)
    const heroHandle = await page.$('#hero-title');
    if (heroHandle) {
      const sectionHandle = await page.evaluateHandle((el) => el.closest('section'), heroHandle);
      const box = await sectionHandle.boundingBox();
      if (box && box.width && box.height) {
        await page.screenshot({ path: path.join(outDir, 'hero_living_network.png'), clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(box.width, 1400), height: Math.min(box.height, 900) } });
        console.log('Saved hero_living_network.png');
      }
      await sectionHandle.dispose();
    }

    // 3. Live Exchange feed section (find element containing "Live Exchange")
    // find bounding box for an element that contains the given text
    const feedRect = await page.evaluate((text) => {
      const el = Array.from(document.querySelectorAll('*')).find(n => n.textContent && n.textContent.trim().includes(text));
      if (!el) return null;
      const panel = el.closest('div');
      if (!panel) return null;
      const r = panel.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, 'Live Exchange');
    if (feedRect && feedRect.width && feedRect.height) {
      const height = Math.min(600, feedRect.height + 260);
      await page.screenshot({ path: path.join(outDir, 'live_exchange_feed.png'), clip: { x: Math.max(0, feedRect.x), y: Math.max(0, feedRect.y), width: feedRect.width, height } });
      console.log('Saved live_exchange_feed.png');
    }

    // 4. AgentPassport / constitutional section (find "Trust Score")
    const trustRect = await page.evaluate((text) => {
      const el = Array.from(document.querySelectorAll('*')).find(n => n.textContent && n.textContent.trim().includes(text));
      if (!el) return null;
      const card = el.closest('section') || el.closest('div');
      if (!card) return null;
      const r = card.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, 'Trust Score');
    if (trustRect && trustRect.width && trustRect.height) {
      const height = Math.min(800, trustRect.height + 300);
      await page.screenshot({ path: path.join(outDir, 'passport_constitutional.png'), clip: { x: Math.max(0, trustRect.x), y: Math.max(0, trustRect.y), width: trustRect.width, height } });
      console.log('Saved passport_constitutional.png');
    }

    // 5. Mobile homepage
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.goto(`${base}/`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 600));
    await page.screenshot({ path: path.join(outDir, 'mobile_home.png'), fullPage: true });
    console.log('Saved mobile_home.png');

    // 6. Desktop-only captures for specific pages: /network, /registry, /build
    await page.setViewport({ width: 1440, height: 900 });
    const targets = ['network', 'registry', 'build'];
    for (const t of targets) {
      try {
        await page.goto(`${base}/${t}`, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise((r) => setTimeout(r, 600));
        const filename = `${t}_desktop.png`;
        await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
        console.log(`Saved ${filename}`);
      } catch (err) {
        console.error(`Failed to capture /${t}:`, err.message || err);
      }
    }

    await browser.close();
    console.log('All requested screenshots captured.');
    process.exit(0);
  } catch (err) {
    console.error('capture_more_views failed:', err);
    process.exit(2);
  }
})();
