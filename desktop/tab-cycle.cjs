'use strict';
/* Ctrl+Tab, decided and done in main (Beta 14, A11).
 *
 * It used to be the interface's job: main heard the key, sent `tab-switcher-open` to the interface, the interface worked out the tab and asked main to select it
 * (an "optimistic" select, which main then showed only after the interface's own layout came back), and the key's release took the same road. Every step waited
 * for the interface's thread; while tabs were loading (titles, icons, progress, the tab list redone for each) a press was answered late or not at all, and a held key
 * queued one message per repeat that the interface took in slowly and played back long after the keys were let go (reported 13 Nov). The 13.8 handler also gave up
 * on a release more than 10 s after the last Tab, which left "Recent tabs" open and unable to open again.
 *
 * Now main owns the whole key: it tells the tab to select the moment the key arrives (the page is shown in that same step, fast-switch.cjs, like Ctrl+1…9), and
 * the interface is only told when there is something to draw (the Recent tabs list). The rules, one place:
 *  - a held key steps at most once per REPEAT_MS: a repeat that comes sooner is DROPPED, never queued, so there is no backlog to play back; a key-down that arrives
 *    while Tab is already down (a repeat the system did not flag) counts as a repeat;
 *  - letting go of Ctrl/Cmd (or the window losing focus, or a later key-down that no longer has Ctrl/Cmd in it, because Chromium can drop a key-up) ends the hold,
 *    at once, whenever it comes: there is no time limit on it;
 *  - "Next tab" selects on every press, "Recently used" counts presses and selects when Ctrl is let go before HOLD_MS (a quick tap is instant and shows nothing), or
 *    asks the interface for the list when it is still held after HOLD_MS (the list's own steps and release go to it as before), "Tab viewer" opens the viewer.
 *  - Beta 14, "While switching, show": the viewer with page pictures (or the names list) is drawn when Ctrl is still held after HOLD_MS, in either order. In "Next tab" the tab has
 *    already been switched to on every press, so the viewer only shows where you are (the row in the list's order, the current tab lit) and releasing Ctrl changes nothing; in "Recently used"
 *    the viewer is the one that picks, as the names list was. With "Nothing" nothing is ever drawn: Ctrl+Tab just switches. The switch never waits for the viewer.
 *  - D188 part 2 (24 Nov): with Pictures or Names on, the viewer is asked for ON THE PRESS, for a tap as for a hold (it used to wait HOLD_MS, so a Ctrl+Tab let go at about that time showed nothing, a
 *    flash after Ctrl was up, or the viewer: "sometimes"). Nothing never asks. A release in "Recently used" that the viewer has not stepped switches to the counted tab here, at once, whatever the viewer does.
 *  - D188 (reported 24 Nov: "it works first, sometimes, and then Ctrl+Tab just switches"): the viewer must come on EVERY hold, not only when the last one was long gone. (1) A viewer that is
 *    still LEAVING (its 140 ms reverse and the close, up to ~250 ms after Ctrl went up) belongs to the PREVIOUS hold: it never counts as "the viewer is up" for this one (it used to, and then no
 *    viewer was asked for: the tab switched and nothing came); the new viewer waits until the old one is gone (LEAVE_POLL_MS, at most LEAVE_WAIT_MS). (2) A hold whose viewer closed on a Ctrl
 *    release main never heard (Chromium drops key-ups after a handled key, or the key-up went to a page that was hidden) must not outlive it: a Tab press that finds its own viewer gone (asked
 *    for more than STALE_MS ago, nothing on screen), or a Ctrl/Cmd key-down that comes more than REPEAT_GAP after the last one, is a new hold.
 * Pure: the clock, the timers and everything that touches a window are given in. */
const REPEAT_MS = 150;  // a held key steps at most once per this (the AG viewer's pace is the same rule)
const HOLD_MS = 120;    // no longer a tap rule (D188 part 2: the viewer is asked for on the press): the time the page veil waits behind a viewer (page-scrim.cjs SWITCHER_VEIL_MS is the same figure), so a tap shows the viewer alone
const LEAVE_POLL_MS = 20;  // D188: a new viewer waits for the previous one to finish leaving, looking this often...
const LEAVE_WAIT_MS = 400; // ...and for at most this long (the reverse plays 140 ms, then the surface closes)
const STALE_MS = 500;      // D188: a viewer asked for this long ago and not on screen is gone: the hold that asked for it is over
const REPEAT_GAP = 1100;   // D188: a Ctrl/Cmd key-down this long after the last one is a new press, not a repeat (a held key repeats after at most a second, then every 500 ms or less)
const SHARE = 64;       // how many of the newest activation times go to the interface with a request for the list
const MODES = new Set(['next', 'recent', 'viewer']);
const SHOWS = new Set(['pictures', 'names', 'nothing']);

function createTabCycle(deps = {}) {
  const now = deps.now || Date.now;
  const setTimer = deps.setTimer || ((fn, ms) => setTimeout(fn, ms)), clearTimer = deps.clearTimer || (id => clearTimeout(id));
  const stampActivation = deps.stampActivation;
  let mode = 'next', show = 'pictures', unlisted = new Set(), stamps = {};
  let held = false, tabDown = false, steps = 0, open = false, listStepped = false, sessionMode = 'next', sessionShow = 'pictures', lastStepAt = -Infinity, lastDirection = 1, timer = null, dropped = 0, openedAt = -Infinity, modifierAt = -Infinity, leaveWaited = 0, heldFrom = null;

  const newest = () => Object.fromEntries(Object.entries(stamps).sort((a, b) => b[1] - a[1]).slice(0, SHARE));
  const reset = () => { if (timer !== null) { clearTimer(timer); timer = null; } held = false; tabDown = false; steps = 0; open = false; listStepped = false; leaveWaited = 0; };

  /** The viewer (or the list) is wanted: on the press (D188 part 2). `order` is the tabs it shows, in the order main walks them. */
  const askForList = () => {
    timer = null; if (!held || open) return;
    // the previous hold's viewer is still on its way out: ask when it has gone (one viewer at a time; the interface would otherwise close the new one with the old)
    if (deps.viewerLeaving && deps.viewerLeaving() && leaveWaited < LEAVE_WAIT_MS) { leaveWaited += LEAVE_POLL_MS; timer = setTimer(askForList, LEAVE_POLL_MS); return; }
    open = true; openedAt = now(); deps.openSwitcher({ start: steps, direction: lastDirection, stamps: newest(), order: deps.orderFor(sessionMode), mode: sessionMode, first: true }); };

  function release() {
    if (!held) return;
    const quickTap = sessionMode === 'recent' && !open && !listStepped && steps !== 0, counted = steps, listed = open || listStepped, asked = open, stepped = listStepped, changed = heldFrom !== null && deps.activeTab && deps.activeTab() !== heldFrom;
    reset();
    if (quickTap) { const id = deps.recentTarget(counted, stamps); if (id) deps.select(id); }
    else if (listed) {
      // "Recently used": the viewer was asked for on the press and nobody stepped in it, so the choice is the counted tab: made here at once, not when the viewer has heard the release
      if (sessionMode === 'recent' && asked && !stepped && !changed && counted !== 0) { const id = deps.recentTarget(counted, stamps); if (id) deps.select(id); }
      deps.releaseSwitcher();
    }
  }

  return {
    /** Tab / Shift+Tab with Ctrl (Cmd): `repeat` is the key's own auto-repeat flag, `showing` is true while the Recent tabs list or the tab viewer is on screen (its steps go to it),
     *  `tap` is a command from a menu (no key-up will follow: it acts once and holds nothing). Returns what became of it, for the tests. */
    press(direction, { repeat = false, showing: onScreen = false, viewer = null, tap = false } = {}) {
      const step = direction < 0 ? -1 : 1, t = now();
      if (tap) {
        const id = mode === 'recent' ? deps.recentTarget(step, stamps) : mode === 'next' ? deps.nextTab(step, unlisted) : null;
        if (mode === 'viewer') deps.openViewer(step); else { deps.reveal(); if (id) deps.select(id); }
        return 'tapped';
      }
      // `viewer` names what is on screen ('switcher' = the Ctrl+Tab viewer, 'tabs' = the Tab viewer); only a Ctrl+Tab viewer THIS hold asked for is "up" for it. Without the name `showing` is taken as it always was.
      // this hold's viewer is gone (closed on a release main never heard): the hold is over, this press is a new one (the interface is told, so its own "viewer is up" mark goes too)
      if (held && open && !onScreen && !repeat && !tabDown && t - openedAt > STALE_MS) { reset(); deps.releaseSwitcher(); }
      const showing = onScreen && (viewer !== 'switcher' || open);
      if (!held) { held = true; steps = 0; open = false; listStepped = false; tabDown = false; lastStepAt = -Infinity; sessionMode = mode; sessionShow = show; heldFrom = deps.activeTab ? deps.activeTab() : null; }
      const repeating = repeat || tabDown;
      tabDown = true;
      if (repeating && t - lastStepAt < REPEAT_MS) { dropped++; return 'dropped'; }
      if (sessionMode === 'viewer' && repeating) { dropped++; return 'dropped'; }
      lastStepAt = t; lastDirection = step;
      const draws = sessionShow !== 'nothing';
      if (sessionMode === 'next') {
        // the switch is done now, in this step; the viewer (when it is up, or once Ctrl has stayed down) only follows the current tab
        if (showing) listStepped = true; else deps.reveal();
        const id = deps.nextTab(step, unlisted); if (id) deps.select(id);
        if (!open && !showing && draws && timer === null) askForList();
        return 'next';
      }
      if (showing) { listStepped = true; deps.stepSwitcher(step); return 'stepped'; }
      if (sessionMode === 'viewer') { deps.openViewer(step); return 'viewer'; }
      deps.reveal();
      steps += step;
      if (open) { deps.openSwitcher({ start: steps, direction: step, stamps: newest(), order: deps.orderFor('recent'), mode: 'recent', first: false }); return 'counted'; }
      if (draws && timer === null) askForList();
      return 'counted';
    },
    /** Every key event main hears (before it is looked at as a shortcut): the hold ends on Ctrl/Cmd's release, Tab's own release tells a fresh press from a repeat, and a
     *  key-down with neither Ctrl nor Cmd in it means the release was missed. */
    note(input) {
      if (!input || !input.type) return;
      const modifier = input.key === 'Control' || input.key === 'Meta';
      if (modifier && input.type === 'keyDown') { const gap = now() - modifierAt; modifierAt = now(); if (held && !input.isAutoRepeat && gap >= REPEAT_GAP) release(); return; }
      if (input.type === 'keyUp') { if (modifier) release(); else if (input.key === 'Tab') tabDown = false; return; }
      if (input.type === 'keyDown' && held && !modifier && !input.control && !input.meta) release();
    },
    /** The window lost focus: the key-up goes elsewhere. */
    blur() { release(); },
    /** The interface's choice and what it knows (a request from it): the Ctrl+Tab setting, the tabs that live only in their Favorites tile (the sidebar walks the rest) and, once,
     *  the activation times it has kept (so the order survives a restart). */
    config(next = {}) {
      if (MODES.has(next.mode)) mode = next.mode;
      if (SHOWS.has(next.show)) show = next.show;
      if (Array.isArray(next.unlisted)) unlisted = new Set(next.unlisted.filter(id => typeof id === 'string').slice(0, 400));
      if (next.stamps && typeof next.stamps === 'object') for (const [id, at] of Object.entries(next.stamps)) if (typeof at === 'number' && Number.isFinite(at) && (stamps[id] ?? -1) < at) stamps = stampActivation(stamps, id, at);
    },
    /** A tab became the current one. */
    activated(id) { if (typeof id === 'string' && id) stamps = stampActivation(stamps, id, now()); },
    get mode() { return mode; },
    get show() { return show; },
    get unlisted() { return unlisted; },
    get stamps() { return stamps; },
    get held() { return held; },
    get open() { return open; },
    get steps() { return steps; },
    get dropped() { return dropped; },
  };
}
module.exports = { createTabCycle, REPEAT_MS, HOLD_MS, SHARE, LEAVE_POLL_MS, LEAVE_WAIT_MS, STALE_MS, REPEAT_GAP };
