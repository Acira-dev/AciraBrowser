'use strict';
// Windows: a virus scanner or the search indexer can hold a file for a moment and make the rename that puts a new copy in its place fail with EPERM or EBUSY.
// atomic-file.cjs tries that rename again; the password vault and the shortcut table wrote with a plain rename, so the save threw: "save password" reported an error
// (or, worse, the next start found the old file). Run here on any computer by making the first rename fail the way Windows does.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createVault } = require('../desktop/passwords/vault.cjs');
const { createShortcutRegistry } = require('../desktop/shortcut-registry.cjs');

const deviceKey = crypto.createHash('sha256').update('test device').digest();
const keys = { available: () => true, wrap: buffer => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', deviceKey, iv); return Buffer.concat([iv, c.update(buffer), c.final(), c.getAuthTag()]); },
  unwrap: blob => { const iv = blob.subarray(0, 12), tag = blob.subarray(blob.length - 16), d = crypto.createDecipheriv('aes-256-gcm', deviceKey, iv); d.setAuthTag(tag); return Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]); } };

/** Makes the first rename of a file that matches fail with `code` (like Windows with a scanner holding the target), then lets the rest through. Returns restore(). */
function holdFirstRename(match, code = 'EPERM') {
  const real = fs.renameSync; let seen = 0, refused = 0;
  fs.renameSync = function (from, to) { if (match(String(to)) && seen++ < 1) { refused++; const error = new Error(`${code}: operation not permitted, rename '${from}' -> '${to}'`); error.code = code; throw error; } return real.apply(this, arguments); };
  return () => { fs.renameSync = real; return refused; };
}

test('the password vault saves through a rename Windows refuses once (the key file and the records file)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-pw-retry-'));
  try {
    const vault = createVault({ dir, keys });
    const restoreKey = holdFirstRename(to => to.endsWith('master.key'));
    let id;
    try { id = vault.save('profile-a', { origin: 'https://bank.example.com', username: 'ada', password: 'correct-horse-Battery-9!' }).id; } finally { assert.equal(restoreKey(), 1, 'the first rename of master.key was refused'); }
    assert.ok(id, 'the first save worked although the first rename of master.key failed');
    const restoreFile = holdFirstRename(to => to.endsWith('profile-a.vault.json'));
    try { vault.save('profile-a', { origin: 'https://mail.example.com', username: 'ada', password: 'another-Battery-9!' }); } finally { assert.equal(restoreFile(), 1, 'the first rename of the vault file was refused'); }
    const reopened = createVault({ dir, keys });
    assert.equal(reopened.status('profile-a').count, 2, 'both records are on disk after a restart');
    assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), [], 'no temporary file is left');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a rename that stays refused is still an error (nothing half-written replaces the file)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-pw-retry-'));
  try {
    const vault = createVault({ dir, keys });
    vault.save('profile-a', { origin: 'https://one.example.com', username: 'u', password: 'first-Battery-9!' });
    const before = fs.readFileSync(path.join(dir, 'profile-a.vault.json'), 'utf8');
    const real = fs.renameSync; fs.renameSync = function (from, to) { if (String(to).endsWith('profile-a.vault.json')) { const error = new Error('EBUSY'); error.code = 'EBUSY'; throw error; } return real.apply(this, arguments); };
    try { assert.throws(() => vault.save('profile-a', { origin: 'https://two.example.com', username: 'u', password: 'second-Battery-9!' }), /EBUSY/); } finally { fs.renameSync = real; }
    assert.equal(fs.readFileSync(path.join(dir, 'profile-a.vault.json'), 'utf8'), before, 'the old file is untouched');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the shortcut table saves through a rename Windows refuses once', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-shortcuts-retry-')), file = path.join(dir, 'shortcuts.json');
  try {
    const registry = createShortcutRegistry({ file, platform: 'win32' });
    const restore = holdFirstRename(to => to.endsWith('shortcuts.json'));
    try { assert.equal(registry.set('new-tab', 'Ctrl+F8').ok, true); } finally { assert.equal(restore(), 1, 'the first rename was refused'); }
    assert.ok(fs.existsSync(file), 'the table was written');
    assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).bindings['new-tab'], 'with the change in it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
