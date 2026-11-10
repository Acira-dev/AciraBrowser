'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSiteColour } = require(process.env.SITE_COLOUR_PATH || '../desktop/site-colour.cjs');

const fakeClock = () => {
  let clock = 0, next = 1; const queue = [];
  return {
    now: () => clock,
    schedule: (fn, ms) => { const timer = { fn, at: clock + ms, id: next++, unref() {} }; queue.push(timer); return timer; },
    cancel: timer => { const i = queue.indexOf(timer); if (i >= 0) queue.splice(i, 1); },
    async advance(ms) { const end = clock + ms; for (;;) { queue.sort((a, b) => a.at - b.at); const due = queue.find(t => t.at <= end); if (!due) break; queue.splice(queue.indexOf(due), 1); clock = due.at; await due.fn(); for (let i = 0; i < 6; i++) await Promise.resolve(); } clock = end; }
  };
};
const harness = (options = {}) => {
  const clock = fakeClock(), emitted = [];
  const control = createSiteColour({ now: clock.now, schedule: clock.schedule, cancel: clock.cancel, ...options });
  const tab = control.attach('t1', { emit: patch => emitted.push([clock.now(), patch.siteColor]) });
  return { clock, emitted, control, tab };
};
const colours = h => h.emitted.map(e => e[1]);

test('the first brand colour a new page declares is applied at once, not after the 120 ms debounce', async () => {
  const h = harness();
  h.tab.navigated('https://a.test/'); await h.clock.advance(131); h.tab.themeColor('#ff0033'); await h.clock.advance(5);
  assert.deepEqual(colours(h), ['#ff0033'], 'shown within a few ms of the event');
  assert.ok(h.emitted[0][0] - 131 < 20, `applied ${h.emitted[0][0] - 131} ms after the event`);
});

test('a page of the same site that changes colour is not held for the dwell and the 1.5 s pass', async () => {
  const h = harness();
  h.tab.navigated('https://a.test/x'); h.tab.themeColor('#ff0033'); h.tab.loaded(); await h.clock.advance(2000);
  h.tab.navigated('https://a.test/y'); await h.clock.advance(100); h.tab.themeColor('#0050ff'); await h.clock.advance(10);
  assert.deepEqual(colours(h), ['#ff0033', '#0050ff'], 'the new page\'s colour is up straight away');
});

test('a page that boots with a default and sets its own colour within 600 ms ends on its own colour in about a debounce', async () => {
  const h = harness();
  h.tab.navigated('https://a.test/'); h.tab.themeColor('#ff0033'); await h.clock.advance(50); h.tab.themeColor('#0050ff'); await h.clock.advance(250);
  assert.deepEqual(colours(h), ['#ff0033', '#0050ff']);
  assert.ok(h.emitted[1][0] <= 200, `the second colour came at ${h.emitted[1][0]} ms`);
  await h.clock.advance(4000); assert.equal(h.emitted.length, 2, 'and nothing after it');
});

test('a colour change long after the page settled keeps the debounce and the hold: no flicker', async () => {
  const h = harness();
  h.tab.navigated('https://a.test/'); h.tab.themeColor('#ff0033'); await h.clock.advance(3000);
  h.tab.themeColor('#0050ff'); await h.clock.advance(300);
  assert.deepEqual(colours(h), ['#ff0033'], 'one declared change on a settled page is not applied on one reading');
  // a page that animates its theme-color between two hues for three seconds: the glow does not follow every step
  const f = harness();
  f.tab.navigated('https://b.test/'); f.tab.themeColor('#ff0033'); await f.clock.advance(1000);
  for (let i = 0; i < 30; i++) { f.tab.themeColor(i % 2 ? '#ff0033' : '#0050ff'); await f.clock.advance(100); }
  assert.ok(f.emitted.length <= 2, `the glow changed ${f.emitted.length} times for 30 changes`);
});

test('a theme-color that is not a brand colour keeps the old path (edge, then icon), and Off or a blocked tab still reads nothing', async () => {
  const bgra = (w, hgt, rgb) => { const b = Buffer.alloc(w * hgt * 4); for (let i = 0; i < w * hgt; i++) { b[i * 4] = rgb[2]; b[i * 4 + 1] = rgb[1]; b[i * 4 + 2] = rgb[0]; b[i * 4 + 3] = 255; } return b; };
  const h = harness({ stripOf: async () => ({ bitmap: bgra(100, 12, [0, 0, 255]), width: 100, height: 12 }) });
  h.tab.navigated('https://a.test/'); h.tab.themeColor('#ffffff'); await h.clock.advance(10);
  assert.deepEqual(colours(h), [], 'a white theme-color is not applied');
  await h.clock.advance(600); assert.deepEqual(colours(h), ['#0000ff'], 'the flat edge is read after the debounce, as before');
  const off = harness({ level: () => 'off' }); off.tab.navigated('https://a.test/'); off.tab.themeColor('#ff0033'); await off.clock.advance(1000); assert.deepEqual(colours(off), []);
  const blocked = harness({ blocked: () => true }); blocked.tab.navigated('https://a.test/'); blocked.tab.themeColor('#ff0033'); await blocked.clock.advance(1000); assert.deepEqual(colours(blocked), []);
});
