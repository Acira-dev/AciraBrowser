import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Item 17, the Link preview marker: while a Link preview is open from a tab or a favorite tile, a card with the preview site's icon slides out
// beside the source's icon and slides back when it closes. Main sends `peek-state`; ui/peekMarker.ts keeps what the sidebar needs; the card
// (components/PeekMarkerCard.tsx) is drawn by sidebar.css. The components import stylesheets; Node has no CSS loader, so a .css import loads empty.
register('data:text/javascript,' + encodeURIComponent("export async function load(url, context, next) { return url.endsWith('.css') ? { format: 'module', source: '', shortCircuit: true } : next(url, context); }"));
type Listener = (event: unknown) => void;
const bridge = { listeners: new Set<Listener>(), asked: [] as unknown[], answer: undefined as unknown };
(globalThis as { window?: unknown }).window ??= {};
(globalThis as unknown as { window: { acira?: unknown } }).window.acira = {
  platform: 'darwin',
  subscribeBrowser: (listener: Listener) => { bridge.listeners.add(listener); return () => bridge.listeners.delete(listener); },
  peek: (request: unknown) => { bridge.asked.push(request); return Promise.resolve(bridge.answer); },
};
const store = await import('../src/ui/peekMarker');
const { PeekMarkerCard } = await import('../src/components/PeekMarkerCard');
const send = (event: unknown) => { for (const listener of [...bridge.listeners]) listener(event); };
const peekOf = (extra: Record<string, unknown> = {}) => ({ type: 'peek-state', peek: { sourceTabId: 'tab-1', url: 'https://docs.test/a', title: 'Docs', loading: false, canGoBack: false, favicon: 'data:image/png;base64,AAAA', bounds: null, ...extra } });
const ICON = 'data:image/png;base64,AAAA';
const marker = (tab: string, extra: Record<string, unknown> = {}) => ({ sourceTabId: tab, url: 'https://docs.test/a', favicon: ICON, loading: false, ...extra });

test('a peek-state event is read for the tab it came from, the address, the icon and whether it still loads; anything else is ignored or closed', () => {
  assert.deepEqual(store.peekMarkerFromEvent(peekOf()), marker('tab-1'));
  assert.deepEqual(store.peekMarkerFromEvent(peekOf({ loading: true, favicon: '' })), marker('tab-1', { loading: true, favicon: '' }));
  assert.equal(store.peekMarkerFromEvent({ type: 'peek-state', peek: null }), null, 'a closed preview');
  assert.equal(store.peekMarkerFromEvent({ type: 'state' }), undefined, 'another event is not about the preview');
  assert.equal(store.peekMarkerFromEvent(null), undefined);
  assert.equal(store.peekMarkerFromEvent(peekOf({ sourceTabId: '' })), null, 'no source tab: nothing to mark');
  assert.equal(store.peekMarkerFromEvent(peekOf({ sourceTabId: 7 })), null);
  assert.equal(store.peekMarkerFromEvent(peekOf({ favicon: 'javascript:alert(1)' }))?.favicon, '', 'only an image or a web address is an icon');
  assert.equal(store.peekMarkerFromEvent(peekOf({ favicon: 'data:image/png;base64,' + 'A'.repeat(70000) }))?.favicon, '', 'a heavy one is dropped');
  assert.equal(store.peekMarkerFromEvent(peekOf({ loading: 'yes' }))?.loading, false);
});

test('the state: open while a preview is, leaving while its card slides back, replaced and reopened cleanly', () => {
  const none = { open: null, leaving: null };
  const a = marker('tab-1'), b = marker('tab-2');
  const opened = store.peekMarkerReduce(none, a);
  assert.deepEqual(opened, { open: a, leaving: null });
  assert.equal(store.peekMarkerReduce(opened, { ...a }), opened, 'the same preview told again (a layout change) changes nothing: no render');
  const loaded = store.peekMarkerReduce(opened, { ...a, favicon: 'data:image/png;base64,BBBB' });
  assert.equal(loaded.open?.favicon, 'data:image/png;base64,BBBB', 'its own icon arriving is a change');
  const closed = store.peekMarkerReduce(opened, null);
  assert.deepEqual(closed, { open: null, leaving: a }, 'closing keeps the preview as leaving, so the card can slide back');
  assert.equal(store.peekMarkerReduce(closed, null), closed, 'closed twice is still closed');
  assert.deepEqual(store.peekMarkerReduce(closed, a), { open: a, leaving: null }, 'reopened from the same tab while sliding back: one card again');
  assert.deepEqual(store.peekMarkerReduce(closed, b), { open: b, leaving: a }, 'another tab\'s preview: the first card still slides back');
  assert.deepEqual(store.peekMarkerReduce(opened, b), { open: b, leaving: a }, 'a preview replaced by another tab\'s: the old card leaves');
  assert.deepEqual(store.peekMarkerFor(opened, 'tab-1'), { open: true, marker: a });
  assert.deepEqual(store.peekMarkerFor(closed, 'tab-1'), { open: false, marker: a }, 'a leaving card is still drawn, closed');
  assert.equal(store.peekMarkerFor(opened, 'tab-2'), null, 'no other tab has a marker');
  assert.equal(store.peekMarkerFor(opened, undefined), null);
});

test('the store listens to main while something draws a marker, asks once for a preview already open, and ends a leaving card after its slide', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    store.resetPeekMarker();
    bridge.answer = { ok: true, peek: { sourceTabId: 'tab-9', url: 'https://late.test/', loading: true, favicon: '' } };
    let seen = 0;
    const off = store.subscribePeekMarker(() => { seen++; });
    assert.equal(bridge.listeners.size, 1, 'subscribed to main');
    assert.deepEqual(bridge.asked, [{ type: 'peek.state' }], 'a window whose interface reloaded asks for the preview already open');
    await new Promise<void>(resolve => queueMicrotask(resolve)); await Promise.resolve();
    assert.equal(store.peekMarkerSnapshot().open?.sourceTabId, 'tab-9');
    send(peekOf());
    assert.equal(store.peekMarkerSnapshot().open?.sourceTabId, 'tab-1');
    assert.equal(store.peekMarkerSnapshot().leaving?.sourceTabId, 'tab-9', 'the one it replaced slides back');
    const renders = seen; send(peekOf());
    assert.equal(seen, renders, 'the same state again does not wake the sidebar');
    send({ type: 'peek-state', peek: null });
    assert.equal(store.peekMarkerSnapshot().open, null);
    assert.equal(store.peekMarkerSnapshot().leaving?.sourceTabId, 'tab-1');
    mock.timers.tick(store.PEEK_MARKER_LEAVE_MS - 1);
    assert.equal(store.peekMarkerSnapshot().leaving?.sourceTabId, 'tab-1', 'still sliding back');
    mock.timers.tick(2);
    assert.equal(store.peekMarkerSnapshot().leaving, null, 'the card is taken off once it is back');
    send({ type: 'peek-state', peek: null });
    assert.equal(store.peekMarkerSnapshot().leaving, null);
    off();
    assert.equal(bridge.listeners.size, 0, 'nothing listening once no tile or row is mounted');
  } finally { store.resetPeekMarker(); mock.timers.reset(); }
});

test('the card: dots while it loads with no icon, the site\'s icon once it has one, the globe when it never gets one; nothing on any other tab', () => {
  const card = (tab: string | undefined, size: 12 | 14 = 14) => renderToStaticMarkup(createElement(PeekMarkerCard, { tabId: tab, size, reduced: false }));
  store.resetPeekMarker();
  assert.equal(card('tab-1'), '', 'no preview: no card');
  store.notePeekMarker(marker('tab-1', { loading: true, favicon: '' }) as never);
  let html = card('tab-1');
  assert.match(html, /^<span class="sb-peek-card" data-size="14" role="img" aria-label="Link preview"><span class="sb-peek-face" aria-hidden="true"><canvas[^>]*dot-matrix/, 'a loading page with no icon shows the loader');
  assert.doesNotMatch(html, /data-open/, 'it mounts closed; the layout effect opens it a frame later so opening is a transition');
  assert.equal(card('tab-2'), '', 'only the source tab carries it');
  assert.equal(card(undefined), '');
  store.notePeekMarker(marker('tab-1', { loading: true }) as never);
  html = card('tab-1', 12);
  assert.match(html, /data-size="12"/);
  assert.match(html, new RegExp('<img[^>]*src="' + ICON.replace(/[+/]/g, '\\$&') + '"'), 'an icon known while the page still loads is shown at once');
  assert.doesNotMatch(html, /dot-matrix/);
  store.notePeekMarker(marker('tab-1', { favicon: '', loading: false }) as never);
  html = card('tab-1');
  assert.match(html, /<svg[^>]*lucide|<svg/, 'a page with no icon after it loaded shows the globe');
  assert.doesNotMatch(html, /dot-matrix|<img/);
  store.notePeekMarker(null);
  assert.match(card('tab-1'), /class="sb-peek-card"/, 'a closed preview\'s card stays mounted to slide back');
  assert.doesNotMatch(card('tab-1'), /data-open/);
  store.resetPeekMarker();
  assert.equal(card('tab-1'), '');
});

test('sidebar.css: the card sits under the icon, steps the title aside, follows the motion setting, and the rows and tiles keep their own rules', () => {
  const css = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
  const at = css.indexOf('Link preview marker (item 17)');
  assert.ok(at > 0, 'the marker has its own section');
  const own = css.slice(css.lastIndexOf('/*', at));
  // Premium, Fast and Off: base times the frequent-surface scale (1.28 Premium, 0.6 Fast, 0 Off); a CSS transition, not a timer
  assert.match(own, /--sb-peek-in:calc\(235ms \* var\(--motion-f,1\.28\)\)/);
  assert.match(own, /--sb-peek-out:calc\(172ms \* var\(--motion-f,1\.28\)\)/);
  // light and dark cards
  assert.match(own, /--sb-peek-card:#fff/);
  assert.match(own, /\[data-chrome=dark\] \.ed-rail\.acira-sidebar\{--sb-peek-card:color-mix\(in srgb,#fff 17%,transparent\)/);
  // the tile: the icon steps 10px left, the card is under it (z-index 0 against the icon's 1)
  assert.match(own, /\.sb-app:has\(>\.sb-peek-card\[data-open\]\)>:is\(img,svg,\.sb-app-initial\)\{transform:translateX\(-10px\)/);
  assert.match(own, /\.sb-app:has\(>\.sb-peek-card\)>:is\(img,svg,\.sb-app-initial\)\{position:relative;z-index:1/);
  assert.doesNotMatch(own, /\.sb-app>:is\(img,svg/, 'only a tile that has a card changes its icon (the + and the less-favorites chevron are untouched)');
  assert.match(own, /\.sb-app>\.sb-peek-card\{position:absolute;inset:0;z-index:0\}/);
  // the row: a zero-size anchor first in the row, level with the icon, and the title steps aside by 16px
  assert.match(own, /\.sb-tab-main>\.sb-peek-card\{order:-1;position:relative;flex:none;width:0;height:0;margin-right:-8px\}/);
  assert.match(own, /\.sb-tab-main:has\(>\.sb-peek-card\[data-open\]\) \.sb-tab-title\{margin-left:16px/);
  // the card is neutral: no site colour, nothing that could clash with a tile's colour ring (the ring is drawn by the tile, the card has no outline of its own colour)
  assert.doesNotMatch(own.replace(/\/\*[\s\S]*?\*\//g, ''), /site-colo|--site|ring/i);
  // reduced motion is the sidebar's own rule (no transition under [data-reduced-motion] or the OS setting), which the card's rules do not outrank
  assert.match(css, /\.acira-sidebar\[data-reduced-motion\] \*,\.app\.style-acira \.acira-sidebar\[data-reduced-motion\] \*::after\{transition:none!important/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)\{\.app\.style-acira \.acira-sidebar \*,/);
  assert.match(own, /@media\(forced-colors:active\)\{[^}]*\.sb-peek-face/);
});

test('the sidebar draws it: a card in each favorite tile and each tab row, for the source tab only', () => {
  const sidebar = readFileSync(new URL('../src/components/sidebar/AciraSidebar.tsx', import.meta.url), 'utf8');
  assert.match(sidebar, /import \{ PeekMarkerCard \} from '\.\.\/PeekMarkerCard';/);
  assert.match(sidebar, /<PeekMarkerCard tabId=\{tab\?\.id\} size=\{14\} reduced=\{reduced\}\/>/, 'a tile: the favorite\'s own tab');
  assert.match(sidebar, /<PeekMarkerCard tabId=\{tab\.id\} size=\{12\} reduced=\{state\.settings\.reducedMotion\}\/>/, 'a row: its own tab');
  assert.match(sidebar, /<AppIcon app=\{app\} tab=\{tab\} stored=\{siteIcon\(app\.url\)\} reduced=\{state\.settings\.reducedMotion\}\/>/);
});

test('the card\'s class names and its open flag are the ones the stylesheet draws, so neither can drift alone', () => {
  const component = readFileSync(new URL('../src/components/PeekMarkerCard.tsx', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
  for (const name of ['sb-peek-card', 'sb-peek-face']) { assert.ok(component.includes(`"${name}"`), name + ' in the component'); assert.ok(css.includes('.' + name), name + ' in the stylesheet'); }
  assert.ok(component.includes('data-open') && css.includes('[data-open]'));
  // it is mounted closed and opened in a layout effect after the closed card was styled: that is what makes opening a transition
  assert.match(component, /useLayoutEffect\(\(\) => \{[\s\S]*getBoundingClientRect\(\);[\s\S]*setArmed\(true\)/);
});
