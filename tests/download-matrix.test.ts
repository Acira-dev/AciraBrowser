import test from 'node:test';
import assert from 'node:assert/strict';
import { downloadFill } from '../src/ui/matrixShapes';
import { downloadActivity, panelDownloads, profileDownloads, PANEL_DOWNLOAD_ROWS } from '../src/ui/downloadActivity';
import type { BrowserDownload } from '../src/runtime/types';

const grid = (t: number, progress: number, held = false, R = 5, C = 5) => Array.from({ length: R }, (_, r) => Array.from({ length: C }, (_, c) => downloadFill(t, r, c, R, C, progress, held)));
const full = (rows: number[][]) => rows.flat().filter(value => value === 1).length;

test('the download matrix fills from the bottom row up with the real share received, left to right', () => {
  for (const progress of [0, .2, .5, .8, 1]) assert.equal(full(grid(0, progress)), Math.round(progress * 25), `${progress} of the file lights that share of the dots`);
  const half = grid(0, .4);
  assert.deepEqual(half[4], [1, 1, 1, 1, 1], 'the bottom row fills first');
  assert.deepEqual(half[3], [1, 1, 1, 1, 1], 'then the next row up');
  assert.ok(half[2].every(value => value !== 1), 'nothing above the fill is full');
});

test('lights fall onto the fill but never inside it, and a finished grid is still', () => {
  for (let t = 0; t < 6; t += .13) {
    const rows = grid(t, .4);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) assert.ok([0, .5].includes(rows[r][c]), 'a falling light is half, never a full dot');
    assert.deepEqual(rows[4], [1, 1, 1, 1, 1]); assert.deepEqual(rows[3], [1, 1, 1, 1, 1]);
  }
  for (const t of [0, 1.7, 33.3]) assert.deepEqual(grid(t, 1), Array.from({ length: 5 }, () => [1, 1, 1, 1, 1]));
  assert.ok(Array.from({ length: 60 }, (_, i) => grid(i * .11, .4).flat().join()).some((frame, i, all) => frame !== all[0]), 'something falls');
});

test('a paused download holds its fill and nothing else moves, so it costs no frames', () => {
  const frames = Array.from({ length: 40 }, (_, i) => JSON.stringify(grid(i * .27, .44, true)));
  assert.equal(new Set(frames).size, 1);
  assert.equal(full(JSON.parse(frames[0])), 11);
});

const item = (over: Partial<BrowserDownload>): BrowserDownload => ({ id: 'd', name: 'f.bin', size: '', status: 'Ready', ...over });

test('the downloads button reads what is running, what is only paused, and the share of the known sizes received', () => {
  assert.deepEqual(downloadActivity([item({}), item({ status: 'Cancelled' })]), { phase: 'idle', running: 0, paused: 0, progress: null });
  assert.deepEqual(downloadActivity([item({ status: 'Downloading', receivedBytes: 25, totalBytes: 100 }), item({ status: 'Downloading', receivedBytes: 75, totalBytes: 100 })]), { phase: 'run', running: 2, paused: 0, progress: .5 });
  assert.equal(downloadActivity([item({ status: 'Paused', receivedBytes: 10, totalBytes: 40 })]).phase, 'held');
  assert.equal(downloadActivity([item({ status: 'Paused', receivedBytes: 10, totalBytes: 40 }), item({ status: 'Downloading' })]).phase, 'run', 'one running download is enough');
  assert.equal(downloadActivity([item({ status: 'Downloading', receivedBytes: 5 })]).progress, null, 'no size yet: the matrix only falls');
  assert.equal(downloadActivity([item({ status: 'Downloading', receivedBytes: 500, totalBytes: 100 })]).progress, 1, 'never past the end');
});

test('the popup lists what is running first, then the newest, at most five', () => {
  const list = [item({ id: 'old', startedAt: 1 }), item({ id: 'new', startedAt: 9 }), item({ id: 'run', status: 'Downloading', startedAt: 2 }), item({ id: 'held', status: 'Paused', startedAt: 3 }), ...Array.from({ length: 4 }, (_, i) => item({ id: 'x' + i, startedAt: 4 + i }))];
  const rows = panelDownloads(list, PANEL_DOWNLOAD_ROWS);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.slice(0, 2).map(row => row.id), ['held', 'run'], 'live first, newest first');
  assert.equal(rows[2].id, 'new');
});

test('a download belongs to the window of its profile; one without a profile belongs to every window', () => {
  const state = { downloads: [item({ id: 'a', browserProfileId: 'p1' }), item({ id: 'b', browserProfileId: 'private-1' }), item({ id: 'c' })] };
  assert.deepEqual(profileDownloads(state, 'p1').map(row => row.id), ['a', 'c']);
  assert.deepEqual(profileDownloads(state, 'private-1').map(row => row.id), ['b', 'c'], 'a private window sees its own downloads and not the normal profile\'s');
});
