import test from 'node:test';
import assert from 'node:assert/strict';
import { colorToCommit } from '../src/ui/hexColor';

test('a colour field commits only a colour that differs from the one it shows', () => {
  assert.equal(colorToCommit('#223355', '#f8fbff'), '#223355');
  assert.equal(colorToCommit('#abc', '#f8fbff'), '#aabbcc', 'three digits are doubled');
  assert.equal(colorToCommit('#F8FBFF', '#f8fbff'), null, 'tabbing through the field leaves the finish colour alone');
  assert.equal(colorToCommit('#fff', '#ffffff'), null);
  assert.equal(colorToCommit('zzz', '#f8fbff'), null);
  assert.equal(colorToCommit('#12', '#f8fbff'), null);
});
