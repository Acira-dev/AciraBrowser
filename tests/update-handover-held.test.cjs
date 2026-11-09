'use strict';
// Windows: a virus scanner holds a file it has just seen for a moment, and the hand-over of the downloaded setup (remove what is in the pending folder, move the file in) failed
// with EPERM or EBUSY: the whole update went into its retry ladder (2, 10, 30 minutes) and the offer was lost. electron-updater tries a busy file again; so does the hand-over.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const fsp = require('node:fs/promises');
const { handOver } = require('../desktop/browser-services/update-download.cjs');

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-update-held-')), pending = path.join(root, 'pending'), part = path.join(root, 'work', 'update.part');
  fs.mkdirSync(pending, { recursive: true }); fs.mkdirSync(path.dirname(part), { recursive: true });
  fs.writeFileSync(part, 'new setup'); fs.writeFileSync(path.join(pending, 'AciraBrowserSetup.exe'), 'old setup');
  return { root, pending, part };
};
const refuse = (code, times, match) => { const error = () => Object.assign(new Error(code + ': busy'), { code }); let left = times; return { check: path_ => { if (left > 0 && match(String(path_))) { left--; throw error(); } }, count: () => times - left }; };

test('a setup the scanner holds for a moment is handed over after all (the old file removal and the move are tried again)', async () => {
  const { root, pending, part } = fixture();
  const realRename = fsp.rename, realRm = fsp.rm, rename = refuse('EPERM', 2, p => p.endsWith('update.part')), remove = refuse('EBUSY', 1, p => p.endsWith('AciraBrowserSetup.exe'));
  fsp.rename = function (from, to) { rename.check(from); return realRename.apply(this, arguments); };
  fsp.rm = function (target) { remove.check(target); return realRm.apply(this, arguments); };
  try {
    const target = await handOver({ file: part, pendingDir: pending, name: 'AciraBrowserSetup.exe', sha512: 'abc', retry: { wait: 1 } });
    assert.equal(fs.readFileSync(target, 'utf8'), 'new setup', 'the new file is in place');
    assert.equal(JSON.parse(fs.readFileSync(path.join(pending, 'update-info.json'), 'utf8')).fileName, 'AciraBrowserSetup.exe');
    assert.equal(rename.count(), 2); assert.equal(remove.count(), 1);
  } finally { fsp.rename = realRename; fsp.rm = realRm; fs.rmSync(root, { recursive: true, force: true }); }
});

test('a file that stays held is still an error (nothing is reported as handed over), and another error is not retried', async () => {
  const { root, pending, part } = fixture();
  const realRename = fsp.rename; let calls = 0;
  fsp.rename = function (from) { if (String(from).endsWith('update.part')) { calls++; throw Object.assign(new Error('EACCES: still held'), { code: 'EACCES' }); } return realRename.apply(this, arguments); };
  try {
    await assert.rejects(handOver({ file: part, pendingDir: pending, name: 'AciraBrowserSetup.exe', sha512: 'abc', retry: { wait: 1, tries: 4 } }), /EACCES/);
    assert.equal(calls, 4, 'tried the number of times asked, then gave up');
    calls = 0; fsp.rename = function (from) { calls++; throw Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' }); };
    await assert.rejects(handOver({ file: part, pendingDir: pending, name: 'AciraBrowserSetup.exe', sha512: 'abc', retry: { wait: 1 } }), /ENOENT/);
    assert.equal(calls, 1, 'an error that is not "held" is not tried again');
  } finally { fsp.rename = realRename; fs.rmSync(root, { recursive: true, force: true }); }
});
