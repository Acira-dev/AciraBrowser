// R3 fix: do the house switches answer a REAL click? Drives real input (webContents.sendInputEvent: mouseMove, mouseDown, mouseUp, clickCount 1)
// at the switch centre inside the popup's / setup page's own webContents, and records the event sequence the page received.
// Holds ONE native slot (C:\ae\slot-N.lock), isolated profile under .qa-profiles, released in finally. Never a real Windows Hello prompt.
//   node qa/r3-switch-real-input.mjs [popup|setup|all]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, poll, sleep} from './d-harness.mjs';

const which = process.argv[2] || 'all';
const stamp = Date.now(), root = `.qa-profiles/r3-switch-${stamp}`;
const out = process.env.R3_EVIDENCE || 'C:/ae/r3/fix-switch/evidence';
await fs.mkdir(out, {recursive: true});

async function takeSlot(name) {
  const until = Date.now() + 20 * 60 * 1000;
  while (Date.now() < until) {
    for (const n of [1, 2, 3]) {
      const file = `C:/ae/slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`${name} ${new Date().toISOString()}`); await handle.close(); return file; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}

const probeSource = `(() => {
  window.__ev = [];
  const note = (phase) => (e) => { const t = e.target; window.__ev.push(phase + ':' + e.type + ' ' + (t && t.tagName ? t.tagName.toLowerCase() + (t.className && typeof t.className === 'string' ? '.' + t.className.split(' ')[0] : '') : '?') + (e.defaultPrevented ? ' PREVENTED' : '') + (e.isTrusted ? '' : ' synthetic')); };
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'change']) { window.addEventListener(type, note('capture'), true); window.addEventListener(type, note('bubble'), false); }
})()`;

/** One real click in `url` webContents at CSS-pixel (x, y): move, press, release. */
async function realClick(app, match, x, y, probe) {
  const phase = (kind, extra = {}) => app.main(({webContents}, {match, x, y, kind, extra}) => {
    const wc = webContents.getAllWebContents().find(w => match.startsWith('=') ? w.getURL() === match.slice(1) : w.getURL().includes(match));
    if (!wc) return 'no webContents';
    wc.sendInputEvent({type: kind, x: Math.round(x), y: Math.round(y), ...extra});
    return 'sent';
  }, {match, x, y, kind, extra});
  const log = [];
  const step = async (name, kind, extra) => { const sent = await phase(kind, extra); await sleep(120); log.push({name, sent, state: probe ? await probe().catch(e => 'probe failed: ' + String(e.message).slice(0, 80)) : null}); };
  await step('move1', 'mouseMove'); await step('move2', 'mouseMove');
  await step('down', 'mouseDown', {button: 'left', clickCount: 1});
  await step('up', 'mouseUp', {button: 'left', clickCount: 1});
  return log;
}

const report = {stamp, results: []};
let slot, app, fx;
try {
  slot = await takeSlot('r3-fix-switch');
  fx = await httpFixture((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Switch fixture</title><h1>Switch fixture</h1>'); });
  const url = `http://127.0.0.1:${fx.port}/fixture`;

  if (which === 'popup' || which === 'all') {
    app = await startApp({root: root + '-popup', env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 20, y: 20, width: 1280, height: 900}); win.show(); win.focus(); });
    await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true, appearance: 'light'}});
    await app.act({type: 'tab.navigate', url}); await app.waitWeb(url);
    await poll(async () => { const s = await app.state(); return s.tabs.find(tab => tab.id === s.activeTabId)?.loading; }, v => v === false, 'fixture loaded');
    const tabId = (await app.state()).activeTabId;
    const overlay = () => app.context.pages().find(page => page.url().includes('view=overlay'));
    const profileId = (await app.state()).activeBrowserProfileId;
    await app.ui.evaluate(profile => { localStorage.setItem('acira-toolbar-items:' + profile, JSON.stringify([{id: 'protection', visible: true}, {id: 'vpn', visible: false}, {id: 'extensions', visible: false}, {id: 'profile', visible: true}, {id: 'focus', visible: true}])); window.dispatchEvent(new Event('acira-toolbar-items')); }, profileId);
    const open = async () => {
      await app.ui.locator('[data-protection-trigger]').filter({visible: true}).first().click();
      await poll(async () => (await app.ui.evaluate(() => window.acira.getBrowserLayout()))?.overlay?.kind, v => v === 'protection', 'protection popup');
      await poll(overlay, Boolean, 'overlay page'); await overlay().locator('.popup-content-protection').waitFor(); await sleep(450);
    };
    await open();
    const sw = overlay().getByRole('switch', {name: 'Block ads and trackers on this site'});
    await sw.waitFor(); await poll(() => sw.isEnabled(), Boolean, 'switch enabled');
    const before = await sw.getAttribute('aria-checked');
    await overlay().evaluate(probeSource);
    const hit = await overlay().evaluate(() => { const s = document.querySelector('[role=switch][aria-labelledby^=blocking]'); const r = s.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); return {x, y, w: r.width, h: r.height, top: top ? top.tagName + '.' + top.className : null, topIsSwitch: top === s || s.contains(top), dpr: devicePixelRatio, zoom: document.documentElement.style.zoom}; });
    console.log('popup switch', JSON.stringify(hit), 'before', before);
    const stages = await realClick(app, 'view=overlay', hit.x, hit.y, async () => ({overlay: (await app.ui.evaluate(() => window.acira.getBrowserLayout()))?.overlay?.kind ?? null, events: await overlay()?.evaluate(() => window.__ev.slice(-8)).catch(() => 'overlay page gone')}));
    console.log('popup stages', JSON.stringify(stages));
    await sleep(500);
    const events = await overlay()?.evaluate(() => window.__ev).catch(() => 'gone');
    const after = await sw.getAttribute('aria-checked', {timeout: 3000}).catch(() => 'popup gone');
    const service = (await app.svc({type: 'privacy.status', tabId})).privacy.blocking;
    console.log('popup real click events:', JSON.stringify(events));
    console.log('popup real click', {before, after, service});
    report.results.push({row: 'protection popup site switch (sendInputEvent)', before, after, service, events, hit});
    await overlay().screenshot({path: path.join(out, 'popup-after-real-click.png')}).catch(() => {});
    // The harness path (Playwright click) turns it back on, then a real click on every switch the popup has.
    await sw.click(); await poll(() => sw.getAttribute('aria-checked'), v => v === 'true', 'playwright click turns blocking back on');
    await poll(async () => (await overlay().locator('[role=switch]:not([disabled])').count()) >= 2, Boolean, 'other switches enabled', 8000).catch(() => {});
    const labels = await overlay().evaluate(() => [...document.querySelectorAll('[role=switch]')].map((el, index) => ({index, label: el.getAttribute('aria-label') || document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || '?', disabled: el.disabled, checked: el.getAttribute('aria-checked')})));
    console.log('popup switches', JSON.stringify(labels));
    const sweep = [];
    for (const item of labels.filter(item => !item.disabled)) {
      const rect = await overlay().evaluate(index => { const r = document.querySelectorAll('[role=switch]')[index].getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; }, item.index);
      await realClick(app, 'view=overlay', rect.x, rect.y);
      await sleep(600);
      const now = await overlay().evaluate(index => document.querySelectorAll('[role=switch]')[index]?.getAttribute('aria-checked'), item.index).catch(() => 'gone');
      sweep.push({label: item.label, before: item.checked, after: now, flipped: now !== item.checked && now !== 'gone'});
      await sleep(300);
    }
    console.log('popup switch sweep', JSON.stringify(sweep));
    report.results.push({row: 'every popup switch answers a real click', sweep});
    await app.close(); app = null;
  }

  if (which === 'setup' || which === 'all') {
    app = await startApp({root: root + '-setup', skipSetup: false, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 20, y: 20, width: 1440, height: 900}); win.show(); win.focus(); });
    const usageRow = () => app.ui.locator('.fr-row').filter({has: app.ui.locator('b', {hasText: 'Share anonymous usage'})});
    for (let step = 0; step < 9 && !(await usageRow().count()); step++) {
      const next = app.ui.locator('[data-onboarding-next]').first(); await next.waitFor({state: 'visible'}); await next.click(); await sleep(950);
    }
    await usageRow().waitFor(); await sleep(700);
    console.log('webContents', JSON.stringify(await app.main(({webContents}) => webContents.getAllWebContents().map(w => ({id: w.id, url: w.getURL().slice(0, 80), type: w.getType(), focused: w.isFocused(), crashed: w.isCrashed()})))));
    const input = usageRow().locator('input');
    await poll(() => input.isEnabled(), Boolean, 'usage switch enabled');
    const before = await input.isChecked();
    await app.ui.evaluate(probeSource);
    const hit = await app.ui.evaluate(() => { const s = [...document.querySelectorAll('.fr-row')].find(r => r.textContent.includes('Share anonymous usage')).querySelector('input.fr-toggle'); const r = s.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); return {x, y, w: r.width, h: r.height, top: top ? top.tagName + '.' + top.className : null, topIsSwitch: top === s}; });
    console.log('setup switch', JSON.stringify(hit), 'before', before);
    const stages = await realClick(app, '=acira-browser-ui://ui/index.html', hit.x, hit.y, async () => ({checked: await input.isChecked(), events: await app.ui.evaluate(() => window.__ev.slice(-8))}));
    console.log('setup stages', JSON.stringify(stages));
    await sleep(800);
    const events = await app.ui.evaluate(() => window.__ev);
    const after = await input.isChecked();
    const service = (await app.svc({type: 'metrics.status'})).metrics?.choice;
    console.log('setup real click events:', JSON.stringify(events));
    console.log('setup real click', {before, after, service});
    // Harness path: a Playwright click flips it back (proves the QA scripts' click() path works on this switch too).
    await input.click(); await poll(() => input.isChecked(), v => v === before, 'playwright click flips the setup switch back', 5000);
    console.log('setup playwright click flips back: ok');
    report.results.push({row: 'setup usage switch (sendInputEvent)', before, after, service, events, hit});
    await app.ui.screenshot({path: path.join(out, 'setup-after-real-click.png')}).catch(() => {});
    await app.close(); app = null;
  }
  await fs.writeFile(path.join(out, 'r3-switch-real-input.json'), JSON.stringify(report, null, 2));
  console.log('RESULT', JSON.stringify(report.results.map(r => ({row: r.row, before: r.before, after: r.after, service: r.service}))));
} finally {
  try { if (app) await app.close(); } catch {}
  try { if (fx) await fx.close(); } catch {}
  if (slot) await fs.unlink(slot).catch(() => {});
}
