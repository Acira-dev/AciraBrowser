import test from 'node:test';
import assert from 'node:assert/strict';

// A layout switch in the interface (the sidebar docking or leaving) is a view transition; the native page's glide must start at its ready
// boundary, not when the layout is first computed, or the page runs ahead of the card it sits in (5 to 16 pt, a doubled layer, Compact, 1 Nov).
const g = globalThis as unknown as Record<string, unknown>;
function stage() {
  const dataset: Record<string, string> = {};
  let readyResolve!: () => void;
  const ready = new Promise<void>(resolve => { readyResolve = resolve; });
  const root = { dataset, hasAttribute: () => false, style: { setProperty() {}, getPropertyValue: () => '' } };
  g.document = { documentElement: root, visibilityState: 'visible', querySelector: () => null, startViewTransition(update: () => void) { update(); return { ready, finished: ready } as never; } };
  g.window = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) };
  g.matchMedia = () => ({ matches: false });
  return { ready: readyResolve };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('with no layout switch under way a layout is sent at once', async () => {
  stage();
  const { sendWhenLayoutSwitchReady } = await import('../src/ui/sharedMotion');
  const sent: string[] = []; const log = (v: string) => { sent.push(v); };
  sendWhenLayoutSwitchReady(() => log('a'));
  assert.deepEqual(sent, ['a']);
});

test('during a layout switch the latest layout waits for the transition to be ready, and only the latest is sent', async () => {
  const { ready } = stage();
  const { sendWhenLayoutSwitchReady, startModeTransition } = await import('../src/ui/sharedMotion');
  startModeTransition(() => {}, 'layout');
  const sent: string[] = []; const log = (v: string) => { sent.push(v); };
  sendWhenLayoutSwitchReady(() => log('first')); sendWhenLayoutSwitchReady(() => log('second'));
  await tick(); assert.deepEqual(sent, [], 'not before the snapshot is ready');
  ready(); await tick(); await tick();
  assert.deepEqual(sent, ['second'], 'the newest layout, once');
  sendWhenLayoutSwitchReady(() => log('after')); assert.deepEqual(sent, ['second', 'after'], 'afterwards, at once again');
});

test('a transition that never says it is ready cannot hold a layout for long', async () => {
  stage();
  const { sendWhenLayoutSwitchReady, startModeTransition } = await import('../src/ui/sharedMotion');
  startModeTransition(() => {}, 'layout');
  const sent: string[] = []; const log = (v: string) => { sent.push(v); };
  sendWhenLayoutSwitchReady(() => log('x'));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(sent, ['x']);
});

test('an edge or appearance switch does not gate the layout (Seamless times its own page against the same boundary)', async () => {
  stage();
  const { sendWhenLayoutSwitchReady, startModeTransition } = await import('../src/ui/sharedMotion');
  startModeTransition(() => {}, 'edge');
  const sent: string[] = []; const log = (v: string) => { sent.push(v); };
  sendWhenLayoutSwitchReady(() => log('x'));
  assert.deepEqual(sent, ['x']);
});
