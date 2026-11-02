import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dayLayout, dayOffsets, daySpan, pageHost } from '../src/features/libraryModel';
import { savedPageIdentity } from '../src/ui/pageActions';

// R3-54: History, Bookmarks and Rewind open fast because only the days and rows near the screen exist.
test('a day is as tall as its margin, header, list padding and rows', () => {
  const offsets = dayOffsets([2, 3, 0]);
  assert.deepEqual(offsets, [0, 12 + 28 + 6 + 80, 12 + 28 + 6 + 80 + 20 + 28 + 6 + 120, 12 + 28 + 6 + 80 + 20 + 28 + 6 + 120 + 20 + 28 + 6]);
  assert.deepEqual(dayLayout, { lead: 12, gap: 20, head: 28, pad: 6 });
  assert.equal(dayOffsets([], 40).length, 1);
});

test('the days near the viewport are found exactly, and none when the viewport is beyond the content', () => {
  const offsets = dayOffsets([2, 3, 4]); // day 0: 0..126, day 1: 126..300, day 2: 300..514
  assert.deepEqual(daySpan(offsets, 0, 100, 0), { first: 0, last: 0 });
  assert.deepEqual(daySpan(offsets, 130, 200, 0), { first: 1, last: 1 });
  assert.deepEqual(daySpan(offsets, 100, 320, 0), { first: 0, last: 2 });
  assert.deepEqual(daySpan(offsets, 299, 301, 0), { first: 1, last: 2 }, 'a viewport on a boundary touches both days');
  assert.deepEqual(daySpan(offsets, 200, 210, 100), { first: 0, last: 2 }, 'overscan widens the window');
  assert.equal(daySpan(offsets, 600, 700, 0), null);
  assert.equal(daySpan(offsets, -500, -10, 0), null);
  assert.equal(daySpan([0], 0, 100, 0), null, 'no days, no window');
});

test('binary search agrees with a plain scan over hundreds of days', () => {
  let seed = 7; const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const counts = Array.from({ length: 417 }, () => 1 + Math.floor(random() * 40)), offsets = dayOffsets(counts), total = offsets.at(-1)!;
  for (let trial = 0; trial < 300; trial++) {
    const top = Math.floor(random() * total * 1.1) - 100, height = 200 + Math.floor(random() * 1600), overscan = Math.floor(random() * 900);
    const from = top - overscan, to = top + height + overscan;
    const touched = counts.map((_, i) => i).filter(i => offsets[i + 1] > from && offsets[i] < to);
    const span = daySpan(offsets, top, top + height, overscan);
    if (!touched.length) assert.equal(span, null, `trial ${trial}`); else assert.deepEqual(span, { first: touched[0], last: touched.at(-1) }, `trial ${trial}`);
  }
});

test('the fast host lookup gives the same host as the URL parser, and still handles odd addresses', () => {
  for (const url of ['https://www.Example.com/a?b=1', 'http://sub.example.co.uk:8080/x', 'https://example.com', 'https://example.com#frag', 'https://example.com?q=1', 'https://xn--bcher-kva.example/', 'https://user:pw@example.com/', 'https://[::1]/x', 'https://bücher.example/', 'ftp://example.com/', 'not a url']) {
    let expected = url; try { expected = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keeps the address */ }
    assert.equal(pageHost(url), expected, url);
  }
  assert.equal(pageHost('acira://settings'), 'acira://settings');
});

test('the visit index returns the newest visit of a page per profile, as the linear search did', () => {
  const visits = [
    { id: 'a', url: 'https://x.test/', title: 'new', time: '2026-10-26T10:00:00Z', profileId: 'p', browserProfileId: 'p1' },
    { id: 'b', url: 'https://x.test/', title: 'old', time: '2026-10-25T10:00:00Z', profileId: 'p', browserProfileId: 'p1' },
    { id: 'c', url: 'https://x.test/', title: 'other profile', time: '2026-10-26T11:00:00Z', profileId: 'p', browserProfileId: 'p2' },
    { id: 'd', url: 'https://y.test/', title: 'unscoped', time: '2026-10-26T09:00:00Z', profileId: 'p' },
  ];
  const state = { tabs: [], activeTabId: '', activeBrowserProfileId: 'p1', browserProfiles: [{ id: 'p1' }, { id: 'p2' }], browsingHistory: visits } as never;
  assert.equal(savedPageIdentity('https://x.test/', state).title, 'new');
  assert.equal(savedPageIdentity('https://y.test/', state).title, 'unscoped', 'a visit without a profile belongs to the first profile');
  assert.equal(savedPageIdentity('https://z.test/', state).title, undefined);
  const second = { ...(state as object), activeBrowserProfileId: 'p2' } as never;
  assert.equal(savedPageIdentity('https://x.test/', second).title, 'other profile');
  assert.equal(savedPageIdentity('https://y.test/', second).title, undefined);
});

test('History, Bookmarks and the lazy screens use the windowing and the direct render', () => {
  const history = fs.readFileSync('src/features/BrowserHistory.tsx', 'utf8'), bookmarks = fs.readFileSync('src/features/BookmarksManager.tsx', 'utf8');
  const lazy = fs.readFileSync('src/ui/lazyScreens.tsx', 'utf8'), css = fs.readFileSync('src/features/library.css', 'utf8');
  assert.match(history, /useDayWindow\(days, counts\)/);
  assert.match(history, /windowed=\{\{ count: group\.items\.length/);
  assert.match(bookmarks, /useRowWindow\(listRef, here\.length, 40, windowOn, true\)/);
  assert.match(lazy, /const \[Direct\] = useState<C \| null>\(\(\) => ready\)/, 'a chunk that is already loaded renders without Suspense (React holds a revealed boundary behind its fallback for ~300ms)');
  assert.match(css, /\.lib-section\[data-day\]\[data-lead\] \{ margin-top: 12px; \}/);
  assert.match(css, /\.lib-days \{ display: flow-root; \}/);
  assert.match(css, /:not\(\[data-windowed\]\):not\(\[data-day\]\) \{ content-visibility: auto;/);
});
