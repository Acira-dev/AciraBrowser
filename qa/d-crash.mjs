// Stream D: forced kill (no clean shutdown) must restore tabs, groups, pins and sign-ins.
// Usage: node qa/d-crash.mjs [secondsBetweenSignInAndKill=2]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-crash'; await fs.rm(root, {recursive: true, force: true});
const wait = Number(process.argv[2] || 3) * 1000;
const fx = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/signin')) res.setHeader('Set-Cookie', ['sid=persist1; Path=/; Max-Age=86400', 'sess=session1; Path=/']);
  res.end(`<title>${req.url}</title><script>localStorage.setItem("draft","kept");document.title=location.pathname+" ck="+document.cookie+" ls="+localStorage.getItem("draft")</script>`);
});
const base = `http://127.0.0.1:${fx.port}`, report = [];
let app = await startApp({root});
const pid = await app.main(() => process.pid);
try {
  await app.act({type: 'tab.new', url: base + '/signin'}); await poll(() => app.web(base + '/signin')?.title(), t => /sid=persist1/.test(t), 'signed in');
  for (const p of ['/t1', '/t2', '/t3']) { await app.act({type: 'tab.new', url: base + p}); await app.waitWeb(base + p); }
  let s = await app.state(); const [t1, t2, t3] = ['/t1', '/t2', '/t3'].map(p => s.tabs.find(t => t.url === base + p));
  await app.act({type: 'tab.group.create', tabId: t1.id, name: 'Research'}); s = await app.state(); const group = s.tabGroups[0]; await app.act({type: 'tab.group.assign', tabIds: [t1.id, t2.id], groupId: group.id});
  await app.act({type: 'tab.pin', id: t3.id}); await app.act({type: 'tab.select', id: t2.id});
  await sleep(wait);
  await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']); // hard kill: no quit handlers run
} catch (error) { try { await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']); } catch {} throw error; }
await sleep(2000);
app = await startApp({root});
try {
  const s = await app.state(); const has = p => s.tabs.some(t => t.url === base + p);
  assert.ok(['/signin', '/t1', '/t2', '/t3'].every(has), 'tabs restored: ' + JSON.stringify(s.tabs.map(t => t.url))); report.push('all tabs restored after kill');
  assert.equal(s.tabGroups.length, 1); assert.equal(s.tabGroups[0].name, 'Research'); assert.equal(s.tabs.filter(t => t.group === s.tabGroups[0].name).length, 2); report.push('group restored with its tabs');
  assert.equal(s.tabs.find(t => t.url === base + '/t3').pinned, true); report.push('pin restored');
  assert.equal(s.tabs.find(t => t.id === s.activeTabId).url, base + '/t2'); report.push('active tab restored');
  const cookies = await app.main(async ({session}) => (await session.fromPartition('persist:acira-browser-personal').cookies.get({})).map(c => c.name + '=' + c.value));
  const out = {persistentCookie: cookies.includes('sid=persist1'), sessionCookie: cookies.includes('sess=session1')};
  console.log(JSON.stringify({waitSeconds: wait / 1000, ...out}));
  await app.act({type: 'tab.select', id: s.tabs.find(t => t.url === base + '/signin').id}); await sleep(1500);
  const title = await app.web(base + '/signin')?.title(); out.localStorage = /ls=kept/.test(title || '');
  console.log(JSON.stringify({...out, title}));
  assert.ok(out.persistentCookie, 'persistent sign-in cookie lost after kill (waited ' + wait / 1000 + 's)'); report.push('persistent sign-in cookie survives kill');
  assert.ok(out.sessionCookie, 'session cookie lost after kill'); report.push('session cookie survives kill');
  assert.ok(out.localStorage, 'localStorage lost after kill'); report.push('localStorage survives kill');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
