// Stream D: private tabs inside a normal window (docs/launch/PRIVATE_TABS.md). Real app, disposable profile, one instance, 5 tabs at most, closed in finally.
// Proves: each private tab is its own empty session; nothing of it reaches disk (a marker only the private tabs know is searched for in every file the
// profile folder holds, after a normal quit and after a hard kill, with a normal-tab marker as the control); the session is emptied when the page goes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startApp, sleep, poll} from './d-harness.mjs';

const stamp = Date.now(), PRIVATE = `PRIVMARK${stamp}`, NORMAL = `NORMMARK${stamp}`, report = [];
const ICON = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');
let probeHits = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/icon.png') { res.setHeader('content-type', 'image/png'); return res.end(ICON); }
  if (url.pathname === '/dl') { res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', `attachment; filename="${url.searchParams.get('n')}.txt"`); return res.end('file'); }
  if (url.pathname === '/probe') probeHits++;
  if (url.pathname === '/favicon.ico') { res.statusCode = 404; return res.end(); }
  const m = url.searchParams.get('m') || '';
  if (url.pathname === '/set') res.setHeader('set-cookie', `c=${m}; Path=/`);
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>${url.pathname === '/set' ? 'set ' + m : 'read'}</title><link rel="icon" href="/icon.png"><body>${m}<script>${url.pathname === '/set' ? `localStorage.setItem('k','${m}');` : `document.title='read:'+document.cookie+'|'+localStorage.getItem('k');`}</script>`);
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const base = `http://127.0.0.1:${server.address().port}`;

async function allBytes(root) {
  const files = []; const walk = async dir => { for (const entry of await fs.readdir(dir, {withFileTypes: true})) { const file = path.join(dir, entry.name); if (entry.isDirectory()) await walk(file); else files.push(file); } };
  await walk(root); const found = {};
  for (const file of files) { let data; try { data = await fs.readFile(file); } catch { continue; } for (const [name, text] of [['private', PRIVATE], ['normal', NORMAL]]) if (data.includes(Buffer.from(text, 'utf8')) || data.includes(Buffer.from(text, 'utf16le'))) (found[name] ||= []).push(path.relative(root, file)); }
  return found;
}
const iconOf = (app, id) => poll(async () => (await app.state()).tabs.find(t => t.id === id)?.favicon, Boolean, 'favicon of ' + id, 15000);
const titleOf = (app, url) => poll(async () => (await app.state()).tabs.find(t => t.url === url)?.title, Boolean, 'title of ' + url, 15000);
const openTab = async (app, url, privacy) => { const before = new Set((await app.state()).tabs.map(t => t.id)); await app.act({type: 'tab.new', url, ...(privacy ? {privacy} : {})}); return poll(async () => (await app.state()).tabs.find(t => !before.has(t.id) && t.url === url), Boolean, 'tab ' + url); };
const readTitle = async (app, tab, wanted) => poll(async () => { const now = (await app.state()).tabs.find(t => t.id === tab.id); return now?.title?.startsWith('read:') && (!wanted || now.title.includes(wanted)) ? now.title : null; }, Boolean, 'read title', 15000);
const sleepToSettle = () => sleep(1200);

// ---- run 1: a normal quit
let root = '.qa-profiles/d-private-tabs-1'; await fs.rm(root, {recursive: true, force: true});
let app = await startApp({root, env: {ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.resolve(root, 'saved')}});
try {
  await app.main(({dialog}) => { dialog.showMessageBox = async () => ({response: 1}); });
  const normal = await openTab(app, `${base}/set?m=${NORMAL}`); await titleOf(app, normal.url); const normalIcon = await iconOf(app, normal.id);
  const p1 = await openTab(app, `${base}/read`, 'private');
  assert.equal(p1.privacy, 'private'); assert.equal(p1.browserProfileId, normal.browserProfileId, 'a private tab stays in the window\'s profile for the strip and menus');
  assert.equal(await readTitle(app, p1), 'read:|null', 'the private tab sees none of the normal tab\'s cookies or storage');
  const privateIcon = await iconOf(app, p1.id);
  report.push('a private tab starts with an empty session');

  await app.act({type: 'tab.navigate', tabId: p1.id, url: `${base}/set?m=${PRIVATE}`}); await poll(async () => (await app.state()).tabs.find(t => t.id === p1.id)?.title === `set ${PRIVATE}`, Boolean, 'private set page', 15000);
  await app.act({type: 'tab.navigate', tabId: p1.id, url: `${base}/read`}); assert.equal(await readTitle(app, p1, PRIVATE), `read:c=${PRIVATE}|${PRIVATE}`, 'and keeps its own cookies and storage while open');
  await app.act({type: 'tab.select', id: normal.id}); await app.act({type: 'tab.navigate', tabId: normal.id, url: `${base}/read`}); assert.equal(await readTitle(app, normal, NORMAL), `read:c=${NORMAL}|${NORMAL}`, 'the normal tab never sees the private cookie');
  const p2 = await openTab(app, `${base}/read?tab=p2`, 'private'); assert.equal(await readTitle(app, p2), 'read:|null', 'a second private tab has its own session, not the first one\'s');
  report.push('private tabs and normal tabs do not share cookies or storage; neither do two private tabs');
  // permissions: an Allow given in a private tab stays in that tab
  const privatePage = await app.waitWeb(url => url.includes('tab=p2')), normalPage = await app.waitWeb(url => url === normal.url || url.includes('/read') && !url.includes('tab=p2'));
  assert.equal(await privatePage.evaluate(() => Notification.permission), 'default', 'a question nobody answered reads default in a private tab');
  assert.equal(await privatePage.evaluate(() => Notification.requestPermission()), 'granted');
  assert.equal(await privatePage.evaluate(() => Notification.permission), 'granted');
  assert.equal(await normalPage.evaluate(() => Notification.permission), 'default', 'the Allow did not reach the normal profile');
  report.push('a permission answered in a private tab stays in that tab');
  // downloads: shown for the private tab, flagged private, never shared or saved
  await app.act({type: 'tab.navigate', tabId: p2.id, url: `${base}/dl?n=${PRIVATE}`});
  const download = await poll(async () => (await app.state()).downloads.find(d => String(d.name).includes(PRIVATE)), Boolean, 'private download', 20000);
  assert.equal(download.private, true); assert.equal(download.browserProfileId, p2.browserProfileId, 'listed under the profile of the window so the Downloads list shows it');
  report.push('a download from a private tab is listed in its window only and flagged private');

  assert.ok(String(privateIcon).startsWith('data:'), 'a private tab icon is fetched through its own session: ' + String(privateIcon).slice(0, 40));
  assert.ok(String(normalIcon).startsWith('data:'), 'control: a normal tab icon comes the same way (one icon path through the tab session)');
  const state = await app.state();
  report.push('private icon is fetched through the private session');

  assert.ok(!state.browsingHistory.some(v => JSON.stringify(v).includes(PRIVATE)), 'no history entry for the private tab'); assert.ok(state.browsingHistory.some(v => v.url.includes(NORMAL)), 'control: the normal tab is in history');
  await app.act({type: 'tab.pin', id: p1.id}); await app.act({type: 'tab.group.create', tabId: p1.id, name: 'Work'});
  const after = await app.state(); assert.equal(after.tabs.find(t => t.id === p1.id).pinned, false); assert.equal(after.tabGroups.length, 0); report.push('private tabs cannot be pinned or grouped');
  await app.act({type: 'tab.move-window', id: p1.id}); assert.match((await app.state()).toast?.text || '', /private tab can.t move/i); report.push('a private tab cannot move to another window');

  // closing the page empties and seals its session
  const record = await app.main(() => (globalThis.__aciraPrivateTabs || []).map(item => ({...item}))); const first = record.find(item => item.tabId === p1.id); assert.ok(first, 'the native side recorded the private tab\'s partition');
  await app.act({type: 'tab.close', id: p1.id});
  await poll(() => app.main(({}, id) => (globalThis.__aciraPrivateTabs || []).find(item => item.profileId === id)?.retired === true, first.profileId), Boolean, 'private session retired', 15000);
  const emptied = await poll(() => app.main(async ({session}, partition) => { const ses = session.fromPartition(partition); try { return {persistent: ses.isPersistent(), cookies: (await ses.cookies.get({})).length}; } catch (error) { return {error: String(error.message)}; } }, first.partition), result => result.cookies === 0 || Boolean(result.error), 'private cookies emptied', 20000);
  assert.equal(emptied.persistent, false, 'the session was never persistent'); assert.ok(emptied.error || emptied.cookies === 0, 'and nothing is left in it');
  assert.equal((await app.state()).closedTabs.length, 0, 'nothing to undo or reopen'); assert.ok(!(await app.state()).tabs.some(t => t.id === p1.id));
  report.push('closing a private tab empties its session; nothing to reopen');
  await sleepToSettle();
} finally { await app.close(); }
await sleep(1500);
const afterQuit = await allBytes(path.resolve(root));
assert.ok(afterQuit.normal?.length, 'control: the scan does find the normal tab\'s marker on disk (so it can find the private one)');
assert.equal(afterQuit.private, undefined, 'nothing of the private tabs on disk after a normal quit: ' + JSON.stringify(afterQuit.private));
report.push(`disk scan after a normal quit: private marker absent (control marker found in ${afterQuit.normal.length} file(s))`);

// ---- run 2: a hard kill while private tabs are still open
root = '.qa-profiles/d-private-tabs-2'; await fs.rm(root, {recursive: true, force: true});
app = await startApp({root});
const pid = await app.main(() => process.pid);
try {
  await openTab(app, `${base}/set?m=${NORMAL}`); const p = await openTab(app, `${base}/set?m=${PRIVATE}`, 'private'); await poll(async () => (await app.state()).tabs.find(t => t.id === p.id)?.title === `set ${PRIVATE}`, Boolean, 'private page', 15000);
  await sleep(4500);
  await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']);
} catch (error) { try { await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']); } catch {} throw error; }
await sleep(2500);
const afterKill = await allBytes(path.resolve(root));
assert.equal(afterKill.private, undefined, 'nothing of the private tab on disk after a hard kill: ' + JSON.stringify(afterKill.private));
report.push('disk scan after a hard kill with the private tab open: private marker absent');
// restart: no private tab comes back
app = await startApp({root, skipSetup: false});
try { await sleep(2500); const restored = await app.state(); assert.ok(!restored.tabs.some(t => t.privacy) && !JSON.stringify(restored).includes(PRIVATE), 'no private tab is restored'); report.push('after a restart no private tab is restored'); } finally { await app.close(); }

// ---- runs 3 and 4: a kind that must prepare its session first (Tor) - the page waits for it, and never loads when it fails
for (const mode of ['slow', 'fail']) {
  root = '.qa-profiles/d-private-tabs-' + mode; await fs.rm(root, {recursive: true, force: true});
  app = await startApp({root, env: {ACIRA_TEST_PRIVATE_PREPARE: mode}});
  try {
    probeHits = 0; const before = Date.now();
    const tab = await openTab(app, `${base}/probe`, 'private');
    await sleep(900); assert.equal(probeHits, 0, 'no request leaves while the kind is still preparing the session');
    if (mode === 'slow') { await poll(() => probeHits > 0, Boolean, 'the page loads once prepared', 15000); assert.ok(Date.now() - before > 1500, 'and only after the prepare finished'); report.push('a private page waits for its kind to prepare the session, then loads'); }
    else { await sleep(3500); assert.equal(probeHits, 0, 'a failed prepare means the page never loads (no fallback to a direct connection)'); assert.match((await app.state()).toast?.text || '', /private tab safe/i); report.push('when the kind cannot prepare the session the page never loads'); }
    assert.ok(tab.privacy === 'private');
  } finally { await app.close(); }
}
await new Promise(resolve => server.close(resolve));
console.log(JSON.stringify({ok: true, report}, null, 1));
