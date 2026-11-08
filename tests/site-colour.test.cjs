'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSiteColour, isBrand, flatStrip, iconBrand, hostOf } = require('../desktop/site-colour.cjs');

const bgra = (width, height, paint) => { const b = Buffer.alloc(width * height * 4); for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, bl] = paint(x, y); const at = (y * width + x) * 4; b[at] = bl; b[at + 1] = g; b[at + 2] = r; b[at + 3] = 255; } return b; };
const fakeClock = () => {
  let clock = 0, next = 1; const queue = [];
  return {
    now: () => clock,
    schedule: (fn, ms) => { const timer = { fn, at: clock + ms, id: next++, unref() {} }; queue.push(timer); return timer; },
    cancel: timer => { const i = queue.indexOf(timer); if (i >= 0) queue.splice(i, 1); },
    async advance(ms) { const end = clock + ms; for (;;) { queue.sort((a, b) => a.at - b.at); const due = queue.find(t => t.at <= end); if (!due) break; queue.splice(queue.indexOf(due), 1); clock = due.at; due.fn(); for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(r => setImmediate(r)); } clock = end; },
  };
};
const harness = (options = {}) => {
  const clock = fakeClock(), emitted = [];
  const control = createSiteColour({ now: clock.now, schedule: clock.schedule, cancel: clock.cancel, ...options });
  const tab = control.attach('t1', { emit: patch => emitted.push(patch.siteColor) });
  return { clock, emitted, control, tab };
};

test('a brand colour is saturated and neither near-black nor near-white', () => {
  for (const hex of ['#ff0033', '#ff4500', '#1ed760', '#5765f2', '#ffd60a']) assert.equal(isBrand(require('../desktop/site-color-math.cjs').fromHex(hex).slice(0, 3)), true, hex);
  for (const hex of ['#ffffff', '#fefefe', '#000000', '#121212', '#171515', '#1e2327', '#0d1117', '#808080', '#f7f6f3']) assert.equal(isBrand(require('../desktop/site-color-math.cjs').fromHex(hex).slice(0, 3)), false, hex);
});

test('only a flat strip counts: a photo, a gradient or a header in two halves gives nothing', () => {
  assert.equal(flatStrip(bgra(100, 12, () => [255, 0, 51]), 100, 12).hex, '#ff0033');
  assert.equal(flatStrip(bgra(100, 12, x => (x < 50 ? [255, 0, 51] : [0, 80, 255])), 100, 12), null);
  assert.equal(flatStrip(bgra(100, 12, x => [x * 2, 255 - x * 2, (x * 7) % 255]), 100, 12), null);
});
test('an icon gives its brand colour, a white tile with a grey mark gives none', () => {
  const red = bgra(32, 32, () => [255, 0, 51]), tile = bgra(32, 32, (x, y) => (x > 12 && x < 20 && y > 12 && y < 20 ? [154, 160, 166] : [255, 255, 255]));
  assert.equal(iconBrand(red, 32, 32).hex, '#ff0033'); assert.equal(iconBrand(tile, 32, 32), null);
});
test('hostOf keeps only http(s) hosts, without www', () => { assert.equal(hostOf('https://www.Example.com/a'), 'example.com'); assert.equal(hostOf('acira://settings'), null); assert.equal(hostOf('file:///x'), null); });

test('theme-color first, then the top edge, then the icon; nothing when none is a brand colour', async () => {
  // 1. a brand theme-color wins
  let h = harness({ stripOf: async () => ({ bitmap: bgra(100, 12, () => [0, 0, 255]), width: 100, height: 12 }), iconOf: async () => '#00ff00' });
  h.tab.navigated('https://a.test/'); h.tab.themeColor('#ff0033'); await h.clock.advance(400); assert.deepEqual(h.emitted, ['#ff0033']);
  // 2. a white theme-color is not a brand colour: the flat coloured edge is
  h = harness({ stripOf: async () => ({ bitmap: bgra(100, 12, () => [0, 0, 255]), width: 100, height: 12 }), iconOf: async () => '#00ff00' });
  h.tab.navigated('https://a.test/'); h.tab.themeColor('#ffffff'); await h.clock.advance(600); assert.deepEqual(h.emitted, ['#0000ff']);
  // 3. a white edge too: the icon's brand colour
  h = harness({ stripOf: async () => ({ bitmap: bgra(100, 12, () => [255, 255, 255]), width: 100, height: 12 }), iconOf: async () => '#ff4500' });
  h.tab.navigated('https://a.test/'); h.tab.iconChanged(['https://a.test/i.png']); h.tab.themeColor('#000000'); await h.clock.advance(1500); assert.deepEqual(h.emitted, ['#ff4500']);
  // 4. nothing: no glow, and nothing is emitted for a site that never had one
  h = harness({ stripOf: async () => ({ bitmap: bgra(100, 12, () => [255, 255, 255]), width: 100, height: 12 }), iconOf: async () => null });
  h.tab.navigated('https://a.test/'); h.tab.iconChanged(['https://a.test/i.png']); h.tab.loaded(); await h.clock.advance(6000); assert.deepEqual(h.emitted, []);
});

test('Off, blocked tabs and hidden tabs read nothing', async () => {
  let reads = 0, level = 'off';
  const h = harness({ level: () => level, stripOf: async () => { reads++; return { bitmap: bgra(100, 12, () => [255, 0, 51]), width: 100, height: 12 }; }, iconOf: async () => { reads++; return '#ff0033'; } });
  h.tab.navigated('https://a.test/'); h.tab.iconChanged(['https://a.test/i.png']); h.tab.loaded(); await h.clock.advance(6000); assert.deepEqual(h.emitted, []); assert.equal(reads, 0, 'Off samples nothing');
  level = 'soft'; h.tab.recheck(); await h.clock.advance(1000); assert.deepEqual(h.emitted, ['#ff0033']);
  level = 'off'; h.tab.recheck(); await h.clock.advance(1000); assert.deepEqual(h.emitted, ['#ff0033', null], 'turning it Off clears the colour');
  let blocked = true, strips = 0;
  const b = harness({ blocked: () => blocked, stripOf: async () => { strips++; return null; }, iconOf: async () => { strips++; return '#ff0033'; } });
  b.tab.navigated('https://p.test/'); b.tab.themeColor('#ff0033'); b.tab.iconChanged(['https://p.test/i.png']); b.tab.loaded(); await b.clock.advance(6000); assert.deepEqual(b.emitted, []); assert.equal(strips, 0, 'a private, Tor or secured tab is never sampled');
  const v = harness({ visible: () => false, stripOf: async () => { strips++; return { bitmap: bgra(100, 12, () => [255, 0, 51]), width: 100, height: 12 }; } });
  v.tab.navigated('https://h.test/'); v.tab.themeColor('#ffffff'); v.tab.loaded(); await v.clock.advance(6000); assert.equal(strips, 0, 'a tab off screen is never captured');
});

test('smoothing: a one-step shade change never repaints; a real change needs two reads over 220 ms; another site skips the wait', async () => {
  const strip = { rgb: [255, 0, 51] };
  const h = harness({ stripOf: async () => ({ bitmap: bgra(100, 12, () => strip.rgb), width: 100, height: 12 }) });
  h.tab.navigated('https://a.test/'); h.tab.loaded(); await h.clock.advance(300); assert.deepEqual(h.emitted, ['#ff0033']);
  strip.rgb = [253, 2, 52]; await h.clock.advance(1300); assert.deepEqual(h.emitted, ['#ff0033'], 'a barely different red does not repaint');
  strip.rgb = [0, 80, 255]; h.tab.loaded(); await h.clock.advance(300); assert.deepEqual(h.emitted, ['#ff0033'], 'one reading of a new colour is not enough');
  await h.clock.advance(1500); assert.deepEqual(h.emitted, ['#ff0033', '#0050ff'], 'the same colour twice over the dwell is');
  h.tab.navigated('https://b.test/'); strip.rgb = [30, 215, 96]; h.tab.loaded(); await h.clock.advance(300); assert.deepEqual(h.emitted.slice(-1), ['#1ed760'], 'a new site shows its colour at once');
});

test('a site with no brand colour takes the glow away, but only when it is not a one-off reading; a revisit paints at once', async () => {
  const strip = { rgb: [255, 0, 51] };
  const h = harness({ stripOf: async () => ({ bitmap: bgra(100, 12, () => strip.rgb), width: 100, height: 12 }) });
  h.tab.navigated('https://a.test/'); h.tab.loaded(); await h.clock.advance(300); assert.deepEqual(h.emitted, ['#ff0033']);
  strip.rgb = [255, 255, 255]; h.tab.navigated('https://white.test/'); h.tab.loaded(); await h.clock.advance(400); assert.deepEqual(h.emitted, ['#ff0033', null], 'another site with a white edge: no glow');
  strip.rgb = [255, 0, 51]; h.tab.navigated('https://a.test/'); assert.deepEqual(h.emitted.slice(-1), ['#ff0033'], 'back on a known site: its remembered colour at once, before any reading');
  // never remembered when asked not to (private and Tor windows)
  const p = harness({ rememberHosts: false, stripOf: async () => ({ bitmap: bgra(100, 12, () => [255, 0, 51]), width: 100, height: 12 }) });
  p.tab.navigated('https://a.test/'); p.tab.loaded(); await p.clock.advance(300); p.tab.navigated('https://b.test/'); p.tab.navigated('https://a.test/'); assert.equal(p.control.hostMemory.size, 0);
});

test('dispose cancels every pending read', async () => {
  let reads = 0; const h = harness({ stripOf: async () => { reads++; return null; } });
  h.tab.navigated('https://a.test/'); h.tab.loaded(); h.tab.dispose(); await h.clock.advance(6000); assert.equal(reads, 0); assert.equal(h.control.tabs.size, 0);
});
