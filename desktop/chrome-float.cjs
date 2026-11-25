'use strict';

// The interface view floated over the page views (R4-24 Seamless peek, Beta 14 Mini sidebar). While it is floated the interface is above every page view and its own page area is a hole, so the sidebar
// draws over a page that never moves; lowered, it is under them again. Mini's dock ("Keep open") and undock switch the layout while the sidebar is floated, and the page glides to its new place: the
// interface is then lowered only on the glide's last frame (`lowerAfterGlide`), so no page view is above the floated sidebar at any moment of the slide, and `chrome-lowered` tells the interface it may
// drop its page cut-out (it keeps it while it is above the page: without it the interface paints an opaque placeholder over the page).
// Pure of Electron: main hands in the window, the interface view, the page views, the glide state and the clock, and a test drives it with fakes (tests/chrome-float.test.cjs).
function createChromeFloat({ window, view, pageViews, release = () => {}, emit = () => {}, gliding = () => false, now = Date.now, every = setInterval, stop = clearInterval }) {
  let floated = false, timer = null;
  const cancel = () => { if (timer) { stop(timer); timer = null; } };
  function set(on) {
    cancel();
    const win = window(), ui = view();
    if (!win || win.isDestroyed() || !ui) return;
    floated = !!on;
    if (!on) release();
    const parent = win.contentView, kids = parent.children, at = kids.indexOf(ui);
    if (at < 0) return;
    if (on) {
      let last = -1;
      for (const page of pageViews()) { const i = kids.indexOf(page); if (i > last) last = i; }
      if (last < 0 || at > last) return;
      parent.addChildView(ui, last);
    } else {
      if (at !== 0) parent.addChildView(ui, 0);
      emit({ type: 'chrome-lowered' });
    }
  }
  /** The interface asked for the float (`edge float:true`): any lowering still waiting on a glide is off. */
  const raise = () => set(true);
  /** Lower at once. */
  const lower = () => set(false);
  /** Lower when no page view is moving any more. The glide may begin a moment after the request, so one not yet seen is waited for (150 ms); a glide that never ends is not waited for beyond 2 s. */
  function lowerAfterGlide() {
    cancel();
    const started = now();
    let seen = false;
    timer = every(() => {
      const moving = gliding();
      if (moving) seen = true;
      const waited = now() - started;
      if (moving && waited < 2000 || !seen && waited < 150) return;
      set(false);
    }, 8);
  }
  return { raise, lower, lowerAfterGlide, cancel, get floated() { return floated; } };
}
module.exports = { createChromeFloat };
