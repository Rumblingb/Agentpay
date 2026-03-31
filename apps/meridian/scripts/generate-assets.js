/**
 * generate-assets.js
 *
 * Generates Ace app icons + splash screen as SVG files
 * that Expo can use directly, or converts to PNG via sharp if available.
 *
 * Run: node scripts/generate-assets.js
 *
 * Output:
 *   assets/icon.png          (1024x1024)
 *   assets/splash.png        (1242x2688)
 *   assets/adaptive-icon.png (1024x1024 foreground)
 */

const fs   = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// ── SVG templates ─────────────────────────────────────────────────────────────

function iconSvg(size = 1024) {
  const center = size / 2;
  const bgRadius = size * 0.24;
  const ringW = size * 0.54;
  const ringH = size * 0.64;
  const markW = size * 0.19;
  const markH = size * 0.24;
  const markX = center - markW / 2;
  const markY = center - markH / 2 + size * 0.01;
  const cutW = size * 0.075;
  const cutH = size * 0.10;
  const cutX = center - cutW * 0.24;
  const cutY = center + size * 0.005;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <radialGradient id="bg" cx="48%" cy="28%" r="84%">
      <stop offset="0%" stop-color="#73839a"/>
      <stop offset="35%" stop-color="#4b5665"/>
      <stop offset="100%" stop-color="#2c333d"/>
    </radialGradient>
    <radialGradient id="haloGlow" cx="50%" cy="42%" r="62%">
      <stop offset="0%" stop-color="#eff8ff" stop-opacity="0.96"/>
      <stop offset="28%" stop-color="#d5eaff" stop-opacity="0.56"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="markFill" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#d4e6ff"/>
    </linearGradient>
    <linearGradient id="innerDrop" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#536374"/>
      <stop offset="100%" stop-color="#26313f"/>
    </linearGradient>
    <filter id="blurGlow">
      <feGaussianBlur stdDeviation="${size * 0.028}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="markShadow">
      <feDropShadow dx="0" dy="${size * 0.008}" stdDeviation="${size * 0.014}" flood-color="#f3fbff" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)" rx="${bgRadius}"/>
  <ellipse cx="${center}" cy="${center}" rx="${ringW / 2}" ry="${ringH / 2}" fill="rgba(255,255,255,0.035)" stroke="rgba(226,242,255,0.9)" stroke-width="${size * 0.006}" filter="url(#blurGlow)"/>
  <g filter="url(#markShadow)" transform="rotate(12 ${center} ${center})">
    <path d="M ${markX + markW * 0.2} ${markY + markH} Q ${markX + markW * 0.16} ${markY + markH * 0.62} ${markX + markW * 0.06} ${markY + markH * 0.22} Q ${markX + markW * 0.03} ${markY + markH * 0.08} ${markX + markW * 0.15} ${markY + markH * 0.05} Q ${markX + markW * 0.52} ${markY - markH * 0.08} ${markX + markW * 0.94} ${markY + markH * 0.1} Q ${markX + markW * 0.84} ${markY + markH * 0.5} ${markX + markW * 0.58} ${markY + markH * 0.98} Q ${markX + markW * 0.37} ${markY + markH * 1.02} ${markX + markW * 0.2} ${markY + markH} Z" fill="url(#markFill)"/>
    <path d="M ${cutX} ${cutY + cutH} Q ${cutX - cutW * 0.15} ${cutY + cutH * 0.62} ${cutX - cutW * 0.04} ${cutY + cutH * 0.18} Q ${cutX + cutW * 0.08} ${cutY} ${cutX + cutW * 0.34} ${cutY + cutH * 0.08} Q ${cutX + cutW * 0.16} ${cutY + cutH * 0.54} ${cutX} ${cutY + cutH} Z" fill="url(#innerDrop)" stroke="rgba(255,255,255,0.08)" stroke-width="${size * 0.003}"/>
  </g>
</svg>`;
}

function splashSvg(w = 1242, h = 2688) {
  const cx = w / 2;
  const cy = h / 2;
  const ringW = w * 0.31;
  const ringH = w * 0.37;
  const markW = w * 0.105;
  const markH = w * 0.135;
  const markX = cx - markW / 2;
  const markY = cy - h * 0.09;
  const cutW = w * 0.04;
  const cutH = w * 0.055;
  const cutX = cx - cutW * 0.24;
  const cutY = cy - h * 0.04;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="bg" cx="48%" cy="28%" r="82%">
      <stop offset="0%" stop-color="#728198"/>
      <stop offset="38%" stop-color="#495462"/>
      <stop offset="100%" stop-color="#242b33"/>
    </radialGradient>
    <radialGradient id="haloGlow" cx="50%" cy="42%" r="60%">
      <stop offset="0%" stop-color="#eef8ff" stop-opacity="0.96"/>
      <stop offset="28%" stop-color="#d7eaff" stop-opacity="0.54"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="markFill" x1="10%" y1="0%" x2="90%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#d4e6ff"/>
    </linearGradient>
    <linearGradient id="innerDrop" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#536374"/>
      <stop offset="100%" stop-color="#26313f"/>
    </linearGradient>
    <filter id="blurGlow">
      <feGaussianBlur stdDeviation="${w * 0.022}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="markShadow">
      <feDropShadow dx="0" dy="${w * 0.007}" stdDeviation="${w * 0.012}" flood-color="#f2fbff" flood-opacity="0.24"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <ellipse cx="${cx}" cy="${cy - h * 0.07}" rx="${ringW / 2}" ry="${ringH / 2}" fill="rgba(255,255,255,0.035)" stroke="rgba(226,240,255,0.9)" stroke-width="${w * 0.0048}" filter="url(#blurGlow)"/>
  <g filter="url(#markShadow)" transform="rotate(12 ${cx} ${cy - h * 0.07})">
    <path d="M ${markX + markW * 0.2} ${markY + markH} Q ${markX + markW * 0.16} ${markY + markH * 0.62} ${markX + markW * 0.06} ${markY + markH * 0.22} Q ${markX + markW * 0.03} ${markY + markH * 0.08} ${markX + markW * 0.15} ${markY + markH * 0.05} Q ${markX + markW * 0.52} ${markY - markH * 0.08} ${markX + markW * 0.94} ${markY + markH * 0.1} Q ${markX + markW * 0.84} ${markY + markH * 0.5} ${markX + markW * 0.58} ${markY + markH * 0.98} Q ${markX + markW * 0.37} ${markY + markH * 1.02} ${markX + markW * 0.2} ${markY + markH} Z" fill="url(#markFill)"/>
    <path d="M ${cutX} ${cutY + cutH} Q ${cutX - cutW * 0.15} ${cutY + cutH * 0.62} ${cutX - cutW * 0.04} ${cutY + cutH * 0.18} Q ${cutX + cutW * 0.08} ${cutY} ${cutX + cutW * 0.34} ${cutY + cutH * 0.08} Q ${cutX + cutW * 0.16} ${cutY + cutH * 0.54} ${cutX} ${cutY + cutH} Z" fill="url(#innerDrop)" stroke="rgba(255,255,255,0.08)" stroke-width="${w * 0.0024}"/>
  </g>
  <text x="${cx}" y="${cy + h*0.126}" font-family="system-ui, -apple-system, sans-serif" font-size="${w*0.105}" font-weight="700" fill="white" text-anchor="middle" letter-spacing="8">ACE</text>
  <text x="${cx}" y="${cy + h*0.156}" font-family="system-ui, -apple-system, sans-serif" font-size="${w*0.025}" fill="#b7c2ce" text-anchor="middle" letter-spacing="2">Travel, handled.</text>
</svg>`;
}

(async () => {
  // Write SVGs (Expo won't use SVG directly but they can be converted)
  fs.writeFileSync(path.join(outDir, 'icon.svg'), iconSvg(1024));
  fs.writeFileSync(path.join(outDir, 'splash.svg'), splashSvg(1242, 2688));
  fs.writeFileSync(path.join(outDir, 'adaptive-icon.svg'), iconSvg(1024));

  console.log('SVGs written to assets/');

  try {
    const sharp = require('sharp');
    await Promise.all([
      sharp(Buffer.from(iconSvg(1024))).png().toFile(path.join(outDir, 'icon.png')),
      sharp(Buffer.from(splashSvg(1242, 2688))).png().toFile(path.join(outDir, 'splash.png')),
      sharp(Buffer.from(iconSvg(1024))).png().toFile(path.join(outDir, 'adaptive-icon.png')),
    ]);
    console.log('PNG assets generated with sharp.');
  } catch (err) {
    console.log('sharp not available; SVGs were generated but PNGs were not.');
    console.log('Install sharp or convert the SVGs manually before shipping.');
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
