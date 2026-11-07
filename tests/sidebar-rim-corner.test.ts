// Founder, 5 Nov 2026 (the hover reveal, tabs in the sidebar): "the toolbar's bottom line runs past the corner's curve, a little into the sidebar, instead of meeting it". The card's frame
// line (sidebar-overlay.css, drawn by chromeEdge paintPageHoles) is one straight run from the page's resting edge plus a stroke up the sidebar's edge and round the corner. Both stood
// behind the same clip that rides the sidebar's edge (one pixel behind it), so the straight run lay over the corner's 8px curve from the first frame of the slide to the settled state and
// back. Its row now starts where the curve ends (2px short, so it overlaps the stroke's last bit); the stroke and everything else keep the clip they had, so the motion is the same.
// Real-pixel check (stepped frames of the real app, Compact, Full and Seamless, dark and light, 100% and 200%): only the row above the card's top differs, and only left of the curve's end.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const css = readFileSync(new URL('../src/styles/sidebar-overlay.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (needle: string) => css.split('\n').find(line => line.includes(needle)) ?? '';
const X = 'var(--sf-rim-x,0px)', LX = 'var(--sf-rim-line-x,var(--sf-rim-x,0px))', T = 'var(--sf-rim-top,0px)', M = 'var(--sf-rim-mid,0px)', B = 'var(--sf-rim-bottom,0px)';

test('the frame line\'s row starts where the corner curve ends and the rest of it where the sidebar\'s edge is, at rest and in the slide', () => {
  assert.ok(rule('.sidebar-page-rim { display:block;').includes(`clip-path:polygon(${LX} 0,100% 0,100% 100%,${X} 100%,${X} ${T},${LX} ${T})`), 'the top piece at rest');
  assert.ok(rule('.sidebar-page-rim-low {').includes(`clip-path:polygon(${X} ${M},100% ${M},100% 100%,${LX} 100%,${LX} ${B},${X} ${B})`), 'the low piece at rest');
  assert.ok(rule('::view-transition-image-pair(acira-page-rim) {').includes(`clip-path:polygon(${LX} -2px,calc(100% + 100vw) -2px,calc(100% + 100vw) calc(100% + 100vh),${X} calc(100% + 100vh),${X} ${T},${LX} ${T})`), 'the top piece in the slide');
  assert.ok(rule('::view-transition-image-pair(acira-page-rim-low) {').includes(`clip-path:polygon(${X} ${M},calc(100% + 100vw) ${M},calc(100% + 100vw) calc(100% + 100vh),${LX} calc(100% + 100vh),${LX} ${B},${X} ${B})`), 'the low piece in the slide');
  assert.ok(!css.includes('inset(-2px -100vw -100vh var(--sf-rim-x') && !css.includes('clip-path:inset(0 0 0 var(--sf-rim-x'), 'no plain inset clip left on the line');
  assert.ok(rule('edge-rim-travel var(--edge-ms)').length > 0 && css.includes('@keyframes edge-rim-travel { from { translate:var(--sf-rim-shift-from,0px) 0; } to { translate:var(--sf-rim-shift-to,0px) 0; } }'), 'the travel of the clip is untouched');
});

test('beside the sidebar the line\'s row starts 2px inside the end of the curve; with no sidebar edge it is the clip\'s own start', async () => {
  g.devicePixelRatio = 1;
  panes = []; areaRect = rect(6, 6, 1268, 808); edge.setEdgeFloatable(true, false, true); await reset();
  await say(true);
  assert.equal(root.style.getPropertyValue('--sf-rim-x'), '14px', 'no sidebar edge yet: the clip starts where the curve ends (6 + 8)');
  assert.equal(root.style.getPropertyValue('--sf-rim-line-x'), '14px', 'and so does the line\'s row');
  areaRect = rect(246, 6, 1028, 808); edge.refreshEdgeFloat();
  assert.equal(root.style.getPropertyValue('--sf-rim-x'), '245px', 'the stroke up the sidebar\'s edge still starts one pixel behind it');
  assert.equal(root.style.getPropertyValue('--sf-rim-line-x'), '252px', 'the line starts at the curve\'s end, 246 + 8, less 2');
});
