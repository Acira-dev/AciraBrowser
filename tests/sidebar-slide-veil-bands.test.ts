// Founder, 5 Nov 2026 (Windows 11, acrylic): opening the docked sidebar with its button, "an overlay shows above and below the sidebar" while it slides in. Over acrylic every
// pixel the interface does not tint shows the bare glass. The layout switch is a view transition: the old frame's full-width veil fades out in 240 ms while the slide takes 480,
// and the new frame left the sidebar's column to the sidebar's own veil alone, so ahead of its sliding edge, along the toolbar's row and the card's bottom strip, nothing was tinted;
// behind the edge the old frame's veil still lay under the arrived sidebar's own and doubled it (alpha 206 against 167 settled). The hover reveal never showed it: it splits the
// frame into the bands and the sidebar's middle from the start. Real-pixel check (stepped frames of the real app): the slide's alpha along the toolbar's row and the bottom strip
// is the settled value in every frame, and the middle of the column is single-tinted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/styles/view-morph.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2].trim()] as const);
const live = ':root[data-mode-switch=layout][data-desktop-material=ready]:not([data-edge-float]):not([data-sidebar-overlay])';
const app = '.app.style-acira:not(.native-layer)';
const find = (needle: (selector: string) => boolean) => rules.filter(([selector]) => needle(selector));

test('the docked slide tints the column in three pieces that abut on whole boxes: the band above the card, the strip below it, and the sidebar\'s middle', () => {
  const railMiddle = find(selector => selector.includes(live) && selector.includes('>.ed-rail.is-expanded:not(.is-peek)::after'));
  assert.equal(railMiddle.length, 1, 'the sidebar\'s own veil is its ::after, between the bands');
  const body = railMiddle[0][1];
  assert.match(body, /top:calc\(var\(--frame-band-top,0px\) \+ var\(--frame-corner,16px\)\)/); assert.match(body, /bottom:calc\(var\(--frame-band-bottom,0px\) \+ var\(--frame-corner,16px\)\)/);
  assert.ok(!/(^|;)\s*(-webkit-)?mask\s*:/.test(body), 'a box, not a mask: a mask edge on a fractional device pixel doubles or drops half a pixel of tint');
  assert.match(body, /linear-gradient\(180deg,rgb\(var\(--sidebar-rgb,var\(--chrome-rgb\)\) \/ var\(--chrome-veil-top\)\),rgb\(var\(--sidebar-rgb,var\(--chrome-rgb\)\) \/ var\(--chrome-veil-bottom\)\)\) 0 calc\(-1 \* \(var\(--frame-band-top,0px\) \+ var\(--frame-corner,16px\)\)\) \/ 100% 100vh/, 'the window\'s one gradient, offset by the band, so the three pieces are one veil');
  assert.ok(find(selector => selector.includes(live) && selector.includes('>.ed-rail.is-expanded:not(.is-peek)') && !selector.includes('::after')).some(([, decl]) => decl === 'isolation:isolate'), 'the rail is its own stacking context for the piece behind its content');
  const pieces = find(selector => selector.includes(live) && selector.includes(`${app}:has(>.ed-rail.is-expanded:not(.is-peek))::`));
  const both = pieces.find(([selector]) => selector.includes('::before') && selector.includes('::after'));
  assert.ok(both, 'the frame carries a band above the card and a strip below it');
  assert.match(both![1], /position:fixed;left:0;width:var\(--navigation-width,0px\)/, 'across the sidebar\'s column');
  assert.match(both![1], /background-size:100% 100vh/);
  const top = pieces.find(([selector]) => selector.endsWith('::before') && !selector.includes('::after'))?.[1] ?? '', bottom = pieces.find(([selector]) => selector.endsWith('::after') && !selector.includes('::before'))?.[1] ?? '';
  assert.match(top, /top:0;height:calc\(var\(--frame-band-top,0px\) \+ var\(--frame-corner,16px\)\);background-position:0 0/);
  assert.match(bottom, /bottom:0;height:calc\(var\(--frame-band-bottom,0px\) \+ var\(--frame-corner,16px\)\);background-position:0 100%/);
});

test('the frame\'s old or new picture keeps off the middle of the sidebar\'s column (its veil lay under the sidebar\'s own and doubled it)', () => {
  const pair = find(selector => selector === `html:is([data-material=acrylic],[data-material=vibrancy])${live}::view-transition-image-pair(root)`);
  assert.equal(pair.length, 1);
  const T = 'calc\\(var\\(--frame-band-top,0px\\) \\+ var\\(--frame-corner,16px\\)\\)', Bo = 'calc\\(100% - var\\(--frame-band-bottom,0px\\) - var\\(--frame-corner,16px\\)\\)', Wd = 'var\\(--frame-rail-width,0px\\)';
  assert.match(pair[0][1], new RegExp(`^clip-path:polygon\\(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,0 ${T},${Wd} ${T},${Wd} ${Bo},0 ${Bo},0 ${T}\\)$`));
});

test('every new rule stands only on live glass: a flat frame (window inactive, transparency off) and a floating sidebar keep the full-height veil they had', () => {
  for (const [selector] of rules.filter(([selector]) => /--frame-(band|rail)|isolation:isolate/.test(selector) || selector.includes('::view-transition-image-pair(root)'))) assert.ok(selector.includes('[data-desktop-material=ready]'), selector);
  const legacy = find(selector => selector.includes('>.ed-rail.is-expanded:not(.is-peek)') && !selector.includes('::') && !selector.includes(':has('));
  assert.equal(legacy.length, 2, 'the live rule and the flat-frame rule');
  const flat = legacy.find(([selector]) => selector.includes(':is([data-sidebar-overlay],:not([data-desktop-material=ready]))'));
  assert.ok(flat, 'the full-height veil still covers a floating sidebar and a frame with no live glass');
  assert.match(flat![1], /^background:linear-gradient\(180deg,rgb\(var\(--sidebar-rgb,var\(--chrome-rgb\)\) \/ var\(--chrome-veil-top\)\),rgb\(var\(--sidebar-rgb,var\(--chrome-rgb\)\) \/ var\(--chrome-veil-bottom\)\)\)$/);
  assert.equal(css.includes(':root[data-mode-switch=layout][data-sidebar-overlay]:not([data-edge-float]) .app'), false, 'the old selector is gone');
});

// The bands' heights are the card's own (the toolbar is 36 px in Full and 32 in Compact and Focus; the card keeps 6 px below), read around the switch.
const g = globalThis as unknown as Record<string, unknown>;
type Box = { left: number; top: number; width: number; height: number; right: number; bottom: number };
const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height, right: left + width, bottom: top + height });
function stage(initial: { rail: number; card: Box }) {
  const values = new Map<string, string>(), dataset: Record<string, string> = {};
  let state = initial, finish!: () => void, ready!: () => void;
  const readyPromise = new Promise<void>(resolve => { ready = resolve; }), finished = new Promise<void>(resolve => { finish = resolve; });
  g.document = {
    documentElement: { dataset, hasAttribute: () => false, style: { setProperty: (key: string, value: string) => values.set(key, value), getPropertyValue: (key: string) => values.get(key) ?? '' } },
    visibilityState: 'visible',
    querySelector: (selector: string) => selector.includes('.ed-rail') ? (state.rail ? { getBoundingClientRect: () => box(0, 0, state.rail, 720) } : null) : selector.includes('.page-area') ? { getBoundingClientRect: () => state.card } : null,
    startViewTransition(update: () => void) { update(); return { ready: readyPromise, finished } as never; },
  };
  g.window = { innerHeight: 720, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) };
  g.matchMedia = () => ({ matches: false });
  return { values, set: (next: typeof initial) => { state = next; }, ready, finish };
}
const docked = { rail: 240, card: box(240, 36, 854, 678) }, away = { rail: 0, card: box(0, 36, 1100, 684) };

test('opening: the band, the strip and the sidebar\'s width are read from the frame the switch shows', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const s = stage(away);
  startModeTransition(() => s.set(docked), 'layout');
  assert.equal(s.values.get('--frame-rail-width'), '240px'); assert.equal(s.values.get('--frame-band-top'), '36px'); assert.equal(s.values.get('--frame-band-bottom'), '6px');
  s.ready(); s.finish();
});

test('closing: the frame the switch leaves keeps its band, strip and width while the sidebar goes (the frame it shows has none)', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const s = stage(docked);
  startModeTransition(() => s.set(away), 'layout');
  assert.equal(s.values.get('--frame-rail-width'), '240px', 'not overwritten by the frame with no sidebar'); assert.equal(s.values.get('--frame-band-top'), '36px'); assert.equal(s.values.get('--frame-band-bottom'), '6px');
  s.ready(); s.finish();
});

test('a layout switch with no docked sidebar in either frame clears the width, so the column is not cut out of the frame\'s picture', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const s = stage(docked);
  startModeTransition(() => s.set(away), 'layout'); s.ready(); s.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  const t = stage(away); t.values.set('--frame-rail-width', '240px');
  startModeTransition(() => {}, 'layout');
  assert.equal(t.values.get('--frame-rail-width'), '0px');
  t.ready(); t.finish();
});

test('Compact and Focus: the band is the toolbar\'s 32 px', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const s = stage(away);
  startModeTransition(() => s.set({ rail: 240, card: box(240, 32, 854, 682) }), 'layout');
  assert.equal(s.values.get('--frame-band-top'), '32px'); assert.equal(s.values.get('--frame-band-bottom'), '6px');
  s.ready(); s.finish();
});

// Founder, 5 Nov 2026 (round 3): on the docked sidebar's slide the native page is round from its first frame (desktop/page-motion.cjs) while the card the interface draws beside it
// lags or leads by a few pixels, so the card's outline at its two left corners showed beside the page's curve as a light crescent. The outline begins where the curve ends, for a
// website only (a page the interface draws itself keeps its own corners), and only in the layout switch: the hover reveal's rim lines are another rule and stay as they are.
test('the card\'s outline leaves its two left corners to the native page, in the layout switch only', () => {
  const sidebarCss = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const clip = [...sidebarCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2].trim()] as const).filter(([selector]) => selector.includes('::view-transition-image-pair(acira-page)'));
  assert.equal(clip.length, 1);
  assert.ok(clip[0][0].startsWith(':root[data-mode-switch=layout]'), 'the layout switch alone: the edge transitions (hover reveal, Seamless) never take it');
  assert.ok(clip[0][0].includes('.page-content[data-native]'), 'only over a native website');
  assert.match(clip[0][1], /^clip-path:polygon\(14px -4px,calc\(100% \+ 4px\) -4px,calc\(100% \+ 4px\) calc\(100% \+ 4px\),14px calc\(100% \+ 4px\),14px calc\(100% - 14px\),-4px calc\(100% - 14px\),-4px 14px,14px 14px\)$/,
    'the card, less a 14 px square at each of its two left corners (8 px curve, 6 px for the two clocks); the left edge between them is kept');
});
