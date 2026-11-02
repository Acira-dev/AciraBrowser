// Round 10 behaviour probe: odd address-bar input, close-while-loading, view leaks after 20 tabs, renderer crash, broken certificate, racing closes.
//   node qa/native-slot.mjs r10-behaviour -- node qa/r10-behaviour-probe.mjs
// Prints one line per check; nothing is asserted so a single run lists every finding. Isolated profile, hidden window, local fixtures only.
import fs from 'node:fs/promises';
import {startApp, httpFixture, httpsFixture, sleep, poll} from './d-harness.mjs';

const root = '.qa-profiles/r10-behaviour'; await fs.rm(root, {recursive: true, force: true});
const held = new Set();
const fx = await httpFixture((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p === '/hang') { held.add(res); res.writeHead(200, {'content-type': 'text/html'}); res.write('<title>hang</title><p>start</p>'); return; }
  if (p === '/never') { held.add(res); return; }
  res.setHeader('content-type', 'text/html'); res.end(`<title>${p}</title><p>${p}</p>`);
});
const tls = await httpsFixture(root, (req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>tls</title>tls'); });
const base = `http://127.0.0.1:${fx.port}`;
const out = (k, v) => console.log(k.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));
const app = await startApp({root});
const wcCount = () => app.main(({webContents}) => webContents.getAllWebContents().filter(c => !c.isDestroyed()).length);
const tabs = async () => (await app.state()).tabs;
const stateTabIds = async () => (await tabs()).map(t => t.id);
try {
  const first = (await tabs())[0]; out('tab fields', Object.keys(first || {}).join(','));
  const baseline = await wcCount(); out('webContents baseline', baseline);

  // A. odd input through the same action the address bar dispatches
  const odd = ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///C:/Windows/win.ini', 'chrome://gpu', 'about:blank', 'view-source:' + base + '/', 'ftp://127.0.0.1/', 'blob:http://x/1', 'acira://nope', 'acira://settings', '', '   ', 'http://', 'http://[', 'http://a b/', '\u202Ehttp://evil.test/', base + '/' + 'a'.repeat(60000), 'http://127.0.0.1:1/', tls.port ? `https://127.0.0.1:${tls.port}/` : ''];
  for (const url of odd) {
    const before = (await tabs()).length; let err = '';
    try { await app.act({type: 'tab.new', url}); } catch (e) { err = String(e.message).slice(0, 80); }
    await sleep(900);
    const t = await tabs(); const added = t.length - before; const last = t[t.length - 1];
    out('tab.new ' + JSON.stringify(url.slice(0, 40)), {added, err, url: last?.url?.slice(0, 60), title: String(last?.title).slice(0, 40), loading: last?.loading, error: last?.error ?? last?.failure});
    // close all but the first so counts stay bounded
    for (const x of (await tabs()).slice(1)) await app.act({type: 'tab.close', id: x.id}).catch(() => {});
    await sleep(150);
  }

  // B. close while loading
  await app.act({type: 'tab.new', url: base + '/never'}); await sleep(200);
  let id = (await stateTabIds()).at(-1); await app.act({type: 'tab.close', id}); await sleep(500);
  out('close while /never loads', {tabs: (await tabs()).length, wc: await wcCount()});
  await app.act({type: 'tab.new', url: base + '/hang'}); await sleep(600);
  id = (await stateTabIds()).at(-1); await app.act({type: 'tab.close', id}); await sleep(500);
  out('close while /hang streams', {tabs: (await tabs()).length, wc: await wcCount()});

  // C. 20 tabs open and close; compare counts
  for (let i = 0; i < 20; i++) await app.act({type: 'tab.new', url: base + '/p' + i});
  await sleep(2500); out('20 tabs open', {tabs: (await tabs()).length, wc: await wcCount()});
  for (const x of (await tabs()).slice(1)) await app.act({type: 'tab.close', id: x.id}).catch(() => {});
  await sleep(2500); out('after closing them', {tabs: (await tabs()).length, wc: await wcCount(), baseline});

  // D. racing: close the same tab twice at once, open two at once
  await app.act({type: 'tab.new', url: base + '/race'}); await sleep(500); id = (await stateTabIds()).at(-1);
  const r = await Promise.allSettled([app.act({type: 'tab.close', id}), app.act({type: 'tab.close', id})]);
  out('double close same tab', {settled: r.map(x => x.status + (x.reason ? ':' + String(x.reason.message).slice(0, 60) : '')), tabs: (await tabs()).length});
  const r2 = await Promise.allSettled([app.act({type: 'tab.new', url: base + '/a'}), app.act({type: 'tab.new', url: base + '/b'})]); await sleep(800);
  out('two tab.new at once', {settled: r2.map(x => x.status), tabs: (await tabs()).length});

  // E. renderer crash then reload
  await app.act({type: 'tab.new', url: base + '/crashme'}); await sleep(900);
  const crashed = await app.main(({webContents}) => { const c = webContents.getAllWebContents().find(w => !w.isDestroyed() && w.getURL().endsWith('/crashme')); if (!c) return false; c.forcefullyCrashRenderer(); return true; });
  await sleep(1500); const ct = (await tabs()).at(-1);
  out('after renderer crash', {crashed, url: ct?.url, title: ct?.title, loading: ct?.loading, crashedFlag: ct?.crashed, keys: Object.keys(ct || {}).join(',').slice(0, 200)});
  await app.act({type: 'tab.reload', id: ct.id}).catch(e => out('reload action', String(e.message).slice(0, 80))); await sleep(1500);
  out('after reload', await app.main(({webContents}) => webContents.getAllWebContents().filter(w => !w.isDestroyed()).map(w => w.getURL().slice(0, 50) + (w.isCrashed() ? ' CRASHED' : '')).filter(u => /crashme/.test(u))));
} finally {
  for (const r of held) try { r.destroy(); } catch {}
  await app.close(); await fx.close(); await tls.close();
}
