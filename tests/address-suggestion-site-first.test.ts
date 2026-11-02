import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialState, makeTab } from '../src/runtime/core';
import type { BrowserSnapshot, HistoryVisit, TabSession } from '../src/runtime/types';
import { rankAddressSuggestions } from '../src/ui/addressSuggestions';

// Founder (31 Oct): "you search for YouTube and the first result was not YouTube, it was some other video on YouTube."
// Typing a site's name puts the site itself first, whether or not its own page was ever visited; never a page inside it.

const PERSONAL = 'profile-personal', TOR = 'profile-tor';
const visit = (id: string, url: string, title: string, browserProfileId = PERSONAL): HistoryVisit => ({ id, url, title, time: new Date().toISOString(), profileId: '', browserProfileId });
const tab = (id: string, url: string, title: string, privacy?: TabSession['privacy']): TabSession => ({ ...makeTab(id, title, url, PERSONAL), title, ...(privacy ? { privacy } : {}) });
const videos = (count = 12) => Array.from({ length: count }, (_, i) => visit(`v${i}`, `https://www.youtube.com/watch?v=clip${i}`, `Clip ${i} - YouTube`));
function profile(history: HistoryVisit[], extra: Partial<BrowserSnapshot> = {}): BrowserSnapshot {
  const state = createInitialState();
  return { ...state, browserProfiles: [...state.browserProfiles, { id: TOR, name: 'Tor', color: '#7d4698', partition: 'tor-window', private: true, tor: true }], tabs: [tab('home', 'https://start.test/', 'Start')], activeTabId: 'home', browsingHistory: history, bookmarks: [], ...extra };
}
const urls = (state: BrowserSnapshot, query: string) => rankAddressSuggestions(query, state).map(row => row.url);
const isVideo = (url: string) => url.includes('/watch');

test('only videos in history: youtube.com is the first row, the search comes next, no video before them', () => {
  const rows = rankAddressSuggestions('youtube', profile(videos()));
  assert.equal(rows[0].url, 'https://www.youtube.com/');
  assert.equal(rows[0].kind, 'url');
  assert.equal(rows[1].kind, 'search');
  assert.ok(rows.slice(2).every(row => isVideo(row.url)), 'videos only follow');
});

test('a visit to youtube.com itself still comes first', () => {
  const rows = rankAddressSuggestions('youtube', profile([...videos(), visit('root', 'https://www.youtube.com/', 'YouTube')]));
  assert.equal(rows[0].url, 'https://www.youtube.com/');
  assert.equal(rows[0].kind, 'history');
  assert.equal(rows.filter(row => row.url === 'https://www.youtube.com/').length, 1, 'not listed twice');
});

test('a prefix of the name works too, and any site does: github, not a repository page', () => {
  assert.equal(urls(profile(videos()), 'youtu')[0], 'https://www.youtube.com/');
  const repos = [visit('a', 'https://github.com/acme/widgets/issues/4', 'Issue 4 · acme/widgets'), visit('b', 'https://github.com/acme/widgets', 'acme/widgets')];
  assert.equal(urls(profile(repos), 'github')[0], 'https://github.com/');
});

test('the site with the most pages wins when several hosts begin with the name', () => {
  const state = profile([visit('o', 'https://youtubeproxy.example/watch?v=1', 'One'), ...videos(3)]);
  assert.equal(urls(state, 'youtube')[0], 'https://www.youtube.com/');
});

test('open tabs and bookmarks count as pages the person has', () => {
  assert.equal(urls(profile([], { tabs: [tab('home', 'https://start.test/', 'Start'), tab('clip', 'https://www.youtube.com/watch?v=abc', 'A clip - YouTube')] }), 'youtube')[0], 'https://www.youtube.com/');
  assert.equal(urls(profile([], { bookmarks: ['https://www.youtube.com/watch?v=abc'] }), 'youtube')[0], 'https://www.youtube.com/');
});

test('what was typed still wins where it is already an address, and names inside titles never replace a search', () => {
  assert.equal(rankAddressSuggestions('youtube.com', profile(videos()))[0].kind, 'url');
  assert.equal(urls(profile(videos()), 'youtube.com')[0], 'https://youtube.com/');
  const rows = rankAddressSuggestions('youtube', profile([visit('t', 'https://news.test/story', 'Youtube tips for editors')]));
  assert.equal(rows[0].kind, 'search', 'a title match is not a site');
  assert.equal(rankAddressSuggestions('yo', profile(videos()))[0].kind, 'search', 'two letters are still a search');
  assert.equal(rankAddressSuggestions('youtube watch', profile(videos()))[0].kind, 'search', 'several words are a search');
});

test('privacy line: a Tor, private or secured tab, or another profile, never makes a site first in an ordinary tab', () => {
  const state = profile([visit('t', 'https://www.youtube.com/watch?v=tor', 'Tor clip - YouTube', TOR)], {
    tabs: [tab('home', 'https://start.test/', 'Start'), tab('tor', 'https://www.youtube.com/watch?v=1', 'Tor - YouTube', 'tor'), tab('private', 'https://www.youtube.com/watch?v=2', 'Private - YouTube', 'private'), tab('secured', 'https://www.youtube.com/watch?v=3', 'Secured - YouTube', 'secured')],
  });
  const rows = rankAddressSuggestions('youtube', state);
  assert.equal(rows[0].kind, 'search');
  assert.ok(rows.every(row => !row.url.includes('youtube.com')), 'nothing from those sources');
});
