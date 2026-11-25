import { paneAfterLeaving } from './splitLayout';
import { leaveSplit } from './splitGroups';
import { closeLanding } from './tabTrail';
import { tabIsPinned } from './pinnedFolders';
import type { BrowserSnapshot, TabSession } from './types';

/**
 * Beta 14: closing a pinned tab puts it to sleep; it does not remove it. A pinned tab is a permanent slot (Arc, Zen), so the ×, Ctrl+W,
 * a middle-click, Delete on the row and the tab viewer's close all keep it where it is and unload its page. Removing it is the deliberate
 * "Close and remove" in its menu (`tab.close` with `remove: true`), or Unpin and then close.
 *
 * Main closes the page first, exactly as for any close (main.cjs dispatch: closePage, then the action), so the page's own "Leave this site?"
 * still asks and its sound, camera and microphone stop with it, as when the Memory Saver puts a tab to sleep (desktop/tab-sleep.cjs). This
 * file is the state side: the tab stays, it is marked asleep (clicking it loads the page again, like any sleeping tab), and when it was on
 * screen the window moves to the tab a close would have picked (the split's other pane, the tab that opened it, else the next tab, else the
 * one before; a fresh New Tab when there is no other). The workspace rule for a close (workspaces.ts finishWorkspaces) still applies.
 *
 * Main's own closes that are not the person's (a page closing the tab it opened, an extension's tabs.remove, Tor's new identity, a tab handed
 * to another window) remove the tab as before: they pass `remove` or `handedOver`.
 */

/** A web page that can sleep: what the Memory Saver marks asleep when it has no page (main.cjs tabSleepWake). */
const sleepsAsPage = (tab: TabSession): boolean => tab.contentKind === 'web' && /^https?:/i.test(tab.url);

/** Does a close on this tab keep it (pinned) rather than remove it? */
export const closeKeepsTab = (tab: TabSession | undefined, action: { remove?: boolean; handedOver?: boolean }, state?: Pick<BrowserSnapshot, 'tabGroups'>): boolean =>
  !!tab && (state ? tabIsPinned(state, tab) : !!tab.pinned) && action.remove !== true && action.handedOver !== true; // Beta 14, pinned folders: a tab in a pinned folder is kept like a pinned tab (runtime/pinnedFolders.ts)

/** The × on a pinned tab: offered while there is a page to put to sleep. An asleep pinned tab has nothing to close; its menu removes it. */
export const pinnedCloseOffered = (tab: Pick<TabSession, 'pinned' | 'sleeping'>, kept: boolean = !!tab.pinned): boolean => kept && !tab.sleeping; // `kept`: the row is a pinned one (a loose pinned tab, or a tab of a pinned folder)

export type PinnedRest = { changed: boolean; slept: boolean; movedFrom: boolean };

/**
 * Put the pinned tab at `index` to sleep in place (the reducer's `tab.close` for a pinned tab). `previous` is the state before the action
 * (its split tells which pane takes over); `fresh` makes a New Tab for this tab's profile when nothing else is left.
 * Returns what changed; `changed: false` means nothing to do (an asleep pinned tab that is not on screen), so the reducer keeps `previous`.
 * `empty` (14.1, "After closing a tab: Show an empty page", runtime/emptyPage.ts): the window shows that page instead of another tab; a split still goes to its other pane.
 */
export function restPinnedTab(s: BrowserSnapshot, previous: BrowserSnapshot, index: number, fresh: (profileId: string) => TabSession, soon: ReadonlySet<string> = new Set(), empty?: () => TabSession): PinnedRest {
  const tab = s.tabs[index];
  const panes = previous.windowUi.split?.tabIds, shown = s.activeTabId === tab.id || !!panes?.includes(tab.id);
  const slept = sleepsAsPage(tab) && !tab.sleeping;
  if (!shown && !slept) return { changed: false, slept: false, movedFrom: false };
  if (slept) {
    // The page is gone (main closed it before this action): nothing of it plays, records or loads any more.
    tab.sleeping = true; tab.loading = false; tab.audible = false;
    delete tab.progress; delete tab.media; delete tab.mediaAt; delete tab.capturing;
  }
  // The window moves first (the tab a close would have picked), so a split this tab leaves keeps its other panes on screen (splitGroups.ts leaveSplit
  // ends the split shown only when the leaving tab is still the current one).
  let movedFrom = false;
  if (s.activeTabId === tab.id) {
    const others = s.tabs.filter(item => item.id !== tab.id);
    const partnerId = panes ? paneAfterLeaving(panes, tab.id) : undefined, partner = partnerId && !soon.has(partnerId) ? others.find(item => item.id === partnerId) : undefined;
    // 13.10: the tab shown before this one (its opener, the window's trail, the nearest awake neighbour: runtime/tabTrail.ts), as for any close
    let next = partner || empty?.() || closeLanding(previous, { ...s, tabs: others }, tab, soon) || others[Math.min(index, others.length - 1)];
    if (!next) { next = fresh(tab.browserProfileId); s.tabs.push(next); }
    s.activeTabId = next.id; movedFrom = true;
  }
  // A pane of the split on screen leaves it, as a closed pane does (the rest re-tile), or the split would show it and wake it again. A split that is
  // not on screen keeps it: an asleep pane wakes when that split is opened, as with the Memory Saver's sleep.
  const shownSplit = panes?.includes(tab.id) ? previous.windowUi.split?.groupId : undefined;
  if (shownSplit) for (const group of [...(s.windowUi.splitGroups ?? [])]) if (group.id === shownSplit && group.tabIds.includes(tab.id)) leaveSplit(s, group.id, tab.id);
  if (panes?.includes(tab.id) && s.windowUi.split?.tabIds.includes(tab.id)) s.windowUi.split = { tabIds: s.windowUi.split.tabIds.filter(id => id !== tab.id), groupId: s.windowUi.split.groupId } as typeof s.windowUi.split; // re-tiled like a closed pane (sessionState.ts windowUiState)
  return { changed: true, slept, movedFrom };
}
