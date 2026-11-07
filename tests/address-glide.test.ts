import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FIELD_PADDING, glideGuardMs, glideLayout, glideMotion, hiddenPrefixLength, startsGlide,
} from '../src/ui/addressGlide';
import { addressDisplayMap } from '../src/ui/addressSelection';
import { motionScaleOf, motionScales } from '../src/ui/sharedMotion';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the middle of the field: half of what is left of the text box, in whole or half pixels', () => {
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 100 }), { center: 142, pre: 0, glides: true });
  assert.equal(glideLayout({ fieldWidth: 400, textWidth: 101 }).center, 141.5);
  assert.equal(glideLayout({ fieldWidth: 400, textWidth: 100.3 }).center % 0.5, 0, 'never a quarter pixel');
  assert.equal(FIELD_PADDING, 8);
});

test('a text with nothing to move for (empty, no room for padding, unmeasured) has no glide; a text that fills the box rests at the left and still glides', () => {
  const inner = 400 - FIELD_PADDING * 2;
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: inner }), { center: 0, pre: 0, glides: true }, 'fills the box: at the left');
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: inner + 80, hiddenPrefixWidth: 40 }), { center: 0, pre: 40, glides: true }, 'a long address rests at the left and its domain travels right by what is left out in front');
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 0 }), { center: 0, pre: 0, glides: false });
  assert.deepEqual(glideLayout({ fieldWidth: 10, textWidth: 5 }), { center: 0, pre: 0, glides: false });
  assert.deepEqual(glideLayout({ fieldWidth: NaN, textWidth: 5 }), { center: 0, pre: 0, glides: false });
});

test('what the at-rest text leaves out in front is where the field text starts, left of the shown text', () => {
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 100, hiddenPrefixWidth: 40 }), { center: 142, pre: 40, glides: true });
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 100, hiddenPrefixWidth: 142 }), { center: 142, pre: 142, glides: true }, 'exactly enough room');
  assert.equal(glideLayout({ fieldWidth: 400, textWidth: 100, hiddenPrefixWidth: -5 }).pre, 0);
});

test('with too little room left for it, the text rests at the left and its domain travels right: a narrow field morphs too (the sidebar, 7 Nov: it used to swap at once, and ghosted when a slide started the glide)', () => {
  // a 224 px sidebar field and a 190 px address leave 9 px to each side; an "https://" is about 40 px wide
  assert.deepEqual(glideLayout({ fieldWidth: 224, textWidth: 190, hiddenPrefixWidth: 40 }), { center: 0, pre: 40, glides: true });
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 100, hiddenPrefixWidth: 900 }), { center: 0, pre: 900, glides: true });
  assert.deepEqual(glideLayout({ fieldWidth: 224, textWidth: 190 }), { center: 9, pre: 0, glides: true }, 'nothing left out in front: any room will do');
  // the sidebar's "youtube.com" in a 172 px field: 47 px of room, 70 px of "https://www." in front: rests at the left
  assert.deepEqual(glideLayout({ fieldWidth: 172, textWidth: 62, hiddenPrefixWidth: 70 }), { center: 0, pre: 70, glides: true });
});

test('the hidden prefix is the scheme and www. the at-rest text leaves out, and nothing for a name shown as it is or rewritten', () => {
  assert.equal(hiddenPrefixLength(addressDisplayMap('https://harbor.dev/docs')!.index), 8, 'https://');
  assert.equal(hiddenPrefixLength(addressDisplayMap('https://www.harbor.dev/')!.index), 12, 'https://www.');
  assert.equal(hiddenPrefixLength(addressDisplayMap('http://harbor.dev/')!.index), 7, 'http://');
  assert.equal(hiddenPrefixLength(addressDisplayMap('acira://settings')!.index), 0, 'shown whole');
  assert.equal(hiddenPrefixLength([]), 0);
  assert.equal(hiddenPrefixLength([-1, 3, 4]), 0, 'a rewritten first character has no place in the field text');
});

test('the glide is the settle spring on the frequent-surface stretch; the animation speed scales it, and Off (Reduce motion, None) has none', () => {
  const premium = glideMotion(motionScales.premium), fast = glideMotion(motionScales.fast);
  assert.ok(premium.ms > fast.ms && fast.ms > 0, `${premium.ms} ms at Premium, ${fast.ms} ms at Fast`);
  assert.ok(premium.ms >= 400 && premium.ms <= 600, 'the 504 ms the founder saw');
  assert.match(premium.ease, /^linear\(/);
  assert.deepEqual(glideMotion(0), { ms: 0, ease: 'linear' });
  assert.deepEqual(glideMotion(-1), { ms: 0, ease: 'linear' });
  assert.equal(glideMotion(motionScaleOf({ reducedMotion: true })).ms, 0, 'Reduce motion places the text');
  assert.equal(glideMotion(motionScales.off).ms, 0, 'speed Off: whatever setting maps to it (the coming None) places the text');
});

test('only a change of where the text is headed starts a glide, and only when there is one to play', () => {
  const glide = glideMotion(1.7);
  assert.equal(startsGlide(false, true, glide), true, 'click or Cmd/Ctrl+L: centre to left');
  assert.equal(startsGlide(true, false, glide), true, 'leave: left to centre');
  assert.equal(startsGlide(false, false, glide), false);
  assert.equal(startsGlide(true, true, glide), false);
  assert.equal(startsGlide(false, true, undefined), false, 'a field with no glide (the new tab page search)');
  assert.equal(startsGlide(false, true, { ms: 0, ease: 'linear' }), false, 'no glide at speed Off: placed');
  assert.ok(glideGuardMs(glide) > glide.ms, 'the at-rest layer is never kept past a window that never paints');
});

test('wiring: the toolbar field and the sidebar field take the glide, the new tab page search does not, and the CSS reads one number', () => {
  const app = read('../src/App.tsx'), field = read('../src/components/AddressField.tsx'), css = read('../src/styles/address-glide.css'), newTab = read('../src/features/newtab/NewTabPage.tsx');
  assert.match(app, /glideMotion\(motionScaleOf\(s\)\)/, 'the speed setting decides (Off: no glide)');
  assert.match(app, /<AddressField glide=\{addressGlide\}/, 'one address bar, in the toolbar or in the sidebar');
  assert.doesNotMatch(newTab, /glide=/, 'the new tab page keeps its own search field');
  assert.match(field, /const aligned = focused && !holding/, 'a press that holds the at-rest text for a drag does not start it');
  assert.match(field, /startsGlide\(wasAligned, aligned, glide\)/);
  assert.match(field, /event\.propertyName === '--af-p'/, 'the transition ends the cross-fade');
  assert.match(field, /document\.fonts\?\.addEventListener\('loadingdone', measure\)/, 'measured again once Inter has loaded');
  assert.match(css, /@property --af-p/);
  for (const part of ['.address-display', '> input { padding-left', '> input { color: color-mix']) assert.ok(css.includes(part), part);
  assert.match(css, /@media \(forced-colors: active\)/, 'forced colours draw the field text only: nothing moves');
  assert.match(css, /\[data-glide\]\[data-glidable\] \{ transition: --af-p/, 'only a text there is something to move for glides');
  assert.match(field, /toggleAttribute\('data-glidable', layout\.glides\)/);
  assert.equal((css.match(/transition:/g) || []).length, 3, 'the text glide, the ring (the field keeps its own fill transition) and the forced-colours off switch');
});

test('the narrow field: the field text starts left of its box and comes in from behind the edge, the shown text is cut at the box, one number moves all of it', () => {
  const css = read('../src/styles/address-glide.css');
  assert.match(css, /--af-shift: calc\(var\(--af-pre, 0px\) \+ \(var\(--af-center, 0px\) - var\(--af-pre, 0px\)\) \* var\(--af-p\)\)/, 'where the domain is now, from the one number');
  assert.match(css, /\.address-display \{ transform: translate\(var\(--af-shift\), -50%\); clip-path: inset\(-4px var\(--af-shift\) -4px 0\)/, 'the shown text travels and is cut where the field ends');
  assert.match(css, /padding-left: calc\(8px \+ max\(0px, \(var\(--af-center, 0px\) - var\(--af-pre, 0px\)\) \* var\(--af-p\)\)\) !important; text-indent: min\(0px,/, 'the part of the offset left of the padding is a negative indent');
});

test('the ring goes with the text on the same spring, in both directions, and waits for the release of a press that holds the at-rest text (7 Nov: it popped at once)', () => {
  const css = read('../src/styles/address-glide.css'), app = read('../src/App.tsx');
  assert.match(app, /className=\{`address-bar`\}[^>]*style=\{\{ '--af-ms': addressGlide\.ms \+ 'ms', '--af-ease': addressGlide\.ease \} as CSSProperties\}/, 'the bar carries the time and the easing the field does');
  assert.match(css, /outline-color var\(--af-ms, 0ms\) var\(--af-ease, linear\)/);
  assert.match(css, /:not\(:focus-within\) \{ outline: 2px solid transparent; outline-offset: -2px; \}/, 'a ring of the same size at rest, so its colour can move');
  assert.match(css, /\[data-holding\]\):focus-within \{ outline-color: transparent; \}/, 'a held press: the ring comes with the glide');
  assert.match(css, /@media not \(forced-colors: active\)/, 'forced colours keep the system ring, no transparent one');
});

test('a field that shows the full address shows it from its start, so its text lines up with the shown text (a narrow field would scroll to the end of a long address)', () => {
  const field = read('../src/components/AddressField.tsx');
  assert.match(field, /const fromStart = \(input: HTMLInputElement \| null \| undefined\) => \{ if \(glide && input\) input\.scrollLeft = 0; \};/);
  assert.match(field, /event\.target\.select\(\);fromStart\(event\.target\)/, 'focus');
  assert.match(field, /event\.currentTarget\.select\(\);fromStart\(event\.currentTarget\)/, 'click');
  assert.match(field, /const finishBlur = \(event: FocusEvent<HTMLInputElement>\) => \{ fromStart\(inputRef\.current\)/, 'and when it lets go (a parked blur finishes after the event is gone: the ref, not currentTarget)');
});
