import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createInitialState, makeTab, persistedSnapshot, reduceBrowser, restoreSnapshot } from '../src/runtime/core';
import type { BrowserAction, BrowserSnapshot, HistoryVisit, TabSession } from '../src/runtime/types';
import { rankAddressSuggestions, type AddressSuggestion } from '../src/ui/addressSuggestions';
import { bookmarksVisibleFrom, browsingContextOf, historyVisibleFrom, tabVisibleFrom } from '../src/ui/suggestionPrivacy';
import { t } from '../src/i18n';

// Founder P0 (28 Oct): "I don't want anything I search in Tor to appear in any normal browser tab, nor the 'Switch to tab' thing."
// Every suggestion source, both directions: an ordinary tab never sees a Tor, private or secured tab; a Tor tab sees nothing ordinary.

const run = (state: BrowserSnapshot, ...actions: BrowserAction[]) => actions.reduce(reduceBrowser, state);
const PERSONAL = 'profile-personal', TOR = 'profile-tor';
const visit = (id: string, url: string, title: string, browserProfileId = PERSONAL): HistoryVisit => ({ id, url, title, time: new Date().toISOString(), profileId: '', browserProfileId });
const tab = (id: string, url: string, title: string, privacy?: TabSession['privacy'], profile = PERSONAL): TabSession => ({ ...makeTab(id, title, url, profile), title, ...(privacy ? { privacy } : {}) });

/** One ordinary window holding an ordinary tab, a Tor tab, a private tab and a secured tab, all of which searched "tea". */
function mixed(active = 'normal'): BrowserSnapshot {
  const state = createInitialState();
  return {
    ...state,
    browserProfiles: [...state.browserProfiles, { id: TOR, name: 'Tor', color: '#7d4698', partition: 'tor-window', private: true, tor: true }],
    tabs: [
      tab('normal', 'https://start.test/', 'Start'),
      tab('normal-2', 'https://tea-shop.test/', 'Tea shop'),
      tab('tor', 'https://duckduckgo.com/?q=secret+tea', 'secret tea at DuckDuckGo', 'tor'),
      tab('private', 'https://private-tea.test/', 'Private tea', 'private'),
      tab('secured', 'https://secured-tea.test/', 'Secured tea', 'secured'),
    ],
    activeTabId: active,
    bookmarks: ['https://tea-bookmark.test/'],
    browsingHistory: [
      visit('h-ordinary', 'https://tea-history.test/', 'Tea history'),
      visit('h-onion', 'http://teaxyzabcdefghijklmnopqrstuvwxyz234567abcdefghijklmnop.onion/', 'Onion tea'),
      visit('h-tor-profile', 'https://tor-profile-tea.test/', 'Tor profile tea', TOR),
    ],
  };
}
/** Rows that name something private. The typed row (a search or the address itself) is what the person typed, so it never counts. */
const leaked = (rows: AddressSuggestion[]) => rows.filter(row => row.kind !== 'search' && row.kind !== 'url' && /secret|private-tea|secured-tea|onion|tor-profile/i.test(row.url + ' ' + row.title) || ['tor', 'private', 'secured'].includes(row.tabId ?? ''));

test('open tabs: an ordinary tab never offers "Switch to tab" for a Tor, private or secured tab, nor shows their titles', () => {
  const state = mixed('normal');
  for (const query of ['tea', 'secret', 'duckduckgo.com', 'private-tea.test', 'secured-tea.test', 'Secured', 'Private']) {
    const rows = rankAddressSuggestions(query, state);
    assert.deepEqual(leaked(rows), [], `nothing private for "${query}"`);
  }
  assert.ok(rankAddressSuggestions('tea', state).some(row => row.kind === 'tab' && row.tabId === 'normal-2'), 'control: the ordinary tea tab is offered');
});

test('history: an ordinary tab never shows a Tor or private profile visit or any onion address', () => {
  const rows = rankAddressSuggestions('tea', mixed('normal'));
  assert.ok(rows.some(row => row.kind === 'history' && row.url === 'https://tea-history.test/'), 'control: ordinary history is suggested');
  assert.deepEqual(leaked(rows), []);
});

test('Tor tab: reads nothing from the ordinary profile (tabs, history, bookmarks); another Tor tab is fine', () => {
  const state = mixed('tor'), rows = rankAddressSuggestions('tea', state);
  assert.deepEqual(rows.filter(row => row.kind !== 'search' && row.kind !== 'url'), [], 'only the typed search row');
  const twoTor = { ...state, tabs: [...state.tabs, tab('tor-2', 'https://tor-tea.test/', 'Tor tea', 'tor')] };
  assert.deepEqual(rankAddressSuggestions('tea', twoTor).filter(row => row.kind === 'tab').map(row => row.tabId), ['tor-2']);
  assert.equal(bookmarksVisibleFrom(state, state.tabs[2]), false);
  assert.deepEqual(historyVisibleFrom(state, state.tabs[2], state.browsingHistory), []);
});

test('Tor window: no history at all; the window\'s own bookmarks (the Tor vault\'s) stay', () => {
  const state = mixed('normal'), torTab = tab('w', 'https://onion-start.test/', 'Tor window tab', undefined, TOR);
  const win = { ...state, tabs: [torTab], activeTabId: 'w', activeBrowserProfileId: TOR, bookmarks: ['https://tor-bookmark.test/'] };
  assert.equal(browsingContextOf(win, torTab), 'tor');
  const rows = rankAddressSuggestions('t', win);
  assert.ok(!rows.some(row => row.kind === 'history'));
  assert.ok(bookmarksVisibleFrom(win, torTab));
});

test('private tab: Chrome Incognito rules, it may read the ordinary history, tabs and bookmarks', () => {
  const rows = rankAddressSuggestions('tea', mixed('private'));
  assert.ok(rows.some(row => row.kind === 'history' && row.url === 'https://tea-history.test/'));
  assert.ok(rows.some(row => row.kind === 'tab' && row.tabId === 'normal-2'));
  assert.ok(rows.some(row => row.kind === 'bookmark'));
  assert.ok(!rows.some(row => row.tabId === 'tor' || row.tabId === 'secured'), 'still never a Tor or secured tab');
});

test('row labels come from the catalog (no English left in a translated list)', () => {
  const rows = rankAddressSuggestions('tea', mixed('normal'));
  const detail = (kind: string) => rows.find(row => row.kind === kind)?.detail;
  assert.equal(detail('tab'), t('addresssuggestions.alreadyOpen'));
  assert.equal(detail('bookmark'), t('addresssuggestions.bookmark'));
  assert.equal(detail('history'), t('addresssuggestions.fromHistory'));
  const source = readFileSync(new URL('../src/ui/addressSuggestions.ts', import.meta.url), 'utf8');
  assert.ok(!/'(Already open|Bookmark|From your history)'/.test(source), 'no literal row label');
});

test('the visibility matrix: only ordinary tabs cross, and never into Tor', () => {
  const state = mixed(), by = (id: string) => state.tabs.find(item => item.id === id)!;
  const expect: Record<string, string[]> = { normal: ['normal-2'], tor: [], private: ['normal', 'normal-2'], secured: ['normal', 'normal-2'] };
  for (const [viewer, seen] of Object.entries(expect)) {
    const visible = state.tabs.filter(target => target.id !== viewer && tabVisibleFrom(state, by(viewer), target)).map(target => target.id);
    assert.deepEqual(visible, seen.filter(id => id !== viewer), viewer);
  }
});

test('reducer: Tor, private and secured tabs never write history, not even a new title onto an ordinary visit', () => {
  let state = run(createInitialState(), { type: 'tab.new', url: 'https://same.test/' });
  const ordinary = state.activeTabId;
  state = run(state, { type: 'browser.event', event: { type: 'state', tabId: ordinary, url: 'https://same.test/', title: 'Ordinary title' } });
  assert.equal(state.browsingHistory.filter(item => item.url === 'https://same.test/').length, 1, 'control: the ordinary visit is kept');
  for (const privacy of ['tor', 'private'] as const) {
    state = run(state, { type: 'tab.new', url: 'https://same.test/', privacy });
    const id = state.activeTabId;
    state = run(state,
      { type: 'browser.event', event: { type: 'state', tabId: id, url: 'https://same.test/', title: `${privacy} title` } },
      { type: 'browser.event', event: { type: 'state', tabId: id, url: 'https://only-in-' + privacy + '.test/', title: 'Elsewhere' } },
      { type: 'browser.event', event: { type: 'state', tabId: id, url: 'http://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuv.onion/', title: 'Onion' } });
  }
  // A secured tab is one with the flag (main sets it for a secured workspace).
  state = { ...state, tabs: [...state.tabs, tab('sec', 'https://same.test/', 'x', 'secured')] };
  state = run(state, { type: 'browser.event', event: { type: 'state', tabId: 'sec', url: 'https://same.test/', title: 'secured title' } });
  const urls = state.browsingHistory.map(item => item.url);
  assert.ok(!urls.some(url => /only-in-|\.onion/.test(url)), urls.join());
  assert.deepEqual(state.browsingHistory.filter(item => item.url === 'https://same.test/').map(item => item.title), ['Ordinary title']);
});

test('purge: an onion address an older build stored never reaches disk and is dropped on restore', () => {
  const state = { ...createInitialState(), browsingHistory: [visit('a', 'https://keep.test/', 'Keep'), visit('b', 'http://abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrstuv.onion/x', 'Onion')] };
  assert.deepEqual(persistedSnapshot(state).browsingHistory.map(item => item.id), ['a']);
  assert.deepEqual(restoreSnapshot(state).browsingHistory.map(item => item.id), ['a']);
});

test('command bar: tab and history search use the same privacy line', () => {
  const source = readFileSync(new URL('../src/components/CommandPalette.tsx', import.meta.url), 'utf8');
  assert.match(source, /tabVisibleFrom\(state, viewer, tab\)\)\)\.map\(tab => shownTab\(tab\)\)/, 'open tabs filtered');
  assert.match(source, /historyVisibleFrom\(state, viewer, state\.browsingHistory\)/, 'history filtered');
  assert.match(source, /workspace\.id && tabVisibleFrom\(state, viewer, tab\)/, 'other workspaces\' tabs filtered');
});

test('a site known only from inner pages still comes first when its name is typed ("youtube" → youtube.com), never from another privacy context', () => {
  const state = (history: HistoryVisit[], tabs = [tab('t', 'acira://new', 'New tab')]) => ({ ...createInitialState(), tabs, activeTabId: tabs[0].id, browsingHistory: history });
  const watched = state([visit('h1', 'https://www.youtube.com/watch?v=abc', 'A song - YouTube')]);
  const [first, second] = rankAddressSuggestions('youtube', watched);
  assert.deepEqual([first.kind, first.url], ['url', 'https://www.youtube.com/'], 'the site root leads');
  assert.equal(second.kind, 'search', 'the search stays one row below');
  assert.equal(rankAddressSuggestions('you', watched)[0].url, 'https://www.youtube.com/', 'a typed prefix of the host is enough');
  assert.equal(rankAddressSuggestions('song', watched)[0].kind, 'search', 'a title word is not an address: it still searches');
  assert.equal(rankAddressSuggestions('tube', watched)[0].kind, 'search', 'a mid-host match never replaces a search');
  assert.equal(rankAddressSuggestions('yo', watched)[0].kind, 'search', 'two letters stay a search, as for a front page already in history');
  assert.equal(rankAddressSuggestions('youtube', state([])).length, 1, 'nothing known: only the search');
  const withRoot = rankAddressSuggestions('youtube', state([visit('h1', 'https://www.youtube.com/watch?v=abc', 'Song'), visit('h2', 'https://www.youtube.com/', 'YouTube')]));
  assert.deepEqual([withRoot[0].kind, withRoot[0].title], ['history', 'YouTube'], 'a front page in history is still preferred over the made-up root');
  const torOnly = state([visit('h3', 'https://www.youtube.com/watch?v=abc', 'Song', TOR)]);
  assert.equal(rankAddressSuggestions('youtube', torOnly)[0].kind, 'search', 'another profile\'s history never names a site');
});

test('remove ×: only history rows carry it, and a press on the list never takes the field\'s focus', () => {
  // Rendered on the server the list would need motion's DOM; the row's condition and the focus hand-back are what matter.
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
  const list = read('../src/components/AddressSuggestions.tsx'), main = read('../desktop/main.cjs'), field = read('../src/components/AddressField.tsx');
  assert.ok(list.includes(`{item.kind==='history'&&item.historyId?<button type="button" className="address-suggestion-remove" tabIndex={-1}`), 'only history rows get the ×');
  assert.ok(list.includes('onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()'), 'a press never moves focus inside the list');
  assert.ok(main.includes(`if(contents===overlayView?.webContents&&layout.overlay?.kind==='suggestions'){`) && main.includes(`setImmediate(()=>{if(layout.overlay?.kind==='suggestions'&&contents.isFocused()&&chromeView&&!chromeView.webContents.isDestroyed())focusContents(chromeView.webContents);});return;}`), 'main hands focus back to the field once the press has moved it');
  assert.ok(field.includes('if (suggestionOpen && !event.relatedTarget && !document.hasFocus())'), 'the field waits for focus to come back before closing');
});
