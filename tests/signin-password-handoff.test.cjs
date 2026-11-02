'use strict';
// "Bring your passwords": a synthetic Chrome-style export goes through the vault's own CSV import, then (after a native
// confirmation) to the Recycle Bin, and its hosts feed the "Sign back in" checklist. Synthetic files only.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPasswords } = require('../desktop/passwords/passwords.cjs');
const { createGate } = require('../desktop/passwords/gate.cjs');
const { computeCandidates } = require('../desktop/signin/candidates.cjs');

const deviceKey = crypto.createHash('sha256').update('handoff').digest();
const keys = {
  available: () => true,
  wrap: (b) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', deviceKey, iv); return Buffer.concat([iv, c.update(b), c.final(), c.getAuthTag()]); },
  unwrap: (blob) => { const d = crypto.createDecipheriv('aes-256-gcm', deviceKey, blob.subarray(0, 12)); d.setAuthTag(blob.subarray(blob.length - 16)); return Buffer.concat([d.update(blob.subarray(12, blob.length - 16)), d.final()]); },
};

function harness({ trashFails = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-handoff-'));
  const bin = path.join(dir, 'recycle-bin');
  fs.mkdirSync(bin);
  const h = { dir, bin, confirms: [], trashed: [], answers: { confirm: true, open: null } };
  h.svc = createPasswords({
    dir: path.join(dir, 'vault'),
    keys,
    gate: createGate({ verify: async () => ({ ok: true, method: 'test' }) }),
    clipboard: { async writeText() {}, async readText() { return ''; }, async clear() {} },
    confirm: async (window, options) => { h.confirms.push(options); return h.answers.confirm; },
    pickOpen: async () => h.answers.open,
    pickSave: async () => null,
    // The Recycle Bin: the file leaves its folder and lands in another one.
    trash: async (file) => { if (trashFails) throw new Error('no bin'); h.trashed.push(file); fs.renameSync(file, path.join(bin, path.basename(file))); },
  });
  h.ask = async (request) => (await h.svc.handle(request, { profileId: 'p1', privateMode: false, window: null })).passwords;
  return h;
}

const chromeExport = (count) => {
  const rows = ['name,url,username,password,note'];
  for (let i = 0; i < count; i++) rows.push(`site${i},https://site${i}.acme.net/login,user${i}@mail.test,pw-${i}-${'x'.repeat(8)},`);
  rows.push('GitHub,https://github.com/login,me,gh-secret-1,', 'Google,https://accounts.google.com/signin,me@gmail.test,g-secret-1,');
  return rows.join('\n') + '\n';
};

test('a Chrome export of 143 passwords imports through the preview and apply steps, and its hosts become checklist rows', async () => {
  const h = harness();
  const file = path.join(h.dir, 'Chrome Passwords.csv');
  fs.writeFileSync(file, chromeExport(141));
  h.answers.open = file;
  const preview = await h.ask({ type: 'passwords.import.preview' });
  assert.deepEqual([preview.total, preview.new, preview.update, preview.same, preview.name], [143, 143, 0, 0, 'Chrome Passwords.csv']);
  assert.equal(JSON.stringify(preview).includes('gh-secret-1'), false, 'the preview never carries a password');
  const done = await h.ask({ type: 'passwords.import.apply', token: preview.token });
  assert.deepEqual([done.added, done.updated, done.failed], [143, 0, 0]);
  const hosts = h.svc.vault.list('p1').map((item) => item.origin);
  assert.equal(hosts.length, 143);
  const rows = computeCandidates({ passwordHosts: hosts, limit: 12 });
  assert.equal(rows[0].id, 'google', 'Google leads');
  assert.ok(rows.some((row) => row.id === 'github' && row.saved), 'a saved password says Autofill ready');
  assert.deepEqual(rows.map((row) => row.id).sort(), ['github', 'google', 'site:acme.net'], '141 sites of one domain are one row');
  assert.ok(rows.every((row) => row.saved));
});

test('the exported file goes to the Recycle Bin only after the import, and only when the person agrees', async () => {
  const h = harness();
  const file = path.join(h.dir, 'export.csv');
  fs.writeFileSync(file, chromeExport(3));
  h.answers.open = file;
  const preview = await h.ask({ type: 'passwords.import.preview' });
  await assert.rejects(() => h.ask({ type: 'passwords.import.trash-file', token: preview.token }), /expired/, 'not before the import has been applied');
  await h.ask({ type: 'passwords.import.apply', token: preview.token });
  h.answers.confirm = false;
  assert.equal((await h.ask({ type: 'passwords.import.trash-file', token: preview.token })).cancelled, true);
  assert.equal(fs.existsSync(file), true, 'declining leaves the file where it is');
  assert.deepEqual(h.trashed, []);
  assert.match(h.confirms.at(-1).message, /Recycle Bin/);
  assert.match(h.confirms.at(-1).detail, /export\.csv/);
  assert.match(h.confirms.at(-1).detail, /plain text/);
  h.answers.confirm = true;
  const moved = await h.ask({ type: 'passwords.import.trash-file', token: preview.token });
  assert.equal(moved.fileTrashed, true);
  assert.deepEqual(h.trashed, [file]);
  assert.equal(fs.existsSync(file), false);
  assert.equal(fs.existsSync(path.join(h.bin, 'export.csv')), true);
  await assert.rejects(() => h.ask({ type: 'passwords.import.trash-file', token: preview.token }), /expired/, 'once, then the token is spent');
  await assert.rejects(() => h.ask({ type: 'passwords.import.trash-file', token: 'z'.repeat(32) }), /expired/);
  await assert.rejects(() => h.ask({ type: 'passwords.import.trash-file', token: preview.token, path: '/etc/passwd' }), /Unexpected request field/, 'no other path can be named');
});

test('a Recycle Bin that cannot take the file says so and leaves it', async () => {
  const h = harness({ trashFails: true });
  const file = path.join(h.dir, 'export.csv');
  fs.writeFileSync(file, chromeExport(2));
  h.answers.open = file;
  const preview = await h.ask({ type: 'passwords.import.preview' });
  await h.ask({ type: 'passwords.import.apply', token: preview.token });
  assert.equal((await h.ask({ type: 'passwords.import.trash-file', token: preview.token })).fileTrashed, false);
  assert.equal(fs.existsSync(file), true);
});

test('a file that is not a passwords export is refused with a plain message', async () => {
  const h = harness();
  const file = path.join(h.dir, 'bookmarks.csv');
  fs.writeFileSync(file, 'title,link\nA,https://a.test\n');
  h.answers.open = file;
  assert.match((await h.ask({ type: 'passwords.import.preview' })).unreadable, /doesn’t look like a passwords file/);
});
