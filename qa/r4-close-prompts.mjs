// NOTE (R4-47/49): the card wording, button order and positions changed after this script was written; qa/r4-47-close-card.mjs is the current check of the cards. This one still drives the close flows (windows, quit, restore) and needs its card texts updated before it is rerun.
// R4-35 / R4-36 live check on the real app: the glass cards for unsaved work and for closing the browser.
//   node qa/r4-close-prompts.mjs            (needs a native slot: takes C:\ae\slot-N.lock, releases it in finally)
// A local page with a beforeunload handler stands in for "a document with unsaved changes". Keys go in through
// webContents.sendInputEvent (Ctrl+W, Ctrl+Shift+Q, Enter, Esc); the window's close (what ×, Alt+F4 and the taskbar send) is the
// real WM_SYSCOMMAND/SC_CLOSE posted to this app's own window handle, never to another application. Evidence: PNGs of the whole window
// (desktopCapturer, real pixels) in dark and light at 100% and 150%.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
process.env.D_VISIBLE ??= '1'; // the cards sit on the page that is on screen
const run = promisify(execFile);
const OUT = process.env.R4_SHOTS || 'C:/ae/r4/close-prompts/evidence';
const root = '.qa-profiles/r4-close-prompts';
await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(OUT, {recursive: true});

// ---- native slot (at most three Electron apps at once on this machine) ----------------------------------------------------
async function takeSlot() {
  const deadline = Date.now() + 20 * 60000;
  while (Date.now() < deadline) {
    for (const n of [1, 2, 3]) {
      const file = `C:/ae/slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`close-prompts-r4 ${new Date().toISOString()}`); await handle.close(); return file; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}
const slot = await takeSlot();
const report = [], fx = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/dirty')) res.end(`<title>Draft</title><body style="font:16px sans-serif;padding:24px"><h1>Draft document</h1><textarea id=t rows=4 cols=40>My unsaved notes</textarea><script>window.__dirty=true;addEventListener('beforeunload',e=>{if(window.__dirty){e.preventDefault();e.returnValue='';}});</script></body>`);
  else res.end('<title>Clean page</title><body style="font:16px sans-serif;padding:24px"><h1>Nothing to lose here</h1></body>');
});
const dirtyA = `http://127.0.0.1:${fx.port}/dirty`, dirtyB = `http://localhost:${fx.port}/dirty`, clean = `http://127.0.0.1:${fx.port}/clean`;
let app;
let uiPage = null; // the interface of the window still open once the first one was closed on purpose
const act = a => (uiPage || app.ui).evaluate(a => window.acira.dispatch(a), a);
const state = () => (uiPage || app.ui).evaluate(() => window.acira.getSnapshot());
const wins = () => app.main(({BaseWindow}) => BaseWindow.getAllWindows().length);
const tabs = async () => (await state()).tabs.filter(t => t.contentKind === 'web').length;
const cards = () => app.context.pages().filter(p => { try { return p.url().includes('site-prompt.html'); } catch { return false; } });
async function card(label, text) {
  const page = await poll(async () => { for (const p of cards()) { try { if (await p.locator('#card').isVisible() && await p.locator('#title').textContent()) return p; } catch {} } }, Boolean, label + ' card appears', 15000);
  await poll(() => page.locator('#title').textContent(), t => text.test(t), label + ' card text', 6000);
  await sleep(450); // the entrance (spring) has landed
  return page;
}
const noCard = label => poll(async () => { for (const p of cards()) { try { if (await p.locator('#card').isVisible()) return false; } catch {} } return true; }, Boolean, label + ' card gone', 8000);
const buttons = page => page.locator('button.act').allTextContents();
async function key(winIndex, keyCode, modifiers = [], char) {
  await app.main(({webContents}, a) => { // the interface view of the window
    const ui = webContents.getAllWebContents().filter(wc => wc.getURL().startsWith('acira-browser-ui://') && !wc.getURL().includes('overlay'))[a.winIndex] || webContents.getAllWebContents().find(wc => wc.getURL().startsWith('acira-browser-ui://'));
    ui.focus();
    ui.sendInputEvent({type: 'rawKeyDown', keyCode: a.keyCode, modifiers: a.modifiers});
    if (a.char) ui.sendInputEvent({type: 'char', keyCode: a.char, modifiers: a.modifiers});
    ui.sendInputEvent({type: 'keyUp', keyCode: a.keyCode, modifiers: a.modifiers});
  }, {winIndex, keyCode, modifiers, char});
}
const holder = () => app.main(({BaseWindow}) => BaseWindow.getAllWindows().findIndex(w => w.contentView.children.some(v => { try { return v.webContents && v.webContents.getURL().includes('/dirty'); } catch { return false; } }))); // the window that holds the unsaved page
async function closeWindowLikeX(index) { // WM_SYSCOMMAND SC_CLOSE to this app's own window: what ×, Alt+F4 and the taskbar's Close send
  const hwnd = await app.main(({BaseWindow}, i) => { const w = BaseWindow.getAllWindows()[i]; return w.getNativeWindowHandle().readBigUInt64LE(0).toString(); }, index);
  const ps = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h,uint m,System.IntPtr w,System.IntPtr l);'; [W.U]::PostMessage([System.IntPtr]${hwnd},0x0112,[System.IntPtr]0xF060,[System.IntPtr]0)`;
  await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps]);
}
async function shot(name, winIndex = 0) { // real pixels of the whole window
  const b64 = await app.main(async ({BaseWindow, desktopCapturer, screen}, i) => {
    const win = BaseWindow.getAllWindows()[i]; win.setAlwaysOnTop(true); win.focus(); await new Promise(r => setTimeout(r, 250));
    const b = win.getBounds(), f = screen.getDisplayMatching(b).scaleFactor, id = win.getMediaSourceId();
    const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: Math.round(b.width * f), height: Math.round(b.height * f)}});
    const hit = sources.find(s => s.id === id); win.setAlwaysOnTop(false);
    return hit ? hit.thumbnail.toPNG().toString('base64') : null;
  }, winIndex);
  assert.ok(b64, 'window capture ' + name); await fs.writeFile(path.join(OUT, name + '.png'), Buffer.from(b64, 'base64')); return name;
}
const clearDirty = async () => { for (const p of app.context.pages()) { try { if (/\/dirty/.test(p.url())) await p.evaluate(() => { window.__dirty = false; }); } catch {} } };
async function cleanup() { // a card waiting for an answer must not hold the slot: close politely, then end the process this script started
  if (!app) return; const child = (() => { try { return app.app.process(); } catch { return null; } })();
  try { await clearDirty(); } catch {} try { await Promise.race([app.close(), sleep(12000)]); } catch {}
  try { if (child && child.exitCode === null) { child.kill(); await sleep(800); } } catch {}
}

try {
  app = await startApp({root});
  await act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100, animationSpeed: 'fast'}});

  // ---- R4-35 · one tab, then several ----------------------------------------------------------------------------------------
  await act({type: 'tab.new', url: dirtyA}); await app.waitWeb(dirtyA); await sleep(700);
  await act({type: 'tab.new', url: clean}); await app.waitWeb(clean);
  const before = await tabs();
  const dirtyTab = (await state()).tabs.find(t => t.url === dirtyA); await act({type: 'tab.select', id: dirtyTab.id}); await sleep(300);
  await key(0, 'W', ['control']);
  let c = await card('tab close', /127\.0\.0\.1:\d+ has changes that may not be saved/);
  assert.deepEqual(await buttons(c), ['Close anyway', 'Cancel']); report.push('Ctrl+W on a page with unsaved changes: card "<site> has changes that may not be saved", buttons Close anyway / Cancel');
  assert.match(await c.locator('#detail').textContent(), /If you close this tab, those changes could be lost/);
  await shot('r4-35-tab-dark-100');
  await c.locator('button.act', {hasText: 'Cancel'}).click(); await noCard('Cancel'); assert.equal(await tabs(), before); report.push('Cancel keeps the tab');
  await key(0, 'W', ['control']); c = await card('tab close again', /has changes/); await c.keyboard.press('Escape'); await noCard('Esc'); assert.equal(await tabs(), before); report.push('Esc = Cancel');
  await key(0, 'W', ['control']); c = await card('tab close enter', /has changes/); await c.keyboard.press('Enter'); await noCard('Enter'); assert.equal(await tabs(), before); report.push('Enter on an unsaved-work card = Cancel (keeps the work)');
  // the tab's own × (a real click)
  const closeBtn = app.ui.getByRole('button', {name: /^Close Draft/}).first(); await closeBtn.hover({force: true}).catch(() => {}); await closeBtn.click({force: true});
  c = await card('tab x', /has changes/); await c.locator('button.act', {hasText: 'Close anyway'}).click(); await poll(tabs, n => n === before - 1, 'tab closed after Close anyway'); report.push('the tab × and Close anyway close it');

  // several unsaved tabs, closed together (Close other tabs): one card
  await act({type: 'tab.new', url: dirtyA}); await app.waitWeb(dirtyA); await act({type: 'tab.new', url: dirtyB}); await app.waitWeb(dirtyB); await sleep(700);
  const keep = (await state()).tabs.find(t => t.url === clean); await act({type: 'tab.select', id: keep.id}); await sleep(200);
  const n1 = await tabs(); await act({type: 'tab.close.others', id: keep.id});
  c = await card('close others', /2 tabs have changes that may not be saved/);
  const detail = (await c.locator('#sites .host').allTextContents()).join(' '); assert.match(detail, /127\.0\.0\.1:\d+/); assert.match(detail, /localhost:\d+/); report.push('Close other tabs: ONE card listing both sites');
  await shot('r4-35-tabs-dark-100');
  await c.locator('button.act', {hasText: 'Cancel'}).click(); await noCard('bulk cancel'); await sleep(400); assert.equal(await tabs(), n1); report.push('Cancel leaves every tab open');
  await act({type: 'tab.close.others', id: keep.id}); c = await card('close others 2', /2 tabs/); await c.locator('button.act', {hasText: 'Close anyway'}).click();
  await poll(tabs, n => n === 1, 'only the kept tab remains'); report.push('Close anyway closes them all with no further prompt');

  // ---- R4-35 · a window with unsaved work (another window stays open) ---------------------------------------------------------
  await act({type: 'tab.new', url: dirtyA}); await app.waitWeb(dirtyA);
  await app.main(({BaseWindow}) => BaseWindow.getAllWindows().length); // window 2:
  await act({type: 'window.new'}).catch(() => {});
  if ((await wins()) < 2) await app.main(({webContents}) => { const ui = webContents.getAllWebContents().find(wc => wc.getURL().startsWith('acira-browser-ui://')); ui.sendInputEvent({type: 'rawKeyDown', keyCode: 'N', modifiers: ['control']}); ui.sendInputEvent({type: 'keyUp', keyCode: 'N', modifiers: ['control']}); });
  await poll(wins, n => n >= 2, 'second window', 15000);
  await sleep(1500);
  const holding = await holder(); assert.ok(holding >= 0, 'a window holds the dirty page'); await closeWindowLikeX(holding);
  c = await card('window close', /127\.0\.0\.1:\d+ has changes that may not be saved/);
  assert.match(await c.locator('#detail').textContent(), /If you close this window, those changes could be lost/); report.push('window close (× / Alt+F4 / taskbar) with unsaved work: the same card, "this window"');
  await shot('r4-35-window-dark-100', holding);
  await c.locator('button.act', {hasText: 'Cancel'}).click(); await noCard('window cancel'); await sleep(600); assert.equal(await wins(), 2); report.push('Cancel: both windows still open');
  await closeWindowLikeX(await holder()); c = await card('window close 2', /has changes/); await c.locator('button.act', {hasText: 'Close anyway'}).click();
  await poll(wins, n => n === 1, 'window closed', 15000); report.push('Close anyway closes just that window');
  uiPage = await poll(() => app.context.pages().find(p => { try { return !p.isClosed() && p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } }), Boolean, 'the remaining window\'s interface', 10000);

  // ---- R4-36 · closing the browser -------------------------------------------------------------------------------------------
  await sleep(800);
  for (const url of [clean, clean + '?b', clean + '?c']) { await act({type: 'tab.new', url}); await app.waitWeb(url); }
  const total = (await state()).tabs.length; assert.ok(total >= 3);
  await key(0, 'Q', ['control', 'shift']);
  c = await card('quit', /Close Acira\?/);
  assert.match(await c.locator('#detail').textContent(), new RegExp(`^${total} tabs in 1 window$`)); assert.deepEqual(await buttons(c), ['Cancel', 'Close Acira']);
  assert.equal(await c.locator('#muteText').textContent(), "Don't ask again"); report.push(`Ctrl+Shift+Q: "Close Acira?" / "${total} tabs in 1 window", Close / Cancel, "Don't ask again"`);
  await shot('r4-36-quit-dark-100');
  await c.keyboard.press('Escape'); await noCard('quit Esc'); assert.equal(await wins(), 1); report.push('Esc = Cancel');
  await key(0, 'Q', ['control', 'shift']); c = await card('quit 2', /Close Acira\?/);
  await c.locator('#muteBox').check(); await c.locator('button.act', {hasText: 'Cancel'}).click(); await noCard('quit cancel with box');
  assert.equal((await state()).settings.askBeforeClosing, true); report.push('ticking "Don\'t ask again" and then Cancel changes nothing');

  // appearance x scale evidence
  for (const [appearance, scale, tag] of [['dark', 150, 'dark-150'], ['light', 100, 'light-100'], ['light', 150, 'light-150']]) {
    await act({type: 'settings.update', patch: {appearance, interfaceScale: scale}}); await sleep(900);
    await key(0, 'Q', ['control', 'shift']); c = await card('quit ' + tag, /Close Acira\?/); await shot(`r4-36-quit-${tag}`); await c.keyboard.press('Escape'); await noCard('quit esc ' + tag);
    const dirty = (await state()).tabs.find(t => t.url === clean); void dirty;
  }
  await act({type: 'tab.new', url: dirtyA}); await app.waitWeb(dirtyA); await sleep(600);
  for (const [appearance, scale, tag] of [['light', 150, 'light-150'], ['dark', 150, 'dark-150'], ['light', 100, 'light-100'], ['dark', 100, 'dark-100']]) {
    await act({type: 'settings.update', patch: {appearance, interfaceScale: scale}}); await sleep(900);
    await key(0, 'Q', ['control', 'shift']); c = await card('quit+unsaved ' + tag, /Close Acira\?/);
    if (tag === 'dark-100') { const text = await c.locator('#detail').textContent(); assert.match(text, /tabs in 1 window/); assert.match(text, /127\.0\.0\.1:\d+ has changes that may not be saved/); assert.deepEqual(await buttons(c), ['Close anyway', 'Cancel']); assert.equal(await c.locator('#mute').isVisible(), false); report.push('with unsaved work the quit question and the warning are ONE card (no Don\'t-ask box)'); }
    await shot(`r4-35-36-quit-unsaved-${tag}`); await c.keyboard.press('Escape'); await noCard('combined esc ' + tag);
  }
  await act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100}}); await sleep(600);

  // Settings > Tabs > "Ask before closing the browser"
  const openTabsSettings = async () => {
    await act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500);
    await (uiPage || app.ui).evaluate(() => { const nav = [...document.querySelectorAll('nav button, nav a, [role=tab]')].find(n => /^Tabs/.test(n.textContent.trim())); nav?.click(); });
    await sleep(1200);
  };
  const switchOf = () => (uiPage || app.ui).locator('[data-setting="ask-before-closing"] [role=switch]').first();
  await openTabsSettings();
  assert.equal(await switchOf().getAttribute('aria-checked'), 'true'); report.push('Settings > Tabs has "Ask before closing the browser", on by default');
  await shot('r4-36-settings-tabs-on-dark-100');
  const settingsTab = (await state()).tabs.find(t => t.url === 'acira://settings'); await act({type: 'tab.close', id: settingsTab.id}); await sleep(500);

  // Don't ask again -> Close: the app quits, the setting stays off across a restart
  await clearDirty(); await sleep(300);
  await key(0, 'Q', ['control', 'shift']); c = await card('final quit', /Close Acira\?/);
  await c.locator('#muteBox').check(); await sleep(150); await shot('r4-36-dont-ask-ticked-dark-100');
  const exited = new Promise(resolve => app.app.process().once('exit', resolve));
  await c.keyboard.press('Enter').catch(() => {}); // the page goes away with the app // Enter = Close
  await Promise.race([exited, sleep(20000).then(() => { throw new Error('the app did not quit after Close'); })]);
  report.push('Enter = Close: the browser quit'); app = null; uiPage = null;

  // second start: the setting is off (and can be turned back on in Settings); then a quit that the card holds for longer than the
  // restore list's freeze (5 s) with two windows open must still bring both windows back
  app = await startApp({root, skipSetup: false});
  assert.equal((await state()).settings.askBeforeClosing, false); report.push('after a restart "Ask before closing the browser" is still off');
  await openTabsSettings();
  assert.equal(await switchOf().getAttribute('aria-checked'), 'false'); await shot('r4-36-settings-tabs-off-dark-100');
  await switchOf().click(); await poll(async () => (await state()).settings.askBeforeClosing, v => v === true, 'the switch turns it back on'); report.push('the Settings switch turns the question back on');
  const settingsTab2 = (await state()).tabs.find(t => t.url === 'acira://settings'); await act({type: 'tab.close', id: settingsTab2.id}); await sleep(400);
  // the session brought the unsaved page back (its handler is live again): finish with it first, as a person would
  await sleep(1500); await clearDirty();
  for (const t of (await state()).tabs.filter(t => /\/dirty/.test(t.url))) { await act({type: 'tab.close', id: t.id}); await sleep(300); }
  await act({type: 'tab.new', url: clean}); await app.waitWeb(clean);
  await key(0, 'N', ['control']); await poll(wins, n => n >= 2, 'second window for the restore check', 15000); await sleep(1500);
  await key(0, 'Q', ['control', 'shift']); c = await card('two-window quit', /Close Acira\?/);
  assert.match(await c.locator('#detail').textContent(), /^\d+ tabs? in 2 windows$/); report.push('"' + (await c.locator('#detail').textContent()) + '" with two windows open');
  await shot('r4-36-quit-two-windows-dark-100', 0);
  await sleep(6500); // longer than the freeze of the restore list
  const exited2 = new Promise(resolve => app.app.process().once('exit', resolve));
  await c.keyboard.press('Enter').catch(() => {});
  await Promise.race([exited2, sleep(25000).then(() => { throw new Error('the app did not quit after Close (two windows)'); })]);
  report.push('Close after a 6.5 s wait: the browser quit'); app = null; uiPage = null;

  app = await startApp({root, skipSetup: false});
  await poll(wins, n => n === 2, 'both windows come back after the quit', 20000); report.push('the next start restores BOTH windows (the restore list was not shrunk by the long card)');
  await act({type: 'settings.update', patch: {askBeforeClosing: false}});
  const exited3 = new Promise(resolve => app.app.process().once('exit', resolve));
  await key(0, 'Q', ['control', 'shift']);
  await Promise.race([exited3, sleep(15000).then(() => { throw new Error('Ctrl+Shift+Q with the setting off must quit with no card'); })]);
  report.push('with the setting off Ctrl+Shift+Q quits with no card'); app = null;
  console.log(JSON.stringify({status: 'PASS', report}, null, 1));
} catch (error) {
  console.log(JSON.stringify({status: 'FAIL', error: String(error?.stack || error).slice(0, 1500), report}, null, 1)); process.exitCode = 1;
} finally {
  await cleanup(); await fx.close().catch(() => {}); await fs.unlink(slot).catch(() => {});
}
