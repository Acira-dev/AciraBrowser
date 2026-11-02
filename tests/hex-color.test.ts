import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { colorToCommit, completeHexColor, parseHexColor } from '../src/ui/hexColor';

test('a colour field commits only a colour that differs from the one it shows', () => {
  assert.equal(colorToCommit('#223355', '#f8fbff'), '#223355');
  assert.equal(colorToCommit('#abc', '#f8fbff'), '#aabbcc', 'three digits are doubled');
  assert.equal(colorToCommit('#F8FBFF', '#f8fbff'), null, 'tabbing through the field leaves the finish colour alone');
  assert.equal(colorToCommit('#fff', '#ffffff'), null);
  assert.equal(colorToCommit('zzz', '#f8fbff'), null);
  assert.equal(colorToCommit('#12', '#f8fbff'), null);
});

// Settings > Appearance > Colors: a pasted "ff0000" (no #) or "#ff0000 " (trailing space) was silently put back to the old colour.
test('a pasted colour without # or with spaces around it is taken as #rrggbb', () => {
  assert.equal(parseHexColor('ff0000'), '#ff0000');
  assert.equal(parseHexColor('#ff0000 '), '#ff0000');
  assert.equal(parseHexColor('  FF0000\t'), '#ff0000', 'upper case and tabs');
  assert.equal(parseHexColor(' abc '), '#aabbcc');
  assert.equal(colorToCommit('ff0000', '#f8fbff'), '#ff0000');
  assert.equal(colorToCommit(' F8FBFF ', '#f8fbff'), null, 'the colour already shown is still not pinned');
  for (const wrong of ['', ' ', '#', 'ff00', '#ff00000', 'ff 0000', '##ff0000', 'red', '#gg0000', 'rgb(255,0,0)']) assert.equal(parseHexColor(wrong), null, JSON.stringify(wrong));
});

test('while typing, a colour applies only once all six digits are there', () => {
  assert.equal(completeHexColor('ff0'), null, 'on the way to ff0000, not yellow');
  assert.equal(completeHexColor('#ff0'), null);
  assert.equal(completeHexColor('ff0000'), '#ff0000');
  assert.equal(completeHexColor(' #FF0000 '), '#ff0000');
});

test('a value that is still not a colour shows a message instead of reverting', () => {
  const source = readFileSync('src/components/AppearanceControls.tsx', 'utf8');
  assert.match(source, /if\(!parseHexColor\(input\)\)\{if\(input\.trim\(\)\)setInvalid\(true\);else setInput\(value\);return;\}/, 'wrong text stays with a message; an emptied field goes back');
  assert.match(source, /\{invalid&&<p id=\{messageId\} className="appearance-hex-message" role="alert">\{t\("appearancecontrols\.hexInvalid"\)\}<\/p>\}/);
  assert.match(source, /aria-invalid=\{invalid\|\|undefined\} aria-describedby=\{invalid\?messageId:undefined\}/);
  assert.match(source, /maxLength=\{16\}/, 'room for spaces around a pasted code');
  const en = JSON.parse(readFileSync('src/i18n/en.json', 'utf8'));
  assert.equal(en['appearancecontrols.hexInvalid'], 'Type a hex color, like #3b6eea.');
});
