import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { overlayOutlivesTabChange, overlayOutlivesLayoutChange, overlayPointerDismiss, sameOverlayId, takesTypedText } from '../src/ui/interactionPolicy';

test('R4-22 every menu and panel closes on a tab change; only the tab viewer and the suggestions being typed survive', () => {
  for (const kind of ['menu', 'more-tools', 'profile', 'accounts', 'extensions', 'bookmarks', 'protection', 'split', 'zoom', 'tab-context', 'downloads', 'vpn'])
    assert.equal(overlayOutlivesTabChange(kind), false, kind);
  assert.equal(overlayOutlivesTabChange('tabs'), true);
  assert.equal(overlayOutlivesTabChange('suggestions', true), true);
  assert.equal(overlayOutlivesTabChange('suggestions', false), false);
  assert.equal(overlayOutlivesTabChange(null), false);
});

test('R4-22 a click anywhere outside a popup and its trigger dismisses it (tabs included)', () => {
  assert.equal(overlayPointerDismiss({ popup: false, trigger: false, address: false, suggestions: false }), true);
  assert.equal(overlayPointerDismiss({ popup: true, trigger: false, address: false, suggestions: false }), false);
  assert.equal(overlayPointerDismiss({ popup: false, trigger: true, address: false, suggestions: false }), false, 'the trigger toggles it itself');
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(!app.includes("['profile', 'accounts', 'extensions']"), 'no popup is exempt from outside clicks or tab changes any more');
});

test('R4-22 a press on the window frame (drag area, caption buttons) closes the open menu in main, guarded for Windows', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /mainWindow\.on\('will-move',\(\)=>\{if\(!dialogDepth\)closeOverlay\(false\);\}\)/);
  assert.match(main, /process\.platform==='win32'&&typeof mainWindow\.hookWindowMessage==='function'\)for\(const message of \[0x00A1,0x00A4,0x00A7\]\)/);
  assert.match(main, /for\(const event of \['blur','minimize','hide'\]\)mainWindow\.on\(event,\(\)=>\{if\(!dialogDepth\)closeOverlay\(false\);\}\)/);
});

// Layout previews are distinct from leaving the tab that owns a menu.
test('view and tab-layout controls survive preview changes while page-specific menus close', () => {
  for (const kind of ['menu','more-tools','toolbar-context','tabs','suggestions']) assert.equal(overlayOutlivesLayoutChange(kind),true,kind);
  for (const kind of ['profile','security','bookmark-edit','tab-context','split','downloads',null]) assert.equal(overlayOutlivesLayoutChange(kind),false,String(kind));
  for (const kind of ['menu','more-tools','toolbar-context']) assert.equal(overlayOutlivesTabChange(kind),false,String(kind));
});

// The Acira menu's three window rows used to call runtime.openWindow alone: the menu stayed up until the new window took focus
// (and in the original window until a blur arrived), while every other row, the tab strip's menu and the profile popup close it.
test('the Acira menu rows that open a window close the menu through menuParts.openWindow', () => {
  const menu = readFileSync(new URL('../src/components/BrowserMenu.tsx', import.meta.url), 'utf8');
  for (const kind of ['normal', 'private', 'tor']) assert.ok(menu.includes(`p.openWindow?p.openWindow('${kind}'):runtime.openWindow('${kind}')`), kind);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.match(app, /openWindow: \(kind: 'normal' \| 'private' \| 'tor'\) => \{ runtime\.openWindow\(kind\); close\(\); \}/);
});

// New workspace → Create switched the window to the new workspace (a tab change). The same commit cleared the popup's id and still
// published its kind; main showed that id-less popup, and the layout echo for it matched the live `none` layout because
// `undefined === undefined`, so the live layout re-sent the closed form and it stayed on screen.
test('a popup layout without an id is never "the same popup" as another layout without an id', () => {
  assert.equal(sameOverlayId({ id: 7 }, { id: 7 }), true);
  assert.equal(sameOverlayId({ id: 7 }, { id: 8 }), false);
  assert.equal(sameOverlayId(undefined, undefined), false, 'a layout with no popup against an echo with no id');
  assert.equal(sameOverlayId({}, {}), false);
  assert.equal(sameOverlayId({ id: 7 }, undefined), false);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes('sameOverlayId(current.overlay, next.overlay)'), 'the echo of a popup layout is matched by id');
  assert.ok(app.includes('if (native && overlay && overlayId.current !== undefined) {'), 'a popup whose id was cleared is not published again');
});

// The browser view holds 18 'acira:browser-event' subscribers (steady through any popup/tab churn); Node warns past 10 listeners, which
// printed a MaxListenersExceededWarning in every window's console.
test('the interface preload raises the IPC listener limit above its steady subscriber count', () => {
  const preload = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  const limit = Number(/ipcRenderer\.setMaxListeners\((\d+)\)/.exec(preload)?.[1]);
  assert.ok(limit >= 32, 'ipcRenderer.setMaxListeners(n) with room above 18 subscribers, got ' + limit);
});

// The popup's id must outlive its kind by one commit: the two places that closed a popup used to drop the id first, so the commit
// that still held the kind published an id-less popup (the race behind the stuck New workspace form, the Ctrl+Tab switcher that
// reopened after tab.select, and the 'acira:popup-backdrop … outside the active surface' errors).
test('the popup id is released with its kind, not before it', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const drops = app.match(/overlayId\.current = undefined;/g) ?? [];
  assert.equal(drops.length, 2, 'only releaseOverlayId() and the layout effect that follows the overlay state clear the id');
  assert.ok(app.includes('useLayoutEffect(() => { if (overlay === null) overlayId.current = undefined; }, [overlay]);'));
  assert.ok(app.includes('const releaseOverlayId = () => { if (openRef.current === null) overlayId.current = undefined; };'));
  const dismissed = app.slice(app.indexOf("event.type === 'overlay-dismissed' && event.id === overlayId.current"), app.indexOf("event.type === 'page-interaction'"));
  assert.ok(dismissed.includes('releaseOverlayId();') && !dismissed.includes('overlayId.current = undefined'), 'the dismissal handler does not drop the id first');
});

// setOverlay(null) also runs on every tab change with no popup in state. It used to send closeOverlay(undefined), which main reads as
// "whatever overlay is up": a showing toast was taken down and its id marked dismissed, so it (and every toast added before the list
// emptied) never showed again.
test('setOverlay(null) asks main to close a popup only when there is one', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  const start = app.indexOf('const setOverlay = (kind: string | null) => {');
  const body = app.slice(start, app.indexOf('popupTransition.current!.set(kind); };', start));
  assert.ok(body.includes('if (overlayId.current !== undefined) runtime.closeOverlay(overlayId.current);'));
  assert.equal((body.match(/runtime\.closeOverlay\(/g) ?? []).length, 1, 'and that is the only close it sends');
});

// QA monkey op 10: the tab viewer did not open on a Mac. The address bar had focus there, which is by design (Option+T types "†" in a text
// field; desktop/main.cjs hands the key to the interface, and the interface leaves text fields alone). But the exemption matched every
// <input>, so a checkbox, radio or slider kept the viewer from opening after a click in Settings too, where nothing is typed.
test('Option+T on a Mac is left to text fields only: a focused checkbox, radio or slider still opens the tab viewer', () => {
  const inside = (tagName: string, type?: string) => ({ closest: () => ({ tagName, type }) }) as unknown as EventTarget;
  for (const type of ['text', 'search', 'url', 'email', 'password', 'number', 'tel', ''])
    assert.equal(takesTypedText(inside('INPUT', type)), true, 'input ' + (type || '(default)'));
  assert.equal(takesTypedText(inside('TEXTAREA')), true);
  assert.equal(takesTypedText(inside('DIV')), true, 'a contenteditable element');
  for (const type of ['checkbox', 'radio', 'range', 'color', 'button', 'submit', 'file', 'CHECKBOX'])
    assert.equal(takesTypedText(inside('INPUT', type)), false, 'input ' + type);
  assert.equal(takesTypedText({ closest: () => null } as unknown as EventTarget), false, 'nothing editable around the target');
  assert.equal(takesTypedText(null), false);
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  assert.ok(app.includes("window.acira?.platform === 'darwin' && takesTypedText(e.target)"), 'the Option+T handler uses it');
});
