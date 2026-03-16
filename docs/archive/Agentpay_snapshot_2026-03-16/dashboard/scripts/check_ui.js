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
  const pages = ['/', '/network', '/registry', '/build'];
  for (const p of pages) {
    const url = base + p;
    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const result = await page.evaluate(()=>{
        function visible(el){
          if (!el) return false;
          const style = window.getComputedStyle(el);
          if (style && (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity)===0)) return false;
          const rect = el.getBoundingClientRect();
          return rect.width>0 && rect.height>0;
        }

        function topmost(els){
          // filter out elements that are descendants of another matched element
          return els.filter((el)=>{
            let p = el.parentElement;
            while(p){
              if (els.includes(p)) return false;
              p = p.parentElement;
            }
            return true;
          });
        }

        const openAll = Array.from(document.querySelectorAll('a,button,input,span,div')).filter(n=>n.textContent && n.textContent.trim()==='Open App' && visible(n));
        const previewAll = Array.from(document.querySelectorAll('*')).filter(n=>n.textContent && n.textContent.trim().includes('Preview Network') && visible(n));
        const foundingAll = Array.from(document.querySelectorAll('*')).filter(n=>n.textContent && n.textContent.trim().includes('Founding Era') && visible(n));
        const marqueeEls = Array.from(document.querySelectorAll('*')).filter(n=>n.className && String(n.className).includes('marquee'));

        const openEls = topmost(openAll);
        const previewEls = topmost(previewAll);
        const foundingEls = topmost(foundingAll);

        return {open: openEls.length, preview: previewEls.length, founding: foundingEls.length, marquee: marqueeEls.length};
      });
      console.log(url+' ->', result);
    } catch (err){
      console.error(url+' -> ERROR', err.message);
    }
  }
  await browser.close();
})();
