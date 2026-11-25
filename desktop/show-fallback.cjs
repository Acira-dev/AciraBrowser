'use strict';
// A window that is ready is shown (16 Nov 2026, the laptop: "the installed Beta 14 often starts with its window never shown").
//
// main.cjs maybeShowMain shows the main window only when the interface has loaded AND its first layout is in AND the setup hold is clear. The hold asks the setup service for its status through a queue that
// has no timeout (accounts/setup.cjs `command`: one job at a time, behind whatever came first, on Windows a browser-icon lookup), and the call that decides to show sat at the very end of applyLayoutNow,
// after a dozen helpers whose throw is swallowed as "Ignored stale or invalid layout". Either one left the window `visible=false` for good while the interface ran.
//
// This is the net under both: once a window is ready (maybeShowMain got past its first guard) it is shown at the latest SHOW_FALLBACK_MS later, whatever the hold says, and the reason is logged. A normal
// start shows in well under a second, so the timer is cancelled long before it fires and nothing changes. Pure (timers injected) so every rule has a test (tests/show-fallback.test.cjs).
const SHOW_FALLBACK_MS = 5000;
// The last resort (the laptop, 16 Nov 23:31: on a PC under CPU load the interface page was still loading 45 s after start, `ui-loaded`, the first layout and the show never came, and the splash's own 20 s timer had destroyed
// the only window on screen: "Acira didn't open"). A window that has not been shown LAST_RESORT_MS after it was created, with the app not quitting, is shown as it is: the splash stays up until then (or until the main window
// shows, a quit, or an error), so there is always something on screen. The window's own background (the frame colour or its material) is what shows until the interface paints; the interface view itself is transparent.
// The splash's own backstop is only for a window that never comes at all (it has no taskbar button and cannot be closed by hand).
const LAST_RESORT_MS = 45000, SPLASH_BACKSTOP_MS = 120000;
/** LAST_RESORT_MS, or a test profile's ACIRA_TEST_SHOW_LAST_RESORT_MS (only with ACIRA_BROWSER_TEST_DATA set, so a real person's launch can never shorten it). */
const lastResortMs = (env = process.env) => (env.ACIRA_BROWSER_TEST_DATA && Number(env.ACIRA_TEST_SHOW_LAST_RESORT_MS) >= 1000 ? Math.floor(Number(env.ACIRA_TEST_SHOW_LAST_RESORT_MS)) : LAST_RESORT_MS);

/** `onFire()` runs once, SHOW_FALLBACK_MS after the first `arm()`, unless `cancel()` came first. arm() again does nothing (one timer per window); cancel() is final. */
function createShowFallback({onFire, ms = SHOW_FALLBACK_MS, schedule = setTimeout, cancel = clearTimeout}) {
  let timer = null, state = 'idle';
  return {
    arm() {
      if (state !== 'idle') return;
      state = 'armed';
      timer = schedule(() => { timer = null; if (state !== 'armed') return; state = 'fired'; try { onFire(); } catch (error) { try { console.warn('Showing the window failed:', error && error.message || error); } catch { /* a console that throws */ } } }, ms);
      if (timer && typeof timer.unref === 'function') timer.unref();
    },
    cancel() { if (timer) { cancel(timer); timer = null; } state = state === 'fired' ? 'fired' : 'cancelled'; },
    get state() { return state; },
  };
}

module.exports = {createShowFallback, SHOW_FALLBACK_MS, LAST_RESORT_MS, SPLASH_BACKSTOP_MS, lastResortMs};
