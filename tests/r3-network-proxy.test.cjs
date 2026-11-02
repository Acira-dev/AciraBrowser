'use strict';
// Round 3 (network) R3-13: proxy and VPN-app behaviour against REAL servers and a REAL child process, no mocks of the thing being tested.
// The Electron end-to-end run of the same servers is qa/r3-network-proxy.mjs (results in the Round 3 report).
const test = require('node:test'), assert = require('node:assert/strict'), net = require('node:net'), http = require('node:http');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
const S = require('../qa/r3-proxy-servers.cjs');
const { checkProxy } = require('../desktop/browser-services/proxy-check.cjs');
const { proxyChoice, nativeProxy } = require('../desktop/browser-services/proxy-settings.cjs');
const { createVpnControl, runFile } = require('../desktop/browser-services/vpn-control.cjs');
// These two route-identity checks require a second loopback source address.
// macOS does not provide the127.0.0.2 alias by default. Do not change OS settings.
const proxySource = new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', error => error.code === 'EADDRNOTAVAIL' ? resolve(false) : reject(error));
  probe.listen(0, '127.0.0.2', () => probe.close(() => resolve(true)));
});
const proxyRouteTest = (name, run) => test(name, async context => {
  if (!await proxySource) return context.skip('requires the127.0.0.2 loopback source address; unavailable on this host');
  return run(context);
});


const get = (proxyPort, target, headers = {}) => new Promise((resolve, reject) => {
  const request = http.request({ host: '127.0.0.1', port: proxyPort, path: target, method: 'GET', headers: { host: target.startsWith('/') ? `127.0.0.1:${proxyPort}` : new URL(target).host, ...headers } }, response => { let body = ''; response.on('data', chunk => body += chunk); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body })); });
  request.on('error', reject); request.end();
});
const socksConnect = (port, { methods = [0], login = null, host, targetPort }) => new Promise(resolve => {
  const socket = net.connect(port, '127.0.0.1'); let stage = 'greet', buffer = Buffer.alloc(0), body = '';
  const done = value => { socket.destroy(); resolve(value); };
  socket.on('error', () => done({ stage, failed: true }));
  socket.on('connect', () => socket.write(Buffer.from([5, methods.length, ...methods])));
  socket.on('data', chunk => {
    if (stage === 'tunnel') { body += chunk; if (body.includes('\r\n\r\n') || body.length > 200) done({ stage, body }); return; }
    buffer = Buffer.concat([buffer, chunk]);
    if (stage === 'greet') {
      if (buffer.length < 2) return; const method = buffer[1]; buffer = buffer.subarray(2);
      if (method === 255) return done({ stage, refused: true });
      if (method === 2) { stage = 'login'; const u = Buffer.from(login.user), p = Buffer.from(login.pass); socket.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p])); } else { stage = 'request'; }
    }
    if (stage === 'login') { if (buffer.length < 2) return; const ok = buffer[1] === 0; buffer = buffer.subarray(2); if (!ok) return done({ stage, loginRefused: true }); stage = 'request'; }
    if (stage === 'request' && !socket.__asked) {
      socket.__asked = true; const name = Buffer.from(host), port = Buffer.alloc(2); port.writeUInt16BE(targetPort);
      socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, port]));
    } else if (stage === 'request' && socket.__asked) {
      if (buffer.length < 10) return; if (buffer[1] !== 0) return done({ stage, replyCode: buffer[1] });
      stage = 'tunnel'; socket.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
    }
  });
});

proxyRouteTest('HTTP proxy fixture: the origin sees the proxy-side address, unknown names are refused, sign-in is enforced', async () => {
  const origin = await S.startOrigin(), proxy = await S.startHttpProxy({ names: { 'echo.acira.test': origin.port } }), locked = await S.startHttpProxy({ names: { 'echo.acira.test': origin.port }, auth: { user: 'u', pass: 'p' } });
  try {
    const url = `http://echo.acira.test:${origin.port}/json`;
    const viaProxy = await get(proxy.port, url); assert.equal(viaProxy.status, 200); assert.equal(JSON.parse(viaProxy.body).ip, '127.0.0.2');
    const direct = await get(origin.port, '/json'); assert.equal(JSON.parse(direct.body).ip, '127.0.0.1');
    assert.equal((await get(proxy.port, `http://unknown.acira.test:${origin.port}/`)).status, 502);
    const denied = await get(locked.port, url); assert.equal(denied.status, 407); assert.match(denied.headers['proxy-authenticate'], /Basic/);
    assert.equal((await get(locked.port, url, { 'proxy-authorization': S.basic('u', 'wrong') })).status, 407);
    assert.equal((await get(locked.port, url, { 'proxy-authorization': S.basic('u', 'p') })).status, 200);
    assert.deepEqual(locked.log.map(entry => entry.status), [407, 407, 200]);
  } finally { await Promise.all([proxy.close(), locked.close(), origin.close()]); }
});

proxyRouteTest('SOCKS5 fixture: the browser sends the NAME (remote DNS); a login-only proxy answers "no acceptable method" to a client that offers none, as RFC 1928 says', async () => {
  const origin = await S.startOrigin(), names = { 'echo.acira.test': origin.port };
  const open = await S.startSocks5({ names }), locked = await S.startSocks5({ names, auth: { user: 'u', pass: 'p' } });
  try {
    const ok = await socksConnect(open.port, { host: 'echo.acira.test', targetPort: origin.port }); assert.match(ok.body, /127\.0\.0\.2/);
    assert.deepEqual(open.log.map(entry => [entry.atyp, entry.host]), [[3, 'echo.acira.test']], 'a domain-name request, never a locally resolved address');
    assert.equal((await socksConnect(locked.port, { methods: [0], host: 'echo.acira.test', targetPort: origin.port })).refused, true);
    assert.equal((await socksConnect(locked.port, { methods: [0, 2], login: { user: 'u', pass: 'bad' }, host: 'echo.acira.test', targetPort: origin.port })).loginRefused, true);
    assert.match((await socksConnect(locked.port, { methods: [0, 2], login: { user: 'u', pass: 'p' }, host: 'echo.acira.test', targetPort: origin.port })).body, /127\.0\.0\.2/);
  } finally { await Promise.all([open.close(), locked.close(), origin.close()]); }
});

test('Test button: tells a login-only SOCKS5 proxy apart from a strict refusal, recognises HTTP sign-in, and never sends credentials', async () => {
  const origin = await S.startOrigin(), names = { 'echo.acira.test': origin.port };
  const locked = await S.startSocks5({ names, auth: { user: 'u', pass: 'p' } }), httpLocked = await S.startHttpProxy({ names, auth: { user: 'u', pass: 'p' } });
  const strict = net.createServer(socket => { socket.once('data', data => { socket.end(Buffer.from([5, data.includes(0) ? 0 : 255])); }); socket.on('error', () => {}); });
  await new Promise(resolve => strict.listen(0, '127.0.0.1', resolve));
  try {
    const login = await checkProxy({ scheme: 'socks5', host: '127.0.0.1', port: locked.port });
    assert.equal(login.ok, false); assert.match(login.message, /cannot send SOCKS5 sign-ins/, 'a proxy that wants a sign-in is named as such, not as a generic refusal');
    // R4-09: "no sign-in" first, alone (a proxy that accepts it is open, even when it prefers a username, like Tor); only a refusal is asked again with both.
    assert.deepEqual(locked.log.map(entry => entry.offered), [[0], [0, 2]], 'the probe asks for no sign-in, then, after a refusal, for both methods; each stops after the greeting');
    assert.equal(locked.log.every(entry => entry.login === null && entry.atyp === null), true, 'no username, password or website name was sent');
    const http407 = await checkProxy({ scheme: 'http', host: '127.0.0.1', port: httpLocked.port }); assert.equal(http407.ok, true); assert.match(http407.message, /needs a sign-in/);
    assert.equal(httpLocked.log.every(entry => !entry.auth), true);
    assert.equal((await checkProxy({ scheme: 'socks5', host: '127.0.0.1', port: strict.address().port })).ok, true);
  } finally { strict.close(); await Promise.all([locked.close(), httpLocked.close(), origin.close()]); }
});

test('bypass list syntax: <local>, wildcards, IPv6 and duplicates reach the engine exactly; anything that could widen or inject is refused', () => {
  const server = { scheme: 'http', host: 'proxy.example', port: 8080 };
  assert.deepEqual(nativeProxy(proxyChoice({ mode: 'fixed_servers', server, bypassHosts: ['<local>', '*.Intranet.Example', 'localhost', '[::1]', 'a.example', 'a.example'] })),
    { mode: 'fixed_servers', proxyRules: 'http://proxy.example:8080', proxyBypassRules: '<local>,*.intranet.example,localhost,[::1],a.example' });
  assert.deepEqual(nativeProxy(proxyChoice({ mode: 'fixed_servers', server })), { mode: 'fixed_servers', proxyRules: 'http://proxy.example:8080', proxyBypassRules: '' });
  for (const bad of ['*', '.', 'a b', 'a;b', 'https://x.example', 'x.example/path', 'user@x.example', '*.1.2.3.4', '--proxy-bypass-list=*', '<-loopback>', 'a,b'])
    assert.throws(() => proxyChoice({ mode: 'fixed_servers', server, bypassHosts: [bad] }), undefined, 'refused: ' + bad);
  assert.throws(() => proxyChoice({ mode: 'fixed_servers', server, bypassHosts: new Array(101).fill('a.example') }));
  for (const mode of ['pac_script', 'auto_detect']) assert.throws(() => proxyChoice({ mode }), /Choose system, direct/, 'no PAC field by design; a PAC set in Windows is followed through "system"');
});

// ---- VPN app control against a real child process --------------------------------------------------------------------------------------
const csc = path.join(process.env.SystemRoot || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const canBuild = process.platform === 'win32' && fs.existsSync(csc);
test('VPN app control drives a real command-line client: connect, disconnect, status, hangs, floods, failures, closed stdin', { skip: !canBuild && 'needs Windows with the .NET Framework compiler' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-fake-vpn-')), exe = path.join(dir, 'fake-vpn.exe'), stateFile = path.join(dir, 'state.txt'), logFile = path.join(dir, 'calls.txt');
  try {
    execFileSync(csc, ['/nologo', '/target:exe', `/out:${exe}`, path.join(__dirname, '..', 'qa', 'fixtures', 'fake-vpn-cli.cs')], { stdio: 'pipe' });
    const root = 'C:\\Program Files', installed = new Set([root + '\\Mullvad VPN\\resources\\mullvad.exe', root + '\\Mullvad VPN\\Mullvad VPN.exe', root + '\\IVPN Client\\cli\\ivpn.exe', root + '\\IVPN Client\\ui\\IVPN Client.exe']);
    const fakeFs = { readdirSync: () => [], realpathSync: file => file, lstatSync: file => { if (!installed.has(file)) throw Error('ENOENT'); return { dev: 1, ino: 1, size: 1, mtimeMs: 1, ctimeMs: 1, isFile: () => true, isSymbolicLink: () => false }; } };
    let misbehave = '', timeout;
    // Status is read for every provider at once, so each provider's fake keeps its own state and call log.
    const run = (file, args, options = {}) => { const flavor = file.includes('ivpn') ? 'ivpn' : 'mullvad'; return runFile(exe, args, { ...options, ...(timeout ? { timeout } : {}), env: { ...process.env, FAKE_VPN_STATE: stateFile + '.' + flavor, FAKE_VPN_LOG: logFile + '.' + flavor, FAKE_VPN_FLAVOR: flavor, FAKE_VPN_MISBEHAVE: misbehave } }); };
    const service = createVpnControl({ platform: 'win32', env: { ProgramW6432: root }, files: fakeFs, run, verify: async () => true, openApp: async () => '' });
    const find = async id => (await service.status()).providers.find(provider => provider.id === id);

    // 1. detection: installed, verified, state read from the client itself
    let mullvad = await find('mullvad'); assert.deepEqual([mullvad.installed, mullvad.verified, mullvad.state, mullvad.canConnect, mullvad.canDisconnect], [true, true, 'disconnected', true, false]);
    // 2. connect then disconnect through the real process; the state shown is the client's, read back after the command
    mullvad = (await service.command('mullvad', 'connect')).providers.find(provider => provider.id === 'mullvad'); assert.deepEqual([mullvad.state, mullvad.canDisconnect, mullvad.canConnect], ['connected', true, false]);
    await assert.rejects(service.command('mullvad', 'connect'), /Open the provider app/, 'cannot connect when already connected');
    mullvad = (await service.command('mullvad', 'disconnect')).providers.find(provider => provider.id === 'mullvad'); assert.deepEqual([mullvad.state, mullvad.canConnect], ['disconnected', true]);
    // 3. IVPN: connects with the last route, parses the "VPN :" line, no account text leaks to the renderer
    const ivpnLog = logFile + '.ivpn', before = fs.existsSync(ivpnLog) ? fs.readFileSync(ivpnLog, 'utf8') : '';
    const ivpn = (await service.command('ivpn', 'connect')).providers.find(provider => provider.id === 'ivpn'); assert.equal(ivpn.state, 'connected');
    assert.equal(fs.readFileSync(ivpnLog, 'utf8').slice(before.length), 'status\nconnect -last\nstatus\n');
    assert.doesNotMatch(JSON.stringify(await service.status()), /ivpn-private-account|203\.0\.113|Program Files|fake-vpn/);
    await service.command('ivpn', 'disconnect');
    // 4. misbehaving clients never produce "connected", never hang the browser, never leak their output
    misbehave = 'fail'; mullvad = await find('mullvad'); assert.equal(mullvad.state, 'unknown'); assert.equal(mullvad.canConnect, false);
    await assert.rejects(service.command('mullvad', 'connect'), error => !/1234567890123456/.test(error.message));
    misbehave = 'flood'; assert.equal((await find('mullvad')).state, 'unknown', 'output over the 128 KB limit is dropped, not parsed');
    misbehave = 'hang'; timeout = 600; const started = Date.now(); assert.equal((await find('mullvad')).state, 'unknown'); assert.ok(Date.now() - started < 5000, 'a hung client is killed at its timeout');
    timeout = undefined; misbehave = 'stdin'; assert.equal((await find('mullvad')).state, 'disconnected', 'stdin is closed, so a client that waits for input cannot stall status');
    // 5. busy lock is released after failures
    misbehave = ''; assert.equal((await service.status()).busy, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
