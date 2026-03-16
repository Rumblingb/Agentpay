const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const outDir = path.resolve(__dirname, '..', 'screenshots');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Prefer an explicit Chrome/Chromium executable to avoid large browser downloads.
    const chromePaths = [
      process.env.CHROME_PATH,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
    ].filter(Boolean);

    let launchOptions = { args: ['--no-sandbox', '--disable-setuid-sandbox'] };
    if (chromePaths.length > 0) {
      launchOptions.executablePath = chromePaths[0];
    }

    const browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const pages = [
      { url: 'http://localhost:3000/', file: 'home.png' },
      { url: 'http://localhost:3000/network', file: 'network.png' }
    ];

    for (const p of pages) {
      console.log('Loading', p.url);
      await page.goto(p.url, { waitUntil: 'networkidle2', timeout: 30000 });
      await new Promise((res) => setTimeout(res, 800)); // allow subtle animations to settle
      const outPath = path.join(outDir, p.file);
      await page.screenshot({ path: outPath, fullPage: true });
      console.log('Saved', outPath);
    }

    await browser.close();
    console.log('All screenshots captured.');
    process.exit(0);
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    process.exit(2);
  }
})();
