'use strict';
// A running browser keeps its History database open and locked. Importing must still work (from a private copy), never touch the original,
// leave nothing behind, and when History really cannot be read say so calmly, with no error codes, while the other categories still import.
const {test, after} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const {spawn} = require('node:child_process');
const {DatabaseSync} = require('node:sqlite'), {BrowserDatabase} = require('../desktop/database.cjs'), {createImporter} = require('../desktop/imports.cjs'), {createInitialState} = require('../desktop/runtime.cjs');

// Scope leak accounting to this test process. Other parallel suites create and
// remove acira-import-* directories between readdir/stat in the shared OS temp.
const tempKeys = ['TEMP', 'TMP', 'TMPDIR'], originalTmp = Object.fromEntries(tempKeys.map(key => [key, process.env[key]])), ownedTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-running-import-test-'));
for (const key of tempKeys) process.env[key] = ownedTmp;
after(() => { for (const key of tempKeys) { if (originalTmp[key] === undefined) delete process.env[key]; else process.env[key] = originalTmp[key]; } fs.rmSync(ownedTmp, {recursive: true, force: true, maxRetries: 20, retryDelay: 100}); });

// Windows can hold a just-closed database for a moment (and a scanner can too): retry, and never fail a test over leftovers in the temp folder.
const removeFolder = folder => { try { fs.rmSync(folder, {recursive: true, force: true, maxRetries: 20, retryDelay: 100}); } catch {} };
const chromeTime = ms => (BigInt(ms) + 11644473600000n) * 1000n;
// Other test files create and delete their own acira-import-* folders at the same time, so a folder can vanish between listing and looking inside it.
const leftovers = () => fs.readdirSync(os.tmpdir()).filter(name => { if (!name.startsWith('acira-import-')) return false; try { return fs.readdirSync(path.join(os.tmpdir(), name)).includes('History'); } catch { return false; } }).length;
const hashDirectory = directory => Object.fromEntries(fs.readdirSync(directory).sort().map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex')]));

function profile(visits = 3, journal = 'DELETE') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-running-')), location = path.join(root, 'Chrome', 'Default'); fs.mkdirSync(location, {recursive: true});
  fs.writeFileSync(path.join(location, 'Bookmarks'), JSON.stringify({roots: {bookmark_bar: {name: 'Bookmarks bar', children: [{type: 'url', name: 'A page', url: 'https://example.org/page', guid: 'g1'}]}}}));
  const db = new DatabaseSync(path.join(location, 'History')); db.exec(`PRAGMA journal_mode=${journal}; CREATE TABLE urls(url TEXT,title TEXT,last_visit_time INTEGER)`);
  const insert = db.prepare('INSERT INTO urls VALUES(?,?,?)'); for (let i = 0; i < visits; i++) insert.run(`https://example.org/visit-${i}`, `Visit ${i}`, chromeTime(Date.now() - i * 60000)); db.close();
  return {root, location};
}
// Opens History the way a running Chrome does: exclusive locking, held until told to stop.
function runningBrowser(location, journal) {
  const code = `const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec('PRAGMA journal_mode=${journal}');db.exec('PRAGMA locking_mode=EXCLUSIVE');db.exec("INSERT INTO urls VALUES('https://example.org/latest','Latest',${chromeTime(Date.now())})");console.log('locked');process.stdin.resume();process.stdin.on('end',()=>{db.close();process.exit(0);});`;
  const child = spawn(process.execPath, ['--no-warnings', '-e', code, path.join(location, 'History')], {stdio: ['pipe', 'pipe', 'inherit']});
  return new Promise((resolve, reject) => { child.stdout.once('data', () => resolve({stop: () => new Promise(done => { child.once('exit', done); child.stdin.end(); })})); child.once('error', reject); child.once('exit', code => reject(new Error('browser stand-in exited ' + code))); });
}
function importerFor(root) {
  const database = new BrowserDatabase(path.join(root, 'acira.sqlite')); let state = createInitialState();
  const importer = createImporter({database, getState: () => state, commit: next => { state = next; database.saveWindow('main', state); }, roots: [['Chrome', path.join(root, 'Chrome')]]});
  return {importer, database, state: () => state};
}

for (const journal of ['DELETE', 'WAL']) {
  test(`History imports while the browser holds it locked (${journal} journal), without touching the original`, async () => {
    const {root, location} = profile(3, journal), running = await runningBrowser(location, journal), before = leftovers();
    try {
      assert.throws(() => { const direct = new DatabaseSync(path.join(location, 'History'), {readOnly: true}); try { direct.prepare('SELECT count(*) FROM urls').get(); } finally { direct.close(); } }, /locked/i, 'reading the live file directly is what failed before');
      const {importer, database, state} = importerFor(root), [source] = importer.discover(), originals = hashDirectory(location), names = fs.readdirSync(location).sort();
      const preview = importer.preview(source.id); assert.deepEqual(preview.warnings, []); assert.ok(preview.history >= 3, 'history counted: ' + preview.history);
      const batch = importer.run(source.id, ['bookmarks', 'history']);
      assert.deepEqual(batch.results.map(row => [row.category, row.status]), [['bookmarks', 'imported'], ['history', 'imported']]);
      assert.ok(state().browsingHistory.length >= 3 && state().browsingHistory.some(v => v.url === 'https://example.org/visit-1'));
      assert.deepEqual(fs.readdirSync(location).sort(), names, 'no file was added to the browser\'s folder');
      assert.deepEqual(hashDirectory(location), originals, 'and none was changed');
      assert.equal(leftovers(), before, 'the private copy is deleted'); database.close();
    } finally { await running.stop(); removeFolder(root); }
  });
}

test('when History really cannot be read the line is calm and plain, and the other categories still import', () => {
  for (const damage of [location => { fs.rmSync(path.join(location, 'History')); fs.mkdirSync(path.join(location, 'History')); }, location => fs.writeFileSync(path.join(location, 'History'), crypto.randomBytes(8000))]) {
    const {root, location} = profile(); damage(location);
    try {
      const {importer, database, state} = importerFor(root), [source] = importer.discover(), before = leftovers();
      const preview = importer.preview(source.id); assert.deepEqual(preview.warnings, ["Couldn't read Chrome's history right now. Try again, or close Chrome first."]);
      const batch = importer.run(source.id, ['bookmarks', 'history']), history = batch.results.find(row => row.category === 'history');
      assert.equal(history.status, 'failed'); assert.equal(history.error, "Couldn't read Chrome's history right now. Try again, or close Chrome first.");
      assert.ok(!/ERR_|SQLITE|code|0x|errno/i.test(history.error + preview.warnings.join(' ')), 'no error codes in anything shown');
      assert.equal(batch.results.find(row => row.category === 'bookmarks').status, 'imported', 'bookmarks still imported');
      assert.equal(state().bookmarkNodes.filter(n => n.url === 'https://example.org/page').length, 1);
      assert.equal(leftovers(), before, 'nothing left behind even on failure'); database.close();
    } finally { removeFolder(root); }
  }
});
