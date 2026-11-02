// Round 3 (network) R3-13: Acira's proxy settings, end to end, in the real app on a disposable profile.
// Real HTTP and SOCKS5 proxies (with and without sign-in) run on loopback (qa/r3-proxy-servers.cjs). A web page served only through a proxy
// echoes the address its connection came from: 127.0.0.2 means "came through the proxy", 127.0.0.1 means "went direct".
// Writes results.json (a plain pass/fail table) to C:\ae\r3\network\evidence\.  Takes one native slot (C:\ae\slot-N.lock).
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startApp, sleep, poll} from './d-harness.mjs';
const require = createRequire(import.meta.url);
const S = require('./r3-proxy-servers.cjs');
const OUT = 'C:/ae/r3/network/evidence'; await fs.mkdir(OUT, {recursive: true});
const ROOT = '.qa-profiles/r3-network-proxy'; await fs.rm(ROOT, {recursive: true, force: true});
const rows = []; const row = (id, check, ok, evidence) => { rows.push({id, check, result: ok ? 'PASS' : 'FAIL', evidence}); console.log(ok ? 'PASS' : 'FAIL', id, check, '-', evidence); };

async function takeSlot(name) {
  for (let i = 0; i < 40; i++) {
    for (const n of [1, 2, 3]) { try { const h = await fs.open(`C:/ae/slot-${n}.lock`, 'wx'); await h.write(`${name} ${new Date().toISOString()}`); await h.close(); return n; } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    await sleep(30000);
  }
  throw new Error('no native slot free');
}
const slot = await takeSlot('network-r3-13');
const releaseSlot = () => fs.rm(`C:/ae/slot-${slot}.lock`, {force: true});

const origin = await S.startOrigin();
const P = origin.port;
const names = {'echo.acira.test': P, 'other.acira.test': P};
let http1 = await S.startHttpProxy({names});
const socksOpen = await S.startSocks5({names});
const socksAuth = await S.startSocks5({names, auth: {user: 'u', pass: 'p'}});
const udp = await S.startUdpSink();
const netlog = path.resolve(ROOT, 'netlog.json');
let app; let counter = 0; let udpAfterControl = 0;
function parseNetlog(raw) {
  // The engine writes a complete JSON document on a clean exit; after a crash the closing brackets are missing, so repair that once.
  for (const candidate of [raw, raw.replace(/,\s*$/, '') + ']}', raw.replace(/,?\s*\]\s*\}?\s*$/, '') + ']}']) { try { const doc = JSON.parse(candidate); return {events: doc.events || [], constants: doc.constants || null}; } catch {} }
  return {events: [], constants: null};
}
const url = (host, p = '/') => `http://${host}:${P}${p}${p.includes('?') ? '&' : '?'}n=${++counter}`;
const visit = async (target, {timeout = 20000} = {}) => {
  const first = (await app.state()).tabs.find(t => t.id === (null)) || null; void first;
  await app.act({type: 'tab.navigate', url: target});
  const done = await poll(async () => { const s = await app.state(); const t = s.tabs.find(x => x.id === s.activeTabId) || s.tabs[s.tabs.length - 1]; return t && t.url === target && !t.loading ? {title: t.title, error: t.error || null, url: t.url} : null; }, Boolean, 'load ' + target, timeout).catch(async () => { const s = await app.state(); const t = s.tabs.find(x => x.id === s.activeTabId) || s.tabs[s.tabs.length - 1]; return {title: t?.title, error: t?.error || 'timeout', url: t?.url}; });
  return done;
};
const ipOf = r => /^ip (\S+)/.exec(r?.title || '')?.[1] || null;
const setProxy = choice => app.svc({type: 'proxy.set', choice});
const mark = () => ({http: http1.log.length, open: socksOpen.log.length, auth: socksAuth.log.length});

try {
  app = await startApp({root: ROOT, args: ['--host-resolver-rules=MAP direct.acira.test 127.0.0.1', `--log-net-log=${netlog}`]});
  await app.main(({dialog}) => { dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); });
  await app.act({type: 'tab.new', url: 'about:blank'}).catch(() => {});

  // 0. baseline
  let r = await visit(url('direct.acira.test'));
  row('B1', 'no proxy: a page reached directly sees our own address', ipOf(r) === '127.0.0.1', `ip=${ipOf(r)}`);
  r = await visit(url('echo.acira.test'));
  row('B2', 'no proxy: a name only the proxy knows does not resolve', ipOf(r) === null, `title=${JSON.stringify(r.title)} error=${JSON.stringify(r.error)}`);

  // 1. HTTP proxy, no sign-in
  let set = await setProxy({mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: http1.port}, bypassHosts: []});
  row('H0', 'HTTP proxy saved and applied', set.proxy?.applied === true && set.proxy?.choice?.mode === 'fixed_servers', JSON.stringify({applied: set.proxy?.applied, mode: set.proxy?.choice?.mode}));
  let m = mark(); r = await visit(url('echo.acira.test', '/via-http'));
  row('H1', 'HTTP proxy: page loads through the proxy (echo page shows the proxy-side address)', ipOf(r) === '127.0.0.2', `ip=${ipOf(r)}`);
  row('H2', 'HTTP proxy: the proxy saw the request for the name', http1.log.slice(m.http).some(e => e.kind === 'http' && e.host === 'echo.acira.test' && e.path.startsWith('/via-http')), JSON.stringify(http1.log.slice(m.http, m.http + 2)));
  const route = await app.svc({type: 'proxy.route', tabId: (await app.state()).activeTabId}).catch(e => ({error: String(e.message || e)}));
  row('H3', 'HTTP proxy: "which route does this tab use" reports the proxy', /PROXY 127\.0\.0\.1/.test(route.proxy?.route || ''), JSON.stringify(route.proxy?.route ?? route.error));
  m = mark(); r = await visit(`https://echo.acira.test:${P}/tls?n=${++counter}`, {timeout: 12000});
  row('H4', 'HTTPS through the HTTP proxy opens a CONNECT tunnel (cert page is expected: the fixture is plain HTTP)', http1.log.slice(m.http).some(e => e.kind === 'connect' && e.host === 'echo.acira.test'), JSON.stringify(http1.log.slice(m.http, m.http + 2)));

  // 2. bypass list
  await setProxy({mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: http1.port}, bypassHosts: ['direct.acira.test']});
  m = mark(); r = await visit(url('direct.acira.test', '/bypassed'));
  row('Y1', 'bypass list: a listed host goes direct and the proxy never sees it', ipOf(r) === '127.0.0.1' && !http1.log.slice(m.http).some(e => e.host === 'direct.acira.test'), `ip=${ipOf(r)} proxyEntries=${http1.log.slice(m.http).length}`);
  r = await visit(url('echo.acira.test', '/not-bypassed'));
  row('Y2', 'bypass list: a host not on it still uses the proxy', ipOf(r) === '127.0.0.2', `ip=${ipOf(r)}`);
  await setProxy({mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: http1.port}, bypassHosts: ['*.acira.test']});
  m = mark(); r = await visit(url('echo.acira.test', '/wild'));
  row('Y3', 'bypass list: a wildcard (*.acira.test) bypasses the proxy for every match (the unresolvable name now fails, proving it went direct)', ipOf(r) === null && !http1.log.slice(m.http).some(e => e.host === 'echo.acira.test'), `title=${JSON.stringify(r.title)} proxyEntries=${http1.log.slice(m.http).length}`);

  // 3. bad proxy and recovery
  const dead = await S.startHttpProxy({names}); const deadPort = dead.port; await dead.close();
  set = await setProxy({mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: deadPort}, bypassHosts: []});
  r = await visit(url('echo.acira.test', '/dead'), {timeout: 25000});
  row('R1', 'bad proxy (nothing listening): the tab shows a proxy error, no silent direct fallback', ipOf(r) === null && /PROXY|proxy|ERR_/i.test(`${r.error} ${r.title}`) && origin.hits.every(h => h.path !== '/dead'), `error=${JSON.stringify(r.error)} title=${JSON.stringify(r.title)} originHitForDead=${origin.hits.some(h => h.path === '/dead')}`);
  const status = await app.svc({type: 'proxy.status'});
  row('R2', 'bad proxy: Settings still reports the chosen proxy as applied (so the person sees what is set), not "direct"', status.proxy?.choice?.mode === 'fixed_servers' && status.proxy?.applied === true, JSON.stringify({mode: status.proxy?.choice?.mode, port: status.proxy?.choice?.server?.port}));
  const test = await app.svc({type: 'proxy.test', choice: {server: {scheme: 'http', host: '127.0.0.1', port: deadPort}}});
  row('R3', 'bad proxy: the Test button says plainly that nothing is listening', test.proxy?.test?.ok === false && /Nothing is listening/.test(test.proxy.test.message), JSON.stringify(test.proxy?.test));
  // recovery A: the same address comes back
  const back = await S.startHttpProxy({names, port: deadPort}); http1 = back;
  r = await visit(url('echo.acira.test', '/recovered-same-port'), {timeout: 25000});
  row('R4', 'recovery: the proxy comes back on the same address and the next page loads through it without changing any setting', ipOf(r) === '127.0.0.2', `ip=${ipOf(r)} error=${JSON.stringify(r.error)}`);
  // recovery B: switch to a good proxy / to direct
  set = await setProxy({mode: 'direct'});
  r = await visit(url('direct.acira.test', '/direct-again'));
  row('R5', 'recovery: switching to "no proxy" loads pages directly again', ipOf(r) === '127.0.0.1' && set.proxy?.applied === true, `ip=${ipOf(r)}`);

  // 4. SOCKS5
  await setProxy({mode: 'fixed_servers', server: {scheme: 'socks5', host: '127.0.0.1', port: socksOpen.port}, bypassHosts: []});
  m = mark(); r = await visit(url('echo.acira.test', '/via-socks'));
  const so = socksOpen.log.slice(m.open);
  row('S1', 'SOCKS5 (no sign-in): page loads through the proxy', ipOf(r) === '127.0.0.2', `ip=${ipOf(r)}`);
  row('S2', 'SOCKS5: the browser sent the NAME to the proxy (atyp 3), so the proxy resolves it and Acira does not look it up locally', so.some(e => e.atyp === 3 && e.host === 'echo.acira.test'), JSON.stringify(so.slice(0, 2)));
  const t1 = await app.svc({type: 'proxy.test', choice: {server: {scheme: 'socks5', host: '127.0.0.1', port: socksOpen.port}}});
  row('S3', 'SOCKS5: Test button passes on a proxy without a sign-in', t1.proxy?.test?.ok === true, JSON.stringify(t1.proxy?.test?.message));
  await setProxy({mode: 'fixed_servers', server: {scheme: 'socks5', host: '127.0.0.1', port: socksAuth.port}, bypassHosts: []});
  m = mark(); r = await visit(url('echo.acira.test', '/socks-auth'), {timeout: 25000});
  row('S4', 'SOCKS5 that demands a username and password: the engine cannot sign in, the page fails closed (never goes direct)', ipOf(r) === null && origin.hits.every(h => h.path !== '/socks-auth'), `error=${JSON.stringify(r.error)} proxyOffered=${JSON.stringify(socksAuth.log.slice(m.auth, m.auth + 1).map(e => e.offered))}`);
  const t2 = await app.svc({type: 'proxy.test', choice: {server: {scheme: 'socks5', host: '127.0.0.1', port: socksAuth.port}}});
  row('S5', 'SOCKS5 with sign-in: the Test button tells the person up front that Acira cannot send SOCKS5 sign-ins and suggests an HTTP proxy', t2.proxy?.test?.ok === false && /cannot send SOCKS5 sign-ins/.test(t2.proxy.test.message), JSON.stringify(t2.proxy?.test?.message));

  // 5. HTTP proxy that asks for a sign-in: Test button says so (the full prompt flow is qa/d-proxy.mjs)
  const authProxy = await S.startHttpProxy({names, auth: {user: 'proxyuser', pass: 'proxypass'}});
  const t3 = await app.svc({type: 'proxy.test', choice: {server: {scheme: 'http', host: '127.0.0.1', port: authProxy.port}}});
  row('A1', 'HTTP proxy with sign-in: the Test button recognises it needs a sign-in', t3.proxy?.test?.ok === true && /sign-in/i.test(t3.proxy.test.message), JSON.stringify(t3.proxy?.test?.message));
  await setProxy({mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: authProxy.port}, bypassHosts: []});
  await app.act({type: 'tab.navigate', url: url('echo.acira.test', '/auth-prompt')});
  const prompt = await app.ui.getByText('Sign in to this proxy').waitFor({timeout: 20000}).then(() => true).catch(() => false);
  row('A2', 'HTTP proxy with sign-in: a 407 opens Acira\'s "Sign in to this proxy" and nothing loads until the person answers', prompt && origin.hits.every(h => h.path !== '/auth-prompt'), `prompt=${prompt}`);
  if (prompt) {
    await app.ui.getByLabel('Username').fill('proxyuser'); await app.ui.getByLabel('Password').fill('proxypass'); await app.ui.getByRole('button', {name: 'Sign in', exact: true}).click();
    r = await poll(async () => { const s = await app.state(); const t = s.tabs.find(x => x.id === s.activeTabId); return /^ip /.test(t?.title || '') ? t : null; }, Boolean, 'signed in load', 20000).then(t => ({title: t.title})).catch(() => ({title: null}));
    row('A3', 'HTTP proxy with sign-in: right details load the page through the proxy (echo shows the proxy-side address)', ipOf(r) === '127.0.0.2' && authProxy.log.some(e => e.auth && e.status === 200), `ip=${ipOf(r)}`);
  }

  // 6. WebRTC around a proxy: a STUN-like listener on loopback sees nothing while a proxy is set
  const rtc = async () => {
    const page = await poll(() => app.web(u => u.includes('acira.test')), Boolean, 'web page', 15000);
    return page.evaluate(async stun => {
      const pc = new RTCPeerConnection({iceServers: [{urls: `stun:${stun}`}]}); pc.createDataChannel('x'); const found = [];
      pc.onicecandidate = e => { if (e.candidate) found.push(e.candidate.candidate.split(' ').slice(0, 8).join(' ').replace(/[0-9a-f-]{36}\.local/, 'MDNS.local')); };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(resolve => { const done = () => resolve(); pc.onicegatheringstatechange = () => pc.iceGatheringState === 'complete' && done(); setTimeout(done, 4000); });
      pc.close(); return found;
    }, `127.0.0.1:${udp.port}`);
  };
  await setProxy({mode: 'direct'});
  await visit(url('direct.acira.test', '/rtc-direct'));
  const baseline = udp.log.length; const direct = await rtc().catch(e => ['error ' + e.message]);
  row('W0', 'WebRTC control: with no proxy a page can gather candidates and reaches the STUN listener (so the test below is meaningful)', direct.length > 0 || udp.log.length > baseline, `candidates=${JSON.stringify(direct)} udpPackets=${udp.log.length - baseline}`);
  udpAfterControl = udp.log.length;
  await setProxy({mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: http1.port}, bypassHosts: []});
  await visit(url('echo.acira.test', '/rtc-proxy'));
  const before = udp.log.length; const proxied = await rtc().catch(e => ['error ' + e.message]);
  row('W1', 'WebRTC with a proxy set: no address candidates are offered and no UDP packet leaves around the proxy', proxied.filter(c => !/^error/.test(c)).length === 0 && udp.log.length === before, `candidates=${JSON.stringify(proxied)} udpPackets=${udp.log.length - before}`);

  // 7. the proxy choice survives a restart and is already in force for the first request (no unproxied window)
  await setProxy({mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: http1.port}, bypassHosts: []});
  await app.close(); app = null; await sleep(1500);
  await fs.rm(netlog, {force: true});
  app = await startApp({root: ROOT, args: ['--host-resolver-rules=MAP direct.acira.test 127.0.0.1', `--log-net-log=${netlog}`]});
  const st = await app.svc({type: 'proxy.status'});
  row('P1', 'restart: the saved proxy is applied again by itself', st.proxy?.choice?.mode === 'fixed_servers' && st.proxy?.applied === true, JSON.stringify({mode: st.proxy?.choice?.mode, applied: st.proxy?.applied}));
  m = mark(); r = await visit(url('echo.acira.test', '/after-restart'));
  row('P2', 'restart: the first page after launch already goes through the proxy', ipOf(r) === '127.0.0.2' && http1.log.slice(m.http).some(e => e.path.startsWith('/after-restart')), `ip=${ipOf(r)}`);
  await sleep(4000); // let background services settle, then read the engine's own network log for the whole run since launch
  await app.close(); app = null; await sleep(1500);
  const raw = await fs.readFile(netlog, 'utf8').catch(() => ''); await fs.copyFile(netlog, path.join(OUT, 'netlog-restart.json')).catch(() => {});
  const {events, constants} = parseNetlog(raw);
  const typeNames = constants ? Object.fromEntries(Object.entries(constants.logEventTypes).map(([k, v]) => [v, k])) : {};
  const hosts = new Set(), addrs = new Set();
  // A real lookup is a HOST_RESOLVER_MANAGER_JOB. The network-quality estimator also files LOCAL_ONLY requests against page names; those
  // only ask the local cache and hosts file and never start a job (Chromium net/nqe/network_quality_estimator_util.cc), so they are not counted.
  for (const e of events) { const type = typeNames[e.type] || ''; const p = e.params || {}; if (type === 'HOST_RESOLVER_MANAGER_JOB' && e.phase === 1 && p.host) hosts.add(String(p.host)); if (type === 'TCP_CONNECT_ATTEMPT' && p.address) addrs.add(String(p.address)); }
  const dnsNames = [...hosts].filter(h => !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(h));
  const websiteLookups = dnsNames.filter(h => h !== 'wpad:80');
  row('D1', 'DNS: since launch (saved proxy), the engine ran no resolver lookup for any website name (only Windows proxy auto-detect "wpad" may appear)', events.length > 100 && websiteLookups.length === 0, `events=${events.length} resolverJobs=${JSON.stringify(dnsNames)}`);
  const external = [...addrs].filter(a => !/^(127\.0\.0\.\d|\[::1\]):\d+$/.test(a));
  row('D2', 'Network: since launch, the engine opened sockets to nothing except loopback (the proxy and the test fixtures)', events.length > 100 && external.length === 0, `socketAddresses=${JSON.stringify([...addrs].slice(0, 12))} nonLoopback=${JSON.stringify(external)}`);
  row('D3', 'WebRTC sink: after the control phase the UDP listener received nothing more (no packet left during any proxy phase)', udp.log.length === udpAfterControl, `packetsAfterControl=${udpAfterControl} packetsAtEnd=${udp.log.length}`);
} catch (error) {
  console.log('SCRIPT ERROR', error.stack);
  rows.push({id: 'ERR', check: 'script error', result: 'FAIL', evidence: String(error.message || error).slice(0, 400)});
} finally {
  try { if (app) await app.close(); } catch {}
  for (const s of [http1, socksOpen, socksAuth, udp, origin]) { try { await s.close(); } catch {} }
  await releaseSlot();
  await fs.writeFile(path.join(OUT, 'results.json'), JSON.stringify({when: new Date().toISOString(), rows}, null, 1));
}
const failed = rows.filter(x => x.result !== 'PASS'); console.log(`\n${rows.length - failed.length}/${rows.length} pass`); process.exit(failed.length ? 1 : 0); // servers and sockets left open by the scenarios must not keep the process alive
