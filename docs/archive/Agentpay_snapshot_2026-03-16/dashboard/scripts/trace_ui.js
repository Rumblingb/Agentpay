const puppeteer = require('puppeteer-core');
const chromePaths = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

(async ()=>{
  const launchOptions = { args: ['--no-sandbox','--disable-setuid-sandbox'] };
  if (chromePaths.length) launchOptions.executablePath = chromePaths[0];
  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();
  const base = process.env.DASHBOARD_CAPTURE_BASE || 'http://localhost:3006';
  const path = process.argv[2] || '/network';
  const url = base + path;
  console.log('Tracing', url);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  const result = await page.evaluate(()=>{
    function visible(el){
      if (!el) return false;
      const style = window.getComputedStyle(el);
      if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity)===0)) return false;
      const rect = el.getBoundingClientRect();
      return rect.width>0 && rect.height>0;
    }
    const matches = [];
    const all = Array.from(document.querySelectorAll('*'));
    for (const n of all) {
      const text = (n.textContent||'').trim();
      if (!text) continue;
      if (visible(n) && (text.includes('Founding Era') || text.includes('Preview Network'))) {
        matches.push({ tag: n.tagName, text: text.slice(0,200), html: n.outerHTML.slice(0,500) });
      }
    }
    return matches;
  });
  console.log('Matches found:', result.length);
  for (const m of result) {
    console.log('---');
    console.log(m.tag, m.text);
    console.log(m.html);
  }
  await browser.close();
})();