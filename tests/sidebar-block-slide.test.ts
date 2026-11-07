// Founder, 7 Nov 2026 (after the hover reveal's fix): in Sidebar mode with the sidebar away, Ctrl/Cmd+Shift+E, the sidebar button and Ctrl/Cmd+L (with the sidebar away) open the sidebar in a
// LAYOUT switch, not an edge slide, and the window-view morph's per-control names flew the address block in from where the hidden toolbar had it (the field up to 535 px over the page on the way
// in, 202 px on the way out; Windows 440 / 130). Here too the block is ONE layer slid with the sidebar's own layout animation. A view transition takes the old state's picture when it starts,
// so a block that is about to leave must already be one layer then (a hint from the caller: the layout change closes the sidebar); arriving, the new state is flagged after the update.
// This file pins the rule's direction (blockSlideOf), the hint (sidebarCloses), the flag's life in sharedMotion.startModeTransition, its wiring in the client, and the stylesheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockSlideOf } from '../src/ui/addressInSidebar';
import { sidebarCloses } from '../src/ui/layoutMode';

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');

test('blockSlideOf: the block slides only when the header goes bare -> block (in) or block -> bare (out)', () => {
  assert.equal(blockSlideOf('bare', 'block'), 'in');
  assert.equal(blockSlideOf('block', 'bare'), 'out');
  for (const [a, b] of [['block', 'block'], ['bare', 'bare'], [undefined, 'block'], [undefined, 'bare'], ['block', undefined], ['bare', undefined], [undefined, undefined]] as const) assert.equal(blockSlideOf(a, b), undefined, `${a} -> ${b}`);
});

// sidebarCloses: open for the active tab now and closed for the tab that will be active
const tab = (id: string, contentKind: 'web' | 'internal') => ({ id, contentKind }) as never;
const now = (workspaceOpen: boolean, webWorkspaceOpen: boolean, activeTabId = 'w') => ({ windowUi: { workspaceOpen, webWorkspaceOpen }, tabs: [tab('w', 'web'), tab('i', 'internal')], activeTabId }) as never;
test('sidebarCloses: the sidebar is open now and the change leaves it closed', () => {
  assert.equal(sidebarCloses(now(true, true), { workspaceOpen: false, webWorkspaceOpen: false }, 'w'), true);
  assert.equal(sidebarCloses(now(true, true), { workspaceOpen: true, webWorkspaceOpen: true }, 'w'), false, 'nothing changes');
  assert.equal(sidebarCloses(now(false, false), { workspaceOpen: true, webWorkspaceOpen: true }, 'w'), false, 'opening is not closing');
  assert.equal(sidebarCloses(now(false, false), { workspaceOpen: false, webWorkspaceOpen: false }, 'w'), false, 'closed stays closed');
});
test('sidebarCloses: a web tab follows webWorkspaceOpen, an internal page workspaceOpen; a tab switch that changes which one counts is read for the tab that will be active', () => {
  assert.equal(sidebarCloses(now(true, true), { workspaceOpen: true, webWorkspaceOpen: false }, 'w'), true, 'the web tab\'s preference went off');
  assert.equal(sidebarCloses(now(true, true), { workspaceOpen: true, webWorkspaceOpen: false }, 'i'), false, 'the internal tab\'s is still on');
  assert.equal(sidebarCloses(now(true, false), { workspaceOpen: true, webWorkspaceOpen: false }, 'i'), false, 'closed for the web tab it leaves, open for the internal one: nothing leaves');
  assert.equal(sidebarCloses(now(true, true, 'i'), { workspaceOpen: false, webWorkspaceOpen: true }, 'i'), true);
  assert.equal(sidebarCloses(now(true, true), { workspaceOpen: false, webWorkspaceOpen: false }, 'gone'), true, 'a tab that is not in the list reads workspaceOpen');
  // a snapshot's new active tab is looked up in the snapshot's own tab list, not the old one
  const fresh = [tab('w', 'web'), tab('n', 'web')];
  assert.equal(sidebarCloses(now(true, true), { workspaceOpen: false, webWorkspaceOpen: true }, 'n', fresh), false, 'the new web tab follows webWorkspaceOpen, still on');
  assert.equal(sidebarCloses(now(true, true), { workspaceOpen: false, webWorkspaceOpen: true }, 'n'), true, 'looked up in the old list it would read workspaceOpen: the wrong answer the argument exists for');
});

// startModeTransition: the flag's life. The stage is a header with a data-sbmode, a root with a dataset, and a view transition that runs the update at once.
const g = globalThis as unknown as Record<string, unknown>;
function stage(initial: string | undefined) {
  const dataset: Record<string, string> = {}; let sbmode = initial, finish!: () => void, ready!: () => void;
  const readyPromise = new Promise<void>(resolve => { ready = resolve; }), finished = new Promise<void>(resolve => { finish = resolve; });
  const seen = { atCapture: undefined as string | undefined, atUpdate: undefined as string | undefined };
  g.document = {
    documentElement: { dataset, hasAttribute: () => false, style: { setProperty() {}, getPropertyValue: () => '' } },
    visibilityState: 'visible',
    querySelector: (selector: string) => selector === '.browser-shell[data-sbmode]' ? (sbmode ? { dataset: { sbmode } } : null) : null,
    startViewTransition(update: () => void) { seen.atCapture = dataset.blockSlide; update(); seen.atUpdate = dataset.blockSlide; return { ready: readyPromise, finished } as never; },
  };
  g.window = { innerHeight: 720, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) };
  g.matchMedia = () => ({ matches: false });
  return { dataset, seen, set: (next: string | undefined) => { sbmode = next; }, done: async () => { ready(); finish(); await new Promise(resolve => setTimeout(resolve, 0)); } };
}
test('closing with the hint: the block is one layer already when the old state is captured, and stays so after the update', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const s = stage('block');
  startModeTransition(() => s.set('bare'), 'layout', 'out');
  assert.equal(s.seen.atCapture, 'out'); assert.equal(s.seen.atUpdate, 'out'); assert.equal(s.dataset.blockSlide, 'out');
  await s.done(); assert.equal(s.dataset.blockSlide, undefined, 'gone with the switch');
});
test('opening: nothing is needed before the capture (the old header is hidden); the new state is flagged after the update', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const s = stage('bare');
  startModeTransition(() => s.set('block'), 'layout');
  assert.equal(s.seen.atCapture, undefined); assert.equal(s.seen.atUpdate, 'in');
  await s.done(); assert.equal(s.dataset.blockSlide, undefined);
});
test('a layout switch that does not bring the block in or take it out sets nothing: a view switch with the sidebar out, away, or Sidebar mode itself switching', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  for (const [before, after] of [['block', 'block'], ['bare', 'bare'], [undefined, 'block'], [undefined, 'bare'], ['block', undefined], ['bare', undefined]] as const) {
    const s = stage(before); startModeTransition(() => s.set(after), 'layout');
    assert.equal(s.seen.atCapture, undefined, `${before} -> ${after}`); assert.equal(s.seen.atUpdate, undefined, `${before} -> ${after}`); await s.done();
  }
});
test('a hint that turns out wrong (the sidebar stays: a tab switch) is taken back after the update; a hint with no block to fold in does nothing; other kinds ignore it', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const wrong = stage('block'); startModeTransition(() => {}, 'layout', 'out');
  assert.equal(wrong.seen.atCapture, 'out'); assert.equal(wrong.seen.atUpdate, undefined, 'block -> block: not a slide'); await wrong.done();
  const none = stage('bare'); startModeTransition(() => {}, 'layout', 'out');
  assert.equal(none.seen.atCapture, undefined, 'nothing to fold in when the header is bare'); await none.done();
  const edge = stage('block'); startModeTransition(() => edge.set('bare'), 'edge', 'out');
  assert.equal(edge.seen.atCapture, undefined); assert.equal(edge.seen.atUpdate, undefined, 'the edge slide has its own rules'); await edge.done();
  const appearance = stage('block'); startModeTransition(() => appearance.set('bare'), 'appearance', 'out');
  assert.equal(appearance.seen.atUpdate, undefined); await appearance.done();
});

test('the client asks before the switch starts, and when it starts: the optimistic path and the snapshot path both pass a sidebarCloses hint, evaluated lazily, and it reaches startModeTransition (also from the queue)', () => {
  const client = read('../src/runtime/client.ts');
  assert.ok(client.includes("hint=()=>sidebarCloses(latest.current,{...latest.current.windowUi,...patch},latest.current.activeTabId)?'out' as const:undefined"));
  assert.ok(client.includes("modeSwitch(()=>flushSync(applyNow),'layout',()=>sidebarCloses(latest.current,next.windowUi,next.activeTabId,next.tabs)?'out' as const:undefined)"), 'the snapshot path reads the tab that will be active in the NEW tab list');
  assert.ok(client.includes('else startModeTransition(run,kind,slideHint?.())'), 'read when the switch starts, so a switch that waited reads the state it starts from');
  assert.ok(client.includes("startSwitch(update,'layout',slideHint)"), 'a switch that waits for the one playing keeps its hint');
  assert.ok(client.includes('startSwitch(update,kind,slideHint)'));
  assert.ok(/,'layout',hint\);\}/.test(client), 'the optimistic modeSwitch call ends with the hint');
});

// The stylesheet
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].replace(/\s+/g, ' ').trim(), body: match[2].replace(/\s+/g, ' ').trim() }));
const decl = (body: string, property: string) => new RegExp(`(?:^|;|\\s)${property}:\\s*([^;]+)`).exec(body)?.[1].trim();
const block = rules(strip(read('../src/styles/address-in-sidebar.css'))), sidebar = rules(strip(read('../src/components/sidebar/sidebar.css'))), viewMorph = rules(strip(read('../src/styles/view-morph.css')));
const mine = block.filter(rule => rule.selector.includes("[data-mode-switch='layout'][data-block-slide"));
const sidebarLayout = (kind: 'new' | 'old') => sidebar.find(rule => rule.selector === `:root[data-mode-switch=layout]::view-transition-${kind}(acira-sidebar):only-child`)!;

test('the layout rules exist once each and are scoped to a layout switch that flagged the block', () => {
  assert.equal(mine.length, 9, 'names, group, pictures, the arriving and leaving pair of each direction, and the two page-follow variants');
  for (const rule of mine) assert.ok(/^:root(:root)?(\[data-page-follow\])?\[data-mode-switch='layout'\]\[data-block-slide/.test(rule.selector), rule.selector);
  // every view-transition rule of the stylesheet is the edge slide's or this one's: nothing leaks to other transitions
  for (const rule of block.filter(rule => /view-transition/.test(rule.selector) || /view-transition/.test(rule.body))) assert.ok(/\[data-mode-switch='(edge|layout)'\]/.test(rule.selector), rule.selector);
});
test('the block is one layer: the controls carry no names for a flagged switch, the group does not glide and is painted above the sidebar, the picture keeps its size and its left edge', () => {
  const flatten = mine.filter(rule => rule.selector.includes('.acira-persistent-toolbar *'));
  assert.equal(flatten.length, 1); assert.equal(decl(flatten[0].body, 'view-transition-name'), 'none !important');
  const group = mine.filter(rule => rule.selector.includes('::view-transition-group(acira-toolbar)'));
  assert.equal(group.length, 1); assert.equal(decl(group[0].body, 'animation'), 'none'); assert.equal(decl(group[0].body, 'z-index'), '1');
  const images = mine.filter(rule => rule.selector.includes('::view-transition-old(acira-toolbar)') && rule.selector.includes('::view-transition-new(acira-toolbar)'));
  assert.equal(images.length, 1);
  for (const [property, value] of [['left', '0'], ['width', 'auto'], ['height', 'auto'], ['object-fit', 'none'], ['object-position', 'left top']] as const) assert.equal(decl(images[0].body, property), value, property);
});
test('arriving and leaving take the sidebar\'s own layout animation: same duration, same spring, same keyframes, so the block\'s right end is the sidebar\'s', () => {
  const arrive = mine.find(rule => rule.selector.includes("[data-block-slide='in']") && rule.selector.includes('::view-transition-new(acira-toolbar)'))!;
  const leave = mine.find(rule => rule.selector.includes("[data-block-slide='out']") && rule.selector.includes('::view-transition-old(acira-toolbar)'))!;
  assert.equal(decl(arrive.body, 'animation'), decl(sidebarLayout('new').body, 'animation'));
  assert.equal(decl(leave.body, 'animation'), decl(sidebarLayout('old').body, 'animation'));
  assert.ok(decl(arrive.body, 'animation')!.endsWith('both sb-slide-in') && decl(leave.body, 'animation')!.endsWith('both sb-slide-out'));
  assert.ok(decl(arrive.body, 'animation')!.startsWith('calc(480ms * var(--motion-pace, 1)) linear('), 'the layout switch\'s 480 ms spring, at the speed setting');
  assert.equal(decl(arrive.body, 'opacity'), '1'); assert.equal(decl(leave.body, 'opacity'), '1');
  // the picture of the state that has no block is not drawn
  assert.ok(mine.some(rule => rule.selector.includes("[data-block-slide='in']") && rule.selector.includes('::view-transition-old(acira-toolbar)') && rule.body.includes('animation: none') && rule.body.includes('opacity: 0')));
  assert.ok(mine.some(rule => rule.selector.includes("[data-block-slide='out']") && rule.selector.includes('::view-transition-new(acira-toolbar)') && rule.body.includes('animation: none') && rule.body.includes('opacity: 0')));
});

// The sidebar's layout animation exists in more than one stylesheet (sidebar.css, view-morph.css: whichever loads later wins) and in a page-follow variant: the block takes the same ones
test('every copy of the sidebar\'s layout slide has the duration and spring the block has, and a page the interface draws gives the block the sidebar\'s -follow keyframes', () => {
  const copies = [...sidebar, ...viewMorph].filter(rule => /^:root\[data-mode-switch=layout\]::view-transition-(new|old)\(acira-sidebar\):only-child$/.test(rule.selector) && /linear\(/.test(rule.body));
  assert.ok(copies.length >= 4, 'two in sidebar.css, two in view-morph.css');
  const arrive = mine.find(rule => rule.selector.includes("[data-block-slide='in']") && rule.selector.includes('::view-transition-new(acira-toolbar)') && !rule.selector.includes('page-follow'))!;
  const timing = (animation: string) => animation.replace(/ both .*$/, '');
  for (const copy of copies) assert.equal(timing(decl(copy.body, 'animation')!), timing(decl(arrive.body, 'animation')!), copy.selector);
  const follow = (name: 'arrive' | 'leave') => viewMorph.filter(rule => decl(rule.body, 'animation-name') === `acira-sidebar-${name}-follow`);
  const mineFollow = mine.filter(rule => rule.selector.includes('[data-page-follow]'));
  assert.equal(mineFollow.length, 2);
  const arriveFollow = mineFollow.find(rule => rule.selector.includes("[data-block-slide='in']") && rule.selector.includes('::view-transition-new(acira-toolbar)'))!, leaveFollow = mineFollow.find(rule => rule.selector.includes("[data-block-slide='out']") && rule.selector.includes('::view-transition-old(acira-toolbar)'))!;
  assert.equal(decl(arriveFollow.body, 'animation-name'), 'acira-sidebar-arrive-follow'); assert.equal(decl(leaveFollow.body, 'animation-name'), 'acira-sidebar-leave-follow');
  assert.equal(follow('arrive').length, 1, 'the sidebar\'s own page-follow rule, with the same name'); assert.equal(follow('leave').length, 1);
  assert.ok(follow('arrive')[0].selector.includes('[data-page-follow][data-mode-switch=layout]')); assert.ok(beats(arriveFollow.selector, arrive.selector) > 0 && beats(leaveFollow.selector, mine.find(rule => rule.selector.includes("[data-block-slide='out']") && rule.selector.includes('::view-transition-old(acira-toolbar)') && !rule.selector.includes('page-follow'))!.selector) > 0, 'the variants outrank the base rules');
  const css = strip(read('../src/styles/view-morph.css')); assert.ok(css.includes('@keyframes acira-sidebar-arrive-follow') && css.includes('@keyframes acira-sidebar-leave-follow'));
});

// The rules they must beat in a layout switch (sidebar.css: the toolbar's crop and plain pictures, the group's duration; view-morph.css: the per-control names)
function specificity(selector: string): [number, number, number] {
  let work = selector, total: [number, number, number] = [0, 0, 0];
  const add = (spec: [number, number, number]) => { total = [total[0] + spec[0], total[1] + spec[1], total[2] + spec[2]]; };
  for (const name of ['where', 'is', 'not', 'has']) for (;;) {
    const at = work.indexOf(`:${name}(`); if (at < 0) break;
    let depth = 0, end = at + name.length + 1; for (; end < work.length; end++) { if (work[end] === '(') depth++; if (work[end] === ')' && --depth === 0) break; }
    if (name !== 'where') add(specificity(work.slice(at + name.length + 2, end).split(',')[0])); work = work.slice(0, at) + work.slice(end + 1);
  }
  work = work.replace(/::[\w-]+(\([^)]*\))?/g, () => { add([0, 0, 1]); return ' '; });
  add([0, (work.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) ?? []).length, 0]);
  return total;
}
const beats = (a: string, b: string) => { const x = specificity(a), y = specificity(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
test('the rules outrank the layout switch\'s own toolbar and group rules, and the per-control names lose to !important', () => {
  const competing = sidebar.filter(rule => rule.selector.includes('::view-transition-') && rule.selector.includes('acira-toolbar'));
  assert.ok(competing.length >= 4);
  for (const rule of mine.filter(rule => rule.selector.includes('::view-transition-'))) for (const other of competing) for (const part of other.selector.split(',')) {
    if (rule.selector.includes('::view-transition-group') !== part.includes('::view-transition-group')) continue;
    if (part.includes('::view-transition-old') !== rule.selector.includes('::view-transition-old') && !rule.selector.includes('::view-transition-new(acira-toolbar),')) continue;
    assert.ok(beats(rule.selector.split(',')[0].trim(), part.trim()) > 0, `${rule.selector.split(',')[0]} vs ${part}`);
  }
  const names = viewMorph.filter(rule => decl(rule.body, 'view-transition-name') && rule.selector.includes('.acira-persistent-toolbar') && !rule.body.includes('!important'));
  assert.ok(names.length >= 10, 'the controls\' names are plain declarations');
});
