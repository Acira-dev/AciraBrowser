// Packet-level leak proof for Tor (docs/launch/TOR_HARDENING.md §1). One real app on a disposable profile, Acira's ordinary
// background traffic switched off (ACIRA_TEST_QUIET_NETWORK=1, honoured only with ACIRA_BROWSER_TEST_DATA), then Tor browsing.
// Three independent recorders run for the whole life of the app, from before launch until after it has closed:
//  1. sockets: every TCP connection and UDP endpoint owned by every process descended from this rig (Electron main, renderers,
//     GPU, network service, tor.exe, pluggable transports), read from the kernel's tables (GetExtendedTcpTable /
//     GetExtendedUdpTable) every 50 ms by a small C# poller, with each process's command line;
//  2. Windows DNS: a transient ETW session on Microsoft-Windows-DNS-Client (no settings changed, nothing kept but the queries
//     made by Acira's own processes; the raw trace is deleted). ETW needs an administrator; without one, Windows' DNS cache is
//     read before launch and after close instead (Get-DnsClientCache): every name Acira could have asked Windows for (the probe
//     names, which exist nowhere else, and every host browsed in Tor) must not be new in it. Other programs' names are not kept;
//  3. Chromium's NetLog (--log-net-log) from the first moment: every TCP connect, the URL that caused it, every host lookup.
// Then it proves: the only non-loopback connections belong to tor.exe (and its pluggable transports when bridges are on), and
// each of tor.exe's peers is a relay in the consensus it downloaded or a directory authority / fallback compiled into tor.exe;
// no browser process holds any socket to anything but 127.0.0.1; Acira asks Windows to resolve no name; no certificate
// revocation or AIA fetch leaves outside Tor.
//   node qa/r9-tor-packets.mjs                 quiet profile, Tor tab + Tor window browsing, full proof
//   node qa/r9-tor-packets.mjs --observe       ordinary background traffic left on: lists what the ordinary app contacts and why
//   node qa/r9-tor-packets.mjs --reuse         keep the profile (tor's relay cache) between runs: faster bootstrap
//   node qa/r9-tor-packets.mjs --bridges=obfs4 | --bridges=snowflake | --bridges=meek   connect through a built-in bridge
// One app, ≤ 6 tabs, a native slot held, everything closed in finally. Results: .qa-profiles/r9-tor-packets*/report.json
import fs from 'node:fs/promises';
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {startApp, sleep, poll} from './d-harness.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';
// The PC's three native slots are shared by many QA sessions: this rig waits up to 90 minutes for one (one app at a time still).
const withSlot = async (name, work) => { const file = await takeSlot(name, {waitMs: 90 * 60_000}); try { return await work(file); } finally { await releaseSlot(file); } };

const argv = process.argv.slice(2), flag = name => argv.includes(name), option = name => argv.find(a => a.startsWith(name + '='))?.split('=')[1];
let observe = flag('--observe'), bridges = option('--bridges') || '';
const reuse = flag('--reuse'), analyzeOnly = option('--analyze');
const root = analyzeOnly ? path.resolve(analyzeOnly) : path.resolve(`.qa-profiles/r9-tor-packets${observe ? '-observe' : ''}${bridges ? '-' + bridges : ''}${reuse ? '' : '-' + Date.now()}`);
if (!root.startsWith(path.resolve('.qa-profiles') + path.sep)) throw new Error('profiles live under .qa-profiles');
const FEED = 'https://aus1.torproject.org/torbrowser/update_3/release/download-windows-x86_64.json';
const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
let token = 'r9p' + randomUUID().replace(/-/g, '').slice(0, 12);
const loopback = address => /^(127\.|::1$|0:0:0:0:0:0:0:1$|::ffff:127\.)/.test(address);
// A TCP row with no peer yet (a listener, or a connect not started) reads 0.0.0.0:0; it says nothing about where it goes.
const unconnected = endpoint => /^(0\.0\.0\.0|\[0:0:0:0:0:0:0:0\]|\[::\]):0$/.test(endpoint);
const marks = [];
const mark = label => { marks.push({t: Date.now(), label}); console.log(`-- ${label}`); };

// The poller: C# compiled by Windows PowerShell's Add-Type (no download, no admin). It writes one JSON line per new process,
// command line, TCP row (pid, local, remote, state) and UDP endpoint, until the stop file appears.
const POLLER = String.raw`
param([int]$Root, [string]$Out, [string]$Stop)
$cs = @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text; using System.Threading; using System.IO; using System.Management;
public static class AciraNetMon {
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr t, ref int size, bool order, int af, int cls, uint r);
  [DllImport("iphlpapi.dll")] static extern uint GetExtendedUdpTable(IntPtr t, ref int size, bool order, int af, int cls, uint r);
  [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr h, ref PE pe);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr h, ref PE pe);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct PE { public uint size, usage, pid; public IntPtr heap; public uint module, threads, ppid; public int prio; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe; }
  static HashSet<uint> tracked = new HashSet<uint>(); static HashSet<string> seen = new HashSet<string>(); static object gate = new object(); static StreamWriter w;
  static Queue<uint> pending = new Queue<uint>();
  static long Now() { return DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(); }
  static string Esc(string s) { if (s == null) return ""; var b = new StringBuilder(); foreach (var c in s) { if (c == '\\' || c == '"') b.Append('\\').Append(c); else if (c < 32) b.Append(' '); else b.Append(c); } return b.ToString(); }
  static void Emit(string json) { lock (gate) { w.WriteLine(json); w.Flush(); } }
  static string V4(uint a) { return (a & 255) + "." + ((a >> 8) & 255) + "." + ((a >> 16) & 255) + "." + ((a >> 24) & 255); }
  static int Port(uint p) { return (int)(((p & 255) << 8) | ((p >> 8) & 255)); }
  static string V6(byte[] b) { var s = new StringBuilder(); for (int i = 0; i < 16; i += 2) { if (i > 0) s.Append(':'); s.Append(((b[i] << 8) | b[i + 1]).ToString("x")); } return s.ToString(); }
  static IntPtr Table(bool tcp, int af, int cls) { int size = 0; if (tcp) GetExtendedTcpTable(IntPtr.Zero, ref size, false, af, cls, 0); else GetExtendedUdpTable(IntPtr.Zero, ref size, false, af, cls, 0); size += 4096; IntPtr p = Marshal.AllocHGlobal(size); uint r = tcp ? GetExtendedTcpTable(p, ref size, false, af, cls, 0) : GetExtendedUdpTable(p, ref size, false, af, cls, 0); if (r != 0) { Marshal.FreeHGlobal(p); return IntPtr.Zero; } return p; }
  static void Row(string proto, uint pid, string l, string r, int st) { if (!tracked.Contains(pid)) return; string key = proto + "|" + pid + "|" + l + "|" + r + "|" + st; if (seen.Contains(key)) return; seen.Add(key); Emit("{\"t\":" + Now() + ",\"ev\":\"" + proto + "\",\"pid\":" + pid + ",\"l\":\"" + l + "\",\"r\":\"" + r + "\",\"st\":" + st + "}"); }
  static void Procs(uint root, uint self) {
    var cur = new Dictionary<uint, PE>(); IntPtr h = CreateToolhelp32Snapshot(2, 0); var pe = new PE(); pe.size = (uint)Marshal.SizeOf(typeof(PE));
    if (Process32FirstW(h, ref pe)) { do { cur[pe.pid] = pe; } while (Process32NextW(h, ref pe)); } CloseHandle(h);
    foreach (var pid in new List<uint>(tracked)) if (!cur.ContainsKey(pid)) { tracked.Remove(pid); Emit("{\"t\":" + Now() + ",\"ev\":\"exit\",\"pid\":" + pid + "}"); }
    for (int round = 0, grew = 1; grew > 0 && round < 16; round++) { grew = 0; foreach (var kv in cur) { var p = kv.Value; if (p.pid == self || tracked.Contains(p.pid)) continue; if (p.ppid == root || tracked.Contains(p.ppid)) { tracked.Add(p.pid); grew++; Emit("{\"t\":" + Now() + ",\"ev\":\"proc\",\"pid\":" + p.pid + ",\"ppid\":" + p.ppid + ",\"name\":\"" + Esc(p.exe) + "\"}"); lock (pending) pending.Enqueue(p.pid); } } }
  }
  static void Commands() { for (;;) { uint pid = 0; lock (pending) { if (pending.Count > 0) pid = pending.Dequeue(); } if (pid == 0) { Thread.Sleep(20); continue; } try { using (var s = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId=" + pid)) foreach (ManagementObject o in s.Get()) Emit("{\"t\":" + Now() + ",\"ev\":\"cmd\",\"pid\":" + pid + ",\"cmd\":\"" + Esc((string)o["CommandLine"]) + "\"}"); } catch {} } }
  public static void Run(int root, string outFile, string stopFile, uint self) {
    w = new StreamWriter(outFile, false, new UTF8Encoding(false)); var t = new Thread(Commands); t.IsBackground = true; t.Start();
    Emit("{\"t\":" + Now() + ",\"ev\":\"ready\"}"); long polls = 0;
    while (!File.Exists(stopFile)) {
      Procs((uint)root, self); polls++;
      IntPtr p = Table(true, 2, 5); if (p != IntPtr.Zero) { int n = Marshal.ReadInt32(p); for (int i = 0; i < n; i++) { IntPtr r = p + 4 + i * 24; uint st = (uint)Marshal.ReadInt32(r), la = (uint)Marshal.ReadInt32(r + 4), lp = (uint)Marshal.ReadInt32(r + 8), ra = (uint)Marshal.ReadInt32(r + 12), rp = (uint)Marshal.ReadInt32(r + 16), pid = (uint)Marshal.ReadInt32(r + 20); Row("tcp", pid, V4(la) + ":" + Port(lp), st == 2 ? "" : V4(ra) + ":" + Port(rp), (int)st); } Marshal.FreeHGlobal(p); }
      p = Table(true, 23, 5); if (p != IntPtr.Zero) { int n = Marshal.ReadInt32(p); for (int i = 0; i < n; i++) { IntPtr r = p + 4 + i * 56; var la = new byte[16]; var ra = new byte[16]; Marshal.Copy(r, la, 0, 16); uint lp = (uint)Marshal.ReadInt32(r + 20); Marshal.Copy(r + 24, ra, 0, 16); uint rp = (uint)Marshal.ReadInt32(r + 44), st = (uint)Marshal.ReadInt32(r + 48), pid = (uint)Marshal.ReadInt32(r + 52); Row("tcp6", pid, "[" + V6(la) + "]:" + Port(lp), st == 2 ? "" : "[" + V6(ra) + "]:" + Port(rp), (int)st); } Marshal.FreeHGlobal(p); }
      p = Table(false, 2, 1); if (p != IntPtr.Zero) { int n = Marshal.ReadInt32(p); for (int i = 0; i < n; i++) { IntPtr r = p + 4 + i * 12; uint la = (uint)Marshal.ReadInt32(r), lp = (uint)Marshal.ReadInt32(r + 4), pid = (uint)Marshal.ReadInt32(r + 8); Row("udp", pid, V4(la) + ":" + Port(lp), "", 0); } Marshal.FreeHGlobal(p); }
      p = Table(false, 23, 1); if (p != IntPtr.Zero) { int n = Marshal.ReadInt32(p); for (int i = 0; i < n; i++) { IntPtr r = p + 4 + i * 28; var la = new byte[16]; Marshal.Copy(r, la, 0, 16); uint lp = (uint)Marshal.ReadInt32(r + 20), pid = (uint)Marshal.ReadInt32(r + 24); Row("udp6", pid, "[" + V6(la) + "]:" + Port(lp), "", 0); } Marshal.FreeHGlobal(p); }
      Thread.Sleep(50);
    }
    Emit("{\"t\":" + Now() + ",\"ev\":\"stop\",\"polls\":" + polls + "}"); lock (gate) w.Close();
  }
}
'@
Add-Type -TypeDefinition $cs -Language CSharp -ReferencedAssemblies System.Management
[AciraNetMon]::Run($Root, $Out, $Stop, [uint32]$PID)
`;

const ETW_SESSION = 'acira-r9-tor-packets-dns', ETW_SOCKETS = 'acira-r9-tor-packets-afd';
const ps = command => execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {encoding: 'utf8', windowsHide: true}).trim();
/** Names in Windows' DNS client cache right now (lower case), kept only in memory. */
const dnsCache = () => { try { return new Set(ps('Get-DnsClientCache | ForEach-Object { $_.Entry }').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean)); } catch { return null; } };
// What the Tor browsing below touches: if any of these is new in Windows' cache afterwards, something asked Windows outside Tor.
const TOR_HOSTS = ['check.torproject.org', 'aus1.torproject.org', 'en.wikipedia.org', 'duckduckgo.com', 'www.torproject.org', 'www.digicert.com', 'example.com', 'incomplete-chain.badssl.com', 'revoked.badssl.com'];
// Certificate revocation and intermediate (AIA) hosts of the CAs those sites use: a fetch by Windows' CryptoAPI would resolve them.
const CERT_HOSTS = /^(ocsp|crl\d*|cacerts|aia|crt|ocsp\.pki|crl\.pki|c\.pki|x\d+\.[ci]|r\d+\.[ci]|e\d+\.[ci]|ocsp\.(digicert|sectigo|usertrust|comodoca|globalsign|godaddy|entrust|letsencrypt|r3|int-x3|starfieldtech))\.|\.(lencr\.org|digicert\.com|pki\.goog|globalsign\.(com|net)|sectigo\.com|usertrust\.com|entrust\.net)$/;
const logman = args => { try { return execFileSync('logman', args, {encoding: 'utf8', windowsHide: true}); } catch (error) { return String(error.stdout || error.message); } };

/** Relay and authority addresses tor.exe may talk to: the consensus it downloaded, plus the authorities and fallbacks compiled into the binary. */
function torPeers(dataDirectory, torExe) {
  const peers = new Set();
  for (const name of ['cached-microdesc-consensus', 'cached-microdesc-consensus.new', 'cached-consensus']) {
    const file = path.join(dataDirectory, name); if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'latin1').split('\n')) {
      let m = /^r \S+ \S+ (?:\S+ )?\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (\d+\.\d+\.\d+\.\d+) (\d+)/.exec(line); if (m) { peers.add(m[1]); continue; }
      m = /^a \[([0-9a-f:]+)\]:(\d+)/i.exec(line); if (m) peers.add(m[1].toLowerCase());
    }
  }
  const consensus = peers.size;
  if (torExe && existsSync(torExe)) { const text = readFileSync(torExe, 'latin1'); for (const m of text.matchAll(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d{1,5} (?:orport=\d+ )?id=[0-9A-F]{40}|\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):\d{2,5} [0-9A-F]{4} [0-9A-F]{4}/g)) peers.add(m[1] || m[2]); }
  return {peers, consensus, compiled: peers.size - consensus};
}
const expand6 = address => { if (!address.includes(':')) return address; const [head, tail = ''] = address.split('::'); const h = head ? head.split(':') : [], t = tail ? tail.split(':') : []; return [...h, ...Array(8 - h.length - t.length).fill('0'), ...t].map(x => parseInt(x || '0', 16).toString(16)).join(':'); };
const hostOf = endpoint => endpoint.startsWith('[') ? endpoint.slice(1, endpoint.indexOf(']')) : endpoint.split(':')[0];

/** NetLog: every TCP connect attempt with the request URL / socket group that caused it, every proxy decision, every host lookup. */
function readNetLog(file) {
  const out = {connects: [], requests: new Map(), lookups: [], certFetches: [], eventTypes: new Set()};
  if (!existsSync(file)) return out;
  const text = readFileSync(file, 'utf8').trim();
  // A NetLog cut short (the app was killed) has no closing brackets: close the events array by hand.
  let log; try { log = JSON.parse(text); } catch { try { log = JSON.parse(text.replace(/,?\s*$/, '') + ']}'); } catch (error) { out.error = error.message; return out; } }
  const names = Object.fromEntries(Object.entries(log.constants.logEventTypes).map(([k, v]) => [v, k]));
  const sources = Object.fromEntries(Object.entries(log.constants.logSourceType).map(([k, v]) => [v, k]));
  const bySource = new Map(), parentOf = new Map();
  for (const e of log.events || []) {
    const name = names[e.type] || String(e.type); out.eventTypes.add(name);
    const id = e.source?.id; if (!bySource.has(id)) bySource.set(id, {type: sources[e.source?.type], group: '', url: '', proxy: ''});
    const s = bySource.get(id), p = e.params || {};
    if (p.source_dependency?.id !== undefined) { if (!parentOf.has(id)) parentOf.set(id, new Set()); parentOf.get(id).add(p.source_dependency.id); }
    if (p.group_id && !s.group) s.group = String(p.group_id);
    if (p.url && !s.url) s.url = String(p.url);
    if (name === 'PROXY_RESOLUTION_SERVICE_RESOLVED_PROXY_LIST' && p.proxy_info) s.proxy = String(p.proxy_info);
    if (name === 'URL_REQUEST_START_JOB' && p.url) out.requests.set(id, {url: p.url, method: p.method, proxy: ''});
    if (/^TCP_CONNECT(_ATTEMPT)?$/.test(name) && e.phase === 1 && (p.address || p.remote_address)) out.connects.push({t: e.time, id, address: String(p.address || p.remote_address)});
    if (name === 'HOST_RESOLVER_MANAGER_JOB' || name === 'HOST_RESOLVER_DNS_TASK' || name === 'HOST_RESOLVER_SYSTEM_TASK') { if (p.host) out.lookups.push({name, host: String(p.host), id}); }
    if (name === 'HOST_RESOLVER_MANAGER_JOB_REQUEST_ATTACH' || name === 'HOST_RESOLVER_MANAGER_REQUEST') { if (p.host) out.lookups.push({name, host: String(p.host), id}); }
    if (name === 'HOST_RESOLVER_MANAGER_TASK_SEQUENCE_CREATED' || name === 'HOST_RESOLVER_MANAGER_JOB_STARTED') { const l = out.lookups.findLast?.(x => x.id === id); if (l && p.task_sequence) l.sequence = p.task_sequence; }
    if (name === 'CERT_VERIFIER_JOB' && p.host) s.certHost = String(p.host);
  }
  for (const [id, r] of out.requests) { const s = bySource.get(id); if (s?.proxy) r.proxy = s.proxy; if (/^https?:\/\/(?:ocsp|crl|cacerts|aia|crt|r\d+\.o\.|x\d+\.c\.|c\.pki|ocsp\.pki)\b/i.test(r.url) || /\.(?:crl|crt|p7c|der)(?:$|\?)/i.test(r.url)) out.certFetches.push(r); }
  // Walk each connect up its source dependencies until something says what it was for.
  const describe = id => { const seen = new Set(), queue = [id]; let found = {group: '', url: '', proxy: ''};
    while (queue.length && seen.size < 40) { const cur = queue.shift(); if (seen.has(cur)) continue; seen.add(cur); const s = bySource.get(cur); if (s) { found.group ||= s.group; found.url ||= s.url; found.proxy ||= s.proxy; found.type ||= s.type; }
      for (const [child, parents] of parentOf) if (parents.has(cur) && !seen.has(child)) queue.push(child); for (const parent of parentOf.get(cur) || []) queue.push(parent); }
    return found; };
  for (const c of out.connects) Object.assign(c, describe(c.id));
  return out;
}

const report = {root, observe, bridges, token, started: new Date().toISOString()};
let dnsBefore = null;
async function record() {
  if (!reuse) await fs.rm(root, {recursive: true, force: true});
  await fs.mkdir(path.join(root, 'tor'), {recursive: true});
  // The engine updater's weekly check is marked as done: left alone it could download a newer Tor bundle (a binary) during
  // the capture. The same path (the engine's fetch through Tor) is exercised below with the update feed, which is JSON.
  await fs.writeFile(path.join(root, 'tor', 'update.json'), JSON.stringify({auto: true, lastChecked: Date.now(), installed: null, latest: null, error: null}));
  const polls = path.join(root, 'sockets.jsonl'), stop = path.join(root, 'sockets.stop'), etl = path.join(root, 'dns.etl'), netlog = path.join(root, 'netlog.json');
  await fs.rm(stop, {force: true}); await fs.rm(etl, {force: true});
  await fs.writeFile(path.join(root, 'poller.ps1'), POLLER);
  const poller = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'poller.ps1'), '-Root', String(process.pid), '-Out', polls, '-Stop', stop], {windowsHide: true, stdio: ['ignore', 'ignore', 'pipe']});
  let pollerError = ''; poller.stderr.on('data', d => { pollerError += d; });
  await poll(async () => (await fs.readFile(polls, 'utf8').catch(() => '')).includes('"ready"'), Boolean, 'socket poller ready (C# compile)', 60000).catch(error => { throw new Error(error.message + ' ' + pollerError); });
  const afd = path.join(root, 'afd.etl'); await fs.rm(afd, {force: true});
  for (const name of [ETW_SESSION, ETW_SOCKETS]) logman(['stop', name, '-ets']); // sessions left by an interrupted run (our own names only)
  const etwStart = logman(['start', ETW_SESSION, '-p', 'Microsoft-Windows-DNS-Client', '0xffffffffffffffff', '0xff', '-o', etl, '-ets']);
  report.dnsTrace = /successfully/i.test(etwStart) ? 'etw' : 'cache';
  if (report.dnsTrace === 'cache') { report.dnsEtwUnavailable = etwStart.trim().split(/\r?\n/).slice(-1)[0]; dnsBefore = dnsCache(); }
  // Kernel socket calls (Winsock AFD): every connect() and every UDP sendto() with its destination, per process. Unlike the
  // table poller this misses nothing, however short-lived; a datagram that leaves shows here even if its socket lived 1 ms.
  const afdStart = logman(['start', ETW_SOCKETS, '-p', 'Microsoft-Windows-Winsock-AFD', '0xffffffffffffffff', '0xff', '-bs', '1024', '-nb', '16', '64', '-o', afd, '-ets']);
  report.socketTrace = /successfully/i.test(afdStart) ? 'etw' : 'unavailable: ' + afdStart.trim();
  console.log(`recorders: socket tables every 50 ms, kernel socket calls ${report.socketTrace}, Windows DNS ${report.dnsTrace}, NetLog ${netlog}`);
  const env = observe ? {} : {ACIRA_TEST_QUIET_NETWORK: '1', ACIRA_SPELLCHECK_DICTIONARY_URL: 'http://127.0.0.1:9/'};
  let app;
  try {
    mark('launch');
    app = await startApp({root, args: [`--log-net-log=${netlog}`, '--net-log-capture-mode=Default'], env});
    report.mainPid = app.app.process().pid;
    mark('ordinary window idle');
    await sleep(observe ? 60000 : 25000);
    if (bridges) {
      const set = await app.ui.evaluate(kind => window.acira.native({type: 'tor.bridges-set', bridges: {mode: 'builtin', builtin: kind}}), bridges);
      console.log('bridges', JSON.stringify(set?.torBridges || set));
    }
    mark('Tor tab: check.torproject.org');
    const started = Date.now();
    await app.act({type: 'tab.new', privacy: 'tor', url: 'https://check.torproject.org/'});
    // While waiting: what Tor and the tab are doing, every 20 s (a stuck run says where it is stuck).
    const watch = setInterval(async () => { try { const s = await app.main(() => { const e = globalThis.__aciraTorEngine?.status?.(); return e && {state: e.state, progress: e.progress, blocked: Boolean(e.blocked), error: e.error?.code || null}; }); const tabs = (await app.state()).tabs.map(t => `${t.privacy || 'normal'}:${t.url}`); console.log('  waiting', JSON.stringify(s), JSON.stringify(tabs), app.context.pages().map(p => { try { return p.url().slice(0, 40); } catch { return '?'; } }).join(' | ')); } catch (error) { console.log('  waiting (no status)', error.message); } }, 20000);
    const page = await poll(() => app.web('https://check.torproject.org'), Boolean, 'check page (waits for Tor)', 420000).finally(() => clearInterval(watch));
    const verdict = await poll(() => page.evaluate(() => document.querySelector('h1')?.textContent?.trim() || ''), t => /Congratulations|Sorry/.test(t), 'verdict', 120000);
    report.bootstrapSeconds = Math.round((Date.now() - started) / 1000);
    check(/Congratulations/.test(verdict), `Tor tab loads check.torproject.org through Tor ("${verdict.replace(/\s+/g, ' ')}", ${report.bootstrapSeconds}s)`);
    // Probes by unique names: a dns-prefetch hint, a preconnect, a third-party fetch, an image, a WebSocket and a STUN server.
    await page.evaluate(token => { for (const rel of ['dns-prefetch', 'preconnect']) { const l = document.createElement('link'); l.rel = rel; l.href = `https://${token}-${rel}.example/`; document.head.append(l); }
      fetch(`https://${token}-fetch.example/x`, {mode: 'no-cors'}).catch(() => {}); const img = new Image(); img.src = `http://${token}-img.example/i.png`;
      try { new WebSocket(`wss://${token}-ws.example/`); } catch {} try { const pc = new RTCPeerConnection({iceServers: [{urls: `stun:${token}-stun.example:3478`}]}); pc.createDataChannel('x'); pc.createOffer().then(o => pc.setLocalDescription(o)); } catch {} }, token);
    await sleep(5000);
    mark('engine fetch (Tor updater path): update feed');
    const feed = await app.main(async (_electron, url) => { try { const r = await globalThis.__aciraTorEngine.fetch(url); const text = await r.text(); return {status: r.status, version: JSON.parse(text).version || ''}; } catch (error) { return {error: String(error.message || error)}; } }, FEED);
    check(feed.status === 200 && /^\d+\.\d+/.test(feed.version || ''), `the Tor updater's fetch reaches Tor Project's update feed through Tor (${JSON.stringify(feed)})`);
    mark('Tor window: several sites with third parties');
    const before = new Set(app.context.pages());
    await app.ui.evaluate(() => window.acira.openWindow('tor'));
    const torUi = await poll(async () => { for (const p of app.context.pages()) { if (before.has(p)) continue; try { if (p.url() === 'acira-browser-ui://ui/index.html') return p; } catch {} } }, Boolean, 'tor window ui', 30000);
    await poll(() => torUi.evaluate(() => Boolean(window.acira?.getSnapshot)), Boolean, 'tor window acira', 30000);
    // Ordinary sites, then two certificate cases: a server that sends no intermediate (the verifier must fetch it, AIA) and a revoked
    // certificate (where an OS revocation lookup, OCSP or CRL, would show up outside Tor if Chromium asked Windows for one).
    const sites = ['https://en.wikipedia.org/wiki/Tor_(network)', 'https://duckduckgo.com/?q=onion+routing', 'https://www.torproject.org/', 'https://www.digicert.com/', 'https://incomplete-chain.badssl.com/', 'https://revoked.badssl.com/'];
    for (const [i, url] of sites.entries()) {
      await torUi.evaluate(([url, first]) => window.acira.dispatch(first ? {type: 'tab.navigate', url} : {type: 'tab.new', url}), [url, i === 0]);
      const host = new URL(url).host;
      const loaded = await poll(() => app.web(u => u.includes(host)), Boolean, 'tor window page ' + host, 120000).then(async p => { await poll(() => p.evaluate(() => document.readyState), s => s === 'complete', 'load ' + host, 120000).catch(() => {}); return p; }).catch(() => null);
      console.log(`  ${loaded ? 'loaded' : 'did not load'} ${url}`);
    }
    await sleep(8000);
    mark('idle after browsing');
    await sleep(10000);
    report.streams = await app.main(() => globalThis.__aciraTorIsolation?.streams?.() || null).catch(() => null);
  } finally {
    mark('close');
    try { await app?.close(); } catch {}
    await sleep(3000);
    logman(['stop', ETW_SESSION, '-ets']); logman(['stop', ETW_SOCKETS, '-ets']);
    await fs.writeFile(stop, '1'); await new Promise(resolve => { poller.once('exit', resolve); setTimeout(resolve, 8000); });
    report.marks = marks;
    if (dnsBefore) {
      // Only names Acira's Tor browsing could explain are kept (probe names, browsed hosts, certificate hosts); others are not ours to keep.
      const after = dnsCache() || new Set(), fresh = [...after].filter(name => !dnsBefore.has(name));
      const relevant = fresh.filter(name => name.includes(token) || TOR_HOSTS.includes(name) || CERT_HOSTS.test(name) || /torproject|githubusercontent|github\.com|github\.io/.test(name));
      await fs.writeFile(path.join(root, 'dns.json'), JSON.stringify({mode: 'cache', before: dnsBefore.size, after: after.size, newNames: fresh.length, relevant, browsedAlreadyCached: TOR_HOSTS.filter(name => dnsBefore.has(name))}));
    }
  }
}

async function analyze() {
  const polls = path.join(root, 'sockets.jsonl'), etl = path.join(root, 'dns.etl'), netlog = path.join(root, 'netlog.json');
  // ---- Sockets ----
  const lines = (await fs.readFile(polls, 'utf8')).split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const procs = new Map();
  for (const e of lines) { if (e.ev === 'proc') procs.set(e.pid, {pid: e.pid, ppid: e.ppid, name: e.name, cmd: '', kind: ''}); if (e.ev === 'cmd' && procs.has(e.pid)) procs.get(e.pid).cmd = e.cmd; }
  const kindOf = p => { const n = p.name.toLowerCase(); if (n === 'tor.exe') return 'tor'; if (/^(lyrebird|conjure-client|snowflake-client|obfs4proxy)\.exe$/.test(n)) return 'transport'; if (n !== 'electron.exe' && !/acira/i.test(n)) return 'harness';
    if (/prepare-native-profile/.test(p.cmd)) return 'harness'; const type = /--type=([\w-]+)/.exec(p.cmd)?.[1]; if (!type) return 'browser-main'; if (type === 'utility') return 'utility:' + (/--utility-sub-type=([\w.]+)/.exec(p.cmd)?.[1] || '?'); return type; };
  for (const p of procs.values()) p.kind = kindOf(p);
  // Each process's life (Windows reuses PIDs: an event under a PID counts only while that process lived).
  const life = new Map(); for (const e of lines) { if (e.ev === 'proc') life.set(e.pid, {from: e.t, to: Infinity}); if (e.ev === 'exit' && life.has(e.pid)) life.get(e.pid).to = e.t; }
  const alive = r => { const span = life.get(r.pid), at = Date.parse(r.t); return span && at >= span.from - 1000 && at <= span.to + 1000; };
  const socketRows = lines.filter(e => /^(tcp|tcp6|udp|udp6)$/.test(e.ev)).map(e => ({...e, proc: procs.get(e.pid)}));
  report.processes = [...procs.values()].map(({pid, ppid, name, kind}) => ({pid, ppid, name, kind}));
  report.polls = lines.find(e => e.ev === 'stop')?.polls || 0;
  const remote = socketRows.filter(e => /^tcp/.test(e.ev) && e.r && !unconnected(e.r) && !loopback(hostOf(e.r)));
  const browserRemote = remote.filter(e => !['tor', 'transport', 'harness'].includes(e.proc?.kind));
  const browserUdp = socketRows.filter(e => /^udp/.test(e.ev) && !['tor', 'transport', 'harness'].includes(e.proc?.kind) && !loopback(hostOf(e.l)));
  const torRemote = remote.filter(e => e.proc?.kind === 'tor'), ptRemote = remote.filter(e => e.proc?.kind === 'transport');
  console.log(`processes: ${[...procs.values()].filter(p => p.kind !== 'harness').map(p => p.kind).join(', ')}`);
  console.log(`socket rows ${socketRows.length} in ${report.polls} polls; remote TCP: browser ${browserRemote.length}, tor ${torRemote.length}, transports ${ptRemote.length}`);
  const torExe = path.resolve('desktop/browser-services/tor-engine/win-x64/tor.exe');
  const {peers, consensus, compiled} = torPeers(path.join(root, 'tor', 'data'), torExe);
  // The bridges tor was given: the built-in lines of the chosen type (pt_config.json) or the person's own (bridges.json).
  const bridgeHosts = new Set(); try { const conf = JSON.parse(readFileSync(path.join(root, 'tor', 'bridges.json'), 'utf8')), pt = JSON.parse(readFileSync(path.resolve('desktop/browser-services/tor-engine/pt_config.json'), 'utf8'));
    const lines = conf.mode === 'builtin' ? pt.bridges[conf.builtin] || [] : conf.mode === 'custom' ? conf.custom || [] : [];
    for (const line of lines) { const m = /(\d+\.\d+\.\d+\.\d+|\[[0-9a-f:]+\]):\d+/i.exec(line); if (m) bridgeHosts.add(m[1].replace(/^\[|\]$/g, '')); } } catch {}
  report.bridgeHosts = [...bridgeHosts];
  const torEndpoints = [...new Set(torRemote.map(e => e.r))];
  const unknownTorPeers = torEndpoints.filter(r => { const h = hostOf(r); return !peers.has(h) && !peers.has(expand6(h)) && !bridgeHosts.has(h); });
  report.sockets = {browserRemote: browserRemote.map(e => ({t: e.t, kind: e.proc?.kind, pid: e.pid, r: e.r, st: e.st})), browserUdp: browserUdp.map(e => ({kind: e.proc?.kind, l: e.l})), torEndpoints, unknownTorPeers, transportEndpoints: [...new Set(ptRemote.map(e => e.r))], relaysKnown: {consensus, compiled}};
  if (observe) console.log('ordinary app remote connections:', JSON.stringify(report.sockets.browserRemote.slice(0, 40)));
  else {
    check(browserRemote.length === 0, `no browser process (main, renderer, GPU, network service, utility) held a TCP connection to anything but 127.0.0.1, whole session (${browserRemote.length ? JSON.stringify(report.sockets.browserRemote.slice(0, 8)) : 'none'})`);
    // A UDP socket bound to the wildcard address (0.0.0.0 / ::) sends nothing by being open; whether a datagram left is the kernel
    // socket trace's question below. One bound to a specific outside address would be a choice of interface: none may exist.
    const specificUdp = browserUdp.filter(e => !/^(0\.0\.0\.0|\[0:0:0:0:0:0:0:0\]|\[::\]):\d+$/.test(e.l));
    if (browserUdp.length) console.log(`  (UDP sockets bound to the wildcard address by browser processes, traffic checked by the kernel trace: ${browserUdp.map(e => (e.proc?.kind || '?') + ' ' + e.l).join(', ')})`);
    check(specificUdp.length === 0, `no browser process bound a UDP socket to an outside interface address (${specificUdp.length ? JSON.stringify(specificUdp.slice(0, 8)) : 'none'}; wildcard-bound: ${browserUdp.length})`);
    check(torRemote.length > 0 || ptRemote.length > 0, `tor.exe${bridges ? ' / its transport' : ''} reached the Tor network (${torEndpoints.length} relay endpoints, ${report.sockets.transportEndpoints.length} transport endpoints)`);
    if (!bridges) check(consensus > 1000 && unknownTorPeers.length === 0, `every peer of tor.exe is a relay in its consensus (${consensus} relay addresses) or an authority/fallback compiled into tor.exe (${compiled}); unknown: ${unknownTorPeers.join(', ') || 'none'}`);
    else check(torRemote.length === 0, `with ${bridges} bridges tor.exe itself connects to nothing outside 127.0.0.1 (all traffic via the transport): ${torEndpoints.join(', ') || 'none'}`);
    // obfs4 bridges are plain addresses: lyrebird may talk to them and nothing else (Snowflake and meek reach CDNs and STUN servers instead).
    if (bridges === 'obfs4') { const strays = report.sockets.transportEndpoints.filter(r => !bridgeHosts.has(hostOf(r).replace(/^\[|\]$/g, ''))); check(report.sockets.transportEndpoints.length > 0 && strays.length === 0, `lyrebird (obfs4) talked only to the built-in obfs4 bridges (${report.sockets.transportEndpoints.join(', ')}; anything else: ${strays.join(', ') || 'none'})`); }
  }

  // ---- Kernel socket calls (Winsock AFD ETW): every connect / ConnectEx / sendto with an address, however short-lived ----
  const afd = path.join(root, 'afd.etl'), afdFile = path.join(root, 'afd.json');
  if (existsSync(afd)) {
    // Browser processes only (tor.exe's own sends to relays are checked against the consensus above).
    const acira = [...procs.values()].filter(p => !['harness', 'tor', 'transport'].includes(p.kind)).map(p => p.pid);
    // AFD events (measured): 1018 connect / 1021 ConnectEx "Address a:p", 1007 sendto "Addr a:p", 1003 send on a connected socket
    // (no address: matched to its endpoint's connect). Event-log XPath takes only a few "or" terms: processes go in groups of 6.
    const groups = []; for (let i = 0; i < acira.length; i += 6) groups.push(acira.slice(i, i + 6));
    // Only phase 0 ("sendto: 0:", the call itself) is logged in the calling process's context. A completion ("…: 1:") is logged in
    // whatever thread finished the I/O, often another program's (measured: QUIC to Google and other services from other apps landed
    // in Acira's GPU process), so completions are never counted. Rows also carry the time, checked against the process's life (PIDs are reused).
    const AFD_PS = String.raw`$remote=@{}; $out=New-Object System.Collections.ArrayList
Get-WinEvent -Path $args[0] -Oldest -FilterXPath $args[1] -ErrorAction Stop | ForEach-Object {
  $m = $_.Message -replace '\s+',' '; if ($m -notmatch '^\w+: 0: ') { return }
  $verb = ($m -split ':')[0]; $ep = if ($m -match 'Endpoint (0x[0-9a-fA-F]+)') { $Matches[1] } else { '' }
  if ($m -match '(?:Address|Addr) (\[?[0-9a-fA-F:.]+\]?:\d+)') { $a = $Matches[1]; [void]$out.Add("$($_.ProcessId)|$verb|$a|$($_.TimeCreated.ToString('o'))"); if ($verb -match 'connect') { if ($a -notmatch '^(127\.|\[::1\]|0\.0\.0\.0|\[::\])') { $remote[$ep] = $a } else { $remote.Remove($ep) } } }
  elseif ($_.Id -eq 1000 -or $_.Id -eq 1001) { $remote.Remove($ep) }  # socket created / closed: the endpoint address may be reused
  elseif ($verb -eq 'send' -and $remote.ContainsKey($ep)) { [void]$out.Add("$($_.ProcessId)|send-connected|$($remote[$ep])|$($_.TimeCreated.ToString('o'))") }
}
$out -join [char]10`;
    await fs.writeFile(path.join(root, 'afd.ps1'), AFD_PS);
    const rows = [];
    for (const group of groups) {
      const xpath = `*[System[(EventID=1000 or EventID=1001 or EventID=1003 or EventID=1007 or EventID=1018 or EventID=1021) and Execution[${group.map(pid => '@ProcessID=' + pid).join(' or ')}]]]`;
      let text = ''; try { text = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'afd.ps1'), afd, xpath], {encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024}); } catch (error) { if (!/No events were found/i.test(String(error.stderr || '') + error.message)) throw error; }
      for (const line of text.split(/\r?\n/).filter(Boolean)) { const [pid, verb, address, t] = line.split('|'); rows.push({pid: Number(pid), verb, address, t}); }
    }
    // A PID counts only while that process lived (from the socket poller's process records).
    report.kernelSocketsOutsideLife = rows.filter(r => !alive(r)).length;
    rows.splice(0, rows.length, ...rows.filter(alive));
    const grouped = new Map(); for (const r of rows) { const key = `${r.pid}|${r.verb}|${r.address}`; const g = grouped.get(key) || {pid: r.pid, verb: r.verb, address: r.address, count: 0, first: r.t}; g.count++; grouped.set(key, g); }
    const all = [...grouped.values()];
    await fs.writeFile(afdFile, JSON.stringify(all));
    await fs.rm(afd, {force: true}); // the raw trace holds every program's sockets: never kept (only after it was read)
  }
  if (existsSync(afdFile)) {
    let calls = []; try { calls = [].concat(JSON.parse(readFileSync(afdFile, 'utf8') || '[]')).filter(Boolean); } catch {}
    const outward = calls.filter(c => /^(connect|ConnectEx|sendto|send-connected)$/i.test(c.verb) && !loopback(hostOf(c.address)) && !/^(0\.0\.0\.0|\[?::\]?|\[0:0:0:0:0:0:0:0\]):/.test(c.address)).map(c => ({...c, kind: procs.get(c.pid)?.kind}));
    // Chromium's IPv6 reachability probe (HostResolverManager: a UDP socket connect()ed to Google's public DNS address, port 443, to
    // ask Windows whether an IPv6 route exists). A UDP connect sends nothing; it is a probe only if no TCP connection to that address
    // exists in the socket tables and no datagram was sent to it.
    const PROBE = /^\[2001:4860:4860::8888\]:443$/, probeHost = '2001:4860:4860:0:0:0:0:8888';
    const probeTcp = socketRows.some(e => /^tcp/.test(e.ev) && e.r && (hostOf(e.r) === '8.8.8.8' || expand6(hostOf(e.r).replace(/^\[|\]$/g, '')) === expand6('2001:4860:4860::8888')));
    // WebRTC asks the same way for the default route (rtc NetworkManager: UDP connect to 8.8.8.8:53 / [2001:4860:4860::8888]:53).
    const PROBES = /^(\[2001:4860:4860::8888\]:(443|53)|8\.8\.8\.8:53)$/;
    const probeSent = calls.some(c => PROBES.test(c.address) && !/^connect$/i.test(c.verb));
    const isProbe = c => PROBES.test(c.address) && /^connect$/i.test(c.verb) && !probeTcp && !probeSent;
    const browserCalls = outward.filter(c => !['tor', 'transport', 'harness'].includes(c.kind) && !isProbe(c));
    report.kernelSockets = {calls: calls.length, routeProbes: outward.filter(isProbe).map(({pid, count, kind, address}) => ({pid, count, kind, address})), outward: outward.map(({pid, verb, address, count, kind}) => ({pid, verb, address, count, kind}))};
    if (!observe && report.kernelSockets.routeProbes.length) console.log(`  (route probes, UDP connect with no datagram and no TCP connection: ${report.kernelSockets.routeProbes.map(p => p.address + ' x' + p.count + ' ' + p.kind).join(', ')})`);
    if (observe) console.log('ordinary app kernel socket calls outward:', JSON.stringify(browserCalls.slice(0, 20)));
    else check(browserCalls.length === 0, `kernel socket calls (Winsock AFD ETW, ${calls.length} addressed calls by Acira's processes): no browser process connected or sent a datagram to anything but 127.0.0.1 (${JSON.stringify(browserCalls.slice(0, 6)) || 'none'})`);
  }

  // ---- Windows DNS (ETW) ----
  const dnsFile = path.join(root, 'dns.json');
  if (existsSync(etl)) {
    const acira = [...procs.values()].filter(p => p.kind !== 'harness').map(p => p.pid);
    const json = ps(`$ids=@(${acira.join(',') || 0}); $all=Get-WinEvent -Path '${etl}' -Oldest -ErrorAction SilentlyContinue; $mine=@($all | Where-Object { $_.Id -eq 3006 -and $ids -contains $_.ProcessId } | ForEach-Object { [pscustomobject]@{t=$_.TimeCreated.ToString('o'); pid=$_.ProcessId; name=[string]$_.Properties[0].Value} }); [pscustomobject]@{total=@($all).Count; mine=$mine} | ConvertTo-Json -Depth 4 -Compress`);
    await fs.writeFile(dnsFile, json || '{}');
    await fs.rm(etl, {force: true}); // other programs' lookups are never kept
  }
  let cacheMode = null; try { cacheMode = JSON.parse(readFileSync(dnsFile, 'utf8')); if (cacheMode.mode !== 'cache') cacheMode = null; } catch {}
  if (cacheMode) {
    report.windowsDns = cacheMode;
    if (observe) console.log('ordinary app: names new in Windows DNS cache that Acira could explain:', cacheMode.relevant.join(', ') || 'none');
    else check(cacheMode.relevant.length === 0, `Windows DNS cache (no administrator, so no ETW trace): none of the probe names, browsed Tor hosts or certificate hosts is new after the session (${cacheMode.newNames} new names system-wide; ours: ${cacheMode.relevant.join(', ') || 'none'}; browsed hosts already cached before launch, so not provable this way: ${cacheMode.browsedAlreadyCached.join(', ') || 'none'})`);
  } else if (existsSync(dnsFile)) {
    let dns = {total: 0, mine: []}; try { dns = JSON.parse(await fs.readFile(dnsFile, 'utf8') || '{}'); } catch {}
    const mine = [].concat(dns.mine || []).filter(Boolean).filter(alive).map(e => ({...e, kind: procs.get(e.pid)?.kind}));
    const names = [...new Set(mine.map(e => `${e.name} (${e.kind})`))];
    report.windowsDns = {eventsInTrace: dns.total, aciraQueries: mine};
    if (observe) console.log('ordinary app Windows DNS queries:', names.join(', ') || 'none');
    else {
      // From the moment the first Tor tab opens, Acira asks Windows to resolve nothing at all. Before it, the ordinary window's own
      // start-up may (wpad: Windows' "Automatically detect settings" proxy discovery for the ordinary profile); those are listed, not Tor's.
      const torAt = (report.marks || marks).find(m => /^Tor tab/.test(m.label))?.t || 0;
      const during = mine.filter(e => Date.parse(e.t) >= torAt), before = [...new Set(mine.filter(e => Date.parse(e.t) < torAt).map(e => e.name))];
      report.windowsDns.beforeTor = before;
      check(torAt > 0 && during.length === 0, `Windows DNS: from the first Tor tab to the end, no Acira process asked Windows to resolve any name (${dns.total} DNS-Client events traced system-wide; during Tor: ${[...new Set(during.map(e => `${e.name} (${e.kind})`))].join(', ') || 'none'}; ordinary start-up before any Tor tab: ${before.join(', ') || 'none'})`);
    }
  } else check(false, `Windows DNS trace unavailable (${report.dnsTrace})`);

  // ---- NetLog ----
  const net = readNetLog(netlog);
  if (net.error) check(false, 'NetLog readable: ' + net.error);
  const netRemote = net.connects.filter(c => !loopback(hostOf(c.address)));
  report.netlog = {connects: net.connects.length, remote: netRemote.map(c => ({address: c.address, group: c.group, url: c.url, proxy: c.proxy, type: c.type})), certFetches: net.certFetches, lookups: net.lookups.filter(l => !/^(localhost|127\.)/.test(l.host)).slice(0, 200)};
  const tokenLookups = net.lookups.filter(l => l.host.includes(token) && Array.isArray(l.sequence) && l.sequence.includes(0));
  const systemLookups = net.lookups.filter(l => Array.isArray(l.sequence) && (l.sequence.includes(0) || l.sequence.includes(1)) && !/^(localhost)$/.test(l.host));
  if (observe) { console.log('ordinary app NetLog remote connects:'); for (const c of netRemote.slice(0, 40)) console.log(`  ${c.address}  ${c.group || ''}  ${c.url || ''}  proxy=${c.proxy || '?'}`); }
  else {
    check(netRemote.length === 0, `NetLog: Chromium opened no TCP connection to a non-loopback address in any session (${netRemote.length ? JSON.stringify(report.netlog.remote.slice(0, 6)) : 'none'})`);
    check(tokenLookups.length === 0, `NetLog: none of the probe names (dns-prefetch, preconnect, fetch, image, WebSocket, STUN) was resolved by the OS (${tokenLookups.length})`);
    check(systemLookups.length === 0, `NetLog: Chromium resolved no host name at all through the OS or its own DNS client (${[...new Set(systemLookups.map(l => l.host))].slice(0, 10).join(', ') || 'none'})`);
    check(net.certFetches.every(r => /127\.0\.0\.1/.test(r.proxy)), `certificate revocation / AIA fetches: ${net.certFetches.length} seen, every one through the Tor relay (${net.certFetches.map(r => r.url + ' via ' + (r.proxy || 'DIRECT?')).slice(0, 6).join('; ') || 'none'})`);
  }
  // Which certificate verifier Chromium ran: the built-in one (Chrome Root Store, CRLSets, no OS revocation lookups) or Windows' CryptoAPI.
  const verifierEvents = [...net.eventTypes].filter(name => /CERT_VERIFY|CHROME_ROOT_STORE|CERT_VERIFIER|PATH_BUILD|CERT_NET_FETCH/.test(name));
  report.certVerifier = verifierEvents;
  console.log('certificate verifier NetLog events:', verifierEvents.join(', ') || 'none');
  // Missing intermediates (AIA) seen in this run, and the circuit they rode (they are the Tor session's own requests, through its relay).
  const aia = (report.streams || []).filter(x => x.port === 80 && /lencr|pki|cacerts|crt.|aia/.test(x.host)); console.log(`  AIA fetches through the relay: ${aia.map(x => x.host + ' (' + x.site + ')').join(', ') || 'none in this run'}`);
  report.results = results.map(([ok, label]) => ({ok, label}));
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 1));
  console.log(`report: ${path.join(root, 'report.json')}`);
}

if (analyzeOnly) { try { const saved = JSON.parse(await fs.readFile(path.join(root, 'report.json'), 'utf8')); for (const key of ['observe', 'bridges', 'token', 'marks', 'dnsTrace', 'mainPid']) if (saved[key] !== undefined) report[key] = saved[key]; observe = Boolean(saved.observe); bridges = saved.bridges || ''; token = saved.token || token; } catch {} }
else await withSlot('r9-tor-packets', record).catch(error => { report.recordError = error.message; check(false, 'Tor browsing during the capture: ' + error.message); });
await analyze();
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
