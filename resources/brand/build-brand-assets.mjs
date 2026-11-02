// Builds Acira's brand assets from the founder-supplied canonical lockup (public/brand/acira-lockup-2026.svg, 365×108:
// gradient symbol on the left, "Acira" wordmark in #050A30). Its two paths, gradient, layout and spacing are used
// unchanged; only the colours change by context (brand rule: gradient symbol + dark wordmark on light surfaces; the
// whole logo white on dark and on coloured finishes; never all black).
//   acira-logo.svg / acira-logo-light.svg  the lockup exactly as supplied / all white.
//   acira-symbol.svg (+ -white)            the symbol alone (the second path), square-framed tightly: sidebar mark,
//                                          brand slots, the app icon source.
//   acira-icon.svg (+ -white)              the symbol framed for 12–20px slots (internal tabs, favicons), so it sits at
//                                          the optical size of a website favicon instead of filling the box.
//   acira-mark.png, acira-logo.png         raster copies (512 px symbol, 2× lockup) for places that need a bitmap.
// Run: node resources/brand/build-brand-assets.mjs   (then scripts/release-icons.mjs for the Windows .ico and PNGs)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'package.json'));
const canonical = fs.readFileSync(path.join(root, 'public/brand/acira-lockup-2026.svg'), 'utf8');
const paths = [...canonical.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
const [wordmark, symbol] = paths;
const gradient = canonical.match(/<linearGradient\b[^>]*>[\s\S]*?<\/linearGradient>/)[0];
const viewBox = canonical.match(/viewBox="([^"]+)"/)[1];
if (paths.length !== 2 || !gradient || viewBox !== '0 0 365 108') throw new Error('Unexpected canonical lockup structure');

// The symbol's exact bounds (getBBox of the supplied path).
const SYMBOL = { left: 0, top: 8.837, right: 79.573, bottom: 107.398 };
const n = value => Number(value.toFixed(2));

const withGradient = id => gradient.replace(/id="[^"]+"/, `id="${id}"`);
const svg = (box, body, id) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" fill="none">\n${body}\n<defs>\n${withGradient(id)}\n</defs>\n</svg>\n`;

// The lockup exactly as supplied; only the fills differ.
const lockup = (ink, id, symbolFill = `url(#${id})`) => svg(viewBox, `<path d="${wordmark}" fill="${ink}"/>\n<path d="${symbol}" fill="${symbolFill}"/>`, id);

function mark(fill, id, symbolFill = `url(#${id})`) {
  // Square frame around the symbol; `fill` is the share of the frame height the symbol occupies.
  const height = SYMBOL.bottom - SYMBOL.top, side = height / fill;
  const cx = (SYMBOL.left + SYMBOL.right) / 2, cy = (SYMBOL.top + SYMBOL.bottom) / 2;
  return svg(`${n(cx - side / 2)} ${n(cy - side / 2)} ${n(side)} ${n(side)}`, `<path d="${symbol}" fill="${symbolFill}"/>`, id);
}

const out = {
  'public/acira-logo.svg': lockup('#050A30', 'acira-lockup-gradient'),
  'public/acira-logo-light.svg': lockup('#FFFFFF', 'acira-lockup-white', '#FFFFFF'),
  'public/acira-symbol.svg': mark(0.96, 'acira-symbol-gradient'),
  'public/acira-symbol-white.svg': mark(0.96, 'acira-symbol-white', '#FFFFFF'),
  'public/acira-icon.svg': mark(0.8, 'acira-icon-gradient'),
  'public/acira-icon-white.svg': mark(0.8, 'acira-icon-white', '#FFFFFF'),
};
for (const [file, content] of Object.entries(out)) fs.writeFileSync(path.join(root, file), content);

// Rasters, rendered by the system Edge (headless) from the SVGs above.
const { chromium } = require('playwright-core');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  const raster = async (file, width, height) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const base64 = await page.evaluate(async ({ source, width, height }) => {
      const image = new Image(); image.src = 'data:image/svg+xml;base64,' + btoa(source); await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      return canvas.toDataURL('image/png').split(',')[1];
    }, { source, width, height });
    return Buffer.from(base64, 'base64');
  };
  fs.writeFileSync(path.join(root, 'public/acira-mark.png'), await raster('public/acira-symbol.svg', 512, 512));
  fs.writeFileSync(path.join(root, 'public/acira-logo.png'), await raster('public/acira-logo.svg', 730, 216));
} finally { await browser.close(); }
console.log([...Object.keys(out), 'public/acira-mark.png', 'public/acira-logo.png'].join('\n'));
