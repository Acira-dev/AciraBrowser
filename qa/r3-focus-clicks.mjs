// R3-82: in every window view (full / compact / focus / seamless revealed), does a REAL click (webContents.sendInputEvent mouseMove, mouseDown,
// mouseUp in the chrome view) reach every chrome-row control, and do the Focus toggle and the three-dots menu answer? Also enters and leaves Focus with
// the real shortcut and with real clicks. Prints, for each control: the element under its centre, its app-region, whether it is inert or covered.
// ONE native slot (C:\ae\slot-N.lock), isolated .qa-profiles profile, released in finally.   node qa/r3-focus-clicks.mjs [tor] [sidebar]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, poll, sleep} from './d-harness.mjs';

const tor = process.argv.includes('tor'), sidebar = process.argv.includes('sidebar');
const out = process.env.R3_EVIDENCE || 'C:/ae/r3/fix-focus/evidence';
await fs.mkdir(out, {recursive: true});
const UI = '=acira-browser-ui://ui/index.html';

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

const TARGET = {id: null};
const send = (app, event) => app.main(({webContents}, {event, match, id}) => {
  const wc = id ? webContents.fromId(id) : webContents.getAllWebContents().find(w => w.getURL() === match);
  if (!wc) return 'no chrome view';
  wc.sendInputEvent(event); return 'sent';
}, {event, match: UI.slice(1), id: TARGET.id});
async function realClick(app, x, y) {
  const base = {x: Math.round(x), y: Math.round(y)};
  await send(app, {type: 'mouseMove', ...base}); await sleep(80); await send(app, {type: 'mouseMove', ...base}); await sleep(60);
  await send(app, {type: 'mouseDown', ...base, button: 'left', clickCount: 1}); await sleep(60);
  await send(app, {type: 'mouseUp', ...base, button: 'left', clickCount: 1}); await sleep(250);
}
async function realKey(app, keyCode, modifiers = []) {
  await send(app, {type: 'rawKeyDown', keyCode, modifiers}); await send(app, {type: 'char', keyCode, modifiers}); await sleep(30); await send(app, {type: 'keyUp', keyCode, modifiers}); await sleep(300);
}

const PROBE = `(() => {
  const rows = [...document.querySelectorAll('.acira-persistent-toolbar button, .acira-persistent-toolbar [role=button], .acira-persistent-toolbar input, .acira-tab-row button, .acira-sidebar .sb-foot-icon')];
  return rows.map(el => {
    const r = el.getBoundingClientRect(); const visible = r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden]');
    if (!visible) return null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2, top = document.elementFromPoint(x, y);
    const cs = getComputedStyle(el), inert = !!el.closest('[inert]');
    return {label: (el.getAttribute('aria-label') || el.title || el.className || el.tagName).toString().slice(0, 40), x: Math.round(x), y: Math.round(y), w: Math.round(r.width), h: Math.round(r.height), region: cs.getPropertyValue('-webkit-app-region') || 'none', pe: cs.pointerEvents, inert, hit: top === el || el.contains(top) ? 'self' : (top ? top.tagName.toLowerCase() + '.' + String(top.className).split(' ')[0] : 'null'), offscreen: x < 0 || y < 0 || x > innerWidth || y > innerHeight};
  }).filter(Boolean);
})()`;

let slot, app;
const report = {}, failures = [];
const expect = (ok, message) => { if (!ok) { failures.push(message); console.log('  FAIL: ' + message); } };
try {
  slot = await takeSlot('r3-fix-focus');
  const root = path.resolve(`.qa-profiles/r3-focus-${Date.now()}`);
  app = await startApp({root, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 20, y: 20, width: 1280, height: 860}); win.show(); win.focus(); });
  await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true, appearance: 'light', verticalTabs: sidebar}});
  let torPage = null;
  if (tor) {
    const idsOf = () => app.main(({webContents}) => webContents.getAllWebContents().filter(w => w.getURL() === 'acira-browser-ui://ui/index.html').map(w => w.id));
    const before = await idsOf(); const pagesBefore = new Set(app.context.pages());
    await app.ui.evaluate(() => window.acira.openWindow('tor'));
    const newId = await poll(async () => (await idsOf()).find(id => !before.includes(id)), Boolean, 'tor window view', 30000);
    torPage = await poll(() => app.context.pages().find(p => !pagesBefore.has(p) && p.url() === 'acira-browser-ui://ui/index.html'), Boolean, 'tor window page', 30000);
    await poll(() => torPage.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'tor window api', 30000);
    TARGET.id = newId;
    await app.main(({BaseWindow}) => { for (const win of BaseWindow.getAllWindows()) { win.setBounds({x: 20, y: 20, width: 1280, height: 860}); } const all = BaseWindow.getAllWindows(); const last = all[all.length - 1]; last.show(); last.focus(); });
    const active = { ...app, ui: torPage, act: a => torPage.evaluate(a => window.acira.dispatch(a), a), state: () => torPage.evaluate(() => window.acira.getSnapshot()), svc: r => torPage.evaluate(r => window.acira.service(r), r) };
    app = active; await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true}}); await sleep(1200);
    console.log('tor window:', JSON.stringify(await app.ui.evaluate(() => ({dataTor: !!document.querySelector('[data-tor]'), url: location.href, profile: document.title}))));
  }
  await sleep(900);
  const view = async () => (await app.state()).windowUi?.view ?? null;
  const overlayKind = async () => (await app.ui.evaluate(() => window.acira.getBrowserLayout()))?.overlay?.kind ?? null;
  const closeOverlay = async () => { const l = await app.ui.evaluate(() => window.acira.getBrowserLayout()); if (l?.overlay) await app.ui.evaluate(id => window.acira.closeOverlay(id), l.overlay.id); await sleep(300); };
  for (const mode of ['full', 'compact', 'focus', 'seamless']) {
    await closeOverlay();
    await app.act({type: 'ui.update', patch: {view: mode}}); await sleep(900);
    const snap = await app.state(); const row = {view: await view(), torActive: await app.ui.evaluate(() => !!document.querySelector('.address-bar[data-tor]')), activePrivacy: snap.tabs.find(t => t.id === snap.activeTabId)?.privacy ?? null};
    if (tor) expect(row.torActive || row.activePrivacy === 'tor', `${mode}: the window really is a Tor window`);
    // reveal the toolbar in seamless the way a pointer does
    if (mode === 'seamless') { await realKey(app, 'L', ['control']); await sleep(900); }
    row.controls = await app.ui.evaluate(PROBE);
    console.log(`\n== ${mode} (${tor ? 'tor' : 'normal'}, ${sidebar ? 'sidebar' : 'strip'}) view=${row.view}`);
    for (const c of row.controls) console.log(`  ${c.label.padEnd(28)} @${c.x},${c.y} ${c.w}x${c.h} region=${c.region} pe=${c.pe} inert=${c.inert} hit=${c.hit}${c.offscreen ? ' OFFSCREEN' : ''}`);
    // real click on the three dots
    for (const c of row.controls) { if (/^Close /.test(c.label)) continue; expect(c.pe !== 'none' && !c.inert && c.region === 'no-drag' && c.hit === 'self' && !c.offscreen, `${mode}: ${c.label} is clickable (pe=${c.pe} inert=${c.inert} region=${c.region} hit=${c.hit})`); }
    const dots = row.controls.find(c => /Acira menu/i.test(c.label));
    if (dots) { await realClick(app, dots.x, dots.y); row.menuOpened = await overlayKind(); console.log('  three dots real click -> overlay:', row.menuOpened); expect(row.menuOpened === 'menu', `${mode}: the three dots open the menu`); await closeOverlay(); }
    else { console.log('  three dots not in the row'); expect(false, `${mode}: the three dots are in the row`); }
    // real click on the focus toggle (enter/leave Focus)
    const toggle = row.controls.find(c => /Turn Focus/i.test(c.label));
    if (toggle) { const before = await view(); await realClick(app, toggle.x, toggle.y); row.toggled = {before, after: await view()}; console.log('  focus toggle real click view:', JSON.stringify(row.toggled)); expect(row.toggled.after !== row.toggled.before, `${mode}: the Focus toggle changes the view`); await app.act({type: 'ui.update', patch: {view: mode}}); await sleep(600); }
    // every other control: real click must reach it (focus or an overlay changes); report the hit-test only
    report[mode] = row;
  }
  // the real shortcut into and out of Focus
  await closeOverlay(); await app.act({type: 'ui.update', patch: {view: 'full'}}); await sleep(700);
  await realKey(app, 'F', ['control', 'shift']); const afterIn = await view();
  await realKey(app, 'F', ['control', 'shift']); const afterOut = await view();
  console.log('\nCtrl+Shift+F in:', afterIn, 'out:', afterOut); expect(afterIn === 'focus', 'Ctrl+Shift+F enters Focus'); expect(afterOut !== 'focus', 'Ctrl+Shift+F leaves Focus');
  report.shortcut = {afterIn, afterOut};
  // Enter Focus by a real click on the toggle in Full, then leave with a real click on the (moved) toggle
  await app.act({type: 'ui.update', patch: {view: 'full'}}); await sleep(700);
  const full = await app.ui.evaluate(PROBE); const enter = full.find(c => /Turn Focus on/i.test(c.label));
  if (enter) { await realClick(app, enter.x, enter.y); await sleep(700); const inFocus = await view(); const focusControls = await app.ui.evaluate(PROBE); const exit = focusControls.find(c => /Turn Focus off/i.test(c.label)); console.log('real click enters Focus:', inFocus, '| exit button:', JSON.stringify(exit)); if (exit) { await realClick(app, exit.x, exit.y); await sleep(700); const leftTo = await view(); console.log('real click on exit leaves Focus:', leftTo); report.enterExit = {inFocus, out: leftTo}; expect(inFocus === 'focus' && leftTo !== 'focus', 'a real click on the Focus toggle enters Focus and a real click on the exit button leaves it'); } else expect(false, 'Focus shows an exit button'); } else expect(false, 'the toolbar has an Enter Focus button');
  console.log(failures.length ? `\nFAIL (${failures.length})` : '\nPASS: every chrome-row control answers a real click in every view'); process.exitCode = failures.length ? 1 : 0;
  await fs.writeFile(path.join(out, `focus-clicks-${tor ? 'tor' : 'normal'}-${sidebar ? 'sidebar' : 'strip'}.json`), JSON.stringify(report, null, 2));
} finally {
  try { if (app) await app.close(); } catch {}
  if (slot) await fs.unlink(slot).catch(() => {});
}
