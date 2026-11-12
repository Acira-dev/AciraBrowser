'use strict';
// Electron runner for tests/cookie-banner-dialogs.test.cjs. Loads the app's real frame script (content-filter-preload.cjs) as a preload, with main-process handlers
// that answer as optional-filtering.cjs does from the real cookie lists (annoyance-rules.cjs), against page.html. Clicks are real input (DevTools protocol), so the
// page sees trusted pointer events. Usage: electron run.cjs '<cases json>'. CONTENT_FILTER_PRELOAD=<file> runs another copy of the frame script (before/after evidence).
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createAnnoyanceRules } = require('../../../desktop/browser-services/annoyance-rules.cjs');
app.commandLine.appendSwitch('use-mock-keychain');
app.setPath('userData', path.join(os.tmpdir(), 'acira-cookie-dialogs-' + process.pid));
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const cases = JSON.parse(process.argv[process.argv.length - 1]);
const preload = process.env.CONTENT_FILTER_PRELOAD || path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'content-filter-preload.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const { stepWait } = require('./schedule.cjs');
const REACTION = 1500;   // the least time a page gets to react to a click before it is measured (what the schedule in the test gives it between a click and the next check)
// COOKIE_CLICK_EXTRA_MS (the test's slow-frames case): every click takes that much longer, as it does when the hidden window draws its frames late.
const CLICK_EXTRA_MS = Number(process.env.COOKIE_CLICK_EXTRA_MS || 0);
const rules = createAnnoyanceRules();
ipcMain.on('acira:ai-early', event => { event.returnValue = null; });
ipcMain.handle('acira:content-filter-options', event => ({ enabled: false, selectors: [], sources: [], annoyanceSelectors: [], aiRules: [], preStyles: '', annoyanceStyles: rules.styles(event.senderFrame.url), cookieHints: true, annoyanceDelay: /[?&]delay=1/.test(event.senderFrame.url) ? 3000 : 0, version: 'test' }));
ipcMain.handle('acira:content-filter-dom', (event, message) => rules.styles(event.senderFrame.url, { classes: message.classes, ids: message.ids }, { domOnly: true }));
ipcMain.on('acira:content-filter-stats', () => { });
ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', () => undefined);
ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', () => false);
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, 'page.html'))); });
const MEASURE = `(() => {
  const shown = node => !!node && (node.getClientRects().length > 0 || !!node.shadowRoot?.firstElementChild?.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden';
  const body = getComputedStyle(document.body), root = getComputedStyle(document.documentElement);
  return {
    dialog: shown(document.getElementById('dialog')), backdrop: shown(document.getElementById('backdrop')), tint: shown(document.getElementById('tint')),
    veil: shown(document.getElementById('veil')), banner: shown(document.getElementById('onetrust-banner-sdk')), badge: shown(document.getElementById('badge')),
    sourcepoint: shown(document.querySelector('[id^="sp_message_container_"]')), marked: document.querySelectorAll('[data-acira-veil]').length,
    bodyOverflow: body.overflowY, rootOverflow: root.overflowY, bodyPosition: body.position,
    locked: body.position === 'fixed' || [body, root].some(style => /hidden|clip/.test(style.overflowY))
  };
})()`;
async function click(wc, selector) {
  // Two frames first: input sent before a hidden window has drawn is not hit-tested and goes nowhere.
  if (CLICK_EXTRA_MS) await sleep(CLICK_EXTRA_MS);
  await wc.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const point = await wc.executeJavaScript(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return null; const box = node.getBoundingClientRect(); return { x: box.left + box.width / 2, y: box.top + box.height / 2 }; })()`);
  if (!point) return false;
  for (const type of ['mousePressed', 'mouseReleased']) await wc.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
  return true;
}
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  // Every case has its own hidden window and clock, so they run side by side.
  const out = await Promise.all(cases.map(async spec => {
    const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, preload } });
    const wc = win.webContents; wc.debugger.attach('1.3');
    await wc.loadURL(`http://127.0.0.1:${port}/page.html?case=${spec.case}${spec.delay ? '&delay=1' : ''}`);
    // Measure the fixture's interaction schedule from the loaded page, not from process/load latency under parallel test load.
    const started = Date.now();
    const record = { name: spec.name || spec.case, steps: {} };
    // What a click sets off (the frame script looks again 120 ms after a change and then acts) needs time after the click has LANDED, not after it was begun:
    // click() first waits for two frames of a hidden window, about a second, and longer when the frames come late. A sample planned 1500 ms after a click began
    // was taken 500 ms after it landed, and at once when the click took 1500 ms: it read the page before the script had reacted (`wall`: the site's lock "auto"
    // under its dialog, "hidden" after it closed). So a step never runs sooner than REACTION after the last click landed; the planned times are otherwise as they were.
    let landed = 0;
    for (const step of spec.steps) {
      await sleep(stepWait({ at: step.at, startedAt: started, now: Date.now(), landedAt: landed, reaction: REACTION }));
      if (step.click) { record.steps[step.name || step.click] = await click(wc, step.click); landed = Date.now(); }
      else record.steps[step.name] = await wc.executeJavaScript(MEASURE);
    }
    win.destroy();
    return record;
  }));
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n');
  server.close(); app.exit(0);
});
