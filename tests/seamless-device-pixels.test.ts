// Founder, 5 Nov 2026 (Windows 11, 125% and 175%): "a thin line flickers on the sidebar's edge just before it appears, and the same at the top and bottom". The frame's cut-out and the
// slide's distance were measured from CSS edges (the card's 6px inset is 7.5 device pixels at 125%) while the picture or page filling the cut-out is painted on its nearest whole
// device pixel: half a pixel of the frame's tint dropped out along the card's top and left edge (alpha 85 against 169, 78 against 156) and, as the slide moved the edges by 292.5 device
// pixels, the sidebar's and the page's met on a different fraction every frame. Real-pixel check at 110%, 125% and 175% (stepped frames of the real app): no pixel is half-tinted;
// at 100%, 150% and 200% every frame is the same as before.
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
const paint = async () => { for (let frame = 0; frame < 8; frame++) await Promise.resolve(); };
const say = async (side: boolean, top = false) => { listener?.({ type: 'chrome-edge', side, top, pinned: { side: false, top: false } }); await paint(); };
const reset = async () => { await say(false); await new Promise(resolve => setTimeout(resolve, 75)); };
const onGrid = (n: number, ratio: number) => Math.abs(n * ratio - Math.round(n * ratio)) < 1e-6;
const maskEdges = () => { const path = /d='([^']*)'/.exec(decodeURIComponent(app.style.getPropertyValue('--sf-mask')))?.[1] ?? ''; return { path, edges: (path.match(/[MHV][^MHVAZ]*/g) ?? []).flatMap(part => part.slice(1).trim().split(/\s+/).map(Number)) }; };

test('an edge of the interface is the nearest whole device pixel: 6px is drawn from the 8th at 125%, and whole lengths are untouched at 100%, 150% and 200%', () => {
  g.devicePixelRatio = 1.25; assert.equal(edge.snapPx(6), 6.4); assert.equal(edge.snapPx(240), 240); assert.equal(edge.snapPx(6.1), 6.4);
  g.devicePixelRatio = 1.75; assert.ok(onGrid(edge.snapPx(6), 1.75), 'the 6px inset is 10.5 device pixels at 175%');
  for (const ratio of [1, 1.5, 2]) { g.devicePixelRatio = ratio; assert.equal(edge.snapPx(6), 6); assert.equal(edge.snapPx(240), 240); assert.equal(edge.snapPx(36), 36); }
  g.devicePixelRatio = 2; assert.equal(edge.snapPx(6.25), 6.5, 'at 200% the grid is half a CSS pixel');
});

test('Seamless at 125%: the frame\'s cut-out and the sidebar\'s slide sit on whole device pixels (no half-tinted line along the card)', async () => {
  g.devicePixelRatio = 1.25;
  panes = []; areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, false, true); await reset();
  await say(true);
  areaRect = rect(240, 6, 1034, 808); edge.refreshEdgeFloat();
  const { path, edges } = maskEdges();
  assert.ok(edges.length > 6, 'the cut-out is drawn');
  for (const n of edges) assert.ok(onGrid(n, 1.25), `${n} is on the device pixel grid (${path})`);
  assert.ok(path.includes('M0 6.4H240V814.4H0Z') && path.includes('M240 6.4H1266.4'), `the card's top edge is the 8th device pixel row (6.4) and its bottom 814.4: ${path}`);
  assert.equal(root.style.getPropertyValue('--sf-sidebar-travel'), '233.6px', 'the sidebar travels from the card\'s drawn edge (6.4) to its own (240): 292 device pixels, not 292.5');
  assert.ok(onGrid(parseFloat(app.style.getPropertyValue('--sf-frame-top')), 1.25) && onGrid(parseFloat(app.style.getPropertyValue('--sf-frame-bottom')), 1.25), 'the sidebar\'s own copy starts and stops on whole device pixels');
});

test('Seamless at 200%: the cut-out is what it was (6 and 240 are whole device pixels there)', async () => {
  g.devicePixelRatio = 2;
  panes = []; areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, false, true); await reset();
  await say(true);
  areaRect = rect(240, 6, 1034, 808); edge.refreshEdgeFloat();
  const { path } = maskEdges();
  assert.ok(path.includes('M0 6H240V814H0Z') && path.includes('M240 6H1266'), path); assert.equal(root.style.getPropertyValue('--sf-sidebar-travel'), '234px');
});
