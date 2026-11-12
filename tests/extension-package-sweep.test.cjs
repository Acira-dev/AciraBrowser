'use strict';
// A store install unpacks into extension-packages/<profile>/<id>/<8 hex> (made before the unpack, removed again by the manager if the install fails). An app killed in the
// middle of the unpack (a HubSpot-sized archive takes about 4 seconds), or a delete that failed because a file was open, left that folder behind (143 MiB and 1,401 files when
// killed at the right moment, no manifest.json, so never loaded) and only the next successful install of the SAME extension pruned it. At the first restore of a run the manager
// now removes the folders no saved extension uses, and nothing else. These tests are about what must NEVER be deleted as much as about what is.
const {test} = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), os = require('node:os'), {createHash} = require('node:crypto');
const {createExtensionManager} = require('../desktop/browser-services/extension-manager.cjs');

const A = 'abcdefghijklmnopabcdefghijklmnop', B = 'ponmlkjihgfedcbaponmlkjihgfedcba';
const PROFILE = createHash('sha256').update('p').digest('hex').slice(0, 8);
const manifestOf = name => ({manifest_version: 3, name, version: '1.0', permissions: ['storage']});
const OLD = Date.now() - 10 * 60 * 1000;

/** A manager over a fake profile session; `entries` are the saved extensions (folders already made), `corrupt` writes an unreadable saved list before the manager starts. */
function fixture({entries = [], corrupt = false, download} = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-ext-sweep-')), registryPath = path.join(dir, 'extensions.json'), base = path.join(dir, 'extension-packages');
  const folder = (id, leaf) => path.join(base, PROFILE, id, leaf);
  const plant = (where, {age = OLD, files = ['manifest.json', 'js/big.map']} = {}) => {
    fs.mkdirSync(where, {recursive: true});
    for (const f of files) { fs.mkdirSync(path.dirname(path.join(where, f)), {recursive: true}); fs.writeFileSync(path.join(where, f), f.endsWith('.json') ? JSON.stringify(manifestOf('x')) : 'x'.repeat(2048)); }
    fs.utimesSync(where, new Date(age), new Date(age));
    return where;
  };
  const saved = entries.map(e => ({id: e.id, profileId: 'p', path: plant(folder(e.id, e.leaf)), name: 'Ext', version: '1.0', permissions: ['storage'], enabled: true, source: 'Chrome Web Store',
    ...(e.previous ? {previousPath: plant(folder(e.id, e.previous))} : {})}));
  fs.writeFileSync(registryPath, corrupt ? '{"version":2,"entries":[{' : JSON.stringify({version: 2, entries: saved}));
  let loaded = [];
  const api = {getAllExtensions: () => loaded, loadExtension: async f => { const e = {id: path.basename(path.dirname(f)), name: 'Ext', version: '1.0', manifest: manifestOf('Ext')}; loaded = [...loaded, e]; return e; }, removeExtension: id => { loaded = loaded.filter(e => e.id !== id); }};
  const session = {extensions: api, serviceWorkers: {getAllRunning: () => ({})}};
  const manager = createExtensionManager({getSession: () => session, getProfiles: () => [{id: 'p', name: 'Personal', partition: 'persist:p'}], getWindow: () => null, dialog: {showMessageBox: async () => ({response: 1})},
    registryPath, createRuntime: () => ({}), ...(download ? {downloadPackage: download} : {})});
  const exists = p => fs.existsSync(p);
  return {dir, base, registryPath, folder, plant, saved, manager, exists, done: () => fs.rmSync(dir, {recursive: true, force: true})};
}

test('at the first restore a folder left by a killed unpack goes, with its empty parents; a saved extension\'s folder, its previous version and what loads are untouched', async () => {
  const f = fixture({entries: [{id: A, leaf: 'aaaaaaaa', previous: 'bbbbbbbb'}]});
  try {
    const sameId = f.plant(f.folder(A, 'cccccccc')), otherId = f.plant(f.folder(B, 'dddddddd'));   // a killed unpack of the same extension, and of one that was never saved
    await f.manager.restore();
    assert.equal(f.exists(sameId), false, 'the leftover of the same extension is gone');
    assert.equal(f.exists(otherId), false, 'the leftover of an extension that was never saved is gone');
    assert.equal(f.exists(path.join(f.base, PROFILE, B)), false, 'and its now empty folder with it');
    assert.equal(f.exists(f.saved[0].path), true, 'the saved extension\'s folder stays');
    assert.equal(f.exists(f.saved[0].previousPath), true, 'and the previous version it names');
    assert.deepEqual(f.manager.list('p').extensions.map(e => [e.id, e.status]), [[A, 'loaded']], 'and it still loads');
    assert.equal(fs.existsSync(path.join(f.saved[0].path, 'manifest.json')), true);
  } finally { f.done(); }
});

test('only the exact shape an install makes is touched, and never a link or anything outside the extension-packages folder', async () => {
  const f = fixture({entries: [{id: A, leaf: 'aaaaaaaa'}]});
  try {
    const outside = path.join(f.dir, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'keep');
    const decoys = [
      f.plant(f.folder(A, 'not-hex!')), f.plant(f.folder(A, '12345678.part')), f.plant(f.folder(A, 'ABCDEF12')), f.plant(f.folder(A, '1234567')),
      f.plant(path.join(f.base, 'zzzz', A, 'eeeeeeee')), f.plant(path.join(f.base, PROFILE, 'SHORT', 'eeeeeeee')), f.plant(path.join(f.base, PROFILE, B.toUpperCase(), 'eeeeeeee')),
      f.plant(path.join(f.dir, 'extension-packages-old', PROFILE, A, 'eeeeeeee')), f.plant(path.join(f.dir, 'other', PROFILE, A, 'eeeeeeee')), f.plant(path.join(f.dir, PROFILE, A, 'eeeeeeee'))];
    const fileAsLeaf = path.join(f.base, PROFILE, A, 'ffffffff'); fs.writeFileSync(fileAsLeaf, 'a file, not a folder');
    fs.utimesSync(fileAsLeaf, new Date(OLD), new Date(OLD));
    const strayFile = path.join(f.base, PROFILE, 'stray.txt'); fs.writeFileSync(strayFile, 'x');
    const link = path.join(f.base, PROFILE, A, '99999999'); fs.symlinkSync(outside, link, 'junction');
    await f.manager.restore();
    for (const d of [...decoys, fileAsLeaf, strayFile]) assert.equal(f.exists(d), true, 'untouched: ' + path.relative(f.dir, d));
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'keep', 'what a link points to is never touched');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true, 'nor the link itself');
    assert.equal(f.exists(f.saved[0].path), true);
  } finally { f.done(); }
});

test('a saved list that cannot be read, has no entries, or is missing: nothing at all is removed', async () => {
  for (const damage of ['garbage', 'no entries', 'missing', 'garbage at start']) {
    const f = fixture({entries: [{id: A, leaf: 'aaaaaaaa'}], corrupt: damage === 'garbage at start'});
    try {
      const orphan = f.plant(f.folder(B, 'dddddddd'));
      if (damage === 'garbage') fs.writeFileSync(f.registryPath, '{"version":2,"entries":[{');
      if (damage === 'no entries') fs.writeFileSync(f.registryPath, JSON.stringify({version: 2}));
      if (damage === 'missing') fs.rmSync(f.registryPath);
      await f.manager.restore();
      assert.equal(f.exists(orphan), true, damage + ': the orphan stays too (when in doubt, nothing is deleted)');
      assert.equal(f.exists(f.saved[0].path), true, damage + ': a saved extension\'s folder stays');
    } finally { f.done(); }
  }
});

test('a saved entry the list loader would drop (no profile) still protects the folder it names', async () => {
  const f = fixture({entries: [{id: A, leaf: 'aaaaaaaa'}]});
  try {
    const odd = f.plant(f.folder(B, 'dddddddd')), orphan = f.plant(f.folder(B, 'eeeeeeee'));
    const list = JSON.parse(fs.readFileSync(f.registryPath, 'utf8'));
    list.entries.push({id: B, path: odd, name: 'Odd'}, {id: B, profileId: 7, path: 'relative/only', previousPath: odd});
    fs.writeFileSync(f.registryPath, JSON.stringify(list));
    await f.manager.restore();
    assert.equal(f.exists(odd), true, 'named by an entry of a shape the loader rejects: kept');
    assert.equal(f.exists(orphan), false, 'the unnamed one beside it goes');
  } finally { f.done(); }
});

test('a folder changed in the last two minutes stays (another start, a slow copy), an older one goes', async () => {
  const f = fixture({entries: [{id: A, leaf: 'aaaaaaaa'}]});
  try {
    const fresh = f.plant(f.folder(B, 'dddddddd'), {age: Date.now() - 30 * 1000}), old = f.plant(f.folder(B, 'eeeeeeee'), {age: Date.now() - 5 * 60 * 1000});
    await f.manager.restore();
    assert.equal(f.exists(fresh), true); assert.equal(f.exists(old), false);
  } finally { f.done(); }
});

test('an install in progress is never touched (the sweep waits), and the folder it registers is kept afterwards', async () => {
  let release, working = null;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({download: async (id, folder) => { working = folder; fs.mkdirSync(folder, {recursive: true}); fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifestOf('Fresh'))); await gate; return {path: folder, manifest: manifestOf('Fresh'), id, packageHash: 'h1', publisherVerified: true, source: 'Chrome Web Store', sourceURL: 'u'}; }});
  try {
    const orphan = f.plant(f.folder(B, 'dddddddd'));
    const installing = f.manager.command({type: 'install', profileId: 'p', extensionId: A});
    for (let i = 0; i < 50 && !working; i++) await new Promise(r => setTimeout(r, 20));
    assert.ok(working, 'the install made its folder');
    fs.utimesSync(working, new Date(OLD), new Date(OLD));   // even an "old" looking one
    await f.manager.restore();
    assert.equal(f.exists(working), true, 'the folder the install works in is untouched');
    assert.equal(f.exists(orphan), true, 'and the sweep did not run while a command was running');
    release();
    const result = await installing;
    assert.equal(result.error, undefined, JSON.stringify(result).slice(0, 200));
    assert.equal(f.exists(working), true, 'the installed extension\'s folder is there');
    await f.manager.restore();
    assert.equal(f.exists(orphan), false, 'the next restore sweeps the leftover');
    assert.equal(f.exists(working), true, 'and keeps the extension that was just installed');
    assert.deepEqual(f.manager.list('p').extensions.map(e => e.id), [A]);
  } finally { release && release(); f.done(); }
});

test('it runs once per start: a leftover made after the first sweep waits for the next start', async () => {
  const f = fixture({entries: [{id: A, leaf: 'aaaaaaaa'}]});
  try {
    const first = f.plant(f.folder(B, 'dddddddd'));
    await f.manager.restore();
    assert.equal(f.exists(first), false);
    const later = f.plant(f.folder(B, 'eeeeeeee'));
    await f.manager.restore();
    assert.equal(f.exists(later), true, 'not scanned again in the same run');
  } finally { f.done(); }
});

test('deleting a leftover never follows a link inside it: what the link points to survives', async () => {
  const f = fixture({entries: [{id: A, leaf: 'aaaaaaaa'}]});
  try {
    const outside = path.join(f.dir, 'outside'); fs.mkdirSync(path.join(outside, 'deep'), {recursive: true}); fs.writeFileSync(path.join(outside, 'deep', 'sentinel.txt'), 'keep');
    const orphan = f.plant(f.folder(B, 'dddddddd'));
    fs.symlinkSync(outside, path.join(orphan, 'js', 'link'), 'junction');
    fs.utimesSync(orphan, new Date(OLD), new Date(OLD));
    await f.manager.restore();
    assert.equal(f.exists(orphan), false, 'the leftover is gone');
    assert.equal(fs.readFileSync(path.join(outside, 'deep', 'sentinel.txt'), 'utf8'), 'keep', 'the link\'s target is untouched');
  } finally { f.done(); }
});
