import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addressBlur, addressOnNewUrl, afterViewBlurGrace } from '../src/ui/addressEdit';
import { createInitialState } from '../src/runtime/core';
import { resolveNavigation } from '../src/runtime/navigation';
import { NORMALIZED_ADDRESS_LIMIT, normalizedAddressCount, rankAddressSuggestions } from '../src/ui/addressSuggestions';

// 13.8, a Windows report on 13.7: the address field "cuts back between what I typed a second ago and what I'm typing now". Two of the ways
// an older text replaced the person's typing, both reproduced in a hidden Acira (the third, main handing the keyboard to a page shown late,
// is tests/address-typing-wins.test.cjs):
//  - any loss of the keyboard by the interface's view for longer than 200 ms (the suggestion list's grace), with the list open or not, ended
//    the edit: the typed text went back to the page's address, and when the keyboard came back the whole address was selected (the next letter
//    replaced it) or the letters were added to its end. "hello", the view away 600 ms, " world" -> "http://127.0.0.1:9941/b world";
//  - on a site that rewrites its own address (a single-page site, a search results page), a click on the field selected the address, the
//    site's next address replaced it unselected, and the letters typed were added to its end: "http://127.0.0.1:9941/spa?i=14hello world
//    example" (6/6 runs).
// The rules are Chromium's omnibox (ui/addressEdit.ts names the functions).

test('a blur of the interface\'s view (the field is still the focused element) keeps an edit; a blur of the field ends it', () => {
  const view = { relatedTarget: null, documentHasFocus: false, fieldStillFocused: true, edited: true };
  assert.equal(addressBlur(view), 'view', 'a press on the suggestion list, a page main gave the keyboard to, another window');
  assert.equal(addressBlur({ ...view, edited: false }), 'left', 'nothing typed: back to the page\'s address, as before (OnKillFocus without user input)');
  assert.equal(addressBlur({ relatedTarget: {}, documentHasFocus: true, fieldStillFocused: false, edited: true }), 'left', 'a click on another control of the interface');
  assert.equal(addressBlur({ relatedTarget: null, documentHasFocus: true, fieldStillFocused: false, edited: true }), 'left', 'Esc, Enter, a script\'s blur()');
  assert.equal(addressBlur({ ...view, fieldStillFocused: false }), 'left', 'the field itself is not the focused element any more');
  assert.equal(addressBlur({ ...view, relatedTarget: {} }), 'left', 'focus went to another element');
});

test('after the list\'s grace the view is still away: the list closes and the edit stays; the field taken away meanwhile ends it', () => {
  assert.equal(afterViewBlurGrace(true), 'close-list');
  assert.equal(afterViewBlurGrace(false), 'left');
});

test('a new address for the tab: the person\'s edit stays (user_input_in_progress); in use, the new text is selected in full', () => {
  const base = { shown: 'https://site.test/b', current: 'https://site.test/a', editing: false, focused: false, listOpen: false };
  assert.equal(addressOnNewUrl({ ...base, editing: true, focused: true }), null, 'what was typed wins');
  assert.deepEqual(addressOnNewUrl({ ...base, focused: true }), { text: 'https://site.test/b', selectAll: true }, 'clicked, nothing typed yet: the next letter replaces the new address');
  assert.deepEqual(addressOnNewUrl(base), { text: 'https://site.test/b', selectAll: false }, 'not in use: the field just follows the tab');
  assert.equal(addressOnNewUrl({ ...base, focused: true, listOpen: true }), null, 'in use with the list open: the text stays (Chromium: !PopupIsOpen())');
  assert.deepEqual(addressOnNewUrl({ ...base, listOpen: true }), { text: 'https://site.test/b', selectAll: false }, 'the list only counts while the field is in use');
  assert.equal(addressOnNewUrl({ ...base, current: base.shown, focused: true }), null, 'nothing new: nothing changes, nothing is selected');
});

// ---- wiring

const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const field = read('../src/components/AddressField.tsx'), app = read('../src/App.tsx');

test('the field: a blur of the view is parked with its selection, past the grace; only a field that was taken away ends the edit', () => {
  const blur = field.indexOf("onBlur={event => {"), view = field.indexOf("fieldStillFocused: document.activeElement === input, edited}) === 'view') {", blur), legacy = field.indexOf('if (suggestionOpen && !event.relatedTarget && !document.hasFocus())', blur);
  assert.ok(blur > 0 && view > blur && legacy > view, 'the view case comes first');
  const branch = field.slice(view, legacy);
  assert.ok(branch.includes('parked.current = {start:input.selectionStart,end:input.selectionEnd,direction:input.selectionDirection,event,view:true,'), 'the selection is saved (OnBlur)');
  assert.ok(branch.includes("if (afterViewBlurGrace(document.activeElement === inputRef.current) === 'left') { parked.current = null; finishBlur(p.event); return; }"));
  assert.ok(branch.includes('onViewBlur?.();'), 'after the grace only the list closes');
  assert.ok(!/finishBlur\(event\)/.test(branch), 'the grace no longer ends the edit');
  assert.ok(field.includes('if (back) { window.clearTimeout(back.timer); parked.current = null; if (back.start !== null && back.end !== null) event.target.setSelectionRange(back.start, back.end, back.direction ?? undefined); return; }'), 'focus back restores the selection (OnFocus) and restarts nothing');
  assert.ok(field.includes("leftWhileAway.current = () => { const p = parked.current; if (!p?.view || document.activeElement === inputRef.current) return; window.clearTimeout(p.timer); parked.current = null; finishBlur(p.event); };"));
  assert.ok(field.includes("useEffect(() => { leftWhileAway.current(); });") && field.includes("window.addEventListener('focus', back)"), 'checked after every render and when the view comes back');
});

test('the toolbar: the list closes on a long blur of the view; a new address follows the omnibox rule and is selected in full in use', () => {
  assert.ok(app.includes("onViewBlur={() => { if (openRef.current === 'suggestions') setOverlay(null); }} edited={addressEditTab === tab.id}"), 'only an edit is kept');
  assert.ok(app.includes("next = addressOnNewUrl({ shown: tab.url === 'acira://new' ? '' : tab.url, current: address, editing: addressEditTab === tab.id && addressFocused, focused: addressFocused && input !== null && document.activeElement === input, listOpen: openRef.current === 'suggestions' })"));
  assert.ok(app.includes("selectShown.current = next.selectAll ? next.text : null; setAddress(next.text);"));
  assert.ok(app.includes("const selectShown = useRef<string | null>(null);\n    useLayoutEffect(() => { if (addressCarried.current === tab.id)"), 'in the same task as the render that brought the address: no key between them');
  assert.ok(app.includes("if (input && document.activeElement === input && input.value === want) { input.select(); input.scrollLeft = 0; } }, [address]);"), 'selected in the same frame as the new text, only if it is still that text');
  assert.ok(!app.includes("if (addressEditTab !== tab.id || !addressFocused)\n        setAddress(tab.url === 'acira://new' ? '' : tab.url);"), 'the old unselected replacement is gone');
});

// ---- the lag half of the report: what a keystroke (and every other render of the window) cost
// Ranking the suggestions resolved every history visit's address again at every keystroke, in the interface and again in the list (5000 visits,
// the history limit: ~5.9 ms per ranking on an M5, several times that on a slow laptop), and the interface ranked on every render of the window,
// typing or not (a tab switch, each state from main while pages load).

test('each address is resolved once: a ranking repeated over the same history resolves nothing again, and the answers do not change', () => {
  const s = createInitialState();
  const urls = ['https://www.example.com/a', 'http://localhost:8080/x', 'https://bücher.example/b', 'example.org', 'not an address', 'https://[::1]:3000/', 'ftp://old.example/', 'acira://settings', 'https://example.com:99999/'];
  const history = urls.map((url, i) => ({ id: 'v' + i, url, title: 'Visit ' + i + ' example', time: new Date(2026, 10, 13, 12, i).toISOString(), profileId: '', browserProfileId: s.activeBrowserProfileId }));
  const state = { ...s, browsingHistory: history };
  const first = rankAddressSuggestions('exa', state, 8), count = normalizedAddressCount();
  for (const q of ['e', 'ex', 'exam', 'visit', 'local']) rankAddressSuggestions(q, state, 8);
  assert.equal(normalizedAddressCount(), count, 'no address resolved twice');
  assert.deepEqual(rankAddressSuggestions('exa', state, 8), first, 'the same rows from the remembered answers');
  for (const row of first.filter(item => item.kind === 'history')) assert.equal(row.url, resolveNavigation(row.url).url, 'a remembered answer is the resolver\'s own');
  assert.ok(!first.some(item => item.url === 'acira://new'), 'addresses that resolve to nothing stay out');
  assert.equal(NORMALIZED_ADDRESS_LIMIT, 20000, 'bounded');
});

test('the window ranks only while the field is in use or its list is open', () => {
  assert.ok(app.includes("const suggestionsWanted = addressFocused || overlay === 'suggestions';"));
  assert.ok(app.includes("const suggestions = suggestionsWanted ? rankAddressSuggestions(address, state, 8, { commands: addressCommands }) : []"));
});
