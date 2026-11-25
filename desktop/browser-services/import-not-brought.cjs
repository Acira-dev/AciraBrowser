'use strict';
// What an import leaves behind, said in the import screen before and after it runs (Beta 14: "say plainly what could not be brought").
// The main process only names each item: [{id, count?}]. The interface words it in the person's language (import.not.<id>), so
// nothing here is a sentence. Two kinds: what a browser keeps for itself and Acira has no version of (always listed for that
// browser), and what this particular profile did not give (counted: tabs that are not web pages, tabs over the limit, entries
// over what Favorites hold, files the browser encrypted, ...).

/** The source's own things that never come over, by browser name. */
const OWN = Object.freeze({ Opera: 'opera', 'Opera GX': 'opera', Vivaldi: 'vivaldi', Zen: 'zen', Safari: 'safari' });

/** facts: {notWeb, cut, spacesAsGroups, favoritesOverflow, encrypted, unreadable, unknown, favoritesFrom, limits: {tabs, workspaces, favorites}} (every one optional);
 *  a counted item carries the limit it ran into, so the words never hard-code a number Acira may change. */
function notBroughtFor(browser, facts = {}) {
  const items = [];
  const limits = facts.limits || {};
  const count = (id, value, limit) => {
    if (Number.isFinite(value) && value > 0) items.push({ id, count: value, ...(Number.isFinite(limit) ? { limit } : {}) });
  };
  if (facts.encrypted) items.push({ id: 'sessionEncrypted' });
  else if (facts.unreadable) items.push({ id: 'sessionUnreadable' });
  if (facts.unknown) items.push({ id: 'workspacesUnknown' });
  count('notWebTabs', facts.notWeb);
  count('tabsCut', facts.cut, limits.tabs);
  count('spacesAsGroups', facts.spacesAsGroups, limits.workspaces);
  count(facts.favoritesFrom === 'essentials' ? 'essentialsOverflow' : 'speedDialOverflow', facts.favoritesOverflow, limits.favorites);
  if (OWN[browser]) items.push({ id: OWN[browser] });
  return items;
}

module.exports = { notBroughtFor, OWN };
