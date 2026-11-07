// Founder, 6 Nov 2026: switching between window views glitches. What the interface does about it (the page's own part is tests/page-motion-exact.test.cjs):
// 1. a layout switch asked for while another transition plays waits for it to land and then plays as a morph of its own (it used to run at once under the first one's layers while main
//    glided the page from where it stood: the layout jumped, the page lagged); snapshots wait behind it, and main's confirmation of a switch already on screen is not a second one;
// 2. the mini tab strip (Compact and Focus, tabs on top) shows only its new picture when it is in both frames (the crossfade drew every button twice, one copy over the other);
// 3. the controls that leave while the page's top edge rises (entering Seamless) ride up with it on its spring instead of being wiped over.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const morph = strip(read('../src/styles/view-morph.css'));
const rule = (selector: string) => [...morph.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim(), m[2].trim()] as const).filter(([s]) => s === selector);

test('the mini tab strip: in both frames only the new picture shows; the lone old picture keeps its opacity for the leave animation', () => {
  assert.deepEqual(rule(':root:root[data-mode-switch=layout]::view-transition-old(acira-mini-tabs)').map(r => r[1]), ['animation:none;opacity:0']);
  assert.deepEqual(rule(':root:root[data-mode-switch=layout]::view-transition-new(acira-mini-tabs)').map(r => r[1]), ['animation:none;opacity:1']);
  assert.deepEqual(rule(':root:root[data-mode-switch=layout]::view-transition-old(acira-mini-tabs):only-child').map(r => r[1]), ['opacity:1']);
  assert.ok(!morph.includes('acira-mini-tabs):not(:only-child)'), '`:not(:only-child)` does not match these pseudo-elements: the rule would never apply');
});

test('a control that leaves while the page rises rides up on the page\'s spring, still fading and shrinking', () => {
  assert.ok(rule('@keyframes acira-control-rise').length === 0 && /@keyframes acira-control-rise\{to\{translate:0 calc\(var\(--page-rise, 0px\) \* -1\)\}\}/.test(morph));
  const [, body] = rule(':root[data-mode-switch=layout][data-page-rise]::view-transition-old(*.acira-control):only-child')[0];
  assert.match(body, /acira-control-leave,var\(--page-rise-ms, 289ms\) var\(--page-rise-ease, linear\) both acira-control-rise$/);
});

const g = globalThis as unknown as Record<string, unknown>;
function stage() {
  const values = new Map<string, string>(), dataset: Record<string, string> = {};
  let top = 32, finish!: () => void, ready!: () => void, starts = 0;
  const readyPromise = new Promise<void>(resolve => { ready = resolve; }), finished = new Promise<void>(resolve => { finish = resolve; });
  g.document = {
    documentElement: { dataset, hasAttribute: (name: string) => name === 'data-mode-switch' && 'modeSwitch' in dataset, style: { setProperty: (k: string, v: string) => values.set(k, v), removeProperty: (k: string) => values.delete(k), getPropertyValue: (k: string) => values.get(k) ?? '' } },
    visibilityState: 'visible',
    querySelector: (selector: string) => selector === '.page-content' ? { getBoundingClientRect: () => ({ left: 0, top, width: 1000, height: 600, right: 1000, bottom: top + 600 }) } : null,
    startViewTransition(update: () => void) { starts++; update(); return { ready: readyPromise, finished } as never; },
  };
  g.window = { innerHeight: 720, setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) };
  g.matchMedia = () => ({ matches: false });
  return { values, dataset, starts: () => starts, ready, finish, setTop: (v: number) => { top = v; } };
}

test('a layout switch is playing from its start until its layers are gone, and whenModeSwitchSettled waits for exactly that', async () => {
  const { startModeTransition, modeSwitchPlaying, whenModeSwitchSettled } = await import('../src/ui/sharedMotion');
  const s = stage();
  assert.equal(modeSwitchPlaying(), false);
  startModeTransition(() => {}, 'layout');
  assert.equal(modeSwitchPlaying(), true);
  let settled = false; void whenModeSwitchSettled().then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(settled, false, 'still playing');
  s.ready(); s.finish();
  await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(settled, true); assert.equal(modeSwitchPlaying(), false);
});

test('with nothing playing, whenModeSwitchSettled is already settled', async () => {
  const { whenModeSwitchSettled } = await import('../src/ui/sharedMotion');
  await Promise.race([whenModeSwitchSettled(), new Promise((_, reject) => setTimeout(() => reject(new Error('waited for nothing')), 100))]);
});

test('the page\'s rise over the toolbar row is measured around the update, and cleared when the switch has played', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const s = stage(); s.setTop(32);
  startModeTransition(() => s.setTop(6), 'layout');
  assert.equal(s.values.get('--page-rise'), '26px'); assert.ok('pageRise' in s.dataset);
  assert.match(s.values.get('--page-rise-ease') ?? '', /^linear\(|^cubic-bezier|^linear$/); assert.match(s.values.get('--page-rise-ms') ?? '', /^\d+ms$/);
  s.ready(); s.finish();
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(s.values.has('--page-rise'), false); assert.ok(!('pageRise' in s.dataset));
});

test('a rise under 8 px (Full to Compact: the toolbar is 4 px lower) leaves the controls where they are', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const s = stage(); s.setTop(36);
  startModeTransition(() => s.setTop(32), 'layout');
  assert.equal(s.values.has('--page-rise'), false);
  s.ready(); s.finish();
});

test('client.ts queues a layout switch behind a playing transition, in order, and does not treat main\'s confirmation as another switch', () => {
  const client = read('../src/runtime/client.ts');
  assert.match(client, /if\(kind==='layout'&&\(queuedLayouts>0\|\|modeSwitchPlaying\(\)\)\)\{queuedLayouts\+\+;modeUpdatePending=true;layoutQueue=layoutQueue\.then\(\(\)=>whenModeSwitchSettled\(\)\)\.then\(\(\)=>\{queuedLayouts--;startSwitch\(update,'layout',slideHint\);\}\);return;\}/);
  assert.match(client, /modeUpdatePending=queuedLayouts>0;update\(\);/, 'snapshots keep waiting while a switch is queued');
  assert.match(client, /const shownNow=latest\.current;[\s\S]*?if\(sidebarLayoutChanged\(shownNow,next\)\|\|chromeLayoutChanged\(shownNow,next\)\)modeSwitch\(/, 'a snapshot that matches what is on screen is applied as it is');
});

test('a layout the switch\'s gate has not sent yet hands its slide to the one that supersedes it (a popup closing under the switch re-renders it, and the page jumped instead of gliding)', () => {
  const app = read('../src/App.tsx');
  assert.match(app, /const samePageRef = \(a\?: PageRect \| null, b\?: PageRect \| null\): boolean => !!a && !!b && a\.x === b\.x && a\.y === b\.y && a\.width === b\.width && a\.height === b\.height;/);
  assert.match(app, /if \(moving \|\| \(morph && !s\.reducedMotion\)\) unsentSlide\.current = \{ page, fields \}; else if \(unsentSlide\.current && samePageRef\(unsentSlide\.current\.page, page\)\) fields = unsentSlide\.current\.fields; else unsentSlide\.current = null;/);
  assert.equal((app.match(/sendWhenLayoutSwitchReady\(\(\) => \{ if \(samePageRef\(unsentSlide\.current\?\.page, physical\.pageBounds\)\) unsentSlide\.current = null; runtime\.setBrowserLayout\(physical\); \}, slidesOnSidebarCurve\(physical\)\)/g) || []).length, 3, 'every send clears it when it goes out');
});
