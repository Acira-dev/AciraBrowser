import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UPDATE_LINE, inkOf, lineColumns, lineDot, lineLit, lineLookOf, lineTarget, shineAt, shineHead } from '../src/ui/updateLine';
import { PILL_LINE } from '../src/ui/addressInSidebar';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the update shows on the line as downloading (dots), held (paused or stopped) or ready (the accent); anything else leaves the line as it was', () => {
  assert.equal(lineLookOf('downloading'), 'run');
  assert.equal(lineLookOf('paused'), 'held');
  assert.equal(lineLookOf('error'), 'held', 'a download that stopped is held, as the Update pill\'s dots are');
  assert.equal(lineLookOf('ready'), 'ready');
  assert.equal(lineLookOf(null), null, 'no update, or one that is only being looked for: the line is what it always was');
  assert.equal(lineLookOf(undefined), null);
});

test('the dots follow the real progress and keep the pill\'s rules: at least one lit, every dot at 100%, the next one blinking at half', () => {
  const columns = lineColumns(PILL_LINE.width);
  assert.equal(columns, 24, 'the 96 px line holds 24 dots on the 4 px pitch');
  assert.equal(lineColumns(PILL_LINE.hoverWidth), 31, 'under the pointer the line is 124 px: it gains dots, the pitch stays');
  assert.equal(lineLit(0, columns), 1); assert.equal(lineLit(.5, columns), 12); assert.equal(lineLit(1, columns), 24);
  assert.equal(lineLit(2, columns), 24, 'clamped'); assert.equal(lineLit(-1, columns), 1);
  const lit = (progress: number, seconds = 0) => Array.from({ length: columns }, (_, c) => lineTarget('run', seconds, c, columns, progress, false));
  assert.equal(lit(.5).filter(value => value === 1).length, 12);
  assert.deepEqual(lit(.5, .1)[12], .5, 'the next dot blinks at half...');
  assert.deepEqual(lit(.5, .3)[12], 0, '...and goes dark again');
  assert.equal(lit(1).filter(value => value === 1).length, columns); assert.ok(lit(1).every(value => value === 1), 'at 100% there is no next dot');
  assert.equal(lineTarget('run', .1, 12, columns, .5, true), .5, 'still: the next dot stays at half, it does not blink');
  assert.equal(lineTarget('run', .3, 12, columns, .5, true), .5);
  assert.equal(lineTarget('held', .1, 12, columns, .5, false), 0, 'held: nothing blinks');
});

test('the shine runs along the whole line in a sweep and rests between sweeps', () => {
  const columns = 24, sweep = UPDATE_LINE.sweepMs / 1000, cycle = sweep + UPDATE_LINE.restMs / 1000;
  const start = shineHead(0, columns)!, middle = shineHead(sweep / 2, columns)!, end = shineHead(sweep - 1e-6, columns)!;
  assert.ok(start <= -UPDATE_LINE.reach + 1e-9 && end >= columns + UPDATE_LINE.reach - 1e-3, 'it starts and ends outside the line, so it enters and leaves whole');
  assert.ok(Math.abs(middle - columns / 2) < .5, 'eased symmetrically: the middle of the sweep is the middle of the line');
  assert.equal(shineHead(sweep + .1, columns), null, 'a rest');
  assert.equal(shineHead(cycle, columns), shineHead(0, columns), 'and it repeats');
  let last = -Infinity; for (let s = 0; s < sweep; s += .05) { const head = shineHead(s, columns)!; assert.ok(head >= last, 'never goes back'); last = head; }
  assert.equal(shineAt(null, 5), 0);
  assert.ok(shineAt(10, 10) > .99, 'the head is the brightest');
  assert.ok(shineAt(10, 9) > shineAt(10, 11), 'with a longer tail behind it than light in front');
  assert.ok(shineAt(10, 11) < .5 && shineAt(10, 2) < .1, 'and the line far from it is untouched');
});

test('a dot\'s light: lit over the grid, brightened and swelled under the shine, the fill still readable under it', () => {
  const grid = lineDot(0, 0), lit = lineDot(1, 0);
  assert.ok(Math.abs(grid.alpha - UPDATE_LINE.grid) < 1e-9); assert.ok(Math.abs(lit.alpha - UPDATE_LINE.lit) < 1e-9); assert.equal(grid.swell, 0); assert.equal(lit.swell, 0);
  assert.ok(lineDot(1, 1).alpha > lit.alpha && lineDot(1, 1).alpha <= 1 && lineDot(1, 1).swell === UPDATE_LINE.swell);
  assert.ok(lineDot(0, 1).alpha > grid.alpha, 'the shine passes the grid too');
  assert.ok(lineDot(0, 1).alpha < lineDot(1, 1).alpha, 'but takes a dot of the grid only half as far, so the fill reads under it');
  assert.ok(lineDot(.5, 0).alpha > grid.alpha && lineDot(.5, 0).alpha < lit.alpha, 'a dot easing in is between the two');
});

test('the ink is read from the line\'s own token, with spaces or commas', () => {
  assert.deepEqual(inkOf('37 38 43'), [37, 38, 43]); assert.deepEqual(inkOf(' 255, 255, 255'), [255, 255, 255]); assert.deepEqual(inkOf('rgb(10, 20, 30)'), [10, 20, 30]);
  assert.equal(inkOf(''), null); assert.equal(inkOf('var(--x)'), null);
});

test('the line is shown from the sidebar\'s pill and nowhere else, and speed Off / reduced motion get the still dots', () => {
  const more = read('../src/components/AddressMore.tsx'), line = read('../src/features/updates/UpdateLine.tsx');
  assert.match(more, /const update = useUpdateStatus\(\), look = lineLookOf\(update\?\.phase\), calm = scale === 0;/, 'scale 0 is speed Off, which App also sets for reduced motion and the OS preference');
  assert.match(more, /data-update=\{look \?\? undefined\}/);
  assert.match(more, /running=\{look === 'run' && !calm && !open && !suggesting\}/, 'the shine runs only while downloading, with motion allowed and the row shut');
  assert.match(more, /<UpdateLine look=\{look\} progress=\{\(update\?\.percent \?\? 0\) \/ 100\}/, 'the real progress');
  assert.match(line, /if \(!running\) repaint\.current\(\)/, 'a line that is not running is one painted frame: no timer, no frame left');
  assert.match(line, /running \? join\(/, 'the running line uses the window\'s one animation loop');
  assert.match(line, /className="sb-addr-line" aria-hidden="true"/, 'decoration: the pill button above it carries the name and the keyboard');
});

test('the line keeps its box and its hit area: the update only paints inside the 4 px line', () => {
  const css = read('../src/styles/address-in-sidebar.css');
  assert.deepEqual([PILL_LINE.width, PILL_LINE.height, PILL_LINE.hoverWidth, PILL_LINE.zone, PILL_LINE.layout], [96, 4, 124, 14, 10], 'the measures the update must not move');
  const dots = /\.sb-addr-line \{([^}]*)\}/.exec(css)![1];
  assert.match(dots, /position: absolute; left: 0; right: 0; top: 0; height: 4px; pointer-events: none;/, 'out of the layout, 4 px high like the line, never taking the pointer');
  assert.doesNotMatch(dots, /margin|padding|width:/);
  const accent = /\.sb-addr-shape::before \{([^}]*)\}/.exec(css)![1];
  assert.match(accent, /position: absolute; inset: 0; pointer-events: none;/, 'the ready colour is a fill inside the same shape');
  const update = css.split('\n').filter(row => /data-update|\.sb-addr-line|\.sb-addr-shape::before|--pl-/.test(row)).join('\n');
  assert.doesNotMatch(update, /\.sb-addr-pill|\.sb-addr-more \{|height: calc\(10px/, 'no rule of the update touches the pill button or the 10 px row');
  assert.match(css, /\.sb-addr-pill \{[^}]*height: 10px;/); assert.match(css, /\.sb-addr-pill::after \{ content: ''; position: absolute; left: 0; right: 0; top: 100%; height: 4px; \}/);
  assert.match(css, /height: calc\(4px \+ 28px \* var\(--addr-t\)\); border-radius: calc\(2px \+ 5px \* var\(--addr-t\)\);/, 'the line\'s own size and corner are untouched');
});

test('with no update the line is what it was: every --pl- number is 0 (1 for held) and the capsule keeps its full ink', () => {
  const css = read('../src/styles/address-in-sidebar.css');
  assert.match(css, /@property --pl-dots \{ syntax: '<number>'; inherits: true; initial-value: 0; \}/);
  assert.match(css, /@property --pl-ready \{ syntax: '<number>'; inherits: true; initial-value: 0; \}/);
  assert.match(css, /@property --pl-held \{ syntax: '<number>'; inherits: true; initial-value: 1; \}/);
  assert.match(css, /var\(--addr-ink\) \* \(1 - max\(var\(--pl-dots\), var\(--pl-ready\)\) \* var\(--pl-fade\)\)/, 'the grey capsule steps aside only for the update, and returns as the row opens');
  assert.match(css, /--pl-fade: clamp\(0, calc\(1 - var\(--addr-t\) \* 5\), 1\);/, 'the dots and the accent are gone by a fifth of the row\'s opening');
  assert.match(css, /\.sb-addr-shape\[data-update='ready'\] \{ --pl-ready: 1; \}/);
  assert.match(css, /\.sb-addr-shape\[data-update='held'\] \{ --pl-dots: 1; --pl-held: \.55; \}/);
  assert.match(css, /--pl-dots calc\(\.3s \* var\(--motion-scale, 1\)\)/, 'the look changes with the animation speed: instant at Off');
  assert.match(css, /color-mix\(in srgb, var\(--sidebar-pill-ink, var\(--ed-blue, var\(--accent, #3b6eea\)\)\) calc\(62% \+ \(var\(--addr-a0\) - \.24\) \* 100%\), transparent\)/, 'the chrome\'s accent (the Update pill\'s own ink on a sidebar colour of the person\'s own), 62% at rest and 80% under the pointer');
  assert.match(css, /forced-colors: active[^}]*\[data-update='ready'\]::before \{ background: Highlight; \}/);
});
