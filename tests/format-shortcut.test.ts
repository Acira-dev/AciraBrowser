import assert from 'node:assert/strict';
import test from 'node:test';
import { formatShortcut } from '../src/ui/platform';

test('every spelling becomes the Windows convention Ctrl+Shift+N', () => {
  for (const [input, expected] of [['Ctrl Shift N', 'Ctrl+Shift+N'], ['Ctrl + Shift + T', 'Ctrl+Shift+T'], ['Ctrl+Shift+S', 'Ctrl+Shift+S'], ['Alt T', 'Alt+T'], ['Ctrl ,', 'Ctrl+,'], ['Alt + ← / →', 'Alt+← / →'], ['Esc', 'Esc'], ['F11', 'F11']])
    assert.equal(formatShortcut(input), expected);
  assert.equal(formatShortcut(formatShortcut('Ctrl Shift N')), 'Ctrl+Shift+N');
});
