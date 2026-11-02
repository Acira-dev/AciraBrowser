// Stream D: one clean end-to-end pass on a fresh profile, the way a new user would use the browser.
// fresh profile -> onboarding (bookmarks file import) -> 5 real sites -> sign-in form -> download -> permission prompt
// -> force-kill -> restore -> profile B isolation -> private window leaves nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-e2e'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true}); await fs.mkdir('qa/artifacts', {recursive: true});
const token = 'E2E' + Math.random().toString(36).slice(2, 10), report = [], notes = [];
const bookmarksFile = path.resolve(root, 'bookmarks.html'), downloadsDir = path.resolve(root, 'downloads');
await fs.writeFile(bookmarksFile, '<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p><DT><H3>Work</H3><DL><p><DT><A HREF="https://example.org/imported-one">Imported one</A><DT><A HREF="https://example.net/imported-two">Imported two</A></DL><p><DT><A HREF="https://www.iana.org/">IANA</A></DL><p>');
// The import step is intentionally skipped when discovery finds no browsers.
// Seed only the isolated fixture so its file-import option is reachable.
const chromeFixture = path.join(root, 'fixture-local', 'Google', 'Chrome', 'User Data');
await fs.mkdir(path.join(chromeFixture, 'Default'), {recursive: true});
await fs.writeFile(path.join(chromeFixture, 'Local State'), JSON.stringify({profile: {info_cache: {Default: {name: 'QA import source'}}}}));
await fs.writeFile(path.join(chromeFixture, 'Default', 'Bookmarks'), JSON.stringify({roots: {bookmark_bar: {name: 'Bookmarks bar', children: [{type: 'url', name: 'QA source bookmark', url: 'https://example.com/qa-source'}]}}})); // a source with nothing to import is not offered, and setup then skips the step
const fx = await httpFixture((req, res) => {
  const url = new URL(req.url, 'http://x'), cookie = Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map(c => c.split('=')));
  res.setHeader('content-type', 'text/html');
  if (req.method === 'POST' && url.pathname === '/login') { let body = ''; req.on('data', c => body += c); req.on('end', () => { const who = new URLSearchParams(body).get('user') || 'nobody'; res.statusCode = 303; res.setHeader('Set-Cookie', [`sid=${who}; Path=/; Max-Age=86400; HttpOnly`, `${token}=1; Path=/; Max-Age=86400`]); res.setHeader('Location', '/dashboard'); res.end(); }); return; }
  if (url.pathname === '/dashboard') return res.end(`<title>Dashboard ${cookie.sid || 'signed-out'}</title><h1>${cookie.sid ? 'Welcome ' + cookie.sid : 'Please sign in'}</h1>`);
  if (url.pathname === '/file') { res.setHeader('content-type', 'application/octet-stream'); res.setHeader('content-disposition', 'attachment; filename="invoice.bin"'); return res.end(Buffer.alloc(80000, 5)); }
  if (url.pathname === '/perm') return res.end('<title>perm</title>x');
  res.end(`<title>Sign in</title><form method="post" action="/login"><input name="user" aria-label="user"><input name="pass" type="password" aria-label="pass"><button>Sign in</button></form>`);
});
const base = `http://127.0.0.1:${fx.port}`;
// R3-73: what a website asks (permissions, alert/confirm, leave-this-site) is one card in the window (desktop/site-prompt.html), not a separate window.
const cardPage = app => app.context.pages().find(p => { try { return p.url().includes('site-prompt.html'); } catch { return false; } });
const walk = async dir => { const out = []; for (const e of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; };
const savedTabs = async () => { const {DatabaseSync} = await import('node:sqlite'); const db = new DatabaseSync(path.join(path.resolve(root), 'browser.sqlite'), {readOnly: true}); const row = db.prepare("select payload from windows where id='main'").get(); db.close(); return row ? (JSON.parse(row.payload).tabs || []).length : -1; };
let app = await startApp({root, skipSetup: false, env: {ACIRA_TEST_APP_DIALOG: '1'}}); let pid;
try {
  pid = await app.main(() => process.pid);
  // 1. Onboarding on a fresh profile, importing a bookmarks file (never the real browser profiles on this PC).
  await app.main(({dialog}, file) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [file]}); }, bookmarksFile);
  // Setup also draws an inert, aria-hidden "rehearsal" copy of the next step behind the welcome for about a second (.fr-rehearsal), and a card that is
  // leaving overlaps the one arriving: only the live surface counts (not aria-hidden, not inert, visible), and a step is "ready" when exactly one
  // live Get started / Continue / Skip button is enabled. Every wait below is on that state, never a fixed delay.
  const dialogUp = () => app.ui.locator('.setup-dialog').count();
  const live = () => app.ui.locator('.setup-dialog [data-onboarding-next]:not([aria-hidden="true"] *):not([inert] *)').filter({visible: true});
  const ready = async () => (await live().evaluateAll(nodes => nodes.filter(node => !node.disabled).length).catch(() => 0)) === 1;
  const stepKey = () => app.ui.evaluate(() => { const live = [...document.querySelectorAll('.setup-dialog [data-onboarding-next]')].filter(n => !n.closest('[aria-hidden="true"],[inert]') && n.checkVisibility()); return (document.querySelector('.setup-dialog #fr-title, .setup-dialog .fr-card-title, .setup-dialog h1')?.textContent || '').trim() + ' | ' + live.map(n => (n.textContent || '').trim()).join(' / '); }).catch(() => '');
  await poll(ready, Boolean, 'first run shows setup (one live Get started button)', 20000); report.push('first run shows onboarding');
  let fileImport = false;
  for (let i = 0; i < 12 && await dialogUp(); i++) {
    await poll(async () => !(await dialogUp()) || await ready(), Boolean, 'next setup step ready', 15000);
    if (!(await dialogUp())) break;
    const here = await stepKey(); console.log('setup step:', here);
    const file = app.ui.getByRole('button', {name: /Use a bookmarks file/i});
    if (!fileImport && await file.count()) {
      // The Import step lists the browsers it found (the seeded Chrome fixture) and the link waits while it reads them. The Open dialog is stubbed to the fixture file.
      await poll(() => file.isEnabled(), Boolean, 'bookmarks file link enabled', 15000); await file.click();
      await poll(async () => (await app.state()).bookmarkNodes.filter(b => b.url).length, n => n >= 3, 'bookmarks imported from the file', 15000);
      assert.match(await app.ui.locator('.setup-dialog .fr-note[role=status]').first().textContent(), /Imported 3 bookmarks from a file/, 'the Import step says what the file brought in');
      fileImport = true; report.push('onboarding imported 3 bookmarks from a file (the Import step said so)');
    }
    await live().first().click({timeout: 8000});
    await poll(async () => !(await dialogUp()) || (await stepKey()) !== here, Boolean, 'setup moved to the next step', 10000);
  }
  assert.ok(fileImport, 'setup reached the Import step and its "use a bookmarks file" link');
  await poll(dialogUp, n => n === 0, 'onboarding finished', 15000); report.push('onboarding completes');
  let s = await app.state(); for (const title of ['Imported one', 'Imported two', 'IANA', 'Work']) assert.ok(s.bookmarkNodes.some(b => b.title === title), `imported "${title}" present`); report.push('the file import is in the bookmarks after setup');
  // 2. Five real sites.
  const sites = ['example.com', 'en.wikipedia.org/wiki/Web_browser', 'www.mozilla.org', 'developer.mozilla.org', 'github.com/login'], loaded = [];
  for (const site of sites) {
    await app.act({type: 'tab.new', url: site}); const id = (await app.state()).tabs.at(-1).id;
    const tab = await poll(async () => (await app.state()).tabs.find(t => t.id === id), t => t && (t.error || (!t.loading && t.title && !/^https?:/.test(t.title))), `site ${site}`, 30000).catch(() => null);
    const ok = !!tab && !tab.error; loaded.push([site, ok, tab?.title || tab?.error || 'timeout']);
  }
  const passed = loaded.filter(l => l[1]).length; notes.push('real sites: ' + loaded.map(l => `${l[0]} ${l[1] ? 'ok' : 'FAIL'} (${String(l[2]).slice(0, 40)})`).join('; ')); assert.ok(passed >= 4, 'at least 4 of 5 real sites load: ' + JSON.stringify(loaded)); report.push(`${passed}/5 real sites load`);
  await sleep(1500); notes.push(`saved tabs after sites: ${await savedTabs()} / live ${(await app.state()).tabs.length}`); console.log(notes.at(-1));
  // 3. Sign-in form on a test site.
  await app.act({type: 'tab.new', url: base + '/'}); const login = await app.waitWeb(base + '/'); await sleep(700);
  await login.getByLabel('user').fill('alice'); await login.getByLabel('pass').fill('hunter2'); await login.getByRole('button', {name: 'Sign in'}).click();
  await poll(() => app.web(base + '/dashboard')?.title(), t => t === 'Dashboard alice', 'signed in'); report.push('sign-in form signs in and redirects');
  await sleep(1500); console.log('after login saved', await savedTabs(), 'live', (await app.state()).tabs.length);
  // 4. Download into a chosen folder, no Save dialog.
  await app.ui.evaluate(folder => window.acira.native({type: 'downloads.preferences.set', folder}), (await fs.mkdir(downloadsDir, {recursive: true}), downloadsDir));
  await app.act({type: 'tab.navigate', url: base + '/file', tabId: (await app.state()).tabs.find(t => t.url.startsWith(base + '/dashboard')).id});
  await poll(() => fs.readFile(path.join(downloadsDir, 'invoice.bin')).then(b => b.length === 80000, () => false), Boolean, 'download saved', 20000); report.push('download saves into the chosen folder');
  await sleep(1500); console.log('after download saved', await savedTabs(), 'live', (await app.state()).tabs.length);
  // 5. Permission prompt in the Acira popover; Allow is remembered.
  await app.act({type: 'tab.new', url: base + '/perm'}); const perm = await app.waitWeb(base + '/perm'); await sleep(600);
  const answer = perm.evaluate(() => Notification.requestPermission());
  const card = await poll(async () => { const p = cardPage(app); if (!p) return null; try { return (await p.locator('#card').isVisible()) ? p : null; } catch { return null; } }, Boolean, 'permission card', 15000);
  await poll(() => card.locator('#title').textContent(), t => /127\.0\.0\.1:\d+.*notifications/i.test(t), 'permission card names the site and the request'); await sleep(450); // the entrance has landed
  await card.screenshot({path: 'qa/artifacts/d-e2e-permission.png'}); await card.locator('button.act', {hasText: /^Allow$/}).click(); assert.equal(await answer, 'granted'); report.push('permission card answered, choice stored');
  await app.act({type: 'tab.select', id: (await app.state()).tabs.find(t => t.url.startsWith(base + '/file') || t.url.startsWith(base + '/dashboard')).id}); await sleep(3500);
  { const {DatabaseSync} = await import('node:sqlite'); const db = new DatabaseSync(path.join(path.resolve(root), 'browser.sqlite'), {readOnly: true}); const rows = db.prepare('select id from windows').all(); const saved = JSON.parse(db.prepare("select payload from windows where id='main'").get()?.payload || '{}'); notes.push('before kill: windows ' + JSON.stringify(rows) + ' tabs ' + (saved.tabs || []).length + ' tabs; last: ' + (saved.tabs || []).slice(-3).map(t => t.url.slice(0, 40)).join(' | ') + '; live ' + (await app.state()).tabs.map(t => t.url.slice(-12)).join(' | ')); db.close(); console.log(notes.at(-1)); console.log('main log:', app.logs.join('').split(String.fromCharCode(10)).filter(l => /State save|rror|Warn/i.test(l)).slice(-8).join(' || ').slice(0, 1200)); }
  await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']); // force-kill: no quit handlers
} catch (error) { try { await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']); } catch {} throw error; }
await sleep(2000);
// 6. Restore.
app = await startApp({root, skipSetup: false, env: {ACIRA_TEST_APP_DIALOG: '1'}});
try {
  await sleep(2500);
  assert.equal(await app.ui.locator('.setup-dialog').count(), 0, 'onboarding must not repeat'); report.push('onboarding does not repeat after a kill');
  let s = await app.state(); const urls = s.tabs.map(t => t.url);
  for (const wanted of ['example.com', 'wikipedia.org', 'mozilla.org', base + '/perm']) assert.ok(urls.some(u => u.includes(wanted)), `${wanted} restored in ${urls.join(' ')}`);
  assert.ok(s.bookmarkNodes.some(b => b.title === 'Imported one')); report.push('tabs and imported bookmarks restored');
  const cookies = await app.main(async ({session}) => (await session.fromPartition('persist:acira-browser-personal').cookies.get({})).map(c => c.name + '=' + c.value));
  assert.ok(cookies.includes('sid=alice') && cookies.includes(token + '=1'), JSON.stringify(cookies)); report.push('sign-in cookies survive the kill');
  await app.act({type: 'tab.new', url: base + '/dashboard'}); const dash = await app.waitWeb(base + '/dashboard'); assert.equal(await poll(() => dash.title(), t => /Dashboard/.test(t), 'dash'), 'Dashboard alice'); report.push('still signed in after restore');
  assert.ok(s.downloads.some(d => d.name === 'invoice.bin' && d.status === 'Ready')); report.push('download record restored');
  assert.equal(await dash.evaluate(() => Notification.permission), 'granted'); report.push('remembered permission survives the kill');
  // 7. Profile B isolation.
  await app.act({type: 'browser.profile.create', name: 'Work'}); const B = (await app.state()).browserProfiles.find(p => p.name === 'Work');
  await app.act({type: 'tab.new', url: base + '/dashboard', browserProfileId: B.id}); const bPage = await poll(() => app.context.pages().filter(p => p.url() === base + '/dashboard')[1], Boolean, 'B tab', 15000);
  assert.equal(await poll(() => bPage.title(), t => /Dashboard/.test(t), 'B dash'), 'Dashboard signed-out'); assert.notEqual(await bPage.evaluate(() => Notification.permission), 'granted'); report.push('profile B is signed out and has no permissions from A');
  // 8. Private window: signed out, nothing left behind.
  await app.ui.evaluate(() => window.acira.openWindow('private'));
  const privUi = await poll(() => app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html')[1], Boolean, 'private window'); await poll(() => privUi.evaluate(() => Boolean(window.acira?.dispatch)), Boolean, 'private ui');
  await privUi.evaluate(url => window.acira.dispatch({type: 'tab.new', url}), base + '/dashboard?private=1'); const priv = await poll(() => app.context.pages().find(p => p.url().includes('private=1')), Boolean, 'private page');
  assert.equal(await poll(() => priv.title(), t => /Dashboard/.test(t), 'priv dash'), 'Dashboard signed-out'); report.push('private window is signed out');
  await privUi.evaluate(() => window.acira.windowControl('close')); await sleep(2500);
  assert.ok(!(await app.state()).browserProfiles.some(p => p.private)); assert.ok(!JSON.stringify(await app.state()).includes('private=1')); report.push('private window leaves no profile or history');
} finally {
  // Quitting a window with several tabs asks "Close Acira?" (R4-36): turn that question off in this disposable profile, bound the close, and end a stuck quit (the process is this script's own).
  try { await app.act({type: 'settings.update', patch: {askBeforeClosing: false}}); } catch {}
  const child = (() => { try { return app.app.process(); } catch { return null; } })();
  try { await Promise.race([app.close(), sleep(15000)]); } catch {}
  try { if (child && child.exitCode === null) child.kill(); } catch {}
  await fx.close();
}
const stale = []; for (const f of await walk(path.resolve(root))) { if (/preview-build|DevToolsActivePort|processes\.json|\.png$/.test(f)) continue; try { if ((await fs.readFile(f)).includes('private=1')) stale.push(path.relative(path.resolve(root), f)); } catch {} }
assert.deepEqual(stale, [], 'private URL found in ' + stale.join(', ')); report.push('no private URL in any profile file');
console.log(JSON.stringify({ok: true, report, notes}, null, 1));
