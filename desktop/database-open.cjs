'use strict';
// Opens the profile database. A file that cannot be opened (damaged, or written by a newer Acira) used to end in an unhandled
// rejection inside app.whenReady: no window, no message, and a process left running with nothing on screen. Now the person is
// told what is wrong. When a daily copy exists (database-backups.cjs) they may put it back: "Restore the backup from <date>" or "Quit".
// Restoring moves the damaged file aside (renamed, never deleted) and opens the copy. Without a usable copy, or for a profile
// written by a newer Acira (never restored over: that Acira can still read it), the file is not moved, repaired or deleted and Acira quits.
// The words come from the catalog (main.data*), in the system's language: the profile's own language setting is in the file that failed. The reason
// (SQLite's own error) stays as it is.
function openBrowserDatabase({ create, file, showError, quit, closeSplash = () => {}, warn = message => console.warn(message), backups = null, supported = 1, choose = null, formatDay = day => day, t = require('./browser-services/tx.cjs').t }) {
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
    let copy = null;
    try {
      const version = backups ? backups.fileVersion(file) : null;
      const newer = (version !== null && version > supported) || /newer Acira/i.test(reason);
      if (backups && choose && !newer) copy = backups.newestUsable(file, { supported });
    } catch { copy = null; }
    if (!copy) return explain();
    let answer = 'quit';
    try {
      const date = formatDay(copy.day);
      answer = choose({ title, text: reason + '\n\n' + t('main.dataRestoreQuestion', { file, date }), restore: t('main.dataRestoreButton', { date }), quit: t('main.dataQuitButton') });
    } catch { answer = 'quit'; }
    if (answer !== 'restore') return explain();
    let aside = null;
    try {
      aside = backups.restore(file, copy);
      const database = create(file);
      try { warn('Browser data restored from the copy of ' + copy.day + '. The damaged file was kept as "' + aside + '".'); } catch {}
      database.restoredFrom = copy.day;
      return database;
    } catch (restoreError) {
      const why = String((restoreError && restoreError.message) || restoreError).replace(/\s+/g, ' ').slice(0, 200);
      try { warn('Restoring the copy of ' + copy.day + ' failed: ' + why); } catch {}
      // restore() moves everything back when the copy cannot be written, so without `aside` nothing was changed
      return explain(aside ? t('main.dataRestoreFailed', { date: formatDay(copy.day), reason: why, file: aside }) : undefined);
    }
  }
}
module.exports = { openBrowserDatabase };
