// P5 real-app check: chrome.webRequest and chrome.webNavigation events reach a real MV3 extension through Acira's request pipeline.
// A local HTTP fixture serves a page with a script, an image, a fetch, an iframe, a redirect, a pushState and a fragment change, a Basic-auth
// page, and a refused address. A test extension (webRequest, webNavigation, webRequestAuthProvider, <all_urls>) records every event in its
// service worker and posts them back to the fixture; onAuthRequired answers the challenge with test credentials (asyncBlocking).
// Isolated profile under .qa-profiles, one native slot (C:\ae\slot-N.lock), one Electron, hidden window, try/finally, hard cap 4 minutes.
//   node qa/p5-web-live.mjs            (after: node scripts/build-ui-preload.mjs && npx vite build && npm run build:runtime)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const t0 = Date.now(), log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);
const OUT = path.resolve(process.env.OUT || `qa/artifacts/p5-web-live/${Date.now()}`);
await fs.mkdir(OUT, {recursive: true});
const hard = setTimeout(() => { console.error('hard cap reached'); process.exit(2); }, 4 * 60 * 1000);
const reports = [], hits = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/report') { let body = ''; req.on('data', d => { body += d; }); req.on('end', () => { try { reports.push(...JSON.parse(body)); } catch {} res.setHeader('access-control-allow-origin', '*'); res.end('ok'); }); return; }
  hits.push({path: url.pathname, auth: req.headers.authorization || null, cookie: req.headers.cookie || null});
  const port = server.address().port;
  if (url.pathname === '/page') {
    res.setHeader('content-type', 'text/html'); res.setHeader('set-cookie', 'p5=1; Path=/');
    res.end(`<!doctype html><meta charset=utf-8><title>P5 page</title><h1>P5</h1><img src="/img.png"><script src="/asset.js"></script>
<iframe src="http://localhost:${port}/frame"></iframe>
<script>addEventListener('load',()=>{fetch('/api?x=1').then(r=>r.text()).then(()=>{history.pushState({},'', '/page/state');location.hash='part';document.title='P5 done';});});</script>`);
    return;
  }
  if (url.pathname === '/frame') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>frame</title><p>frame <img src="/frame.png">'); return; }
  if (url.pathname === '/redir') { res.statusCode = 302; res.setHeader('location', '/target'); res.end(); return; }
  if (url.pathname === '/auth') {
    if (req.headers.authorization === 'Basic ' + Buffer.from('p5user:p5pass').toString('base64')) { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>authed</title>ok'); return; }
    res.statusCode = 401; res.setHeader('www-authenticate', 'Basic realm="P5 realm"'); res.end('no'); return;
  }
  if (url.pathname.endsWith('.js')) { res.setHeader('content-type', 'text/javascript'); res.end('void 0'); return; }
  if (url.pathname.endsWith('.png')) { res.setHeader('content-type', 'image/png'); res.end(Buffer.from('89504e470d0a1a0a', 'hex')); return; }
  res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>t</title>t');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port, base = `http://127.0.0.1:${port}`;

// The test extension (written into the run's profile folder).
const root = path.resolve('.qa-profiles', 'p5' + Date.now().toString(36));
const extDir = path.join(root, 'p5-extension');
await fs.mkdir(extDir, {recursive: true});
await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify({manifest_version: 3, name: 'P5 web events', version: '1.0',
  permissions: ['webRequest', 'webNavigation', 'webRequestAuthProvider'], host_permissions: ['<all_urls>'], background: {service_worker: 'sw.js'}}));
await fs.writeFile(path.join(extDir, 'sw.js'), `
const BASE=${JSON.stringify(base)};const out=[];let timer=null;
const flush=()=>{timer=null;if(!out.length)return;const batch=out.splice(0);fetch(BASE+'/report',{method:'POST',body:JSON.stringify(batch)}).catch(()=>{});};
const note=(ns,e,d)=>{if(d&&typeof d.url==='string'&&d.url.includes('/report'))return;out.push({ns,e,d});if(!timer)timer=setTimeout(flush,300);};
const urls=['<all_urls>'];
for(const e of ['onBeforeRequest','onSendHeaders','onResponseStarted','onBeforeRedirect','onCompleted','onErrorOccurred'])chrome.webRequest[e].addListener(d=>note('wr',e,d),{urls},e==='onResponseStarted'||e==='onCompleted'?['responseHeaders']:e==='onSendHeaders'?['requestHeaders']:[]);
chrome.webRequest.onBeforeSendHeaders.addListener(d=>note('wr','onBeforeSendHeaders',d),{urls,types:['main_frame','sub_frame','xmlhttprequest']},['requestHeaders','extraHeaders']);
chrome.webRequest.onHeadersReceived.addListener(d=>note('wr','onHeadersReceived',d),{urls},['responseHeaders']);
chrome.webRequest.onAuthRequired.addListener((d,done)=>{note('wr','onAuthRequired',d);done({authCredentials:{username:'p5user',password:'p5pass'}});},{urls},['asyncBlocking']);
for(const e of ['onBeforeNavigate','onCommitted','onDOMContentLoaded','onCompleted','onErrorOccurred','onHistoryStateUpdated','onReferenceFragmentUpdated'])chrome.webNavigation[e].addListener(d=>{note('wn',e,d);if(e==='onCompleted'&&d.frameId===0&&d.url.includes('/page'))setTimeout(()=>chrome.webNavigation.getAllFrames({tabId:d.tabId}).then(frames=>{note('wn','getAllFrames',{url:d.url,frames});return chrome.webNavigation.getFrame({documentId:frames[frames.length-1].documentId});}).then(f=>note('wn','getFrame',{url:'x',frame:f})).catch(err=>note('wn','error',{url:'x',message:String(err)})),800);},{url:[{hostEquals:'127.0.0.1'},{hostEquals:'localhost'}]});
note('sw','started',{url:'x'});
`);

let slot = null, app = null;
const result = {base, ok: false, checks: {}};
try {
  for (let i = 0; i < 40 && !slot; i++) { for (const n of [1, 2, 3]) { const f = `C:\\ae\\slot-${n}.lock`; try { const h = await fs.open(f, 'wx'); await h.writeFile(`p5-web-live ${new Date().toISOString()}`); await h.close(); slot = f; break; } catch (e) { if (e.code !== 'EEXIST') throw e; } } if (!slot) { log('slots busy'); await sleep(15000); } }
  if (!slot) throw Error('no native slot');
  app = await startApp({root, env: {ACIRA_DEV: '0'}});
  log('app up');
  await app.main(({dialog}, folder) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]});
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
  }, extDir);
  const profileId = (await app.state()).activeBrowserProfileId;
  const loaded = await app.ui.evaluate(r => window.acira.extensions(r), {profileId, type: 'load'});
  const entry = (loaded.extensions || []).find(e => e.name === 'P5 web events');
  if (!entry) throw Error('extension did not load: ' + JSON.stringify(loaded).slice(0, 300));
  log('extension', entry.id);
  await poll(() => reports.some(r => r.ns === 'sw'), Boolean, 'worker started', 20000);
  const open = async url => { await app.act({type: 'tab.navigate', url}); };
  await open(base + '/page');
  await poll(() => reports.some(r => r.e === 'getFrame') && reports.some(r => r.e === 'onReferenceFragmentUpdated'), Boolean, 'page events', 30000).catch(() => null);
  await open(base + '/redir');
  await poll(() => reports.some(r => r.e === 'onCompleted' && r.ns === 'wr' && r.d.url.endsWith('/target')), Boolean, 'redirect', 15000).catch(() => null);
  await open(base + '/auth');
  await poll(() => hits.some(h => h.path === '/auth' && h.auth), Boolean, 'auth', 15000).catch(() => null);
  await open('http://127.0.0.1:1/refused');
  await poll(() => reports.some(r => r.ns === 'wn' && r.e === 'onErrorOccurred'), Boolean, 'navigation error', 15000).catch(() => null);
  await sleep(800);
  result.listeners = await app.main(({session}, partition) => session.fromPartition(partition)[Symbol.for('acira.web-request-host-v1')]?.listeners() || null, (await app.state()).browserProfiles.find(p => p.id === profileId).partition);
  // ----------------------------------------------------------------------------------------------- checks
  const wr = reports.filter(r => r.ns === 'wr'), wn = reports.filter(r => r.ns === 'wn');
  const pageEvents = wr.filter(r => r.d.url === base + '/page').map(r => r.e);
  const c = result.checks;
  c.pageOrder = pageEvents;
  c.order = JSON.stringify(pageEvents) === JSON.stringify(['onBeforeRequest', 'onBeforeSendHeaders', 'onSendHeaders', 'onHeadersReceived', 'onResponseStarted', 'onCompleted']);
  const main = wr.find(r => r.e === 'onBeforeRequest' && r.d.url === base + '/page')?.d;
  c.mainDetails = main && main.type === 'main_frame' && main.frameId === 0 && main.parentFrameId === -1 && main.tabId > 0 && /^\d+$/.test(main.requestId);
  const hr = wr.find(r => r.e === 'onHeadersReceived' && r.d.url === base + '/page')?.d;
  c.headersReceived = !!hr && hr.statusCode === 200 && hr.responseHeaders.some(h => h.name.toLowerCase() === 'content-type') && !hr.responseHeaders.some(h => h.name.toLowerCase() === 'set-cookie');
  const bsh = wr.filter(r => r.e === 'onBeforeSendHeaders' && r.d.url.startsWith(base + '/api')).map(r => r.d)[0];
  c.extraHeaders = !!bsh && bsh.type === 'xmlhttprequest' && bsh.requestHeaders.some(h => h.name.toLowerCase() === 'cookie');
  c.typesFilter = !wr.some(r => r.e === 'onBeforeSendHeaders' && (r.d.type === 'image' || r.d.type === 'script'));
  const frameReq = wr.find(r => r.e === 'onBeforeRequest' && r.d.type === 'sub_frame')?.d, frameImg = wr.find(r => r.e === 'onBeforeRequest' && r.d.url.endsWith('/frame.png'))?.d;
  const frameCommit = wn.find(r => r.e === 'onCommitted' && r.d.url.endsWith('/frame'))?.d;
  c.frameIds = !!frameReq && !!frameImg && !!frameCommit && frameReq.frameId > 0 && frameReq.parentFrameId === 0 && frameImg.frameId === frameReq.frameId && frameCommit.frameId === frameReq.frameId && frameImg.documentId === frameCommit.documentId;
  const asset = wr.find(r => r.e === 'onBeforeRequest' && r.d.url.endsWith('/asset.js'))?.d;
  const pageCommit = wn.find(r => r.e === 'onCommitted' && r.d.url === base + '/page')?.d;
  c.documentIds = !!asset && !!pageCommit && asset.documentId === pageCommit.documentId && asset.initiator === base;
  c.redirect = wr.some(r => r.e === 'onBeforeRedirect' && r.d.url === base + '/redir' && r.d.redirectUrl === base + '/target' && r.d.statusCode === 302);
  c.auth = wr.some(r => r.e === 'onAuthRequired' && r.d.url === base + '/auth' && r.d.realm === 'P5 realm' && r.d.isProxy === false) && hits.some(h => h.path === '/auth' && h.auth);
  c.requestError = wr.some(r => r.e === 'onErrorOccurred' && r.d.url.startsWith('http://127.0.0.1:1/') && /^net::ERR_/.test(r.d.error));
  c.navOrder = wn.filter(r => r.d.url === base + '/page' && r.d.frameId === 0).map(r => r.e);
  c.navigation = JSON.stringify(c.navOrder.slice(0, 4)) === JSON.stringify(['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted']);
  c.transition = pageCommit ? [pageCommit.transitionType, pageCommit.transitionQualifiers] : null;
  c.historyState = wn.some(r => r.e === 'onHistoryStateUpdated' && r.d.url === base + '/page/state');
  c.fragment = wn.some(r => r.e === 'onReferenceFragmentUpdated' && r.d.url === base + '/page/state#part');
  c.navError = wn.some(r => r.e === 'onErrorOccurred' && r.d.url.startsWith('http://127.0.0.1:1/') && /^net::ERR_/.test(r.d.error));
  const frames = wn.find(r => r.e === 'getAllFrames')?.d.frames, one = wn.find(r => r.e === 'getFrame')?.d.frame;
  c.frames = Array.isArray(frames) && frames.length === 2 && frames.every(f => /^[0-9A-F]{32}$/.test(f.documentId)) && !!one && one.url.endsWith('/frame') && one.parentFrameId === 0;
  result.ok = ['order', 'mainDetails', 'headersReceived', 'extraHeaders', 'typesFilter', 'frameIds', 'documentIds', 'redirect', 'auth', 'requestError', 'navigation', 'historyState', 'fragment', 'navError', 'frames'].every(k => c[k] === true);
  result.counts = {webRequest: wr.length, webNavigation: wn.length};
} catch (error) {
  result.error = String(error && error.stack || error);
} finally {
  try { await fs.writeFile(path.join(OUT, 'events.json'), JSON.stringify(reports, null, 1)); } catch {}
  try { await app?.close(); } catch {}
  server.close();
  if (slot) try { await fs.rm(slot, {force: true}); } catch {}
  clearTimeout(hard);
}
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
process.exit(result.ok ? 0 : 1);
