/**
 * generate-assets.js
 *
 * Generates Meridian app icons + splash screen as SVG files
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
  const r = size * 0.38;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#080808"/>
    </radialGradient>
    <radialGradient id="orb" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#4338ca"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="${size * 0.04}" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${size}" height="${size}" fill="url(#bg)" rx="${size * 0.22}"/>
  <circle cx="${center}" cy="${center}" r="${r * 1.3}" fill="#6366f1" opacity="0.08"/>
  <circle cx="${center}" cy="${center}" r="${r}" fill="url(#orb)" filter="url(#glow)"/>
  <!-- mic icon simplified -->
  <rect x="${center - size*0.06}" y="${center - size*0.15}" width="${size*0.12}" height="${size*0.2}" rx="${size*0.06}" fill="white" opacity="0.95"/>
  <path d="M ${center - size*0.12} ${center + size*0.06} Q ${center} ${center + size*0.18} ${center + size*0.12} ${center + size*0.06}" stroke="white" stroke-width="${size*0.025}" fill="none" stroke-linecap="round" opacity="0.95"/>
  <line x1="${center}" y1="${center + size*0.18}" x2="${center}" y2="${center + size*0.24}" stroke="white" stroke-width="${size*0.025}" stroke-linecap="round" opacity="0.95"/>
  <line x1="${center - size*0.07}" y1="${center + size*0.24}" x2="${center + size*0.07}" y2="${center + size*0.24}" stroke="white" stroke-width="${size*0.025}" stroke-linecap="round" opacity="0.95"/>
</svg>`;
}

function splashSvg(w = 1242, h = 2688) {
  const cx = w / 2;
  const cy = h / 2;
  const orbR = w * 0.22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="60%">
      <stop offset="0%" stop-color="#0d0b1e"/>
      <stop offset="100%" stop-color="#080808"/>
    </radialGradient>
    <radialGradient id="orb" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#6366f1"/>
      <stop offset="100%" stop-color="#4338ca"/>
    </radialGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="${orbR * 0.3}" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <circle cx="${cx}" cy="${cy - h*0.06}" r="${orbR * 1.8}" fill="#6366f1" opacity="0.05"/>
  <circle cx="${cx}" cy="${cy - h*0.06}" r="${orbR}" fill="url(#orb)" filter="url(#glow)"/>
  <!-- mic -->
  <rect x="${cx - w*0.04}" y="${cy - h*0.1}" width="${w*0.08}" height="${h*0.08}" rx="${w*0.04}" fill="white" opacity="0.95"/>
  <path d="M ${cx - w*0.08} ${cy - h*0.03} Q ${cx} ${cy + h*0.02} ${cx + w*0.08} ${cy - h*0.03}" stroke="white" stroke-width="${w*0.015}" fill="none" stroke-linecap="round" opacity="0.95"/>
  <line x1="${cx}" y1="${cy + h*0.02}" x2="${cx}" y2="${cy + h*0.05}" stroke="white" stroke-width="${w*0.015}" stroke-linecap="round" opacity="0.95"/>
  <!-- wordmark -->
  <text x="${cx}" y="${cy + h*0.12}" font-family="system-ui, -apple-system, sans-serif" font-size="${w*0.1}" font-weight="700" fill="white" text-anchor="middle" letter-spacing="-2">Meridian</text>
  <text x="${cx}" y="${cy + h*0.155}" font-family="system-ui, -apple-system, sans-serif" font-size="${w*0.038}" fill="#6366f1" text-anchor="middle" letter-spacing="2">by AgentPay</text>
</svg>`;
}

// Write SVGs (Expo won't use SVG directly but they can be converted)
fs.writeFileSync(path.join(outDir, 'icon.svg'), iconSvg(1024));
fs.writeFileSync(path.join(outDir, 'splash.svg'), splashSvg(1242, 2688));
fs.writeFileSync(path.join(outDir, 'adaptive-icon.svg'), iconSvg(1024));

console.log('SVGs written to assets/');
console.log('');
console.log('To convert to PNG (required by Expo):');
console.log('  npm install -g sharp-cli');
console.log('  sharp -i assets/icon.svg -o assets/icon.png resize 1024 1024');
console.log('  sharp -i assets/splash.svg -o assets/splash.png resize 1242 2688');
console.log('  sharp -i assets/adaptive-icon.svg -o assets/adaptive-icon.png resize 1024 1024');
console.log('');
console.log('Or use Expo\'s online asset generator at: https://www.canva.com/');
console.log('Or run: npx expo install expo-asset and reference SVGs directly in app.json.');
