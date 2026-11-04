import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { panelWarnsFirst } from '../src/ui/downloadActivity';

/** The downloads popup is narrow: a finished file that can run software read "150 KB · 4:54 PM · Review before …" in every finish, so
 * the warning itself was cut. Its line now starts with the warning and leaves out the time; the size is what gets cut, if anything. */
test('only a finished file that can run software leads its popup line with the warning', () => {
  assert.equal(panelWarnsFirst({ dangerous: true, status: 'Ready' }), true);
  assert.equal(panelWarnsFirst({ dangerous: true, status: 'Downloading' }), false, 'still arriving: progress first, no warning yet');
  assert.equal(panelWarnsFirst({ dangerous: false, status: 'Ready' }), false);
  assert.equal(panelWarnsFirst({ status: 'Ready' }), false);
});

test('the popup row puts the warning before the size and shows no time for such a file', () => {
  const panel = readFileSync(new URL('../src/features/DownloadsPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /panelWarnsFirst\(item\) \? <><span data-warn>\{t\('dl\.review'\)\}<\/span> · \{sizeOf\(item\)\}<\/> : downloadMeta\(item, false\)/);
});
