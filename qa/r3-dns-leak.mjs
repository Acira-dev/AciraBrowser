// Round 3 (network): does a website name reach the local resolver while a manual proxy is set? Reads the engine's own network log.
// Usage: node qa/r3-dns-leak.mjs [mode] [extra engine switch ...]   mode = http | socks5 | pac ; switches are passed to the engine as given.
// Uses one native slot. Writes C:\ae\r3\network\evidence\dns-<label>.json.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp, sleep, poll} from './d-harness.mjs';
const require = createRequire(import.meta.url);
const S = require('./r3-proxy-servers.cjs');
const mode = process.argv[2] || 'http', extra = process.argv.slice(3), label = process.env.LEAK_LABEL || (mode + (extra.length ? '-' + extra.join('_').replace(/[^\w.-]/g, '') : ''));
const OUT = 'C:/ae/r3/network/evidence'; await fs.mkdir(OUT, {recursive: true});
const ROOT = '.qa-profiles/r3-dns-' + Date.now(); const netlog = path.resolve(ROOT, 'netlog.json');
async function takeSlot(name) { for (let i = 0; i < 40; i++) { for (const n of [1, 2, 3]) { try { const h = await fs.open(`C:/ae/slot-${n}.lock`, 'wx'); await h.write(`${name} ${new Date().toISOString()}`); await h.close(); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; } } await sleep(30000); } throw new Error('no slot'); }
const slot = await takeSlot('network-dns-leak');
const origin = await S.startOrigin(), names = {'echo.acira.test': origin.port};
const proxy = mode === 'socks5' ? await S.startSocks5({names}) : await S.startHttpProxy({names});
const pac = mode === 'pac' ? await S.startPacServer(`function FindProxyForURL(url, host) { return host === 'echo.acira.test' ? 'PROXY 127.0.0.1:${proxy.port}' : 'DIRECT'; }`) : null;
let app, result = {label, mode, extra};
try {
  const args = [`--log-net-log=${netlog}`, ...(pac ? [`--proxy-pac-url=${pac.url}`] : []), ...extra];
  app = await startApp({root: ROOT, args});
  if (mode !== 'pac') {
    await app.main(({dialog}) => { dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); });
    await app.svc({type: 'proxy.set', choice: {mode: 'fixed_servers', server: {scheme: mode === 'socks5' ? 'socks5' : 'http', host: '127.0.0.1', port: proxy.port}, bypassHosts: []}});
  }
  const target = `http://echo.acira.test:${origin.port}/leak-check`;
  await app.act({type: 'tab.navigate', url: target});
  result.title = await poll(async () => { const s = await app.state(); const t = s.tabs.find(x => x.id === s.activeTabId); return t && t.url === target && !t.loading && /^ip /.test(t.title || '') ? t.title : null; }, Boolean, 'load', 20000).catch(() => 'did not load');
  if (result.title === 'did not load') { const s = await app.state(); const t = s.tabs.find(x => x.id === s.activeTabId); result.tab = {url: t?.url, title: t?.title, error: t?.error, loading: t?.loading}; }
  result.proxySaw = (proxy.log || []).some(e => e.host === 'echo.acira.test');
  result.pacRequests = pac?.requests.length ?? null;
  await sleep(3000);
  await app.close(); app = null; await sleep(1500);
  const doc = JSON.parse(await fs.readFile(netlog, 'utf8'));
  const names2 = Object.fromEntries(Object.entries(doc.constants.logEventTypes).map(([k, v]) => [v, k])), src = Object.fromEntries(Object.entries(doc.constants.logSourceType).map(([k, v]) => [v, k]));
  const lookups = [];
  // Only a HOST_RESOLVER_MANAGER_JOB is a real lookup; the network-quality estimator's requests are LOCAL_ONLY (cache and hosts file) and start no job.
  for (const e of doc.events) if (names2[e.type] === 'HOST_RESOLVER_MANAGER_JOB' && e.phase === 1) lookups.push({host: e.params.host, source: src[e.source.type]});
  result.lookups = lookups; result.echoLookups = lookups.filter(l => /acira\.test/.test(l.host)).length;
  result.sockets = [...new Set(doc.events.filter(e => /^TCP_CONNECT_ATTEMPT$|^TCP_CONNECT$/.test(names2[e.type]) && e.params?.address).map(e => e.params.address))];
} catch (error) { result.error = String(error.stack || error); }
finally { try { if (app) await app.close(); } catch {} for (const s of [proxy, origin, pac]) { try { await s?.close(); } catch {} } await fs.rm(`C:/ae/slot-${slot}.lock`, {force: true}); }
await fs.writeFile(path.join(OUT, `dns-${label}.json`), JSON.stringify(result, null, 1));
console.log(JSON.stringify({label, title: result.title, tab: result.tab, proxySaw: result.proxySaw, pacRequests: result.pacRequests, echoLookups: result.echoLookups, lookups: result.lookups?.map(l => `${l.source}:${l.host}`), sockets: result.sockets, error: result.error?.slice(0, 300)}, null, 1));
