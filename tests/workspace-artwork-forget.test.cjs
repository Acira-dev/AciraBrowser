'use strict';
// Removing a profile erases its personal new-tab images too (they are the person's own pictures, up to 20 MB per profile).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWorkspaceArtwork } = require('../desktop/workspace-artwork.cjs');

test('forgetting a profile deletes its personal-artwork folder and leaves other profiles alone', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-artwork-'));
  try {
    const store = createWorkspaceArtwork({ root, nativeImage: {}, dialog: {} });
    for (const id of ['profile-a', 'profile-b']) store.createScope({ profileId: id });
    const base = path.join(root, 'personal-artwork');
    assert.equal(fs.readdirSync(base).length, 2, 'each profile has its own folder');
    fs.writeFileSync(path.join(base, fs.readdirSync(base)[0], 'stray.bin'), 'x');
    const before = fs.readdirSync(base);
    store.forget('profile-a');
    const after = fs.readdirSync(base);
    assert.equal(after.length, 1, 'one folder is gone');
    assert.ok(before.length === 2 && after[0] !== undefined);
    store.forget('profile-a'); // idempotent
    store.forget('never-existed');
    assert.equal(fs.readdirSync(base).length, 1);
    assert.ok(fs.readFileSync(path.join(__dirname, '..', 'desktop', 'main.cjs'), 'utf8').includes('try{artworkStore.forget(profile.id);}catch{}'), 'profile removal calls it');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
