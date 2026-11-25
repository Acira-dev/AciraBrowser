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
  /* 14.1 Your colours: the window's one gradient reads the frame's field variables (styles/own-colours.css), each falling back to the same colour as before */ assert.match(body, /linear-gradient\(180deg,rgb\(var\(--frame-top-rgb,var\(--sidebar-rgb,var\(--chrome-rgb\)\)\) \/ var\(--chrome-veil-top\)\),var\(--frame-mid-veil,\)rgb\(var\(--frame-bottom-rgb,var\(--sidebar-rgb,var\(--chrome-rgb\)\)\) \/ var\(--chrome-veil-bottom\)\)\) 0 calc\(-1 \* \(var\(--frame-band-top,0px\) \+ var\(--frame-corner,16px\)\)\) \/ 100% 100vh/, 'the window\'s one gradient, offset by the band, so the three pieces are one veil');
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
  // (D13: the column is the whole sidebar as it was; the margin beside the page card is kept as an ISLAND of the frame's picture inside it, from the sidebar's edge `--frame-e` to the margin's end `--frame-m`)
  const E = 'var\\(--frame-e\\)', M = 'var\\(--frame-m\\)';
  assert.match(pair[0][1], new RegExp(`clip-path:polygon\\(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,0 ${T},${Wd} ${T},${Wd} ${Bo},0 ${Bo},0 ${T},${E} ${T},${M} ${T},${M} ${Bo},${E} ${Bo},${E} ${T},0 ${T}\\);`));
  assert.ok(pair[0][1].startsWith('--frame-m:min(var(--frame-card-margin,0px),var(--frame-rail-width,0px));--frame-e:min(var(--frame-edge),var(--frame-m));'), 'never wider than the sidebar; never ahead of the margin\'s end');
  // the island's near side follows the arriving sidebar's edge on the sidebar's own clock and curve (and stands at the window's edge otherwise: the registered start)
  const slide = find(selector => selector === ':root[data-mode-switch=layout]::view-transition-new(acira-sidebar):only-child')[0][1].match(/^animation:(calc\(480ms \* var\(--motion-pace, 1\)\) linear\([^)]+\)) both acira-sidebar-arrive$/)![1];
  assert.ok(pair[0][1].endsWith(`;animation:${slide} both var(--frame-edge-in,none)`), 'the same duration and curve as the sidebar\'s slide');
  assert.ok(css.includes("@property --frame-edge{syntax:'<length>';inherits:false;initial-value:0px}"));
  assert.ok(css.includes('@keyframes frame-edge-in{from{--frame-edge:0px}to{--frame-edge:var(--frame-rail-width,0px)}}'), 'from the window\'s edge to the sidebar\'s resting edge');
  // the mirror, counted from the right edge
  const right = readFileSync(new URL('../src/styles/sidebar-right.css', import.meta.url), 'utf8');
  assert.ok(right.includes('100% calc(var(--frame-band-top, 0px) + var(--frame-corner, 16px)), calc(100% - var(--frame-e)) calc(var(--frame-band-top, 0px) + var(--frame-corner, 16px)), calc(100% - var(--frame-m)) calc(var(--frame-band-top, 0px) + var(--frame-corner, 16px)), calc(100% - var(--frame-m)) calc(100% - var(--frame-band-bottom, 0px) - var(--frame-corner, 16px)), calc(100% - var(--frame-e)) calc(100% - var(--frame-band-bottom, 0px) - var(--frame-corner, 16px)), calc(100% - var(--frame-e)) calc(var(--frame-band-top, 0px) + var(--frame-corner, 16px)), 100% calc(var(--frame-band-top, 0px) + var(--frame-corner, 16px))); }'));
});

test('every new rule stands only on live glass: a flat frame (window inactive, transparency off) and a floating sidebar keep the full-height veil they had', () => {
  for (const [selector] of rules.filter(([selector]) => /--frame-(band|rail)|isolation:isolate/.test(selector) || selector.includes('::view-transition-image-pair(root)'))) assert.ok(selector.includes('[data-desktop-material=ready]'), selector);
  const legacy = find(selector => selector.includes('>.ed-rail.is-expanded:not(.is-peek)') && !selector.includes('::') && !selector.includes(':has('));
  assert.equal(legacy.length, 2, 'the live rule and the flat-frame rule');
  const flat = legacy.find(([selector]) => selector.includes(':is([data-sidebar-overlay],:not([data-desktop-material=ready]))'));
  assert.ok(flat, 'the full-height veil still covers a floating sidebar and a frame with no live glass');
  assert.match(flat![1], /^background:linear-gradient\(180deg,rgb\(var\(--frame-top-rgb,var\(--sidebar-rgb,var\(--chrome-rgb\)\)\) \/ var\(--chrome-veil-top\)\),var\(--frame-mid-veil,\)rgb\(var\(--frame-bottom-rgb,var\(--sidebar-rgb,var\(--chrome-rgb\)\)\) \/ var\(--chrome-veil-bottom\)\)\)$/);   // 14.1: the field's variables, the same paint when unset
  assert.equal(css.includes(':root[data-mode-switch=layout][data-sidebar-overlay]:not([data-edge-float]) .app'), false, 'the old selector is gone');
});

// The bands' heights are the card's own (the toolbar is 36 px in Full and 32 in Compact and Focus; the card keeps 6 px below), read around the switch.
const g = globalThis as unknown as Record<string, unknown>;
type Box = { left: number; top: number; width: number; height: number; right: number; bottom: number };
const box = (left: number, top: number, width: number, height: number): Box => ({ left, top, width, height, right: left + width, bottom: top + height });
function stage(initial: { rail: number; card: Box; mini?: number }, side = '') {
  const values = new Map<string, string>(), dataset: Record<string, string> = side ? { sidebarSide: side } : {};
  let state = initial, finish!: () => void, ready!: () => void;
  const readyPromise = new Promise<void>(resolve => { ready = resolve; }), finished = new Promise<void>(resolve => { finish = resolve; });
  g.document = {
    documentElement: { dataset, hasAttribute: () => false, style: { setProperty: (key: string, value: string) => values.set(key, value), getPropertyValue: (key: string) => values.get(key) ?? '' } },
    visibilityState: 'visible',
    querySelector: (selector: string) => selector.includes('.ed-rail') ? (state.rail ? { getBoundingClientRect: () => box(0, 0, state.rail, 720) } : state.mini && !selector.includes('.is-expanded') ? { getBoundingClientRect: () => box(0, 0, state.mini!, 720) } : null) : selector.includes('.page-area') ? { getBoundingClientRect: () => state.card } : null,
    startViewTransition(update: () => void) { update(); return { ready: readyPromise, finished } as never; },
  };
  g.window = { innerHeight: 720, innerWidth: 1100, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) };
  g.matchMedia = () => ({ matches: false });
  return { values, dataset, set: (next: typeof initial) => { state = next; }, ready, finish };
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

test('D13: the frame without the sidebar says how far in the page card rests on the sidebar\'s side; the frame\'s picture keeps that margin through the switch, and follows the sidebar\'s edge when it arrives', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const inset = { rail: 0, card: box(6, 6, 1088, 688) };   // Sidebar + address with the sidebar away: the card rests 6 px in from the window's edges
  const closing = stage(docked);
  startModeTransition(() => closing.set(inset), 'layout');
  assert.equal(closing.values.get('--frame-card-margin'), '6px', 'closing: read from the frame the switch shows'); assert.equal(closing.values.get('--frame-rail-width'), '240px');
  assert.equal(closing.values.get('--frame-edge-in'), 'none', 'leaving: the margin is kept whole from the first frame');
  // D54 (D72 / D73): leaving, the page content's live picture is clipped at the sidebar's travelling edge (view-morph.css plays the keyframes this names)
  assert.equal(closing.values.get('--frame-edge-out'), 'frame-edge-out', 'leaving a frame that keeps no rail: the clip is on');
  assert.equal(closing.dataset.railSlide, 'out', 'and the mark CSS selects on (D54 (c): the bar\'s light stands still behind a window that travels with the sidebar\'s edge, ambient.css)');
  closing.ready(); closing.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  const docking = stage(inset);
  startModeTransition(() => docking.set(docked), 'layout');
  assert.equal(docking.values.get('--frame-card-margin'), '6px', 'docking: read from the frame the switch leaves'); assert.equal(docking.values.get('--frame-rail-width'), '240px');
  assert.equal(docking.values.get('--frame-edge-in'), 'frame-edge-in', 'arriving: the kept margin begins at the sidebar\'s edge, so the arrived sidebar never lies on the frame\'s veil');
  assert.equal(docking.values.get('--frame-edge-out'), 'none', 'arriving: no clip (the card\'s old picture follows the edge)');
  assert.equal(docking.dataset.railSlide, 'in', 'arriving: the mark says so');
  docking.ready(); docking.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  // in Sidebar + address (the root carries data-m-sbmode) the mark is never set: there the bar's light keeps its morphing group (the window cut the bar's light out on the right)
  for (const [from, to] of [[docked, inset], [inset, docked]] as const) {
    const sb = stage(from); sb.dataset.mSbmode = 'block';
    startModeTransition(() => sb.set(to), 'layout');
    assert.equal(sb.dataset.railSlide, undefined, 'no rail-slide mark in Sidebar + address');
    sb.ready(); sb.finish(); delete sb.dataset.mSbmode;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  const flush = stage(docked);
  startModeTransition(() => flush.set(away), 'layout');
  assert.equal(flush.values.get('--frame-card-margin'), '0px', 'a card that rests at the window\'s edge (the classic layout): nothing is kept, the column is the whole sidebar as before');
  assert.equal(flush.values.get('--frame-edge-out'), 'frame-edge-out', 'the classic layout\'s sidebar leaving: the page content is clipped at its edge all the same (D73 was measured there)');
  flush.ready(); flush.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  // a stale margin never outlives its switch: the sidebar docked in both frames (Full to Compact) keeps nothing
  const both = stage(docked); both.values.set('--frame-card-margin', '6px'); both.values.set('--frame-edge-in', 'frame-edge-in');
  startModeTransition(() => both.set({ rail: 240, card: box(240, 32, 854, 682) }), 'layout');
  assert.equal(both.values.get('--frame-card-margin'), '0px'); assert.equal(both.values.get('--frame-edge-in'), 'none');
  assert.equal(both.values.get('--frame-edge-out'), 'none', 'the sidebar docked in both frames: nothing leaves, nothing is clipped');
  assert.equal(both.dataset.railSlide, undefined, 'and no mark: the bar\'s light morphs with its group as before');
  both.ready(); both.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  // a Mini rail stands in its own column: the card's place beside it is not a margin
  const mini = stage({ rail: 0, mini: 48, card: box(54, 36, 1040, 678) });
  startModeTransition(() => mini.set(docked), 'layout');
  assert.equal(mini.values.get('--frame-card-margin'), '0px'); assert.equal(mini.values.get('--frame-edge-in'), 'none');
  mini.ready(); mini.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  // the sidebar on the right: the margin is counted from the window's right edge
  const right = stage(docked, 'right');
  startModeTransition(() => right.set({ rail: 0, card: box(6, 6, 1086, 688) }), 'layout');
  assert.equal(right.values.get('--frame-card-margin'), '8px', '1100 wide, the card ends at 1092');
  right.ready(); right.finish();
});

// D54 (D72 and D73, 19 Nov 2026, real frames of the docked sidebar hiding): the sidebar's whole column 11 to 13 levels darker than both its rests for the slide, with a step at the bar's foot. A website's
// content box stands at its final place from the first frame of the switch (group and picture have no animation), so when the sidebar leaves it is the whole width at once and its opaque fill lay under
// the sliding sidebar: the veil over a dark plate instead of the veil over the window's glass. Its picture is clipped at the sidebar's travelling edge.
test('D54: when a docked sidebar leaves, the page content\'s live picture is clipped at the sidebar\'s travelling edge, on the slide\'s own clock and curve, on either side', async () => {
  const css = readFileSync(new URL('../src/styles/view-morph.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(css.includes("@property --frame-clip{syntax:'<length>';inherits:false;initial-value:0px}"), 'the clip is a registered length: the main thread runs it (a clip-path animation went to the compositor, whose copy did not match)');
  assert.ok(css.includes('@keyframes frame-edge-out{from{--frame-clip:var(--frame-rail-width,0px)}to{--frame-clip:0px}}'), 'from the sidebar\'s width to nothing');
  assert.doesNotMatch(css, /@keyframes frame-edge-out[^{]*\{[^}]*clip-path/, 'no clip-path in the keyframes themselves');
  assert.ok(css.includes('@keyframes frame-edge-out-right{from{--frame-clip:var(--frame-rail-width,0px)}to{--frame-clip:0px}}'), 'the sidebar on the right: the same length, read from its own side');
  assert.ok(css.includes('html[data-sidebar-side=right]:root:root[data-mode-switch=layout]:has(.browser-body>.page-area>.page-content[data-native])::view-transition-image-pair(acira-page-content){clip-path:inset(0 var(--frame-clip) 0 0 round 8px)}'), 'on the right the clip is from the right');
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2].trim()] as const).filter(([selector]) => selector.includes('::view-transition-image-pair(acira-page-content)'));
  assert.equal(rule.length, 4, 'the website rule and its right-side reading, and the same two for a page that rises (the toolbar leaving: the fill clipped at the top on the page\'s curve)');
  assert.ok(rule[2][0].includes('[data-page-rise][data-page-plain]') && rule[3][0].includes('[data-page-rise][data-page-plain]'), 'the two others are the rise\'s only');
  assert.ok(rule[0][0].startsWith(':root:root[data-mode-switch=layout]:has(.browser-body>.page-area>.page-content[data-native])'), 'a website only: a page the interface draws follows the edge itself (sharedMotion followPage)');
  const slide = css.match(/::view-transition-old\(acira-sidebar\):only-child\{animation:(calc\(480ms \* var\(--motion-pace, 1\)\) linear\([^)]*\)) both acira-sidebar-leave\}/)?.[1];
  assert.ok(slide, 'the sidebar\'s own slide is there to compare with');
  assert.equal(rule[0][1], `animation:${slide} both var(--frame-edge-out,none);clip-path:inset(0 0 0 var(--frame-clip) round 8px)`, 'the same duration and curve as the sidebar\'s slide; nothing unless measureFrameBands names the keyframes');
  const rest = readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
  assert.ok(rest.includes(':root[data-mode-switch=layout]::view-transition-image-pair(acira-page-split){clip-path:inset(0 round 8px)}'), 'the rule at rest the keyframes end on');
  // the name is set for a sidebar that leaves a frame with no rail, per side, and never for the Mini rail
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const right = stage(docked, 'right');
  startModeTransition(() => right.set({ rail: 0, card: box(0, 36, 1088, 658) }), 'layout');
  assert.equal(right.values.get('--frame-edge-out'), 'frame-edge-out-right');
  right.ready(); right.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
  const toMini = stage(docked);
  startModeTransition(() => toMini.set({ rail: 0, mini: 56, card: box(56, 36, 1032, 658) }), 'layout');
  assert.equal(toMini.values.get('--frame-edge-out'), 'none', 'collapsing to the Mini rail: the rail stands in the column, nothing is clipped');
  assert.equal(toMini.dataset.railSlide, undefined, 'no mark for the collapse to the Mini rail');
  toMini.ready(); toMini.finish();
  await new Promise(resolve => setTimeout(resolve, 0));
});

// D54 (c): beside a sidebar that leaves or arrives the bar's light is two pictures standing still, seen through a window that travels with the sidebar's edge by a bare transform (the compositor draws
// its edge with the same partial coverage as the sidebar's). Before, the morphing group was laid out on whole pixels: one device pixel 31 levels lighter travelled with the edge, and the squeezed picture
// carried the corner's light sideways.
test('D54 (c): with the mark, the bar\'s light group stands still, its image pair is the travelling window, and each picture is its own size and slides back by as much', () => {
  const css = readFileSync(new URL('../src/styles/ambient.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const R = 'var(--frame-rail-width, 0px)', S = ':root[data-mode-switch=layout][data-rail-slide';
  assert.ok(css.includes(`${S}]::view-transition-group(acira-amb-top) { animation: none; }`));
  assert.ok(css.includes(`@keyframes amb-rail-with { to { transform: translateX(calc(var(--sf-dir, -1) * ${R})); } }`), 'the way the sidebar leaves: a bare transform');
  assert.ok(css.includes(`@keyframes amb-rail-against { to { transform: translateX(calc(-1 * var(--sf-dir, -1) * ${R})); } }`), 'and back by as much');
  assert.ok(css.includes("@property --amb-w { syntax: '<number>'; inherits: false; initial-value: 1; }"), 'the weight is a registered number: only a weight runs on the main thread, never a place');
  // leaving: the window starts at the sidebar's edge and goes with it; the whole bar's picture starts a sidebar's width back and is whole in the sidebar's column
  assert.ok(css.includes(`${S}=out]::view-transition-image-pair(acira-amb-top) { inset: 0 calc(-1 * ${R}) 0 calc(${R} - 10px); animation-name: amb-rail-with; }`));
  assert.ok(css.includes(`${S}=out]::view-transition-old(acira-amb-top) { left: 10px; opacity: 1; animation-name: amb-rail-against, amb-weigh-out; -webkit-mask-image: linear-gradient(rgb(0 0 0 / var(--amb-w)) 0 0); }`), 'the old picture is weighed on the same clock as the new one (no compositor fade beside a main-thread weight)');
  assert.ok(css.includes(`${S}=out]::view-transition-new(acira-amb-top) { left: calc(10px - ${R}); opacity: 1; animation-name: amb-rail-against, amb-weigh-in; -webkit-mask-image: linear-gradient(to right, #000 ${R}, rgb(0 0 0 / var(--amb-w)) ${R}); }`));
  // arriving: the mirror in time
  assert.ok(css.includes(`${S}=in]::view-transition-image-pair(acira-amb-top) { inset: 0 0 0 calc(-1 * ${R} - 10px); animation-name: amb-rail-against; }`));
  assert.ok(css.includes(`${S}=in]::view-transition-old(acira-amb-top) { left: 10px; opacity: 1; animation-name: amb-rail-with, amb-weigh-out; -webkit-mask-image: linear-gradient(to right, #000 ${R}, rgb(0 0 0 / var(--amb-w)) ${R}); }`));
  assert.ok(css.includes(`${S}=in]::view-transition-new(acira-amb-top) { left: calc(${R} + 10px); opacity: 1; animation-name: amb-weigh-in, amb-rail-with; -webkit-mask-image: linear-gradient(rgb(0 0 0 / var(--amb-w)) 0 0); }`), 'the new picture is weighed on the same clock as the old one');
  assert.doesNotMatch(css, /data-rail-slide=(?:in|out)\]::view-transition-(?:old|new)\(acira-amb-top\) \{[^}]*-ua-view-transition-fade/, 'no compositor fade on either picture of a rail slide: the two weights share one clock');
  // the sidebar on the right: the window and the pictures on the other side, the weighted zone from the other end
  for (const way of ['out', 'in']) assert.ok(css.includes(`html[data-sidebar-side=right]${S}=${way}]::view-transition-image-pair(acira-amb-top)`), way);
  assert.ok(css.includes(`linear-gradient(to left, #000 ${R}, rgb(0 0 0 / var(--amb-w)) ${R})`));
  // arriving, the sidebar's own light does not grow its reach over the slide: whole from the first frame, as in an edge reveal
  assert.ok(css.includes(':root[data-ambient-light][data-mode-switch=layout][data-rail-slide=in] .st-amb-side[data-arrive] { animation: none; }'));
  // the two pictures add where both exist (the browser's own cross-fade says so by an animation name, which these rules replace); no scale on them (it would scale the animated translation too):
  // the layer itself reaches 4 px past the window's far edge during the switch
  assert.ok(css.includes('object-position: left top; mix-blend-mode: plus-lighter; animation-duration')); assert.ok(!/scale: 1\.003/.test(css));
  assert.ok(css.includes('.st-amb-top { inset: 0 -4px -1px 0; }') && css.includes('html[data-sidebar-side=right] .st-amb-top { inset: 0 0 -1px -4px; }'), 'always, so the light\'s own measure takes the 4 px in');
  // leaving by a rail slide, the sidebar's light picture slides out whole: no clip beside the slide (a page the interface draws keeps it)
  assert.ok(css.includes(':root:root[data-mode-switch=layout][data-rail-slide=out]:not([data-page-follow])::view-transition-old(acira-amb-side):only-child { animation-name: acira-sidebar-leave; }'));
  assert.ok(css.includes(':root:root[data-mode-switch=layout][data-rail-slide=out][data-sidebar-side=right]:not([data-page-follow])::view-transition-old(acira-amb-side):only-child { animation-name: acira-sidebar-leave-right; }')); assert.ok(css.includes(`${S}]::view-transition-image-pair(acira-amb-top) { isolation: isolate;`));
  // the two lights cross over 10 px at the travelling edge: the window's first 10 px are on the bend, the sidebar's light gives them up inside the bar's height
  assert.ok(css.includes('transparent 0, rgb(0 0 0 / var(--amb-e1, .25)) 2.5px, rgb(0 0 0 / var(--amb-e2, .5)) 5px, rgb(0 0 0 / var(--amb-e3, .75)) 7.5px, #000 10px), linear-gradient(#000 0 0); -webkit-mask-size: 10px 100%, calc(100% - 10px) 100%;'));
  assert.ok(css.includes(`${S}]::view-transition-old(acira-amb-side), ${S}]::view-transition-new(acira-amb-side) { -webkit-mask-image: linear-gradient(to left, transparent 0, #000 10px), linear-gradient(#000 0 0); -webkit-mask-size: 100% var(--amb-foot, 36px), 100% calc(100% - var(--amb-foot, 36px));`));
  // the window shares the sidebar's clock and curve
  const slide = readFileSync(new URL('../src/styles/view-morph.css', import.meta.url), 'utf8').match(/::view-transition-old\(acira-sidebar\):only-child\{animation:calc\(480ms \* var\(--motion-pace, 1\)\) (linear\([^)]*\)) both acira-sidebar-leave\}/)?.[1] ?? 'none';
  const pair = css.split(`${S}]::view-transition-image-pair(acira-amb-top) {`)[1]?.split('}')[0] ?? '';
  assert.ok(pair.includes('animation-duration: calc(480ms * var(--motion-pace, 1));') && pair.replace(/\s/g, '').includes(slide.replace(/\s/g, '')), 'the window: the sidebar\'s 480 ms and its curve');
});
