import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { EDGE_BAND, EDGE_SPEED, createEdgeScroller, edgeSpeed } from '../src/ui/dragEdgeScroll';

/** Dragging a tab near the end of the sidebar list or a strip scrolls it, as in Chrome and Arc (ui/dragEdgeScroll). */
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('Edge scroll speed: nothing in the middle, creeping at the band\'s inner edge, full speed at the edge, signed by direction', () => {
  assert.equal(edgeSpeed(300, 100, 700), 0);
  assert.equal(edgeSpeed(100 + EDGE_BAND, 100, 700), 0, 'the band starts there');
  assert.ok(edgeSpeed(100 + EDGE_BAND - 4, 100, 700) < 0 && edgeSpeed(100 + EDGE_BAND - 4, 100, 700) > -EDGE_SPEED * .05, 'a few px in: a slow creep up');
  assert.equal(edgeSpeed(100, 100, 700), -EDGE_SPEED);
  assert.equal(edgeSpeed(700, 100, 700), EDGE_SPEED);
  assert.ok(edgeSpeed(700 - EDGE_BAND / 2, 100, 700) === EDGE_SPEED / 4, 'halfway into the band: a quarter (squared)');
  assert.equal(edgeSpeed(760, 100, 700), EDGE_SPEED, 'a strip keeps going with the pointer past its end');
  assert.equal(edgeSpeed(760, 100, 700, 'none'), 0, 'the sidebar stops: past its list are other drop targets');
  assert.equal(edgeSpeed(40, 100, 700, 'none'), 0);
  assert.ok(edgeSpeed(105, 100, 160) < 0 && edgeSpeed(130, 100, 160) === 0, 'a short list shares its length between both bands');
});

test('Edge scroller: scrolls on frames while the pointer rests in a band, reports each step, stops at the end of the list and when told to', async t => {
  const frames: ((now: number) => void)[] = [];
  const g = globalThis as unknown as { requestAnimationFrame: (fn: (now: number) => void) => number; cancelAnimationFrame: (id: number) => void };
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  g.requestAnimationFrame = fn => frames.push(fn); g.cancelAnimationFrame = id => { if (id) frames[id - 1] = () => {}; };
  t.after(() => { g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf; });
  const node = { scrollTop: 0, scrollHeight: 1000, clientHeight: 400, scrollLeft: 0, scrollWidth: 0, clientWidth: 0, getBoundingClientRect: () => ({ top: 100, bottom: 500, left: 0, right: 200 }) };
  const steps: number[] = [];
  const scroller = createEdgeScroller({ axis: 'y', beyond: 'none', scroller: () => node as unknown as HTMLElement, onStep: delta => steps.push(delta) });
  let now = 0;
  const run = () => { const next = frames.splice(0); for (const fn of next) fn(now += 16); };
  scroller.update(300); run();
  assert.equal(node.scrollTop, 0, 'in the middle nothing moves'); assert.equal(frames.length, 0, 'and no frames keep running');
  scroller.update(499); for (let i = 0; i < 10; i++) run();
  assert.ok(node.scrollTop > 50, `scrolled down while resting at the bottom: ${node.scrollTop}`); assert.equal(steps.length, 10, 'each frame reports its step');
  for (let i = 0; i < 200; i++) run();
  assert.equal(node.scrollTop, 600, 'stops at the end of the list'); assert.equal(frames.length, 0);
  scroller.update(101); run(); run(); assert.ok(node.scrollTop < 600, 'back up at the top');
  scroller.stop(); const at = node.scrollTop; run(); assert.equal(node.scrollTop, at, 'stopped'); assert.equal(frames.filter(Boolean).length <= 1, true);
});

test('Edge scroll keeps a strip\'s carried tab under the pointer: motion\'s drag follows a scrolling ancestor by itself (an upgrade that drops this fails here)', () => {
  const pan = read('node_modules/framer-motion/dist/es/gestures/pan/PanSession.mjs');
  assert.match(pan, /startScrollTracking\(element\)/, 'a drag tracks the scroll of its overflow:auto ancestors (both strip viewports are, when the drag starts)');
  assert.match(pan, /\/\/ Element scroll: pageX\/pageY unchanged, so adjust history origin\s*if \(this\.history\.length > 0\) \{\s*this\.history\[0\]\.x -= delta\.x;/, 'and moves its origin by the scrolled distance');
  assert.match(pan, /frame\.update\(this\.updatePoint, true\)/, 'then reports a move: onDrag runs and Reorder reads the slot under the pointer');
  for (const file of ['src/components/BrowserTabs.css', 'src/components/CompactTabs.css']) assert.match(read(file), /viewport\{[^}]*overflow-x:auto;/, `${file}: the viewport scrolls (auto) until the drag hides its overflow`);
});

test('Edge scroller: the sidebar list\'s end is the bottom of its active-tab peek when one is pinned there, so the band barely moves when the peek comes or goes', () => {
  const frames: ((now: number) => void)[] = [];
  const g = globalThis as unknown as { requestAnimationFrame: (fn: (now: number) => void) => number; cancelAnimationFrame: (id: number) => void };
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  g.requestAnimationFrame = fn => frames.push(fn); g.cancelAnimationFrame = () => {};
  try {
    let bottom = 584, peek: { top: number; bottom: number } | null = { top: 588, bottom: 616 };
    const node = { scrollTop: 100, scrollHeight: 2000, clientHeight: 480, getBoundingClientRect: () => ({ top: 100, bottom, left: 0, right: 200 }) };
    const scroller = createEdgeScroller({ axis: 'y', beyond: 'none', scroller: () => node as unknown as HTMLElement, span: () => ({ start: 100, end: peek ? peek.bottom : bottom }) });
    let now = 0; const run = () => { for (const fn of frames.splice(0)) fn(now += 16); };
    scroller.update(604); run(); run();
    const onPeek = node.scrollTop; assert.ok(onPeek > 100, 'on the peek it scrolls');
    peek = null; bottom = 620; run(); run();// the active tab came into view: the peek is gone, the list is 36px taller
    assert.ok(node.scrollTop > onPeek, 'the same resting pointer still scrolls');
    scroller.update(640); run(); const at = node.scrollTop; run(); assert.equal(node.scrollTop, at, 'below the list (the Bookmarks jump): nothing');
    assert.equal(edgeSpeed(640, 100, 620, 'none'), 0);
  } finally { g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf; }
});

test('Edge scroller: stops at its limit (the sidebar\'s last tab), short of the scroller\'s own end', () => {
  const frames: ((now: number) => void)[] = [];
  const g = globalThis as unknown as { requestAnimationFrame: (fn: (now: number) => void) => number; cancelAnimationFrame: (id: number) => void };
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  g.requestAnimationFrame = fn => frames.push(fn); g.cancelAnimationFrame = () => {};
  try {
    const node = { scrollTop: 0, scrollHeight: 1500, clientHeight: 500, getBoundingClientRect: () => ({ top: 100, bottom: 600, left: 0, right: 200 }) };
    const scroller = createEdgeScroller({ axis: 'y', beyond: 'none', scroller: () => node as unknown as HTMLElement, limit: () => ({ min: 0, max: 700 }) });
    scroller.update(598); let now = 0; for (let i = 0; i < 400 && frames.length; i++) for (const fn of frames.splice(0)) fn(now += 16);
    assert.equal(node.scrollTop, 700, 'the list ends at 700 even though the scroller goes to 1000'); assert.equal(scroller.scrolled, 700);
  } finally { g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf; }
});

test('Edge scroll is wired into the sidebar list, the top strip and the compact strip (sideways drags only in the strips)', () => {
  const sidebar = read('src/components/sidebar/AciraSidebar.tsx'), strip = read('src/components/BrowserTabsHorizontal.tsx'), compact = read('src/components/CompactTabs.tsx');
  assert.match(sidebar, /createEdgeScroller\(\{axis:'y',beyond:'none',band:64,scroller:\(\)=>list\.current\?\.closest<HTMLElement>\('\.sb-scroll'\)\?\?null,\s*span:node=>\{/);
  assert.match(sidebar, /querySelector<HTMLElement>\(':scope>\.sb-active-peek'\)/, 'the active-tab peek belongs to the list\'s ends');
  assert.match(sidebar, /limit:node=>\{const tabs=list\.current\?\.getBoundingClientRect\(\);return \{min:0,max:tabs\?node\.scrollTop\+tabs\.bottom-node\.getBoundingClientRect\(\)\.bottom:Infinity\};\}/, 'no further than the last tab (the saved pages below are a bookmark drop)');
  assert.match(sidebar, /onStep:\(\)=>\{if\(lastMove&&drag\.current\?\.moved\)move\(lastMove\);\}\}\);/, 'each step reads the drop under the resting pointer again');
  assert.match(sidebar, /lastMove=next;if\(inSidebar\)scrollEdge\.update\(point\.y\);else scrollEdge\.stop\(\);/);
  assert.match(sidebar, /const off=\(\)=>\{scrollEdge\.stop\(\);/, 'the release, a cancel, Esc and a blur all end it');
  assert.match(sidebar, /return point\.y>box\.bottom&&point\.y<=peek\.bottom\?\{x:point\.x,y:box\.bottom-2\}:point\.y<box\.top&&point\.y>=peek\.top\?\{x:point\.x,y:box\.top\+2\}:point;/, 'a drop on the peek where the scroll rests is a drop at that end of the list');
  assert.equal(sidebar.match(/tabDropAtPoint\(list\.current,listPoint\(point\),/g)?.length, 3, 'every drop read of a tab drag goes through it');
  assert.equal(sidebar.match(/splitMoveAt\(listPoint\(point\),/g)?.length, 2, 'and of a split row');
  assert.match(sidebar, /const seen=zone\.closest<HTMLElement>\('\.sb-scroll'\)\?\.getBoundingClientRect\(\);\s*return point\.x>=hit\.left&&point\.x<=hit\.right&&point\.y>=hit\.top&&point\.y<=hit\.bottom&&\(!seen\|\|point\.y>=seen\.top&&point\.y<=seen\.bottom\);\}/, 'the saved pages are a drop only where they are seen: scrolled under the peek they saved a bookmark nobody saw being made');
  for (const [name, source] of [['strip', strip], ['compact', compact]] as const) {
    assert.ok(source.includes("L.edge.current=createEdgeScroller({axis:'x',scroller:()=>live.current.viewport.current});"), `${name}: one scroller per drag, on the strip's viewport`);
    assert.ok(source.includes("if(axis==='x'&&!L.dragCancelled.current)L.edge.current?.update(moved.point.x);else L.edge.current?.stop();"), `${name}: only a sideways drag scrolls the strip`);
    assert.equal(source.match(/L\.edge\.current\?\.stop\(\);L\.edge\.current=null;/g)?.length, 2, `${name}: stopped on release and on a cancelled pointer`);
  }
  assert.ok(compact.includes(",scrolled=!!L.edge.current?.scrolled;"), 'compact: the release knows the strip scrolled under the tab');
  assert.ok(compact.includes('else if(raw&&scrolled)/* the strip scrolled under the tab faster than the live reorder followed: it lands in the slot under the pointer */onGroupAction?.(raw);'), 'and lands it in the slot under the pointer');
});
