'use strict';
// A toolbar popup follows its page when the page changes size after the popup has opened (13.8, item 9).
//
// What Chromium does (chrome/browser/ui/views/extensions/extension_popup.cc, extension_view_views.cc, ui/views/controls/webview/webview.cc, and in Blink
// third_party/blink/renderer/core/frame/frame_view_auto_size_info.cc + local_frame_view.cc, Chromium 152, the engine of Electron 44):
//  - ExtensionViewViews::Init asks the page's render widget for auto-resize between ExtensionPopup::kMinSize (25 x 25) and kMaxSize (800 x 600);
//  - Blink's FrameViewAutoSizeInfo::AutoSizeIfNeeded runs after EVERY layout of the page: the first time it starts from the minimum size; once the load event has
//    finished, on every later layout (or overflow change) it resets the frame to the minimum width, lays the page out again and reads the document element's
//    ScrollWidth / ScrollHeight, at most 2 passes, bounded by the maximum, never below the minimum. While the page is still loading it only lets the size GROW
//    (so a half-built page does not twitch). Percentage and viewport heights (html { height: 100% }, 100vh) are therefore read against that minimum viewport:
//    they are as tall as the content, never as tall as the window the popup happened to have;
//  - the new size reaches the browser as ResizeDueToAutoResize -> ExtensionPopup::OnExtensionSizeChanged -> SizeToContents: the popup is resized, again and
//    again, to what the page measured. Nothing is shown to the user or to the page's scripts at the intermediate sizes: all of it happens inside one layout.
//
// What Electron 44 gives (checked 12 Nov 2026 in a bare Electron): no way to switch a WebContentsView or BrowserWindow
// page to auto-resize (no webContents.setSize / enableAutoSize; <webview autosize> is dead: the guest stayed 25 x 25 for five pages). What it does give is
// `preferred-size-changed` (enablePreferredSizeMode): Blink's WebViewImpl::UpdatePreferredSize reports (LayoutView::ComputeMinimumWidth, the document
// element's ScrollHeight) after each layout, but only when that pair changes, and measured in the window the page has now. Acira's popup (extension-popup-window.cjs)
// takes every report, which follows growth and any shrink of a page whose height comes from its content (natural pages: Bitwarden, uBlock Origin Lite, Dark Reader).
//
// What is missing is Blink's reset: a page whose root follows the viewport (html, body { height: 100% }, a 100vh app block, min-height: 100vh) reports the window's own height back
// (the document element's ScrollHeight is as tall as the window it was given), so after its content shrinks the report does not change and the window keeps the old size: a
// white band under the new view. In Chromium the reset reads such a height against the 25 px minimum viewport (frame_view_auto_size_info.cc), so the page is as tall as its content.
// A real reset (the window at 25 x 25 for a moment, or a device-emulated 25 px viewport) cannot be done here without the page and the person seeing it: measured in a bare Electron,
// every real viewport change reaches the page as a resize event and a rendered frame (150 of 150 cycles with a CDP metrics override; a native resize likewise; Electron's own
// enableDeviceEmulation pipelined fails to be ordered with the measuring call; freezing the page around the override leaves the override stuck).
// So the reset is replaced by a READ-ONLY estimate of the layout it would give, taken in the page without changing anything (followProbe below): the bottom edge
// of what the page holds, with every height that follows the viewport read as auto (the same rule Blink's reset gives). The popup is brought to that height
// in one step, and the real layout then checks it: the popup's own fit() (extension-popup-window.cjs) grows the window if the page turns out to overflow it,
// exactly as it already does after any size change; an estimate that was too small costs a few pixels of growth, never a cut-off page.
// Only the height is followed: a width that follows the viewport is reported by Blink's min-content width, which already moves both ways.
//
// WHEN the popup follows (13.8, after the first hand test): Chromium resizes inside the page's own layout pass, so nobody sees the old size. A look taken every 250 ms (1 s
// when nothing happens) left a signed-in Proton Pass popup a screen too tall for up to a second after its page changed, because a page whose root follows the window sends no
// size report to wake anything. So the popup is told by the page itself: followWatch (below) is installed once the page has loaded, sits quiet (no timer, no poll) until
// the page changes (a DOM mutation, a box resize, a load, a transition or animation, a click or key), measures on the next animation frame, and answers only when the page
// has become shorter than its window. The answer reaches this process as the result of one long-lived executeJavaScript promise and the window follows in that very turn
// (no timer, no settle wait, no second report). While a short animation runs it measures every other frame, so the window comes down with the page. The old timed look
// stays as a slow safety net for what no event shows (a :hover rule that changes a height, a style sheet changed through the CSSOM).
const {laidOutIn} = require('./extension-popup-fit.cjs');
const {trace} = require('./ext-trace.cjs');

const FOLLOW = Object.freeze({
  POLL_MS: 250,          // the safety net: how often an open popup is looked at while no watch is running and it is being used (a click, a key, a size report within ACTIVE_MS)
  QUIET_POLL_MS: 1000,   // ... and when nothing has happened for a while, or while the watch is running (it sees what events show; this sees the rest)
  ACTIVE_MS: 3000,
  NUDGE_MS: 80,          // after a click or a key: look again this soon (the page needs a moment to change its layout)
  RETRY_MS: 24,          // a look that could not be used (the page had not caught up with its window): look again this soon, about a frame and a half
  SLACK: 3,              // a window less than this many DIPs taller than the page is the page's own size (rounding, a scrollbar's room)
  MAX_PASSES: 2,         // Blink: "do the resizing twice": at most this many follow steps in a row without the page itself changing (a page that answers each step with another)
  REGROW_MS: 1500,       // a window that grows within this long of a follow step: the estimate was short by that much
  REGROW_SLACK: 8,       // ... up to this many DIPs it is learned (bias); more than that the popup holds off following (HOLD_MS, doubling up to HOLD_MAX_MS)
  HOLD_MS: 1000,         // the first hold after a window grew back (doubles with each one): a page that is still moving (an animation) has settled by then
  HOLD_MAX_MS: 30000,    // the hold never gets longer than this, and never becomes "for good": a popup that stopped following left a window taller than its page for the rest of the session
  REGROW_FORGET_MS: 10000, // a follow step that held this long is not counted against the page
  NODES: 3000,           // the probe visits at most this many nodes (extension-action-sizing.cjs bounds its own walk at 2000); more is "not sure"
  RULES_MS: 10000,       // the style rules found by the probe are used this long before the page's sheets are read again
  RETRIES: 8,            // quick second looks after a look that could not be used; and failed starts of the watch before it is given up on
  RESTART_MS: 250,       // a watch that failed to start is started again this soon
  PUMP_GAP_MS: 16,       // a new watch is never started sooner than this after the last one (a page that answers at once is not asked in a loop)
  TIMEOUT_MS: 2000,      // a page that does not answer the probe this fast is left alone
});
// What the in-page watch is told (followWatch). Times in ms of the page's own clock.
const WATCH = Object.freeze({
  minGapMs: 32,          // two measures at least this far apart while things change (every other frame)
  maxGapMs: 400,         // ... and when the page keeps changing without its height changing (a virtual list scrolling): the gap doubles up to this (a real change waits this long at worst)
  fallbackMs: 100,       // a frame that does not come (a window that is not drawing) is replaced by a timer this long
  heartbeatMs: 10000,    // the watch ends itself after this long and a new one is started (a page that was replaced, a lost answer, observers of an old document)
  animMaxMs: 1500,       // a short animation is followed this long at most
  slack: 2,              // the page measures this many CSS px shorter than the window before the watch speaks (the host decides the rest)
});

/**
 * Runs in the popup's page (as text, through executeJavaScript). Read-only: no style, no attribute, no listener, nothing the page can see.
 * Returns {iw, ih, ch, eh, pins, anim, rules}: the viewport (innerWidth, innerHeight), the part scrollbars leave (clientHeight) and the page's height as the minimum-viewport
 * layout would give it (eh, CSS px; null when the page is too big or too odd to be sure), how many boxes had a height that follows the viewport, how many short animations
 * are running, and the style rules that name a viewport height (only when they were not the ones passed in).
 * `NODES` is replaced by the limit when the text is made.
 */
function followProbe(known) {
  const NODES = '__NODES__';
  const root = document.documentElement, body = document.body;
  if (!root || !body) return null;
  const ih = innerHeight, iw = innerWidth;
  let visited = 0, unsure = false, pinned = 0;
  // computedStyleMap keeps a percentage a percentage, but a viewport unit is already pixels in the computed value (100vh reads "574px"): the rules that SAY vh (or dvh, svh,
  // lvh, vmin, vmax) are found in the style sheets once (the caller keeps the answer while the number of sheets and of their rules stays the same, and asks again every few seconds) and the elements they select are looked up here.
  const VIEWPORT = /(?:^|[^\w.-])\d*\.?\d+\s*[dsl]?v(?:h|b|min|max)\b/i;
  function viewportRules() {
    const hs = ['[style*="vh"]', '[style*="vb"]', '[style*="vmin"]', '[style*="vmax"]'], ms = [...hs];
    let budget = 40000;
    const walk = list => {
      for (const rule of list) {
        if (--budget < 0) return;
        if (rule.style && rule.selectorText) {
          const h = rule.style.getPropertyValue('height'), m = rule.style.getPropertyValue('min-height');
          if (h && VIEWPORT.test(h)) hs.push(rule.selectorText);
          if (m && VIEWPORT.test(m)) ms.push(rule.selectorText);
        }
        if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
      }
    };
    for (const sheet of sheetList()) { let list; try { list = sheet.cssRules; } catch { continue; } walk(list); }
    return {key: sheetKey(), hs: hs.slice(0, 300), ms: ms.slice(0, 300)};
  }
  const sheetList = () => [...document.styleSheets, ...(document.adoptedStyleSheets || [])];
  const sheetKey = () => { let rules = 0; const sheets = sheetList(); for (const sheet of sheets) { try { rules += sheet.cssRules.length; } catch { /* a sheet of another origin */ } } return sheets.length + ':' + rules; };
  const rules = known && known.key === sheetKey() ? known : viewportRules();
  const lookup = list => {
    const set = new Set();
    try { for (const el of document.querySelectorAll(list.join(','))) set.add(el); return set; } catch { /* one selector this document cannot use spoils the whole list: one by one then */ }
    for (const selector of list) { try { for (const el of document.querySelectorAll(selector)) set.add(el); } catch { /* skipped */ } }
    return set;
  };
  const heightSet = lookup(rules.hs), minSet = lookup(rules.ms);
  const range = document.createRange();
  const num = value => parseFloat(value) || 0;
  const spec = (el, prop) => { try { return String(el.computedStyleMap().get(prop)); } catch { return ''; } };   // the computed VALUE ("100%", "430px"), not the used pixels
  const follows = value => /%|(?<=\d)[dsl]?v(?:h|w|i|b|min|max)(?![a-z])/i.test(value);     // a length that follows the viewport or the box around it
  const explicit = value => value !== '' && value !== 'auto' && !follows(value) && !/content|fill|stretch|anchor/i.test(value);
  function contentBottom(el) {
    let bottom = -Infinity;
    const nodes = el.shadowRoot ? [...el.childNodes, ...el.shadowRoot.childNodes] : el.childNodes;
    for (const node of nodes) {
      if (++visited > NODES) { unsure = true; return bottom; }
      if (node.nodeType === 3) {
        if (!/\S/.test(node.nodeValue)) continue;
        range.selectNodeContents(node);
        const r = range.getBoundingClientRect();
        if (r.height > 0 && r.bottom > bottom) bottom = r.bottom;
      } else if (node.nodeType === 1) {
        let b = extent(node);
        if (b === -Infinity) continue;
        b += num(getComputedStyle(node).marginBottom);                                      // an automatic height holds its last child's margin too
        if (b > bottom) bottom = b;
      }
    }
    return bottom;
  }
  function extent(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none') return -Infinity;
    const rect = el.getBoundingClientRect();
    // A fixed box does not make the page taller in Chromium, but a bar fixed to the bottom of the window (a tab bar) is part of what the person sees: it is counted by its
    // box, so a popup is never brought down over it.
    if (style.position === 'fixed') return rect.height > 0 ? rect.bottom : -Infinity;
    if (style.display === 'contents') return contentBottom(el);
    const isRoot = el === root || el === body;                                                  // their overflow belongs to the viewport, not to them
    const clips = !isRoot && style.overflowY !== 'visible';
    const h = spec(el, 'height'), minH = spec(el, 'min-height');
    const tall = heightSet.has(el) && Math.abs(num(style.height) - ih) <= 1, floor = minSet.has(el) && Math.abs(num(style.minHeight) - ih) <= 1;   // 100vh as it came out in pixels
    let follow = tall || floor || (!explicit(h) && (follows(h) || follows(minH)));
    if (!follow && h === 'auto' && rect.height > 0 && rect.bottom >= ih - 1) {                  // a flex or grid item that fills the window
      const parent = el.parentElement;
      if (parent && /flex|grid/.test(getComputedStyle(parent).display)) follow = true;
    }
    const mark = pinned;
    if (follow) pinned++;
    if (!follow && clips) return rect.bottom;
    const inner = contentBottom(el);
    if (follow) return inner === -Infinity ? rect.bottom : inner + num(style.paddingBottom) + num(style.borderBottomWidth);
    // a box with an automatic height that holds one that follows the viewport is as tall as that one's content, not as tall as the window it was given
    if (pinned > mark && !explicit(h) && inner !== -Infinity) return inner + num(style.paddingBottom) + num(style.borderBottomWidth);
    return Math.max(rect.bottom, inner);
  }
  let eh = extent(root);
  if (root.scrollHeight > ih) eh = Math.max(eh, root.scrollHeight);                              // overflow past the window is the page's size whatever follows what
  // Short animations that are running (a panel sliding in, a section folding up): the geometry read above is of this moment of them. (An endless one, a spinner, never ends and is not counted.)
  let anim = 0;
  try {
    for (const a of document.getAnimations()) {
      const timing = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      if (!timing || a.playState !== 'running') continue;
      const left = timing.endTime - (typeof a.currentTime === 'number' ? a.currentTime : 0);
      if (Number.isFinite(left) && left > 0 && left <= 1000) anim++;
    }
  } catch { /* a page without the animations API */ }
  // (the rules are sent back only when they are new: a watch answers often)
  return {iw, ih, ch: root.clientHeight, eh: unsure || !Number.isFinite(eh) ? null : Math.max(0, eh), pins: pinned, anim, rules: rules === known ? undefined : rules};
}
/**
 * Runs in the popup's page (as text, with the probe passed in): the page's own eyes on its layout. Returns a promise that settles ONCE:
 *  - at once with a first reading, when `since` is null (the host has no earlier one);
 *  - otherwise when, after a change of the page (a DOM mutation, a resize of the document's boxes, a load or error of an image or frame, a font, a transition or animation
 *    end, a click, a key, an input, the window's own resize), the next animation frame's layout measures a page SHORTER than its window (by more than opts.slack) in a
 *    way that differs from the last reading (`since`, then each reading of this watch);
 *  - or after opts.heartbeatMs, with {heartbeat: true}, so a lost answer or an old document does not leave the host waiting for ever.
 * While short animations run it measures every opts.minGapMs, so the host can bring the window down with the page; while the page changes and its height does not (a virtual
 * list that scrolls) the gap between two measures doubles up to opts.maxGapMs. Nothing is written to the page: observers and capture-phase listeners that stop nothing are
 * all it adds, and all are removed when it settles. Not a module: only globals and its arguments, so it can be sent as text.
 */
async function followWatch(probe, known, since, opts) {
  // (An async function, so the promise the host gets is the engine's own even when the page has replaced `Promise` with a polyfill of its own (zone.js does): the host only waits
  // for a promise it recognises, and takes anything else for the answer itself.)
  return await new Promise(resolve => {
    const root = document.documentElement;
    if (!root) { resolve(null); return; }
    const now = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());
    const differs = (a, b) => {
      if (!b) return true;
      const fa = Number.isFinite(a.eh), fb = Number.isFinite(b.eh);
      if (fa !== fb) return true;
      return (fa && Math.abs(a.eh - b.eh) > 0.5) || Math.abs(a.ch - b.ch) > 0.5 || Math.abs(a.ih - b.ih) > 0.5;
    };
    const shorter = m => Number.isFinite(m.eh) && Number.isFinite(m.ch) && m.ch - m.eh > opts.slack;
    if (!since) {     // the first reading: at once
      let m = null; try { m = probe(known); } catch { m = null; }
      resolve(m ? {...m, why: ['start']} : null);
      return;
    }
    const why = new Set(), listeners = [];
    let finished = false, queued = false, waitTimer = 0, fallbackTimer = 0, heartbeat = 0, frame = 0, mutations = null, boxes = null;
    let ref = since, previous = null, gap = opts.minGapMs, last = -Infinity, animFrom = 0;
    const finish = value => {
      if (finished) return;
      finished = true;
      clearTimeout(waitTimer); clearTimeout(fallbackTimer); clearTimeout(heartbeat);
      if (frame) { try { cancelAnimationFrame(frame); } catch { /* gone */ } }
      try { if (mutations) mutations.disconnect(); } catch { /* gone */ }
      try { if (boxes) boxes.disconnect(); } catch { /* gone */ }
      for (const [target, type, handler] of listeners) { try { target.removeEventListener(type, handler, true); } catch { /* gone */ } }
      resolve(value);
    };
    const arm = () => {
      waitTimer = 0;
      if (finished) return;
      frame = requestAnimationFrame(run);                  // after the page's own changes of this frame, the layout that is about to be drawn
      fallbackTimer = setTimeout(run, opts.fallbackMs);    // a window that draws no frames
    };
    const queue = () => {
      if (finished || queued) return;
      queued = true;
      const wait = Math.max(0, last + gap - now());
      if (wait > 0) waitTimer = setTimeout(arm, wait); else arm();
    };
    function run() {
      if (finished || !queued) return;
      queued = false;
      if (frame) { try { cancelAnimationFrame(frame); } catch { /* gone */ } frame = 0; }
      clearTimeout(fallbackTimer); fallbackTimer = 0;
      last = now();
      let m = null; try { m = probe(known); } catch { m = null; }
      if (!m) { finish(null); return; }
      if (m.rules) known = m.rules;
      const tags = [...why]; why.clear();
      const unchanged = previous !== null && !differs(m, previous);
      previous = m;
      if (m.anim > 0) { if (!animFrom) animFrom = last; } else animFrom = 0;
      const following = m.anim > 0 && last - animFrom < opts.animMaxMs;
      gap = following ? opts.minGapMs : unchanged ? Math.min(gap * 2, opts.maxGapMs) : opts.minGapMs;
      const speak = shorter(m) && differs(m, ref);
      ref = m;
      if (speak) { finish({...m, why: following ? tags.concat('anim') : tags}); return; }
      if (following) { why.add('anim'); queue(); }         // an animation goes on: look again in a frame or two
    }
    const onEvent = event => { why.add(event && event.type === 'resize' ? 'resize' : 'event'); queue(); };
    const on = (target, type) => { try { target.addEventListener(type, onEvent, {capture: true, passive: true}); listeners.push([target, type, onEvent]); } catch { /* a target without events */ } };
    for (const type of ['resize', 'load', 'error', 'transitionend', 'transitioncancel', 'animationend', 'animationcancel', 'toggle', 'click', 'input', 'change', 'keyup']) on(window, type);
    try { if (document.fonts) on(document.fonts, 'loadingdone'); } catch { /* no font events */ }
    try { mutations = new MutationObserver(() => { why.add('mutation'); queue(); }); mutations.observe(root, {subtree: true, childList: true, attributes: true, characterData: true}); } catch { mutations = null; }
    try { boxes = new ResizeObserver(() => { why.add('box'); queue(); }); boxes.observe(root); if (document.body) boxes.observe(document.body); } catch { boxes = null; }
    heartbeat = setTimeout(() => finish({heartbeat: true, rules: known}), opts.heartbeatMs);
    why.add('start'); queue();     // one look at once: what changed between two watches is not lost
  });
}

// The text sent to the page. The marker lets anything that fakes or counts a page's scripts tell these (isFollowScript, isWatchScript).
const FOLLOW_MARK = '/*acira:popup-follow*/';
const followSource = followProbe.toString().replace("'__NODES__'", String(FOLLOW.NODES));
const followScript = known => `${FOLLOW_MARK}(${followSource})(${known ? JSON.stringify(known) : 'null'})`;
const FOLLOW_SCRIPT = followScript(null);
const isFollowScript = text => typeof text === 'string' && text.startsWith(FOLLOW_MARK);
const followWatchSource = followWatch.toString();
const watchScript = (known, since) => `${FOLLOW_MARK}(${followWatchSource})(${followSource}, ${known ? JSON.stringify(known) : 'null'}, ${since ? JSON.stringify(since) : 'null'}, ${JSON.stringify(WATCH)})`;
const isWatchScript = text => isFollowScript(text) && text.startsWith(FOLLOW_MARK + '(async function followWatch(');

/**
 * Blink's AutoSizeIfNeeded, reduced to the height the host can still act on: how tall should the window be, given what the probe read? Returns {height} (DIPs, the
 * window's own size: scrollbar room included) or null when the window is as tall as the page (within SLACK), or already shorter.
 * metrics: followProbe's answer; size: the window {width, height} the probe was taken in; zoom: the page's zoom factor; limits: {minHeight, maxHeight}; bias: DIPs the
 * estimate has been seen to fall short by on this page (learned from the window growing back after a step).
 */
function followStep(metrics, size, zoom = 1, limits = {minHeight: 25, maxHeight: 600}, bias = 0) {
  const m = metrics || {};
  if (!size || !Number.isFinite(m.eh) || !Number.isFinite(m.ch) || !Number.isFinite(m.ih)) return null;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const slack = (m.ch - m.eh) * z - bias;                                   // how much taller than its page the window is (the scrollbar's room is not the page's)
  if (!(slack > FOLLOW.SLACK)) return null;
  const bar = Math.max(0, m.ih - m.ch) * z;                                 // a horizontal scrollbar that shows keeps its room
  // Blink: ensure at least the minimum size, then bound by the maximum
  const height = Math.min(limits.maxHeight, Math.max(limits.minHeight, Math.ceil(m.eh * z + bias + bar)));
  return height < size.height - 1 ? {height} : null;
}

/**
 * Keeps an open popup's window as tall as its page. The page tells it (a long-lived watch, followWatch) the moment its layout has become shorter than the window, and the
 * window follows in that same turn; a slow timed look at the page is the net under it, and what a size report or an input leaves to be looked at is looked at at once.
 */
class PopupFollower {
  constructor(popup) {
    this.popup = popup;
    this.pollMs = FOLLOW.POLL_MS; this.quietPollMs = FOLLOW.QUIET_POLL_MS; this.nudgeMs = FOLLOW.NUDGE_MS; this.retryMs = FOLLOW.RETRY_MS;   // a test's own
    this.holdMs = FOLLOW.HOLD_MS; this.restartMs = FOLLOW.RESTART_MS; this.pumpGapMs = FOLLOW.PUMP_GAP_MS;
    this.timer = undefined; this.running = false; this.checking = false; this.disabled = false;
    this.activityAt = 0; this.passes = 0; this.bias = 0; this.followed = undefined;
    this.steps = 0;   // follow steps taken in this popup's life (diagnostics and tests)
    this.rules = null; // the style rules with viewport-unit heights, as the page's first answer found them (followProbe)
    this.rulesAt = 0;
    this.watching = false; this.gen = 0; this.since = null; this.failures = 0; this.watchFailed = false; this.watchOk = false; this.pumpedAt = 0;
    this.regrows = 0; this.regrowAt = 0; this.holdUntil = 0;
  }

  /** The popup is on screen: look after it. */
  start() {
    if (this.running || this.disabled) return;
    this.running = true; this.activityAt = Date.now();
    this.arm(this.nudgeMs);
    this.pump();
  }

  stop() {
    this.running = false; this.gen++; this.watching = false;
    for (const name of ['timer', 'holdTimer', 'retryTimer', 'guardTimer', 'pumpTimer']) { clearTimeout(this[name]); this[name] = undefined; }
  }

  disable(why) { this.disabled = true; this.stop(); this.reason = why; try { trace('toolbar popup stops following its page', this.popup.extensionId, {why}); } catch { /* a log that cannot be written */ } }

  arm(delay) {
    if (!this.running) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.tick(); }, delay);
    this.timer.unref?.();
  }

  /** The page has finished loading (the popup may be on screen already): start watching it. */
  loaded() { if (this.running) { this.since = null; this.pump(); } }

  /** The page loaded again inside the popup (a reload): the old document's watch and numbers are gone. */
  reload() { if (!this.running) return; this.gen++; this.watching = false; this.since = null; this.rules = null; this.rulesAt = 0; clearTimeout(this.guardTimer); this.pump(); }

  /** The person did something in the popup: it will probably change its layout in a moment (the watch usually knows already; this is the net). */
  nudge() {
    this.activityAt = Date.now(); this.passes = 0;
    if (this.running) this.arm(this.nudgeMs);
  }

  /**
   * A size the page itself reported (preferred-size-changed): its layout changed. (The report that echoes the follower's own step must not make the follower forget that step: a window
   * that something else grows back a moment later is what holdOff is for. Growth that a report itself makes is told apart in observeResize, reportBegin / reportEnd.)
   */
  observeReport() { this.passes = 0; this.activityAt = Date.now(); }
  reportBegin() { this.reporting = (this.reporting || 0) + 1; }
  reportEnd() { this.reporting = Math.max(0, (this.reporting || 0) - 1); }

  /** Look now, without waiting for a tick (a report was taken, a held report was released: the page may be shorter than the window it has). */
  look() {
    if (!this.running || this.disabled) return;
    clearTimeout(this.timer);
    void this.tick();
  }

  /** The window changed size: one that grows right after a follow step says how far short the estimate fell (learned), or that it cannot be trusted for this page. */
  observeResize(size) {
    const f = this.followed;
    if (!f || !size) return;
    // A window the page asked for (a report) is the page's size, not the estimate's shortfall: it ends the follow step's account.
    if (this.reporting) { if (size.height > f.to) this.followed = undefined; return; }
    if (Date.now() - f.at > FOLLOW.REGROW_MS) return;
    const grown = size.height - f.to;
    if (grown <= 0) return;
    if (grown > FOLLOW.REGROW_SLACK) { this.backOff('the window grew back by ' + grown); return; }
    this.bias = Math.max(this.bias, grown);
  }

  /**
   * The window grew back after a follow step by more than the estimate can be out by: the page was still moving (an animation had not ended: Proton Pass reads 439, then 430,
   * then needs 545 again), or something else made the window taller than the page. The follower holds off for HOLD_MS (twice as long each time, at most HOLD_MAX_MS), then looks
   * again. It is never switched off for good: that left a blank band under the page for the rest of the session once whatever grew the window had done it three times, and
   * what grows a window back can stop (the page settles, an older sizing measure is gone). A count that has not grown for REGROW_FORGET_MS starts again.
   */
  backOff(why) {
    this.regrows++; this.regrowAt = Date.now(); this.followed = undefined;
    const ms = Math.min(FOLLOW.HOLD_MAX_MS, this.holdMs * 2 ** (this.regrows - 1));
    this.holdUntil = Date.now() + ms;
    try { trace('toolbar popup holds off following its page', this.popup.extensionId, {why, ms}); } catch { /* a log that cannot be written */ }
    clearTimeout(this.holdTimer);
    this.holdTimer = setTimeout(() => { this.holdTimer = undefined; this.since = null; this.look(); }, ms + 5);
    this.holdTimer.unref?.();
  }

  isBusy() {
    const popup = this.popup;
    // (A fit() measure that is on its way is not waited for: what the page was measured in is checked against the window it still has afterwards, and the numbers of a
    // window that has changed meanwhile are dropped, as fit() itself does.)
    let loading = false; try { loading = Boolean(popup.webContents && popup.webContents.isLoading && popup.webContents.isLoading()); } catch { /* gone */ }   // a page that loads again (a reload inside the popup)
    return popup.destroyed || popup.hidden || !popup.size || !popup.window || !popup.loadedAt || loading   // Blink: while the page is loading the size may only grow
      || Boolean(popup.echoPending);
  }

  /**
   * Does the page need more than the window it has? Asked when a report wants the window taller again right after it came down (the page echoing the old window): the answer is
   * the page's own, read now. A page that cannot be read (not loaded, too big, no answer in time) is taken at its report's word.
   */
  async confirmGrowth() {
    const popup = this.popup, contents = popup.webContents;
    if (!contents || contents.isDestroyed() || typeof contents.executeJavaScript !== 'function' || !popup.loadedAt || !popup.size) return true;
    let metrics = null, timer;
    try { metrics = await Promise.race([contents.executeJavaScript(followScript(this.rules)), new Promise(resolve => { timer = setTimeout(() => resolve(null), FOLLOW.TIMEOUT_MS / 4); timer.unref?.(); })]); } catch { return true; } finally { clearTimeout(timer); }
    this.learnRules(metrics);
    if (!metrics || !Number.isFinite(metrics.eh)) return true;
    let zoom = 1; try { zoom = contents.getZoomFactor?.() || 1; } catch { /* gone */ }
    return metrics.eh * zoom > popup.size.height + FOLLOW.SLACK;
  }

  // ---- the watch: the page tells the popup when it has become shorter -------------------------------------------------------------------------------------------------

  /** Starts the page's watch if none is running (one at a time). Its answer is a promise that settles when the page has something to say. */
  pump() {
    const popup = this.popup, contents = popup.webContents;
    if (!this.running || this.disabled || this.watching || this.watchFailed || popup.destroyed || !popup.loadedAt) return;
    if (!contents || contents.isDestroyed() || typeof contents.executeJavaScript !== 'function') return;
    const wait = this.pumpedAt + this.pumpGapMs - Date.now();
    if (wait > 0) {   // a page (or a stand-in) that answers at once is not asked again in a loop
      if (!this.pumpTimer) { this.pumpTimer = setTimeout(() => { this.pumpTimer = undefined; this.pump(); }, wait); this.pumpTimer.unref?.(); }
      return;
    }
    this.pumpedAt = Date.now();
    const gen = ++this.gen;
    this.watching = true;
    clearTimeout(this.guardTimer);
    this.guardTimer = setTimeout(() => this.answered(gen, null), WATCH.heartbeatMs + FOLLOW.TIMEOUT_MS);   // an answer that never came
    this.guardTimer.unref?.();
    let pending;
    try { pending = Promise.resolve(contents.executeJavaScript(watchScript(this.rules, this.since))); } catch (error) { pending = Promise.reject(error); }
    pending.then(answer => this.answered(gen, answer), () => this.answered(gen, null));
  }

  answered(gen, answer) {
    if (gen !== this.gen || !this.watching) return;      // the answer of a watch that was replaced, or of a popup that is gone
    this.watching = false; clearTimeout(this.guardTimer); this.guardTimer = undefined;
    if (!this.running) return;
    if (!answer || typeof answer !== 'object') { this.failedWatch(); return; }
    this.failures = 0; this.watchOk = true;
    this.learnRules(answer);
    if (!answer.heartbeat) this.onAnswer(answer);
    this.pump();
  }

  failedWatch() {
    this.watchOk = false;
    if (++this.failures > FOLLOW.RETRIES) { this.watchFailed = true; return; }   // the timed look is still there
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; this.pump(); }, this.restartMs);
    this.retryTimer.unref?.();
  }

  learnRules(metrics) {
    if (metrics && metrics.rules) { this.rules = metrics.rules; this.rulesAt = this.rulesAt || Date.now(); }
    if (this.rulesAt && Date.now() - this.rulesAt > FOLLOW.RULES_MS) { this.rules = null; this.rulesAt = 0; }   // style rules can change under the same count: look again now and then
  }

  /** The page said it is shorter than its window: the window follows in this turn. */
  onAnswer(answer) {
    const popup = this.popup;
    if (this.disabled) return;
    if (this.isBusy()) { this.since = {eh: answer.eh, ch: answer.ch, ih: answer.ih}; return; }   // a hold, a load or a hidden window: look() takes the page up again when the popup is fit to follow (and the watch is not asked for the same reading in a loop)
    if (Array.isArray(answer.why) && answer.why.some(reason => reason !== 'resize')) this.passes = 0;   // the page changed by itself, it is not answering a step of ours
    const again = this.decide(answer, popup.size, 'watch');
    if (again && (this.stale = (this.stale || 0) + 1) <= FOLLOW.RETRIES) { this.retrySoon(); return; }   // (the old reading stays: the next watch speaks again if the page is still shorter)
    this.stale = 0;
    this.since = {eh: answer.eh, ch: answer.ch, ih: answer.ih};
  }

  /** A look that could not be used (the page had not caught up with its window): once more in about a frame and a half. */
  retrySoon() {
    this.retries = (this.retries || 0) + 1;
    if (this.retries > FOLLOW.RETRIES) { this.retries = 0; return; }
    this.arm(this.retryMs);
  }

  // ---- the timed look: the net under the watch ----------------------------------------------------------------------------------------------------------------------

  async tick() {
    if (!this.running) return;
    let again = false;
    try { again = await this.check(); } catch { /* a page that went away while it was looked at */ }
    // A look that could not be used because the window changed size meanwhile, or the page had not caught up with it, is made again soon, not at the next tick; a handful of times.
    this.retries = again ? (this.retries || 0) + 1 : 0;
    const poll = this.watchOk ? this.quietPollMs : Date.now() - this.activityAt < FOLLOW.ACTIVE_MS ? this.pollMs : this.quietPollMs;
    this.arm(again && this.retries <= FOLLOW.RETRIES ? this.retryMs : poll);
  }

  /** One look. Returns true when it could not be used and should be repeated soon (the window moved or the page lagged), false otherwise. */
  async check() {
    const popup = this.popup, contents = popup.webContents;
    if (this.checking || this.disabled || this.isBusy() || !contents || contents.isDestroyed() || typeof contents.executeJavaScript !== 'function') return false;
    this.checking = true;
    try {
      const measured = popup.size;
      let metrics;
      try {
        let timer;
        metrics = await Promise.race([contents.executeJavaScript(followScript(this.rules)), new Promise(resolve => { timer = setTimeout(() => resolve(null), FOLLOW.TIMEOUT_MS); timer.unref?.(); })]);
        clearTimeout(timer);
      } catch { return false; }
      this.learnRules(metrics);
      if (!metrics) return false;
      if (popup.destroyed || !popup.window) return false;
      return this.decide(metrics, measured, 'poll');
    } finally { this.checking = false; }
  }

  /**
   * What the page read (from a watch or a timed look) says about the window it was read in. Returns true when it could not be used and should be asked again soon.
   * measured: the window {width, height} as it was when the page was read (the popup's current size, for a watch: the page checks its own viewport against it).
   */
  decide(metrics, measured, via) {
    const popup = this.popup, contents = popup.webContents;
    if (!metrics || popup.destroyed || !popup.window) return false;
    if (popup.size !== measured) return true;                // the window changed size while the page was looked at: those numbers are of a window that is gone
    let zoom = 1; try { zoom = contents.getZoomFactor?.() || 1; } catch { /* gone */ }
    if (!laidOutIn(metrics, measured, zoom)) return true;    // the page has not caught up with its window yet
    const step = followStep(metrics, measured, zoom, popup.limits ? {minHeight: 25, maxHeight: popup.limits().maxHeight} : undefined, this.bias);
    if (!step) { this.passes = 0; return false; }
    if (this.passes >= FOLLOW.MAX_PASSES || Date.now() < this.holdUntil) return false;
    // The page read as that short in the moments after the load, when it has asked for a real size, is the layout it had in the load's own minimum window (Proton Pass: its script copied
    // that window's size into its root, and the root read 26 px tall in the window it was given back): not followed (the popup's refusesMinimum; the look after the first second takes it up).
    if (typeof popup.refusesMinimum === 'function') {
      const target = {width: popup.size.width, height: step.height};
      if (popup.refusesMinimum(target)) { if (typeof popup.noteRefused === 'function') popup.noteRefused(target, 'follow'); return false; }
    }
    if (this.regrows && Date.now() - this.regrowAt > FOLLOW.REGROW_FORGET_MS) this.regrows = 0;
    this.passes++; this.steps++;
    this.followed = {from: measured.height, to: step.height, at: Date.now()};
    try { trace('toolbar popup follows its page down', popup.extensionId, {from: measured.height, to: step.height, page: Math.round(metrics.eh * 10) / 10, window: Math.round(metrics.ih), via}); } catch { /* a log that cannot be written */ }
    popup.followTo(step);
    return false;
  }
}

module.exports = {PopupFollower, followStep, followProbe, followWatch, followScript, watchScript, isFollowScript, isWatchScript, FOLLOW_SCRIPT, FOLLOW, WATCH};
