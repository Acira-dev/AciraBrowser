'use strict';
/**
 * Fast tab switch (13.6).
 *
 * A tab switch used to show the new page only after the interface had drawn it: main reduced the action, sent the new state, the interface
 * rendered it (the sidebar's rows, the address field, the progress bar...), measured the page area, and only then sent its layout back; main
 * showed the new page view when that layout arrived. That is about 18 ms at 10 tabs and 31 ms at 40, against 1 ms in a bare Electron window,
 * and it grows with the number of rows the interface has to commit.
 *
 * The layout of a plain switch from one website to another does not change: the page area is the same rectangle, the same single view, only the tab
 * behind it. So main presents the new page at once, with the layout it already holds and the tab id of the new tab, in the very step that
 * reduces the action. The interface's own layout still arrives afterwards (the interface stays the authority): when it equals what was presented it
 * changes nothing, and when it differs (a sidebar that is sliding, a page area that moved) main places the page exactly as it did before.
 *
 * Two rules keep this from ever showing a wrong picture:
 *  - It only runs when the layout in force is the settled single view of the tab being left (no split, no morph or slide in flight, no popup other
 *    than a toast or the zoom badge, nothing hiding the page), the new tab is an ordinary website whose page is alive and already on its address,
 *    and nothing else owns the screen (a sign-in, a full-screen page, a link preview, a dialog). Anything else takes the old road.
 *  - A burst of switches (A -> B -> C) leaves the interface's layouts for B and C on their way after main has already shown C. A layout whose single
 *    view is a tab the burst has already left is stale: it carries the newest tab instead, so the page never steps back to B. The layout of the
 *    newest tab ends the wait (and counts as a change, so the side effects of a layout that follows a switch - the caption, the published layout,
 *    the new-tab prime - run exactly once, as before).
 */
const STALE_MS = 1500;
const SLIDE_SETTLE_MS = 1500;
const QUIET_OVERLAYS = new Set(['toast', 'zoom']);

const single = layout => !!layout && Array.isArray(layout.views) && layout.views.length === 1 ? layout.views[0] : null;
/** Key order does not matter when two layouts are compared. */
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
/** What differs between the layout main presented and the one the interface sent: the keys, for a rig that audits the prediction. */
const differing = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => canonical(a[key]) !== canonical(b[key]));

/** The layout to present for a switch to `state.activeTabId`, or null when the switch must wait for the interface. Pure. */
function planSwitch({ previous, state, layout, entry, needsLoad, busy, now, layoutAt }) {
  if (!previous || !state || !layout || busy) return null;
  const to = state.activeTabId, from = previous.activeTabId;
  if (!to || !from || to === from) return null;
  if (previous.activeBrowserProfileId !== state.activeBrowserProfileId || previous.activeWorkspaceId !== state.activeWorkspaceId) return null;
  if (previous.windowUi?.split || state.windowUi?.split) return null;
  const tab = state.tabs.find(item => item.id === to), left = previous.tabs.find(item => item.id === from);
  if (!tab || !left || tab.contentKind !== 'web' || tab.error || tab.browserProfileId !== left.browserProfileId) return null;
  // ordinary or private tabs of one kind; a secured workspace's tabs and Tor tabs have their own gates (a lock, a circuit) and take the old road
  if (tab.privacy !== left.privacy || (tab.privacy && tab.privacy !== 'private')) return null;
  const view = single(layout);
  if (!view || view.tabId !== from || layout.visible === false || layout.pageHold === true) return null;
  if (layout.overlay && !QUIET_OVERLAYS.has(layout.overlay.kind)) return null;
  // a page that is gliding to a new place (the sidebar opening, the toolbar) is not "settled": the interface has more to say about it
  if (layout.pageImmediate === false && now - layoutAt < SLIDE_SETTLE_MS) return null;
  if (!entry || entry.dead || entry.securedLocked || entry.securedRestoring || needsLoad) return null;
  return { ...layout, views: [{ ...view, tabId: to }] };
}

/** The wait between main's early presentation and the interface's own layout for that tab. */
function createFastSwitch({ now = Date.now, audit = null } = {}) {
  let waiting = null; // { tabId, left: Set of tab ids the burst has left, at, predicted }
  const record = (kind, extra) => { if (audit) audit({ kind, ...extra }); };
  return {
    /** Remember that the page of `tabId` was shown ahead of the interface (as `predicted`); `from` is the tab it replaced. */
    note(tabId, from, predicted) {
      const t = now();
      if (waiting && t - waiting.at < STALE_MS) { waiting.left.add(waiting.tabId); waiting.left.add(from); waiting.tabId = tabId; waiting.left.delete(tabId); waiting.at = t; waiting.predicted = predicted; }
      else waiting = { tabId, left: new Set([from]), at: t, predicted };
      record('early', { tabId });
    },
    /** A layout from the interface: `{ layout, forceChanged }`. `activeTabId` is the tab the window has now: when something else changed it (the tab was closed, another was opened) the wait is over. */
    adopt(next, activeTabId) {
      if (!waiting) return { layout: next, forceChanged: false };
      if (now() - waiting.at > STALE_MS) { record('expired', {}); waiting = null; return { layout: next, forceChanged: false }; }
      if (activeTabId !== undefined && activeTabId !== waiting.tabId) { record('moved-on', {}); waiting = null; return { layout: next, forceChanged: true }; }
      const view = single(next);
      if (view && view.tabId === waiting.tabId) {
        if (audit) { const keys = waiting.predicted ? differing(waiting.predicted, next) : ['no prediction']; record(keys.length ? 'differs' : 'matched', { tabId: view.tabId, keys, after: now() - waiting.at, ...(keys.includes('overlay') ? { overlay: [waiting.predicted?.overlay?.kind ?? null, next.overlay?.kind ?? null] } : {}) }); }
        waiting = null; return { layout: next, forceChanged: true };
      }
      if (view && waiting.left.has(view.tabId)) { record('stale', { tabId: view.tabId }); return { layout: { ...next, views: [{ ...view, tabId: waiting.tabId }] }, forceChanged: false }; }
      // the interface is showing something else now (a split, a new tab page, nothing): it has caught up with whatever it wants
      record('moved', { views: next.views.length }); waiting = null;
      return { layout: next, forceChanged: true };
    },
    /** Anything that ends the wait: the old road takes over. */
    cancel() { waiting = null; },
    get waiting() { return waiting ? waiting.tabId : null; }
  };
}

module.exports = { planSwitch, createFastSwitch, STALE_MS, SLIDE_SETTLE_MS };
