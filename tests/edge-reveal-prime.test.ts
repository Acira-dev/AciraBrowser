// 13.10 (Discord, "sidebar auto-appear ... still kinda slow, responsive"): the Seamless reveal over a website used to wait for the page's picture (take, JPEG, decode, paint, park) AFTER the dwell ran
// out, so every reveal paid the whole pipeline before its first moving frame. Main now says a rest is about to reveal (`chrome-edge-prime`) and the interface takes, decodes and places the picture
// under the page while the dwell runs; the reveal only parks the page. A rest that ends without a reveal lets the picture go; a stale one (taken for another page, older than 700 ms) is never used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

type Rect = { left: number; top: number; width: number; height: number; right: number; bottom: number };
const rect = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height, right: left + width, bottom: top + height });
let listener: ((event: unknown) => void) | null = null;
const areaRect = rect(6, 6, 1268, 808);
const style = () => { const values = new Map<string, string>(); return { setProperty: (key: string, value: string) => values.set(key, value), removeProperty: (key: string) => values.delete(key), getPropertyValue: (key: string) => values.get(key) || '' }; };
const root = { dataset: {} as Record<string, string>, style: style(), hasAttribute: () => false };
const paths = new Map<string, string>();
const pathStub = (selector: string) => ({ setAttribute: (name: string, value: string) => { if (name === 'd') paths.set(selector, value); }, getAttribute: () => paths.get(selector) ?? null });
const app = { style: style(), querySelector: (selector: string) => selector.includes('.sidebar-page-rim') ? pathStub(selector) : null };
const g = globalThis as Record<string, unknown>;
let finish: (() => void) | undefined;

// The page area: one website, its content box takes the pictures.
class Picture {
  className = ''; alt = ''; src = ''; style: Record<string, string> = {}; isConnected = false; naturalWidth = 1268; naturalHeight = 808; dataset: Record<string, string> = {};
  decode() { return Promise.resolve(); }
  remove() { this.isConnected = false; const at = content.children.indexOf(this); if (at >= 0) content.children.splice(at, 1); }
  closest() { return null; }
  after(other: Picture) { content.append(other); }
}
const content = {
  children: [] as Picture[],
  append(img: Picture) { if (!this.children.includes(img)) this.children.push(img); img.isConnected = true; },
  querySelectorAll() { return []; }, querySelector() { return null; },
};
g.Image = Picture;
const commands: { still?: string; float?: unknown; tab?: string }[] = [];
let loading = false, serial = 0;
g.CSS = { escape: (value: string) => value };
g.window = Object.assign(globalThis, {
  innerWidth: 1280, innerHeight: 820, devicePixelRatio: 1,
  acira: {
    subscribeBrowser: (fn: (event: unknown) => void) => { listener = fn; return () => {}; },
    browserCommand: (command: { type: string; still?: string; float?: unknown; tabId?: string }) => {
      commands.push({ still: command.still, float: command.float, tab: command.tabId });
      if (command.still === 'take') return Promise.resolve({ url: 'data:image/jpeg;base64,' + (++serial), loading });
      return Promise.resolve(true);
    },
  },
});
g.addEventListener = () => {};
const dispatched: string[] = [];
g.dispatchEvent = (event: { type: string }) => { dispatched.push(event.type); return true; };
g.removeEventListener = () => {};
g.matchMedia = () => ({ matches: false });
g.requestAnimationFrame = (fn: () => void) => { queueMicrotask(fn); return 0; };
g.getComputedStyle = () => ({ backgroundImage: 'none', backgroundSize: 'auto', backgroundPosition: '0 0', backgroundRepeat: 'repeat', backgroundColor: 'rgb(0,0,0)' });
g.document = {
  documentElement: root, visibilityState: 'visible',
  querySelector: (selector: string) => selector === '.app' ? app : selector === '.page-area' ? { getBoundingClientRect: () => areaRect } : selector === '.page-area .page-content' ? content : null,
  querySelectorAll: (selector: string) => selector.includes('.sidebar-page-rim .rim-edge') ? [pathStub('.sidebar-page-rim-top .rim-edge'), pathStub('.sidebar-page-rim-low .rim-edge')] : [],
  startViewTransition(update: () => void) { update(); const done = new Promise<void>(resolve => { finish = resolve; }); return { ready: Promise.resolve(), finished: done, skipTransition() {} } as never; },
};

const require = createRequire(import.meta.url);
const edge = require('../src/ui/chromeEdge.ts') as typeof import('../src/ui/chromeEdge');
edge.installChromeEdge(); edge.bindEdgeTab('active');
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const paint = async () => { for (let frame = 0; frame < 12; frame++) await Promise.resolve(); };
const say = async (side: boolean) => { listener?.({ type: 'chrome-edge', side, top: false, pinned: { side: false, top: false } }); await paint(); await wait(40); };
const prime = async (side: boolean) => { listener?.({ type: 'chrome-edge-prime', prime: { top: false, side } }); await paint(); await wait(30); };
const takes = () => commands.filter(c => c.still === 'take').length, parks = () => commands.filter(c => c.still === 'park').length;
const ready = async () => { commands.length = 0; loading = false; edge.setEdgeFloatable(true, true, true); await say(false); finish?.(); await wait(80); await paint(); content.children.length = 0; commands.length = 0; };

test('a rest that is about to reveal takes the picture and places it under the page, without parking the page', async () => {
  await ready();
  await prime(true);
  assert.equal(takes(), 1, 'the picture is taken while the dwell runs');
  assert.equal(parks(), 0, 'the page stays where it is: nothing visible happens before the reveal');
  assert.equal(content.children.length, 1, 'the picture stands in the page area, under the native page');
  await say(false); await prime(false); await wait(400);
});

test('the reveal that follows finds the picture ready: it parks the page and takes no second picture', async () => {
  await ready();
  await prime(true);
  const before = takes();
  await say(true);
  assert.equal(takes(), before, 'no second capture, decode or wait for one');
  assert.equal(parks(), 1, 'only the page stepping aside is left to do');
  assert.equal(root.dataset.modeSwitch, 'edge', 'and the slide starts');
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

test('without a prime (a key, a pin, an older main) the reveal takes its picture as before', async () => {
  await ready();
  await say(true);
  assert.equal(takes(), 1);
  assert.equal(parks(), 1);
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

test('a rest that ends without a reveal lets the picture go (after a moment, so a reveal that has just fired still has it)', async () => {
  await ready();
  await prime(true);
  assert.equal(content.children.length, 1);
  await prime(false);
  assert.equal(content.children.length, 1, 'not at once');
  await wait(380);
  assert.equal(content.children.length, 0, 'gone');
  assert.equal(parks(), 0, 'the page never moved');
});

test('a picture that has stood for more than 700 ms is not used: the reveal takes a fresh one', async () => {
  await ready();
  await prime(true);
  assert.equal(takes(), 1);
  await wait(760);
  await say(true);
  assert.equal(takes(), 2, 'a stale picture would show the page as it was');
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

test('a picture taken for a page that was changed meanwhile (another tab chosen) is dropped', async () => {
  await ready();
  await prime(true);
  assert.equal(content.children.length, 1);
  edge.bindEdgeTab('another');
  assert.equal(content.children.length, 0, 'the old page\'s picture does not stay under the new page');
  edge.bindEdgeTab('active');
});

test('a page still loading is not primed (its picture would be a skeleton): the reveal does it as before', async () => {
  await ready();
  loading = true;
  await prime(true);
  assert.equal(content.children.length, 0);
  loading = false;
  await say(true);
  assert.equal(parks(), 1);
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

test('nothing is primed when the edge cannot float (an internal page, or the setting off)', async () => {
  await ready();
  edge.setEdgeFloatable(true, false, true);
  await prime(true);
  assert.equal(takes(), 0);
  edge.setEdgeFloatable(false, true, true);
  await prime(true);
  assert.equal(takes(), 0);
  edge.setEdgeFloatable(true, true, true);
});

// 13.10 (laptop: the page could stay at the wrong rectangle after an unfocused reveal until a window resize): when the float ends and the page is back at its resting place, the layout is measured and sent once more
// (the page area's own size observer only speaks when the area changes size, so a page main left elsewhere while parked was never corrected).
test('when a reveal has been taken down the interface asks for one fresh layout from the page\'s resting place', async () => {
  await ready();
  dispatched.length = 0;
  await say(true); finish?.(); await paint(); await wait(60);
  assert.equal(dispatched.filter(type => type === 'acira-page-follow-end').length, 0, 'not while the sidebar is out');
  await say(false); finish?.(); await paint(); await wait(200);
  assert.ok(dispatched.filter(type => type === 'acira-page-follow-end').length >= 1, 'once the float has ended: ' + JSON.stringify(dispatched));
});
