// Stream D: every window open at a crash or quit comes back with its tabs; a window closed on purpose does not.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-windows'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>${req.url}</title>x`); });
const base = `http://127.0.0.1:${fx.port}`, report = [];
const uiPages = app => app.context.pages().filter(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } });
const snapshots = async app => { const out = []; for (const page of uiPages(app)) { try { out.push(await page.evaluate(() => window.acira.getSnapshot())); } catch {} } return out; };
let app = await startApp({root});
const pid = await app.main(() => process.pid);
try {
  await app.act({type: 'tab.new', url: base + '/first'}); await app.waitWeb(base + '/first');
  await app.ui.evaluate(() => window.acira.openWindow('normal')); await poll(() => uiPages(app).length, n => n === 2, 'second window');
  const second = uiPages(app)[1]; await poll(() => second.evaluate(() => Boolean(window.acira?.dispatch)), Boolean, 'second ui');
  await second.getByRole('button', {name: 'Skip setup'}).click({timeout: 3000}).catch(() => {});
  await second.evaluate(url => window.acira.dispatch({type: 'tab.new', url}), base + '/second'); await app.waitWeb(base + '/second');
  await sleep(2500);
  await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']);
} catch (error) { try { await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F']); } catch {} throw error; }
await sleep(2000);
app = await startApp({root, skipSetup: false});
let pid2;
try {
  pid2 = await app.main(() => process.pid);
  await poll(() => uiPages(app).length, n => n === 2, 'both windows restored after a kill', 20000);
  const urls = (await snapshots(app)).flatMap(s => s.tabs.map(t => t.url)); assert.ok(urls.includes(base + '/first') && urls.includes(base + '/second'), JSON.stringify(urls)); report.push('both windows and their tabs restored after force-kill');
  // Close the second window on purpose, then quit: next start must have one window.
  const target = uiPages(app).at(-1); await target.evaluate(() => window.acira.windowControl('close')).catch(() => {});
  await poll(() => uiPages(app).length, n => n === 1, 'second window closed'); await sleep(1500);
} finally { await app.close(); }
await sleep(1500);
app = await startApp({root, skipSetup: false});
try { await sleep(2500); assert.equal(uiPages(app).length, 1, 'a window closed on purpose stays closed'); report.push('window closed on purpose is not resurrected'); } finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
