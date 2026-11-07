// Founder, 7 Nov 2026: Sidebar mode with the sidebar away, hovering the left edge. Three things were wrong on the slide, measured on the real window:
//  1. The block (Back, Reload, Forward, the sidebar button, the address field with its star) did not ride with the sidebar. Each control carried its own view-transition name and glided
//     from where the HIDDEN toolbar had it (across the page) while it faded in or out: up to 190 px of it hung over the page on the way in and 520 px on the way out.
//  2. The sidebar's content was laid out 80 px too high and settled down over 450 ms (the block publishes data-addr-side a commit after the sidebar mounts, and the padding is a transition):
//     the favorites and the tab list passed through the address field for about 230 ms.
//  3. The field's text was dim until the slide ended (the controls' pictures faded 0 -> 1, under the sidebar's picture).
// The block is one layer for the slide now, slid in and out with the sidebar on its curve and its distance, and the sidebar arrives with its padding already at 80. Seamless has no data-sbmode and
// keeps every rule it had. This file pins the rules (the geometry itself is measured on the real window, see the pictures).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const blockCss = strip(read('../src/styles/address-in-sidebar.css'));
const seamlessCss = strip(read('../src/styles/seamless.css'));
const sidebarCss = strip(read('../src/components/sidebar/sidebar.css'));
const rules = (text: string): { selector: string; body: string }[] => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].replace(/\s+/g, ' ').trim(), body: match[2].replace(/\s+/g, ' ').trim() }));
const find = (list: { selector: string; body: string }[], ...needles: string[]) => list.filter(rule => needles.every(needle => rule.selector.includes(needle)));
const block = rules(blockCss), seamless = rules(seamlessCss);
const decl = (body: string, property: string) => new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+)`).exec(body)?.[1].trim();

// A small specificity: ids, then classes / attributes / pseudo-classes, then types; :where() counts nothing, :is / :not / :has count their most specific argument.
function specificity(selector: string): [number, number, number] {
  let work = selector;
  let total: [number, number, number] = [0, 0, 0];
  const add = (spec: [number, number, number]) => { total = [total[0] + spec[0], total[1] + spec[1], total[2] + spec[2]]; };
  const group = (name: string) => {
    for (;;) {
      const at = work.indexOf(`:${name}(`);
      if (at < 0) return;
      let depth = 0, end = at + name.length + 1;
      for (; end < work.length; end++) { if (work[end] === '(') depth++; if (work[end] === ')' && --depth === 0) break; }
      const inner = work.slice(at + name.length + 2, end);
      if (name !== 'where') { const best = inner.split(/,(?![^(]*\))/).map(part => specificity(part)).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]).pop()!; add(best); }
      work = work.slice(0, at) + work.slice(end + 1);
    }
  };
  for (const name of ['where', 'is', 'not', 'has']) group(name);
  work = work.replace(/::[\w-]+(\([^)]*\))?/g, () => { add([0, 0, 1]); return ' '; });
  add([0, (work.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length, 0]);
  work = work.replace(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g, ' ');
  add([0, 0, (work.match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length]);
  return total;
}
const outranks = (a: string, b: string) => { const x = specificity(a), y = specificity(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

test('the specificity helper agrees with the cases this file relies on', () => {
  assert.deepEqual(specificity('.a .b'), [0, 2, 0]);
  assert.deepEqual(specificity(':root:root:root .app.style-acira .ed-rail.acira-sidebar[data-addr-side]'), [0, 8, 0]);
  assert.deepEqual(specificity(':root:root:root .app.style-acira:where(:has(> .browser-root > .browser-shell[data-sbmode=\'block\'])) > .ed-rail.acira-sidebar'), [0, 7, 0]);
  assert.deepEqual(specificity(':root:root[data-mode-switch=\'edge\']::view-transition-new(acira-toolbar)'), [0, 3, 1]);
});

test('the sidebar arrives with the room for the block already in its padding (no 0 -> 80 transition under the block)', () => {
  const fallback = find(block, ':where(:has(> .browser-root > .browser-shell[data-sbmode=\'block\']))', '.ed-rail.acira-sidebar');
  assert.equal(fallback.length, 1);
  assert.equal(decl(fallback[0].body, 'padding-top'), '80px');
  assert.equal(decl(fallback[0].body, 'transition'), undefined, 'the fallback never starts a transition of its own');
  const attribute = find(block, '.ed-rail.acira-sidebar[data-addr-side]').filter(rule => !rule.selector.includes('data-addr-open') && rule.body.includes('padding-top: 80px'));
  const open = find(block, '.ed-rail.acira-sidebar[data-addr-side][data-addr-open]');
  assert.equal(attribute.length, 1);
  assert.equal(open.length, 1);
  assert.equal(decl(open[0].body, 'padding-top'), '108px');
  // the open row (108) and the attribute rule (80) are never outranked by the fallback
  assert.ok(outranks(open[0].selector, fallback[0].selector) > 0, 'data-addr-open still wins');
  assert.ok(outranks(attribute[0].selector, fallback[0].selector) > 0, 'the attribute rule still wins');
});

test('the block\'s own marker is on the header in the same render as the sidebar (the fallback depends on it)', () => {
  const app = read('../src/App.tsx');
  assert.ok(app.includes('data-sbmode={sbHeader}'));
  assert.ok(app.includes('sbHeader = sidebarModeHeader(sbChrome, addrBlock)'), 'the marker comes from the same addrBlock the toolbar is drawn from, not from the store the block publishes later');
});

const scoped = (selector: string) => selector.includes('[data-mode-switch=\'edge\']') && selector.includes(':has(.browser-shell[data-sbmode');
const mine = block.filter(rule => scoped(rule.selector));

test('every reveal rule is scoped to Sidebar mode outside Seamless (no data-sbmode, no rule): Seamless keeps what it had', () => {
  assert.ok(mine.length >= 8);
  // every rule in this stylesheet that touches a view transition is one of these (a stray one added without the guards cannot hide among them)
  const touching = block.filter(rule => /view-transition/.test(rule.selector) || /view-transition/.test(rule.body));
  const edgeOnes = touching.filter(rule => /\[data-mode-switch='edge'\]/.test(rule.selector));
  assert.equal(edgeOnes.length, mine.length);
  for (const rule of edgeOnes) assert.ok(/:has\(\.browser-shell\[data-sbmode/.test(rule.selector), rule.selector);
  // the others are the docked slide's (tests/sidebar-block-slide.test.ts): a layout switch that flagged the block, nothing else
  for (const rule of touching.filter(rule => !edgeOnes.includes(rule))) assert.ok(/\[data-mode-switch='layout'\]\[data-block-slide/.test(rule.selector), rule.selector);
  for (const rule of mine) { assert.ok(rule.selector.includes('[data-sbmode'), rule.selector); assert.ok(!rule.selector.includes('data-seamless'), rule.selector); }
  // Seamless's own rules are the ones they were: its toolbar is flattened by its own selector and its shell is the slab
  assert.ok(seamlessCss.includes('.browser-shell[data-seamless], .ed-rail.acira-sidebar'));
  assert.ok(seamlessCss.includes('acira-edge-shell'));
});

test('the controls of the block carry no names of their own for the slide: the block is one layer', () => {
  const flatten = mine.filter(rule => rule.selector.includes('.acira-persistent-toolbar *'));
  assert.equal(flatten.length, 1);
  assert.equal(decl(flatten[0].body, 'view-transition-name'), 'none !important');
  assert.ok(flatten[0].selector.includes('.browser-shell > .browser-toolbar.acira-persistent-toolbar *'));
});

test('the toolbar\'s group does not glide from the hidden toolbar\'s box and is painted above the sidebar\'s', () => {
  const group = mine.filter(rule => rule.selector.includes('::view-transition-group(acira-toolbar)'));
  assert.equal(group.length, 1);
  assert.equal(decl(group[0].body, 'animation'), 'none');
  assert.equal(decl(group[0].body, 'z-index'), '1');
});

test('the picture keeps its own size (never cropped to a growing box) and is pinned to the group\'s top left', () => {
  const images = mine.filter(rule => rule.selector.includes('::view-transition-old(acira-toolbar)') && rule.selector.includes('::view-transition-new(acira-toolbar)') && !rule.selector.includes('[data-sidebar-overlay]'));
  assert.equal(images.length, 1);
  assert.equal(decl(images[0].body, 'left'), '0', 'pinned to the group\'s left edge, also in a right-to-left interface');
  assert.equal(decl(images[0].body, 'width'), 'auto');
  assert.equal(decl(images[0].body, 'height'), 'auto');
  assert.equal(decl(images[0].body, 'object-fit'), 'none');
  assert.equal(decl(images[0].body, 'object-position'), 'left top');
});

test('arriving, the block\'s picture slides in with the sidebar\'s own animation, curve and distance', () => {
  const sidebarIn = find(seamless, '::view-transition-new(acira-sidebar):only-child')[0];
  const sidebarOut = find(seamless, '::view-transition-old(acira-sidebar):only-child')[0];
  const arrive = mine.filter(rule => rule.selector.includes('[data-sbmode=\'block\']') && rule.selector.includes('::view-transition-new(acira-toolbar)'));
  const leave = mine.filter(rule => rule.selector.includes('[data-sbmode=\'bare\']') && rule.selector.includes('::view-transition-old(acira-toolbar)'));
  assert.equal(arrive.length, 1);
  assert.equal(leave.length, 1);
  assert.equal(decl(arrive[0].body, 'animation'), decl(sidebarIn.body, 'animation'), 'same duration, same easing, same keyframes as the sidebar');
  assert.equal(decl(leave[0].body, 'animation'), decl(sidebarOut.body, 'animation'));
  assert.equal(decl(arrive[0].body, 'animation'), 'var(--edge-ms) var(--edge-ease) both sb-slide-in');
  assert.equal(decl(arrive[0].body, 'opacity'), '1');
  assert.equal(decl(leave[0].body, 'opacity'), '1');
  // the keyframes are the sidebar's: one variable names the distance (--sb-slide-from), so the block and the sidebar can never travel different amounts
  assert.ok(/@keyframessb-slide-in\{from\{transform:var\(--sb-slide-from,translateX\(-100%\)\)\}\}/.test(sidebarCss.replace(/\s+/g, '')));
  assert.ok(/@keyframessb-slide-out\{to\{transform:var\(--sb-slide-from,translateX\(-100%\)\)\}\}/.test(sidebarCss.replace(/\s+/g, '')));
});

test('the state that has no picture of the block is not drawn (a plain fade would put it at full strength before the slide)', () => {
  const none = mine.filter(rule => rule.body.includes('animation: none') && rule.body.includes('opacity: 0'));
  assert.equal(none.length, 2);
  assert.ok(none.some(rule => rule.selector.includes('[data-sbmode=\'block\']') && rule.selector.includes('::view-transition-old(acira-toolbar)')));
  assert.ok(none.some(rule => rule.selector.includes('[data-sbmode=\'bare\']') && rule.selector.includes('::view-transition-new(acira-toolbar)')));
});

test('beside the page\'s frame the block takes the sidebar\'s whole-pixel easing, in both directions', () => {
  const sidebar = find(seamless, '[data-sidebar-overlay]', '::view-transition-new(acira-sidebar):only-child')[0];
  const pixel = mine.filter(rule => rule.selector.includes('[data-sidebar-overlay]'));
  assert.equal(pixel.length, 1);
  assert.ok(pixel[0].selector.includes('::view-transition-old(acira-toolbar)') && pixel[0].selector.includes('::view-transition-new(acira-toolbar)'));
  assert.equal(decl(pixel[0].body, 'animation-timing-function'), decl(sidebar.body, 'animation-timing-function'));
  assert.equal(decl(pixel[0].body, 'animation-timing-function'), 'var(--edge-ease-px, var(--edge-ease))');
});

test('the rules outrank the ones they replace (the toolbar\'s crop, plain fade and :only-child rules) and nothing outside the edge slide', () => {
  const crop = find(seamless, '::view-transition-old(acira-toolbar)', '::view-transition-new(acira-toolbar)').filter(rule => rule.body.includes('object-position: left center'));
  assert.equal(crop.length, 1);
  const images = mine.filter(rule => rule.selector.includes('::view-transition-old(acira-toolbar)') && rule.selector.includes('::view-transition-new(acira-toolbar)') && !rule.selector.includes('[data-sidebar-overlay]'))[0];
  for (const part of images.selector.split(',')) assert.ok(outranks(part.trim(), crop[0].selector.split(',')[0].trim()) > 0, part);
  const plain = find(seamless, '::view-transition-new(acira-toolbar)').filter(rule => rule.body.includes('animation: none') && rule.body.includes('opacity: 1') && !rule.selector.includes(','));
  assert.equal(plain.length, 1);
  const arrive = mine.filter(rule => rule.selector.includes('[data-sbmode=\'block\']') && rule.selector.includes('::view-transition-new(acira-toolbar)'))[0];
  assert.ok(outranks(arrive.selector, plain[0].selector) > 0);
  for (const rule of mine) assert.ok(rule.selector.includes('[data-mode-switch=\'edge\']'), 'only while an edge slide runs');
  // the :only-child rules of the plain edge slide (the sidebar's, and the toolbar's own fade) must lose to the picture rules too
  const onlyChild = seamless.filter(rule => rule.selector.includes('(acira-toolbar):only-child'));
  assert.ok(onlyChild.length >= 2);
  for (const rule of mine.filter(rule => /::view-transition-(old|new)\(acira-toolbar\)$/.test(rule.selector.split(',')[0].trim()) && rule.body.includes('opacity'))) {
    for (const other of onlyChild) for (const part of other.selector.split(',')) assert.ok(outranks(rule.selector.split(',')[0].trim(), part.trim()) > 0, `${rule.selector} vs ${part}`);
  }
});

test('the block is in the same commit as the sidebar: both read the same edge store', () => {
  // App.tsx's edgeSide and the sidebar's peek are one store (useChromeEdge().side), so data-sbmode='block' and the mounted sidebar arrive in one render
  const app = read('../src/App.tsx');
  assert.ok(app.includes('const edge = useChromeEdge()'));
  assert.ok(app.includes('edgeSide: edge.side'));
  assert.ok(read('../src/ui/layoutMode.ts').includes('export function useSidebarPeek() { return useChromeEdge().side; }'));
  assert.ok(read('../src/components/sidebar/AciraSidebar.tsx').includes('useSidebarPeek()'));
});
