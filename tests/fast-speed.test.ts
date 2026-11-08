import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classScales, fastPace, kick, motionPaceOf, motionTokens, springFor, springForFrequent, type MotionTokenId } from '../src/ui/motionTokens';
import { motionScales, stripSeconds } from '../src/ui/sharedMotion';
import { cascadeDelay, classStretch, riseFor } from '../src/ui/splitMotion';

// Fast is snappy, like Chrome and Arc (a reviewer, 2 Nov: "animations are way too slow. the difference between 'premium' and 'fast' is
// barely noticeable"): 0.6 of the base durations (Fast's before 2 Nov) for spatial and effects motion, the same springs stiffer, their
// bounce kept. Premium (1.7 / 1.4) and Off are unchanged; latency-bound motion (press, hover, drag follow) is 1 at every speed.
const here = path.dirname(fileURLToPath(import.meta.url)), read = (file: string) => fs.readFileSync(path.join(here, '..', file), 'utf8');
const ms = (id: MotionTokenId, speed: 'fast' | 'premium') => Math.round(springFor(id, speed)!.duration * 1000);

test('the speed table: Fast .6 for spatial and effects motion, latency-bound 1; Premium and Off as before', () => {
  assert.deepEqual(classScales.fast, { S: .6, E: .6, L: 1 });
  assert.deepEqual(classScales.premium, { S: 1.7, E: 1.4, L: 1 });
  assert.deepEqual(classScales.off, { S: 0, E: 0, L: 0 });
  assert.deepEqual(motionScales, { premium: 1.7, fast: .6, off: 0 });
  assert.deepEqual(kick, { fast: .15, premium: .4, off: 0 }, 'the launch kick, a share of the spring, keeps the shape');
});

test('every spring at Fast is .6 of its base (5 ms grid), stiffer with the same bounce; L springs are the base', () => {
  for (const [id, [cls, base, bounce]] of Object.entries(motionTokens) as [MotionTokenId, readonly [string, number, number]][]) {
    const fast = springFor(id, 'fast')!, want = cls === 'L' ? base : base * .6;
    assert.ok(Math.abs(fast.duration - want) <= .0025 + 1e-9, `${id}: ${fast.duration} for ${want}`);
    assert.equal(fast.bounce, bounce, `${id} keeps its bounce`);
    if (cls !== 'L') assert.ok(springFor(id, 'premium')!.duration / fast.duration > 2.2, `${id}: Fast is clearly quicker than Premium`);
  }
});

test('the named surfaces at Fast, in ms (before: the base)', () => {
  const table: [MotionTokenId, number, number][] = [
    // menus and popups
    ['menu.grow', 170, 100], ['menu.content', 130, 80], ['menu.shrink', 115, 70], ['menu.fade', 85, 50], ['popover.grow', 210, 125],
    // the tab viewer, toasts, Seamless's edges, panels, workspaces, reorder
    ['tabViewer.open', 190, 115], ['tabViewer.close', 140, 85], ['toast.in', 310, 185], ['toast.out', 150, 90], ['toast.stack', 225, 135],
    ['seamless.reveal', 315, 190], ['seamless.hide', 170, 100], ['panel.expand', 210, 125], ['panel.collapse', 150, 90],
    ['workspace.slide', 130, 80], ['reorder.move', 150, 90], ['materialize', 170, 100],
  ];
  for (const [id, before, after] of table) {
    assert.equal(Math.round(motionTokens[id][1] * 1000), before, `${id} base`);
    assert.equal(ms(id, 'fast'), after, `${id} at Fast`);
  }
  // The tab strip, the compact strip and the sidebar rows (a frequent surface): 480 ms before, 288 now; Premium 614 as before.
  assert.equal(Math.round(stripSeconds('fast') * 1000), 288);
  assert.equal(Math.round(stripSeconds('premium') * 1000), 614);
  assert.equal(springForFrequent('menu.grow', 'fast')!.duration, springFor('menu.grow', 'fast')!.duration, 'a frequent surface at Fast is plain Fast');
});

test('CSS reads the same scale: --motion-pace is published, the tooltip and the layout crossfade follow --motion-scale', () => {
  const shared = read('src/ui/sharedMotion.ts'), app = read('src/App.tsx'), transient = read('src/styles/transient.css');
  assert.match(shared, /style\.setProperty\('--motion-pace', String\(motionPaceOf\(speed\)\)\);/);
  assert.match(app, /'--motion-pace': motionPaceOf\(motionSpeedValue\)/);
  assert.match(transient, /--motion-tooltip: calc\(140ms \* min\(var\(--motion-scale, 1\), 1\.3\)\);/, 'the tooltip: 84 ms at Fast');
  assert.match(transient, /view-transition-group\(\*\) \{\n  animation-duration: calc\(240ms \* var\(--motion-scale, 1\)\);/, 'the frame crossfade: 144 ms at Fast');
});

test('Fast\'s pace for set-length motion is half of Premium (beta.14 item 16); the spring tokens stay at .6', () => {
  assert.equal(fastPace, .5);
  assert.deepEqual([motionPaceOf('premium'), motionPaceOf('fast'), motionPaceOf('off')], [1, .5, 1]);
  assert.equal(classScales.fast.S, .6, 'tokens are not touched');
});

test('the split surfaces read the same classes: effects .6 at Fast (not 1 − .4 × 4/7), cascades quicken, rows rise 3 px', () => {
  assert.equal(classStretch('menu.grow', .6), .6);
  assert.equal(classStretch('menu.fade', .6), .6);
  assert.equal(classStretch('drag.follow', .6), 1);
  assert.ok(Math.abs(classStretch('menu.fade', 1.7) - 1.4) < 1e-9, 'Premium as before');
  assert.ok(Math.abs(cascadeDelay(0, .6) - .018) < 1e-9 && Math.abs(cascadeDelay(20, .6) - .078) < 1e-9, 'Fast: 18 ms, then 7.2 ms a row, capped at 60');
  assert.ok(Math.abs(cascadeDelay(0, 1.7) - .05) < 1e-9 && Math.abs(cascadeDelay(20, 1.7) - .21) < 1e-9, 'Premium as before');
  assert.equal(riseFor(.6), 3);
});

test('main and the windows it draws carry the same Fast: the side panel, page dissolves, the search chip, Peek\'s cascade', () => {
  const main = read('desktop/main.cjs');
  assert.match(main, /speed==='off'\?0:speed==='fast'\?\.6:1\.7;\}/, 'the extension side panel');
  assert.match(main, /const stillScale=\(\)=>state\.settings\.animationSpeed==='fast'\?\.6:1\.7,/, 'the page dissolve and the new tab still');
  assert.match(read('desktop/browser-services/search-preview-preload.cjs'), /answer\?\.speed==='fast'\?\.6:1\.7;/, 'the search preview chip');
  assert.match(read('desktop/rewind/peek-frame.html'), /const content=speed==='premium'\?50:30\*SCALES\[speed\]\.S,/, 'Peek: the bar waits 18 ms at Fast');
  // tab-card.html, site-prompt.html and peek-frame.html carry the whole table: tests/peek-frame.test.ts keeps them equal to the app's.
  for (const file of ['desktop/tab-card.html', 'desktop/site-prompt.html', 'desktop/rewind/peek-frame.html']) assert.ok(read(file).includes('fast:{S:.6,E:.6,L:1}'), file);
});

test('motions with a set length on the named surfaces quicken in Fast with --motion-pace, and keep their Premium length', () => {
  const pace = (css: string, rule: string, durations: string[]) => {
    const at = css.indexOf(rule); assert.ok(at >= 0, rule);
    const block = css.slice(at, css.indexOf('}', at));
    for (const d of durations) assert.ok(block.includes(`calc(${d} * var(--motion-pace, 1))`), `${rule}: ${d} at the pace`);
  };
  pace(read('src/frost-preview.css'), '.browser-tab[data-entering=true]', ['.26s']);
  pace(read('src/frost-preview.css'), '.ed-rail-button::after', ['140ms']);
  const ntp = read('src/styles/new-tab-page.css');
  pace(ntp, '.nt-vapor {', ['240ms']); assert.ok(ntp.includes('calc(var(--nt-i, 0) * 50ms * var(--motion-pace, 1))'), 'the stagger too');
  pace(ntp, '.nt-art { position', ['240ms']); pace(ntp, '.nt-art > img { display', ['600ms']); pace(ntp, '.nt-frame-wrap {', ['240ms', '200ms']);
  pace(ntp, '.nt-art[data-state=ready] > img[data-current]', ['360ms']); pace(ntp, '.nt-collection > svg', ['200ms']);
  const toast = read('src/styles/artwork-toast.css');
  for (const d of ['220ms', '120ms', '90ms']) assert.ok(toast.includes(`calc(${d} * var(--motion-pace, 1))`), `artwork toast ${d}`);
  assert.doesNotMatch(toast, /animation: artwork-toast[\w-]* \d/, 'no artwork toast motion keeps a set length');
  const rating = read('src/features/metrics/rating.css');
  assert.ok(rating.includes('rc-in calc(420ms * var(--motion-pace, 1))') && rating.includes('rc-out calc(220ms * var(--motion-pace, 1))'));
  assert.ok(read('src/styles/menu-form.css').includes('menu-form-enter calc(160ms * var(--motion-pace, 1))'));
  assert.match(read('src/ui/useMenuFormBackdrop.ts'), /\{duration:160\*motionPace\(\),easing/);
  const drag = read('src/ui/sidebarTabDrag.ts');
  assert.equal((drag.match(/180\*motionPace\(\)/g) ?? []).length, 2, 'making room and giving it back');
  assert.match(drag, /duration:140\*motionPace\(\)/); assert.match(drag, /duration:380\*motionPace\(\)/);
  const peek = read('desktop/rewind/peek-frame.html');
  assert.match(peek, /root\.style\.setProperty\('--pace',String\(speed==='fast'\?SCALES\.fast\.S:1\)\);/);
  assert.ok(peek.includes('transition:opacity calc(160ms * var(--pace, 1))') && peek.includes('transition:opacity calc(220ms * var(--pace, 1)) var(--strong),transform calc(220ms * var(--pace, 1))'));
});
