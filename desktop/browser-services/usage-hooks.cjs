'use strict';
// Which feature use an action, a browser command or an interface note counts as, for the daily usage message (schema 4, Beta 14). Pure tables and functions, so a test can
// check every one: main.cjs calls them from the places every action, browser command and interface note already goes through, and counts only the NAME (usage-facts.cjs
// USES), never the address, text or title that came with it. Nothing here is called for a private or Tor window.
const { USES } = require('./usage-facts.cjs');

/** Uses that main counts itself, from an action, a browser command, a service request or an event of its own: the interface may not report them (it could only repeat them). Every other name of USES
 *  may be counted from the interface (src/features/metrics/noteUse.ts) or from main (`usageNote`), whichever side sees the feature, so a feature that is still being built can be counted from where it lives. */
const MAIN_ONLY = Object.freeze(['torTabs', 'torWindows', 'privateTabs', 'privateWindows', 'splitView', 'rewind', 'tabSets', 'workspaceSwitches', 'tabGroups', 'vpnToggles', 'peek', 'downloads', 'bookmarksAdded', 'historyOpened', 'findInPage', 'zoomChanges',
  'passwordSaves', 'passwordFills', 'extensionInstalls', 'extensionPopupOpens', 'importAttempted', 'importCompleted', 'settingsOpened', 'fullscreen', 'printOrSavePdf', 'siteProtectionToggles', 'nowPlayingCardActions', 'feedbackSent',
  'insiderActivated', 'insiderDeclined', 'insiderCodeOk', 'insiderCodeInvalid', 'insiderCodeUsed', 'insiderCodeExpired', 'insiderCodeRevoked', 'insiderCodeRateLimited', 'insiderCodeOffline', 'insiderInviteCreated', 'insiderMoveCodeMade', 'insiderChannelOn', 'insiderChannelOff']);
for (const name of MAIN_ONLY) if (!USES.includes(name)) throw new Error('usage-hooks: ' + name + ' is not a use in usage-facts.cjs');
/** Interface-side notes (noteUse.ts): the names the interface may report. 'windowView' is the rating-only note the interface has always sent. */
const UI_NOTES = Object.freeze([...USES.filter((name) => !MAIN_ONLY.includes(name)), 'windowView']);

const INTERNAL_PAGE = /^acira:\/\/(history|settings)(?:[/?#]|$)/i;
/** 'history' or 'settings' for those Acira pages (never any other address), else ''. */
const pageOf = (url) => { const match = INTERNAL_PAGE.exec(typeof url === 'string' ? url : ''); return match ? match[1].toLowerCase() : ''; };

/** The uses an action counts as. `state` (the window's snapshot) tells a bookmark that is added from one that is removed by the same star. */
function forAction(action, state) {
  const names = [];
  if (!action || typeof action !== 'object') return names;
  switch (action.type) {
    case 'tab.new': case 'tab.navigate': { const page = pageOf(action.url); if (page === 'history') names.push('historyOpened'); else if (page === 'settings') names.push('settingsOpened'); break; }
    case 'bookmark.add': names.push('bookmarksAdded'); break;
    case 'bookmark.toggle': if (state && Array.isArray(state.bookmarks) && typeof action.url === 'string' && !state.bookmarks.includes(action.url)) names.push('bookmarksAdded'); break;
    case 'ui': if (action.action === 'find') names.push('findInPage'); break;
    default: break;
  }
  return names;
}
/** The uses a browser command (browserCommand in main.cjs) counts as. A zoom step is one use; a wheel gesture makes many, so main counts it once per 1.5 s. Everything the now-playing card sends
 *  counts as one action of the card, except its `info` poll (it asks what is playing, several times a second, and is not a person's action); a volume or seek drag makes many, so main counts those
 *  at most once per 1.5 s as well (SLOW_COMMANDS). */
function forCommand(command) {
  if (!command || typeof command !== 'object') return [];
  if (command.type === 'print' || command.type === 'save-pdf') return ['printOrSavePdf'];
  if (command.type === 'zoom') return ['zoomChanges'];
  if (command.type === 'media' && typeof command.action === 'string' && command.action !== 'info') return ['nowPlayingCardActions'];
  return [];
}
/** Whether a counted command is a gesture that repeats (a wheel, a drag): main counts it once per 1.5 s, not once per event. */
const isRepeatingGesture = (command) => Boolean(command) && (command.type === 'zoom' || (command.type === 'media' && (command.action === 'volume' || command.action === 'seek')));
/** The uses a service request counts as. */
function forRequest(request) {
  if (!request || typeof request !== 'object') return [];
  if (request.type === 'imports.run') return ['importAttempted'];
  if (request.type === 'passwords.save') return ['passwordSaves'];
  return [];
}

module.exports = { UI_NOTES, MAIN_ONLY, pageOf, forAction, forCommand, forRequest, isRepeatingGesture };
