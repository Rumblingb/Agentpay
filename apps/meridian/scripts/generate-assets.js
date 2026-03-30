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
  const ringW = size * 0.56;
  const ringH = size * 0.44;
  const strokeW = size * 0.082;
  const leftH = size * 0.30;
  const rightH = size * 0.36;
  const leftX = center - size * 0.116;
  const rightX = center + size * 0.033;
  const strokeY = center - size * 0.17;
  const innerDropX = center - size * 0.03;
  const innerDropY = center - size * 0.012;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="76%">
      <stop offset="0%" stop-color="#5c6776"/>
      <stop offset="38%" stop-color="#39414d"/>
      <stop offset="100%" stop-color="#1f252e"/>
    </radialGradient>
    <radialGradient id="haloGlow" cx="50%" cy="40%" r="55%">
      <stop offset="0%" stop-color="#e9f7ff" stop-opacity="0.95"/>
      <stop offset="32%" stop-color="#cce6ff" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="markFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#cfe3ff"/>
    </linearGradient>
    <linearGradient id="innerDrop" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#415264"/>
      <stop offset="100%" stop-color="#24303d"/>
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
  <ellipse cx="${center}" cy="${center}" rx="${ringW / 2}" ry="${ringH / 2}" fill="rgba(255,255,255,0.03)" stroke="rgba(221,240,255,0.86)" stroke-width="${size * 0.006}" filter="url(#blurGlow)"/>
  <g filter="url(#markShadow)">
    <rect x="${leftX}" y="${strokeY}" width="${strokeW}" height="${leftH}" rx="${strokeW / 2}" fill="url(#markFill)" transform="rotate(28 ${leftX + strokeW / 2} ${strokeY + leftH / 2})"/>
    <rect x="${rightX}" y="${strokeY - size * 0.014}" width="${strokeW}" height="${rightH}" rx="${strokeW / 2}" fill="url(#markFill)" transform="rotate(-26 ${rightX + strokeW / 2} ${strokeY + rightH / 2})"/>
    <rect x="${innerDropX}" y="${innerDropY}" width="${size * 0.088}" height="${size * 0.145}" rx="${size * 0.044}" fill="url(#innerDrop)" stroke="rgba(255,255,255,0.08)" stroke-width="${size * 0.003}" transform="rotate(16 ${innerDropX + size * 0.044} ${innerDropY + size * 0.0725})"/>
  </g>
</svg>`;
}

function splashSvg(w = 1242, h = 2688) {
  const cx = w / 2;
  const cy = h / 2;
  const ringW = w * 0.32;
  const ringH = w * 0.25;
  const strokeW = w * 0.046;
  const leftH = w * 0.17;
  const rightH = w * 0.205;
  const leftX = cx - w * 0.066;
  const rightX = cx + w * 0.02;
  const strokeY = cy - h * 0.102;
  const innerDropX = cx - w * 0.024;
  const innerDropY = cy - h * 0.025;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="38%" r="78%">
      <stop offset="0%" stop-color="#53606d"/>
      <stop offset="40%" stop-color="#323945"/>
      <stop offset="100%" stop-color="#1b2027"/>
    </radialGradient>
    <radialGradient id="haloGlow" cx="50%" cy="39%" r="58%">
      <stop offset="0%" stop-color="#eef8ff" stop-opacity="0.95"/>
      <stop offset="30%" stop-color="#d8ebff" stop-opacity="0.52"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="markFill" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#cfe3ff"/>
    </linearGradient>
    <linearGradient id="innerDrop" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#415264"/>
      <stop offset="100%" stop-color="#24303d"/>
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
  <ellipse cx="${cx}" cy="${cy - h * 0.07}" rx="${ringW / 2}" ry="${ringH / 2}" fill="rgba(255,255,255,0.03)" stroke="rgba(226,240,255,0.88)" stroke-width="${w * 0.0048}" filter="url(#blurGlow)"/>
  <g filter="url(#markShadow)">
    <rect x="${leftX}" y="${strokeY}" width="${strokeW}" height="${leftH}" rx="${strokeW / 2}" fill="url(#markFill)" transform="rotate(28 ${leftX + strokeW / 2} ${strokeY + leftH / 2})"/>
    <rect x="${rightX}" y="${strokeY - w * 0.008}" width="${strokeW}" height="${rightH}" rx="${strokeW / 2}" fill="url(#markFill)" transform="rotate(-26 ${rightX + strokeW / 2} ${strokeY + rightH / 2})"/>
    <rect x="${innerDropX}" y="${innerDropY}" width="${w * 0.05}" height="${w * 0.082}" rx="${w * 0.025}" fill="url(#innerDrop)" stroke="rgba(255,255,255,0.08)" stroke-width="${w * 0.0024}" transform="rotate(16 ${innerDropX + w * 0.025} ${innerDropY + w * 0.041})"/>
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
