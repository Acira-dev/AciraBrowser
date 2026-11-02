'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createVpnControl, macCandidates } = require('../desktop/browser-services/vpn-control.cjs');
const root = '/Applications', app = root + '/Mullvad VPN.app', cli = app + '/Contents/Resources/mullvad';
function fixture({ provider = 'mullvad', verify = async () => true, run } = {}) {
  const target = macCandidates(provider, [root])[0], entries = new Map(), calls = [], verified = [], opened = [];
  for (const file of [target.app, target.cli, target.app + '/Contents/_CodeSignature/CodeResources'].filter(Boolean)) entries.set(file, { directory: file === target.app, version: 1 });
  const files = {
    lstatSync(file) { const e = entries.get(file); if (!e) throw Error('ENOENT'); return { dev: 1, ino: e.version, size: 100, mtimeMs: e.version, ctimeMs: e.version, isFile: () => !e.directory, isDirectory: () => e.directory, isSymbolicLink: () => !!e.symlink }; },
    realpathSync: file => file,
  };
  let state = 'disconnected';
  const runner = async (file, args, options) => {
    calls.push({ file, args, options });
    if (run) return run(file, args, options);
    if (args[0] === 'connect') state = 'connecting';
    if (args[0] === 'disconnect') state = 'disconnected';
    return { ok: true, stdout: provider === 'ivpn' ? `VPN : ${state.toUpperCase()}\nAccount : PRIVATE` : JSON.stringify({ state, details: { location: 'PRIVATE' } }) };
  };
  return { entries, files, calls, verified, opened, target, runner, service: createVpnControl({ platform: 'darwin', homeDir: '/Users/fixture', files, run: runner, verify: async (file, p) => { verified.push(file); return verify(file, p); }, openApp: async file => { opened.push(file); return ''; } }) };
}

test('Mac discovery uses the vendors’ sealed bundle CLI paths and bounded application roots', () => {
  assert.deepEqual(macCandidates('mullvad', [root]), [{ app, cli }]);
  assert.deepEqual(macCandidates('ivpn', [root]), [{ app: '/Applications/IVPN.app', cli: '/Applications/IVPN.app/Contents/MacOS/cli/ivpn' }]);
  assert.ok(macCandidates('proton', [root]).every(p => p.cli === null));
});
test('Mac controls deliver fixed CLI commands, with provider state authoritative and no private output', async () => {
  const f = fixture(); const status = await f.service.command('mullvad', 'connect');
  assert.equal(status.providers[0].state, 'connecting');
  assert.ok(f.calls.some(c => c.file === cli && c.args.join(' ') === 'connect'));
  assert.ok(f.calls.every(c => c.file === cli));
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE|Applications|Contents/);
  await f.service.command('mullvad', 'disconnect');
  await f.service.command('mullvad', 'open'); assert.deepEqual(f.opened, [app]);
  assert.ok(f.verified.length >= 4, 'every operation rechecks the bundle, even when directory mtime is unchanged');
});
test('Mac IVPN uses the last configured route; Proton offers verified configuration only', async () => {
  const ivpn = fixture({ provider: 'ivpn' }); await ivpn.service.command('ivpn', 'connect');
  assert.ok(ivpn.calls.some(c => c.args.join(' ') === 'connect -last'));
  const proton = fixture({ provider: 'proton' }); const status = (await proton.service.status()).providers[1];
  assert.equal(status.canOpen, true); assert.equal(status.canConnect, false); assert.equal(status.state, 'unknown');
  assert.match(status.help, /mac-vpn-application$/);
  await assert.rejects(proton.service.command('proton', 'connect')); assert.equal(proton.calls.length, 0);
});
test('Mac rejects unsigned or changed bundles and symlink escapes before provider execution', async () => {
  const invalid = fixture({ verify: async () => false });
  assert.equal((await invalid.service.status()).providers[0].verified, false);
  await assert.rejects(invalid.service.command('mullvad', 'connect')); assert.equal(invalid.calls.length, 0);
  const changed = fixture({ verify: async () => { changed.entries.get(cli).version++; return true; } });
  assert.equal((await changed.service.status()).providers[0].canConnect, false); assert.equal(changed.calls.length, 0);
  const escape = fixture(); escape.files.realpathSync = file => file === cli ? '/private/tmp/fake-mullvad' : file;
  assert.equal((await escape.service.status()).providers[0].canConnect, false); assert.equal(escape.calls.length, 0);
  const link = fixture(); link.entries.get(cli).symlink = true;
  assert.equal((await link.service.status()).providers[0].canConnect, false); assert.equal(link.calls.length, 0);
});
test('Mac signature verification uses absolute codesign, strict deep verification, Apple Developer ID and fixed publishers', async () => {
  const f = fixture(); const service = createVpnControl({ platform: 'darwin', homeDir: '/Users/fixture', files: f.files, run: async (file, args) => { f.calls.push({ file, args }); return { ok: false, stdout: '' }; } });
  assert.equal((await service.status()).providers[0].verified, false);
  assert.ok(f.calls.length > 0);
  for (const c of f.calls) {
    assert.equal(c.file, '/usr/bin/codesign'); assert.deepEqual(c.args.slice(0, 4), ['--verify', '--deep', '--strict', '--test-requirement']);
    assert.match(c.args[4], /anchor apple generic/); assert.match(c.args[4], /Amagicom AB/);
    assert.match(c.args[4], /100\.6\.1\.13/); assert.equal(c.args.at(-1), app);
    assert.doesNotMatch(c.args.join(' '), /--force|--sign|\/usr\/local\/bin/);
  }
});
test('Mac application resources are reverified after an in-place provider change', async () => {
  let valid = true; const f = fixture({ verify: async () => valid });
  assert.equal((await f.service.status()).providers[0].canConnect, true);
  valid = false;
  assert.equal((await f.service.status()).providers[0].canConnect, false);
  await assert.rejects(f.service.command('mullvad', 'open')); assert.equal(f.opened.length, 0);
});
