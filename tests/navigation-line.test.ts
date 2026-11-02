import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CALM_MS, FADE_MS, Line, PROGRESS_MS, lineStep } from '../src/ui/navigationLine';

// What the painter does on every tab update: ask the rule, then act on the line.
function drive(line: Line, before: { loading: boolean; progress?: number }, tab: { loading: boolean; progress?: number }, now: number, web = true) {
  const step = lineStep({ ...tab, web, error: false }, before, line);
  if (step === 'begin') line.begin(tab.progress ?? .05, now);
  else if (step === 'advance') line.set(tab.progress!, now);
  else if (step === 'finish') line.finish(now);
  else if (step === 'cancel') line.cancel(now);
  return step;
}
/** Frames at 16 ms until `until`, as the painter's loop would run them while the line animates. */
function run(line: Line, from: number, until: number) {
  let now = from;
  for (; now <= until; now += 16) { line.tick(now); if (!line.animating(now)) break; }
  line.tick(now);
  return now;
}

test('the main frame stopping loading ends the line: it runs to the end, exits, and is over', () => {
  const line = new Line();
  let before = { loading: false } as { loading: boolean; progress?: number };
  assert.equal(drive(line, before, { loading: true, progress: .1 }, 0), 'begin'); before = { loading: true, progress: .1 };
  assert.equal(drive(line, before, { loading: true, progress: .7 }, 300), 'advance'); before = { loading: true, progress: .7 };
  assert.equal(drive(line, before, { loading: false, progress: 1 }, 800), 'finish');
  assert.equal(line.finishing, true);
  assert.equal(line.active, true, 'the exit animation is still to run');
  const over = run(line, 800, 800 + PROGRESS_MS + FADE_MS + 200);
  assert.equal(line.active, false, 'the line is over once its exit has faded');
  assert.ok(over - 800 <= PROGRESS_MS + FADE_MS + 100, `over within the run to the end and the fade, not later (${over - 800} ms)`);
  assert.equal(line.animating(over + 16), false, 'no frames are asked for any more');
});

test('the end animation: the exit starts once the run to the end passes 90 percent and the line fades out', () => {
  const line = new Line();
  line.begin(.5, 0); line.finish(100);
  line.tick(100); assert.equal(line.fadeAt, 0, 'at 50 percent the exit has not started');
  line.tick(100 + PROGRESS_MS); assert.ok(line.fadeAt > 0, 'at the end of the run the exit has started');
  assert.equal(line.fade(line.fadeAt), 1, 'the exit starts at full opacity');
  const mid = line.fade(line.fadeAt + FADE_MS / 2); assert.ok(mid > 0 && mid < 1, 'it fades through the middle');
  assert.equal(line.fade(line.fadeAt + FADE_MS), 0, 'and ends invisible');
  line.tick(line.fadeAt + FADE_MS); assert.equal(line.active, false);
  // Reduced motion: no run and no fade, the line is simply gone.
  const calm = new Line(); calm.reduced = true; calm.begin(.5, 0); calm.finish(100); calm.tick(100); calm.tick(100);
  assert.equal(calm.active, false, 'reduced motion ends the line at once');
});

test('a cancelled or failed load exits where it is and does not run to the end', () => {
  const line = new Line();
  drive(line, { loading: false }, { loading: true, progress: .4 }, 0);
  assert.equal(drive(line, { loading: true, progress: .4 }, { loading: false }, 1000), 'cancel');
  assert.ok(line.target < .5, 'it exits at its own position');
  run(line, 1000, 1000 + FADE_MS + 100);
  assert.equal(line.active, false);
  const failed = new Line(); drive(failed, { loading: false }, { loading: true, progress: .4 }, 0);
  assert.equal(lineStep({ loading: false, progress: 1, web: true, error: true }, { loading: true, progress: .4 }, failed), 'cancel', 'a failed page never runs to the end');
});

test('work after the load (long poll, event stream, beacons, a subframe) cannot bring a finished line back', () => {
  const line = new Line();
  drive(line, { loading: false }, { loading: true, progress: .1 }, 0);
  drive(line, { loading: true, progress: .1 }, { loading: false, progress: 1 }, 500);
  run(line, 500, 1500);
  assert.equal(line.active, false);
  // The tab stays not loading while the page keeps talking; progress is cleared after the end, then nothing arrives that is a navigation.
  let before: { loading: boolean; progress?: number } = { loading: false, progress: 1 };
  for (const tab of [{ loading: false }, { loading: false }, { loading: false, progress: undefined }] as { loading: boolean; progress?: number }[]) {
    assert.equal(drive(line, before, tab, 2000), 'none'); before = tab;
  }
  assert.equal(line.active, false, 'still over');
  // Late progress numbers, and a duplicate finish, do nothing to a line that is over.
  line.set(.3, 3000); line.finish(3000); line.cancel(3000); line.tick(3100);
  assert.equal(line.fadeAt === 0 || line.active === false, true);
});

test('a line that has stopped moving rests (no frames) and still ends when the main frame finishes', () => {
  const line = new Line();
  line.begin(.2, 0);
  assert.equal(line.animating(CALM_MS - 10), true, 'a moving load animates');
  assert.equal(line.animating(CALM_MS + 10), false, 'a load that stopped moving rests and asks for no frames');
  assert.equal(line.active, true, 'but it is still on screen: the page is still loading');
  line.finish(CALM_MS + 100);
  assert.equal(line.animating(CALM_MS + 110), true, 'finishing wakes it');
  run(line, CALM_MS + 110, CALM_MS + 110 + PROGRESS_MS + FADE_MS + 100);
  assert.equal(line.active, false);
});

test('a new navigation shows the line again, also straight after one finished and mid-exit, and a replacement load restarts it', () => {
  const line = new Line();
  drive(line, { loading: false }, { loading: true, progress: .1 }, 0);
  drive(line, { loading: true, progress: .1 }, { loading: false, progress: 1 }, 400);
  run(line, 400, 1400);
  assert.equal(line.active, false);
  assert.equal(drive(line, { loading: false, progress: 1 }, { loading: true, progress: .1 }, 5000), 'begin');
  assert.equal(line.active, true); assert.equal(line.finishing, false);
  // A navigation that starts while the previous exit is still fading takes the line over.
  drive(line, { loading: true, progress: .1 }, { loading: false, progress: 1 }, 5500);
  line.tick(5500 + PROGRESS_MS);
  assert.equal(drive(line, { loading: false, progress: 1 }, { loading: true, progress: .1 }, 5500 + PROGRESS_MS + 50), 'begin');
  assert.equal(line.finishing, false); assert.equal(line.fadeAt, 0); assert.equal(line.active, true);
  // A replacement or redirect load that restarts far below where the line is begins again; a small step back does not.
  drive(line, { loading: false }, { loading: true, progress: .8 }, 9000);
  assert.equal(lineStep({ loading: true, progress: .1, web: true, error: false }, { loading: true, progress: .8 }, line), 'begin');
  assert.equal(lineStep({ loading: true, progress: .78, web: true, error: false }, { loading: true, progress: .8 }, line), 'advance');
  // A line that is over also begins when the tab is loading but the line is not active (the load started before this line mounted).
  assert.equal(lineStep({ loading: true, progress: .5, web: true, error: false }, { loading: true, progress: .4 }, { active: false }), 'begin');
});

test('the painter ends the line at the element: cleared in device pixels, hidden, and no frame loop for a line that is over', () => {
  const source = fs.readFileSync(path.resolve('src/components/NavigationProgress.tsx'), 'utf8'), css = fs.readFileSync(path.resolve('src/styles/navigation-progress.css'), 'utf8');
  assert.match(source, /ctx\.setTransform\(1, 0, 0, 1, 0, 0\); ctx\.clearRect\(0, 0, node\.width, node\.height\)/, 'every device pixel is cleared before drawing');
  assert.match(source, /if \(!state\.active\) \{ node\.dataset\.active = "false"; return; \}/, 'a line that is over is marked inactive');
  assert.match(source, /if \(state\.animating\(now\)\) frame\.current = requestAnimationFrame/, 'frames are scheduled only while the line animates');
  assert.match(css, /\.navigation-progress\[data-active="false"\] \{ visibility: hidden; \}/, 'an inactive line is hidden outright');
});
