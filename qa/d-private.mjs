// Stream D: private windows are ephemeral (no residue in profile files, normal sessions or restart state).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-private'; await fs.rm(root, {recursive: true, force: true});
const token = 'PRIVTOKEN' + Math.random().toString(36).slice(2, 10);
const fx = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/p/')) res.setHeader('Set-Cookie', [`${token}=1; Path=/; Max-Age=86400`, `${token}s=1; Path=/`]);
  if (!req.url.startsWith('/p/')) { res.end('<!doctype html><title>normal page ck=</title><script>document.title="normal ck="+document.cookie</script>'); return; }
  res.end(`<!doctype html><title>${token} page</title><script>localStorage.setItem("${token}","1");indexedDB.open("${token}");caches?.open("${token}");document.title="${token} ck="+document.cookie</script>`);
});
const base = `http://127.0.0.1:${fx.port}`;
const walk = async dir => { const out = []; for (const e of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...await walk(p)); else out.push(p); } return out; };
const leaks = async () => { const found = []; for (const f of await walk(path.resolve(root))) { if (/DevToolsActivePort|preview-build|processes\.json/.test(f)) continue; try { const b = await fs.readFile(f); if (b.includes(token)) found.push(path.relative(path.resolve(root), f)); } catch {} } return found; };
let app = await startApp({root}); const report = [];
try {
  const before = new Set(app.context.pages().map(p => p.url()));
  await app.ui.evaluate(() => window.acira.openWindow('private'));
  const privUi = await poll(() => app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html')[1], Boolean, 'private window ui');
  await poll(() => privUi.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'private api');
  let ps = await privUi.evaluate(() => window.acira.getSnapshot());
  assert.ok(ps.browserProfiles.some(p => p.private), 'private profile present in private window'); report.push('private profile exists');
  const normal = await app.state(); assert.ok(!normal.browserProfiles.some(p => p.private), 'normal window must not list private profile'); report.push('normal window unaware of private profile');
  await privUi.evaluate(url => window.acira.dispatch({type: 'tab.new', url}), `${base}/p/${token}`);
  const page = await poll(() => app.web(`${base}/p/`), Boolean, 'private page');
  await poll(() => page.title(), t => t.includes('ck=' + token), 'private cookie set');
  report.push('private page ran with cookie+storage');
  // A normal-profile tab to the same origin must not see private cookie.
  await app.act({type: 'tab.new', url: base + '/n'});
  const normalPage = await poll(() => app.context.pages().find(p => p.url() === base + '/n'), Boolean, 'normal page');
  await poll(() => normalPage.title(), t => t.startsWith('normal ck='), 'normal page loaded');
  assert.ok(!(await normalPage.title()).includes('ck=' + token + '=1'), 'normal must not receive private cookie'); report.push('normal session does not see private cookie');
  const ns = await app.state(); assert.ok(!JSON.stringify(ns).includes(token + '/p'), 'normal snapshot has no private url'); report.push('normal snapshot has no private url/history');
  // Close the private window; wait for retirement.
  await privUi.evaluate(() => window.acira.windowControl('close'));
  await poll(() => app.context.pages().filter(p => p.url() === 'acira-browser-ui://ui/index.html').length, n => n === 1, 'private window closed');
  await sleep(2500);
  const ns2 = await app.state(); assert.ok(!JSON.stringify(ns2).includes(token + '/p')); report.push('closed private window leaves no state');
} finally { await app.close(); await fx.close(); }
await sleep(1500);
const found = await leaks(); assert.deepEqual(found, [], 'private token found in: ' + found.join(', ')); report.push('no private token in any profile file after shutdown');
app = await startApp({root});
try { const s = await app.state(); assert.ok(!JSON.stringify(s).includes(token)); assert.ok(!s.browserProfiles.some(p => p.private)); report.push('restart: no private tabs/profile/history restored'); } finally { await app.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
