// Stream D: leaving a page with unsaved changes asks in the Acira card; keeping the page stays, leaving repeats the close or navigation.
//   R4-35/49: closing a tab whose page has unsaved changes asks "Leave without saving?" (Close anyway / Keep editing; Enter and Esc keep editing).
//   A typed address still asks the page's own "Leave this site?" (Stay / Leave).
// Both are the one centred-or-top card of desktop/site-prompt.html. Quitting at the end must not hang on a card: the unsaved fixture pages are
// marked clean first and "Ask before closing the browser" is off in this disposable profile, so app.close() goes straight through.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-unload'; await fs.rm(root, {recursive: true, force: true});
// Every page asks to be confirmed while window.__dirty is true; /other is the quiet page a confirmed navigation lands on.
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); const quiet = req.url.startsWith('/other'); res.end(`<title>${req.url}</title><input id=t style="position:fixed;left:10px;top:10px;width:200px;height:30px">${quiet ? '' : '<script>window.__dirty=true;addEventListener("beforeunload",e=>{if(window.__dirty){e.preventDefault();e.returnValue="unsaved"}})</script>'}`); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root, env: {ACIRA_TEST_APP_DIALOG: '1'}});
// R3-73: the question is a card in the window (desktop/site-prompt.html), not a separate question window.
const dialogPage = () => app.context.pages().find(p => { try { return p.url().includes('site-prompt.html'); } catch { return false; } });
const visible = async () => { const p = dialogPage(); if (!p) return false; try { return await p.locator('#card').isVisible(); } catch { return false; } };
const press = url => app.main(({webContents}, u) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === u); if (!wc) return false; wc.focus(); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({type, x: 30, y: 25, button: 'left', clickCount: 1}); wc.sendInputEvent({type: 'char', keyCode: 'a'}); return true; }, url);
/** A page only asks to be confirmed once the person has used it (Chromium's sticky activation): press it until the page says it was used (state, not a delay). */
const gesture = async url => {
  const page = await poll(() => app.web(url), Boolean, 'fixture page ' + url, 20000);
  await poll(async () => { await page.waitForLoadState('load').catch(() => {}); await press(url); return page.evaluate(() => navigator.userActivation.hasBeenActive).catch(() => false); }, Boolean, 'page was used (sticky activation)', 15000);
};
/** Waits for the card, checks what it says, and presses `name`. `close` is the tab-close card (R4-35/49), otherwise the navigation card. */
const answer = async (name, kind) => {
  await poll(visible, Boolean, 'unload card visible', 15000); const d = dialogPage();
  await poll(() => d.locator('#title').textContent(), t => Boolean(t), 'card title', 6000); await sleep(450); // the entrance spring has landed
  if (kind === 'close') {
    assert.equal(await d.locator('#title').textContent(), 'Leave without saving?');
    assert.deepEqual(await d.locator('button.act').allTextContents(), ['Close anyway', 'Keep editing']);
    assert.equal(await d.locator('#sites .row').count(), 1); assert.equal(await d.locator('#sites .host').first().textContent(), '127.0.0.1');
  } else {
    assert.equal(await d.locator('#title').textContent(), 'Leave this site?'); assert.match(await d.locator('#detail').textContent(), /127\.0\.0\.1:\d+/);
  }
  await d.getByRole('button', {name, exact: true}).click(); await poll(async () => !(await visible()), Boolean, 'card hidden');
};
const clearDirty = async () => { for (const p of app.context.pages()) { try { if (p.url().startsWith(base)) await p.evaluate(() => { window.__dirty = false; }); } catch {} } };
try {
  await app.act({type: 'settings.update', patch: {askBeforeClosing: false, language: 'en'}});
  await app.act({type: 'tab.new', url: base + '/form'}); await app.waitWeb(base + '/form'); await sleep(800); await gesture(base + '/form'); await sleep(300);
  const tabId = (await app.state()).tabs.at(-1).id, count = async () => (await app.state()).tabs.length, n0 = await count();
  // Close the tab: Keep editing keeps it.
  await app.act({type: 'tab.close', id: tabId}); await answer('Keep editing', 'close'); await sleep(600); assert.equal(await count(), n0); assert.ok(app.web(base + '/form')); report.push('Keep editing keeps the tab and its page');
  // Close again: Close anyway closes it without a second page prompt.
  await app.act({type: 'tab.close', id: tabId}); await answer('Close anyway', 'close'); await poll(count, n => n === n0 - 1, 'tab closed after Close anyway', 10000); report.push('Close anyway closes the tab');
  // Typed address: Stay keeps the page and the address; Leave goes there.
  await app.act({type: 'tab.new', url: base + '/form2'}); await app.waitWeb(base + '/form2'); await sleep(800); await gesture(base + '/form2'); await sleep(300);
  const id2 = (await app.state()).tabs.at(-1).id;
  await app.act({type: 'tab.navigate', url: base + '/other', tabId: id2}); await answer('Stay', 'navigate'); await sleep(800);
  assert.equal((await app.state()).tabs.find(t => t.id === id2).url, base + '/form2'); report.push('Stay keeps the page when an address was typed');
  await app.act({type: 'tab.navigate', url: base + '/other', tabId: id2}); await answer('Leave', 'navigate');
  await poll(async () => (await app.state()).tabs.find(t => t.id === id2).url, u => u === base + '/other', 'navigated after Leave', 15000); report.push('Leave completes the typed navigation');
  console.log(JSON.stringify({ok: true, report}, null, 1));
} finally {
  // Nothing may be waiting for an answer when the app quits: clean pages, then a bounded close; a stuck quit is ended (the process is this script's own).
  try { await clearDirty(); } catch {}
  const child = (() => { try { return app.app.process(); } catch { return null; } })();
  try { await Promise.race([app.close(), sleep(15000)]); } catch {}
  try { if (child && child.exitCode === null) child.kill(); } catch {}
  await fx.close();
}
