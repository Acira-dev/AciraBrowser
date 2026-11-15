import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { NEW_TAB_BOX, blurKeepsList, newTabBoxOf, newTabFieldServed, type NewTabField } from '../src/ui/newTabSuggest';
import { rankAddressSuggestions } from '../src/ui/addressSuggestions';
import { createInitialState, makeTab } from '../src/runtime/core';

// 13.10, a user (Discord): "No suggestions come up on the search bar in the new tab; they do come up in the address bar."
// The New Tab page's search box is the toolbar's own AddressField, but only the toolbar's was wired to the suggestion list (App.tsx):
// the page passed no suggestion props, nothing ever opened the list for it and the list could only hang from `.address-bar`.
// Now the box is the second field that one list serves: the same ranking, the same list (native overlay or local popup), the same keys.

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.tsx'), page = read('../src/features/newtab/NewTabPage.tsx'), workspace = read('../src/features/FrostWorkspace.tsx');
const field = (tabId = 'a', text = 'q'): NewTabField => ({ tabId, text, input: {} as HTMLInputElement, box: {} as HTMLElement, setText: () => {} });

test('the box is the field the list answers only on the shown tab and only while suggestions are on', () => {
  assert.equal(newTabFieldServed(field('a'), 'a', true), true);
  assert.equal(newTabFieldServed(field('a'), 'b', true), false, 'another tab is shown: the rows are ranked from that tab\'s side of every privacy line');
  assert.equal(newTabFieldServed(field('a'), 'a', false), false, 'the setting is off: the box behaves as it did before 13.10');
  assert.equal(newTabFieldServed(null, 'a', true), false, 'the keyboard is not in the box');
});

test('the list hangs from the search box the keyboard is in, and from nothing else', () => {
  const box = { id: 'box' }, seen: string[] = [];
  const inside = { closest: (selector: string) => { seen.push(selector); return selector === NEW_TAB_BOX ? box : null; } } as unknown as Element;
  assert.equal(newTabBoxOf(inside), box);
  assert.deepEqual(seen, ['.nt-search']);
  assert.equal(newTabBoxOf({ closest: () => null } as unknown as Element), null, 'the address field (or any field outside the page\'s box) keeps its own anchor');
  assert.equal(newTabBoxOf(null), null);
});

test('a blur ends the list unless the keyboard went to a popup trigger (the address field\'s rule, shared)', () => {
  class FakeElement { constructor(readonly trigger: boolean) {} closest(selector: string) { return selector === '[data-popup-trigger]' && this.trigger ? this : null; } }
  (globalThis as { Element?: unknown }).Element = FakeElement;
  assert.equal(blurKeepsList(new FakeElement(true) as unknown as EventTarget), true);
  assert.equal(blurKeepsList(new FakeElement(false) as unknown as EventTarget), false);
  assert.equal(blurKeepsList(null), false, 'the keyboard left the window: the list goes');
});

test('the box asks the same ranking the address field does, so it shows the same rows in the same order', () => {
  const state = createInitialState();
  const zebra = makeTab('b', '', 'https://example.com/zebra-garden', state.activeBrowserProfileId);
  zebra.title = 'Zebra Garden Guide';
  state.tabs = [makeTab('a', '', 'acira://new', state.activeBrowserProfileId), zebra]; state.activeTabId = 'a';
  state.browsingHistory = [{ id: 'h1', url: 'https://example.com/quantum', title: 'Quantum Gardens Weekly', time: new Date().toISOString(), browserProfileId: state.activeBrowserProfileId } as never];
  state.bookmarks = ['https://example.com/quokka-bookmark'];
  const rows = (text: string) => rankAddressSuggestions(text, state, 8).map(row => `${row.kind}:${row.title}`);
  assert.ok(rows('zeb').includes('tab:Zebra Garden Guide'), 'an open tab');
  assert.ok(rows('quan').includes('history:Quantum Gardens Weekly'), 'history');
  assert.ok(rows('quokka').some(row => row.startsWith('bookmark:')), 'a bookmark');
  assert.equal(rows('quan')[0].startsWith('search:'), true, 'Enter takes the first row: what was typed, as ever');
});

test('NewTabPage hands the box to the window\'s list: a combobox with the list\'s id, its own keys and its draft', () => {
  assert.match(page, /import type \{ NewTabField, NewTabSuggest \} from '\.\.\/\.\.\/ui\/newTabSuggest';/);
  assert.match(page, /suggest\?: NewTabSuggest/, 'optional: a page the window gives nothing behaves as before');
  assert.match(page, /onSuggestionKeyDown=\{suggest\?\.enabled \? suggest\.key : undefined\}/, 'role=combobox and the list keys (the field only becomes a combobox when it has them; with the setting off it stays the plain field it was)');
  assert.match(page, /suggestionOpen=\{Boolean\(suggest\?\.open\)\} suggestionListId=\{suggest\?\.listId\} activeSuggestionId=\{suggest\?\.activeId\}/);
  assert.match(page, /onChange=\{value => \{ draft\.edit\(value\); const field = searchField\(value\); if \(field\) suggest\?\.change\(field\); \}\}/, 'each edit: typing, a paste, an input method');
  assert.match(page, /onFocus=\{\(\) => \{ draft\.onFocus\(\); const field = searchField\(draft\.value\); if \(field\) suggest\?\.focus\(field\); \}\}/);
  assert.match(page, /onBlur=\{event => \{ draft\.onBlur\(\); suggest\?\.blur\(event\); \}\}/);
  assert.match(page, /onViewBlur=\{suggest\?\.viewBlur\}/, 'the list\'s grace after only the view lost the keyboard');
  assert.match(page, /setText: draft\.edit/, 'Tab\'s completion writes the page\'s own draft');
  assert.match(page, /useEffect\(\(\) => \(\) => suggestRef\.current\?\.leave\(\), \[\]\)/, 'a page that goes with the box registered lets it go (a stale box would steal the address field\'s list)');
  assert.match(page, /<form ref=\{box\} className="nt-search nt-vapor"/, 'the list hangs from the visible box');
});

test('the window serves the box with the address field\'s own list: ranking, native overlay query, local list, keys and anchor', () => {
  assert.match(workspace, /suggest=\{suggest\}|suggest=\{suggest\}\/>/);
  assert.match(app, /suggest=\{newTabSuggest\}\/>/, 'App hands the New Tab page its list');
  assert.match(app, /const suggestionText = ntpOn \? ntpField\.text : address;/);
  assert.match(app, /const suggestionsWanted = addressFocused \|\| overlay === 'suggestions' \|\| ntpOn;/);
  assert.match(app, /rankAddressSuggestions\(suggestionText, state, 8, \{ commands: addressCommands \}\)/, 'the one ranking');
  assert.match(app, /overlay === 'suggestions' \? \{ query: suggestionText\.slice\(0, 4096\), index: activeSuggestionIndex \}/, 'the native overlay ranks the text of the field in use');
  assert.match(app, /query=\{suggestionText\}/, 'the local list too');
  assert.match(app, /native, overlay, popupSerial, contextId, address, addressAnchor, suggestionText, activeSuggestionIndex/, 'the layout that sends the list re-runs as the box\'s text changes');
  assert.match(app, /key: event => suggestionKey\(event, true\)/, 'the box\'s keys are the address field\'s keys');
  assert.match(app, /if \(fromNewTab !== ntpOn\)\s+return false;/, 'the address field\'s keys never act on the box, nor the box\'s on the address field');
  assert.match(app, /const newTabBox = kind === 'suggestions' \? newTabBoxOf\(document\.activeElement\) : null;/, 'the list hangs from the box');
  assert.match(app, /address: Boolean\(target\.closest\(`\.address-bar,\$\{NEW_TAB_BOX\}`\)\)/, 'a press inside the box does not close its list');
  assert.match(app, /suggesting=\{overlay === 'suggestions' && !ntpOn\}/, 'the sidebar\'s address pill hides only for the address field\'s list');
  assert.match(app, /ntpRef\.current\?\.input\.blur\(\);/, 'a row chosen in the native list ends the box\'s edit as it ends the address field\'s');
});

test('a chosen row, a command or an answer lets go of the box as it lets go of the address field', () => {
  assert.match(app, /const leaveField = \(ranRow = false\) => \{ addressRef\.current\?\.blur\(\); if \(ntpOn\) \{ if \(ranRow\) ntpField\.setText\(''\); ntpField\.input\.blur\(\); setNtpField\(null\); \} \};/);
  assert.match(app, /navigate\(item\.url, tab\.id, suggestionText\); leaveField\(\);/, 'what was typed in the box is what a default https address is offered http for');
  assert.match(app, /const editFieldText = \(next: string\) => \{ if \(ntpOn\) \{ ntpField\.setText\(next\); setNtpField\(\{ \.\.\.ntpField, text: next \}\); \} else \{ setAddressEditTab\(tab\.id\); setAddress\(next\); \} \};/, 'Tab completes the field in use');
  assert.match(app, /requestAnimationFrame\(\(\) => \(ntpOn \? ntpField\.input : addressRef\.current\)\?\.setSelectionRange\(from, completed\.length\)\)/);
});

test('the setting that turns address suggestions off keeps the box as it was: nothing registers, nothing opens', () => {
  assert.match(app, /const ntpOn = newTabFieldServed\(ntpField, tab\.id, s\.addressSuggestions\);/);
  assert.match(app, /focus: field => \{ if \(!s\.addressSuggestions\) return; setNtpField\(field\);/);
  assert.match(app, /change: field => \{ if \(!s\.addressSuggestions\) return; setNtpField\(field\);/);
  assert.match(app, /useLayoutEffect\(\(\) => \{ if \(overlay === 'suggestions' && !s\.addressSuggestions\)\s+setOverlay\(null\); \}/, 'turning it off while a list is up closes it');
});

test('private and Tor New Tab pages have no search box, so the list never reaches them', () => {
  const frost = read('../src/features/FrostWorkspace.tsx');
  assert.match(frost, /isTorWindow\(state\)\) return <TorNewTab/);
  assert.match(frost, /return <PrivateNewTab/);
  assert.doesNotMatch(read('../src/features/newtab/PrivateNewTab.tsx'), /AddressField|<input/);
  assert.doesNotMatch(read('../src/features/tor/TorNewTab.tsx'), /AddressField|suggest/i);
});
