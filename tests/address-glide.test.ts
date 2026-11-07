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
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 100 }), { center: 142, pre: 0 });
  assert.equal(glideLayout({ fieldWidth: 400, textWidth: 101 }).center, 141.5);
  assert.equal(glideLayout({ fieldWidth: 400, textWidth: 100.3 }).center % 0.5, 0, 'never a quarter pixel');
  assert.equal(FIELD_PADDING, 8);
});

test('a text that fills the box, an empty one, or a field with no room has no middle to go to', () => {
  const inner = 400 - FIELD_PADDING * 2;
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: inner }), { center: 0, pre: 0 });
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: inner + 80, hiddenPrefixWidth: 40 }), { center: 0, pre: 0 }, 'a long address stays at the left and does not move');
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 0 }), { center: 0, pre: 0 });
  assert.deepEqual(glideLayout({ fieldWidth: 10, textWidth: 5 }), { center: 0, pre: 0 });
  assert.deepEqual(glideLayout({ fieldWidth: NaN, textWidth: 5 }), { center: 0, pre: 0 });
});

test('what the at-rest text leaves out in front is where the field text starts, left of the shown text', () => {
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 100, hiddenPrefixWidth: 40 }), { center: 142, pre: 40 });
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 100, hiddenPrefixWidth: 142 }), { center: 142, pre: 142 }, 'exactly enough room');
  assert.equal(glideLayout({ fieldWidth: 400, textWidth: 100, hiddenPrefixWidth: -5 }).pre, 0);
});

test('with too little room left for it, the text stays at the left and nothing glides (no two layers that cannot line up)', () => {
  // a 224 px sidebar field and a 190 px address leave 9 px to each side; an "https://" is about 40 px wide
  assert.deepEqual(glideLayout({ fieldWidth: 224, textWidth: 190, hiddenPrefixWidth: 40 }), { center: 0, pre: 0 });
  assert.deepEqual(glideLayout({ fieldWidth: 400, textWidth: 100, hiddenPrefixWidth: 900 }), { center: 0, pre: 0 });
  assert.deepEqual(glideLayout({ fieldWidth: 224, textWidth: 190 }), { center: 9, pre: 0 }, 'nothing left out in front: any room will do');
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
  assert.match(css, /\[data-glide\]\[data-glidable\] \{ transition: --af-p/, 'only a text with a middle to go to glides');
  assert.match(field, /toggleAttribute\('data-glidable', layout\.center > 0\)/);
  assert.equal((css.match(/transition:/g) || []).length, 2, 'one transition (and its forced-colours off switch)');
});
