'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createVpnControl, parseStatus, candidates } = require('../desktop/browser-services/vpn-control.cjs');
const root = 'C:\\Program Files', mullvad = root + '\\Mullvad VPN\\resources\\mullvad.exe', mullvadApp = root + '\\Mullvad VPN\\Mullvad VPN.exe';
const ivpn = root + '\\IVPN Client\\cli\\ivpn.exe', ivpnApp = root + '\\IVPN Client\\ui\\IVPN Client.exe';
function fixture({ installed = [mullvad, mullvadApp], verify, runner } = {}) {
  const files = new Map(installed.map(file => [file, { version: 1 }])), calls = [], verified = [], opened = [];
  let state = 'disconnected', blocked = false;
  const fs = {
    readdirSync: () => ['3.2.0', '4.10.1', '..', 'not-a-version'],
    lstatSync: file => { const item = files.get(file); if (!item) throw Error('ENOENT'); return { dev: 1, ino: item.version, size: 100, mtimeMs: item.version, ctimeMs: item.version, isFile: () => true, isSymbolicLink: () => false }; },
    realpathSync: file => file,
  };
  const run = async (file, args, options) => {
    calls.push({ file, args, options });
    if (runner) return runner(file, args, options);
    if (args[0] === 'connect') state = 'connecting';
    if (args[0] === 'disconnect') state = 'disconnected';
    return { ok: true, stdout: file === ivpn ? `Account : ivpn-private-account\nVPN : ${state.toUpperCase()}\nLocal IP: 10.0.0.5\nFirewall : ${blocked ? 'Enabled' : 'Disabled'}\n` : JSON.stringify({ state, details: { locked_down: blocked, location: { ipv4: '203.0.113.1' } } }) };
  };
  const service = createVpnControl({ platform: 'win32', env: { ProgramW6432: root, PATH: 'C:\\untrusted' }, files: fs, run, verify: async (file, provider) => { verified.push(file); return verify ? verify(file, provider) : true; }, openApp: async file => { opened.push(file); return ''; } });
  return { service, calls, verified, opened, files, fs, run, setState: next => { state = next; }, setBlocked: next => { blocked = next; } };
}

test('Mullvad JSON and IVPN state line are parsed exactly, never inferred from process names or unrelated output', () => {
  assert.deepEqual(parseStatus('mullvad', '{"state":"connected","details":{"location":{"ipv4":"203.0.113.1"}}}'), { state: 'connected', blocked: false });
  assert.deepEqual(parseStatus('mullvad', 'Warning: You are not logged in to an account.\n{"state":"error","details":{}}'), { state: 'error', blocked: false });
  assert.equal(parseStatus('mullvad', 'Connected').state, 'unknown');
  assert.equal(parseStatus('mullvad', '{"state":"totally_connected"}').state, 'unknown');
  assert.deepEqual(parseStatus('ivpn', 'Account: CONNECTED\nVPN\t:\tDISCONNECTED\nFirewall : Enabled (!)'), { state: 'disconnected', blocked: true });
  assert.equal(parseStatus('ivpn', 'VPN : PAUSED till tomorrow').state, 'paused');
  assert.equal(parseStatus('ivpn', 'VPN : RECONNECTING').state, 'connecting');
  assert.equal(parseStatus('ivpn', 'app running, adapter connected').state, 'unknown');
  assert.equal(parseStatus('ivpn', 'x'.repeat(128 * 1024 + 1)).state, 'unknown');
});

test('discovery is limited to fixed install paths; Proton versions are bounded, numeric and newest first', () => {
  assert.deepEqual(candidates('mullvad', [root], () => []), { cli: [mullvad], apps: [mullvadApp] });
  assert.deepEqual(candidates('ivpn', [root], () => []), { cli: [ivpn], apps: [ivpnApp] });
  const proton = candidates('proton', [root], () => ['3.2.0', '4.10.1', '..', 'bad.exe', '4.9.0']);
  assert.equal(proton.cli.length, 0);
  assert.match(proton.apps[0], /4\.10\.1\\ProtonVPN\.Launcher.exe$/);
  assert.ok(proton.apps.every(file => file.startsWith(root + '\\Proton\\VPN\\') && !file.includes('..')));
});

test('only signed fixed candidates can be controlled; provider status contains no account, address, path or raw output', async () => {
  const f = fixture({ installed: [mullvad, mullvadApp, ivpn, ivpnApp] });
  f.setState('connected');
  const status = await f.service.status();
  assert.equal(status.providers.find(p => p.id === 'mullvad').canDisconnect, true);
  assert.equal(status.providers.find(p => p.id === 'ivpn').canDisconnect, true);
  assert.doesNotMatch(JSON.stringify(status), /ivpn-private|203\.0|10\.0|Program Files|Local IP/);
  assert.ok(f.calls.every(call => [mullvad, ivpn].includes(call.file) && call.args[0] === 'status'));
});

test('missing and unverifiable apps expose no control or executable launch', async () => {
  const missing = fixture({ installed: [] });
  assert.ok((await missing.service.status()).providers.every(p => !p.installed && !p.canConnect && !p.canOpen));
  const invalid = fixture({ verify: () => false });
  const provider = (await invalid.service.status()).providers[0];
  assert.equal(provider.installed, true); assert.equal(provider.verified, false);
  await assert.rejects(invalid.service.command('mullvad', 'connect'));
  await assert.rejects(invalid.service.command('mullvad', 'open'));
  assert.equal(invalid.calls.length, 0); assert.equal(invalid.opened.length, 0);
});

test('signature verification cache is tied to file identity and replacement is verified again', async () => {
  let trusted = true;
  const f = fixture({ verify: () => trusted });
  await f.service.status(); await f.service.status();
  assert.equal(f.verified.filter(file => file === mullvad).length, 1);
  trusted = false; f.files.set(mullvad, { version: 2 });
  assert.equal((await f.service.status()).providers[0].canConnect, false);
  assert.equal(f.verified.filter(file => file === mullvad).length, 2);
});

test('symlinks and paths redirected outside the protected install location are refused before any process runs', async () => {
  const f = fixture(); f.fs.realpathSync = () => 'C:\\Users\\someone\\fake.exe';
  assert.ok((await f.service.status()).providers.every(p => !p.verified));
  assert.equal(f.calls.length, 0); assert.equal(f.verified.length, 0);
});

test('connect and disconnect execute fixed CLI arguments and report actual provider state without optimistic success', async () => {
  const f = fixture();
  const connecting = await f.service.command('mullvad', 'connect');
  assert.equal(connecting.providers[0].state, 'connecting');
  assert.deepEqual(f.calls.find(call => call.args[0] === 'connect').args, ['connect']);
  assert.equal(f.calls.find(call => call.args[0] === 'connect').options.timeout, 15000);
  f.setState('connected'); f.setBlocked(true);
  const disconnected = await f.service.command('mullvad', 'disconnect');
  assert.equal(disconnected.providers[0].state, 'disconnected'); assert.equal(disconnected.providers[0].blocked, true);
  assert.ok(f.calls.some(call => call.args.join(' ') === 'disconnect'));
  await f.service.command('mullvad', 'open'); assert.deepEqual(f.opened, [mullvadApp]);
});

test('IVPN connects with the last configured route rather than silently choosing a new location', async () => {
  const f = fixture({ installed: [ivpn, ivpnApp] });
  await f.service.command('ivpn', 'connect');
  assert.deepEqual(f.calls.find(call => call.args[0] === 'connect').args, ['connect', '-last']);
});

test('unknown or failed provider status cannot enable connect; command failure returns only a fixed sanitized error', async () => {
  const f = fixture({ runner: async () => ({ ok: false, stdout: 'Account ivpn-SECRET, server 192.0.2.5: password required' }) });
  assert.equal((await f.service.status()).providers[0].state, 'unknown');
  await assert.rejects(f.service.command('mullvad', 'connect'), error => !/SECRET|192\.0/.test(error.message));
  const g = fixture({ runner: async (_file, args) => args[0] === 'status' ? { ok: true, stdout: '{"state":"disconnected"}' } : { ok: false, stdout: 'SECRET' } });
  await assert.rejects(g.service.command('mullvad', 'connect'), error => !/SECRET/.test(error.message));
});

test('Proton Windows has an app configure path and no fabricated connect/disconnect contract', async () => {
  const app = root + '\\Proton\\VPN\\4.10.1\\ProtonVPN.Launcher.exe';
  const f = fixture({ installed: [app] });
  const provider = (await f.service.status()).providers.find(p => p.id === 'proton');
  assert.equal(provider.canOpen, true); assert.equal(provider.state, 'unknown'); assert.equal(provider.canConnect, false);
  await assert.rejects(f.service.command('proton', 'connect'));
  await f.service.command('proton', 'open'); assert.deepEqual(f.opened, [app]); assert.equal(f.calls.length, 0);
});

test('provider IDs and actions cannot inject a path, shell, login or configuration arguments', async () => {
  const f = fixture();
  for (const [id, action] of [['mullvad & whoami', 'connect'], ['mullvad', 'connect --server evil'], ['proton', 'login'], [{}, 'open']]) await assert.rejects(f.service.command(id, action), /Invalid VPN command/);
  assert.equal(f.calls.length, 0);
});

test('a device-wide command in progress prevents concurrent changes from another window', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ runner: async (_file, args) => { if (args[0] === 'connect') await gate; return { ok: true, stdout: '{"state":"disconnected"}' }; } });
  const first = f.service.command('mullvad', 'connect');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(f.service.command('mullvad', 'connect'), /progress/);
  release(); await first;
});

test('the Authenticode check runs in Acira\'s own helper (never a script host), takes the path on standard input and rejects wrong publishers', async () => {
  const f = fixture(), helper = 'C:\\Users\\me\\AppData\\Local\\Programs\\Acira Browser\\resources\\acira-verify.exe';
  const exec = answer => { const calls = []; return { calls, exec: (file, args, options, callback) => { const call = { file, args, options, input: '' }; calls.push(call); setImmediate(() => callback(null, answer)); return { stdin: { on() {}, end(text) { call.input = text; } } }; } }; };
  const wrong = exec('valid\r\nUnrelated Publisher\r\n');
  const service = createVpnControl({ platform: 'win32', env: { ProgramFiles: root, SystemRoot: 'C:\\Windows' }, files: f.fs, run: async () => assert.fail('no command runs for an unverified provider'), windowsHelper: { helper, exec: wrong.exec } });
  assert.ok((await service.status()).providers.every(p => !p.verified));
  assert.ok(wrong.calls.length > 0);
  assert.ok(wrong.calls.every(call => call.file === helper && call.args.length === 1 && call.args[0] === 'signature' && call.options.windowsHide === true));
  assert.deepEqual(wrong.calls.map(call => call.input).sort(), [mullvad, mullvadApp].sort(), 'the candidate path travels on standard input only');
  assert.ok(wrong.calls.every(call => !Object.keys(call.options.env || {}).some(name => /^ACIRA_/.test(name))));
  const right = exec('valid\r\nMullvad VPN AB\r\n');
  const trusted = createVpnControl({ platform: 'win32', env: { ProgramFiles: root }, files: f.fs, run: f.run, windowsHelper: { helper, exec: right.exec } });
  assert.equal((await trusted.status()).providers.find(p => p.id === 'mullvad').verified, true);
  const invalid = exec('invalid\r\nMullvad VPN AB\r\n');
  const unsigned = createVpnControl({ platform: 'win32', env: { ProgramFiles: root }, files: f.fs, run: f.run, windowsHelper: { helper, exec: invalid.exec } });
  assert.equal((await unsigned.status()).providers.find(p => p.id === 'mullvad').verified, false);
  // A helper that is missing or blocked (an antivirus quarantine) verifies nothing.
  const missing = createVpnControl({ platform: 'win32', env: { ProgramFiles: root }, files: f.fs, run: f.run, windowsHelper: { helper, exec: (file, args, options, callback) => { setImmediate(() => callback(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT', syscall: 'spawn x.exe' }), '')); return { stdin: { on() {}, end() {} } }; } } });
  assert.ok((await missing.status()).providers.every(p => !p.verified));
});

test('unsupported platforms retain provider setup links and never attempt a Windows executable', async () => {
  let calls = 0;
  const service = createVpnControl({ platform: 'linux', run: async () => { calls++; throw Error('must not execute'); } });
  assert.ok((await service.status()).providers.every(provider => !provider.canConnect && provider.site.startsWith('https://')));
  assert.equal(calls, 0);
});
