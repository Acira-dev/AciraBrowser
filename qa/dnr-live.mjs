// declarativeNetRequest enforcement on the real app, with uBlock Origin Lite, Privacy Badger and Tampermonkey installed from the store into an
// isolated test profile (qa/extension-matrix/recheck.mjs MODE=install PROFILE=<p> SLUGS=ublock-lite,privacy-badger,tampermonkey).
//   cd <short real-path checkout>; PROFILE=r/dnr CERT=<dir with key.pem cert.pem> OUT=<dir> node qa/dnr-live.mjs
// A local HTTPS fixture answers for site.dnr.test and for real ad / tracker hosts (host-resolver-rules map them to 127.0.0.1), so a request that
// reaches the fixture was NOT blocked. Acira's own blocking is switched off for the fixture site, so anything blocked there is an extension's
// rule. Control: the same page with the extensions' rules bypassed (test-only, in this app instance) shows those requests do reach the fixture.
// Then: Privacy Badger's DNT / Sec-GPC request headers, and a .user.js address in Tampermonkey. Never signs in, never types credentials.
// Takes a native slot (C:\ae\slot-N.lock, flag wx), one Electron, try/finally, hard cap 8 minutes.
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import {startApp, sleep, poll} from './d-harness.mjs';

const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const PROFILE = process.env.PROFILE || 'r/dnr', OUT = path.resolve(process.env.OUT || `qa/artifacts/dnr-live/${Date.now()}`), CERT = process.env.CERT;
if (!CERT) throw Error('CERT=<dir with key.pem and cert.pem>');
await fs.mkdir(OUT, {recursive: true});
const IDS = {ublock: 'ddkjiahejlhfcafbddmgiahcphecmpfh', badger: 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp', tampermonkey: 'dhdgffkkebhmkfjojejmpbldmpobfkfo'};
// Ad / tracker hosts: the first four are on uBlock Origin Lite's default lists; the last three are in Privacy Badger's tracker list (learned
// trackers it blocks from its first run).
const AD_HOSTS = ['securepubads.g.doubleclick.net', 'pagead2.googlesyndication.com', 'www.google-analytics.com', 'static.ads-twitter.com', 'ib.360yield.com', 'tlx.3lift.com', 'cdn.33across.com'];
const CONTROL = 'cdn.dnr.test';
const hits = [];
const server = https.createServer({key: await fs.readFile(path.join(CERT, 'key.pem')), cert: await fs.readFile(path.join(CERT, 'cert.pem'))}, (req, res) => {
  const host = (req.headers.host || '').split(':')[0], url = req.url;
  hits.push({host, url, dnt: req.headers.dnt ?? null, gpc: req.headers['sec-gpc'] ?? null, time: Date.now()});
  if (url.startsWith('/page')) {
    res.setHeader('Content-Type', 'text/html');
    // The control is a plain first-party script path no list targets (a /pixel.gif? path on any host is itself an EasyPrivacy match).
    const port = server.address().port, items = [...AD_HOSTS.map((h, i) => ({id: 'r' + i, host: h, src: `https://${h}:${port}/${i % 2 ? 'pixel.gif' : 'lib.js'}?n=${i}`})), {id: 'control', host: CONTROL, src: `https://${CONTROL}:${port}/assets/app.js`}];
    res.end(`<!doctype html><meta charset=utf-8><title>DNR fixture</title><style>body{font:14px system-ui;margin:24px}td{padding:2px 10px}.blocked{color:#b00}.loaded{color:#070}</style>
<h1>declarativeNetRequest fixture</h1><table id=t>${items.map(it => `<tr><td>${it.host}</td><td id=${it.id}>…</td></tr>`).join('')}</table>
<script>window.results={};const items=${JSON.stringify(items)};for(const it of items){const ok=v=>{window.results[it.host]=v;const td=document.getElementById(it.id);td.textContent=v;td.className=v;};
const el=it.src.includes('.gif')?new Image():document.createElement('script');el.onload=()=>ok('loaded');el.onerror=()=>ok('blocked');el.src=it.src;if(el.tagName==='SCRIPT')document.head.appendChild(el);}</script>`);
    return;
  }
  if (url.startsWith('/many')) {
    // 400 subresources with varied paths on the fixture, ad and tracker hosts: a sample for the matcher's per-request cost in the app.
    res.setHeader('Content-Type', 'text/html'); const port = server.address().port, words = ['static', 'js', 'img', 'api', 'ads', 'banner', 'track', 'pixel', 'analytics', 'cdn', 'v2', 'bundle', 'widget', 'prebid', 'gpt'];
    let html = '<!doctype html><title>many</title>'; for (let i = 0; i < 400; i++) { const h = i % 3 ? 'cdn.dnr.test' : AD_HOSTS[i % AD_HOSTS.length]; html += `<img src="https://${h}:${port}/${words[i % words.length]}/${words[(i * 7) % words.length]}${i}.gif?id=${i * 7919}" width=1 height=1>`; }
    res.end(html + '<script>window.done=true</script>'); return;
  }
  if (url.endsWith('.user.js')) { res.setHeader('Content-Type', 'text/javascript'); res.end('// ==UserScript==\n// @name DNR fixture script\n// @match https://site.dnr.test/*\n// ==/UserScript==\nconsole.log("hi");\n'); return; }
  if (url.includes('.gif')) { res.setHeader('Content-Type', 'image/gif'); res.end(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')); return; }
  res.setHeader('Content-Type', 'text/javascript'); res.end('void 0');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const resolver = '--host-resolver-rules=' + ['*.dnr.test', ...AD_HOSTS].map(h => `MAP ${h} 127.0.0.1`).join(', ');

let slot, app; const report = {profile: PROFILE, port, adHosts: AD_HOSTS};
const deadline = setTimeout(() => { console.error('hard cap reached'); process.exit(2); }, 8 * 60 * 1000);
try {
  for (let i = 0; i < 40 && !slot; i++) { for (const n of [1, 2, 3]) { const f = `C:\\ae\\slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`dnr-live ${new Date().toISOString()}`); await h.close(); slot = f; break; } catch {} } if (!slot) await sleep(30000); }
  if (!slot) throw Error('no native slot');
  log('slot', slot);
  app = await startApp({root: path.join('.qa-profiles', PROFILE), args: [resolver], env: {ACIRA_DEV: '0'}});
  report.extensions = await app.main(async ({session}, {hosts}) => {
    const ses = session.fromPartition('persist:acira-browser-personal');
    ses.setCertificateVerifyProc((request, callback) => callback(request.hostname.endsWith('.dnr.test') || hosts.includes(request.hostname) ? 0 : -3));
    const list = ses.extensions.getAllExtensions().map(e => ({id: e.id, name: e.name, version: e.version}));
    let host = null; for (let i = 0; i < 100 && !host; i++) { host = ses[Symbol.for('acira.dnr-host-v1')] || null; if (!host) await new Promise(r => setTimeout(r, 100)); }
    if (!host) return {list, host: false};
    await host.whenLoaded();
    return {list, host: true, timings: host.timings(), engine: host.engine.stats(), memory: process.memoryUsage()};
  }, {hosts: AD_HOSTS});
  log('extensions', JSON.stringify(report.extensions).slice(0, 600));

  const pageUrl = `https://site.dnr.test:${port}/page`;
  const open = async url => { await app.act({type: 'tab.navigate', url}); return poll(() => app.web(u => u.startsWith(url.split('?')[0])), Boolean, 'page ' + url, 20000); };
  const results = async page => { await poll(() => page.evaluate(n => Object.keys(window.results || {}).length >= n, AD_HOSTS.length + 1).catch(() => false), Boolean, 'fixture results', 15000); return page.evaluate(() => window.results); };
  let page = await open(pageUrl); await page.waitForLoadState('domcontentloaded');
  const state = await app.state(); const tabId = state.activeTabId;
  await app.svc({type: 'privacy.set', tabId, blocking: false, scope: 'site'});
  report.protection = await app.svc({type: 'privacy.status', tabId}).catch(e => String(e));
  // 1) Acira's protection off for this site, extensions on.
  hits.length = 0; await page.reload(); page = await poll(() => app.web(u => u.startsWith(pageUrl)), Boolean, 'reloaded');
  report.extensionsOn = {page: await results(page), reachedServer: [...new Set(hits.filter(h => h.url !== '/page').map(h => h.host))]};
  report.pageHeaders = hits.find(h => h.url === '/page') || null;
  try { await page.screenshot({path: path.join(OUT, 'fixture-protection-off-extensions-on.png')}); } catch (e) { report.screenshotError = String(e.message).slice(0, 200); }
  await sleep(600);
  // uBO Lite asks for the blocked count as its toolbar badge (setExtensionActionOptions); the badge text of the fixture tab:
  report.badges = await app.main(async ({session, webContents}, ids) => { const host = session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')]; const tab = webContents.getAllWebContents().find(w => { try { return w.getURL().includes('site.dnr.test') && w.getURL().includes('/page'); } catch { return false; } }); const out = {tabId: tab?.id ?? null}; for (const [name, id] of Object.entries(ids)) out[name] = tab ? await host.badgeText(id, tab.id) : null; return out; }, IDS);
  report.matched = await app.main(async ({session}, ids) => { const host = session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')]; const out = {}; for (const [name, id] of Object.entries(ids)) out[name] = host.engine.getMatchedRules(id).slice(-20); return out; }, IDS);
  // 2) Control: the same page with every extension rule bypassed in this app instance (test only).
  await app.main(({session}) => { const host = session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')]; host.__before = host.before; host.__send = host.sendHeaders; host.before = () => null; host.sendHeaders = () => null; });
  hits.length = 0; await page.reload(); page = await poll(() => app.web(u => u.startsWith(pageUrl)), Boolean, 'reloaded');
  report.control = {page: await results(page), reachedServer: [...new Set(hits.filter(h => h.url !== '/page').map(h => h.host))], pageHeaders: hits.find(h => h.url === '/page') || null};
  await app.main(({session}) => { const host = session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')]; host.before = host.__before; host.sendHeaders = host.__send; });
  // 3) Tampermonkey: a .user.js address should open its install page.
  const scriptUrl = `https://site.dnr.test:${port}/hello.user.js`;
  const sessionRuleCount = () => app.main(({session}, id) => session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')].engine.getRules(id, 'session').length, IDS.tampermonkey);
  for (let i = 0; i < 40 && !(await sessionRuleCount()); i++) await sleep(500);
  report.diagnostics = await app.main(({session}) => { const ses = session.fromPartition('persist:acira-browser-personal'), host = ses[Symbol.for('acira.dnr-host-v1')]; const fs = process.getBuiltinModule('node:fs'); return {updates: host.recentUpdates(), preloads: ses.getPreloadScripts().map(p => ({type: p.type, file: p.filePath.split(/[\\/]/).pop(), patched: /aciraSync/.test((() => { try { return fs.readFileSync(p.filePath, 'utf8'); } catch { return ''; } })())}))}; });
  await app.act({type: 'tab.navigate', url: scriptUrl});
  let landed = null; const seen = [];
  for (let i = 0; i < 60 && !landed; i++) { await sleep(250); const s = await app.state(); const tab = (s.tabs || []).find(t => t.id === s.activeTabId); const u = tab?.url || ''; if (u && seen[seen.length - 1] !== u) seen.push(u); if (u.startsWith('chrome-extension://')) landed = u; for (const p of app.context.pages()) { try { if (p.url().startsWith('chrome-extension://' + IDS.tampermonkey) && !/background|offscreen/.test(p.url())) landed = landed || p.url(); } catch {} } }
  report.tampermonkey = {opened: scriptUrl, landed, seen, sessionRules: await app.main(({session}, id) => { const host = session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')]; return host.engine.getRules(id, 'session').map(r => ({id: r.id, regexFilter: r.condition?.regexFilter, action: r.action?.redirect})).slice(0, 6); }, IDS.tampermonkey)};
  if (landed) { const tmPage = await poll(() => app.web(u => u.startsWith('chrome-extension://' + IDS.tampermonkey)), Boolean, 'tampermonkey page', 10000).catch(() => null); if (tmPage) { await sleep(1500); try { await tmPage.screenshot({path: path.join(OUT, 'tampermonkey-install-page.png')}); } catch {} report.tampermonkey.title = await tmPage.title().catch(() => null); } }
  // 4) Per-request matcher cost inside the app, over a page with 400 subresources.
  const cost = () => app.main(({session}) => session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')].requestCost());
  const loadMany = async n => { await app.act({type: 'tab.navigate', url: `https://site.dnr.test:${port}/many?${n}`}); const many = await poll(() => app.web(u => u.includes('/many?' + n)), Boolean, 'many page', 20000).catch(() => null); if (many) { await many.waitForLoadState('load').catch(() => {}); await sleep(1200); } };
  await loadMany(1); report.requestCostCold = await cost();
  await app.main(({session}) => session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')].resetRequestCost());
  for (let n = 2; n <= 4; n++) await loadMany(n);
  report.requestCostWarm = await cost();
  report.after = await app.main(({session}) => { const host = session.fromPartition('persist:acira-browser-personal')[Symbol.for('acira.dnr-host-v1')]; return {engine: host.engine.stats(), timings: host.timings(), memory: process.memoryUsage()}; });
} finally {
  clearTimeout(deadline);
  try { await app?.close(); } catch {}
  server.close();
  if (slot) await fs.rm(slot, {force: true});
  await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(report, null, 1));
  log('done', OUT);
}
