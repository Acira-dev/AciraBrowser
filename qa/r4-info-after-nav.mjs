// R4-10 regression: the (i) icons in setup answer REAL mouse input after leaving the step and coming back, even with a web
// tab active behind setup (the VPN "Get it" opens one, which used to make the tooltip layer refuse every tip).
//   node qa/r4-info-after-nav.mjs            (run from the repo root; exits 1 when any (i) fails)
// First-run (empty) profile under .qa-profiles, one native slot (C:\ae\slot-N.lock) held only while the app runs, closed in
// finally, every loop capped. Input goes through webContents.sendInputEvent (Chromium's input pipeline), not DOM events.
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { launchPreparedNative } from './prepared-native.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const takeSlot = async () => {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) {
      try { const handle = await fs.open(`C:/ae/slot-${n}.lock`, 'wx'); await handle.writeFile('r4-info-after-nav ' + new Date().toISOString()); await handle.close(); return `C:/ae/slot-${n}.lock`; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await sleep(30000);
  }
  throw Error('no native slot free');
};
const server = http.createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end('<title>Provider</title><body>provider page</body>'); });
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const webUrl = `http://127.0.0.1:${server.address().port}/`;
const profile = path.resolve('.qa-profiles', 'r4-info-' + Date.now());
let slot, app, failed = false;
try {
  slot = await takeSlot();
  app = await launchPreparedNative({ args: ['desktop/main.cjs'], env: { ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile }, timeout: 40000 });
  let page;
  for (let i = 0; i < 150 && !page; i++) { page = app.windows().find((window) => window.url() === 'acira-browser-ui://ui/index.html'); if (!page) await sleep(200); }
  await page.waitForSelector('.setup-dialog', { timeout: 25000 }); await sleep(2500);
  const title = () => page.evaluate(() => document.querySelector('#fr-title')?.getAttribute('aria-label') || document.querySelector('#fr-title')?.textContent || '');
  const center = (selector, index = 0) => page.evaluate(([selector, index]) => { const node = document.querySelectorAll(selector)[index]; if (!node) return null; const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; }, [selector, index]);
  const input = (events) => app.evaluate(async ({ webContents }, list) => {
    const ui = webContents.getAllWebContents().find((contents) => contents.getURL() === 'acira-browser-ui://ui/index.html');
    const zoom = ui.getZoomFactor();
    for (const event of list) { ui.sendInputEvent({ ...event, x: Math.round(event.x * zoom), y: Math.round(event.y * zoom) }); await new Promise((resolve) => setTimeout(resolve, event.wait ?? 30)); }
  }, events);
  const move = (x, y) => input([{ type: 'mouseMove', x, y }]);
  const click = (x, y) => input([{ type: 'mouseMove', x, y }, { type: 'mouseDown', x, y, button: 'left', clickCount: 1 }, { type: 'mouseUp', x, y, button: 'left', clickCount: 1 }]);
  const tips = () => page.evaluate(() => [...document.querySelectorAll('.t-tip[role=tooltip]:not(.nt-credit-tip)')].length);
  const next = async () => { await click(...Object.values(await center('.setup-dialog [data-onboarding-next]'))); await sleep(1400); };
  for (let i = 0; i < 9 && !/Private/i.test(await title()); i++) await next();
  if (!/Private/i.test(await title())) throw Error('did not reach the Privacy step: ' + await title());
  await sleep(1200);
  const check = async (label) => {
    const count = await page.evaluate(() => document.querySelectorAll('.fr-card .setting-info-button').length);
    if (count < 3) throw Error('the Privacy step shows fewer (i) icons than expected: ' + count);
    for (let i = 0; i < count; i++) {
      const at = await center('.fr-card .setting-info-button', i);
      await move(5, 5); await sleep(250);
      await move(at.x, at.y); await sleep(900);
      const hover = await tips();
      await move(5, 5); await sleep(250);
      await click(at.x, at.y); await sleep(500);
      const pinned = await tips();
      await click(5, 5); await sleep(250);
      const ok = hover === 1 && pinned === 1;
      if (!ok) failed = true;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label} (i) #${i}: hover shows ${hover} tip, click keeps ${pinned}`);
    }
  };
  await check('first visit');
  // A web tab becomes the active tab behind setup, then leave the step and come back.
  await page.evaluate((url) => window.acira.dispatch({ type: 'tab.new', url }), webUrl); await sleep(2500);
  const kind = await page.evaluate(async () => { const snapshot = await window.acira.getSnapshot(); return snapshot.tabs.find((tab) => tab.id === snapshot.activeTabId)?.contentKind; });
  console.log('active tab behind setup:', kind);
  if (kind !== 'web') throw Error('the web tab did not become active, so this run proves nothing');
  await next();
  const back = await page.evaluate(() => { const button = [...document.querySelectorAll('.setup-dialog button')].find((node) => /^Back$/.test(node.textContent.trim())); if (!button) return null; const box = button.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; });
  if (!back) throw Error('no Back button on the step after Privacy');
  await click(back.x, back.y); await sleep(1500);
  console.log('back at:', await title());
  await check('after leaving and returning, web tab active');
} catch (error) {
  failed = true; console.log('ERROR', error.message);
} finally {
  try { await app?.close(); } catch {}
  server.close();
  if (slot) await fs.unlink(slot).catch(() => {});
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
}
process.exit(failed ? 1 : 0);
