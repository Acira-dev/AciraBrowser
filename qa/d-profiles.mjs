// Stream D: profile create/rename/remove, A/B partition isolation, sign-in persistence across restart.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-profiles'; await fs.rm(root, {recursive: true, force: true});
const hits = [];
const fx = await httpFixture((req, res) => {
  hits.push({url: req.url, cookie: req.headers.cookie || ''});
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/signin')) res.setHeader('Set-Cookie', ['sid=' + new URL(req.url, 'http://x').searchParams.get('who') + '; Path=/; Max-Age=86400', 'sess=1; Path=/']);
  res.end('<!doctype html><title>fx</title><script>localStorage.setItem("k",localStorage.getItem("k")||"v"+Math.random().toString(36).slice(2,6));document.title="ls="+localStorage.getItem("k")+" ck="+document.cookie</script>');
});
const base = `http://127.0.0.1:${fx.port}`;
const cookiesOf = (app, partition) => app.main(async ({session}, partition) => (await session.fromPartition(partition).cookies.get({})).map(c => c.name + '=' + c.value), partition);
let app = await startApp({root}); const report = []; let removedPartition;
try {
  // Profile A (Personal) signs in.
  await app.act({type: 'tab.new', url: base + '/signin?who=alice'});
  await poll(() => app.web(base)?.title(), t => /ck=sid=alice/.test(t), 'A signed in');
  await app.act({type: 'browser.profile.create', name: 'Work'});
  let s = await app.state(); const B = s.browserProfiles.find(p => p.name === 'Work'); assert.ok(B);
  // Rename + colour.
  await app.act({type: 'browser.profile.rename', id: B.id, name: '  Client work  ', color: '#336699'});
  s = await app.state(); const renamed = s.browserProfiles.find(p => p.id === B.id); assert.equal(renamed.name, 'Client work'); assert.equal(renamed.color, '#336699'); report.push('rename');
  await assert.rejects(app.act({type: 'browser.profile.rename', id: B.id, name: '   '}), /nonempty/); s = await app.state(); assert.equal(s.browserProfiles.find(p => p.id === B.id).name, 'Client work'); report.push('empty rename rejected');
  // Profile B tab: no A cookie / storage.
  await app.act({type: 'tab.new', url: base + '/', browserProfileId: B.id});
  const bPage = await poll(() => app.context.pages().filter(p => p.url().startsWith(base))[1], Boolean, 'B page');
  await poll(() => bPage.title(), t => /ls=v/.test(t), 'B loaded'); assert.equal(await bPage.title().then(t => /ck=sid/.test(t)), false); report.push('B sees no A cookie');
  assert.equal(hits.filter(h => h.url === '/').at(-1).cookie, ''); report.push('B request carried no cookie');
  await app.act({type: 'tab.new', url: base + '/signin?who=bob', browserProfileId: B.id});
  await poll(() => cookiesOf(app, B.partition), c => c.includes('sid=bob'), 'B cookie');
  assert.ok(!(await cookiesOf(app, 'persist:acira-browser-personal')).includes('sid=bob')); report.push('A does not see B cookie');
  // Window restore keeps both; close and relaunch -> A cookie persists (Max-Age) without any request.
  await app.act({type: 'browser.profile.select', id: 'profile-personal'}); await sleep(500);
  // Removing a profile from its own window closes that window and keeps the browser running.
  await app.act({type: 'browser.profile.create', name: 'Temp'}); const T = (await app.state()).browserProfiles.find(p => p.name === 'Temp');
  const uiCount = () => app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html').length;
  const windowsBefore = uiCount(); await app.act({type: 'browser.profile.select', id: T.id}); await poll(uiCount, n => n === windowsBefore + 1, 'profile window opens');
  const tempUi = await poll(async () => { for (const p of app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html')) { try { if ((await p.evaluate(() => window.acira.getSnapshot())).activeBrowserProfileId === T.id) return p; } catch {} } }, Boolean, 'temp window ui');
  await tempUi.evaluate(id => window.acira.dispatch({type: 'browser.profile.remove', id}), T.id).catch(() => {}); await poll(uiCount, n => n === windowsBefore, 'profile window closes after removal').catch(async e => { console.log(JSON.stringify(await app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => [w.id, w.getTitle(), w.isVisible()])))); console.log(app.context.pages().map(p => p.url().slice(0, 60))); throw e; });
  s = await app.state(); assert.ok(!s.browserProfiles.some(p => p.id === T.id)); report.push('removing a profile from its own window closes that window');
} finally { await app.close(); }
await sleep(1500);
app = await startApp({root});
try {
  let s = await app.state(); assert.ok(s.browserProfiles.some(p => p.name === 'Client work')); report.push('profiles persisted');
  const personal = await cookiesOf(app, 'persist:acira-browser-personal'); assert.ok(personal.includes('sid=alice'), JSON.stringify(personal)); report.push('persistent sign-in cookie survives restart'); assert.ok(personal.includes('sess=1'), 'session cookie: '+JSON.stringify(personal)); report.push('session cookie restored after restart');
  const B = s.browserProfiles.find(p => p.name === 'Client work');
  assert.ok((await cookiesOf(app, B.partition)).includes('sid=bob')); report.push('B cookie survives restart');
  // Remove B: tabs, records, storage gone.
  s = await app.state(); const before = s.tabs.length;
  const folderOf = () => fs.readdir(path.join(path.resolve(root), 'Partitions')).then(list => list.filter(n => n.toLowerCase() === B.partition.replace(/^persist:/, '').toLowerCase()), () => []);
  assert.equal((await folderOf()).length, 1, 'partition folder exists before removal');
  const removed = (await app.ui.evaluate(id => window.acira.native({type: 'profiles.remove', id}), B.id)).profiles; assert.equal(removed.ok, true, JSON.stringify(removed)); assert.deepEqual(removed.failures, []);
  assert.ok(removed.folderPending || (await folderOf()).length === 0); removedPartition = B.partition; report.push('native profiles.remove returns ok (' + (removed.folderPending ? 'partition folder finishes at next start' : 'partition folder deleted') + ')');
  s = await poll(() => app.state(), st => !st.browserProfiles.some(p => p.id === B.id), 'profile removed');
  assert.ok(s.tabs.every(t => t.browserProfileId !== B.id)); assert.equal(s.browserProfiles.length, 1);
  assert.deepEqual(await poll(() => cookiesOf(app, B.partition), c => c.length === 0, 'B storage wiped'), []); report.push('remove wipes cookies/tabs/profile');
  // Last profile cannot be removed.
  const refused = (await app.ui.evaluate(() => window.acira.native({type: 'profiles.remove', id: 'profile-personal'}))).profiles; assert.deepEqual([refused.ok, refused.reason], [false, 'last-profile']);
  const privateRefused = (await app.ui.evaluate(() => window.acira.native({type: 'profiles.remove', id: 'private-x'}))).profiles; assert.equal(privateRefused.ok, false);
  await app.act({type: 'browser.profile.update', id: 'profile-personal', color: '#336699', avatar: '\u{1F680}'}); s = await app.state(); assert.deepEqual([s.browserProfiles[0].color, s.browserProfiles[0].avatar], ['#336699', '\u{1F680}']); report.push('profile update (colour + avatar)');
  s = await app.state(); assert.ok(s.browserProfiles.some(p => p.id === 'profile-personal')); report.push('last profile protected');
  // Bulk tab close respects pins.
  for (const n of [1, 2, 3, 4]) await app.act({type: 'tab.new', url: `acira://settings`}); s = await app.state();
  const ids = s.tabs.map(t => t.id); await app.act({type: 'tab.pin', id: ids[0]}); s = await app.state(); const anchor = s.tabs[3].id;
  await app.act({type: 'tab.close.right', id: anchor}); s = await poll(() => app.state(), st => st.tabs.length <= 4, 'close right'); assert.ok(s.tabs.some(t => t.pinned)); assert.equal(s.tabs.at(-1).id, anchor); report.push('close right');
  await app.act({type: 'tab.close.others', id: anchor}); s = await poll(() => app.state(), st => st.tabs.filter(t => !t.pinned).length === 1, 'close others'); assert.ok(s.tabs.some(t => t.id === anchor)); assert.ok(s.tabs.some(t => t.pinned)); report.push('close others keeps pinned + anchor');
} finally { await app.close(); await fx.close(); }
await sleep(1500);
app = await startApp({root});
try { const s = await app.state(); assert.ok(!s.browserProfiles.some(p => p.name === 'Client work')); report.push('removal persists across restart');
  const left = (await fs.readdir(path.join(path.resolve(root), 'Partitions')).catch(() => [])).filter(n => n.toLowerCase() === removedPartition.replace(/^persist:/, '').toLowerCase()); assert.deepEqual(left, [], 'removed partition folder is gone after the next start'); report.push('removed profile folder is gone after restart'); } finally { await app.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
