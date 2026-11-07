'use strict';
// Which of a page's own icons a tab shows: 14 real sites' icon sets (tests/fixtures/tab-icons/icon-sets.json, captured 6 Nov 2026: the engine's
// announced list, the page's <link> tags, and the real type and size of each file) run through the picker and the tab pipeline with stand-in files.
const test = require('node:test'), assert = require('node:assert/strict');
const { needFor, parseSizes, sizeHint, candidatesFrom, plan, readPageLinks, PAGE_LINKS_CODE, MAX_TRIES } = require('../desktop/browser-services/icon-pick.cjs');
const { createTabIcons } = require('../desktop/browser-services/tab-icons.cjs');
const { png, ico, svg, nativeImage, response, missing } = require('./fixtures/tab-icons/pictures.cjs');
const sets = require('./fixtures/tab-icons/icon-sets.json');

const fileFor = (found) => (/svg/.test(found.type) ? [svg(), 'image/svg+xml'] : /icon/.test(found.type) ? [ico(found.w >= 256 ? [16, found.w] : found.w >= 48 ? [16, 32, found.w] : found.w >= 32 ? [16, found.w] : [found.w]), found.type] : [png(found.w, found.h), found.type]);
function sessionFor(set) {
  const calls = [];
  return { calls, fetch: async (url, init) => { calls.push({ url, init }); const found = set.files[url]; if (!found) return missing; const [body, type] = fileFor(found); return response(body, type); } };
}
const tail = (url) => url.split('/').pop();

test('the size an icon needs is the biggest place it is drawn at the sharpest screen: a 24 px tile, at least 2x', () => {
  assert.deepEqual([1, 1.25, 1.5, 2, 2.5, 3].map(needFor), [48, 48, 48, 48, 60, 72]);
  assert.equal(needFor(NaN), 48);
});

test('declared sizes, size hints in names, and the rules for what counts as an icon', () => {
  assert.equal(parseSizes('16x16 32x32'), 32); assert.equal(parseSizes('any'), 0); assert.equal(parseSizes(''), 0); assert.equal(parseSizes('192X192'), 192);
  assert.equal(sizeHint('https://a.example/favicon-16x16.png'), 16); assert.equal(sizeHint('https://a.example/192x192.png'), 192);
  assert.equal(sizeHint('https://a.example/favicon-32-5c61aa63605bca4f740d.png'), 32); assert.equal(sizeHint('https://a.example/favicon.ico'), 0);
  assert.equal(sizeHint('https://a.example/logo-1234567.png'), 0, 'a hash is not a size');
  const found = candidatesFrom({ pageUrl: 'https://a.example/x/', links: [
    { rel: 'icon', href: 'https://a.example/i.png', sizes: '32x32' }, { rel: 'SHORTCUT ICON', href: '/s.ico' }, { rel: 'mask-icon', href: '/m.svg' }, { rel: 'fluid-icon', href: '/f.png' },
    { rel: 'apple-touch-icon-precomposed', href: '/t.png', sizes: '180x180' }, { rel: 'icon', href: 'data:image/png;base64,AAAA' }, { rel: 'icon', href: 'file:///etc/passwd' }, { rel: 'stylesheet', href: '/c.css' },
    { rel: 'icon', href: 'https://a.example/v.svg', type: 'image/svg+xml', sizes: 'any' }, { rel: 'icon', href: 'https://a.example/i.png#again', sizes: '32x32' }, null, { rel: 5 },
  ], announced: ['https://a.example/i.png', 'https://a.example/extra-48x48.png', 'javascript:alert(1)'] });
  assert.deepEqual(found.map((c) => [c.url, c.px, c.touch, c.vector]), [
    ['https://a.example/i.png', 32, false, false], ['https://a.example/s.ico', 0, false, false], ['https://a.example/t.png', 180, true, false],
    ['https://a.example/v.svg', 0, false, true], ['https://a.example/extra-48x48.png', 48, false, false]],
  'only the page\'s plain icons and touch icons, web addresses only, each once; an .ico\'s declared size is not trusted');
});

test('the order of attempts: big enough first, then unknown sizes, then the SVG, then smaller; a touch icon only when nothing else is declared', () => {
  const c = (url, px, extra = {}) => ({ url, px, touch: false, vector: false, ...extra });
  const order = (list, need = 48) => plan(list, need, 9).map((x) => x.url);
  assert.deepEqual(order([c('a16', 16), c('a32', 32), c('a96', 96), c('a64', 64), c('unknown', 0), c('vec', 0, { vector: true })]), ['a64', 'a96', 'unknown', 'vec', 'a32', 'a16']);
  assert.deepEqual(order([c('a16', 16), c('t180', 180, { touch: true })]), ['a16'], 'a 16 px favicon is kept over a square app icon');
  assert.deepEqual(order([c('t180', 180, { touch: true }), c('t120', 120, { touch: true })]), ['t120', 't180'], 'nothing else declared: the smallest touch icon that is big enough');
  assert.deepEqual(order([c('a32', 32), c('a96', 96)], 72), ['a96', 'a32'], 'a bigger screen asks for a bigger file');
  assert.equal(plan([c('a', 16), c('b', 17), c('c', 18), c('d', 19), c('e', 20)], 48).length, MAX_TRIES, 'at most three files are ever tried');
  assert.deepEqual(plan([], 48), []);
});

test('with only the engine\'s list (the page could not be read), names still say which is bigger', () => {
  const bbc = sets.find((s) => s.site === 'www.bbc.com');
  const found = plan(candidatesFrom({ links: null, announced: bbc.announced, pageUrl: bbc.page }), 48);
  assert.deepEqual(found.map((x) => tail(x.url)), ['favicon.ico', 'favicon-32x32.png', 'favicon-16x16.png'], 'the unmeasured .ico first, then the 32, never the 16 before the 32');
});

const EXPECTED_AT_48 = {
  'www.notion.com': 'favicon.ico', 'www.twitch.tv': 'favicon-32-5c61aa63605bca4f740d.png', 'www.apple.com': 'favicon.ico', 'www.bbc.com': 'favicon.ico',
  'www.mozilla.org': 'favicon-196x196.e143075360ea.png', 'www.amazon.com': 'favicon.ico', 'www.linkedin.com': 'al2o9zrvru7aqj8e1x2rzsrca',
  'stackoverflow.com': 'favicon.ico?v=562fb39d93c8', 'www.netflix.com': 'nficon2023.ico', 'www.reddit.com': '64x64.png', 'en.wikipedia.org': 'wikipedia.ico',
  'github.com': 'favicon.svg', 'accounts.google.com': 'favicon.ico', 'www.youtube.com': 'favicon_48x48.png',
};
test('14 real sites: each gets the sharpest icon its own page declares, within three requests and without cookies', async () => {
  assert.equal(sets.length, 14);
  for (const set of sets) {
    const session = sessionFor(set), icons = createTabIcons({ nativeImage });
    const icon = await icons.resolveIcon(session, { announced: set.announced, links: set.links, pageUrl: set.page, need: 48 });
    assert.ok(icon, set.site);
    assert.equal(tail(icon.url), EXPECTED_AT_48[set.site], set.site);
    assert.ok(icon.vector || Math.max(icon.width, icon.height) >= 48 || set.site === 'www.twitch.tv' || set.site === 'accounts.google.com', `${set.site} is as big as the page offers (${icon.width}px)`);
    assert.ok(Math.max(icon.width, icon.height) <= 128, 'nothing bigger than 128 px is kept');
    assert.ok(session.calls.length >= 1 && session.calls.length <= MAX_TRIES, `${set.site}: ${session.calls.length} requests`);
    assert.ok(session.calls.every((call) => call.init.credentials === 'omit'), 'no cookies');
    const declared = new Set([...set.announced, ...set.links.map((l) => l.href)]);
    assert.ok(session.calls.every((call) => declared.has(call.url)), 'only addresses the page itself declared');
    const touch = new Set(set.links.filter((l) => /apple-touch/.test(l.rel)).map((l) => l.href));
    assert.ok(!session.calls.some((call) => touch.has(call.url)), `${set.site}: a touch icon was not needed`);
    assert.match(icon.data, /^data:image\/(png|x-icon|svg\+xml);base64,/);
  }
});

test('the same sites on a 3x screen ask for bigger files where the page offers them', async () => {
  const pick = async (site) => { const set = sets.find((s) => s.site === site); const icon = await createTabIcons({ nativeImage }).resolveIcon(sessionFor(set), { announced: set.announced, links: set.links, pageUrl: set.page, need: needFor(3) }); return tail(icon.url); };
  assert.equal(await pick('www.reddit.com'), '128x128.png'); assert.equal(await pick('www.youtube.com'), 'favicon_96x96.png'); assert.equal(await pick('github.com'), 'favicon.svg');
});

test('an icon smaller than it said falls through to the next; an icon that is not there is skipped; nothing declared gives null', async () => {
  const links = [{ rel: 'icon', href: 'https://x.example/big.png', sizes: '64x64' }, { rel: 'icon', href: 'https://x.example/gone.png', sizes: '96x96' }, { rel: 'icon', href: 'https://x.example/v.svg', type: 'image/svg+xml' }];
  const set = { files: { 'https://x.example/big.png': { type: 'image/png', w: 16, h: 16 }, 'https://x.example/v.svg': { type: 'image/svg+xml', w: 0, h: 0 } } };
  const session = sessionFor(set);
  const icon = await createTabIcons({ nativeImage }).resolveIcon(session, { links, pageUrl: 'https://x.example/', need: 48 });
  assert.equal(tail(icon.url), 'v.svg'); assert.deepEqual(session.calls.map((c) => tail(c.url)), ['big.png', 'gone.png', 'v.svg']);
  assert.equal(await createTabIcons({ nativeImage }).resolveIcon(session, { links: [], announced: [], pageUrl: 'https://x.example/', need: 48 }), null);
  const onlySmall = await createTabIcons({ nativeImage }).resolveIcon(sessionFor({ files: { 'https://x.example/a.png': { type: 'image/png', w: 16, h: 16 } } }), { announced: ['https://x.example/a.png'], need: 48 });
  assert.equal(onlySmall.width, 16, 'the only icon there is, however small');
});

test('the page\'s tags are read in an isolated world, quickly, and a page that cannot answer costs nothing', async () => {
  const asks = [];
  const contents = (run) => ({ isDestroyed: () => false, executeJavaScriptInIsolatedWorld: (...args) => { asks.push(args); return run(); } });
  const links = [{ rel: 'icon', href: 'https://x.example/i.png', sizes: '', type: '' }];
  assert.deepEqual(await readPageLinks(contents(async () => links)), links);
  assert.equal(typeof asks[0][0], 'number'); assert.equal(asks[0][1][0].code, PAGE_LINKS_CODE); assert.equal(asks[0][2], false, 'not a user gesture');
  assert.equal(await readPageLinks(contents(async () => { throw new Error('gone'); })), null);
  assert.equal(await readPageLinks(contents(() => new Promise(() => {})), { timeoutMs: 30 }), null);
  assert.equal(await readPageLinks(contents(async () => 'nope')), null);
  assert.equal(await readPageLinks({ isDestroyed: () => true }), null); assert.equal(await readPageLinks(null), null);
  assert.match(PAGE_LINKS_CODE, /querySelectorAll\('link\[rel\]'\)/); assert.doesNotMatch(PAGE_LINKS_CODE, /fetch|XMLHttpRequest|new Image|sendBeacon|\.src\s*=/, 'it reads the document and asks the network for nothing');
});

test('a tab shows the engine\'s best at once when its page is slow to answer, then upgrades once the tags arrive', async () => {
  const set = sets.find((s) => s.site === 'www.bbc.com'), session = sessionFor(set), icons = createTabIcons({ nativeImage }), delivered = [];
  const contents = { session };
  let release; const slow = (_c) => new Promise((resolve) => { release = () => resolve(set.links); });
  const done = icons.resolvePageIcon(contents, { announced: set.announced, pageUrl: set.page, need: 48, quickMs: 10, readLinks: slow, deliver: (icon) => delivered.push(icon && tail(icon.url)) });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.deepEqual(delivered, ['favicon.ico'], 'answered from the engine\'s list without waiting');
  release(); await done;
  assert.deepEqual(delivered, ['favicon.ico'], 'the tags agree, so nothing changes');
  const other = [];
  await icons.resolvePageIcon(contents, { announced: ['https://www.bbc.com/favicon-16x16.png'], pageUrl: set.page, need: 48, readLinks: async () => set.links, deliver: (icon) => other.push(icon && tail(icon.url)) });
  assert.deepEqual(other, ['favicon.ico'], 'with the tags read in time, one answer');
  const stale = [];
  await icons.resolvePageIcon(contents, { announced: set.announced, pageUrl: set.page, need: 48, readLinks: async () => set.links, current: () => false, deliver: (icon) => stale.push(icon) });
  assert.deepEqual(stale, [], 'a tab that has moved on is not told');
});
