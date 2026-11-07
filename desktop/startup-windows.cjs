'use strict';
// Which windows open when Acira starts (Settings > Tabs > When Acira starts).
//
// "Continue where you left off" (the default) opens every window that was open, with its tabs (open-windows.cjs lists them).
// "Open a New Tab" opens the first of them alone, on a New Tab: the setting is read from that window's saved settings, since the
// app has no state of its own before a window loads one. The windows and tabs that are not opened are not deleted from the
// profile: each one is handed to Rewind first (`dropped` and `ids` below let main do that), which keeps closed windows.
const NEW_TAB = 'newtab';

/**
 * @param {string[]} ids windows the last session left open (open-windows.cjs `restorable()`), at least one
 * @param {{readWindow:(id:string)=>any}} database
 * @returns {{ids:string[],dropped:string[],fresh:boolean}} `ids` open now; `dropped` stay unopened; `fresh` is true when the first
 *   of them opens on a New Tab
 */
function chooseStartWindows(ids, database) {
  let fresh = false;
  try {
    // an unreadable record is not an answer: the window asks what to do about it as before (saved-window.cjs)
    fresh = Array.isArray(ids) && ids.length > 0 && database.readWindow(ids[0])?.settings?.onStartup === NEW_TAB;
  } catch { fresh = false; }
  return fresh ? { ids: ids.slice(0, 1), dropped: ids.slice(1), fresh } : { ids, dropped: [], fresh };
}

module.exports = { chooseStartWindows };
