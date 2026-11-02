import test from 'node:test';
import assert from 'node:assert/strict';
import { tileLabel } from '../src/features/newtab/pages';

test('a shortcut is named after its site, not its page', () => {
  assert.equal(tileLabel('Pull requests · acira-dev/browser', 'https://github.com/acira-dev/browser/pulls'), 'Github');
  assert.equal(tileLabel('Vercel – Dashboard', 'https://vercel.com/dashboard'), 'Vercel');
  assert.equal(tileLabel('Linear – Launch sprint', 'https://linear.app/acira/project/launch-sprint'), 'Linear');
  assert.equal(tileLabel('Hacker News', 'https://news.ycombinator.com/'), 'Hacker News');
  assert.equal(tileLabel('How Chromium paints a frame – Chromium docs', 'https://www.chromium.org/developers/'), 'Chromium docs');
  assert.equal(tileLabel('linear.app/acira', 'https://linear.app/acira/project/x'), 'Linear');
  assert.equal(tileLabel('mail.google.com', 'https://mail.google.com/mail/u/0/'), 'Google');
  assert.equal(tileLabel('The BBC homepage with a very long title', 'https://www.bbc.co.uk/'), 'Bbc');
});

test('addresses and empty titles stay plain', () => {
  assert.equal(tileLabel('', 'https://www.example.com/path'), 'example.com');
  assert.equal(tileLabel('http://127.0.0.1:5173/', 'http://127.0.0.1:5173/'), '127.0.0.1');
  assert.equal(tileLabel('localhost dev server', 'http://127.0.0.1:5173/'), 'localhost dev server');
});

import { distinctSites, frequentPages, isPrivateNewTab, recentPages } from '../src/features/newtab/pages';
const visit = (id: string, url: string) => ({ id, url, title: 'Example', time: new Date().toISOString(), browserProfileId: 'p' } as never);

test('a private or Tor new tab never builds links from history, even in an ordinary profile', () => {
  assert.equal(isPrivateNewTab(false, 'private'), true);
  assert.equal(isPrivateNewTab(false, 'tor'), true);
  assert.equal(isPrivateNewTab(true, undefined), true);
  assert.equal(isPrivateNewTab(false, undefined), false);
  const history = [visit('1', 'https://a.example/x'), visit('2', 'https://b.example/')];
  assert.deepEqual(recentPages(history, 7, isPrivateNewTab(false, 'private')), []);
  assert.deepEqual(frequentPages(history, new Set(), 12, isPrivateNewTab(false, 'tor')), []);
});

test('pages on one site make one tile', () => {
  const out = distinctSites([{ url: 'https://www.example.com/a' }, { url: 'https://example.com/b' }, { url: 'https://other.example/' }, { url: 'https://example.com:8080/c' }]);
  assert.deepEqual(out.map((item) => item.url), ['https://www.example.com/a', 'https://other.example/', 'https://example.com:8080/c']);
});

import { selectedArtwork, readNewTabPreferences, updateNewTabPreferences } from '../src/ui/newTabPreferences';
test('a new painting on every tab: stable for one tab, different across tabs; caption defaults on', () => {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  const prefs = updateNewTabPreferences('p', { perTab: true }, true);
  assert.equal(prefs.caption, true);
  const a = selectedArtwork(prefs, 'p', new Date(), [], 'tab-1'), again = selectedArtwork(prefs, 'p', new Date(), [], 'tab-1');
  assert.equal(a.id, again.id);
  const ids = new Set(['tab-1', 'tab-2', 'tab-3', 'tab-4', 'tab-5', 'tab-6'].map((tab) => selectedArtwork(prefs, 'p', new Date(), [], tab).id));
  assert.ok(ids.size > 1, 'tabs do not all get the same painting');
  assert.equal(readNewTabPreferences('p', true).perTab, true);
});

test('hourly artwork is stable within an hour and moves on after it', () => {
  const prefs = updateNewTabPreferences('p', { hourly: true, perTab: false, daily: false }, true);
  const at = (iso: string) => selectedArtwork(prefs, 'p', new Date(iso)).id;
  assert.equal(at('2026-10-25T10:05:00Z'), at('2026-10-25T10:55:00Z'));
  const ids = new Set(Array.from({ length: 24 }, (_, hour) => at(`2026-10-25T${String(hour).padStart(2, '0')}:10:00Z`)));
  assert.ok(ids.size > 1, 'the picture changes across the day');
});
