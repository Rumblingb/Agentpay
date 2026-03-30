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
  const glowR = size * 0.34;
  const sigilW = size * 0.34;
  const sigilH = size * 0.39;
  const sigilX = center - sigilW / 2;
  const sigilY = center - sigilH / 2;
  const coreR = size * 0.068;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="40%" r="70%">
      <stop offset="0%" stop-color="#102033"/>
      <stop offset="45%" stop-color="#08111d"/>
      <stop offset="100%" stop-color="#04070b"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#67e8f9" stop-opacity="0.95"/>
      <stop offset="35%" stop-color="#38bdf8" stop-opacity="0.48"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sigilBody" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1725"/>
      <stop offset="100%" stop-color="#050912"/>
    </linearGradient>
    <linearGradient id="crest" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#d9f7ff"/>
      <stop offset="100%" stop-color="#7dd3fc"/>
    </linearGradient>
    <filter id="blurGlow">
      <feGaussianBlur stdDeviation="${size * 0.035}" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="softShadow">
      <feDropShadow dx="0" dy="${size * 0.01}" stdDeviation="${size * 0.018}" flood-color="#38bdf8" flood-opacity="0.24"/>
    </filter>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)" rx="${bgRadius}"/>
  <circle cx="${center}" cy="${center}" r="${glowR}" fill="url(#halo)" filter="url(#blurGlow)"/>
  <circle cx="${center}" cy="${center}" r="${size * 0.22}" fill="#0a1320" opacity="0.78"/>
  <g filter="url(#softShadow)">
    <rect x="${sigilX}" y="${sigilY}" width="${sigilW}" height="${sigilH}" rx="${size * 0.08}" fill="url(#sigilBody)" stroke="rgba(125,211,252,0.34)" stroke-width="${size * 0.0036}"/>
    <ellipse cx="${center}" cy="${sigilY + size * 0.055}" rx="${size * 0.06}" ry="${size * 0.012}" fill="#dff8ff" opacity="0.18"/>
    <rect x="${center - size * 0.094}" y="${sigilY + size * 0.075}" width="${size * 0.012}" height="${size * 0.15}" rx="${size * 0.006}" fill="#65d8ff" opacity="0.34"/>
    <rect x="${center + size * 0.082}" y="${sigilY + size * 0.075}" width="${size * 0.012}" height="${size * 0.15}" rx="${size * 0.006}" fill="#65d8ff" opacity="0.34"/>
    <circle cx="${center}" cy="${center}" r="${coreR * 1.7}" fill="#67e8f9" opacity="0.10" stroke="#7dd3fc" stroke-opacity="0.28" stroke-width="${size * 0.0036}"/>
    <circle cx="${center}" cy="${center}" r="${coreR}" fill="#08111d" stroke="#d8f6ff" stroke-opacity="0.72" stroke-width="${size * 0.0042}"/>
    <path d="M ${center - size * 0.028} ${center + size * 0.038} L ${center} ${center - size * 0.048} L ${center + size * 0.028} ${center + size * 0.038}" fill="none" stroke="url(#crest)" stroke-width="${size * 0.012}" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="${center - size * 0.017}" y1="${center + size * 0.002}" x2="${center + size * 0.017}" y2="${center + size * 0.002}" stroke="url(#crest)" stroke-width="${size * 0.009}" stroke-linecap="round"/>
    <path d="M ${center - size * 0.065} ${sigilY + sigilH - size * 0.07} L ${center - size * 0.014} ${sigilY + sigilH - size * 0.048} L ${center} ${sigilY + sigilH - size * 0.024} L ${center + size * 0.014} ${sigilY + sigilH - size * 0.048} L ${center + size * 0.065} ${sigilY + sigilH - size * 0.07}" fill="none" stroke="#7dd3fc" stroke-opacity="0.48" stroke-width="${size * 0.006}" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="${center - size * 0.04}" y="${sigilY + sigilH + size * 0.02}" width="${size * 0.08}" height="${size * 0.018}" rx="${size * 0.009}" fill="#89dfff" opacity="0.20"/>
  </g>
</svg>`;
}

function splashSvg(w = 1242, h = 2688) {
  const cx = w / 2;
  const cy = h / 2;
  const sigilW = w * 0.22;
  const sigilH = w * 0.255;
  const sigilX = cx - sigilW / 2;
  const sigilY = cy - h * 0.1;
  const coreR = w * 0.043;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="42%" r="72%">
      <stop offset="0%" stop-color="#0c1828"/>
      <stop offset="45%" stop-color="#07111f"/>
      <stop offset="100%" stop-color="#05070b"/>
    </radialGradient>
    <radialGradient id="halo" cx="50%" cy="36%" r="58%">
      <stop offset="0%" stop-color="#67e8f9" stop-opacity="0.92"/>
      <stop offset="34%" stop-color="#38bdf8" stop-opacity="0.40"/>
      <stop offset="100%" stop-color="#0f172a" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="sigilBody" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1725"/>
      <stop offset="100%" stop-color="#050912"/>
    </linearGradient>
    <linearGradient id="crest" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#d9f7ff"/>
      <stop offset="100%" stop-color="#7dd3fc"/>
    </linearGradient>
    <filter id="blurGlow">
      <feGaussianBlur stdDeviation="${w * 0.032}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="softShadow">
      <feDropShadow dx="0" dy="${w * 0.01}" stdDeviation="${w * 0.018}" flood-color="#38bdf8" flood-opacity="0.20"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${cx}" cy="${cy - h * 0.07}" r="${w * 0.29}" fill="url(#halo)" filter="url(#blurGlow)"/>
  <circle cx="${cx}" cy="${cy - h * 0.07}" r="${w * 0.13}" fill="#0a1320" opacity="0.78"/>
  <g filter="url(#softShadow)">
    <rect x="${sigilX}" y="${sigilY}" width="${sigilW}" height="${sigilH}" rx="${w * 0.052}" fill="url(#sigilBody)" stroke="rgba(125,211,252,0.34)" stroke-width="${w * 0.003}"/>
    <ellipse cx="${cx}" cy="${sigilY + w * 0.036}" rx="${w * 0.04}" ry="${w * 0.008}" fill="#dff8ff" opacity="0.18"/>
    <rect x="${cx - w * 0.062}" y="${sigilY + w * 0.048}" width="${w * 0.008}" height="${w * 0.095}" rx="${w * 0.004}" fill="#65d8ff" opacity="0.34"/>
    <rect x="${cx + w * 0.054}" y="${sigilY + w * 0.048}" width="${w * 0.008}" height="${w * 0.095}" rx="${w * 0.004}" fill="#65d8ff" opacity="0.34"/>
    <circle cx="${cx}" cy="${sigilY + sigilH * 0.5}" r="${coreR * 1.75}" fill="#67e8f9" opacity="0.10" stroke="#7dd3fc" stroke-opacity="0.28" stroke-width="${w * 0.003}"/>
    <circle cx="${cx}" cy="${sigilY + sigilH * 0.5}" r="${coreR}" fill="#08111d" stroke="#d8f6ff" stroke-opacity="0.72" stroke-width="${w * 0.0034}"/>
    <path d="M ${cx - w * 0.019} ${sigilY + sigilH * 0.5 + w * 0.025} L ${cx} ${sigilY + sigilH * 0.5 - w * 0.031} L ${cx + w * 0.019} ${sigilY + sigilH * 0.5 + w * 0.025}" fill="none" stroke="url(#crest)" stroke-width="${w * 0.0085}" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="${cx - w * 0.0115}" y1="${sigilY + sigilH * 0.5 + w * 0.001}" x2="${cx + w * 0.0115}" y2="${sigilY + sigilH * 0.5 + w * 0.001}" stroke="url(#crest)" stroke-width="${w * 0.0064}" stroke-linecap="round"/>
    <path d="M ${cx - w * 0.044} ${sigilY + sigilH - w * 0.046} L ${cx - w * 0.01} ${sigilY + sigilH - w * 0.032} L ${cx} ${sigilY + sigilH - w * 0.015} L ${cx + w * 0.01} ${sigilY + sigilH - w * 0.032} L ${cx + w * 0.044} ${sigilY + sigilH - w * 0.046}" fill="none" stroke="#7dd3fc" stroke-opacity="0.48" stroke-width="${w * 0.0043}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="${cx}" y="${cy + h*0.126}" font-family="system-ui, -apple-system, sans-serif" font-size="${w*0.105}" font-weight="700" fill="white" text-anchor="middle" letter-spacing="8">ACE</text>
  <text x="${cx}" y="${cy + h*0.156}" font-family="system-ui, -apple-system, sans-serif" font-size="${w*0.025}" fill="#95a4b7" text-anchor="middle" letter-spacing="2">Travel, handled with judgment.</text>
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
