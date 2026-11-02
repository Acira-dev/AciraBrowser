// R3-38 Secured workspaces in the real app (docs/launch/SECURED_WORKSPACES.md "live" rows): create one from the sheet with the
// lock switch (Windows Hello through the test substitute ACIRA_PASSWORDS_TEST_GATE=allow, never a real prompt), open sites,
// partition isolation by cookie, a tab group and a split inside it, Lock now / leave / minimise / idle (1 min setting) / Windows
// lock / sleep -> lock screen, unlock -> the same tabs, group and split back, notifications (neutral line only, nothing while
// locked), extensions (a probe content script runs in a normal tab and never in a secured one; the panel says unavailable),
// capture exclusion on real pixels (ffmpeg gdigrab from another process: the secured page is missing from a screen capture, a
// normal page is in it), the locked switcher fits at 150% in an 820 px window, quit -> disk scan for the secured markers (with a
// normal-tab control), restart -> starts locked, unlock from the sealed file brings tabs, group and split back. Then a quick
// regression pass for people who never turn it on (workspace switch, private tab, closed-tab Undo, Rewind page). Screenshots dark
// + light, 100% + 150% under <outdir>.
// Usage: node qa/r4-secured.mjs [outdir]   (one native slot C:\ae\slot-N.lock, one instance, bounded waits, try/finally)
// Profile: .qa-profiles/r5-secured (the harness only launches under .qa-profiles; point that folder at a short disposable place, e.g. a
// junction to C:/ae/r5/secured/qa-profiles), emptied at the start. Needs ffmpeg on PATH for the capture rows.
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startApp, sleep, poll, httpFixture} from './d-harness.mjs';

const run = promisify(execFile);
const out = path.resolve(process.argv[2] || 'C:/ae/r5/secured/evidence'); await fs.mkdir(out, {recursive: true});
const PROFILE = path.resolve('.qa-profiles/r5-secured'), EXT = path.resolve('.qa-profiles/r5-secured-ext');
const results = [], ok = (name, pass, detail = '') => { results.push({name, pass: !!pass, detail}); console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const MARK = 'secmark' + randomUUID().slice(0, 8), CONTROL = 'normctl' + randomUUID().slice(0, 8), NOTE = 'notemark' + randomUUID().slice(0, 8), GROUP = 'Scans ' + MARK;
const NEUTRAL = 'New notification in a locked workspace';
const site = await httpFixture((req, res) => {
  const name = decodeURIComponent(req.url.split('?')[0].slice(1)) || 'home', bg = name.startsWith('magenta') ? '#ff00ff' : name.startsWith('lime') ? '#00ff00' : '#ffffff';
  res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
  res.end(`<!doctype html><title>${name}</title><body style="margin:0;min-height:100vh;font:16px system-ui;padding:40px;box-sizing:border-box;background:${bg}"><h1>${name}</h1></body>`);
});
const url = name => `http://127.0.0.1:${site.port}/${name}`;
let slot;
for (let attempt = 0; attempt < 40 && !slot; attempt++) {
  for (const n of [1, 2, 3]) { try { const file = `C:/ae/slot-${n}.lock`; fss.writeFileSync(file, `secured ${new Date().toISOString()}`, {flag: 'wx'}); slot = file; break; } catch {} }
  if (!slot) await sleep(30000);
}
if (!slot) throw new Error('no native slot');
const env = {ACIRA_BROWSER_TEST_HIDDEN: '0', ACIRA_PASSWORDS_TEST_GATE: 'allow'};
const launch = () => startApp({root: PROFILE, env});
let app;
function scan(root, needle) {
  const hits = [], a = Buffer.from(needle, 'utf8'), b = Buffer.from(needle, 'utf16le');
  const walk = d => { let names = []; try { names = fss.readdirSync(d); } catch { return; } for (const name of names) { const file = path.join(d, name); let stat; try { stat = fss.statSync(file); } catch { continue; } if (stat.isDirectory()) walk(file); else if (stat.size < 64 * 1024 * 1024) { try { const raw = fss.readFileSync(file); if (raw.includes(a) || raw.includes(b)) hits.push(path.relative(root, file)); } catch {} } } };
  walk(root); return hits;
}
/** A screen capture of the window's area by another process (ffmpeg gdigrab, physical pixels), as a screen-sharing app would see it. */
async function screenCapture(name) {
  const rect = await app.main(({BaseWindow, screen}) => { const w = BaseWindow.getAllWindows().filter(x => !x.isDestroyed()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0]; w.setAlwaysOnTop(true, 'screen-saver'); w.moveTop(); const b = w.getContentBounds(), f = screen.getDisplayMatching(b).scaleFactor; let p; try { p = screen.dipToScreenRect(null, b); } catch { p = {x: Math.round(b.x * f), y: Math.round(b.y * f), width: Math.round(b.width * f), height: Math.round(b.height * f)}; } return {x: p.x, y: p.y, width: p.width, height: p.height, scale: f, protectedNow: typeof w.isContentProtected === 'function' ? w.isContentProtected() : null}; });
  await sleep(900);
  const png = path.join(out, name), w = rect.width - (rect.width % 2), h = rect.height - (rect.height % 2);
  try {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'gdigrab', '-framerate', '5', '-offset_x', String(rect.x), '-offset_y', String(rect.y), '-video_size', `${w}x${h}`, '-i', 'desktop', '-frames:v', '1', png], {timeout: 20000});
    const {stdout} = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 20000});
    let magenta = 0, lime = 0; const n = stdout.length / 3;
    for (let i = 0; i < stdout.length; i += 3) { const r = stdout[i], g = stdout[i + 1], b = stdout[i + 2]; if (r > 200 && g < 70 && b > 200) magenta++; else if (r < 90 && g > 200 && b < 90) lime++; }
    return {...rect, magenta: +(magenta / n).toFixed(4), lime: +(lime / n).toFixed(4)};
  } catch (error) {
    // gdigrab can't read the screen while Windows is locked or on a secure desktop (error 5): the row fails with the reason, the run goes on.
    return {...rect, magenta: -1, lime: -1, error: String(error.message).replace(/\s+/g, ' ').slice(-240)};
  } finally { await app.main(({BaseWindow}) => BaseWindow.getAllWindows().filter(x => !x.isDestroyed()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0].setAlwaysOnTop(false)).catch(() => {}); }
}
/** The same page as the app's own compositor draws it (not affected by capture exclusion): proves the colour is on screen. */
const internalColour = (match) => app.main(async ({webContents}, match) => { const wc = webContents.getAllWebContents().find(w => w.getURL().includes(match)); if (!wc) return null; const image = await wc.capturePage(); const bmp = image.toBitmap(); let magenta = 0; for (let i = 0; i < bmp.length; i += 4) { const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2]; if (r > 200 && g < 70 && b > 200) magenta++; } return +(magenta / (bmp.length / 4)).toFixed(4); }, match);
try {
  await fs.rm(PROFILE, {recursive: true, force: true}); await fs.mkdir(PROFILE, {recursive: true});
  await fs.rm(EXT, {recursive: true, force: true}); await fs.mkdir(EXT, {recursive: true});
  await fs.writeFile(path.join(EXT, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'Acira QA probe', version: '1.0', content_scripts: [{matches: ['<all_urls>'], js: ['probe.js'], run_at: 'document_start', all_frames: true}]}));
  await fs.writeFile(path.join(EXT, 'probe.js'), "document.documentElement.setAttribute('data-acira-probe', '1');");
  app = await launch();
  const overlay = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
  const shot = async (page, name) => { try { const u = page.url(); const png = await app.main(async ({webContents}, u) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === u); return (await wc.capturePage()).toPNG().toString('base64'); }, u); await fs.writeFile(path.join(out, name), Buffer.from(png, 'base64')); } catch (error) { console.log('shot failed', name, error.message); } };
  const popup = async (selector, label) => { await poll(async () => { const o = overlay(); return o && await o.locator(selector).count().catch(() => 0); }, Boolean, label, 6000); await sleep(800); return overlay(); };
  const ws = async name => (await app.state()).workspaces.find(w => w.name === name);
  const inWs = (s, id) => s.tabs.filter(t => t.workspaceId === id);
  const unlockFromScreen = async label => { await app.ui.locator('.ws-locked-unlock').click(); await poll(async () => (await ws('Health'))?.unlocked, Boolean, label, 8000).catch(() => null); await sleep(900); };
  const lockedNow = async () => !(await ws('Health'))?.unlocked;
  /** How far the open popup scrolls (0 = it fits). */
  const overflowOf = o => o.evaluate(() => { let worst = 0; for (const el of document.querySelectorAll('*')) { const st = getComputedStyle(el); if (/(auto|scroll)/.test(st.overflowY) && el.clientHeight > 0) worst = Math.max(worst, el.scrollHeight - el.clientHeight); } return {worst, docScroll: document.documentElement.scrollHeight - innerHeight, menu: Math.round(document.querySelector('.ws-menu')?.getBoundingClientRect().height || 0), vh: innerHeight}; });
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows().filter(x => !x.isDestroyed()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0]; w.setBounds({x: 40, y: 30, width: 1280, height: 820}); w.show(); });
  await app.act({type: 'settings.update', patch: {verticalTabs: true, appearance: 'dark', interfaceScale: 100}}); await sleep(1000);
  // A normal page with the control marker (lime, for the capture check), and a second ordinary workspace so the switcher shows.
  await app.act({type: 'tab.navigate', tabId: (await app.state()).activeTabId, url: url('lime-' + CONTROL)}); await sleep(1500);
  await app.act({type: 'workspace.create', name: 'Work'}); await sleep(700);
  await app.act({type: 'workspace.select', id: (await app.state()).workspaces[0].id}); await sleep(700);
  const profileId = (await app.state()).activeBrowserProfileId;

  // 1. Create from the sheet with the lock switch on.
  await app.ui.locator('[data-workspace-new]').first().click(); let o = await popup('#ws-edit-name', 'create sheet');
  await o.locator('#ws-edit-name').fill('Health'); await sleep(200);
  const lockSwitch = o.locator('.ws-edit-lock [role=switch], .ws-edit-lock input[type=checkbox], .ws-edit-lock button').first();
  ok('create sheet has the lock row', await o.locator('.ws-edit-lock').count() === 1);
  await lockSwitch.click(); await sleep(300);
  const sheetFits = await o.evaluate(() => { const f = document.querySelector('.ws-edit'); const r = f?.getBoundingClientRect(); return r ? {h: Math.round(r.height), sh: f.scrollHeight, vh: innerHeight} : null; });
  ok('create sheet is not clipped', sheetFits && sheetFits.sh <= sheetFits.vh + 1, JSON.stringify(sheetFits));
  await shot(o, '01-create-sheet-lock-row-dark-100.png');
  await o.locator('.ws-edit button[type=submit]').click();
  await poll(async () => (await ws('Health'))?.secured, Boolean, 'Health secured', 8000).catch(() => null);
  let health = await ws('Health');
  ok('Health is secured and open after one Windows check (test substitute)', health?.secured && health?.unlocked, JSON.stringify(health));
  await shot(app.ui, '02-secured-created-toast-dark-100.png');

  // 2. Sites inside Health; one sets a cookie.
  let s = await app.state();
  await app.act({type: 'tab.navigate', tabId: s.activeTabId, url: url(MARK + '-one')}); await sleep(1200);
  await app.act({type: 'tab.new', url: url(MARK + '-two')}); await sleep(900);
  await app.act({type: 'tab.new', url: url(MARK + '-three')}); await sleep(1500);
  s = await app.state();
  let mine = inWs(s, health.id);
  ok('3 sites open in Health, all secured', mine.length === 3 && mine.every(t => t.privacy === 'secured'), mine.map(t => `${t.privacy}:${t.url.slice(-14)}`).join(', '));
  const securedPage = await app.waitWeb(u => u.includes(MARK + '-three'), 'secured page').catch(() => null);
  if (securedPage) await securedPage.evaluate(() => { document.cookie = 'secured_cookie=1; path=/'; localStorage.setItem('secured_ls', '1'); });
  const partition = await app.main(({webContents}, mark) => webContents.getAllWebContents().filter(w => w.getURL().includes(mark)).map(w => ({persist: w.session.isPersistent(), storage: w.session.storagePath || ''})), MARK);
  ok('row 1: secured pages run in a memory-only session', partition.length >= 1 && partition.every(p => !p.persist), JSON.stringify(partition));

  // 3a. The probe extension (a content script on every page), loaded through the Extensions manager into the profile.
  await app.main(({dialog}, dir) => { globalThis.__aciraOpenDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({canceled: false, filePaths: [dir]}); }, EXT);
  const loading = app.ui.evaluate(p => window.acira.extensions({type: 'load', profileId: p}), profileId).catch(error => ({error: error.message}));
  // The review card (Acira's own dialog page) asks once: Add extension.
  const review = await poll(() => app.context.pages().find(p => { try { return p.url().includes('native-dialog.html'); } catch { return false; } }), Boolean, 'extension review', 15000).catch(() => null);
  if (review) { await sleep(400); await review.getByRole('button', {name: 'Add extension'}).click({timeout: 5000}).catch(() => {}); }
  await sleep(600); await shot(app.ui, '03a-after-extension-load-dark-100.png');
  const loaded = await Promise.race([loading, sleep(20000).then(() => ({error: 'load timed out'}))]);
  await app.main(({dialog}) => { if (globalThis.__aciraOpenDialog) dialog.showOpenDialog = globalThis.__aciraOpenDialog; });
  const probeListed = (loaded?.extensions || []).some(e => e.name === 'Acira QA probe' && e.status === 'loaded');
  const controlPage = await app.waitWeb(u => u.includes(CONTROL), 'control page').catch(() => null);
  await controlPage?.reload().catch(() => {}); await sleep(1200);
  const probeOnNormal = controlPage ? await controlPage.evaluate(() => document.documentElement.getAttribute('data-acira-probe')) : null;
  ok('extensions control: the probe extension loads and runs in a normal tab', probeListed && probeOnNormal === '1', `listed=${probeListed} attr=${probeOnNormal} ${loaded?.error || ''}`);

  // Pages loaded before the extension never had it: load the secured one again so its absence means something.
  const securedReload = await app.waitWeb(u => u.includes(MARK + '-one'), 'secured one').catch(() => null); await securedReload?.reload().catch(() => {}); await sleep(1200);
  // 3. Extensions: the probe never runs in a secured page, the toolbar has nothing for it, the panel says unavailable.
  const securedOne = await app.waitWeb(u => u.includes(MARK + '-one'), 'secured one').catch(() => null);
  const probeOnSecured = securedOne ? await securedOne.evaluate(() => document.documentElement.getAttribute('data-acira-probe')) : 'no page';
  const securedTarget = (await app.svc({type: 'extensions.toolbar-target', tabId: inWs(s, health.id)[0].id}).catch(error => ({error: error.message})))?.extensionToolbar;
  ok('row 12: no extension content script runs in a secured page', probeOnSecured === null, `attr=${probeOnSecured}`);
  ok('row 12: the extension toolbar has nothing for a secured tab (unavailable, not acting through another tab)', securedTarget && securedTarget.supported === false && securedTarget.secured === true, JSON.stringify(securedTarget));
  await app.cmd({type: 'ui', tabId: (await app.state()).activeTabId, action: 'open', kind: 'extensions'}).catch(() => {});
  o = await popup('.extension-panel', 'extensions panel').catch(() => null);
  const panelText = o ? await o.locator('.extension-panel').innerText().catch(() => '') : '';
  ok('row 12: the Extensions panel says they don’t run here and lists the probe as unavailable here', /don’t run in a secured workspace/.test(panelText) && /Unavailable here/.test(panelText), panelText.replace(/\s+/g, ' ').slice(0, 160));
  if (o) { await shot(o, '03b-extensions-panel-secured-dark-100.png'); await o.keyboard.press('Escape'); await sleep(400); }

  // 4. A tab group (one + two) and a split (three + four) inside Health.
  await app.act({type: 'tab.new', url: url(MARK + '-four')}); await sleep(1200);
  s = await app.state(); mine = inWs(s, health.id);
  const named = n => mine.find(t => t.url.endsWith(MARK + '-' + n))?.id;
  const [one, two, three, four] = ['one', 'two', 'three', 'four'].map(named);
  await app.act({type: 'tab.group.create', tabId: one, name: GROUP, color: 'green'}); await sleep(300);
  s = await app.state(); const groupId = s.tabGroups.find(g => g.name === GROUP)?.id;
  if (groupId) await app.act({type: 'tab.group.assign', tabIds: [two], groupId}); await sleep(300);
  await app.act({type: 'tab.select', id: three}); await sleep(400);
  await app.act({type: 'split.open', tabIds: [three, four]}); await sleep(1500);
  s = await app.state();
  const groupBefore = s.tabGroups.find(g => g.name === GROUP), splitBefore = (s.windowUi.splitGroups || []).find(g => g.tabIds.includes(three));
  const membersBefore = inWs(s, health.id).filter(t => t.group === GROUP).map(t => t.id);
  ok('a secured workspace holds a tab group and a split', groupBefore && membersBefore.join() === [one, two].join() && splitBefore && splitBefore.tabIds.join() === [three, four].join(), JSON.stringify({group: groupBefore?.color, membersBefore, split: splitBefore?.tabIds}));
  await shot(app.ui, '03-health-group-split-dark-100.png');
  const sealedIds = inWs(s, health.id).map(t => t.id);
  const groupState = st => { const g = st.tabGroups.find(x => x.name === GROUP), sp = (st.windowUi.splitGroups || []).find(x => x.tabIds.includes(three)); return {color: g?.color, collapsed: g?.collapsed, members: inWs(st, health.id).filter(t => t.group === GROUP).map(t => t.id), split: sp ? {tabIds: sp.tabIds, layout: sp.layout, cols: sp.cols, rows: sp.rows} : null, order: inWs(st, health.id).map(t => t.id)}; };
  const expectedGroups = groupState(s);

  // 5. Notifications: permission through the in-window card, then the page's own words never reach Windows.
  await app.main(({Notification}) => { globalThis.__notes = []; const proto = Notification.prototype; globalThis.__noteShow = proto.show; globalThis.__noteClose = proto.close; proto.show = function () { globalThis.__notes.push({title: this.title, body: this.body, subtitle: this.subtitle || '', closed: false}); this.__aciraIndex = globalThis.__notes.length - 1; }; proto.close = function () { if (this.__aciraIndex !== undefined) globalThis.__notes[this.__aciraIndex].closed = true; }; });
  await app.act({type: 'tab.select', id: two}); await sleep(800);
  const notePage = await app.waitWeb(u => u.includes(MARK + '-two'), 'notification page').catch(() => null);
  // The site's question shows as the in-window card (site-prompt.html) or, when that can't anchor, Acira's dialog page (native-dialog.html).
  const allowButton = async () => { for (const p of app.context.pages()) { let u = ''; try { u = p.url(); } catch { continue; } if (!/site-prompt.html|native-dialog.html/.test(u)) continue; const b = p.getByRole('button', {name: 'Allow', exact: true}); if (await b.count().catch(() => 0) && await b.first().isVisible().catch(() => false)) return b.first(); } return null; };
  let granted = null;
  if (notePage) {
    const answer = notePage.evaluate(() => Notification.requestPermission());
    const allow = await poll(allowButton, Boolean, 'permission question', 12000).catch(() => null);
    if (allow) { await sleep(300); await allow.click({timeout: 5000}).catch(() => {}); } else await shot(app.ui, '05x-no-permission-question.png');
    granted = await Promise.race([answer, sleep(8000).then(() => 'timeout')]).catch(error => 'error ' + error.message);
  }
  ok('notifications: the site can be allowed as usual (in-window card)', granted === 'granted', String(granted));
  const pageSide = notePage ? await notePage.evaluate(async note => {
    const events = [];
    const n = new Notification('Title ' + note, {body: 'Body ' + note, tag: 't'}); n.onshow = () => events.push('show'); n.onerror = () => events.push('error');
    await new Promise(r => setTimeout(r, 400));
    const frame = document.createElement('iframe'); document.body.append(frame); await new Promise(r => setTimeout(r, 200));
    const Native = frame.contentWindow.Notification; const bypass = []; let bypassError = '';
    try { const m = new Native('Bypass ' + note, {body: 'Bypass body ' + note}); m.onshow = () => bypass.push('show'); m.onerror = () => bypass.push('error'); } catch (error) { bypassError = error.message; }
    await new Promise(r => setTimeout(r, 1200));
    return {events, permission: Notification.permission, title: n.title, bypass, bypassError, nativePermission: Native.permission, wrapped: !String(Notification).includes('[native code]'), sw: typeof ServiceWorkerRegistration === 'function' && !String(ServiceWorkerRegistration.prototype.showNotification).includes('[native code]')};
  }, NOTE).catch(error => ({error: error.message})) : null;
  await sleep(800);
  let notes = await app.main(() => globalThis.__notes);
  ok('row 11: a secured page’s notification reaches Windows as the neutral line only (no title, no body)', notes.length === 1 && notes[0].title === NEUTRAL && notes[0].body === '' && !JSON.stringify(notes).includes(NOTE), JSON.stringify(notes));
  ok('row 11: the page still sees its own notification (show event, its own title)', pageSide?.events?.includes('show') && pageSide.title === 'Title ' + NOTE && pageSide.wrapped && pageSide.sw, JSON.stringify(pageSide));
  ok('row 11: Chromium’s own notification is refused (a fresh frame’s Notification gets an error, Windows gets nothing)', pageSide && !pageSide.bypass.includes('show') && (pageSide.bypass.includes('error') || pageSide.bypassError || pageSide.nativePermission === 'denied') && !JSON.stringify(notes).includes('Bypass'), JSON.stringify({bypass: pageSide?.bypass, err: pageSide?.bypassError, perm: pageSide?.nativePermission}));
  s = await app.state();
  ok('row 11: Acira’s own surfaces show nothing of the notification (interface snapshot, toast)', !JSON.stringify(s).includes(NOTE) && !(s.toast?.text || '').includes(NOTE));
  const normalWrapped = controlPage ? await controlPage.evaluate(() => String(Notification).includes('[native code]')) : null;
  ok('regression: a normal tab keeps the browser’s own Notification', normalWrapped === true, String(normalWrapped));

  // 6. Capture exclusion on real pixels: a magenta secured page is missing from another process's screen capture.
  await app.act({type: 'tab.select', id: one}); await sleep(400);
  await app.act({type: 'tab.navigate', tabId: one, url: url('magenta-' + MARK + '-one')}); await sleep(1800);
  const insideColour = await internalColour('magenta-' + MARK);
  const protectedCapture = await screenCapture('13-capture-secured-page.png');
  ok('row 8: a screen capture of the window while a secured page shows holds none of it (window excluded)', insideColour > 0.3 && protectedCapture.magenta >= 0 && protectedCapture.magenta < 0.005 && protectedCapture.protectedNow !== false, JSON.stringify({insideColour, ...protectedCapture}));

  // 7. Lock now (menu action) -> lock screen, pages detached, nothing in the snapshot, the notification taken away.
  await app.act({type: 'workspace.lock', id: health.id});
  await poll(lockedNow, Boolean, 'locked', 6000).catch(() => null); await sleep(700);
  s = await app.state();
  const active = s.tabs.find(t => t.id === s.activeTabId);
  ok('row 3: Lock now shows the lock screen and suspends the pages', active?.url === 'acira://locked' && await app.main(({BaseWindow}, mark) => !BaseWindow.getAllWindows().some(w => w.contentView.children.some(v => v.webContents?.getURL().includes(mark) && v.getVisible())), MARK), active?.url);
  ok('row 4: nothing of the locked tabs, their group or their split in the interface snapshot', !JSON.stringify(s).includes(MARK) && !(s.windowUi.splitGroups || []).some(g => g.id === splitBefore?.id));
  notes = await app.main(() => globalThis.__notes);
  ok('row 11: locking takes the shown notification away', notes.length === 1 && notes[0].closed === true, JSON.stringify(notes));
  ok('lock screen visible', await app.ui.locator('.ws-locked').count() === 1 && /locked/i.test(await app.ui.locator('.ws-locked h1').innerText().catch(() => '')));
  await shot(app.ui, '04-lock-screen-dark-100.png');
  // Switcher says "Locked" and offers Unlock in place of Rename / Icon and color / Delete.
  await app.ui.locator('.sb-ws-title-main').click().catch(() => {}); o = await popup('.ws-menu-head', 'switcher').catch(() => null);
  if (o) {
    const text = await o.locator('.ws-menu').innerText();
    ok('switcher row says Locked (no count); the locked workspace offers Unlock only', /Locked/.test(text) && /Unlock with Windows Hello/.test(text) && !/Rename|Delete workspace|Icon and color/.test(text), text.replace(/\s+/g, ' ').slice(0, 200));
    await shot(o, '05-switcher-locked-dark-100.png'); await o.keyboard.press('Escape'); await sleep(400);
  } else ok('switcher row says Locked (no count); the locked workspace offers Unlock only', false, 'popover did not open');

  // 8. Unlock from the lock screen button -> the same tabs, group and split back.
  await unlockFromScreen('unlocked');
  s = await app.state();
  ok('row 6: unlock (test gate) brings the same tabs back', inWs(s, health.id).map(t => t.id).sort().join() === [...sealedIds].sort().join(), inWs(s, health.id).map(t => t.url.slice(-12)).join(','));
  ok('row 13: unlock brings the tab group and the split back exactly', JSON.stringify(groupState(s)) === JSON.stringify(expectedGroups), JSON.stringify(groupState(s)));
  await shot(app.ui, '06-unlocked-group-split-dark-100.png');

  // 9. Leave -> locked; the capture shows the normal page again; come back -> lock screen.
  await app.act({type: 'workspace.select', id: s.workspaces[0].id});
  await poll(lockedNow, Boolean, 'leave lock', 6000).catch(() => null);
  ok('leaving Health locks it', await lockedNow());
  await sleep(1200);
  const normalCapture = await screenCapture('14-capture-normal-workspace.png');
  ok('row 8: after switching to a normal workspace the capture shows the page (capture exclusion off)', normalCapture.lime > 0.3 && normalCapture.protectedNow !== true, JSON.stringify(normalCapture));
  // Partition isolation, other side: the same origin in a normal tab has no secured cookie or storage.
  const normalPage = await app.waitWeb(u => u.includes(CONTROL), 'normal page').catch(() => null);
  const seen = normalPage ? await normalPage.evaluate(() => ({cookie: document.cookie, ls: localStorage.getItem('secured_ls')})) : null;
  ok('row 1: a normal tab on the same site sees no secured cookie or storage', seen && !seen.cookie.includes('secured_cookie') && seen.ls === null, JSON.stringify(seen));
  await app.act({type: 'workspace.select', id: health.id}); await sleep(800);
  s = await app.state();
  ok('coming back shows the lock screen', s.tabs.find(t => t.id === s.activeTabId)?.url === 'acira://locked');
  await unlockFromScreen('unlock 2');

  // 10. Minimise -> locked.
  await app.main(({BaseWindow}) => BaseWindow.getAllWindows().filter(x => !x.isDestroyed()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0].minimize()); await sleep(900);
  ok('minimising locks it', await lockedNow());
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows().filter(x => !x.isDestroyed()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0]; w.restore(); w.show(); w.focus(); }); await sleep(900);
  await shot(app.ui, '06b-after-minimise-restore-dark-100.png');
  s = await app.state();
  ok('after minimise: no stale "is unlocked" toast over the lock screen', s.toast?.i18n?.id !== 'workspaces.unlockedToast' && await poll(() => app.ui.evaluate(() => ![...document.querySelectorAll('*')].some(el => el.children.length === 0 && /is unlocked/.test(el.textContent || '') && !el.closest('.sr-only') && el.getBoundingClientRect().width > 4)), Boolean, 'no stale toast', 3000).then(() => true, () => false), s.toast?.text || 'no toast');

  // 11. Idle with the 1 minute setting (system idle time read through powerMonitor, as the app does every 30 s).
  await app.act({type: 'settings.update', patch: {securedLockMinutes: 1}}); await sleep(400);
  await unlockFromScreen('unlock for idle');
  await app.main(({powerMonitor}) => { powerMonitor.getSystemIdleTime = () => 45; });
  await sleep(33000);
  ok('row 7 idle: 45 s away with the 1 minute setting keeps it open (one 30 s check passed)', !(await lockedNow()));
  await app.main(({powerMonitor}) => { powerMonitor.getSystemIdleTime = () => 61; });
  const idleLocked = await poll(lockedNow, Boolean, 'idle lock', 40000).then(() => true, () => false);
  await app.main(({powerMonitor}) => { delete powerMonitor.getSystemIdleTime; });
  ok('row 7 idle: 61 s away with the 1 minute setting locks it (real 30 s timer)', idleLocked);
  await sleep(600); await shot(app.ui, '15-idle-locked-dark-100.png');
  await app.act({type: 'settings.update', patch: {securedLockMinutes: 5}}); await sleep(300);

  // 12. Windows locking and the PC sleeping (Electron's powerMonitor events, as Windows sends them).
  await unlockFromScreen('unlock for os lock');
  await app.main(({powerMonitor}) => powerMonitor.emit('lock-screen'));
  ok('row 7 Windows lock: the lock-screen event locks it', await poll(lockedNow, Boolean, 'os lock', 5000).then(() => true, () => false));
  await unlockFromScreen('unlock for sleep');
  await app.main(({powerMonitor}) => powerMonitor.emit('suspend'));
  ok('row 7 sleep: the suspend event locks it', await poll(lockedNow, Boolean, 'sleep lock', 5000).then(() => true, () => false));

  // 13. Looks: light 100 and dark/light 150 of the lock screen and switcher; the locked switcher fits an 820 px window.
  for (const [appearance, scale] of [['dark', 100], ['light', 100], ['dark', 150], ['light', 150]]) {
    await app.act({type: 'settings.update', patch: {appearance, interfaceScale: scale}}); await sleep(1300);
    if (!(appearance === 'dark' && scale === 100)) await shot(app.ui, `07-lock-screen-${appearance}-${scale}.png`);
    await app.ui.locator('.sb-ws-title-main').click().catch(() => {}); o = await popup('.ws-menu-head', 'switcher').catch(() => null);
    if (o) { const fit = await overflowOf(o); ok(`row 4 fit: the locked switcher fits without scrolling (${appearance} ${scale}%, 820 px window)`, fit.worst <= 1 && fit.docScroll <= 1, JSON.stringify(fit)); await shot(o, `08-switcher-${appearance}-${scale}.png`); await o.keyboard.press('Escape'); await sleep(400); }
    else ok(`row 4 fit: the locked switcher fits without scrolling (${appearance} ${scale}%, 820 px window)`, false, 'popover did not open');
  }
  await app.act({type: 'settings.update', patch: {appearance: 'dark', interfaceScale: 100}}); await sleep(1000);

  // 14. Settings › Privacy › Secured workspaces.
  await app.act({type: 'tab.new', url: 'acira://settings'}); await sleep(1500);
  await app.ui.getByText('Privacy', {exact: true}).first().click().catch(() => {}); await sleep(900);
  await app.ui.getByText('Lock secured workspaces').first().evaluate(el => el.scrollIntoView({block: 'center'})).catch(() => {}); await sleep(600);
  ok('Settings row shows', await app.ui.getByText('Lock secured workspaces').count() > 0);
  await sleep(500); await shot(app.ui, '09-settings-row-dark-100.png');
  await app.act({type: 'settings.update', patch: {appearance: 'light'}}); await sleep(1200); await shot(app.ui, '09-settings-row-light-100.png');
  await app.act({type: 'settings.update', patch: {appearance: 'dark'}}); await sleep(600);

  // 15. Regression pass for people who never turn it on.
  s = await app.state();
  const work = s.workspaces.find(w => w.name === 'Work');
  await app.act({type: 'workspace.select', id: work.id}); await sleep(700);
  s = await app.state(); ok('regression: ordinary workspace switch', s.activeWorkspaceId === work.id);
  await app.act({type: 'tab.new', privacy: 'private', url: url('private-page')}); await sleep(1200);
  s = await app.state(); const priv = s.tabs.find(t => t.privacy === 'private');
  ok('regression: private tab opens with its own session', !!priv);
  if (priv) { await app.act({type: 'tab.group.create', tabId: priv.id, name: 'Private group'}); await sleep(300); ok('regression: a private tab still takes no group', !(await app.state()).tabGroups.some(g => g.name === 'Private group')); await app.act({type: 'tab.close', id: priv.id}); await sleep(600); }
  s = await app.state(); ok('regression: a closed private tab leaves no Undo entry', !s.closedTabs.some(t => t.url.includes('private-page')));
  await app.act({type: 'tab.new', url: url('undo-page')}); await sleep(1000);
  s = await app.state(); const undoTab = s.tabs.find(t => t.url.includes('undo-page'));
  await app.act({type: 'tab.close', id: undoTab.id}); await sleep(500); await app.act({type: 'tab.restore'}); await sleep(900);
  s = await app.state(); ok('regression: closed-tab Undo brings an ordinary tab back', s.tabs.some(t => t.url.includes('undo-page')));
  await app.act({type: 'tab.new', url: 'acira://rewind'}); await sleep(1500);
  ok('regression: Rewind page opens', await app.ui.locator('.rw-page, [data-rewind-page], .rewind-page').count() > 0 || (await app.state()).tabs.some(t => t.url === 'acira://rewind'));
  await shot(app.ui, '10-regression-rewind-dark-100.png');

  // 16. Quit (seals), disk scan, restart -> starts locked; unlock from the sealed file: tabs, group and split.
  await app.close(); app = null; await sleep(1500);
  const hits = scan(PROFILE, MARK), noteHits = scan(PROFILE, NOTE), control = scan(PROFILE, CONTROL);
  ok('row 2: no file in the profile holds the secured marker (addresses, titles, group name) after quit', hits.length === 0, hits.slice(0, 6).join(', '));
  ok('row 11: no file in the profile holds the notification text', noteHits.length === 0, noteHits.slice(0, 6).join(', '));
  ok('row 2 control: the normal-tab marker IS found (the scan works)', control.length > 0, control.slice(0, 3).join(', '));
  const vaultFiles = await fs.readdir(path.join(PROFILE, 'secured-workspaces')).catch(() => []);
  ok('the sealed file exists', vaultFiles.some(f => f.endsWith('.vault')), vaultFiles.join(','));
  app = await launch();
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows().filter(x => !x.isDestroyed()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0]; w.setBounds({x: 40, y: 30, width: 1280, height: 820}); w.show(); });
  await sleep(1200);
  health = await ws('Health'); s = await app.state();
  ok('restart: Health starts locked with no tabs or group in the window', health?.secured && !health.unlocked && !JSON.stringify(s).includes(MARK), JSON.stringify(health));
  await app.act({type: 'workspace.select', id: health.id}); await sleep(900);
  await shot(app.ui, '11-restart-locked-dark-100.png');
  await unlockFromScreen('unlock after restart'); await sleep(600);
  s = await app.state();
  ok('restart: unlock opens the same sealed tabs', inWs(s, health.id).map(t => t.id).sort().join() === [...sealedIds].sort().join(), inWs(s, health.id).map(t => t.url.slice(-12)).join(','));
  ok('row 13 restart: the tab group and the split come back exactly from the sealed file', JSON.stringify(groupState(s)) === JSON.stringify(expectedGroups), JSON.stringify(groupState(s)));
  await shot(app.ui, '12-restart-unlocked-dark-100.png');
} catch (error) {
  ok('run', false, error.stack?.split('\n').slice(0, 3).join(' | '));
} finally {
  try { await app?.main(({BaseWindow}) => BaseWindow.getAllWindows().filter(x => !x.isDestroyed()).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0]?.setAlwaysOnTop(false)); } catch {}
  try { await app?.close(); } catch {}
  try { await site.close(); } catch {}
  try { fss.unlinkSync(slot); } catch {}
  await fs.writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
  console.log(`${results.filter(r => r.pass).length}/${results.length} passed`);
}
