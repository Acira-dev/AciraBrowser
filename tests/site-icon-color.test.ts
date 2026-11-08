import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_CHROMA, MIN_CHROMA, RING_LIGHTNESS, analyseIcon, contrastRatio, oklchToRgb } from '../src/ui/siteIconColor';
import { readSidebarApps, setSidebarAppsPlace, addSidebarApp } from '../src/ui/sidebarApps';

// Item 10 (beta.13): the active Favorites tile's ring is its site's own colour, read from the icon on this computer, and the tiles can sit at the
// bottom of the sidebar. These tests pin the colour reading (ui/siteIconColor.ts), the contrast the stylesheet relies on, the stored choice and the wiring.
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, String(value)); }, removeItem: (key: string) => { store.delete(key); } },
  window: { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} },
});
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** A 32 x 32 icon of flat runs: [[r, g, b, a, count], ...]. */
const icon = (...runs: [number, number, number, number, number][]) => Uint8ClampedArray.from(runs.flatMap(([r, g, b, a, n]) => Array.from({ length: n }, () => [r, g, b, a]).flat()));
const hueNear = (actual: number, expected: number, within = 12) => assert.ok(Math.min(Math.abs(actual - expected), 360 - Math.abs(actual - expected)) <= within, `hue ${actual} is not within ${within} of ${expected}`);

test('a flat colour gives its own hue; the usual brand colours land where they should', () => {
  const red = analyseIcon(icon([255, 0, 0, 255, 1024])), blue = analyseIcon(icon([0, 0, 255, 255, 1024])), green = analyseIcon(icon([0, 200, 60, 255, 1024]));
  assert.ok(red && blue && green);
  hueNear(red.h, 29); hueNear(blue.h, 264); hueNear(green.h, 148, 15);
  for (const colour of [red, blue, green]) assert.ok(colour.c >= MIN_CHROMA && colour.c <= MAX_CHROMA);
});

test('grey, black, white, transparent and nearly-white icons have no colour: the tile keeps the accent', () => {
  assert.equal(analyseIcon(icon([128, 128, 128, 255, 1024])), null, 'grey');
  assert.equal(analyseIcon(icon([0, 0, 0, 255, 1024])), null, 'black (GitHub, Notion)');
  assert.equal(analyseIcon(icon([255, 255, 255, 255, 1024])), null, 'white');
  assert.equal(analyseIcon(icon([220, 40, 40, 0, 1024])), null, 'fully transparent');
  assert.equal(analyseIcon(icon([255, 255, 255, 255, 960], [220, 30, 30, 255, 64])), null, 'a white icon with a few coloured pixels (under 12%)');
  assert.equal(analyseIcon(new Uint8ClampedArray()), null, 'empty');
  assert.equal(analyseIcon(icon([20, 20, 20, 255, 700], [240, 240, 240, 255, 324])), null, 'black on white (Wikipedia, Notion)');
});

test('a black glyph on a coloured square gives the square; a multi-colour logo gives its biggest colour group', () => {
  const square = analyseIcon(icon([229, 9, 20, 255, 800], [255, 255, 255, 255, 224]));
  assert.ok(square); hueNear(square.h, 27, 14);
  const logo = analyseIcon(icon([30, 120, 255, 255, 500], [255, 60, 40, 255, 200], [60, 200, 90, 255, 150], [255, 255, 255, 255, 174]));
  assert.ok(logo); hueNear(logo.h, 262, 14);
});

test('a pale or a neon colour is kept inside the range the ring is tested for', () => {
  const pale = analyseIcon(icon([230, 170, 170, 255, 1024]));
  assert.ok(pale); assert.equal(pale.c, MIN_CHROMA);
  const neon = analyseIcon(icon([0, 255, 0, 255, 1024]));
  assert.ok(neon); assert.equal(neon.c, MAX_CHROMA);
});

test('oklchToRgb stays inside the screen colours and keeps its lightness order', () => {
  for (let h = 0; h < 360; h += 15) for (const c of [0, MIN_CHROMA, MAX_CHROMA, 0.4]) {
    const rgb = oklchToRgb(0.6, c, h);
    assert.ok(rgb.every(value => Number.isInteger(value) && value >= 0 && value <= 255), `${h}/${c}: ${rgb}`);
  }
  const darker = oklchToRgb(0.4, 0.15, 30), lighter = oklchToRgb(0.8, 0.15, 30);
  assert.ok(darker[0] + darker[1] + darker[2] < lighter[0] + lighter[1] + lighter[2]);
});

// The stylesheet's numbers are the ones checked here: change one there and this fails until the contrast is looked at again.
const css = read('src/components/sidebar/sidebar.css');
const numbers = {
  lightL: Number(/--sb-site-l:(\.\d+);--sb-site-tint:(\d+)%;--sb-site-fallback/.exec(css)?.[1]), lightTint: Number(/--sb-site-l:(\.\d+);--sb-site-tint:(\d+)%;--sb-site-fallback/.exec(css)?.[2]),
  darkL: Number(/\[data-chrome=dark\] \.ed-rail\.acira-sidebar\{--sb-site-l:(\.\d+);--sb-site-tint:(\d+)%/.exec(css)?.[1]), darkTint: Number(/\[data-chrome=dark\] \.ed-rail\.acira-sidebar\{--sb-site-l:(\.\d+);--sb-site-tint:(\d+)%/.exec(css)?.[2]),
  richLight: Number(/data-site-color=rich\] \.app\.style-acira \.ed-rail\.acira-sidebar\{--sb-site-tint:(\d+)%/.exec(css)?.[1]), richDark: Number(/data-site-color=rich\] \.app\.style-acira\[data-chrome=dark\] \.ed-rail\.acira-sidebar\{--sb-site-tint:(\d+)%/.exec(css)?.[1]),
};
test('the stylesheet uses the lightness the helper documents, for light and dark', () => {
  assert.equal(numbers.lightL, RING_LIGHTNESS.light);
  assert.equal(numbers.darkL, RING_LIGHTNESS.dark);
});

test('the ring keeps 3:1 against its own tinted tile for every hue and chroma, Soft and Rich, light and dark', () => {
  // WCAG 1.4.11: the edge of a control against what is beside it. The tile in the light chrome is white (--sb-current); in the dark chrome it is
  // the lifted surface, measured at about rgb(53, 53, 58) over the finishes (the real renders were 3.7:1 or more at Soft).
  const mix = (a: number[], b: number[], share: number) => a.map((value, i) => Math.round(value * share + b[i] * (1 - share)));
  const cases: [string, number, number[], number][] = [
    ['light Soft', numbers.lightL, [255, 255, 255], numbers.lightTint], ['light Rich', numbers.lightL, [255, 255, 255], numbers.richLight],
    ['dark Soft', numbers.darkL, [53, 53, 58], numbers.darkTint], ['dark Rich', numbers.darkL, [53, 53, 58], numbers.richDark],
  ];
  for (const [name, lightness, tile, tint] of cases) {
    assert.ok(lightness > 0 && tint > 0, `${name}: numbers read from the stylesheet`);
    let worst = Infinity, at = '';
    for (let h = 0; h < 360; h += 3) for (const c of [MIN_CHROMA, 0.15, MAX_CHROMA]) {
      const ring = oklchToRgb(lightness, c, h), ratio = contrastRatio(ring, mix(ring, tile, tint / 100));
      if (ratio < worst) { worst = ratio; at = `hue ${h}, chroma ${c}`; }
    }
    assert.ok(worst >= 3, `${name}: ${worst.toFixed(2)}:1 at ${at}`);
  }
});

test('the ring follows the Site colour setting: Soft is the design (and applies while the attribute is missing), Rich is stronger, Off is the accent', () => {
  assert.match(css, /:root\[data-site-color=off\] \.app\.style-acira \.acira-sidebar \.sb-app\[data-site\]\{--sb-site:var\(--sb-site-fallback\)\}/);
  assert.match(css, /:root\[data-site-color=rich\][^{]*\.ed-rail\.acira-sidebar\{--sb-site-tint:\d+%\}/);
  assert.ok(numbers.richLight > numbers.lightTint && numbers.richDark > numbers.darkTint, 'Rich tints more than Soft');
  assert.doesNotMatch(css, /data-site-color=soft/, 'Soft needs no rule of its own');
  assert.match(css, /\.sb-app\[aria-current=page\],\.sb-apps>\.sb-glide\)\{background:color-mix\(in oklab,var\(--sb-site\) var\(--sb-site-tint\),var\(--sb-current\)\);box-shadow:inset 0 0 0 2px var\(--sb-site\)\}/, 'only the active tile and its gliding card carry the ring; rest and hover are untouched');
});

test('the tile reads its colour from its own icon, and the gliding card flies from one ring colour to the other', () => {
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx');
  assert.match(sidebar, /useIconColors\(apps\.map\(app=>\(\{key:app\.id,site:appHost\(app\.url\),src:app\.icon\|\|siteIdentity\(app\.url\)\.icon\|\|siteIcon\(app\.url\)\}\)\),!privateMode\)/);
  assert.match(sidebar, /data-site=\{colours\[app\.id\]\?'':undefined\}/);
  assert.match(sidebar, /'--site-h':colours\[app\.id\]!\.h,'--site-c':colours\[app\.id\]!\.c/);
  assert.match(sidebar, /\.\.\.\(tile\?\{'--sb-site':ring\(was\.el\)\}:\{\}\)/, 'the card starts in the colour of the tile it leaves');
  assert.match(sidebar, /glide\.style\.setProperty\('--sb-site',ring\(el\)\)/, 'and ends in the colour of the tile it lands on');
  assert.match(css, /@property --sb-site\{syntax:'<color>'/, 'registered, so the card can animate between the two colours');
  assert.doesNotMatch(read('src/ui/siteIconColor.ts'), /fetch\(|XMLHttpRequest|crossOrigin/, 'nothing is fetched');
});

test('Favorites at the bottom: stored as a profile choice, absent for the default, kept in memory in a private window', () => {
  assert.equal(readSidebarApps('pl').place, undefined);
  addSidebarApp('pl', false, { url: 'https://example.com/', title: 'Example' });
  setSidebarAppsPlace('pl', false, 'bottom');
  assert.equal(readSidebarApps('pl').place, 'bottom');
  assert.equal(readSidebarApps('pl').apps.length, 1, 'the tiles are untouched');
  assert.equal(readSidebarApps('other').place, undefined, 'per profile');
  assert.match(store.get('acira-sidebar-apps:pl') ?? '', /"place":"bottom"/);
  setSidebarAppsPlace('pl', false, 'top');
  assert.equal(readSidebarApps('pl').place, undefined);
  assert.doesNotMatch(store.get('acira-sidebar-apps:pl') ?? '', /place/, 'the default is not written');
  setSidebarAppsPlace('pp', true, 'bottom');
  assert.equal(readSidebarApps('pp', true).place, 'bottom');
  assert.equal(store.get('acira-sidebar-apps:pp'), undefined, 'a private window writes nothing to disk');
  store.set('acira-sidebar-apps:junk', JSON.stringify({ apps: [], place: 'sideways' }));
  assert.equal(readSidebarApps('junk').place, undefined, 'anything but bottom reads as top');
});

test('the placement is one control in the Favorites row, the layout puts the tiles above the workspace row, and the strings exist in every language', () => {
  const settings = read('src/features/settings/panels/sidebar.tsx');
  assert.match(settings, /<SettingRow id="sidebar-apps"[\s\S]*?<Select<'top' \| 'bottom'> label=\{t\("sidebar\.favoritesPosition"\)\}[\s\S]*?disabled=\{apps\.hidden\}[\s\S]*?<Switch label=\{t\("sidebar\.showFavoritesInTheSidebar"\)\}/, 'the Favorites row holds the switch and the position, no new row');
  assert.match(settings, /setSidebarAppsPlace\(tab\.browserProfileId, privateMode, 'top'\)/, 'Reset sidebar layout puts them back at the top');
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx');
  assert.match(sidebar, /const favoritesBottom=show\('favorites'\)&&favorites\.place==='bottom'/);
  assert.ok(sidebar.indexOf('<SidebarMedia') < sidebar.indexOf('className="sb-favorites-bottom"') && sidebar.indexOf('className="sb-favorites-bottom"') < sidebar.indexOf('<WorkspaceRow'), 'media card, then the tiles, then the workspace row and the footer');
  assert.match(sidebar, /show\('favorites'\)&&!favoritesBottom\?<>/, 'the top is the empty spacer when they sit at the bottom');
  assert.match(css, /\.sb-favorites-bottom \.sb-apps-region\{padding:2px 12px 8px;-webkit-app-region:no-drag\}/, 'the window-drag strip stays at the top');
  for (const locale of ['en', 'es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']) {
    const catalog = JSON.parse(read(`src/i18n/${locale}.json`)) as Record<string, string>;
    for (const id of ['sidebar.favoritesPosition', 'sidebar.favoritesTop', 'sidebar.favoritesBottom', 'sidebarcustomize.alwaysAtBottom']) assert.ok(catalog[id]?.trim(), `${locale} ${id}`);
    assert.doesNotMatch(catalog['sidebar.favoritesDetail'], locale === 'en' ? /at the top/ : /^$/, `${locale}: the detail no longer says the tiles are at the top`);
  }
});
