'use strict';
// Reading another browser's SQLite database while that browser runs (D's approach, shared by every importer). A running
// browser keeps its database open and locked, so asking people to close it first is poor. The file and its journal / WAL
// are copied to a private temporary folder with shared access (the copy opens them with FILE_SHARE_READ|WRITE|DELETE on
// Windows, which browsers allow), the copy is queried, and the copy is deleted. The browser's own files are only read.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

function copyShared(from, to) {
  const input = fs.openSync(from, 'r');
  try {
    const output = fs.openSync(to, 'w', 0o600);
    try {
      const buffer = Buffer.allocUnsafe(1 << 20);
      for (;;) {
        const read = fs.readSync(input, buffer, 0, buffer.length, null);
        if (!read) break;
        fs.writeSync(output, buffer, 0, read);
      }
    } finally {
      fs.closeSync(output);
    }
  } finally {
    fs.closeSync(input);
  }
}

/** Removes the private copy. On Windows a virus scanner often still holds a freshly written copy of a big database (EBUSY/EPERM): it is tried again a few times, and then once
 *  more a little later; whatever happens it never throws, so a good read is not turned into "couldn't read" by the clean-up after it. */
function removeCopy(directory) {
  const attempt = () => fs.rmSync(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  try { attempt(); } catch {
    const later = setTimeout(() => { try { attempt(); } catch { /* left in the temporary folder, which Windows empties itself */ } }, 5000);
    later.unref?.();
  }
}

/** Copies `name` (required) plus `name-wal` / `name-journal` (when present) from `location` into a new private folder. */
function snapshot(location, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-import-'));
  try {
    for (const file of [name, name + '-wal', name + '-journal']) {
      const from = path.join(location, file);
      if (file === name || fs.existsSync(from)) copyShared(from, path.join(directory, file));
    }
    return directory;
  } catch (error) {
    removeCopy(directory);
    throw error;
  }
}

/** use(database) runs on a copy; one more copy is tried if the first was caught mid-write. If nothing can be copied, the
 *  original is opened read-only as a last resort. The copy is always deleted. */
function readDatabase(location, name, use) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    let directory = null, input = null;
    try {
      directory = snapshot(location, name);
      input = new DatabaseSync(path.join(directory, name));
      input.exec('PRAGMA query_only=ON');
      return use(input);
    } catch (error) {
      failure = error;
    } finally {
      try { input?.close(); } catch {}
      if (directory) removeCopy(directory);
    }
  }
  let direct = null;
  try {
    direct = new DatabaseSync(path.join(location, name), { readOnly: true });
    return use(direct);
  } catch {
    throw failure;
  } finally {
    try { direct?.close(); } catch {}
  }
}

module.exports = { copyShared, snapshot, readDatabase, removeCopy };
