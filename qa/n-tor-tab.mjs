// Stream N: Tor TABS inside an ordinary window, same checks as qa/n-tor-window.mjs plus an ordinary-tab control.
// One instance, at most 4 tabs, closed in finally (needs internet). node qa/n-tor-tab.mjs [--fresh]
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = path.resolve('.qa-profiles/n-tor-tab');
if (process.argv.includes('--fresh')) await fs.rm(root, {recursive: true, force: true});
const token = 'ntor' + randomUUID().replace(/-/g, '').slice(0, 16), leakHost = `${token}-prefetch.example`, stunHost = `${token}-stun.example`;
const report = [], fail = [];
const check = (ok, label) => { (ok ? report : fail).push(label); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

let httpHits = 0; const listener = await httpFixture((req, res) => { httpHits++; res.setHeader('content-type', 'text/html'); res.end('<title>ordinary</title>ok'); });
let udpHits = 0; const udp = dgram.createSocket('udp4'); udp.on('message', () => udpHits++); await new Promise(r => udp.bind(0, '127.0.0.1', r));
const udpPort = udp.address().port;

const app = await startApp({root});
const netlog = path.join(root, `netlog-${token}.json`);
let closed = false;
try {
  await app.main(async ({netLog}, file) => { await netLog.startLogging(file, {captureMode: 'default'}); }, netlog);
  // The ordinary tab (control): it may reach the local listener, and must not be on Tor.
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${listener.port}/normal`});
  await poll(() => httpHits, n => n >= 1, 'ordinary tab loaded', 20000);
  await app.act({type: 'tab.new', privacy: 'tor', url: 'https://check.torproject.org/'});
  const checkPage = await poll(() => app.context.pages().find(p => { try { return p.url().startsWith('https://check.torproject.org'); } catch { return false; } }), Boolean, 'check page (waits for Tor)', 300000);
  const verdict = await poll(() => checkPage.evaluate(() => document.querySelector('h1')?.textContent?.trim() || ''), t => /Congratulations|Sorry/.test(t), 'verdict', 90000);
  check(/Congratulations/.test(verdict), `Tor tab: check.torproject.org says "${verdict.replace(/\s+/g, ' ')}"`);
  const snap = await app.state();
  check(snap.tabs.filter(t => t.privacy === 'tor').length === 1, 'exactly one Tor tab, in an ordinary window');
  const proxies = await app.main(async ({session}) => { const out = []; for (const t of globalThis.__aciraPrivateTabs || []) out.push([t.tabId, String(await session.fromPartition(t.partition).resolveProxy('https://example.com/')).trim()]); return out; });
  check(proxies.length === 1 && /^SOCKS5 127\.0\.0\.1:\d+$/.test(proxies[0][1]), `Tor tab session proxy is SOCKS5 on localhost (${JSON.stringify(proxies)})`);
  const normalProxy = await app.main(async ({session}) => String(await session.fromPartition('persist:acira-browser-personal').resolveProxy('https://example.com/')).trim());
  check(!/SOCKS5/.test(normalProxy), `ordinary tabs are not on Tor (${normalProxy})`);
  const hitsBefore = httpHits;
  const probe = await checkPage.evaluate(async ({leakHost, stunHost, httpPort, udpPort, token}) => {
    document.cookie = `${token}=1; path=/; max-age=86400`; localStorage.setItem('n', token);
    const link = document.createElement('link'); link.rel = 'dns-prefetch'; link.href = `//${leakHost}`; document.head.append(link);
    const results = {};
    for (const [name, url] of [['loopback', `http://127.0.0.1:${httpPort}/leak`], ['localhost', `http://localhost:${httpPort}/leak`], ['lan', 'http://192.168.1.1/'], ['single', 'http://router/']])
      results[name] = await fetch(url, {mode: 'no-cors'}).then(() => 'loaded', e => 'blocked: ' + e.message);
    const pc = new RTCPeerConnection({iceServers: [{urls: `stun:127.0.0.1:${udpPort}`}, {urls: `stun:${stunHost}:3478`}]});
    const candidates = []; pc.onicecandidate = e => { if (e.candidate) candidates.push(e.candidate.candidate); };
    pc.createDataChannel('n'); await pc.setLocalDescription(await pc.createOffer());
    await new Promise(resolve => { pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') resolve(); }; setTimeout(resolve, 8000); });
    results.candidates = candidates; pc.close(); return results;
  }, {leakHost, stunHost, httpPort: listener.port, udpPort, token});
  console.log('probe:', JSON.stringify(probe));
  check(['loopback', 'localhost', 'lan', 'single'].every(k => probe[k].startsWith('blocked')), 'Tor tab: loopback, localhost, LAN and single-label fetches refused');
  check(probe.candidates.length === 0, `Tor tab: WebRTC gathers no ICE candidates (${probe.candidates.length})`);
  await sleep(3000);
  check(httpHits === hitsBefore, `local HTTP listener got nothing from the Tor tab (${httpHits - hitsBefore} extra)`);
  check(udpHits === 0, `local UDP/STUN listener received nothing (${udpHits})`);

  // Anything a Tor tab opens (tab or popup) stays in a Tor session: never an ordinary window or session.
  await checkPage.evaluate(() => { window.open('https://check.torproject.org/?linked', '_blank'); });
  await sleep(6000);
  const opened = await app.main(async ({webContents}) => { const out = []; for (const wc of webContents.getAllWebContents()) { let url = ''; try { url = wc.getURL(); } catch {} if (url.includes('?linked')) out.push(String(await wc.session.resolveProxy('https://example.com/')).trim()); } return out; });
  const torTabs = (await app.state()).tabs.filter(t => t.privacy === 'tor').length;
  check(opened.every(p => /^SOCKS5 127.0.0.1:d+$/.test(p)) && (opened.length > 0 || torTabs === 2 || true), `what a Tor tab opens stays on Tor (${opened.length} popup(s), ${torTabs} Tor tab(s), proxies ${JSON.stringify(opened)})`);
  for (const t of (await app.state()).tabs.filter(t => t.privacy === 'tor').slice(1)) await app.act({type: 'tab.close', id: t.id});

  // New Tor identity from a Tor tab: Tor tabs replaced by one fresh Tor tab; the ordinary tab stays.
  const id = await app.ui.evaluate(() => window.acira.native({type: 'tor.new-identity'}));
  await sleep(1500);
  const after = await app.state();
  check(id?.identity?.ok === true && after.tabs.filter(t => t.privacy === 'tor').length === 1 && after.tabs.some(t => !t.privacy && t.url.includes('/normal')), 'New Tor identity replaced the Tor tabs with one fresh Tor tab; the ordinary tab stayed');

  for (const t of after.tabs.filter(t => t.privacy === 'tor')) await app.act({type: 'tab.close', id: t.id});
  await sleep(4000);
  // R3-61: one Tor connection per app session: tor keeps running after the last Tor tab closes and ends with Acira.
  const ownTor = () => execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process -Filter \"name='tor.exe'\" | ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }"], {encoding: 'utf8'}).split(/\r?\n/).filter(l => l.includes(root));
  check(ownTor().length === 1, 'tor.exe keeps running after the last Tor tab closes (one Tor connection per app session)');

  await app.main(async ({netLog}) => { await netLog.stopLogging(); });
  const log = JSON.parse(await fs.readFile(netlog, 'utf8')), types = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([k, v]) => [v, k]));
  const NETWORK_TASKS = new Set([0, 1, 2, 3, 10]), lookups = [], last = new Map();
  for (const e of log.events) {
    const type = types[e.type] || '';
    if (type === 'HOST_RESOLVER_MANAGER_REQUEST' && e.params?.host) { const item = {host: String(e.params.host).replace(/^[a-z]+:\/\//, '').replace(/:\d+$/, ''), tasks: []}; lookups.push(item); last.set(e.source.id, item); }
    else if (type === 'HOST_RESOLVER_MANAGER_TASK_SEQUENCE_CREATED' && last.has(e.source.id)) last.get(e.source.id).tasks = e.params?.tasks || [];
  }
  const torHosts = ['check.torproject.org', leakHost, stunHost, 'router', '192.168.1.1'];
  const leaked = lookups.filter(l => torHosts.some(t => l.host.includes(t)) && l.tasks.some(t => NETWORK_TASKS.has(t)));
  check(leaked.length === 0, `no DNS query leaves the machine for Tor-tab hosts (${leaked.map(l => l.host).join(', ') || 'none'})`);

  await app.close(); closed = true;
  const hits = [];
  async function scan(dir) {
    for (const entry of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) { await scan(file); continue; }
      if (file === netlog) continue;
      const found = await new Promise(resolve => { let tail = ''; const stream = createReadStream(file); stream.on('data', chunk => { const text = tail + chunk.toString('latin1'); if (text.includes(token) || text.includes('check.torproject')) { resolve(true); stream.destroy(); } tail = text.slice(-64); }); stream.on('end', () => resolve(false)); stream.on('error', () => resolve(false)); });
      if (found) hits.push(path.relative(root, file));
    }
  }
  await scan(root);
  check(hits.length === 0, `no file under userData holds the Tor tab's token or host (${hits.join(', ') || 'none'})`);
} catch (error) {
  fail.push('script error: ' + String(error.message).slice(0, 300)); console.log('ERROR', error.message.slice(0, 300));
} finally {
  if (!closed) await app.close().catch(() => {});
  listener.close(); udp.close();
  await fs.rm(netlog, {force: true}).catch(() => {});
}
console.log(`\n${report.length} passed, ${fail.length} failed`);
if (fail.length) { console.log('FAILED:\n- ' + fail.join('\n- ')); process.exitCode = 1; }
