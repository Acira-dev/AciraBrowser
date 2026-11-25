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

// Twitch (reported 14 Nov): no theme-color, a dark or white top edge, a purple icon: the glow depends on the icon alone. The colour used to come only from its own second fetch (4 s,
// answered from the cache): a heavy page that timed it out kept the tab's icon and lost the glow. The icon the tab itself resolved now gives the colour too.
const TWITCH_FAVICON_32 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAETSURBVHgB7ZU7DoJAEIb/JV7MBq/hCVROIJ7AqI2t0d5WsTF2dhzBI1hbsLIYwyPADgzrFvI1PJbk+5lZBoEaNq6cR4APA0wDIdTRgQV5lgGI8skZnbAe5a8ditwkjk15LoANeS5AW7nqabGvdfcrA9iiD9AHsB5gACZVI5o6uv+rBbct7AW4H4Dw+DmPp+7ipwGU/L5P5V4g/O8aexM2kkusvEsqVxitQOHNd7F8VnyGXIHiny37mWVFZSTyQIzL1tgV0MljQrwwq1pkBaDIoxeG3lU80XUAgvyhk/MC6OSOXs4KoJWfxIPysACRlSslV1YGpwIhV65oOwlDygYzEqBuqLShUQuSWd6hvBFLV/owwBuAI3t8NBey8QAAAABJRU5ErkJggg==', 'base64');
const fakeNativeImage = (width, height, paint) => ({ createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width, height }), toBitmap: () => bgra(width, height, paint) }) });
test('brandOfIcon: Twitch\'s real 32 px favicon gives its purple, a white tile with a grey mark none, an unreadable file skip', () => {
  const { brandOfIcon } = require('../desktop/site-colour.cjs'), iconImage = require('../desktop/browser-services/icon-image.cjs');
  const purple = (x, y) => (x < 6 || y < 6 ? [255, 255, 255] : [145, 70, 255]);
  assert.deepEqual(brandOfIcon(TWITCH_FAVICON_32, { nativeImage: fakeNativeImage(32, 32, purple), iconImage }), { hex: '#9146ff' });
  const tile = (x, y) => (x > 12 && x < 20 && y > 12 && y < 20 ? [154, 160, 166] : [255, 255, 255]);
  assert.deepEqual(brandOfIcon(TWITCH_FAVICON_32, { nativeImage: fakeNativeImage(32, 32, tile), iconImage }), { none: true });
  assert.deepEqual(brandOfIcon(Buffer.from('not a picture'), { nativeImage: { createFromBuffer: () => ({ isEmpty: () => true }) }, iconImage }), { skip: true });
});
test('a site with only an icon: the tab\'s own resolved icon gives the glow when the colour\'s own fetch finds nothing, and a late failure does not take it away', async () => {
  const { clock, emitted, tab } = harness({ iconOf: async () => null, stripOf: async () => null });
  tab.navigated('https://www.twitch.tv/chilledcat_music'); tab.iconChanged(['https://assets.twitch.tv/assets/favicon-16.png', 'https://assets.twitch.tv/assets/favicon-32.png']);
  await clock.advance(1500); assert.deepEqual(emitted, [], 'its own fetch found nothing: no glow yet');
  tab.iconResolved('#9146ff'); await clock.advance(400);
  assert.deepEqual(emitted, ['#9146ff'], 'the colour of the icon the tab already resolved');
  // the colour-safety rule still applies: a grey or a near-white from an icon is not a brand colour
  const other = harness({ iconOf: async () => null, stripOf: async () => null });
  other.tab.navigated('https://example.com/'); other.tab.iconChanged(['https://example.com/i.png']); other.tab.iconResolved('#f4f4f4'); other.tab.iconResolved('#808080'); await other.clock.advance(1500);
  assert.deepEqual(other.emitted, []);
});
test('the colour\'s own icon fetch that finishes after the tab\'s icon gave a colour does not overwrite it with nothing', async () => {
  let release; const late = new Promise(resolve => { release = resolve; });
  const { clock, emitted, tab } = harness({ iconOf: () => late, stripOf: async () => null });
  tab.navigated('https://www.twitch.tv/x'); tab.iconChanged(['https://assets.twitch.tv/assets/favicon-32.png']);
  await clock.advance(700); tab.iconResolved('#9146ff'); await clock.advance(300); release(null); await clock.advance(1500);
  assert.deepEqual(emitted, ['#9146ff']);
});

test('an icon colour handed over before the page announced any icons counts (the stored icon at commit, the icon the tab resolved when no favicon event came)', async () => {
  const { clock, emitted, tab } = harness({ iconOf: async () => null, stripOf: async () => null });
  tab.navigated('https://www.twitch.tv/chilledcat_music');   // no iconChanged: Chromium reported none for this document
  tab.iconResolved('#9146ff'); await clock.advance(400);
  assert.deepEqual(emitted, ['#9146ff']);
});

test('a colour handed over by the tab\'s icon stays through the page\'s own icon announcement (no drop while the colour\'s second fetch runs), and a new icon\'s colour replaces it', async () => {
  const never = new Promise(() => {});
  const { clock, emitted, tab } = harness({ iconOf: () => never, stripOf: async () => null });
  tab.navigated('https://www.twitch.tv/x'); tab.iconResolved('#9146ff'); await clock.advance(400);
  assert.deepEqual(emitted, ['#9146ff']);
  tab.iconChanged(['https://assets.twitch.tv/assets/favicon-32.png']); await clock.advance(6000);
  assert.deepEqual(emitted, ['#9146ff'], 'the announcement did not wipe the colour: nothing was published, nothing dropped');
  tab.iconResolved('#ff0033'); await clock.advance(800);
  assert.equal(emitted[emitted.length - 1], '#ff0033', 'the site changed its icon: the new colour');
});

// 14.1 (reported 21 Nov): coveryourtracks.eff.org, a green page (body rgb(48, 93, 66)) under a black logo bar, no theme-color and an icon with no brand colour, had no colour
// at all: no ring, no glow, no folder. The engine's 4th source is the page itself: the brand colour that covers the most of its top BAND_DIP, when it covers enough.
test('the page\'s own colour: the brand colour that covers the most of the top band, not a small logo, not a page of many colours, not white or black', () => {
  const { bandBrand, BAND_SHARE } = require('../desktop/site-colour.cjs');
  const eff = bgra(120, 200, (x, y) => (y < 22 ? (x < 12 && y > 4 && y < 18 ? [237, 28, 36] : [0, 0, 0]) : (x > 30 && x < 70 && y > 40 && y < 90 ? [241, 196, 15] : [48, 93, 66])));
  const read = bandBrand(eff, 120, 200);
  assert.ok(read, 'the green field is the page\'s colour'); assert.equal(read.hex, '#305d42'); assert.ok(read.share > .6, String(read.share));
  assert.equal(bandBrand(bgra(120, 200, (x, y) => (x < 20 && y < 20 ? [237, 28, 36] : [255, 255, 255])), 120, 200), null, 'a white page with a red logo: none');
  assert.equal(bandBrand(bgra(120, 200, () => [13, 17, 23]), 120, 200), null, 'a near-black page: none');
  const quilt = bgra(120, 200, (x, y) => [[220, 40, 40], [40, 160, 60], [40, 80, 220], [230, 180, 20]][(Math.floor(x / 30) + Math.floor(y / 50)) % 4]);
  assert.equal(bandBrand(quilt, 120, 200), null, 'four colours of a quarter each (photos, tiles): none of them covers ' + BAND_SHARE);
  const header = bgra(120, 200, (x, y) => (y < 80 ? [91, 33, 182] : [255, 255, 255]));
  assert.equal(bandBrand(header, 120, 200).hex, '#5b21b6', 'a coloured header taller than the thin strip counts');
  assert.ok(bandBrand(bgra(120, 200, (x, y) => [48 + (x % 6), 93 - (y % 5), 66]), 120, 200), 'a field with a little noise (a texture, anti-aliasing) is still one colour');
});

test('the page is read last: after the theme-color, the top edge and the icon, only when they give nothing, only while the tab is on screen', async () => {
  let bands = 0;
  const green = async () => { bands++; return { bitmap: bgra(120, 200, (x, y) => (y < 22 ? [0, 0, 0] : [48, 93, 66])), width: 120, height: 200 }; };
  const blackStrip = async () => ({ bitmap: bgra(100, 12, () => [0, 0, 0]), width: 100, height: 12 });
  let h = harness({ stripOf: blackStrip, iconOf: async () => null, bandOf: green });
  h.tab.navigated('https://coveryourtracks.eff.org/'); h.tab.iconChanged(['https://coveryourtracks.eff.org/static/favicon.ico']); h.tab.loaded(); await h.clock.advance(800);
  assert.deepEqual(h.emitted, ['#305d42'], 'no theme-color, a black top edge, a grey icon: the page\'s green');
  bands = 0; h = harness({ stripOf: blackStrip, iconOf: async () => '#ff4500', bandOf: green });
  h.tab.navigated('https://a.test/'); h.tab.iconChanged(['https://a.test/i.png']); h.tab.loaded(); await h.clock.advance(800);
  assert.deepEqual(h.emitted, ['#ff4500'], 'an icon with a brand colour wins over the page'); assert.equal(bands, 0, 'and the page is not even captured');
  bands = 0; h = harness({ stripOf: blackStrip, bandOf: green });
  h.tab.navigated('https://b.test/'); h.tab.themeColor('#5b21b6'); await h.clock.advance(800);
  assert.deepEqual(h.emitted, ['#5b21b6'], 'a theme-color wins'); assert.equal(bands, 0);
  bands = 0; h = harness({ visible: () => false, stripOf: blackStrip, bandOf: green });
  h.tab.navigated('https://c.test/'); h.tab.loaded(); await h.clock.advance(6000);
  assert.equal(bands, 0, 'a tab off screen is never captured'); assert.deepEqual(h.emitted, []);
  bands = 0; h = harness({ level: () => 'off', stripOf: blackStrip, bandOf: green });
  h.tab.navigated('https://d.test/'); h.tab.loaded(); await h.clock.advance(6000);
  assert.equal(bands, 0, 'Off captures nothing'); assert.deepEqual(h.emitted, []);
});

test('every colour goes out with the site it was read for, also when a remembered site has the same colour as the last one', async () => {
  const out = [];
  const clock = fakeClock();
  const control = createSiteColour({ now: clock.now, schedule: clock.schedule, cancel: clock.cancel, stripOf: async () => ({ bitmap: bgra(100, 12, () => [255, 0, 51]), width: 100, height: 12 }) });
  const tab = control.attach('t1', { emit: patch => out.push(patch) });
  tab.navigated('https://www.a.test/'); tab.loaded(); await clock.advance(400);
  assert.deepEqual(out.at(-1), { siteColor: '#ff0033', siteColorHost: 'a.test' });
  tab.navigated('https://b.test/'); tab.loaded(); await clock.advance(400);
  assert.deepEqual(out.at(-1), { siteColor: '#ff0033', siteColorHost: 'b.test' }, 'the same red read for another site still names that site');
  tab.navigated('https://a.test/x'); await clock.advance(10);
  assert.deepEqual(out.at(-1), { siteColor: '#ff0033', siteColorHost: 'a.test' }, 'a remembered site gives its colour and its name at once');
});
