// R4-55: what does an Acira profile tell websites about language, time zone and browser identity?
//   node qa/r4-lang-measure.mjs <scenario> [--google "q1,q2"]      scenario: default | ui-en | ui-es | choice-es-en
// Starts a local echo server, opens a page that reads navigator values in the main frame, same- and cross-origin iframes, a dedicated worker
// and a service worker, and records the headers every request carried (navigation, fetch, XHR, worker script, service-worker fetch).
// Also loads https://httpbin.org/headers. Needs a native slot (C:\ae\slot-N.lock); profile under .qa-profiles (C:\ae\r4\lang).
import http from 'node:http';
import fs from 'node:fs/promises';
import {startApp, sleep, poll} from './d-harness.mjs';

const scenario = process.argv[2] || 'default';
const out = process.env.LANG_OUT || `C:/ae/r4/lang/evidence`;
await fs.mkdir(out, {recursive: true});

const requests = [];
let reported = null;
const PAGE = `<!doctype html><meta charset=utf-8><title>lang probe</title><body><script>
const nav = () => ({language: navigator.language, languages: [...navigator.languages], ua: navigator.userAgent,
  brands: navigator.userAgentData ? navigator.userAgentData.brands.map(b => b.brand + ' ' + b.version) : null,
  tz: Intl.DateTimeFormat().resolvedOptions().timeZone, intlLocale: Intl.DateTimeFormat().resolvedOptions().locale,
  numberLocale: new Intl.NumberFormat().resolvedOptions().locale, offset: new Date().getTimezoneOffset(),
  dateString: new Date(0).toString(), dateLocale: new Date(Date.UTC(2026,0,15,12)).toLocaleString()});
(async () => {
  const result = {main: nav()};
  result.fetchEcho = await (await fetch('/echo?from=fetch')).json();
  result.xhrEcho = await new Promise(r => { const x = new XMLHttpRequest(); x.open('GET', '/echo?from=xhr'); x.onload = () => r(JSON.parse(x.responseText)); x.send(); });
  const frames = {};
  for (const [name, src] of [['sameOrigin', '/frame'], ['crossOrigin', location.protocol + '//localhost:' + location.port + '/frame']]) {
    frames[name] = await new Promise(resolve => { const f = document.createElement('iframe'); f.src = src; window.addEventListener('message', function h(e) { if (e.data && e.data.frame === name) { removeEventListener('message', h); resolve(e.data.nav); } }); f.name = name; document.body.append(f); setTimeout(() => resolve('timeout'), 4000); });
  }
  const srcdoc = await new Promise(resolve => { const f = document.createElement('iframe'); f.srcdoc = '<script>parent.postMessage({frame:"srcdoc",nav:{language:navigator.language,languages:[...navigator.languages]}},"*")<\\/script>'; window.addEventListener('message', function h(e) { if (e.data && e.data.frame === 'srcdoc') { removeEventListener('message', h); resolve(e.data.nav); } }); document.body.append(f); setTimeout(() => resolve('timeout'), 4000); });
  result.frames = {...frames, srcdoc};
  result.worker = await new Promise(resolve => { const w = new Worker('/worker.js'); w.onmessage = e => resolve(e.data); w.onerror = e => resolve('error ' + e.message); setTimeout(() => resolve('timeout'), 4000); });
  try { const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready; const sw = reg.active; result.serviceWorker = await new Promise(resolve => { navigator.serviceWorker.onmessage = e => resolve(e.data); sw.postMessage('go'); setTimeout(() => resolve('timeout'), 6000); }); } catch (error) { result.serviceWorker = 'error ' + error.message; }
  try { result.geolocation = await new Promise(resolve => navigator.geolocation.getCurrentPosition(p => resolve('granted'), e => resolve('denied:' + e.code + ':' + e.message), {timeout: 3000})); } catch (error) { result.geolocation = 'error ' + error.message; }
  try { result.permissions = {geolocation: (await navigator.permissions.query({name: 'geolocation'})).state}; } catch (error) { result.permissions = 'error'; }
  result.webrtc = typeof RTCPeerConnection;
  await fetch('/report', {method: 'POST', body: JSON.stringify(result)});
  document.title = 'done';
})();
<\/script>`;
const FRAME = `<!doctype html><script>parent.postMessage({frame: window.name, nav: {language: navigator.language, languages: [...navigator.languages], tz: Intl.DateTimeFormat().resolvedOptions().timeZone}}, '*')<\/script>`;
const WORKER = `postMessage({language: navigator.language, languages: [...navigator.languages], tz: Intl.DateTimeFormat().resolvedOptions().timeZone, intl: Intl.DateTimeFormat().resolvedOptions().locale});`;
const SW = `self.addEventListener('message', async event => { const r = await (await fetch('/echo?from=sw')).json(); event.source.postMessage({language: navigator.language, languages: [...navigator.languages], tz: Intl.DateTimeFormat().resolvedOptions().timeZone, echo: r}); });`;
const server = http.createServer((req, res) => {
  const headers = {...req.headers}; const url = new URL(req.url, 'http://x');
  requests.push({path: url.pathname + url.search, host: req.headers.host, headers});
  if (url.pathname === '/report') { let body = ''; req.on('data', c => body += c); req.on('end', () => { reported = JSON.parse(body); res.end('ok'); }); return; }
  const type = url.pathname === '/page' ? 'text/html' : url.pathname === '/frame' ? 'text/html' : url.pathname.endsWith('.js') ? 'text/javascript' : 'application/json';
  res.setHeader('content-type', type + '; charset=utf-8'); res.setHeader('cache-control', 'no-store');
  if (url.pathname === '/page') return res.end(PAGE);
  if (url.pathname === '/frame') return res.end(FRAME);
  if (url.pathname === '/worker.js') return res.end(WORKER);
  if (url.pathname === '/sw.js') { res.setHeader('service-worker-allowed', '/'); return res.end(SW); }
  res.end(JSON.stringify(headers));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

// Native slot
let slot = null;
for (let attempt = 0; attempt < 40 && !slot; attempt++) {
  for (const n of [1, 2, 3]) { const file = `C:/ae/slot-${n}.lock`; try { await fs.writeFile(file, `r4-lang ${new Date().toISOString()}`, {flag: 'wx'}); slot = file; break; } catch {} }
  if (!slot) await sleep(30000);
}
if (!slot) { server.close(); throw new Error('no native slot'); }

const root = `.qa-profiles/measure-${scenario}`;
await fs.rm(root, {recursive: true, force: true}).catch(() => {});
let app;
const result = {scenario, port};
try {
  app = await startApp({root});
  result.system = await app.main(({app}) => ({locale: app.getLocale(), preferred: app.getPreferredSystemLanguages(), systemLocale: app.getSystemLocale?.()}));
  if (scenario === 'ui-en') await app.act({type: 'settings.update', patch: {language: 'en'}});
  if (scenario === 'ui-es') await app.act({type: 'settings.update', patch: {language: 'es'}});
  result.settingsLanguage = (await app.state()).settings.language ?? '(unset = system)';
  result.websiteLanguageStatus = (await app.svc({type: 'website-language.status'}));
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${port}/page`});
  await poll(() => reported, Boolean, 'page report', 25000).catch(e => { result.reportError = String(e.message); });
  result.page = reported;
  const probe = requests.filter(r => !['/report'].includes(r.path.split('?')[0]));
  result.requests = probe.map(r => ({path: r.path, host: r.host, 'accept-language': r.headers['accept-language'] ?? null, 'user-agent': r.headers['user-agent'], 'sec-ch-ua': r.headers['sec-ch-ua'] ?? null, 'sec-ch-ua-mobile': r.headers['sec-ch-ua-mobile'] ?? null, 'sec-ch-ua-platform': r.headers['sec-ch-ua-platform'] ?? null, 'sec-fetch-dest': r.headers['sec-fetch-dest'] ?? null, other: Object.keys(r.headers).filter(k => /^(x-|dnt|sec-gpc|sec-ch)/.test(k))}));
  // httpbin
  await app.act({type: 'tab.new', url: 'https://httpbin.org/headers'});
  await sleep(7000);
  const bin = app.web(u => u.startsWith('https://httpbin.org'));
  result.httpbin = bin ? await bin.evaluate(() => document.body.innerText).catch(e => 'error ' + e.message) : 'no page';
  await fs.writeFile(`${out}/measure-${scenario}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 1));
} finally {
  try { await app?.close(); } catch {}
  try { app?.app.process().kill(); } catch {}
  server.close();
  await fs.unlink(slot).catch(() => {});
  process.exit(0);
}
