import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { addressRequestIsCurrent, carriesAddressDraft, releaseFocusClaim, takeFocusClaim } from '../src/ui/addressFocusClaim';

// Live finding (d-shortcuts, flaky): Ctrl+T, then Ctrl+L and typing at once. Main has the new tab active while the chrome still paints the last
// one (a snapshot is painted a frame later, up to 100 ms in a window that draws no frames): the letters typed in between were wiped by the
// tab change, and the rest went into a field that had been re-focused and re-selected.
test('a field taken for the incoming tab, with letters typed in it, keeps both across the tab change', () => {
  const draft = { takenFor: 'tab-b', tabId: 'tab-b', previousTabId: 'tab-a', editedTab: 'tab-a', focused: true };
  assert.equal(carriesAddressDraft(draft), true);
  assert.equal(carriesAddressDraft({ ...draft, editedTab: null }), false, 'nothing typed: an ordinary tab change');
  assert.equal(carriesAddressDraft({ ...draft, focused: false }), false, 'the person left the field');
  assert.equal(carriesAddressDraft({ ...draft, takenFor: 'tab-a' }), false, 'a draft begun for the tab being left stays with it');
  assert.equal(carriesAddressDraft({ ...draft, takenFor: null }), false);
  assert.equal(carriesAddressDraft({ ...draft, previousTabId: 'tab-b', editedTab: 'tab-b' }), false, 'same tab: not a tab change');
});

test('the shell takes the field for the tab main reports active, and keeps the draft through the change', () => {
  const client = fs.readFileSync(new URL('../src/runtime/client.ts', import.meta.url), 'utf8');
  assert.match(client, /export const newestActiveTabId=/);
  assert.match(client, /if\(batch\)newestActiveTab=next\.activeTabId\?\?null;/);
  const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /addressTakenFor\.current = newestActiveTabId\(\) \?\? tab\.id;/);
  assert.match(app, /if \(draft\) \{ addressCarried\.current = tab\.id; setAddressEditTab\(tab\.id\); \} else if \(previous\.id !== tab\.id\) \{/);
  assert.match(app, /if \(addressCarried\.current === tab\.id\) \{ addressCarried\.current = null; return; \}/);
});

// Live finding (d-shortcuts, Round 3 source re-run): Ctrl+L on a fresh new tab, then typing at once, lost the first letters. The new
// tab's claim on the address field was still waiting for the toolbar to show and, when it did, focused and selected the field a
// second time, so the next letters replaced the ones already typed.
test('a claim is taken once, by its own tab, when the toolbar is on screen', () => {
  assert.deepEqual(takeFocusClaim('tab-a', 'tab-a', true), { focus: true, claim: null });
  assert.deepEqual(takeFocusClaim(null, 'tab-a', true), { focus: false, claim: null }, 'nothing left to take the second time');
});

test('a claim waits while the toolbar is hidden, and does not belong to another tab', () => {
  assert.deepEqual(takeFocusClaim('tab-a', 'tab-a', false), { focus: false, claim: 'tab-a' });
  assert.deepEqual(takeFocusClaim('tab-a', 'tab-b', true), { focus: false, claim: 'tab-a' });
});

test('once the person takes the field (Ctrl+L, typing, Esc, the command bar) the claim is gone for good', () => {
  const claim = releaseFocusClaim();
  assert.equal(claim, null);
  assert.deepEqual(takeFocusClaim(claim, 'tab-a', true), { focus: false, claim: null }, 'a late toolbar reveal cannot re-select the typed text');
});

test('late native address requests cannot select text typed after the request', () => {
  assert.equal(addressRequestIsCurrent(1000,{tabId:'a',at:1001},'a'),false);
  assert.equal(addressRequestIsCurrent(1000,{tabId:'a',at:1000},'a'),false,'same-millisecond input is preserved');
});

test('a fresh address shortcut still selects existing text and does not inherit another tab edit', () => {
  assert.equal(addressRequestIsCurrent(1002,{tabId:'a',at:1001},'a'),true);
  assert.equal(addressRequestIsCurrent(1000,{tabId:'other',at:1001},'a'),true);
  assert.equal(addressRequestIsCurrent(1000,null,'a'),true);
  assert.equal(addressRequestIsCurrent(undefined,{tabId:'a',at:1001},'a'),true,'preview/legacy requests stay immediate');
});

test('the hook releases the claim on Ctrl+L, the command bar, Esc and on typing in the field, and takes it through the rule', () => {
  const source = fs.readFileSync(new URL('../src/ui/useNewTabReveal.ts', import.meta.url), 'utf8');
  assert.match(source, /\['address','palette','escape'\]\.includes\(event\.command\)\)\{pendingMode\.current=null;pendingFocus\.current=releaseFocusClaim\(\);/);
  assert.match(source, /event\.target===addressRef\.current\)\{pendingFocus\.current=releaseFocusClaim\(\);/);
  assert.match(source, /takeFocusClaim\(pendingFocus\.current,tab\.id,reveal\|\|focusMode\)/);
});

// Paste and go (the address field's context menu) navigates the tab from main. Enter blurs the field and drops the draft; this path
// left "some draft" in the field, focused, with its suggestion list open, over the page it had just opened.
test('Paste and go commits the address like Enter: main tells the field to let go', () => {
  const main = fs.readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /createChromeEditMenu\(\{[^]*?navigate:\(tabId,url\)=>\{dispatch\(\{type:'tab\.navigate',tabId,url\}\);[^]*?emitBrowser\(\{type:'ui',action:'address-commit'\}\);[^]*?browserCommand\(\{type:'focus',tabId\}\)[^]*?\}\}\);/);
});
