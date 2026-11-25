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
let commandsAtTransition = -1;

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
const commands: { still?: string; float?: unknown; tab?: string; dismiss?: string }[] = [];
let neverPark = false, loading = false, emptyTake = false, serial = 0, refuseFloat = 0, deferFloat = false, answerFloat: (() => void) | null = null, heldAtTransition = false;
g.CSS = { escape: (value: string) => value };
g.window = Object.assign(globalThis, {
  innerWidth: 1280, innerHeight: 820, devicePixelRatio: 1,
  acira: {
    subscribeBrowser: (fn: (event: unknown) => void) => { listener = fn; return () => {}; },
    browserCommand: (command: { type: string; still?: string; float?: unknown; tabId?: string; dismiss?: string }) => {
      commands.push({ still: command.still, float: command.float, tab: command.tabId, dismiss: command.dismiss });
      if (command.float === true && refuseFloat > 0) { refuseFloat--; return Promise.reject(new Error('Invalid browser command')); }
      if (command.float === true && deferFloat) return new Promise(resolve => { answerFloat = () => resolve(true); });
      if (command.still === 'park' && neverPark) return new Promise(() => { /* main never answers the park */ });
      if (command.still === 'take' && emptyTake) return Promise.resolve(null);
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
g.getComputedStyle = () => ({ getPropertyValue: () => '', backgroundImage: 'none', backgroundSize: 'auto', backgroundPosition: '0 0', backgroundRepeat: 'repeat', backgroundColor: 'rgb(0,0,0)' });
const documentListeners = new Map<string, Set<(event: unknown) => void>>();
g.document = {
  addEventListener(type: string, fn: (event: unknown) => void) { (documentListeners.get(type) ?? documentListeners.set(type, new Set()).get(type)!).add(fn); },
  removeEventListener(type: string, fn: (event: unknown) => void) { documentListeners.get(type)?.delete(fn); },
  dispatchEvent(event: { type: string }) { for (const fn of [...(documentListeners.get(event.type) ?? [])]) fn(event); return true; },
  documentElement: root, visibilityState: 'visible',
  querySelector: (selector: string) => selector === '.app' ? app : selector === '.page-area' ? { getBoundingClientRect: () => areaRect } : selector === '.page-area .page-content' ? content : null,
  querySelectorAll: (selector: string) => selector.includes('.sidebar-page-rim .rim-edge') ? [pathStub('.sidebar-page-rim-top .rim-edge'), pathStub('.sidebar-page-rim-low .rim-edge')] : [],
  startViewTransition(update: () => void) { commandsAtTransition = commands.length; heldAtTransition = root.dataset.edgeHold !== undefined; update(); const done = new Promise<void>(resolve => { finish = resolve; }); return { ready: Promise.resolve(), finished: done, skipTransition() {} } as never; },
};

// Beta 14: the Seamless sidebar floats over the live page with the Mini glass by default; these tests are the picture path (a rig turns the glass off the same way).
(globalThis as unknown as { __seamlessGlass?: boolean }).__seamlessGlass = false;
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

// 13.10 round 3 (laptop, Windows and WSLg): the interface used to be raised over the pages by an IPC sent when the slide's view transition was READY, a frame into the slide; re-adding the interface view
// stalls presentation for tens of ms there while the slide's clock runs on (the rail strip at 11 %, then 80 %; on WSLg the panel in one displayed frame). The picture's reveal raises it with the park, before the slide.
test('the reveal raises the interface together with the park, before the slide starts, and holds the other pages with it', async () => {
  await ready();
  await prime(true);
  commandsAtTransition = -1;
  await say(true);
  const before = commands.slice(0, commandsAtTransition);
  assert.ok(commandsAtTransition >= 0, 'the slide started');
  assert.ok(before.some(c => c.still === 'park'), 'the page was parked before the slide');
  assert.ok(before.some(c => c.float === true), 'and the interface raised before the slide: ' + JSON.stringify(commands));
  assert.ok(before.find(c => c.float === true)?.tab, 'with the tab id main validates every edge command against (without it main answers "Invalid browser command" and the raise never happens)');
  assert.ok(before.some(c => c.still === 'hold'), 'with the other pages held');
  assert.equal(commands.filter(c => c.float === true).length, 1, 'raised once, not again at the transition\'s ready');
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
  assert.ok(commands.some(c => c.float === false), 'and lowered when the sidebar has gone');
});

// (When a src/ui/edgeVars.ts exists, the edge's variables are read from it.)
const readVar = (name: string): string => { const own = root.style.getPropertyValue(name); if (own) return own; try { return (require('../src/ui/edgeVars.ts') as { edgeVar: (n: string) => string }).edgeVar(name) || ''; } catch { return ''; } };
test('a sidebar that comes or goes alone slides on values of its own; the top bar keeps its own', async () => {
  const {motionPace} = require('../src/ui/sharedMotion.ts') as typeof import('../src/ui/sharedMotion');
  await ready();
  await say(true);
  assert.equal(readVar('--edge-ease'), 'cubic-bezier(0.4, 0, 0.2, 1)', 'opening: a curve that starts from rest');
  assert.equal(readVar('--edge-ms'), Math.round(280 * motionPace()) + 'ms');
  finish?.(); await paint(); await say(false);
  assert.equal(readVar('--edge-ease'), 'cubic-bezier(0.8, 0, 0.6, 1)', 'closing: its reverse');
  finish?.(); await wait(80);
  listener?.({ type: 'chrome-edge', side: false, top: true, pinned: { side: false, top: false } }); await paint(); await wait(40);
  assert.equal(readVar('--edge-ease'), 'cubic-bezier(0.16, 1, 0.3, 1)', 'the toolbar: its own curve');
  finish?.(); await paint(); listener?.({ type: 'chrome-edge', side: false, top: false, pinned: { side: false, top: false } }); await paint(); await wait(40); finish?.(); await wait(80);
});

// Main answers "Invalid browser command" to an edge command it does not accept (round 3's early raise had no tab id) and the interface used to drop the answer. Now it says so, and a refused raise is not taken for a done one.
test('a raise main refuses is said in the console and left to the transition\'s ready, as before', async () => {
  const warns: string[] = [], warn = console.warn; console.warn = (...parts: unknown[]) => { warns.push(parts.join(' ')); };
  try {
    await ready();
    await prime(true);
    refuseFloat = 1;
    commands.length = 0;
    await say(true);
    assert.ok(warns.some(line => line.includes('[edge-command-failed]') && line.includes('float') && line.includes('Invalid browser command')), 'the refusal is said: ' + JSON.stringify(warns));
    assert.equal(commands.filter(c => c.float === true).length, 2, 'the early raise was refused, so the raise at the transition\'s ready is still sent: ' + JSON.stringify(commands));
    finish?.(); await paint(); await say(false); finish?.(); await wait(80);
  } finally { console.warn = warn; refuseFloat = 0; }
});

// Beta 14 (the Mac's first frame, +33..40 ms later than before round 3): the raise is sent with the park but not waited for; the transition is set up beside it and its animations wait for the answer
// (data-edge-hold, sidebar-overlay.css), so the slide starts when both are done and a stall of the raise never lands inside it.
test('the slide is set up while the raise is still out, and its animations wait for main\'s answer', async () => {
  await ready();
  await prime(true);
  deferFloat = true; answerFloat = null; heldAtTransition = false; commandsAtTransition = -1;
  await say(true);
  assert.ok(commandsAtTransition >= 0, 'the slide was set up without waiting for the raise');
  assert.ok(commands.slice(0, commandsAtTransition).some(c => c.float === true), 'the raise was sent before it');
  assert.equal(heldAtTransition, true, 'its animations are held from the start');
  assert.equal(root.dataset.edgeHold !== undefined, true, 'and still held while main has not answered');
  (answerFloat as (() => void) | null)?.(); await paint(); await wait(10);
  assert.equal(root.dataset.edgeHold, undefined, 'main answered: the slide starts');
  assert.equal(commands.filter(c => c.float === true).length, 1, 'one raise');
  deferFloat = false;
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

test('a raise main never answers holds the slide for 300 ms at most', async () => {
  await ready();
  await prime(true);
  deferFloat = true; answerFloat = null;
  await say(true);
  assert.equal(root.dataset.edgeHold !== undefined, true);
  await wait(240);
  assert.equal(root.dataset.edgeHold !== undefined, true, 'still held at 240 ms');
  await wait(120);
  assert.equal(root.dataset.edgeHold, undefined, 'the slide goes on without it');
  deferFloat = false;
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

test('a raise main refuses lets the slide go and is sent again at once', async () => {
  const warn = console.warn; console.warn = () => {};
  try {
    await ready();
    await prime(true);
    refuseFloat = 1; commands.length = 0;
    await say(true);
    await paint(); await wait(10);
    assert.equal(root.dataset.edgeHold, undefined, 'not held for an answer that said no');
    assert.equal(commands.filter(c => c.float === true).length >= 2, true, 'the raise is sent again: ' + JSON.stringify(commands));
    finish?.(); await paint(); await say(false); finish?.(); await wait(80);
  } finally { console.warn = warn; refuseFloat = 0; }
});

test('no raise is waited for when none was sent (a live float, the toolbar, a picture without a frame)', async () => {
  await ready();
  edge.setEdgeFloatable(true, true, false);
  await say(true);
  assert.equal(root.dataset.edgeHold, undefined);
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

// The hold pauses what the slide animates: with only group/old/new paused, the desktop-page layer's own hold animation (image-pair) ran ahead during the hold and the layers were out of step when the slide began (found with document.getAnimations()).
test('the hold pauses every kind of view-transition layer the edge slide animates', () => {
  const css = (require('node:fs') as typeof import('node:fs')).readFileSync(new URL('../src/styles/sidebar-overlay.css', import.meta.url), 'utf8');
  const rule = /:root\[data-edge-hold\]([^{]*)\{\s*animation-play-state:\s*paused\s*!important/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  assert.ok(rule, 'a rule that pauses the layers while data-edge-hold is set');
  const text = css.slice(css.indexOf(':root[data-edge-hold]'));
  for (const kind of ['group', 'image-pair', 'old', 'new']) assert.ok(text.includes(`::view-transition-${kind}(*)`), kind + ' layers are paused');
});

// Round 5 (laptop, 521922db2): the first reveal of a window never activated stalled for 150-200 ms with only the rail strip showing, then jumped: the reveal had NO picture (the capture came back empty or late), so the
// interface was raised at the transition's READY, inside the slide, and the first raise of a cold window stalls presentation. That raise is held for too: the layers stand at their first frame until main has answered.
test('a reveal without a picture raises the interface at the transition\'s ready and the slide waits for that answer', async () => {
  await ready();
  emptyTake = true; deferFloat = true; answerFloat = null; heldAtTransition = false; commandsAtTransition = -1;
  try {
    await say(true); await wait(320);   // (the picture is tried for up to 220 ms before the reveal goes on without one)
    assert.ok(commandsAtTransition >= 0, 'the slide was set up');
    assert.equal(heldAtTransition, true, 'its layers are held from the start, before anything has answered');
    assert.equal(commands.some(c => c.still === 'park'), false, 'no picture, no park');
    await wait(20);
    assert.equal(commands.filter(c => c.float === true).length, 1, 'the raise went out at the transition\'s ready: ' + JSON.stringify(commands));
    assert.equal(root.dataset.edgeHold !== undefined, true, 'and the slide still waits for it');
    (answerFloat as (() => void) | null)?.(); await paint(); await wait(10);
    assert.equal(root.dataset.edgeHold, undefined, 'main answered: the slide starts');
  } finally { emptyTake = false; deferFloat = false; }
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

test('the step trace says where a reveal spent its time (ACIRA_EDGE_TRACE)', async () => {
  const warns: string[] = [], warn = console.warn; console.warn = (...parts: unknown[]) => { warns.push(parts.join(' ')); };
  root.dataset.edgeTrace = 'on';
  try {
    await ready();
    await prime(true);
    await say(true);
    finish?.(); await paint(); await wait(30);
    const line = warns.find(w => w.startsWith('[edge-step]'));
    assert.ok(line, 'a line per reveal: ' + JSON.stringify(warns));
    for (const key of ['edge', 'park-sent', 'parks-answered', 'picture', 'transition-start']) assert.ok(line!.includes(`"${key}"`), key + ' in ' + line);
    await say(false); finish?.(); await wait(80);
  } finally { console.warn = warn; delete root.dataset.edgeTrace; }
});

// macOS windowed Seamless (13.10 follow-up, earlier work "Seen, not fixed"): the real traffic lights are native buttons that cannot slide, and they were turned on in the layout that starts the top bar's reveal, so
// they stood alone at their place while the bar was still sliding in. `topLanding` is the interface's "the top bar's slide is still playing" (App.tsx keeps `captionHidden` on until it ends; a hide hides them at its first layout).
const top = (on: boolean) => listener?.({ type: 'chrome-edge', side: false, top: on, pinned: { side: false, top: false } });
test('the lights wait for the top bar: topLanding is on from the reveal\'s update until its slide has finished, and the render that update causes already sees it', async () => {
  await ready();
  assert.equal(edge.topLandingNow(), false);
  top(true); await paint(); await wait(40);
  assert.equal(root.dataset.modeSwitch, 'edge', 'the slide is playing');
  assert.equal(edge.topLandingNow(), true, 'the lights stay off while the bar slides in');
  assert.equal(edge.currentEdge().top, true, 'and the toolbar itself is already shown');
  finish?.(); await paint(); await wait(20);
  assert.equal(edge.topLandingNow(), false, 'the slide has landed: the lights may come (App re-renders on this change)');
  top(false); await paint(); await wait(40);
  assert.equal(edge.topLandingNow(), false, 'a hide has no landing: the lights go with its first layout');
  finish?.(); await wait(80);
});

test('no landing for a toolbar a key or the address field asks for, nor for a sidebar-only reveal', async () => {
  await ready();
  await say(true);
  assert.equal(edge.topLandingNow(), false, 'the sidebar alone never delays the lights');
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
  edge.setEdgeAsks(true, false); await paint(); await wait(40);
  top(true); await paint(); await wait(40);
  assert.equal(edge.topLandingNow(), false, 'asked for (Ctrl+L, a new tab, the address field): as before');
  finish?.(); await paint(); top(false); await paint(); await wait(40); finish?.(); edge.setEdgeAsks(false, false); await wait(80);
});

test('a slide that never finishes does not keep the lights away for ever (1.8 s)', async () => {
  await ready();
  top(true); await paint(); await wait(40);
  assert.equal(edge.topLandingNow(), true);
  await wait(1900);
  assert.equal(edge.topLandingNow(), false);
  finish?.(); await paint(); top(false); await paint(); await wait(40); finish?.(); await wait(80);
});

test('the layout carries it: captionHidden stays on while the top bar lands, on macOS windowed Seamless only, and the hook is read by App', () => {
  const fs = require('node:fs') as typeof import('node:fs'), app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const lightsLate = useTopLanding\(\) && topSeam && !topBarHidden && !windowFullscreen && \(document\.documentElement\.dataset\.platform \|\| 'darwin'\) === 'darwin';/);
  assert.match(app, /\.\.\.\(topBarHidden && !captionNotch \? \{ captionHidden: true, captionFloat: true \} : \{\}\), \.\.\.\(\(lightsLate \|\| addrLightsGone\) && !captionNotch \? \{ captionHidden: true \} : \{\}\)/, 'the same flag, without the float, while the bar lands');
  assert.match(app, /windowFullscreen,captionNotch,lightsLate,addrLightsGone,/, 'the layout is sent again when the lights are let in');
});

// D135 (22 Nov): a press on the sidebar button that landed in the one-time warm-up (data-edge-warming=real, ~0.7 s, first two minutes after launch) did nothing: the warm-up's own `edge.side` was taken for a hover
// sidebar, the handler sent a dismiss and returned. The warm-up is no edge for anything that reads the edge as the person's (chromeEdge.ts currentEdge / useRealEdge); a real input lets it go first.
const warmEdge = require('../src/ui/edgeWarm.ts') as typeof import('../src/ui/edgeWarm');
const mode = require('../src/ui/layoutMode.ts') as typeof import('../src/ui/layoutMode');
const dismisses = () => commands.filter(c => c.dismiss).length;
const startWarm = async () => {
  await ready();
  for (let i = 0; i < 4 && !edge.edgeQuiet(); i++) { finish?.(); await paint(); await wait(40); }   // what an earlier test left (a transition not finished) settles first
  assert.equal(edge.edgeQuiet(), true, 'a quiet window to start from');
  warmEdge.resetEdgeWarm(); root.dataset.edgeWarm = 'real'; edge.setEdgeWarmReal(true);
  warmEdge.scheduleEdgeWarm({ quiet: edge.edgeQuiet, real: edge.playWarmReveal }, 5, 5, 3); await wait(60);
  assert.equal(warmEdge.edgeWarmState(), 'running'); assert.equal(root.dataset.edgeWarming, 'real'); assert.equal(root.dataset.modeSwitch, 'edge');
  commands.length = 0;
};
const afterWarm = async () => { finish?.(); await paint(); await wait(30); warmEdge.resetEdgeWarm(); delete root.dataset.edgeWarm; };
test('while the warm-up plays the interface\'s edge store says a sidebar is out (its own mounting needs that) but the edge as the person has it says none, and a dismiss sends nothing', async () => {
  await startWarm();
  assert.equal(edge.edgeQuiet(), false, 'the raw edge is out: the real sidebar is mounted');
  assert.equal(edge.currentEdge().side, false); assert.equal(edge.currentEdge().top, false);
  edge.dismissEdge('side'); edge.dismissEdge('top'); await paint();
  assert.equal(dismisses(), 0, 'no dismiss for a sidebar nobody asked for: ' + JSON.stringify(commands));
  await afterWarm();
  assert.equal(edge.currentEdge().side, false, 'and afterwards');
});

test('INPUT sidebar button: a press into the warm-up lets it go first and then asks the edge as the person has it: no hover sidebar, so the press toggles as it always does', async () => {
  await startWarm();
  assert.equal(mode.pressOnSidebarButton(false), 'toggle', 'not a hover sidebar: the handler goes on to toggle');
  assert.equal(root.dataset.edgeWarming, undefined, 'the warm-up is gone in the same call'); assert.equal(root.dataset.modeSwitch, undefined, 'and its transition mark with it: the toggle gets its own transition');
  assert.equal(warmEdge.edgeWarmState(), 'done'); assert.equal(edge.edgeQuiet(), true, 'the raw edge is back where it was: the mounted sidebar is gone');
  assert.equal(mode.pressOnSidebarButton(true), 'toggle', 'a docked sidebar: the press closes it by the toggle, as before');
  await afterWarm();
});

test('D163 INPUT sidebar button: a press on a REAL hover sidebar DOCKS it (the spec\'s "Toggle/shortcut = docked"), it never closes it into a dead end: no dismiss is sent', async () => {
  await ready();
  await say(true);
  assert.equal(edge.currentEdge().side, true);
  commands.length = 0;
  assert.equal(mode.pressOnSidebarButton(false), 'dock', 'only the hover sidebar is out: the press docks it (the handler opens the docked sidebar)');
  await paint();
  assert.equal(dismisses(), 0, 'nothing tells main to let the hover sidebar go: it becomes the docked one');
  assert.equal(mode.pressOnSidebarButton(true), 'toggle', 'once docked, the next press closes it as today');
  finish?.(); await paint(); await say(false); finish?.(); await wait(80);
});

test('INPUT a real edge (the pointer, a tab drag to the edge, a key) that arrives while it plays lets it go, and the reveal that follows is the real one', async () => {
  await startWarm();
  await say(true);   // main says: the sidebar edge is shown
  assert.equal(root.dataset.edgeWarming, undefined, 'the warm-up let go'); assert.equal(warmEdge.edgeWarmState(), 'done');
  assert.equal(edge.currentEdge().side, true, 'the real edge is what the person has now');
  finish?.(); await paint(); await say(false); finish?.(); await wait(80); warmEdge.resetEdgeWarm(); delete root.dataset.edgeWarm;
});

test('INPUT keyboard shortcut / menu item / the top bar\'s toggle / the Mini rail\'s expand: each is a state change that starts a layout transition, and any transition lets the warm-up go before it captures', async () => {
  await startWarm();
  (g.document as { dispatchEvent(e: unknown): void }).dispatchEvent({ type: 'acira-transition-start' });   // sharedMotion.ts startModeTransition says this first
  assert.equal(root.dataset.edgeWarming, undefined); assert.equal(root.dataset.modeSwitch, undefined, 'the mark is gone before startModeTransition looks for it');
  assert.equal(edge.edgeQuiet(), true);
  await afterWarm();
});

test('the readers of the edge store, as a table: only App.tsx and layoutMode.ts (the sidebar\'s mounting) read it, so the Mini rail, the top bar\'s toggle, the menus and the shortcuts cannot take the warm-up for an edge', () => {
  const fs = require('node:fs') as typeof import('node:fs'), path = require('node:path') as typeof import('node:path');
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src'), hits: string[] = [];
  const walk = (d: string) => { for (const name of fs.readdirSync(d)) { const full = path.join(d, name); if (fs.statSync(full).isDirectory()) walk(full); else if (/\.(ts|tsx)$/.test(name) && /\b(useChromeEdge|useRealEdge|currentEdge)\b/.test(fs.readFileSync(full, 'utf8'))) hits.push(path.relative(dir, full)); } };
  walk(dir);
  assert.deepEqual(hits.sort(), ['App.tsx', 'ui/chromeEdge.ts', 'ui/layoutMode.ts'], 'a new reader of the edge must say what it does while the warm-up plays (D135): ' + hits.join(', '));
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /const realEdge = useRealEdge\(\), sidebarPeeking = realEdge\.side && !workspaceOpen;/, 'Escape and the peek read the person\'s edge');
  assert.match(app, /escapeRef\.current = \(\) => \{\n\s*abortEdgeWarm\(\);/, 'Escape lets the warm-up go first');
  assert.match(app, /pressOnSidebarButton\(workspaceOpen\);\n\s*\/\/ 13\.5: from where the last press meant the sidebar to be/, 'the button: a real input (the warm-up lets go first), then the toggle docks or closes');
  assert.doesNotMatch(app, /dismissEdge\('side'\); return; \}/, 'D163: the button never closes the hover sidebar');
  assert.match(app, /label=\{workspaceOpen \? tr\("app\.collapseSidebar"\) : tr\("app\.expandSidebar"\)\}/, 'D163: "Expand sidebar" while only the hover sidebar is out'); assert.match(app, /<ToolbarIcon name=\{workspaceOpen \? 'sidebar' : 'sidebarClosed'\}\/>/, 'the icon follows the docked sidebar, so it never blinks for the warm-up either');
  assert.match(app, /realEdge\.side \? tr\('windowview\.sidebarShown'\)/, 'a screen reader is not told a sidebar is shown for the warm-up');
});

test('D138: in any view but Seamless (Full, Compact, Focus, Mini, Hide the toolbar) the real warm-up is not played: it would draw the hover sidebar\'s layout for 0.3 s; the layers play instead, with no edge state of their own', async () => {
  await ready();
  for (let i = 0; i < 4 && !edge.edgeQuiet(); i++) { finish?.(); await paint(); await wait(40); }
  warmEdge.resetEdgeWarm(); root.dataset.edgeWarm = 'real'; edge.setEdgeWarmReal(false);
  assert.equal(edge.playWarmReveal(), null, 'no real reveal');
  assert.equal(edge.edgeQuiet(), true, 'and nothing was started');
  let asked = 0, answered: unknown = 'not asked';
  warmEdge.scheduleEdgeWarm({ quiet: edge.edgeQuiet, real: () => { asked++; answered = edge.playWarmReveal(); return answered as never; } }, 5, 5, 3); await wait(60);
  assert.equal(asked, 1, 'the warm-up asked for the real reveal'); assert.equal(answered, null, 'and was told no: it falls to the synthetic layers (this harness has no DOM to build them in)');
  assert.notEqual(root.dataset.edgeWarming, 'real', 'no real reveal'); assert.equal(root.dataset.modeSwitch, undefined, 'no transition of the edge kind'); assert.equal(edge.currentEdge().side, false);
  await afterWarm(); edge.setEdgeWarmReal(true);
  const fs = require('node:fs') as typeof import('node:fs'), app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /setEdgeWarmReal\(seamless\);/, 'App says it each render: the real reveal only in the Seamless view');
});

// D143 (a Discord tester on Windows: Ctrl+Shift+E in Seamless with the tabs in the sidebar "doesn't work"): the rule, in Seamless a press of the shortcut (main pins or unpins the side edge) ALWAYS ends with the sidebar showing, or
// gone if it was showing, never with no visible result. The interface's part is applyEdge: whatever the one-time warm-up is doing, the pin that main sends wins and the edge ends where main says.
const pin = (side: boolean, pinned: boolean) => listener?.({ type: 'chrome-edge', side, top: false, pinned: { side: pinned, top: false } });
test('D143: a pin sent while the warm-up plays shows the sidebar (the warm-up lets go first), and the unpin that follows takes it away: no press without a result', async () => {
  await startWarm();
  assert.equal(edge.currentEdge().side, false, 'nothing is showing for the person');
  pin(true, true); await paint(); await wait(40);
  assert.equal(warmEdge.edgeWarmState(), 'done', 'the warm-up let go'); assert.equal(root.dataset.edgeWarming, undefined);
  assert.equal(edge.currentEdge().side, true, 'the pinned sidebar shows'); assert.equal(edge.currentEdge().pinned.side, true);
  finish?.(); await paint(); await wait(40);
  pin(false, false); await paint(); await wait(40); finish?.(); await paint(); await wait(40);
  assert.equal(edge.currentEdge().side, false, 'unpinned: gone'); assert.equal(edge.currentEdge().pinned.side, false);
  await afterWarm();
});

test('D143: every press ends with a result, whatever state the warm-up and the edge are in (the truth table of the button\'s decision and of the pin)', async () => {
  for (const warm of [false, true]) for (const hover of [false, true]) for (const docked of [false, true]) {
    if (warm) await startWarm(); else { await ready(); for (let i = 0; i < 4 && !edge.edgeQuiet(); i++) { finish?.(); await paint(); await wait(40); } }
    if (hover && !warm) { await say(true); finish?.(); await paint(); }
    const decision = mode.pressOnSidebarButton(docked);
    // the button's results (D163): dock the hover sidebar, or toggle the docked one (open or close): exactly one of them, never "nothing", never a dead end
    const result = docked ? 'toggle' : (hover && !warm) ? 'dock' : 'toggle';
    assert.equal(decision, result, JSON.stringify({ warm, hover, docked }));
    assert.equal(root.dataset.edgeWarming, undefined, 'a press never leaves the warm-up running: ' + JSON.stringify({ warm, hover, docked }));
    if (hover && !warm) { await say(false); finish?.(); await wait(60); }
    await afterWarm();
  }
});

// D143 (reported: "make sure in 14.2 it's done"; a Discord tester on Windows: the shortcut that shows the sidebar in Seamless does nothing): the picture path set `picturing` and `edgeBusy` and cleared them only when `takePicture()` came
// back; takePicture awaited main's answers to its parks with no bound, so a park that never answered left both set for good and every later edge request (a pin, an unpin, the pointer) was only kept as `pendingEdge`. Now the answers
// are waited for within the picture's deadline (failed picture: the pages are released, the reveal goes on without the still picture), and a watchdog ends a busy period that is still open after 1.5 s (a view transition that
// never finishes). Each test below was run against the unfixed source and fails there.
const quiet = async () => { for (let i = 0; i < 6 && !edge.edgeQuiet(); i++) { finish?.(); await paint(); await wait(40); } };
test('D143: a park that main never answers: the reveal still comes (without the still picture) within a deadline, the pages are released, and the person\'s next request is applied', async () => {
  await ready(); await quiet(); neverPark = true; commands.length = 0;
  try {
    await say(true); await wait(450);
    assert.equal(edge.currentEdge().side, true, 'the sidebar shows although the park was never answered');
    assert.ok(commands.some(c => c.still === 'park'), 'the park was sent');
    assert.ok(commands.some(c => c.still === 'release' || c.float === false), 'and undone: the pages are released (still release, or the early raise lowered): ' + JSON.stringify(commands));
    finish?.(); await paint(); await wait(40);
    await say(false); finish?.(); await paint(); await wait(80); await quiet();
    assert.equal(edge.currentEdge().side, false, 'the next request (the sidebar goes) is applied, not kept behind the first');
    assert.equal(edge.edgeQuiet(), true, 'and the edge is not busy for ever');
  } finally { neverPark = false; }
});

test('D143: the shortcut\'s pin and unpin that come while a pointer reveal\'s park is still waiting: the last request wins and nothing is left busy (a pin alone shows the sidebar)', async () => {
  // (a pin docks the sidebar and takes no picture of its own: what it can meet is a pointer reveal whose park was never answered, the case that left every later press without effect)
  await ready(); await quiet(); neverPark = true;
  try {
    await say(true);                       // the pointer reveals; its park waits
    pin(true, true); pin(false, false);    // the shortcut twice while it waits: the last one counts
    await paint(); await wait(500); finish?.(); await paint(); await wait(60); finish?.(); await paint(); await wait(60); await quiet();
    assert.equal(edge.currentEdge().side, false, 'pin then unpin: gone'); assert.equal(edge.currentEdge().pinned.side, false); assert.equal(edge.edgeQuiet(), true, 'nothing left busy');
    await say(true); pin(true, true); await paint(); await wait(500); finish?.(); await paint(); await wait(60);
    assert.equal(edge.currentEdge().side, true, 'a pin alone: the sidebar shows'); assert.equal(edge.currentEdge().pinned.side, true);
    pin(false, false); await paint(); await wait(60); finish?.(); await paint(); await wait(80); await quiet();
    assert.equal(edge.currentEdge().side, false); assert.equal(edge.edgeQuiet(), true);
  } finally { neverPark = false; }
});

test('D143: a view transition that never finishes: the watchdog ends the busy period after 1.5 s and applies the request that waited', async () => {
  await ready(); await quiet();
  const warns: string[] = [], warn = console.warn; console.warn = (...parts: unknown[]) => { warns.push(parts.join(' ')); };
  try {
    await say(true);                                  // the reveal's transition starts and is never finished by this test
    await say(false);                                 // the person presses again: kept while busy
    assert.equal(edge.edgeQuiet(), false, 'busy: nothing applied yet');
    await wait(1750);
    assert.equal(edge.currentEdge().side, false, 'the watchdog let go and the waiting request (gone) was applied');
    assert.ok(warns.some(line => line.includes('[edge-busy-watchdog]') && line.includes('transition')), 'and said so: ' + JSON.stringify(warns));
    finish?.(); await paint(); await wait(60); await quiet();
    assert.equal(edge.edgeQuiet(), true, 'and the edge is quiet again once the last transition ends');
  } finally { console.warn = warn; }
});

test('D143: a window that never paints (no animation frame ever comes): the picture still resolves (paintWait has its own 50 ms timer), so this was never the stuck place', async () => {
  await ready(); await quiet();
  const raf = g.requestAnimationFrame; g.requestAnimationFrame = () => 0;
  try { await say(true); await wait(450); assert.equal(edge.currentEdge().side, true, 'the sidebar shows'); }
  finally { g.requestAnimationFrame = raf; finish?.(); await paint(); await wait(40); await say(false); finish?.(); await wait(80); await quiet(); }
});

test('D143: the source: the park answers are within the deadline, the busy periods are guarded once, and the watchdog is 1.5 s', () => {
  const fs = require('node:fs') as typeof import('node:fs'), src = fs.readFileSync(new URL('../src/ui/chromeEdge.ts', import.meta.url), 'utf8');
  assert.match(src, /const results = late\(\) \? \[\] : await within\(Promise\.all\(work\), \[\] as boolean\[\]\);/);
  assert.match(src, /const BUSY_MAX = 1500;/);
  assert.match(src, /const pictured = guardedBusy\('picture'/); assert.match(src, /const settledOnce = guardedBusy\('transition', settled\);/);
  assert.match(src, /\[edge-busy-watchdog\]/);
});
