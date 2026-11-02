import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { avatarInitial, initialAllowed, typedInitial } from '../src/features/accounts/avatarCase';

// The profile form upper-cased the typed letter before saving. ß becomes "SS", which the main process refuses as a monogram
// ("Profile avatar must be one emoji or initial"): the form closed as if saved and nothing changed. Now ß stays ß.
test('the saved monogram is one character: upper case when that is one, the letter as typed when it is not', () => {
  for (const [typed, saved] of [['a', 'A'], ['é', 'É'], ['ж', 'Ж'], ['7', '7'], ['日', '日'], ['ǆ', 'Ǆ'], ['ß', 'ß'], ['ŉ', 'ŉ']]) assert.equal(avatarInitial(typed), saved, typed);
  for (const typed of ['a', 'é', 'ß', 'ŉ', 'ﬁ']) assert.equal([...avatarInitial(typed)].length, 1, typed);
});

// The Initial box cut by code point with maxLength 2: a flag 🇩🇪 became 🇩 and a family 👨‍👩‍👧 became 👨 before its hint showed.
test('the Initial box keeps one whole character as a person sees it, and drops spaces round it', () => {
  for (const [typed, kept] of [['🇩🇪', '🇩🇪'], ['👨‍👩‍👧', '👨‍👩‍👧'], ['👍🏽', '👍🏽'], ['x ', 'x'], [' x ', 'x'], ['  ', ''], ['', ''], ['ab', 'b'], ['A🇫🇷', '🇫🇷'], ['e\u0301', 'é'], ['É', 'É']] as const)
    assert.equal(typedInitial(typed), kept, JSON.stringify(typed));
  assert.equal(typedInitial('e\u0301').length, 1, 'composed to one code point');
  for (const ok of ['', 'A', 'é', 'q\u0303', '7', '日', 'ß']) assert.equal(initialAllowed(ok), true, ok);
  for (const no of ['🇩🇪', '👨‍👩‍👧', '#', 'AB']) assert.equal(initialAllowed(no), false, no);
  assert.equal(avatarInitial('q\u0303'), 'Q\u0303', 'a letter with its accent is one character to upper-case');
  const form = readFileSync('src/features/accounts/ProfileManager.tsx', 'utf8');
  assert.match(form, /onChange=\{\(event\) => setInitial\(typedInitial\(event\.target\.value\)\)\}/);
  assert.match(form, /value=\{initial\}\n\s+maxLength=\{16\}/, 'room for a family emoji (main allows 16)');
});
