// R4-54 (founder: "in Seamless, in Settings, I can't get the sidebar to open"): the edge float works on every page kind. Main's controller
// (desktop/edge-reveal.cjs) never looks at the page, so a reveal it decides must float the same way whatever is on screen: a website
// or a split (native views under holes, main raises the interface, clicks go on to the pane under the pointer), or a page the
// interface draws itself (Settings, History, the new tab page...: no holes, no raise, the page takes its own clicks and a press
// on it sends the sidebar away). A tiny DOM stub stands in for the interface.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

type Rect = { left: number; top: number; width: number; height: number; right: number; bottom: number };
const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height, right: left + width, bottom: top + height });
const sent: Record<string, unknown>[] = [];
let listener: ((event: unknown) => void) | null = null;
const handlers = new Map<string, (event: Event) => void>();
let areaRect = rect(6, 6, 1268, 808);
const style = () => {const values=new Map<string,string>();return {setProperty:(key:string,value:string)=>values.set(key,value),removeProperty:(key:string)=>values.delete(key),getPropertyValue:(key:string)=>values.get(key)||''};};
let panes: { rect: Rect; tabId: string; label: number; el?: { dataset: Record<string, string>; style: ReturnType<typeof style> } }[] = [];
const root = { dataset: {} as Record<string, string>, style: style() };
const app = { style: style(), querySelector: () => null };
const g = globalThis as Record<string, unknown>;
// The fixture's tab IDs are CSS identifiers; browsers provide CSS.escape natively.
g.CSS = {escape:(value:string)=>value};
g.window = Object.assign(globalThis, {
  innerWidth: 1280, innerHeight: 820,
  acira: { browserCommand: (command: Record<string, unknown>) => { sent.push(command); return Promise.resolve(); }, subscribeBrowser: (fn: (event: unknown) => void) => { listener = fn; return () => {}; } },
});
g.addEventListener = (name: string, fn: (event: Event) => void) => { handlers.set(name, fn); };
g.removeEventListener = () => {};
g.matchMedia = () => ({ matches: true });   // Off: the change applies at once, no view transition to stub
g.requestAnimationFrame = (fn: () => void) => { queueMicrotask(fn); return 0; };
g.getComputedStyle = () => ({ backgroundImage: 'none', backgroundSize: 'auto', backgroundPosition: '0 0', backgroundRepeat: 'repeat', backgroundColor: 'rgb(0,0,0)' });
g.document = {
  documentElement: root,
  querySelector: (selector: string) => selector === '.app' ? app : selector === '.page-area' ? { getBoundingClientRect: () => areaRect } : null,
  querySelectorAll: (selector: string) => selector.includes('.page-pane') ? panes.map(p => { p.el ??= { dataset: { pane: p.tabId }, style: style() }; return Object.assign(p.el, { getBoundingClientRect: () => p.rect, querySelector: () => ({ offsetHeight: p.label }) }); }) : [],
};

const require = createRequire(import.meta.url);
const edge = require('../src/ui/chromeEdge.ts') as typeof import('../src/ui/chromeEdge');
edge.installChromeEdge(); edge.bindEdgeTab('active');
const paint = async () => {for(let frame=0;frame<8;frame++)await Promise.resolve();};
const say = async (side: boolean, top = false) => {listener?.({ type: 'chrome-edge', side, top, pinned: { side: false, top: false } });await paint();};
const press = (x: number, y: number, target: { closest: (selector?: string) => unknown } = { closest: () => null }) => { let prevented = false; handlers.get('pointerdown')?.({ type: 'pointerdown', clientX: x, clientY: y, button: 0, target, preventDefault() { prevented = true; }, stopPropagation() {} } as unknown as Event); return prevented; };
// Even reduced-motion native floats retain their stacking for a 60ms handoff.
const reset = async () => { await say(false); await new Promise(resolve=>setTimeout(resolve,75)); sent.length = 0; };

const kinds: { name: string; native: boolean; split?: boolean }[] = [
  { name: 'a website', native: true }, { name: 'Settings', native: false }, { name: 'History', native: false }, { name: 'Bookmarks', native: false },
  { name: 'Downloads', native: false }, { name: 'Rewind', native: false }, { name: 'the new tab page', native: false }, { name: 'a split', native: true, split: true },
];
for (const kind of kinds) {
  test(`Seamless: the left edge floats the sidebar on ${kind.name}`, async () => {
    panes = kind.split ? [{ rect: rect(6, 6, 630, 808), tabId: 'left', label: 26 }, { rect: rect(644, 6, 630, 808), tabId: 'right', label: 26 }] : [];
    edge.setEdgeFloatable(true, kind.native); await reset();
    await say(true);
    assert.equal(edge.currentEdge().side, true, 'the sidebar shows');
    assert.equal(edge.isEdgeFloating(), true, 'it floats (the page keeps its place: no reflow)');
    const info = edge.edgeFloatInfo();
    assert.equal(info.kind, kind.native ? 'native' : 'dom');
    assert.equal(root.dataset.edgeFloat, info.kind);
    assert.equal(sent.some(c => c.float === true), kind.native, kind.native ? 'main raises the interface over the native page' : 'nothing to raise: the interface is the page');
    if (kind.split) assert.deepEqual(info.holes.map(h => [h.tabId, h.y, h.h]), [['left', 32, 782], ['right', 32, 782]], 'one hole per pane, under its title');
    // A press on the page sends the sidebar away; a native page gets the click, the interface's own page keeps it.
    const prevented = press(kind.split ? 900 : 700, 400);
    assert.equal(prevented, kind.native, kind.native ? 'forwarded to the native page' : 'the interface page takes its own click');
    assert.ok(sent.some(c => c.dismiss === 'side'), 'the press hides the sidebar');
    const forward = sent.find(c => c.forward)?.forward as Record<string, unknown> | undefined;
    if (kind.native) assert.ok(forward && forward.type === 'mouseDown');
    if (kind.split) assert.equal(forward?.tabId, 'right', 'the click goes to the pane under the pointer');
    if (kind.split) assert.equal(forward?.y, 400 - 32);
    await reset();
  });
}

// A split's panes keep their resting place under a floating sidebar (the page area is the window onto them), so the card's edge, its corner pieces and the clip travel
// were measured at the panes' own left (6) instead of the sidebar's edge: the card's corners stood square at the sidebar and its pieces sat beneath it.
test('Seamless split: beside the floating sidebar the card is cut where the sidebar meets it, as a single page is', async () => {
  const mask = () => /d='([^']*)'/.exec(decodeURIComponent(app.style.getPropertyValue('--sf-corner-mask')))?.[1] ?? 'none';
  panes = [{ rect: rect(6, 6, 630, 808), tabId: 'left', label: 26 }, { rect: rect(644, 6, 630, 808), tabId: 'right', label: 26 }];
  areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, true); await reset();
  await say(true);
  assert.equal(app.style.getPropertyValue('--sf-corner-x'), '6px', 'at rest the card starts at its own left edge');
  // The sidebar's layout arrives: the area is the card beside it (246), the panes have not moved.
  areaRect = rect(246, 6, 1028, 808); edge.refreshEdgeFloat();
  assert.equal(app.style.getPropertyValue('--sf-corner-x'), '246px', 'the corner pieces stand at the sidebar edge, not under it');
  assert.equal(mask(), '', 'a title strip over the top: the frame tint is already there, no piece doubles it');
  // The toolbar shows too: the area starts under it, the strip is covered, and the corner piece stands at the card's top as on a single page.
  areaRect = rect(246, 40, 1028, 774); edge.refreshEdgeFloat();
  assert.match(mask(), /^M0 40H8A8 8 0 0 0 0 48Z$/, 'the top piece is at the card\'s top under the bar');
  areaRect = rect(6, 6, 1268, 808); await reset();
});

// Stacked panes (rows, two over one) met the floating sidebar differently from a single page or columns: the frame's tint stood in the strip and the gap between two panes under the
// sidebar, which already tints that column itself (a dark stripe across the sidebar, 26 against 41 in dark); the corners between two panes stayed square, and the upper one's bottom corner
// got a piece over the split's ground (a dark wedge).
test('Seamless split: stacked panes leave the sidebar column untinted by the frame, cut each pane round at its edge, and give only the card\'s bottom corner a piece', async () => {
  const decoded = (name: string) => decodeURIComponent(app.style.getPropertyValue(name));
  panes = [{ rect: rect(6, 6, 1268, 380), tabId: 'top', label: 26 }, { rect: rect(7, 392, 1267, 422), tabId: 'bottom', label: 26 }];
  areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, false, true); await reset();
  await say(true);
  areaRect = rect(246, 6, 1028, 808); edge.refreshEdgeFloat();
  const veil = decoded('--sf-mask');
  assert.ok(veil.includes('M0 32H246V814H0Z'), 'the frame\'s tint is cut out of the sidebar\'s whole column, from the first pane\'s top to the last pane\'s bottom');
  assert.ok(veil.includes('M246 32H') && veil.includes('M246 418H'), 'each pane\'s cut-out starts at the sidebar\'s edge with square corners, beside the column\'s');
  assert.ok(!veil.includes('M0 32H') || veil.indexOf('M0 32H') === veil.indexOf('M0 32H246V814H0Z'), 'no cut-out reaches back under the sidebar on its own (it would be cancelled where it overlaps the column)');
  assert.deepEqual(panes.map(p => [p.el?.style.getPropertyValue('--sf-pane-cover'), 'sfCover' in (p.el?.dataset ?? {})]), [['240px', true], ['239px', true]], 'each pane is cut where the sidebar covers it');
  assert.match(decoded('--sf-corner-mask-low'), /d='M0 814V806A8 8 0 0 0 8 814Z'/, 'only the card\'s bottom corner has a piece; the upper pane\'s corner shows the split\'s ground');
  // Columns are one run from the top to the bottom: the column and the panes' cut-outs are the same span as before.
  panes = [{ rect: rect(6, 6, 630, 808), tabId: 'left', label: 26 }, { rect: rect(644, 6, 630, 808), tabId: 'right', label: 26 }];
  edge.refreshEdgeFloat();
  assert.ok(decoded('--sf-mask').includes('M0 32H246V814H0Z'));
  assert.equal(panes[1].el?.style.getPropertyValue('--sf-pane-cover'), '', 'a pane the sidebar does not reach is not cut');
  assert.equal('sfCover' in (panes[1].el?.dataset ?? {}), false);
  areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, true, false); await reset();
});

// A split opening (or closing) around the same tab while the sidebar floats must picture the new panes: the one page's picture stood over the whole split.
test('Seamless split: a split opening or closing around the same tab is pictured again while the sidebar floats', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../src/ui/chromeEdge.ts', import.meta.url), 'utf8');
  assert.match(source, /const changed = id !== activeTab \|\| split !== activeSplit; activeTab = id; activeSplit = split;/);
});

test('Seamless: a press on the floating sidebar itself is never sent to the page', async () => {
  edge.setEdgeFloatable(true, true); await reset(); await say(true);
  const prevented = press(100, 300, { closest: () => ({}) });
  assert.equal(prevented, false); assert.ok(!sent.some(c => c.forward || c.dismiss));
  await reset();
});

test('changing between a website and Settings retains the sidebar under the pointer', async () => {
  edge.setEdgeFloatable(true, true); await reset(); await say(true);
  assert.equal(edge.edgeFloatInfo().kind, 'native');
  edge.setEdgeFloatable(true, false);
  assert.equal(edge.isEdgeFloating(), true);
  assert.equal(edge.edgeFloatInfo().kind, 'dom');
  assert.ok(!sent.some(c => c.float === false), 'switching page kinds retains native stacking to avoid a flash');
  edge.setEdgeFloatable(true, true);
  assert.equal(edge.isEdgeFloating(), true);
  assert.equal(edge.edgeFloatInfo().kind, 'native');
  await reset();
});

test('Seamless: the toolbar floats on an interface page too (a key or the top edge), so the page under it never moves', async () => {
  edge.setEdgeFloatable(true, false); await reset();
  await say(false, true);
  assert.equal(edge.isEdgeFloating(), true);
  assert.equal(root.dataset.edgeFloat, 'dom');
  await reset();
});

test('Seamless (R4-59): a reveal or hide moves the toolbar as one layer; no control keeps a view-transition name of its own', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/styles/seamless.css', import.meta.url), 'utf8');
  // Seamless's shown toolbar (and the sidebar) move as one layer; Compact / Full keep their controls' own names so they glide (view-morph.css).
  assert.match(css, /\[data-mode-switch='edge'\]:not\(\[data-edge-toolbar='stays'\]\) \.app\.style-acira :is\(\.browser-shell\[data-seamless\], \.ed-rail\.acira-sidebar\) \* \{ view-transition-name: none !important; \}/);
  assert.match(css, /\[data-mode-switch='edge'\]\[data-edge-toolbar='slab'\]:not\(\[data-fr-finale\]\) \.app\.style-acira:not\(:has\(>\.setup-dialog\)\) \.browser-shell\[data-seamless='shown'\] \{ view-transition-name: acira-edge-shell; \}/);
  // A toolbar that stays shown while only the sidebar moves glides like Compact's: its controls and the toolbar keep their names, and the sidebar button is named too.
  assert.match(css, /\[data-edge-toolbar='stays'\]:not\(\[data-fr-finale\]\)[^{]*\.browser-shell\[data-seamless='shown'\]>\.browser-toolbar\.acira-persistent-toolbar \{ view-transition-name:acira-toolbar!important; \}/);
  assert.match(css, /\[data-edge-toolbar='stays'\] \.app\.style-acira \.ed-rail\.acira-sidebar \* \{ view-transition-name: none !important; \}/);
  // The page's corners stay round while the top bar moves its edge, and at rest beside the sidebar (sidebar-overlay.css).
  const overlay = readFileSync(new URL('../src/styles/sidebar-overlay.css', import.meta.url), 'utf8');
  assert.match(overlay, /clip-path:inset\(var\(--desktop-top-now,0px\) round\(var\(--desktop-band-right\)/);
  assert.match(overlay, /@keyframes desktop-page-band \{ from \{[^}]*\} to \{[^}]*--desktop-top-now:var\(--desktop-clip-top-to,0px\)/);
  // ...and never in the hold, whose translate must stay on the compositor beside the group's (a main-thread hold made the whole page jump at the first frame).
  const hold = /@keyframes desktop-page-hold \{ from \{[^}]*\} to \{[^}]*\} \}/.exec(overlay)?.[0] ?? '';
  assert.ok(hold.includes('translate:'), 'the hold keyframes exist');
  assert.ok(!hold.includes('--desktop-top-now'), 'the hold animates only its translate');
  assert.match(overlay, /\.page-area>\.page-content \{ clip-path:inset\(0 0 0 var\(--sf-sidebar-travel,0px\) round var\(--geometry-pageRadius,8px\) 0 0 var\(--geometry-pageRadius,8px\)\); \}/);
  // The page's top corner at the sidebar's edge rides the moving top edge while the bar arrives or leaves with the sidebar staying (a fill left off, or drawn at its final place, was bare glass or a grey patch).
  assert.match(overlay, /\[data-edge-top='in'\]::view-transition-new\(acira-sidebar-corners\) \{ animation:var\(--edge-ms\) var\(--edge-ease-px,var\(--edge-ease\)\) both edge-corner-lift-in;/);
  assert.match(overlay, /\[data-edge-top='out'\]::view-transition-old\(acira-sidebar-corners\) \{ animation:var\(--edge-ms\) var\(--edge-ease-px,var\(--edge-ease\)\) both edge-corner-lift-out;/);
  assert.match(overlay, /::view-transition-image-pair\(acira-sidebar-corners\) \{ clip-path:inset\(var\(--sf-hole-top,0px\) 0 0 0\); \}/);
  assert.doesNotMatch(overlay, /acira-sidebar-corners\):not\(:only-child\)/, 'a transition layer never matches :not(:only-child)');
  // The sidebar out first, then the top bar (and the bar leaving again): the sidebar's two pictures are not crossfaded, or the band under the bar was tinted twice (a dark slab over its top, then a pop).
  // Only the picture taken with the bar standing is drawn: the new one for an arriving bar, the old one for a leaving one.
  assert.match(overlay, /\[data-edge-top='in'\]::view-transition-old\(acira-sidebar\),\s*:root\[data-mode-switch='edge'\]\[data-edge-top='out'\]::view-transition-new\(acira-sidebar\) \{ animation:none; opacity:0; \}/);
  assert.match(overlay, /\[data-edge-top='in'\]::view-transition-new\(acira-sidebar\),\s*:root\[data-mode-switch='edge'\]\[data-edge-top='out'\]::view-transition-old\(acira-sidebar\) \{ animation:none; opacity:1; mix-blend-mode:normal; \}/);
  // ...and the card's frame line does not travel in from the sidebar's width away when the sidebar is not the one moving.
  const edgeSource = readFileSync(new URL('../src/ui/chromeEdge.ts', import.meta.url), 'utf8');
  assert.match(edgeSource, /stays = root\.dataset\.edgeTop === 'in' \|\| root\.dataset\.edgeTop === 'out', arriving = !stays && !leaving/);
  assert.match(edgeSource, /'--sf-rim-shift-to', arriving \|\| stays \? '0px' : away/);
  // A sidebar pinned first, the top bar floated in after: the travel an earlier reveal left would cut 234px off the page's left edge (bare glass in the gap), and the frame's veil, whose
  // hole began at the page beside the sidebar, covered the pinned column under the sidebar's own copy (a darker column below the bar).
  assert.match(edgeSource, /if \(edge\.pinned\.side\) root\.style\.setProperty\('--sf-sidebar-travel', '0px'\);/);
  // (`pr` is the page's rect on the side the sidebar is on: the mirror image of the window for a sidebar on the right, see paintPageHoles.)
  assert.match(edgeSource, /under = \(h: Hole\) => snapPx\(pr!\.left\) < h\.x \|\| \(edge\.pinned\.side && h\.x > 0\)/);
  // A sidebar leaving (Compact, Focus or Seamless): the card line's stroke up the sidebar's edge is dropped before the old picture is taken. Its picture is held still while only the clip follows the
  // sidebar, so it stood at the old edge as a second page card (a hairline and a rounded corner through the text) beside the real edge sliding away.
  assert.match(edgeSource, /if \(shownBefore\.side && !shownAfter\.side\) dropRimEdge\(\);\n  const ms = startEdgeTransition\(/);
  assert.match(edgeSource, /function dropRimEdge\(\): void \{\n  for \(const path of document\.querySelectorAll\('\.sidebar-page-rim \.rim-edge'\)\) path\.setAttribute\('d', ''\);/);
  // The stroke up the sidebar's edge is its own path (.rim-edge, since 7 Nov): emptying it leaves the line's own path, the run, as the split on 'M' did (tests/sidebar-rim-edge-wait.test.ts).
  // The address field and Compact's tab strip glide by their left edge alone in an edge switch (their width animation cannot run on the compositor and made them start a frame late).
  assert.match(css, /::view-transition-group\(acira-address\) \{ animation-name: edge-glide-address;/);
  assert.match(css, /::view-transition-group\(acira-mini-tabs\) \{ animation-name: edge-glide-tabs;/);
  assert.match(css, /@keyframes edge-glide-address \{ from \{ translate: var\(--edge-address-dx, 0px\) 0; \} \}/);
  // The sidebar button is a named control like the others (every view, edge and layout switch), so it glides instead of sliding over the reload button.
  const morph = readFileSync(new URL('../src/styles/view-morph.css', import.meta.url), 'utf8');
  assert.match(morph, /\.sidebar-toggle-control[^{]*\{view-transition-name:acira-sidebar-toggle\}/);
  assert.match(morph, /\.sidebar-toggle-control[^{]*\{view-transition-class:acira-control\}/);
  assert.match(css, /::view-transition-old\(acira-edge-shell\):only-child \{[^}]*animation: edge-lift/);
  assert.match(css, /::view-transition-new\(acira-edge-shell\):only-child \{ animation: edge-drop/);
});

// qa-windows audit: leaving Seamless sent a wrong intermediate page layout (the page jumped 5px up over the toolbar row, or held at the card's rest rect for a
// while), and entering it snapped the page to the card where the spec (SEAMLESS_MODE_SPEC §12, mode switches) has it grow on the `slide` page motion.
test('Seamless: a view switch sends the docked layout at once on the way out and glides the page on the way in', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  // Out: the toolbar's float lingers until its hide has played, so outside Seamless only the sidebar's own peek counts as floating (it held the page at y=6, x=6).
  assert.match(app, /const sideFloating = \(\) => isEdgeFloating\(\) && \(seamless \|\| edge\.side\);/);
  assert.match(app, /const floatSide = sideFloating\(\) \|\|/);
  assert.doesNotMatch(app, /const floatSide = isEdgeFloating\(\)/);
  // Out: the first send of the switch is skipped while the header has not started to grow (the measured follow sends the real ones).
  assert.match(app, /if \(!topSeam && lastPageBounds\.current && lastPageBounds\.current\.y <= 8 && headerNode && Math\.abs\(headerNode\.getBoundingClientRect\(\)\.height - headerHeight\) > 1\) return;/);
  // In: the switch notes its entry, and the layout that follows carries the hide spring (a sidebar leaving with it keeps its own curve).
  assert.match(app, /if \(topSeam && !wasSeamless\.current\) noteSeamlessEntry\(\)/);
  assert.match(app, /entering = spring \? null : seamlessEntrySpring\(\)/);
  assert.match(app, /entering && !slide \? \{ pageSpring: entering \}/);
  const chrome = readFileSync(new URL('../src/ui/chromeEdge.ts', import.meta.url), 'utf8');
  assert.match(chrome, /const spec = springFor\('seamless\.hide', motionSpeed\(\)\);\s+entry = spec \? \{ duration: spec\.duration, bounce: spec\.bounce, until: performance\.now\(\) \+ 400 \} : null;/);
  assert.equal(edge.seamlessEntrySpring(), null, 'no entry, no spring');
  edge.noteSeamlessEntry();
  assert.equal(edge.seamlessEntrySpring(), null, 'with motion off (no document here) the page is placed at once, as before');
});

// Animation speed None (Reduce motion: the harness above runs with matchMedia matching): a reveal and a hide are cuts. No view transition, and no fade either
// (Off used to fade what appeared in over 80ms; the founder, 6 Nov: None is no animation at all).
test('None: the edge reveals and hides at once, with no view transition and no fade', async () => {
  edge.setEdgeFloatable(true, true); await reset();
  const seen = new Set<string>();
  const watch = () => { for (const key of Object.keys(root.dataset)) seen.add(key); };
  await say(true); watch();
  assert.equal(edge.currentEdge().side, true, 'the sidebar is there as soon as main says so');
  await say(false); watch();
  assert.equal(edge.currentEdge().side, false, 'and gone as soon as main says so');
  await say(false, true); watch();
  assert.equal(edge.currentEdge().top, true, 'the toolbar the same');
  await say(false); watch();
  assert.equal(seen.has('edgeFade'), false, 'no fade attribute');
  assert.equal(seen.has('modeSwitch'), false, 'no view transition');
  assert.equal(root.style.getPropertyValue('--edge-ms'), '', 'no edge duration was set');
  assert.equal(root.style.getPropertyValue('--edge-fade-ms'), '');
  await reset();
});
