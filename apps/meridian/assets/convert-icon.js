/**
 * Rebuilds the iOS icon from the transparent Ace mark master.
 * Run: node convert-icon.js
 */
const path = require('path');
const { execSync } = require('child_process');

try {
  require.resolve('sharp');
} catch {
  console.log('Installing sharp...');
  execSync('npm install sharp --save-dev', {
    stdio: 'inherit',
    cwd: path.join(__dirname, '../../..'),
  });
}

const sharp = require('sharp');

const masterMarkPath = path.join(__dirname, 'ace-mark.png');
const iosIconPath = path.join(__dirname, 'icon.png');

async function buildIosIcon() {
  const side = 1024;

  const background = {
    create: {
      width: side,
      height: side,
      channels: 4,
      background: { r: 12, g: 18, b: 28, alpha: 1 },
    },
  };

  const glow = await sharp({
    create: {
      width: side,
      height: side,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="${side}" height="${side}" viewBox="0 0 ${side} ${side}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="g" cx="50%" cy="44%" r="40%">
                <stop offset="0%" stop-color="#e9f5ff" stop-opacity="0.32"/>
                <stop offset="40%" stop-color="#9ab9d7" stop-opacity="0.12"/>
                <stop offset="100%" stop-color="#0c121c" stop-opacity="0"/>
              </radialGradient>
            </defs>
            <rect width="${side}" height="${side}" fill="url(#g)"/>
          </svg>`
        ),
      },
    ])
    .blur(10)
    .png()
    .toBuffer();

  const foreground = await sharp(masterMarkPath)
    .resize(Math.round(side * 0.76), Math.round(side * 0.76), {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  await sharp(background)
    .composite([
      { input: glow },
      {
        input: foreground,
        gravity: 'centre',
      },
    ])
    .png()
    .toFile(iosIconPath);
}

async function main() {
  console.log('Rebuilding Ace iOS icon from transparent ace-mark.png...');
  await buildIosIcon();
  console.log('icon.png (1024x1024) rebuilt');
  console.log('Adaptive icon and splash remain source-controlled separately.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
