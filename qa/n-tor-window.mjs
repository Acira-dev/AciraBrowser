// Stream N: private window with Tor in the real app (needs internet; run visible for screenshots: D_VISIBLE=1).
// node qa/n-tor-window.mjs → opens a Tor window from a normal window, waits for real bootstrap, then checks:
//  1. check.torproject.org says "Congratulations" (normal navigation in the Tor tab)
//  2. no local DNS for any host the Tor tab asked for (NetLog HOST_RESOLVER events), incl. dns-prefetch and STUN hosts
//  3. local listeners (HTTP + UDP/STUN on 127.0.0.1) receive nothing; WebRTC gathers no candidates
//  4. extensions are off in the Tor session
//  5. after the window closes: tor.exe exits and no file under userData holds the page's cookie/storage token
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = path.resolve('.qa-profiles/n-tor'); const fresh = process.argv.includes('--fresh');
if (fresh) await fs.rm(root, {recursive: true, force: true});
const shots = path.resolve('qa/artifacts/n-tor'); await fs.mkdir(shots, {recursive: true});
const token = 'ntor' + randomUUID().replace(/-/g, '').slice(0, 16), leakHost = `${token}-prefetch.example`, stunHost = `${token}-stun.example`;
const report = [], fail = [];
const check = (ok, label) => { (ok ? report : fail).push(label); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

// Local listeners: nothing from the Tor window may ever reach them.
let httpHits = 0; const listener = await httpFixture((req, res) => { httpHits++; res.end('leak'); });
let udpHits = 0; const udp = dgram.createSocket('udp4'); udp.on('message', () => udpHits++); await new Promise(r => udp.bind(0, '127.0.0.1', r));
const udpPort = udp.address().port;

const app = await startApp({root, env: process.env.D_VISIBLE ? {} : {}});
const netlog = path.join(root, `netlog-${token}.json`);
try {
  await app.main(async ({netLog}, file) => { await netLog.startLogging(file, {captureMode: 'default'}); }, netlog);
  const before = new Set(app.context.pages());
  const t0 = Date.now();
  await app.ui.evaluate(() => window.acira.openWindow('tor'));
  const torUi = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor window ui', 30000);
  await poll(() => torUi.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'tor acira', 30000);
  const snap = await torUi.evaluate(() => window.acira.getSnapshot());
  const profile = snap.browserProfiles[0];
  check(profile.tor === true && profile.private === true, 'window is a private Tor window (profile.tor)');
  check(snap.settings.searchEngine === 'duckduckgo', 'Tor window searches with DuckDuckGo');
  const title = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => w.getTitle()));
  check(title.includes('Acira · Tor'), 'window title says Tor');
  await sleep(1500);
  await torUi.screenshot({path: path.join(shots, 'connecting.png')}).catch(() => {});
  const ready = await poll(() => torUi.evaluate(() => window.acira.native({type: 'tor.status'})), r => r?.tor?.state === 'ready' || r?.tor?.state === 'error', 'tor ready', 300000);
  console.log(`bootstrap: ${((Date.now() - t0) / 1000).toFixed(1)}s → ${ready.tor.state}`);
  check(ready.tor.state === 'ready', 'Tor connects (real bootstrap)');
  const partition = profile.partition;
  const socks = await app.main(async ({session}, p) => String(await session.fromPartition(p).resolveProxy('https://example.com/')), partition);
  check(/^SOCKS5 127\.0\.0\.1:\d+$/.test(socks.trim()), `Tor session proxy is SOCKS5 on localhost (${socks.trim()})`);
  await torUi.screenshot({path: path.join(shots, 'ready.png')}).catch(() => {});

  // 1. Real check, through normal navigation in the Tor tab.
  await torUi.evaluate(() => window.acira.dispatch({type: 'tab.navigate', url: 'https://check.torproject.org/'}));
  const checkPage = await poll(() => app.context.pages().find(p => { try { return p.url().startsWith('https://check.torproject.org'); } catch { return false; } }), Boolean, 'check page', 60000);
  const verdict = await poll(() => checkPage.evaluate(() => document.querySelector('h1')?.textContent?.trim() || ''), t => /Congratulations|Sorry/.test(t), 'check verdict', 90000);
  check(/Congratulations/.test(verdict), `check.torproject.org: "${verdict.replace(/\s+/g, ' ')}"`);
  await torUi.screenshot({path: path.join(shots, 'check-torproject.png')}).catch(() => {});

  // 2 + 3. Leak probes inside the Tor tab: dns-prefetch hint, loopback/LAN fetches, WebSocket, WebRTC with local + named STUN.
  const probe = await checkPage.evaluate(async ({leakHost, stunHost, httpPort, udpPort, token}) => {
    document.cookie = `${token}=1; path=/; max-age=86400`; localStorage.setItem('n', token); sessionStorage.setItem('n', token);
    try { await new Promise((resolve, reject) => { const r = indexedDB.open('n-' + token); r.onupgradeneeded = () => r.result.createObjectStore('s').put(token, 'k'); r.onsuccess = () => { r.result.close(); resolve(); }; r.onerror = reject; }); } catch {}
    const link = document.createElement('link'); link.rel = 'dns-prefetch'; link.href = `//${leakHost}`; document.head.append(link);
    const pre = document.createElement('link'); pre.rel = 'preconnect'; pre.href = `https://pre-${leakHost}`; document.head.append(pre);
    const results = {};
    for (const [name, url] of [['loopback', `http://127.0.0.1:${httpPort}/leak`], ['localhost', `http://localhost:${httpPort}/leak`], ['lan', 'http://192.168.1.1/'], ['single', 'http://router/']])
      results[name] = await fetch(url, {mode: 'no-cors'}).then(() => 'loaded', e => 'blocked: ' + e.message);
    results.ws = await new Promise(resolve => { try { const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/`); ws.onopen = () => resolve('open'); ws.onerror = () => resolve('blocked'); setTimeout(() => resolve('timeout'), 5000); } catch (e) { resolve('throw ' + e.message); } });
    const pc = new RTCPeerConnection({iceServers: [{urls: `stun:127.0.0.1:${udpPort}`}, {urls: `stun:${stunHost}:3478`}]});
    const candidates = []; pc.onicecandidate = e => { if (e.candidate) candidates.push(e.candidate.candidate); };
    pc.createDataChannel('n'); await pc.setLocalDescription(await pc.createOffer());
    await new Promise(resolve => { pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') resolve(); }; setTimeout(resolve, 8000); });
    results.candidates = candidates; pc.close();
    return results;
  }, {leakHost, stunHost, httpPort: listener.port, udpPort, token});
  console.log('probe:', JSON.stringify(probe));
  check(['loopback', 'localhost', 'lan', 'single'].every(k => probe[k].startsWith('blocked')), 'loopback, localhost, LAN and single-label fetches are refused');
  check(probe.ws !== 'open', 'WebSocket to loopback refused');
  check(probe.candidates.length === 0, `WebRTC gathers no ICE candidates (${probe.candidates.length})`);
  await sleep(4000);
  check(httpHits === 0, `local HTTP listener received nothing (${httpHits})`);
  check(udpHits === 0, `local UDP/STUN listener received nothing (${udpHits})`);

  // 4. Extensions off in the Tor window.
  const ext = await torUi.evaluate(() => window.acira.extensions?.({type: 'list'}).then(r => 'allowed ' + JSON.stringify(r).slice(0, 80), e => 'refused: ' + e.message));
  check(/refused/.test(String(ext)), `extensions are off in the Tor window (${String(ext).slice(0, 90)})`);
  const loaded = await app.main(({session}, p) => { const s = session.fromPartition(p); return (s.extensions?.getAllExtensions?.() || s.getAllExtensions?.() || []).length; }, partition);
  check(loaded === 0, 'no extension loaded in the Tor session');

  // New Tor identity: NEWNYM + cleared site data + fresh tabs.
  const identity = await torUi.evaluate(() => window.acira.native({type: 'tor.new-identity'}));
  check(identity?.identity?.ok === true, 'New Tor identity answered');
  await sleep(1500);
  const afterIdentity = await torUi.evaluate(() => window.acira.getSnapshot());
  check(afterIdentity.tabs.length === 1 && !afterIdentity.tabs[0].url.startsWith('https://check.torproject.org'), 'New Tor identity replaced the tabs with one fresh tab');
  const cookieLeft = await app.main(async ({session}, p) => (await session.fromPartition(p).cookies.get({})).length, partition);
  check(cookieLeft === 0, `New Tor identity cleared cookies (${cookieLeft} left)`);

  // DNS: stop the NetLog and look for local resolutions of anything the Tor tab touched.
  await app.main(async ({netLog}) => { await netLog.stopLogging(); });
  const log = JSON.parse(await fs.readFile(netlog, 'utf8')), types = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([k, v]) => [v, k]));
  // Chromium also does a local-only lookup of each committed origin (task sequence [CACHE_LOOKUP, HOSTS]: DNS cache and
  // hosts file, never the network). A leak is a lookup whose task sequence includes a network task.
  const NETWORK_TASKS = new Set([0, 1, 2, 3, 10]); // SYSTEM, DNS, SECURE_DNS, MDNS, DNS_PLATFORM (net/dns/host_resolver_manager.h)
  const lookups = [], last = new Map();
  for (const e of log.events) { const type = types[e.type] || '';
    if (type === 'HOST_RESOLVER_MANAGER_REQUEST' && e.params?.host) { const item = {host: String(e.params.host).replace(/^[a-z]+:\/\//, '').replace(/:\d+$/, ''), tasks: []}; lookups.push(item); last.set(e.source.id, item); }
    else if (type === 'HOST_RESOLVER_MANAGER_TASK_SEQUENCE_CREATED' && last.has(e.source.id)) last.get(e.source.id).tasks = e.params?.tasks || []; }
  const torHosts = ['check.torproject.org', leakHost, 'pre-' + leakHost, stunHost, 'router', '192.168.1.1'];
  const forTor = lookups.filter(l => torHosts.some(t => l.host.includes(t)));
  console.log('lookups during the run:', JSON.stringify(lookups.map(l => l.host + ' ' + JSON.stringify(l.tasks))));
  const leaked = forTor.filter(l => l.tasks.some(t => NETWORK_TASKS.has(t)));
  check(leaked.length === 0, `no DNS query leaves the machine for Tor-window hosts (${leaked.map(l => l.host).join(', ') || 'none'}; ${forTor.length} local-only cache/hosts checks)`);
  if (leaked.length) await fs.copyFile(netlog, path.join(shots, 'leak-netlog.json'));

  // 5. Close the window: tor stops, nothing persists.
  await torUi.evaluate(() => window.acira.windowControl('close'));
  await poll(async () => (await app.main(({BaseWindow}) => BaseWindow.getAllWindows().length)), n => n === 1, 'tor window closed', 20000);
  await sleep(4000);
  // R3-61: one Tor connection per app session. tor keeps running after the last Tor window closes (the next one is connected at once) and ends with Acira.
  const ownTor = () => execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"name='tor.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"], {encoding: 'utf8'}).split(/\r?\n/).filter(l => l.includes(root.replace(/\//g, '\\')) || l.includes(root));
  check(ownTor().length === 1, 'tor.exe keeps running after the last Tor window closes (one Tor connection per app session)');
  const hits = [];
  async function scan(dir) { for (const entry of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) { const file = path.join(dir, entry.name); if (entry.isDirectory()) { await scan(file); continue; } if (file === netlog) continue; const found = await new Promise(resolve => { let tail = ''; const stream = createReadStream(file); stream.on('data', chunk => { const text = tail + chunk.toString('latin1'); if (text.includes(token) || text.includes('check.torproject')) { resolve(true); stream.destroy(); } tail = text.slice(-64); }); stream.on('end', () => resolve(false)); stream.on('error', () => resolve(false)); }); if (found) hits.push(path.relative(root, file)); } }
  await scan(root);
  check(hits.length === 0, `no file under userData holds the Tor tab's token or host (${hits.join(', ') || 'none'})`);
  await app.close(); await sleep(4000);
  check(ownTor().length === 0, 'tor.exe ends with Acira');
} finally {
  await app.close().catch(() => {}); listener.close(); udp.close();
  await fs.rm(netlog, {force: true}).catch(() => {});
}
console.log(`\n${report.length} passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILED:\n- ' + fail.join('\n- ')); process.exitCode = 1; }
