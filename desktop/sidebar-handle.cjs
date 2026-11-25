'use strict';
/**
 * The hidden sidebar's handle (Beta 14). With Settings > Sidebar > "Show the hidden sidebar when the mouse touches" on "A handle only", a short faint line stands on the edge the sidebar comes from;
 * only its hit area reveals the sidebar (the controller, desktop/edge-reveal.cjs, decides that from the pointer; this file draws the line and lets it be dragged).
 *
 * The page is a native view above the interface and covers the edge, so the line is a native view of its own, above every page and below everything that opens over them (popups, menus, the aura):
 * the page cannot see it, style it or block it. It is exactly the hit area's size (16 x 72 DIPs at 100 %, the line 3 x 48 inside it): the rest of the edge is the page's, untouched. It exists only
 * while the setting is on the handle and the sidebar can hide (a renderer process is not free: it is made on first use and let go 30 s after the last time it was wanted).
 *
 * What it does:
 *  - draws a Divider-fade line (strongest in the middle, fading to nothing at both ends), faint at rest, brighter as the pointer comes within 40 DIPs, brightest on the hit area, all eased by the page's own
 *    CSS transition, one duration and one curve both ways, so what leaves is the exact reverse of what came; no state is ever cut;
 *  - fades away while the sidebar is out and back when it is hidden again; is not drawn at all (hidden, no hit area) in fullscreen video and while the window is not showing the sidebar's edge;
 *  - is dragged up or down along the edge to be placed: the position is a fraction of the window's height (so it stays sensible when the window is resized or maximised), kept clear of the window's top
 *    (traffic lights, the Windows caption buttons) and bottom (the resize grip), and on the right of the page's scrollbar column (edge-reveal.cjs handleGeometry). The place is remembered when the button is let go.
 * No page script runs in it (it has no preload and no Node); its state is a handful of data attributes the main process sets.
 */
const { handleGeometry, handleFraction, HANDLE } = require('./edge-reveal.cjs');

const HELD_MS = 15000;                // a carried handle that has heard nothing for this long was let go out of sight (a window that lost the pointer mid-drag): it is put down where it is (the same bound pointerHeld uses)
const FADE_MS = 240;                 // one duration, both ways: a brighter line goes back the same way it came
const RELEASE_MS = 30000;            // the view (a whole renderer process) is let go this long after the handle was last wanted
const EASE = 'cubic-bezier(.23,1,.32,1)';

/** The handle's own page: a transparent box the size of the hit area with the line in it, the line near the sidebar's side of the box. State is `data-*` on <html>. */
function pageHtml() {
  const fade = 'linear-gradient(to bottom,transparent,rgb(0 0 0/.5) 24%,#000 50%,rgb(0 0 0/.5) 76%,transparent)';
  return `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:transparent;user-select:none;-webkit-user-select:none;cursor:grab}
html[data-drag="1"],html[data-drag="1"] *{cursor:grabbing}
:root{--k:178 182 194;--h:0 0 0;--o:.45}
html[data-theme="light"]{--k:96 100 114;--h:255 255 255;--o:.55}
.l{position:absolute;top:50%;left:3px;width:3px;height:${HANDLE.lineH}px;margin-top:-${HANDLE.lineH / 2}px;border-radius:2px;background:rgb(var(--k));box-shadow:0 0 0 .75px rgb(var(--h)/var(--o));-webkit-mask-image:${fade};mask-image:${fade};-webkit-mask-clip:no-clip;mask-clip:no-clip;opacity:0;transition:opacity ${FADE_MS}ms ${EASE}}
html[data-side="right"] .l{left:auto;right:3px}
html[data-s="rest"] .l{opacity:.62}
html[data-s="near"] .l{opacity:.85}
html[data-s="over"] .l{opacity:1}
html[data-motion="off"] .l{transition:none}
</style><div class="l"></div>`;
}

function createSidebarHandle({
  WebContentsView, getWindow, pageViews = () => [], side = () => 'left', fraction = () => 0.5, scale = () => 1, appearance = () => 'dark',
  reducedMotion = () => false, noteMouse = () => {}, cursorY = () => null, onPlaced = () => {}, keepFocus = () => null, onWheel = () => {}, now = Date.now, schedule = setTimeout, cancel = clearTimeout,
} = {}) {
  let view = null, ready = null, drawn = null, shownAt = 0, hideTimer = null, releaseTimer = null, wanted = false, last = { on: false, near: false, over: false, sideShown: false };
  let drag = null;            // { startY, startCenter, fraction, restore }: the handle being carried (restore gives the keyboard back to where it was)
  let pushed = {};            // what the page was last told, so a look that changes nothing sends nothing
  const live = () => !!view && !view.webContents.isDestroyed();
  const content = () => { const win = getWindow(); if (!win || win.isDestroyed()) return null; const [width, height] = win.getContentSize(); return { width, height }; };
  const sc = () => { const v = Number(scale()); return Number.isFinite(v) && v > 0 ? v : 1; };
  // The place just let go of, until the setting says the same (the write may land a moment later): the line never jumps back between the release and the write.
  let settled = null;
  const placeFraction = () => {
    if (drag) return drag.fraction;
    const saved = Number(fraction());
    if (settled && (Math.abs(saved - settled.value) <= 0.0005 || now() > settled.until)) settled = null;
    return settled ? settled.value : saved;
  };

  /** The hit area's centre and inset for the window as it is now (the controller reads this every look). */
  function geometry() {
    const box = content(); if (!box) return null;
    return handleGeometry({ height: box.height, fraction: placeFraction(), side: side() === 'right' ? 'right' : 'left', scale: sc() });
  }
  /** The view's rectangle in the window's content: the hit area. On the right it is the left one in a mirror, `inset` in from the window's edge. */
  function bounds() {
    const box = content(), g = geometry(); if (!box || !g) return null;
    const w = Math.round(HANDLE.hitW * g.scale), h = Math.round(HANDLE.hitH * g.scale), y = Math.round(g.y - h / 2);
    return { x: side() === 'right' ? box.width - g.inset - w : g.inset, y, width: w, height: h };
  }

  function ensure() {
    const win = getWindow();
    if (!win || win.isDestroyed()) return null;
    if (!live()) {
      pushed = {}; drawn = null;
      view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'acira-sidebar-handle', spellcheck: false } });
      view.setBackgroundColor('#00000000'); view.setVisible(false);
      const contents = view.webContents;
      ready = new Promise(resolve => contents.once('did-finish-load', resolve));
      contents.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(pageHtml())).catch(() => {});
      contents.on('before-mouse-event', (_event, mouse) => { try { noteMouse(view, mouse); } catch {} mouseEvent(mouse); });
      // The wheel over the hit area belongs to the page underneath (the handle is not a scroller): it is handed on, in the handle's own place, so scrolling never stops for 16 x 72 DIPs of the edge.
      contents.on('input-event', (_event, input) => { if (input && input.type === 'mouseWheel') { try { onWheel(input, bounds()); } catch {} } });
      // A page that navigates, opens a window or takes the keyboard is not part of this: it is a line.
      contents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    }
    return view;
  }

  /** One short script, only when something it sets changed. */
  async function push(values) {
    if (!live()) return;
    const changed = Object.entries(values).filter(([key, value]) => pushed[key] !== value);
    if (!changed.length) return;
    for (const [key, value] of changed) pushed[key] = value;
    const contents = view.webContents; await ready;
    if (contents.isDestroyed()) return;
    const code = changed.map(([key, value]) => (key === 'zoom' ? `document.documentElement.style.zoom=${JSON.stringify(String(value))}` : `document.documentElement.dataset[${JSON.stringify(key)}]=${JSON.stringify(String(value))}`)).join(';');
    contents.executeJavaScript(code, false).catch(() => {});
  }

  /** The view above every page (and below what opens over them), at the hit area's rectangle. Cheap when nothing moved. */
  function place(reorder = true) {
    if (!live()) return;
    const win = getWindow(), rect = bounds(); if (!win || win.isDestroyed() || !rect) return;
    const current = view.getBounds?.();
    if (!current || current.x !== rect.x || current.y !== rect.y || current.width !== rect.width || current.height !== rect.height) view.setBounds(rect);
    if (!reorder) return;
    const children = win.contentView.children;
    let top = -1; for (const page of pageViews()) { const at = children.indexOf(page); if (at > top) top = at; }
    const at = children.indexOf(view), want = top + 1;
    // Already straight above the pages (or above something that opened over them: leave that to its owner): nothing to do.
    if (at < 0 || at <= top) win.contentView.addChildView(view, Math.min(want, children.length));
  }

  function look(state) {
    const { on, near, over, sideShown } = state;
    const base = drag ? 'over' : over ? 'over' : near ? 'near' : 'rest';
    push({ theme: appearance() === 'light' ? 'light' : 'dark', side: side() === 'right' ? 'right' : 'left', motion: reducedMotion() ? 'off' : 'on', zoom: sc(), drag: drag ? 1 : 0, s: !on || sideShown ? 'gone' : base });
  }

  /** The controller's word, every look of the poller: { on: a handle is wanted, near: the pointer is within reach of it, over: it is on it, sideShown: the sidebar is out }. */
  function update(state) {
    const next = { on: !!state?.on, near: !!state?.near, over: !!state?.over, sideShown: !!state?.sideShown };
    const same = next.on === last.on && next.near === last.near && next.over === last.over && next.sideShown === last.sideShown;
    last = next;
    if (drag && now() - drag.at > HELD_MS) finish();
    if (!next.on && !drag) {
      if (wanted) { wanted = false; look(next); clearTimeout(hideTimer); hideTimer = schedule(() => { hideTimer = null; if (!wanted && live()) view.setVisible(false); }, reducedMotion() ? 0 : FADE_MS + 40); hideTimer?.unref?.(); armRelease(); }
      return;
    }
    if (!wanted) { wanted = true; cancelRelease(); }
    const layer = ensure(); if (!layer) return;
    if (!same || !drawn) {
      cancel(hideTimer); hideTimer = null;
      if (next.sideShown && !drag) {
        // the sidebar is out: the handle fades away, then its hit area goes (the sidebar's own rows are there now)
        look(next); hideTimer = schedule(() => { hideTimer = null; if (live() && last.sideShown && !drag) view.setVisible(false); }, reducedMotion() ? 0 : FADE_MS + 40); hideTimer?.unref?.();
      } else {
        place(); if (!layer.getVisible?.()) layer.setVisible(true); drawn = true;
        look(next);
      }
    } else if (!next.sideShown) { place(false); look(next); }   // the side, the place, the theme or the interface's scale may have changed: the rectangle and the page follow (what did not change is not sent; the order of the views is the layout's business)
  }
  function armRelease() { cancel(releaseTimer); releaseTimer = schedule(() => { releaseTimer = null; if (!wanted) release(); }, RELEASE_MS); releaseTimer?.unref?.(); }
  function cancelRelease() { cancel(releaseTimer); releaseTimer = null; }
  function release() {
    if (!live()) { view = null; return; }
    const win = getWindow(), gone = view; view = null; ready = null; pushed = {}; drawn = null;
    try { if (win && !win.isDestroyed()) win.contentView.removeChildView(gone); } catch {}
    try { gone.webContents.close(); } catch {}
  }

  // ---- being carried: the button goes down on the hit area, the pointer moves along the edge, the button is let go ----------------------------------------
  // A move that says which buttons are down and does not list the left one means it was let go out of sight; one that says nothing is taken as still held (only a mouseUp ends it then).
  const released = mouse => mouse?.type === 'mouseMove' && Array.isArray(mouse.modifiers) && !mouse.modifiers.some(key => String(key).toLowerCase() === 'leftbuttondown');
  // Where the pointer is along the screen: the screen's own answer first (the controller reads the same one), the event's global position where the screen will not say (Wayland: main passes null then).
  function pointerY(mouse) { const read = cursorY(); if (read !== null && read !== undefined && Number.isFinite(Number(read))) return Number(read); const global = Number(mouse?.globalY); return Number.isFinite(global) ? global : null; }
  function mouseEvent(mouse) {
    if (!mouse) return;
    if (mouse.type === 'mouseDown' && (mouse.button || 'left') === 'left') {
      const g = geometry(), y = pointerY(mouse); if (!g || y === null) return;
      // A press on a view takes the keyboard with it: whoever had it (the page, the address field) gets it back when the handle is let go.
      let restore = null; try { restore = keepFocus(); } catch {}
      drag = { startY: y, startCenter: g.y, fraction: Number(fraction()), restore, at: now() };
      push({ drag: 1, s: 'over' });
      return;
    }
    if (!drag) return;
    drag.at = now();
    if (mouse.type === 'mouseUp' || released(mouse)) { finish(); return; }
    if (mouse.type !== 'mouseMove') return;
    const y = pointerY(mouse), box = content(); if (y === null || !box) return;
    drag.fraction = handleFraction({ height: box.height, y: drag.startCenter + (y - drag.startY), scale: sc() });
    place();
  }
  function finish() {
    if (!drag) return;
    const done = drag; drag = null;
    push({ drag: 0 }); look(last);
    if (Math.abs(done.fraction - Number(fraction())) > 0.0005) { settled = { value: done.fraction, until: now() + 1500 }; try { onPlaced(done.fraction); } catch {} }
    place();
    try { done.restore?.(); } catch {}
  }

  function dispose() { cancel(hideTimer); cancelRelease(); drag = null; wanted = false; release(); }
  return { update, place, geometry, bounds, dragging: () => !!drag, mouse: mouseEvent, dispose, get view() { return view; }, get wanted() { return wanted; } };
}

module.exports = { createSidebarHandle, pageHtml, FADE_MS, RELEASE_MS, HELD_MS };
