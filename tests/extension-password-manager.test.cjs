'use strict';
// A password manager's popup, worker and content script on the real engine (Bitwarden is the model; the fixture does what it does, without an account):
// the lock state written by the popup into storage.session reaches the worker, the per-tab toolbar badge and the page's content script; the popup's
// messages and ports reach the worker as internal senders; "make default password manager" (the optional privacy permission, then address, card and
// password saving held off) reads back as controlled by the extension. Real Electron, isolated profile (tests/fixtures/pw-manager/run.cjs).
const {test} = require('node:test'), assert = require('node:assert/strict'), {spawnSync} = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
const electron = (() => { try { const value = require('electron'); return typeof value === 'string' && fs.existsSync(value) ? value : null; } catch { return null; } })();
let result = null, problem = null;
if (electron) {
  const run = spawnSync(electron, ['--use-mock-keychain', '--mute-audio', path.join(__dirname, 'fixtures', 'pw-manager', 'run.cjs')], {encoding: 'utf8', timeout: 110000, env: {...process.env, ELECTRON_RUN_AS_NODE: undefined, ELECTRON_ENABLE_LOGGING: '0'}});
  const line = (run.stdout || '').split(/\r?\n/).find(text => text.startsWith('RESULT '));
  if (line) result = JSON.parse(line.slice(7)); else problem = ((run.stdout || '') + (run.stderr || '')).slice(0, 800) || 'no result';
}
const skip = !electron ? 'electron binary not available' : false;
const steps = () => { assert.ok(result, problem); assert.equal(result.error, undefined, result.error); return result.steps; };

test('locked at the start: the worker answers the content script and paints the lock on the toolbar button', {skip}, () => {
  const s = steps();
  assert.deepEqual(s.locked, {worker: 'locked', session: 'locked'});
  assert.equal(s.lockedBadge.badge, 'LOCK');
});

test('the popup unlocks through storage.session: the worker, the per-tab badge and the page all follow', {skip}, () => {
  const s = steps();
  assert.equal(s.unlockedWorker.unlocked, true, JSON.stringify(s.unlockedWorker));
  assert.ok(s.unlockedWorker.events.includes('session.onChanged'), 'the worker heard storage.session.onChanged: ' + JSON.stringify(s.unlockedWorker.events));
  assert.equal(s.unlockedBadge.badge, '2', 'the number of logins for the page, not the lock: ' + JSON.stringify(s.unlockedBadge));
  assert.deepEqual(s.unlockedPage, {worker: 'unlocked', session: 'unlocked'});
});

test('locking again flips all three back', {skip}, () => {
  const s = steps();
  assert.equal(s.relockedBadge.badge, 'LOCK');
  assert.deepEqual(s.relockedPage, {worker: 'locked', session: 'locked'});
});

test('the popup\'s message and port reach the worker as internal senders (origin of the extension, top frame)', {skip}, () => {
  const s = steps();
  assert.equal(s.who.internal, true, JSON.stringify(s.who));
  assert.equal(s.who.sender.origin, 'chrome-extension://' + result.id);
  assert.equal(s.port.timeout, undefined, 'the port answered: ' + JSON.stringify(s.port));
  assert.ok(s.port.seen.some(message => message.id === 'q' && message.data === 'via-port'), JSON.stringify(s.port));
  const port = s.workerPorts.find(entry => entry.name === 'pw-session');
  assert.ok(port && port.internal === true && port.origin === 'chrome-extension://' + result.id, JSON.stringify(s.workerPorts));
});

test('make default password manager: privacy permission granted and address, card and password saving all read back as held by the extension', {skip}, () => {
  const s = steps();
  assert.equal(s.privacy.granted, true, JSON.stringify(s.privacy));
  for (const name of ['autofillAddressEnabled', 'autofillCreditCardEnabled', 'passwordSavingEnabled'])
    assert.deepEqual(s.privacy.details[name], {value: false, levelOfControl: 'controlled_by_this_extension'}, name);
  assert.equal(s.privacy.overridden, true);
});
