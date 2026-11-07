// Founder, 7 Nov 2026 (dark): "I can see like a line glitching on the lining of the sidebar when the sidebar is popping up when I hover." The card's frame line (the "lining",
// sidebar-overlay.css, drawn by chromeEdge paintPageHoles) ends in a stroke up the sidebar's edge and round the corner. Its picture is held at the place the sidebar will have, so while
// the sidebar slid in (340 ms) the stroke stood alone ahead of the moving edge, a second rounded card outline 20-116 device px in front of it, then dropped out of the picture's last
// frames and came back with the live frame: on, off, on. It is its own path now, left out of the picture while the sidebar arrives (data-edge-rim=wait) and faded in when it has landed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

type Rect = { left: number; top: number; width: number; height: number; right: number; bottom: number };
const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height, right: left + width, bottom: top + height });
let listener: ((event: unknown) => void) | null = null;
let areaRect = rect(246, 6, 1028, 808);
const style = () => { const values = new Map<string, string>(); return { setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key), getPropertyValue: (key: string) => values.get(key) || '' }; };
const root = { dataset: {} as Record<string, string>, style: style(), hasAttribute: () => false };
const paths = new Map<string, string>();
const pathStub = (selector: string) => ({ setAttribute: (name: string, value: string) => { if (name === 'd') paths.set(selector, value); }, getAttribute: () => paths.get(selector) ?? null });
const app = { style: style(), querySelector: (selector: string) => selector.includes('.sidebar-page-rim') ? pathStub(selector) : null };
const g = globalThis as Record<string, unknown>;
let motion = true;
let finish!: () => void;
let atUpdate: (string | undefined)[] = [];
g.CSS = { escape: (value: string) => value };
g.window = Object.assign(globalThis, { innerWidth: 1280, innerHeight: 820, devicePixelRatio: 1, acira: { browserCommand: () => Promise.resolve(), subscribeBrowser: (fn: (event: unknown) => void) => { listener = fn; return () => {}; } } });
g.addEventListener = () => {};
g.removeEventListener = () => {};
g.matchMedia = () => ({ matches: !motion });
g.requestAnimationFrame = (fn: () => void) => { queueMicrotask(fn); return 0; };
g.getComputedStyle = () => ({ backgroundImage: 'none', backgroundSize: 'auto', backgroundPosition: '0 0', backgroundRepeat: 'repeat', backgroundColor: 'rgb(0,0,0)' });
g.document = {
  documentElement: root, visibilityState: 'visible',
  querySelector: (selector: string) => selector === '.app' ? app : selector === '.page-area' ? { getBoundingClientRect: () => areaRect } : null,
  querySelectorAll: (selector: string) => selector.includes('.sidebar-page-rim .rim-edge') ? [pathStub('.sidebar-page-rim-top .rim-edge'), pathStub('.sidebar-page-rim-low .rim-edge')] : [],
  startViewTransition(update: () => void) { update(); atUpdate.push(root.dataset.edgeRim); const done = new Promise<void>(resolve => { finish = resolve; }); return { ready: Promise.resolve(), finished: done, skipTransition() {} } as never; },
};

const require = createRequire(import.meta.url);
const edge = require('../src/ui/chromeEdge.ts') as typeof import('../src/ui/chromeEdge');
edge.installChromeEdge(); edge.bindEdgeTab('active');
const paint = async () => { for (let frame = 0; frame < 8; frame++) await Promise.resolve(); };
const reset = async () => { await say(false); await new Promise(resolve => setTimeout(resolve, 75)); };
const say = async (side: boolean) => { listener?.({ type: 'chrome-edge', side, top: false, pinned: { side: false, top: false } }); await paint(); };
const css = readFileSync(new URL('../src/styles/sidebar-overlay.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (needle: string) => css.split('\n').find(line => line.includes(needle)) ?? '';

test('the stroke is its own path in both pieces of the frame line, after the line\'s own', () => {
  const app_ = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app_.includes('<div className="sidebar-page-rim sidebar-page-rim-top" aria-hidden="true"><svg><path/><path className="rim-edge"/></svg></div>'));
  assert.ok(app_.includes('<div className="sidebar-page-rim sidebar-page-rim-low" aria-hidden="true"><svg><path/><path className="rim-edge"/></svg></div>'));
});

test('the line\'s own path no longer carries the stroke; the stroke path does, and is empty with no sidebar edge', async () => {
  motion = false; areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, false, true); await reset();
  await say(true);
  assert.equal(paths.get('.sidebar-page-rim-top .rim-edge'), '', 'no sidebar edge: no stroke');
  areaRect = rect(246, 6, 1028, 808); edge.refreshEdgeFloat();
  const top = paths.get('.sidebar-page-rim-top path') ?? '', stroke = paths.get('.sidebar-page-rim-top .rim-edge') ?? '';
  assert.ok(top.startsWith('M') && !top.slice(1).includes('M'), 'one subpath: ' + top);
  assert.ok(stroke.startsWith('M245.5 ') && stroke.startsWith('M245.5 410V14A8.5 8.5 0 0 1 252 5.7386'), 'the stroke up the sidebar\'s edge and round the corner, ending where the line\'s row starts (246 + 8 - 2) on the curve, not 2px further on under the line: ' + stroke);
  const low = paths.get('.sidebar-page-rim-low path') ?? '', lowStroke = paths.get('.sidebar-page-rim-low .rim-edge') ?? '';
  assert.ok(!low.slice(1).includes('M') && lowStroke.startsWith('M245.5 ') && lowStroke.includes('A8.5 8.5 0 0 0 252 '), 'the same for the low piece: ' + low + ' / ' + lowStroke);
  await reset();
});

test('the stroke waits while the sidebar slides in and is released when the slide has ended', async () => {
  motion = true; areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, false, true);
  delete root.dataset.edgeRim;
  atUpdate = [];
  await say(true);
  assert.equal(root.dataset.edgeRim, 'wait', 'set before the new picture is taken, while the slide plays');
  assert.deepEqual(atUpdate, ['wait'], 'already set when the update that the new picture shows has run');
  assert.equal(root.dataset.modeSwitch, 'edge', 'and the stylesheet\'s hold applies only with the edge transition standing');
  finish(); await paint(); await paint();
  assert.equal(root.dataset.edgeRim, undefined, 'released at the end of the slide, so the stroke fades in');
  await say(false);
  assert.equal(root.dataset.edgeRim, undefined, 'a hide never sets it');
  finish(); await paint();
});

test('with no transition to play (Off, or the browser cannot) the stroke is never held back', async () => {
  motion = false; areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, false, true);
  await say(true);
  assert.equal(root.dataset.edgeRim, undefined);
  await say(false); finish?.(); await paint();
});

test('the stylesheet keeps the line\'s colour and width, hides the waiting stroke at once during an edge transition and fades it in; the end state is the same line', () => {
  assert.ok(css.includes('.sidebar-page-rim>svg { position:absolute; inset:0; width:100%; height:100%; overflow:visible; fill:none; stroke:rgb(0 0 0 / .08); stroke-width:1; }'));
  assert.ok(css.includes('.app[data-chrome=dark] .sidebar-page-rim>svg { stroke:rgb(255 255 255 / .06); }'));
  assert.equal(rule('.sidebar-page-rim .rim-edge {'), '.sidebar-page-rim .rim-edge { transition:opacity calc(140ms * var(--motion-scale,1)) ease-out; }');
  assert.equal(rule(':root[data-mode-switch=edge][data-edge-rim=wait] .sidebar-page-rim .rim-edge {'), ':root[data-mode-switch=edge][data-edge-rim=wait] .sidebar-page-rim .rim-edge { opacity:0; transition:none; }');
  assert.ok(!css.includes('.rim-ink'), 'no group opacity: two paths each at the stroke\'s own alpha, which do not overlap');
});

test('leaving: only the stroke path is emptied before the old picture is taken, as the split of the old path did', () => {
  const source = readFileSync(new URL('../src/ui/chromeEdge.ts', import.meta.url), 'utf8');
  assert.match(source, /function dropRimEdge\(\): void \{\n  for \(const path of document\.querySelectorAll\('\.sidebar-page-rim \.rim-edge'\)\) path\.setAttribute\('d', ''\);\n\}/);
  assert.match(source, /if \(shownBefore\.side && !shownAfter\.side\) dropRimEdge\(\);\n  const ms = startEdgeTransition\(/);
  assert.match(source, /if \(shownAfter\.side && !shownBefore\.side\) document\.documentElement\.dataset\.edgeRim = 'wait'; else delete document\.documentElement\.dataset\.edgeRim;/);
  assert.match(source, /if \(!edgeTransition\) \{ delete document\.documentElement\.dataset\.edgeToolbar; delete document\.documentElement\.dataset\.edgeTop; delete document\.documentElement\.dataset\.edgeRim; holdVeil = false; \}/);
  assert.match(source, /const settled = \(\) => \{ edgeBusy = false; delete document\.documentElement\.dataset\.edgeToolbar; delete document\.documentElement\.dataset\.edgeTop; delete document\.documentElement\.dataset\.edgeRim;/);
});
