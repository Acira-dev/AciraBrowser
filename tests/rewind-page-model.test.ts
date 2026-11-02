import test from 'node:test';
import assert from 'node:assert/strict';
import { ago, band, bandLabel, daysLabel, title, when, type RewindSummary } from '../src/features/rewind/client';

// R3-39: the Tabs view groups closed tabs in time bands and says when in plain words; a window card is named by what it held.
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min).getTime();
const NOW = at(2026, 9, 26, 15, 30);

test('bands: the last hour, the rest of today, yesterday, this week, older', () => {
  assert.equal(band(NOW - 5 * 60000, NOW), 'hour');
  assert.equal(band(NOW - 59 * 60000, NOW), 'hour');
  assert.equal(band(at(2026, 9, 26, 9, 10), NOW), 'today', 'over an hour ago but today');
  assert.equal(band(at(2026, 9, 25, 23, 50), NOW), 'yesterday');
  assert.equal(band(at(2026, 9, 22, 10), NOW), 'week');
  assert.equal(band(at(2026, 9, 18, 10), NOW), 'older', 'a kept tab from over a week ago');
  // Just after midnight, a tab from 20 minutes ago is yesterday's, not "last hour".
  const early = at(2026, 9, 26, 0, 10);
  assert.equal(band(at(2026, 9, 25, 23, 50), early), 'yesterday');
  assert.equal(bandLabel('hour'), 'Last hour');
  assert.equal(bandLabel('yesterday'), 'Yesterday');
});

test('ago: minutes inside the hour, the clock time after that, the weekday later in the week', () => {
  assert.equal(ago(NOW - 20000, NOW), 'Just now');
  assert.match(ago(NOW - 52 * 60000, NOW), /52/, 'minutes ago');
  assert.match(ago(at(2026, 9, 26, 9, 10), NOW), /9:10/);
  assert.match(ago(at(2026, 9, 25, 18, 45), NOW), /6:45/);
  assert.match(ago(at(2026, 9, 22, 10, 5), NOW), /Thu|10:05/);
});

test('when: Today and Yesterday read as words, older days as a short date', () => {
  assert.match(when(at(2026, 9, 26, 9, 10), NOW), /^Today .*9:10/);
  assert.match(when(at(2026, 9, 25, 18, 45), NOW), /^Yesterday .*6:45/);
  assert.doesNotMatch(when(at(2026, 9, 20, 18, 45), NOW), /Today|Yesterday/);
});

const card = (over: Partial<RewindSummary>): RewindSummary => ({ id: 'cp-a-00000000', createdAt: NOW, reason: 'window-close', label: '', tabCount: 4, groupCount: 0, skipped: 0, expiresAt: NOW + 1, windowId: '1', sessionId: '', hosts: [], siteCount: 0, sites: [], groups: [], closed: 0, ...over });

test('a window is named by its groups, else by its main sites, else by its size', () => {
  assert.equal(title(card({ groups: [{ name: 'Q4 launch', color: 'purple', count: 4 }], tabCount: 4 })), 'Q4 launch');
  assert.equal(title(card({ groups: [{ name: 'Q4 launch', color: 'purple', count: 2 }], tabCount: 5 })), 'Q4 launch and 3 other tabs');
  assert.equal(title(card({ groups: [{ name: 'A', color: 'red', count: 1 }, { name: 'B', color: 'red', count: 1 }, { name: 'C', color: 'red', count: 1 }], tabCount: 3 })), 'A, B and 1 more');
  assert.equal(title(card({ sites: ['Mail', 'Figma'], siteCount: 5 })), 'Mail, Figma and 3 more');
  assert.equal(title(card({ sites: ['Mail', 'Figma'], siteCount: 2 })), 'Mail and Figma');
  assert.equal(title(card({ tabCount: 1 })), '1 tab');
});

test('the retention setting reads as plain days', () => {
  assert.deepEqual([1, 3, 7].map(daysLabel), ['1 day', '3 days', '7 days']);
});
