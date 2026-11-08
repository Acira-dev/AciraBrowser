'use strict';
// Site-colour research (beta.12 item 19): the pure helpers behind desktop/site-color-probe.cjs. The probe itself is a dev flag, off by default.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const math = require('../desktop/site-color-math.cjs');

// A few pairs from Sharma, Wu and Dalal's CIEDE2000 test data (Lab -> our sRGB route differs, so check sanity bounds, not 4 decimals).
test('deltaE is 0 for equal colours, symmetric, and ordered the way an eye orders shades', () => {
  assert.equal(math.deltaE([20, 40, 60], [20, 40, 60]), 0);
  const a = [255, 255, 255], b = [250, 250, 250], c = [200, 200, 200];
  assert.ok(Math.abs(math.deltaE(a, b) - math.deltaE(b, a)) < 1e-9);
  assert.ok(math.deltaE(a, b) < math.deltaE(a, c));
  assert.ok(math.deltaE(a, b) < 3, 'two near-whites are a seam only a careful eye finds');
  assert.ok(math.deltaE([255, 255, 255], [0, 0, 0]) > 90);
  assert.ok(math.deltaE([255, 0, 0], [0, 0, 255]) > 30);
});

test('deltaELab reproduces published CIEDE2000 reference pairs (Sharma, Wu, Dalal 2005)', () => {
  const pairs = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [one, two, expected] of pairs) assert.ok(Math.abs(math.deltaELab(one, two) - expected) < 0.001, `${one} vs ${two}`);
});

test('hex parsing and printing round-trip, with alpha', () => {
  assert.deepEqual(math.fromHex('#1e2327'), [30, 35, 39, 1]);
  assert.deepEqual(math.fromHex('#fff'), [255, 255, 255, 1]);
  assert.equal(math.fromHex('#12345'), null);
  assert.equal(math.toHex([255, 69, 0]), '#ff4500');
  assert.deepEqual(math.over([0, 0, 0, 0.5], [255, 255, 255]), [127.5, 127.5, 127.5]);
});

function bitmap(width, height, paint) {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = paint(x, y); const at = (y * width + x) * 4; out[at] = b; out[at + 1] = g; out[at + 2] = r; out[at + 3] = 255; }
  return out;
}

test('summarise finds a flat colour, and tells a photograph from a flat colour by its share', () => {
  const flat = bitmap(40, 10, () => [30, 35, 39]);
  const one = math.summarise(flat, 40, 10, { x0: 0, y0: 0, x1: 40, y1: 10 });
  assert.equal(one.hex, '#1e2327'); assert.ok(one.share > 0.99); assert.ok(one.spread < 1);
  const noise = bitmap(40, 10, (x, y) => [(x * 37 + y * 11) % 256, (x * 91) % 256, (y * 53 + x * 7) % 256]);
  const busy = math.summarise(noise, 40, 10, { x0: 0, y0: 0, x1: 40, y1: 10 });
  assert.ok(busy.share < 0.5, 'a busy block has no dominant colour');
  const half = bitmap(40, 10, (x) => (x < 30 ? [255, 255, 255] : [0, 0, 0]));
  const mixed = math.summarise(half, 40, 10, { x0: 0, y0: 0, x1: 40, y1: 10 });
  assert.equal(mixed.hex, '#ffffff'); assert.equal(math.summarise(half, 40, 10, { x0: 5, y0: 5, x1: 5, y1: 9 }), null);
});

test('iconColours: a white tile with a small red logo is white overall and red as a brand colour', () => {
  const icon = bitmap(16, 16, (x, y) => (x >= 5 && x < 11 && y >= 5 && y < 11 ? [229, 9, 20] : [255, 255, 255]));
  const result = math.iconColours(icon, 16, 16);
  assert.equal(result.all.hex, '#ffffff'); assert.match(result.brand.hex, /^#e/); assert.ok(result.brand.share < 0.2);
});

test('decodeIcoBitmap reads the bitmap picture of an .ico (bottom-up rows) and svgColours counts the colours a vector icon names', () => {
  const dib = Buffer.alloc(40 + 16 + 8);
  dib.writeUInt32LE(40, 0); dib.writeInt32LE(2, 4); dib.writeInt32LE(4, 8); dib.writeUInt16LE(1, 12); dib.writeUInt16LE(32, 14);
  const put = (at, b, g, r, a) => { dib[at] = b; dib[at + 1] = g; dib[at + 2] = r; dib[at + 3] = a; };
  put(40, 0, 0, 255, 255); put(44, 0, 0, 255, 255); put(48, 255, 0, 0, 255); put(52, 255, 0, 0, 255); // stored bottom row (red) first, then the top row (blue)
  const icon = math.decodeIcoBitmap(dib, 0);
  assert.equal(icon.width, 2); assert.equal(icon.height, 2);
  assert.deepEqual([...icon.bgra.slice(0, 4)], [255, 0, 0, 255], 'the top-left pixel is blue');
  assert.deepEqual([...icon.bgra.slice(8, 12)], [0, 0, 255, 255], 'the bottom-left pixel is red');
  assert.equal(math.decodeIcoBitmap(Buffer.alloc(10), 0), null);
  const list = math.svgColours('<svg><path fill="#e50914"/><path fill="#e50914"/><path fill="#fff"/><g stop-color="rgb(10, 20, 30)"/></svg>');
  assert.deepEqual(list[0], { hex: '#e50914', count: 2 }); assert.equal(list.length, 3);
});

test('createHold: a one-frame flash never repaints, a real change does once, a tiny change never does', () => {
  const hold = math.createHold({ enter: 3.5, dwellMs: 200, minReads: 2 });
  const white = [255, 255, 255], dark = [15, 15, 15];
  hold.push(white, 0);
  hold.push(dark, 100); // a transient frame
  hold.push(white, 200);
  assert.deepEqual(hold.shown, white); assert.equal(hold.changes, 1);
  hold.push(dark, 300); hold.push(dark, 400); const out = hold.push(dark, 520);
  assert.equal(out.changed, true); assert.deepEqual(hold.shown, dark); assert.equal(hold.changes, 2);
  hold.push([17, 15, 15], 600); hold.push([16, 16, 16], 800);
  assert.equal(hold.changes, 2, 'a one-step shade change is below the threshold');
  const forced = math.createHold();
  forced.push(white, 0); assert.equal(forced.push(dark, 10, { force: true }).changed, true);
});

test('glide eases from one colour to the next and stays within them', () => {
  assert.deepEqual(math.glide([0, 0, 0], [200, 100, 50], 0), [0, 0, 0]);
  assert.deepEqual(math.glide([0, 0, 0], [200, 100, 50], 1), [200, 100, 50]);
  assert.deepEqual(math.glide([0, 0, 0], [200, 100, 50], 0.5), [100, 50, 25]);
});

test('the probe is off unless the flag is set and the profile is a throwaway one', () => {
  const probe = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'site-color-probe.cjs'), 'utf8');
  assert.match(probe, /ACIRA_SITE_COLOR_PROBE !== '1'\) return null;/);
  assert.match(probe, /if \(!process\.env\.ACIRA_BROWSER_TEST_DATA\) \{[^}]*return null;/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8');
  assert.match(main, /if\(process\.env\.ACIRA_SITE_COLOR_PROBE==='1'\)require\('\.\/site-color-probe\.cjs'\)\.install\(/);
  assert.doesNotMatch(probe, /\bnet\.request|\bnet\.fetch|require\('node:https?'\)/, 'the probe only fetches through the tab\'s own session');
});
