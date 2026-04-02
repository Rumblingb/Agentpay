/**
 * Rebuilds the iOS icon from the Ace mark master without distorting it into a square.
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
  const metadata = await sharp(masterMarkPath).metadata();
  const side = Math.max(metadata.width ?? 1024, metadata.height ?? 1024);

  const background = await sharp(masterMarkPath)
    .resize(side, side, {
      fit: 'cover',
      position: 'centre',
    })
    .blur(28)
    .toBuffer();

  const foreground = await sharp(masterMarkPath)
    .resize(Math.round(side * 0.93), Math.round(side * 0.93), {
      fit: 'contain',
      position: 'centre',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .toBuffer();

  await sharp(background)
    .composite([
      {
        input: foreground,
        gravity: 'centre',
      },
    ])
    .resize(1024, 1024)
    .png()
    .toFile(iosIconPath);
}

async function main() {
  console.log('Rebuilding Ace iOS icon from ace-mark.png...');
  await buildIosIcon();
  console.log('✓ icon.png (1024×1024)');
  console.log('Adaptive icon and splash remain source-controlled separately.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
