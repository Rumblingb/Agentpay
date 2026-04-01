/**
 * Converts icon.svg to icon.png, adaptive-icon.png, and ace-mark.png
 * Run: node convert-icon.js
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Install sharp if not present
try {
  require.resolve('sharp');
} catch {
  console.log('Installing sharp...');
  execSync('npm install sharp --save-dev', { stdio: 'inherit', cwd: path.join(__dirname, '../../..') });
}

const sharp = require('sharp');
const svgBuffer = fs.readFileSync(path.join(__dirname, 'icon.svg'));

async function convert() {
  console.log('Converting icon.svg...');

  await sharp(svgBuffer).resize(1024, 1024).png().toFile(path.join(__dirname, 'icon.png'));
  console.log('✓ icon.png (1024×1024)');

  await sharp(svgBuffer).resize(432, 432).png().toFile(path.join(__dirname, 'adaptive-icon.png'));
  console.log('✓ adaptive-icon.png (432×432)');

  await sharp(svgBuffer).resize(300, 360).png().toFile(path.join(__dirname, 'ace-mark.png'));
  console.log('✓ ace-mark.png (300×360)');

  console.log('\nDone. Commit and push to sync to Mac.');
}

convert().catch(console.error);
