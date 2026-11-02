import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The docked sidebar's slide is a bare transform, which runs on the compositor; the page card, the toolbar and a page the interface draws (a new tab, Settings) move on the
// main thread's clock. The slide ran a frame ahead of them (a whole stall ahead when the interface thread was busy as the glide began), so the opaque card stood under the glass
// sidebar for a few frames: a darker band against the sidebar's edge, most in dark (founder, 1 Nov). While such a page follows the layout switch, the slide takes the same clock.
const here = path.dirname(fileURLToPath(import.meta.url)), read = (file: string) => fs.readFileSync(path.join(here, '..', file), 'utf8');
const g = globalThis as unknown as Record<string, unknown>;

test('while a drawn page follows a layout switch, the sidebar\'s slide runs on the main thread\'s clock; a website keeps the compositor\'s', () => {
  const morph = read('src/styles/view-morph.css');
  for (const [pseudo, name, from, to] of [['old', 'leave', 'none', 'translateX\\(-100%\\)'], ['new', 'arrive', 'translateX\\(-100%\\)', 'none']]) {
    assert.ok(new RegExp(`:root\\[data-page-follow\\]\\[data-mode-switch=layout\\]::view-transition-${pseudo}\\(acira-sidebar\\):only-child\\{animation-name:acira-sidebar-${name}-follow\\}`).test(morph), `${pseudo}: the follow slide is named under data-page-follow`);
    const keyframes = new RegExp(`@keyframes acira-sidebar-${name}-follow\\{from\\{transform:${from};outline-offset:[^}]*\\}to\\{transform:${to};outline-offset:[^}]*\\}\\}`);
    assert.ok(keyframes.test(morph), `${name}: the same slide plus an animated property the compositor cannot take`);
    assert.ok(new RegExp(`@keyframes acira-sidebar-${name}\\{from\\{transform:${from}\\}to\\{transform:${to}\\}\\}`).test(morph), `${name}: the compositor's slide stays for a website`);
  }
});

function stage(rects: Array<{ left: number; top: number; width: number; height: number }>) {
  const dataset: Record<string, string> = {}, style: Record<string, string> = {};
  let finish!: () => void;
  let read = 0;
  const content = { style, getBoundingClientRect: () => rects[Math.min(read++, rects.length - 1)], animate: () => ({ finished: new Promise<void>(resolve => { finish = resolve; }), cancel() {} }) };
  let ready!: () => void, finished!: () => void;
  const readyPromise = new Promise<void>(resolve => { ready = resolve; }), finishedPromise = new Promise<void>(resolve => { finished = resolve; });
  g.document = { documentElement: { dataset, hasAttribute: () => false, style: { setProperty() {}, getPropertyValue: () => '' } }, visibilityState: 'visible', querySelector: (selector: string) => (selector.includes('.page-content') ? content : null), startViewTransition(update: () => void) { update(); return { ready: readyPromise, finished: finishedPromise } as never; } };
  g.window = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) };
  g.matchMedia = () => ({ matches: false });
  return { dataset, ready, finished };
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('a layout switch marks the page as following for as long as the transition lasts, and only when the drawn page moves', async () => {
  const { startModeTransition } = await import('../src/ui/sharedMotion');
  const moving = stage([{ left: 0, top: 36, width: 1152, height: 700 }, { left: 240, top: 36, width: 906, height: 700 }]);
  startModeTransition(() => {}, 'layout');
  assert.equal(moving.dataset.pageFollow, '', 'set with the update, so the first frame of the transition already has the main thread\'s slide');
  moving.ready(); await tick();
  assert.equal(moving.dataset.pageFollow, '', 'still set while it runs');
  moving.finished(); await tick(); await tick();
  assert.equal(moving.dataset.pageFollow, undefined, 'gone with the transition (a changing animation name would restart the slide)');

  const still = stage([{ left: 240, top: 36, width: 906, height: 700 }]);
  startModeTransition(() => {}, 'layout');
  assert.equal(still.dataset.pageFollow, undefined, 'a page that does not change size or place does not follow');
  const none = stage([]); g.document = { ...(g.document as object), querySelector: () => null } as never;
  startModeTransition(() => {}, 'layout');
  assert.equal(none.dataset.pageFollow, undefined, 'a website (no drawn page content) keeps the compositor\'s slide');
});
