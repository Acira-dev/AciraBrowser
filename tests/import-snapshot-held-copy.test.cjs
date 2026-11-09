'use strict';
// Windows: a virus scanner can still hold the private copy of another browser's History database when the import is done with it (EBUSY/EPERM). The clean-up after
// a good read used to throw out of `finally` and turn it into "Couldn't read the history". It is tried again, never throws, and a good read stays good.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { readDatabase } = require('../desktop/browser-services/import-snapshot.cjs');

function withHistory(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-import-source-'));
  try {
    const db = new DatabaseSync(path.join(dir, 'History'));
    db.exec("CREATE TABLE urls(url TEXT, title TEXT, last_visit_time INTEGER); INSERT INTO urls VALUES ('https://example.com/', 'Example', 1)");
    db.close();
    return run(dir);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const isCopy = prefix => String(prefix).includes('acira-import-') && !String(prefix).includes('acira-import-source-');
/** Runs `run` with mkdtemp watched: returns what it returned and the private copies made meanwhile (other test files run in their own processes and share the temp folder, so the folder itself is never listed). */
function watching(run, refuse = () => false) {
  const realMk = fs.mkdtempSync, realRm = fs.rmSync, made = [], refused = [];
  fs.mkdtempSync = function (prefix, ...rest) { const dir = realMk.call(this, prefix, ...rest); if (isCopy(prefix)) made.push(dir); return dir; };
  fs.rmSync = function (target) {
    if (made.includes(String(target)) && refuse(String(target))) { refused.push(String(target)); const error = new Error("EPERM: operation not permitted, rmdir '" + target + "'"); error.code = 'EPERM'; throw error; }
    return realRm.apply(this, arguments);
  };
  try { return { value: run(), made, refused }; } finally { fs.mkdtempSync = realMk; fs.rmSync = realRm; }
}

test('a copy the scanner still holds does not turn a good read into an error', () => withHistory(dir => {
  const { value, made, refused } = watching(() => readDatabase(dir, 'History', input => input.prepare('SELECT url FROM urls').all().map(row => row.url)), () => true);
  assert.deepEqual(value, ['https://example.com/']);
  assert.ok(refused.length >= 1, 'the clean-up was refused at least once');
  for (const copy of made) fs.rmSync(copy, { recursive: true, force: true });
}));

test('without a held copy the private copy is removed as before', () => withHistory(dir => {
  const { value, made } = watching(() => readDatabase(dir, 'History', input => input.prepare('SELECT title FROM urls').all().map(row => row.title)));
  assert.deepEqual(value, ['Example']);
  assert.equal(made.length, 1);
  // on a real Windows computer a scanner may still hold the fresh copy for a moment: the clean-up then waits and tries again, which the first test covers
  if (process.platform !== 'win32') assert.equal(fs.existsSync(made[0]), false, 'the copy is gone');
  else fs.rmSync(made[0], { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}));
