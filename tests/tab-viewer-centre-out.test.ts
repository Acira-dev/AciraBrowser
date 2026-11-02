import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { formationFrames, formationLayerPaint, restingFormation } from '../src/ui/sheetFormation';
import { springFor } from '../src/ui/motionTokens';
import { centreOutDelays, centreOutPull, springCurve, tabViewerOrigin, tabViewerScale } from '../src/ui/tabViewerMotion';

// Founder, 27 Oct: "the tab viewer is opening from top to bottom with the animation. Just let it open from center outwards."
const surface = fs.readFileSync(new URL('../src/components/SheetPopupSurface.tsx', import.meta.url), 'utf8');
const motion = fs.readFileSync(new URL('../src/ui/tabViewerMotion.ts', import.meta.url), 'utf8');

test('the tab viewer pivots on its centre, whatever opened it', () => {
  assert.deepEqual({ ...tabViewerOrigin }, { x: .5, y: .5 });
  // The formation origin of the tab viewer ignores the pointer's `from` (the toolbar button sits at the top).
  assert.match(surface, /formationOrigin=sceneKey\.endsWith\(':tabs'\)\?tabViewerOrigin:from\?\?geometry\.origin/);
  assert.match(surface, /'--formation-origin':`calc\(24px \+ \(100% - 48px\) \* \$\{formationOrigin\.x\}\) calc\(24px \+ \(100% - 48px\) \* \$\{formationOrigin\.y\}\)`/);
});

test('no clip, wipe or sweep: the tab viewer never runs the aperture', () => {
  assert.match(surface, /const aperture=!quiet&&!switching&&!tabViewer&&/);
  assert.doesNotMatch(motion, /clip-?path|inset\(/i);
});

test('the sheet scales from ~96% to 1 and back into the centre on the tabViewer springs', () => {
  assert.ok(tabViewerScale >= .94 && tabViewerScale <= .98, `scale ${tabViewerScale}`);
  assert.match(surface, /enterScale:tabViewer\?tabViewerScale:\.985,exitScale:tabViewer\?tabViewerScale:\.98/);
  assert.match(surface, /springFor\(opening\?'tabViewer\.open':'tabViewer\.close',speed\)/);
  for (const speed of ['fast', 'premium'] as const) {
    for (const opening of [true, false]) {
      const spec = springFor(opening ? 'tabViewer.open' : 'tabViewer.close', speed)!;
      const curve = springCurve(spec, opening ? .2 : 0);
      const plan = formationFrames({ start: restingFormation, closing: !opening, switching: false, reversing: false, duration: curve.duration, firstDelay: 0, stagger: 0, count: 0, blur: 0, enterScale: tabViewerScale, exitScale: tabViewerScale, exitBlur: 0, enterOpacity: .9, rowStart: 1, curve: curve.at });
      const first = plan.at(0), last = plan.final;
      if (opening) {
        assert.equal(first['--formation-scale'], tabViewerScale);
        assert.equal(last['--formation-scale'], 1);
        assert.equal(last['--formation-opacity'], 1);
      } else {
        assert.equal(first['--formation-scale'], 1);
        assert.equal(last['--formation-scale'], tabViewerScale);
        assert.equal(last['--formation-opacity'], 0);
      }
      // Scale only moves one way (no overshoot past rest), and nothing is offset: it grows and shrinks about the centre.
      let previous = first['--formation-scale'];
      for (let ms = 0; ms <= plan.duration; ms += 4) {
        const paint = plan.at(ms), scale = paint['--formation-scale'];
        assert.ok(opening ? scale >= previous - 1e-9 : scale <= previous + 1e-9, `${speed} ${opening ? 'open' : 'close'} scale at ${ms}ms`);
        assert.equal(paint['--formation-y'], 0);
        assert.match(formationLayerPaint(paint, 1).plane.transform, /^translateY\(0px\) scale\(/);
        previous = scale;
      }
    }
  }
  // Premium is slower than Fast; Off has no spring (the reduced fade).
  assert.ok(springCurve(springFor('tabViewer.open', 'premium')!).duration > springCurve(springFor('tabViewer.open', 'fast')!).duration);
  assert.equal(springFor('tabViewer.open', 'off'), null);
});

test('rows form from the middle outwards, never top to bottom', () => {
  assert.match(surface, /cascade\(node,\{haze:!quick,quick,upward:geometry\.origin\.y===1,scale:stretch,centreOut:tabViewer\}\)/);
  // A sheet 600px tall: header and search at the top, 9 rows, the footer at the bottom (offsets from the centre, top to bottom).
  const offsets = [-280, -240, -180, -120, -60, 0, 60, 120, 180, 240, 285];
  const delays = centreOutDelays(offsets, 300, 150);
  const middle = offsets.indexOf(0);
  assert.equal(delays[middle], 0, 'the middle row is first');
  assert.equal(Math.min(...delays), delays[middle]);
  // Symmetric: rows equally far above and below start together.
  for (const [a, b] of [[-60, 60], [-120, 120], [-180, 180], [-240, 240]]) assert.equal(delays[offsets.indexOf(a)], delays[offsets.indexOf(b)]);
  // Radiates outwards on both sides: delays fall toward the middle from the top and rise again toward the bottom.
  for (let i = 1; i <= middle; i++) assert.ok(delays[i] <= delays[i - 1], `above the middle, row ${i}`);
  for (let i = middle + 1; i < delays.length; i++) assert.ok(delays[i] >= delays[i - 1], `below the middle, row ${i}`);
  // The old top-first order would make every delay grow down the list; the first (top) row must not be the earliest.
  assert.ok(delays[0] > delays[middle] && delays[delays.length - 1] > delays[middle]);
  // Capped at the sheet's edge, so rows scrolled out of view never stretch the formation.
  assert.equal(centreOutDelays([900, -900], 300, 150).every(delay => delay === 150), true);
  // Each row starts nearer the centre and travels outwards (capped), the middle row not at all.
  assert.ok(centreOutPull(-200) > 0 && centreOutPull(200) < 0);
  assert.equal(centreOutPull(0), 0);
  assert.ok(Math.abs(centreOutPull(10000)) <= 6);
});
