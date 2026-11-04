'use strict';
// Opens the profile database. A file that cannot be opened (damaged, or written by a newer Acira) used to end in an unhandled
// rejection inside app.whenReady: no window, no message, and a process left running with nothing on screen. Now the person is
// told what is wrong, and there is always a way on that loses nothing:
// - damaged, with a daily copy (database-backups.cjs): "Restore the backup from <date>" or "Quit";
// - damaged, with no usable copy: "Start fresh" or "Quit";
// - written by a newer Acira (never restored over: that Acira can still read it): "Quit" (the default: install the newer Acira) or "Start fresh".
// Each question says that Quit changes nothing, so no second message follows it.
// Restoring and starting fresh first move the file aside (renamed, never deleted; the name is given in the question). A file that may be fine (busy, a
// read-only folder, a full disk, an update of its layout that failed and was rolled back) is not moved, repaired or deleted: Acira explains and quits.
// The words come from the catalog (main.data*), in the system's language: the profile's own language setting is in the file that failed. The reason
// (SQLite's own error) stays as it is.
const path=require('node:path'),fs=require('node:fs');
function openBrowserDatabase({ create, file, showError, quit, closeSplash = () => {}, warn = message => console.warn(message), backups = null, supported = 1, choose = null, formatDay = day => day, t = require('./browser-services/tx.cjs').t, now = Date.now, kindOf = require('./database.cjs').kindOf }) {
  try {
    return create(file);
  } catch (error) {
    const reason = String((error && error.message) || error || 'The file could not be read.').replace(/\s+/g, ' ').slice(0, 300);
    try { warn('Browser data could not be opened: ' + reason); } catch {}
    try { closeSplash(); } catch {}
    const title = t('main.dataOpenTitle');
    const explain = (text = t('main.dataNothingChanged', { file })) => {
      try { showError(title, reason + '\n\n' + text); } catch {}
      try { quit(); } catch {}
      return null;
    };
    const ask = question => { try { return choose(question); } catch { return 'quit'; } };
    /** Where the old files are, for main.dataKeptAside: the database's name alone when its logs are beside it, every place when they were parted. */
    const kept = places => places.every(place => ['', '-wal', '-shm'].some(suffix => place === places[0] + suffix)) ? places[0] : places.join(', ');
    // the question itself says that Quit changes nothing, so no second message follows it
    const leave = () => { try { quit(); } catch {} return null; };
    let kind = 'other';
    try { kind = kindOf(error); } catch {}
    try { const version = backups ? backups.fileVersion(file) : null; if (version !== null && version > supported) kind = 'newer'; } catch {}
    if (!backups || !choose || (kind !== 'damaged' && kind !== 'newer')) return explain();
    /** Moves the file aside as `aside` and makes a new, empty one. When no new one can be made, the old file is put back and Acira explains and quits. */
    const startFresh = aside => {
      let moved;
      try { moved = backups.setAside(file, aside); } catch (moveError) { try { warn('The file could not be moved aside: ' + (moveError && moveError.message)); } catch {} return explain(); }
      try {
        const database = create(file);
        try { warn('Started with new browser data. The old file was kept as "' + aside + '".'); } catch {}
        database.startedFresh = aside;
        return database;
      } catch (freshError) {
        try { warn('A new data file could not be made either: ' + (freshError && freshError.message)); } catch {}
        // what the failed attempt left goes (best effort: Windows may still hold it), then the old file is put back over it. Not while a log it did not
        // move is still there (the new file's, held by a virus scanner): SQLite would apply that log to the old file. Only a put-back that is checked
        // may say that nothing was changed; otherwise the message names where the old files are.
        for (const suffix of ['', '-wal', '-shm']) try { fs.rmSync(file + suffix, { force: true }); } catch {}
        let places = [aside];
        try { places = ['-wal', '-shm'].some(suffix => !moved.includes(suffix) && fs.existsSync(file + suffix)) ? [aside] : backups.putBack(file, aside, moved); } catch {}
        if (!places.length && fs.existsSync(file) && !fs.existsSync(aside)) return explain();
        return explain(t('main.dataKeptAside', { file: kept(places.length ? places : [aside]) }));
      }
    };
    if (kind === 'newer') {
      const aside = backups.asideName(file, { now: now(), label: 'newer' });
      const answer = ask({ title, text: t('main.dataNewerQuestion', { file, aside: path.basename(aside) }), fresh: t('main.dataFreshButton'), quit: t('main.dataQuitButton'), preferred: 'quit' });
      return answer === 'fresh' ? startFresh(aside) : leave();
    }
    let copy = null;
    try { copy = backups.newestUsable(file, { supported }); } catch { copy = null; }
    if (!copy) {
      const aside = backups.asideName(file, { now: now() });
      const answer = ask({ title, text: reason + '\n\n' + t('main.dataFreshQuestion', { file, aside: path.basename(aside) }), fresh: t('main.dataFreshButton'), quit: t('main.dataQuitButton'), preferred: 'fresh' });
      return answer === 'fresh' ? startFresh(aside) : leave();
    }
    let answer = null;
    try {
      const date = formatDay(copy.day);
      answer = choose({ title, text: reason + '\n\n' + t('main.dataRestoreQuestion', { file, date }), restore: t('main.dataRestoreButton', { date }), quit: t('main.dataQuitButton'), preferred: 'restore' });
    } catch { answer = null; }
    // Quit, like the other questions, needs no second message; a question that could not be asked at all is still explained
    if (answer === null) return explain();
    if (answer !== 'restore') return leave();
    let aside = null;
    try {
      aside = backups.restore(file, copy, { now: now() });
      const database = create(file);
      try { warn('Browser data restored from the copy of ' + copy.day + '. The damaged file was kept as "' + aside + '".'); } catch {}
      database.restoredFrom = copy.day;
      return database;
    } catch (restoreError) {
      const why = String((restoreError && restoreError.message) || restoreError).replace(/\s+/g, ' ').slice(0, 200);
      try { warn('Restoring the copy of ' + copy.day + ' failed: ' + why); } catch {}
      // restore() moves everything back when the copy cannot be written, so without `aside` nothing was changed, unless it says what stayed aside
      const keptAt = restoreError && Array.isArray(restoreError.keptAt) && restoreError.keptAt.length ? restoreError.keptAt : null;
      return explain(aside ? t('main.dataRestoreFailed', { date: formatDay(copy.day), reason: why, file: aside }) : keptAt ? t('main.dataKeptAside', { file: kept(keptAt) }) : undefined);
    }
  }
}
module.exports = { openBrowserDatabase };
