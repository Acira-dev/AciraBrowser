'use strict';
/**
 * Fast tab switch (13.6), and the guard that keeps it from ever showing the wrong page (13.7).
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
 * What can go wrong is the layouts that are still on their way. The interface builds every layout from the state it rendered, and stamps it with
 * that state's revision (`stateRevision`). While main has shown a page ahead of the interface, a layout stamped with a revision older than the
 * switch was built before it: applied as sent it would take the page back to a tab the person has left (the report on 13.6: "both tabs appear back
 * and forth for a moment, then it switches"). Such a layout keeps the page main shows; the first layout stamped with the switch's revision or a
 * later one has caught up, is applied as sent, and ends the wait. This holds for every order: a double click, a switch back (A, B, A), a switch to
 * a tab that is not presented early (a new tab page, a sleeping tab) while an earlier one waits, a burst. The wait is by revision, never by tab id,
 * because a layout for tab A can be the old one or the new one.
 *
 * Only a switch the interface does NOT draw itself is presented early (the shortcuts main handles: Cmd/Ctrl+1..9, a notification, an extension). A click
 * is drawn by the interface on its own frame (an optimistic update: its layout follows the action within a few ms), so it takes the old road, exactly as in 13.5.
 *
 * Presenting early only happens when the layout in force is the settled single view of the tab being left (no split, no morph or slide in
 * flight, no popup other than a toast or the zoom badge, nothing hiding the page), the new tab is an ordinary website whose page is alive and
 * already on its address, and nothing else owns the screen (a sign-in, a full-screen page, a link preview, a dialog). Anything else takes the old road.
 */
const STALE_MS = 1500;
const SLIDE_SETTLE_MS = 1500;
const QUIET_OVERLAYS = new Set(['toast', 'zoom']);

const single = layout => !!layout && Array.isArray(layout.views) && layout.views.length === 1 ? layout.views[0] : null;
/** Key order does not matter when two layouts are compared. */
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
/** What differs between the layout main presented and the one the interface sent: the keys, for a rig that audits the prediction. */
const differing = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => key !== 'stateRevision' && canonical(a[key]) !== canonical(b[key]));

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

/** The views a stale layout is applied with: the tab main shows, at the place the layout puts its view (or main's own views when the layout says nothing usable). */
function heldViews(next, layout, shown) {
  if (Array.isArray(next.views) && next.views.length === 1) return [{ ...next.views[0], tabId: shown }];
  return layout && Array.isArray(layout.views) && layout.views.length ? layout.views : next.views;
}

/** The wait between main's early presentation and the interface's own layouts for that switch. */
function createFastSwitch({ now = Date.now, audit = null } = {}) {
  let waiting = null; // { revision: the state revision the interface must have reached, shown: the tab main shows, active: the window's active tab, at, predicted }
  const record = (kind, extra) => { if (audit) audit({ kind, ...extra }); };
  const live = () => { if (waiting && now() - waiting.at > STALE_MS) { record('expired', {}); waiting = null; } return waiting; };
  return {
    /**
     * main reduced a tab.select. Returns the layout to present at once, or null.
     * A select that cannot be presented early (a new tab page, a sleeping tab, a tab the person already had) while an earlier one still waits keeps the wait
     * and moves the revision the interface must reach to this select: the layouts on their way are older than it too.
     * `forced`: this select must take the old road (a tab brought here from another space, a split taken apart). `uiAware`: the interface already draws it.
     */
    select({ previous, state, layout, entry, needsLoad, busy, layoutAt, forced, uiAware }) {
      const to = state && state.activeTabId, from = previous && previous.activeTabId;
      if (!to || to === from) return null;                  // nothing changed: whatever waits keeps waiting
      live();
      // The interface draws this switch itself, on the click's own frame (an optimistic update), and sends its layout right behind the action: it is AHEAD of
      // main, not behind. Nothing to show early (that gained 4 ms on a quiet Mac), and nothing older can still be on its way (every layout it sent before
      // arrived before the action): an earlier wait is over.
      if (uiAware) { if (waiting) { record('ui-ahead', { tabId: to }); waiting = null; } return null; }
      const t = now(), revision = state.revision;
      const early = forced ? null : planSwitch({ previous, state, layout, entry, needsLoad, busy, now: t, layoutAt });
      if (early) { waiting = { revision, shown: to, active: to, at: t, predicted: early }; record('early', { tabId: to }); return early; }
      if (waiting) { waiting.revision = revision; waiting.active = to; waiting.at = t; record('held', { tabId: to }); }
      return null;
    },
    /**
     * A layout from the interface: `{ layout, forceChanged }`. `activeTabId` is the tab the window has now; `current` is the layout in force.
     * Stale layouts (older than the switch, or unstamped) keep the page main shows; the first that has caught up is applied as sent.
     */
    adopt(next, activeTabId, current) {
      if (!live()) return { layout: next, forceChanged: false };
      // something other than a select changed the active tab (the tab shown was closed, another opened): the interface's layout is the answer
      if (activeTabId !== undefined && activeTabId !== waiting.active) { record('moved-on', {}); waiting = null; return { layout: next, forceChanged: true }; }
      const stamp = next.stateRevision;
      if (Number.isInteger(stamp) && Number.isInteger(waiting.revision) && stamp >= waiting.revision) {
        if (audit) {
          const view = single(next);
          if (view && view.tabId === waiting.shown) { const keys = waiting.predicted ? differing(waiting.predicted, next) : ['no prediction']; record(keys.length ? 'differs' : 'matched', { tabId: view.tabId, keys, after: now() - waiting.at, ...(keys.includes('overlay') ? { overlay: [waiting.predicted?.overlay?.kind ?? null, next.overlay?.kind ?? null] } : {}) }); }
          else record('moved', { views: Array.isArray(next.views) ? next.views.length : -1 });
        }
        waiting = null; return { layout: next, forceChanged: true };
      }
      record('stale', { stamp: Number.isInteger(stamp) ? stamp : null });
      return { layout: { ...next, views: heldViews(next, current, waiting.shown) }, forceChanged: false };
    },
    /** Anything that ends the wait: the old road takes over. */
    cancel() { waiting = null; },
    get waiting() { return waiting ? waiting.shown : null; }
  };
}

module.exports = { planSwitch, createFastSwitch, STALE_MS, SLIDE_SETTLE_MS };
