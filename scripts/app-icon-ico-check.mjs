#!/usr/bin/env node
// Compares the .ico Acira made for a Windows shortcut (<data folder>/app-icon/appicon-v<N>.ico) with the picture the team supplied (the Windows 256 x 256 PNG): the biggest picture inside must be that file, byte for byte, and every
// smaller one must be a sound PNG of its own size. For the Windows laptop's check 9 (docs/launch/APP_ICON.md). Reads two files, writes nothing.
//   node scripts/app-icon-ico-check.mjs <appicon-vN.ico> <windows-256.png>
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { icoPictures } = require('../desktop/browser-services/icon-image.cjs'), icon = require('../desktop/browser-services/app-icon.cjs');
const [icoFile, pngFile] = process.argv.slice(2);
if (!icoFile || !pngFile) { console.error('Usage: node scripts/app-icon-ico-check.mjs <appicon-vN.ico> <windows-256.png>'); process.exit(2); }
const ico = fs.readFileSync(icoFile), supplied = fs.readFileSync(pngFile), problems = [];
const pictures = icoPictures(ico);
if (!pictures) problems.push('the .ico has no readable pictures');
else {
  const sizes = pictures.map((p) => p.width).sort((a, b) => a - b);
  if (JSON.stringify(sizes) !== JSON.stringify(icon.ICO_SIZES)) problems.push('the sizes inside are ' + sizes.join(', ') + ', expected ' + icon.ICO_SIZES.join(', '));
  for (const p of pictures) {
    const bytes = ico.subarray(p.offset, p.offset + p.size), verdict = icon.checkPng(bytes, { width: p.width, height: p.height });
    if (!verdict.ok) problems.push(`the ${p.width} px picture is not a sound ${p.width} x ${p.height} PNG (${verdict.reason})`);
  }
  const biggest = pictures.find((p) => p.width === 256);
  if (!biggest) problems.push('there is no 256 px picture');
  else if (!ico.subarray(biggest.offset, biggest.offset + biggest.size).equals(supplied)) problems.push('the 256 px picture is NOT the supplied file (' + icon.sha512Of(supplied).slice(0, 12) + ' expected)');
}
if (problems.length) { console.error('FAIL ' + icoFile); for (const problem of problems) console.error('  x ' + problem); process.exit(1); }
console.log('PASS ' + icoFile + ': 16, 24, 32, 48, 64, 128 are sound PNGs and the 256 picture is the supplied file, byte for byte.');
