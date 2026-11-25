'use strict';
// Beta 14 section V: Developer tools open INSIDE the tab, docked on the right, at the bottom or on the left of the page, or in a window of their own, like any normal browser.
//
// How it is built (Chromium's way, in Acira's design):
//  - DevTools is hosted in a native view of our own (`webContents.setDevToolsWebContents`, called before `openDevTools`), laid out beside the page view the way two panes of a split
//    view sit: a card each, the page's corner radius, a 6 px gap between them where the divider (a native view, devtools-divider.html) sits. Chromium lays the same two views out in
//    chrome/browser/devtools/devtools_window.cc (DevToolsWindow), devtools_contents_resizing_strategy.cc and chrome/browser/ui/views/frame/contents_layout_manager.cc.
//  - The front-end is loaded UNDOCKED but able to dock (`mode: 'undocked'`, can_dock=true). Docked, Chrome's front-end lays itself out across the WHOLE pane with a transparent hole where the
//    page is meant to show (it reports the hole with InspectorFrontendHost.setInspectedPageBounds, and Electron only honours that for the view it manages itself): in a view of ours that is a dead
//    150 px strip with a splitter of its own. Undocked it fills its view; and unlike `mode: 'detach'` (can_dock=false, which is what Acira's old separate window used) it still has the device toolbar
//    (device emulation) and the "Dock side" row in its own menu. That row is the way the person moves DevTools: a small script in the front-end page (FRONTEND_HOOK) catches a press on its four
//    buttons, tells Acira which side was chosen and lets the front-end change nothing, so the front-end stays undocked while Acira docks it (right, bottom, left) or moves it to a window. The same
//    script shows the Close button the front-end hides while undocked, marks the side Acira is on in that row, and sends Ctrl/Cmd+Shift+D (switch dock side) to Acira too. Chromium's front-end
//    source (front_end/ui/legacy/DockController.ts) is the reference for the four buttons; nothing in it is patched, only listened to and answered.
//  - The page's geometry stays where it was: the interface still measures a pane per tab and main still places the page view. This module only TRIMS that rectangle by the dock's size
//    (`trim`, called from applyLayout beside the extension side panel's), and follows the page view wherever page-motion.cjs puts it (`entry.onBounds`), so the slide, the sidebar's own
//    glides and a window resize all carry DevTools and the divider along in the same frame, with no clock of their own and nothing in the interface to keep in step.
//  - Opening slides in on the page's own spring (the page makes room while DevTools is uncovered from the docked edge, its layout held at its final size so it lays out once); closing is the
//    exact reverse. The dock waits for the front-end to have painted before it moves (it loads behind the page, which covers it), so no white or black frame is ever shown.
//  - Defaults (beta 14.0): a first open, with nothing saved, docks on the RIGHT in every layout that has room. Where the pane cannot hold the right dock (the page keeps 300 px and DevTools at least 120) the bottom dock is tried,
//    then a window of its own: that automatic choice is never saved and never becomes the default (`rec.auto`: the side is written only when the person chose it, the sizes only when the person dragged). Whatever stops the dock
//    from opening, or from saving the person's choice, is written to main.log with its reason (`log`), never swallowed; `why()` says why the last request could not be served (main falls back to Electron's own window then).
//  - Per tab: each tab has its own dock (a record on the page's entry), hidden with its page when another tab is shown and back, unchanged, when it returns; closing the tab closes it. A
//    split pane docks inside its own pane. Nothing is saved about it that could open DevTools again at the next start: only the last side, the sizes per side and the window's place are
//    remembered (the store given by main), never "open".
//  - A tab with DevTools open never goes to sleep (`protects`): Electron's isDevToolsOpened() is false for DevTools hosted in a view of ours.
const path = require('node:path');
const geometry = require('./devtools-dock-geometry.cjs');
const motion = require('./page-motion.cjs');

const DIVIDER_PAGE = path.join(__dirname, 'devtools-divider.html'), DIVIDER_PRELOAD = path.join(__dirname, 'devtools-divider-preload.cjs');
const HOOK_PREFIX = '__acira_devtools__ ';
const READY_CAP_MS = 2500, SLIDE_CAP_MS = 1400, GLIDE_WAIT_MS = 700, HEAL_MS = 250, HEAL_TRIES = 3, KEY_STEP = 16, KEY_STEP_BIG = 64;
const ALL_SIDES = ['right', 'bottom', 'left', 'window'];
const TOOLBOX_CAP_MS = 2500;
const TOOLBOX_URL = /^devtools:\/\/devtools\/bundled\/device_mode_emulation_frame\.html/;
/** What the front-end asks for when the device toolbar is on while it is undocked (window.open of its own device_mode_emulation_frame page: Chrome shows that page over the tab and puts the inspected page into the hole it reports). */
const OPEN_TOOLBOX = `void window.open(location.href.replace('devtools_app.html','device_mode_emulation_frame.html'))`;
/** Has the toolbox drawn its device frame? Two frames after it exists. */
const TOOLBOX_PAINTED = `new Promise(resolve=>{const t0=performance.now();const twice=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(resolve,30)));setTimeout(resolve,1200);twice();})`;

/**
 * Has the front-end drawn its own interface? Its document finishes loading long before: its first frames are a light splash (a white flash in dark mode) while its modules load. It has when its toolbar
 * exists (found through the shadow roots) and two frames have been drawn after that; at the latest after three seconds. Runs in the front-end page, behind the page view that covers it, which is drawn.
 */
const PAINTED = `new Promise(resolve=>{const t0=performance.now();const found=()=>{const stack=[document.documentElement];while(stack.length){const n=stack.pop();if(n.nodeType===1&&n.tagName==='DEVTOOLS-TOOLBAR'&&n.getBoundingClientRect().width>0)return true;if(n.shadowRoot)stack.push(n.shadowRoot);for(const c of (n.children||[]))stack.push(c);}return false;};const twice=()=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(1)));const step=()=>{if(found()||performance.now()-t0>3000)twice();else requestAnimationFrame(step);};step();})`;

/** Keys a DevTools page did not use go to the browser's shortcuts (F12 closes, new tab and switch tab work from inside DevTools), and the release of Ctrl/Meta: runs in the front-end and in its device toolbox page, where `say` is the page's own reporter. */
const KEY_FORWARD = `window.addEventListener('keydown',event=>{if(event.defaultPrevented)return;if(!(event.ctrlKey||event.metaKey||event.altKey)&&!/^F\\d+$/.test(event.key))return;const at=event.composedPath&&event.composedPath()[0],typing=!!at&&(at.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName||''));if(typing&&(event.altKey||!(event.ctrlKey||event.metaKey)))return;say('key',{key:event.key,code:event.code,shift:event.shiftKey,control:event.ctrlKey,alt:event.altKey,meta:event.metaKey,repeat:event.repeat});},false);
window.addEventListener('keyup',event=>{if(event.key==='Control'||event.key==='Meta')say('key',{type:'keyUp',key:event.key,code:event.code,shift:event.shiftKey,control:event.ctrlKey,alt:event.altKey,meta:event.metaKey});},false);`;

/**
 * The script that runs in the DevTools front-end page (main world) once its document exists. It wraps two methods of InspectorFrontendHost, the object Chromium's own embedder answers (Acira closes
 * DevTools itself, with its slide, and decides about focus), and does five small things (see the header): the dock-side buttons of the front-end's menu and Ctrl/Cmd+Shift+D choose Acira's side
 * and change nothing in the front-end; the menu marks Acira's side (window.__acira.side, set by Acira); the Close button is shown; the keys the front-end did not use go to the browser's shortcuts, as
 * Chrome's browser does with unhandled keys (F12 to close, new tab, switch tab work from inside DevTools). Each piece finds its elements by the front-end's own `jslog` names, which are not translated.
 */
/** The script that runs in the device toolbox page: its keys go to the browser's shortcuts too. */
function toolboxHook() {
  return `(()=>{if(window.__aciraToolbox)return 'none';window.__aciraToolbox=1;const say=(kind,value)=>{try{console.debug(${JSON.stringify(HOOK_PREFIX)}+JSON.stringify({kind,value}));}catch{}};
${KEY_FORWARD}
return 'hooked';})()`;
}

function frontendHook() {
  return `(()=>{const H=window.InspectorFrontendHost;if(!H||H.__acira)return 'none';H.__acira=1;window.__acira={side:'right'};
const say=(kind,value)=>{try{console.debug(${JSON.stringify(HOOK_PREFIX)}+JSON.stringify({kind,value}));}catch{}};
for(const [name,kind] of [['closeWindow','close'],['bringToFront','front']]){if(typeof H[name]==='function')H[name]=function(){say(kind);};}
const docked=H.setIsDocked;if(typeof docked==='function')H.setIsDocked=function(on){if(on)say('docked',true);return docked.apply(H,arguments);};
const DEVICE='emulation.show-device-mode',on=value=>String(value).replace(/"/g,'')==='true';
const pref=H.setPreference;if(typeof pref==='function')H.setPreference=function(name,value){if(name===DEVICE)say('deviceMode',on(value));return pref.apply(H,arguments);};
const hole=H.setInspectedPageBounds;if(typeof hole==='function'){H.setInspectedPageBounds=function(bounds){try{const key=JSON.stringify(bounds);if(key!==window.__acira.hole){window.__acira.hole=key;say('hole',bounds);}}catch{}return hole.apply(H,arguments);};}
try{H.getPreferences(prefs=>{if(prefs&&prefs[DEVICE]!==undefined)say('deviceMode',on(prefs[DEVICE]));else say('deviceMode',false);});}catch{}
const SIDES={right:'right',bottom:'bottom',left:'left',undock:'window',undocked:'window'};
const sideOf=el=>{const m=/current-dock-state-([a-z]+)/.exec((el&&el.getAttribute&&el.getAttribute('jslog'))||'');return m?SIDES[m[1]]:null;};
const deep=visit=>{const stack=[document.documentElement];while(stack.length){const n=stack.pop();if(n.nodeType===1)visit(n);if(n.shadowRoot)stack.push(n.shadowRoot);for(const c of (n.children||[]))stack.push(c);}};
let closed=false;
const patch=()=>deep(el=>{if(el.tagName!=='DEVTOOLS-BUTTON')return;const side=sideOf(el);
 if(side){const on=side===window.__acira.side,inner=el.shadowRoot&&el.shadowRoot.querySelector('button');if(inner){if(inner.classList.contains('toggled')!==on)inner.classList.toggle('toggled',on);if(inner.getAttribute('aria-pressed')!==String(on))inner.setAttribute('aria-pressed',String(on));}}
 else if(el.classList.contains('close-devtools')){closed=true;if(el.classList.contains('hidden'))el.classList.remove('hidden');}});
window.addEventListener('click',event=>{for(const el of event.composedPath()){const side=sideOf(el);if(side){event.preventDefault();event.stopImmediatePropagation();say('side',side);return;}
 if(el.getAttribute){const log=el.getAttribute('jslog')||'';if(/context: main-menu/.test(log)){for(const ms of [40,120,260,500])setTimeout(patch,ms);return;}}}},true);
window.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.shiftKey&&!event.altKey&&event.code==='KeyD'){event.preventDefault();event.stopImmediatePropagation();say('toggleDock');}},true);
let tries=0;const timer=setInterval(()=>{patch();if((closed&&tries>4)||++tries>40)clearInterval(timer);},400);patch();
${KEY_FORWARD}
return 'hooked';})()`;
}

/**
 * `deps`: WebContentsView and BaseWindow (Electron's); getWindow() the browser window; getEntry(tabId) a tab's page entry ({view, targetBounds, ...}) or undefined; relayout() re-applies the
 * current layout; clock (page-motion's: now/later/cancel); store {read(), write(patch)} the remembered side, sizes and window place; radius(), dark(), accent(), motionScale() (0 when motion is off);
 * focus(contents) the focus gate's request; openTab(url); shortcut(contents, event, input) the browser's key handler; isFullscreen(entry); appFocused() whether Acira has the keyboard (a window of DevTools is only brought forward then: nothing steals the focus from another app); frameMs() the length of one frame of the display the window is on (the divider's drag lays the page out at most once a frame); cursorPoint() the pointer's place on the screen (used when the divider's own page has no screen position to report); scale() the interface's scale (1, 1.25, 1.5 ...); trackFocus(contents) keeps main's record of which surface has the keyboard; captionInset(outer) the height a Windows caption box takes off the top of a right-docked DevTools whose pane reaches the page area's top-right corner (0 elsewhere); surface() the colour behind DevTools while it loads; onChange(tabId, open); log(message) a failure (written to main.log by main); trace(message) what is only worth a line on the console (defaults to log).
 */
function createDevtoolsDock(deps) {
  const { WebContentsView, BaseWindow, getWindow, getEntry, relayout, clock, store, radius = () => 8, dark = () => true, accent = () => null, motionScale = () => 1, focus = () => {}, openTab = () => {},
    shortcut = () => {}, isFullscreen = () => false, appFocused = () => true, cursorPoint = () => null, frameMs = () => 1000 / 60, scale = () => 1, trackFocus = () => {}, captionInset = () => 0, label = () => 'Resize Developer tools', surface = () => (dark() ? '#1f1f1f' : '#ffffff'), onChange = () => {}, log = () => {}, trace = log } = deps;
  const recs = new Map(), dockClosed = new WeakSet();   // windows the dock itself closes: their 'closed' is not the person closing DevTools
  /** The geometry in the units of the interface's scale now (the gap and the minimums are interface pixels). */
  const scaled = new Map(), g = () => { const factor = Number(scale()) || 1; let value = scaled.get(factor); if (!value) { value = geometry.forScale(factor); scaled.set(factor, value); } return value; };
  const alive = contents => !!contents && !contents.isDestroyed();
  let failure = null;   // why the last request could not be served by the dock (null: it was)
  const fail = reason => { failure = reason; log('devtools dock: ' + reason); return false; };
  const guarded = (name, fn) => (...args) => { try { return fn(...args); } catch (error) { failure = name + ' threw: ' + (error && error.message || error); log('devtools dock ' + name + ' failed: ' + (error && error.message || error)); return undefined; } };
  const docked = side => side !== 'window';
  /** What a report of DevTools in a window of its own names (written to main.log by `log`): the side and how it was chosen, the pane, whether the page is on screen. No address, no title. */
  const stateOf = rec => { let remembered; try { remembered = (store.read() || {}).side; } catch { remembered = '?'; } return { side: rec.side, auto: !!rec.auto, status: rec.status, outer: rec.outer ? Math.round(rec.outer.width) + 'x' + Math.round(rec.outer.height) : 'none', fits: rec.fits, scale: Number(scale()) || 1, pageVisible: !!rec.entry.view.getVisible(), pageFullscreen: !!isFullscreen(rec.entry), remembered: remembered || 'none', reason: rec.windowReason || 'unknown path' }; };
  /** DevTools' own window comes forward only while Acira has the keyboard: a breakpoint hit or a message from the front-end never takes the focus from another app (13.8's rule). */
  const showWindow = rec => { const win = rec.win; if (!win || win.isDestroyed()) return; if (appFocused()) win.show(); else if (typeof win.showInactive === 'function') win.showInactive(); else win.show(); };

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- views
  /** Keeps DevTools and its divider right above the tab's page view, so they stack and hide with it and stay under the interface's own layers. */
  function raise(rec) {
    const win = getWindow(); if (!win || win.isDestroyed() || !docked(rec.side) || !rec.dev) return;
    const children = win.contentView.children, at = children.indexOf(rec.entry.view); if (at < 0) return;
    const wanted = [rec.dev, rec.divider].filter(Boolean);
    if (wanted.every((view, i) => children[at + 1 + i] === view)) return;
    wanted.forEach((view, i) => win.contentView.addChildView(view, Math.min(children.length, at + 1 + i)));
  }
  /**
   * While its front-end loads DevTools stands where it is going to be but BEHIND the page view, which covers it (a pane's page is opaque and has the same corner radius): a view that is out of the
   * window, or hidden, is not drawn at all (no frames, so the front-end never reports having painted: measured, 2.9 s per open), and one in front of the page would show a half-painted front-end.
   */
  function lower(rec) {
    const win = getWindow(); if (!win || win.isDestroyed() || !rec.dev) return;
    const children = win.contentView.children, at = children.indexOf(rec.entry.view); if (at < 0) return;
    if (children.indexOf(rec.dev) >= 0 && children.indexOf(rec.dev) < at) return;
    win.contentView.addChildView(rec.dev, at);
  }
  /** The page's own rectangle (what page-motion placed): while the device toolbox is up the page view itself stands in the toolbox's hole, so the rectangle is the one the layout gave it. */
  const pageNow = rec => (rec.holed && rec.pageOuter ? rec.pageOuter : rec.entry.view.getBounds());
  /**
   * The page is gliding for a reason of its own (the sidebar opening or closing carries it along, entry.boundsTimer) and DevTools is not what moves it. A change of DevTools' place made now (its side, its
   * window, the divider) has to take the page's rectangle at once, and page-motion.cjs answers an unglided placement in the middle of a glide by either keeping the glide's curve toward the new
   * target (DevTools stands beside a page that has not changed shape yet: off the window for a frame, the old dock's place empty for the rest of the glide) or by landing the page at its final
   * rectangle ahead of the sidebar. Measured with a 2 ms sampler on 20 side changes during a slide: one sample in nearly every run. So the change waits for the glide to land (at most
   * GLIDE_WAIT_MS) and is then made as at rest: instant, in one pass.
   */
  const pageGliding = rec => !!rec.entry.boundsTimer && !rec.sliding;
  function afterGlide(rec, fn) {
    let waited = 0;
    const attempt = () => {
      rec.glideWait = null; if (rec.status === 'gone' || recs.get(rec.tabId) !== rec) return;
      if (pageGliding(rec) && waited < GLIDE_WAIT_MS) { waited += 16; rec.glideWait = clock.later(guarded('glide', attempt), 16); return; }
      fn();
    };
    attempt();
  }
  const setVisible = (view, visible) => { if (view && alive(view.webContents) && view.getVisible() !== visible) view.setVisible(visible); };
  const setBounds = (view, bounds) => { if (view && alive(view.webContents)) { const now = view.getBounds(); if (now.x !== bounds.x || now.y !== bounds.y || now.width !== bounds.width || now.height !== bounds.height) view.setBounds(bounds); } };

  const outsideContent = rect => { const win = getWindow(); if (!win || win.isDestroyed()) return false; const [w, h] = win.getContentSize(); return rect.x < -2 || rect.y < -2 || rect.x + rect.width > w + 2 || rect.y + rect.height > h + 2; };
  /** DevTools and the divider are put beside the page at `pageRect` (the page's own rectangle, wherever it is in its glide). */
  function place(rec, pageRect) {
    if (!rec.dev || rec.status === 'gone' || !docked(rec.side)) return;
    if (rec.status === 'loading') {
      const entry = rec.entry, pane = rec.outer, size = pane && g().clampSize(rec.side, rec.sizes[rec.side], pane);
      if (!entry.view.getVisible() || isFullscreen(entry) || !pane || size === null) { setVisible(rec.dev, false); return; }
      setBounds(rec.dev, g().belowCaption(g().dockRects(pane, rec.side, size, 1).devtools, rec.side, captionInset(pane)));
      const round = Math.round(radius()); if (rec.radius !== round) { rec.radius = round; rec.dev.setBorderRadius?.(round); }
      lower(rec); setVisible(rec.dev, true); return;
    }
    const entry = rec.entry, shown = entry.view.getVisible() && !isFullscreen(entry) && rec.fits && !!rec.outer;
    if (!rec.fits || !rec.outer) { setVisible(rec.dev, false); setVisible(rec.divider, false); if (rec.drag) endDrag(rec); return; }
    const f = g().follow(pageRect, rec.outer, rec.side, rec.size, rec.sliding ? undefined : rec.goal);
    rec.progress = f.progress;
    // A slide goes on to its end whether or not its tab is on screen (a tab switch hides the page, whose glide still lands): the end is noticed here either way.
    if (rec.sliding && (rec.goal === 1 ? f.progress >= .999 : f.progress <= .001)) { if (rec.goal === 1) settle(rec); else { guarded('finish', finish)(rec); return; } }
    if (!shown) { setVisible(rec.dev, false); setVisible(rec.divider, false); if (rec.drag) endDrag(rec); return; }
    const devtools = g().belowCaption(f.devtools, rec.side, captionInset(rec.outer)), visible = f.progress > 0 && devtools.width > 0 && devtools.height > 0;
    // A dock that is in (not sliding) and has DevTools outside the window is a mix of two layouts (the page still in the old side's place, DevTools beside it): never shown for a frame. The page is put where the last layout pass put it, and DevTools beside it, in this same pass.
    if (visible && !rec.sliding && rec.goal === 1 && !rec.holed && outsideContent(devtools)) {
      const want = g().dockRects(rec.outer, rec.side, rec.size, 1);
      if (Math.abs(pageRect.x - want.page.x) > 1 || Math.abs(pageRect.y - want.page.y) > 1 || Math.abs(pageRect.width - want.page.width) > 1 || Math.abs(pageRect.height - want.page.height) > 1) {
        if (!rec.mixLogged) { rec.mixLogged = true; trace('devtools dock: DevTools would have stood outside the window beside a page in the wrong place; the page is put where the last layout put it'); }
        rec.entry.view.setBounds(want.page); rec.entry.targetBounds = want.page; return place(rec, want.page);
      }
    } else if (rec.mixLogged && !outsideContent(devtools)) rec.mixLogged = false;
    if (visible) { setBounds(rec.dev, devtools); const round = Math.round(radius()); if (rec.radius !== round) { rec.radius = round; rec.dev.setBorderRadius?.(round); } raise(rec); }
    setVisible(rec.dev, visible);
    if (rec.divider) { const settled = !rec.sliding && rec.goal === 1; if (settled) { setBounds(rec.divider, f.divider); raise(rec); } setVisible(rec.divider, settled && f.divider.width > 0); if (settled) sendDividerState(rec); }
  }
  /** The page's rectangle is `pageRect`: the device toolbox (when there is one) takes its place over it and the page view its hole, DevTools and the divider stand beside it. */
  function placeAll(rec, pageRect) { try { placeToolbox(rec, pageRect); } catch (error) { log('devtools dock toolbox failed: ' + (error && error.message || error)); } place(rec, pageRect); scheduleCheck(rec); }
  /**
   * A layout that is wrong AT REST is put right: 250 ms after the last placement of a tab's page, with nothing moving it (no glide, no slide, no drag, no device toolbox), the page and DevTools must
   * be where the last layout pass put them. Two requests that crossed (the dock's side changed in the middle of the sidebar's slide: seen twice in thirty side changes with a 2 ms sampler) once left
   * the page in the old side's place and DevTools beside it outside the window until the next pass. Three tries, then it is left alone.
   */
  function scheduleCheck(rec) {
    if (rec.status !== 'open' || !docked(rec.side)) return;
    clock.cancel?.(rec.healTimer); rec.healTimer = clock.later(guarded('heal', () => { rec.healTimer = null; checkRest(rec); }), HEAL_MS);
  }
  function checkRest(rec) {
    if (rec.status !== 'open' || !docked(rec.side) || !rec.fits || !rec.outer || !rec.dev || rec.sliding || rec.drag || rec.holed || rec.toolbox && rec.deviceMode || rec.entry.boundsTimer || rec.entry.dockDragging || !rec.entry.view.getVisible() || isFullscreen(rec.entry) || rec.goal !== 1) { return; }
    const want = g().dockRects(rec.outer, rec.side, rec.size, 1), page = rec.entry.view.getBounds(), same = (a, b) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1 && Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
    const devWant = g().belowCaption(want.devtools, rec.side, captionInset(rec.outer));
    if (same(page, want.page) && same(rec.dev.getBounds(), devWant)) { rec.heals = 0; return; }
    if ((rec.heals || 0) >= HEAL_TRIES) return;
    rec.heals = (rec.heals || 0) + 1; trace('devtools dock: the page and DevTools were not where the last layout put them at rest; put right (' + rec.heals + ')');
    rec.entry.view.setBounds(want.page); rec.entry.targetBounds = want.page; placeAll(rec, want.page);
  }
  /** A slide that ends for any reason but landing (the person moved the divider or the side in the middle of it): DevTools' layout is let go, so it takes the size it now has. */
  function stopSliding(rec) { if (!rec.sliding) return; rec.sliding = false; clock.cancel?.(rec.slideCap); rec.slideCap = null; motion.releaseLayoutAfter(rec.devEntry, clock); }
  /** The slide reached its end: DevTools keeps the layout it was held at (the same size), the divider shows. */
  function settle(rec) {
    if (!rec.sliding) return; rec.sliding = false; clock.cancel?.(rec.slideCap); rec.slideCap = null;
    if (rec.goal === 1) { motion.releaseLayoutAfter(rec.devEntry, clock); placeAll(rec, pageNow(rec)); sendDividerState(rec); onChange(rec.tabId, true); }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- geometry hooks
  /** Called by applyLayout for a tab's rectangle before its page is placed: returns what is left for the page. */
  function trim(tabId, bounds) {
    const rec = recs.get(tabId);
    if (!rec || rec.status === 'gone' || !rec.dev || !bounds) return bounds;
    rec.outer = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    if (!docked(rec.side) || rec.status === 'loading') { rec.fits = false; return bounds; }
    const size = g().clampSize(rec.side, rec.sizes[rec.side], bounds);
    rec.fits = size !== null; if (!rec.fits) return bounds;
    rec.size = size;
    // The default size is chosen once, from the pane DevTools opened in: a pane that narrows later (the sidebar opening) does not make DevTools narrower with it; only the person's divider does.
    if (rec.sizes[rec.side] === undefined) rec.sizes[rec.side] = size;
    return g().dockRects(bounds, rec.side, size, rec.goal).page;
  }
  /** After every placement of the page view (page-motion.cjs `entry.onBounds`). */
  const afterBounds = (rec, pageRect) => guarded('follow', placeAll)(rec, pageRect);
  /** A layout pass ended: whatever the page did (or did not do) on it, DevTools stands beside the page as it is now. */
  function afterLayout() { for (const rec of recs.values()) guarded('place', placeAll)(rec, pageNow(rec)); }
  /** The page was shown or hidden (a tab switch): DevTools goes with it. */
  const refresh = tabId => { const rec = recs.get(tabId); if (rec) guarded('place', placeAll)(rec, pageNow(rec)); };

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- the slide
  function startSlide(rec, goal) {
    if (rec.status === 'gone') return;
    rec.goal = goal; rec.sliding = true;
    clock.cancel?.(rec.slideCap); rec.slideCap = clock.later(() => { rec.slideCap = null; if (!rec.sliding || rec.status === 'gone') return; if (rec.goal === 0) guarded('finish', finish)(rec); else { rec.progress = 1; settle(rec); } }, SLIDE_CAP_MS);
    const entry = rec.entry, animate = motionScale() > 0 && entry.view.getVisible() && !isFullscreen(entry) && !holding(rec);
    if (goal === 1 && animate && rec.outer) { const size = g().clampSize(rec.side, rec.sizes[rec.side], rec.outer); if (size !== null && motion.canHoldLayout(rec.devEntry)) motion.holdLayout(rec.devEntry, g().finalLayoutSize(rec.outer, rec.side, size, captionInset(rec.outer))); }
    entry.dockSlide = animate; entry.dockSnap = !animate;
    try { relayout(); } finally { entry.dockSlide = false; entry.dockSnap = false; }
    // The layout moved nothing (the page is not on screen, or it did not need to move): nothing will call back, so the end is now.
    if (rec.sliding && !entry.boundsTimer) { placeAll(rec, pageNow(rec)); if (rec.sliding && !entry.boundsTimer) { if (goal === 0) guarded('finish', finish)(rec); else { rec.progress = 1; settle(rec); } } }
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- device mode
  /**
   * DevTools' device mode (the device toolbar) sets the page's viewport override through the same call page-motion.cjs uses to hold a page's layout (enableDeviceEmulation), and releasing a hold
   * (disableDeviceEmulation) would switch the person's device mode off behind their back, in a "Responsive" viewport too (it has the size of the page's own view, so the size alone cannot tell). The
   * front-end says whether it is on: its `emulation.show-device-mode` preference, read once and followed as it is set (the hook). Until it has said, or while it is on, the page's layout is never
   * held (`entry.dock.noHold`, read by page-motion.cjs canHoldLayout): per-frame layouts for the page of a developer who is emulating a device, the cost of leaving the emulation alone.
   */
  function setDeviceMode(rec, on) {
    const was = rec.deviceMode; rec.deviceMode = !!on; rec.noHold = rec.deviceMode;
    if (rec.status !== 'open') return;   // a front-end still loading is dealt with when DevTools begins (begin)
    if (rec.deviceMode) { if (rec.toolbox) placeAll(rec, pageNow(rec)); else openToolbox(rec); }   // a toolbox from earlier in this session is shown again (a second one is laid out wrongly by the front-end: measured)
    else if (was !== false) { placeAll(rec, pageNow(rec)); releaseSlide(rec); }   // hidden, not closed: the page is back in its rectangle
  }
  /** Is the toolbox up and in use? (It stays for the life of the front-end once made; it is only shown while device mode is on.) */
  const holding = rec => !!rec.toolbox && !!rec.deviceMode;

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- the device toolbox
  /**
   * Chrome's device toolbar does not live in DevTools' own page while DevTools is undocked: the front-end opens a second page (device_mode_emulation_frame.html, "the toolbox") that Chrome puts
   * over the inspected tab and cuts a hole in, and the inspected page stands in that hole (the front-end reports the hole with setInspectedPageBounds). The same here: while the device toolbar is on,
   * the toolbox is a view right BEHIND the page's view and as big as the page's rectangle, and the page view itself moves into the hole (square: a device's screen, not a card). Everything that
   * is the page's rectangle (the dock's trim, the sidebar, a window resize, the divider) goes on as before; the toolbox and the page follow it in the same frame (`placeToolbox`, called after every
   * placement of the page). A page with the toolbox does not glide: the toolbox lays out again at every size it is given and its hole comes a frame later, so the page, the toolbox and DevTools
   * take their places at once (page-motion.cjs, main.cjs `animated`). The front-end opens ONE toolbox for its life: device mode turned off hides it (the page goes back), turned on shows it again
   * (a second window.open in the same front-end gets a wrongly laid-out frame: measured), and DevTools closing closes it.
   */
  function openToolbox(rec) {
    if (rec.toolbox || rec.toolboxAsked || rec.status === 'gone' || !rec.dev || !alive(rec.dev.webContents)) return;
    rec.toolboxAsked = true; armToolboxCap(rec);
    rec.dev.webContents.executeJavaScript(OPEN_TOOLBOX, true).catch(() => {});
  }
  /** A toolbox that has not drawn by the cap is given up on (for the slide that waits for it): DevTools comes in all the same. */
  function armToolboxCap(rec) {
    clock.cancel?.(rec.toolboxCap);
    rec.toolboxCap = clock.later(() => { rec.toolboxCap = null; if (rec.status === 'gone') return; rec.toolboxAsked = false; if (!rec.toolbox?.ready) { log('devtools dock: the device toolbox did not come up; the page keeps its place'); releaseSlide(rec); } }, TOOLBOX_CAP_MS);
  }
  /** Electron asks for the page the front-end opened: a view of ours, behind the page (createWindow: Electron connects it to the front-end as its opener). */
  function makeToolbox(rec, options) {
    const win = getWindow(); dropToolbox(rec);
    const view = new WebContentsView(options), contents = view.webContents, tb = rec.toolbox = { view, hole: null, loaded: false, ready: false, painting: null, radius: undefined };
    rec.toolboxAsked = false; trackFocus(contents);
    if (alive(rec.dev?.webContents)) rec.dev.webContents.executeJavaScript('window.__acira&&(window.__acira.hole="")').catch(() => {});   // the front-end's next answer is for this toolbox, even if it equals the last one
    view.setBackgroundColor?.(surface()); win.contentView.addChildView(view);
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => { try { if (!String(event.url).startsWith('devtools://')) event.preventDefault(); } catch {} });
    contents.on('console-message', event => {
      const text = String(event.message ?? ''); if (!text.startsWith(HOOK_PREFIX)) return;
      let parsed; try { parsed = JSON.parse(text.slice(HOOK_PREFIX.length)); } catch { return; }
      guarded('toolbox', onFrontend)(rec, parsed);
    });
    contents.on('dom-ready', () => { if (alive(contents)) contents.executeJavaScript(toolboxHook()).catch(() => {}); });
    contents.on('did-finish-load', () => { tb.loaded = true; guarded('toolbox', checkToolbox)(rec); });
    contents.once('destroyed', () => { if (rec.toolbox === tb) guarded('toolbox', dropToolbox)(rec); });
    contents.on('render-process-gone', () => { if (rec.toolbox === tb) guarded('toolbox', dropToolbox)(rec); });
    placeToolbox(rec, finalPage(rec));
    return contents;
  }
  /** The toolbox has loaded and told where the page goes: once it has also drawn, the page moves into the hole. */
  function checkToolbox(rec) {
    const tb = rec.toolbox; if (!tb || tb.ready || tb.painting || !tb.loaded || !tb.hole || !alive(tb.view.webContents)) return;
    tb.painting = tb.view.webContents.executeJavaScript(TOOLBOX_PAINTED).catch(() => {}).then(() => { if (rec.toolbox !== tb || rec.status === 'gone') return; tb.ready = true; tb.painting = null; clock.cancel?.(rec.toolboxCap); rec.toolboxCap = null; placeToolbox(rec, pageNow(rec)); releaseSlide(rec); });
  }
  /** The front-end says where the inspected page belongs in the toolbox (its coordinates, in the toolbox's own pixels). */
  function onHole(rec, bounds) {
    const tb = rec.toolbox; if (!tb || !bounds || !rec.deviceMode) return;   // what a front-end says while device mode is off is not a hole
    const x = Number(bounds.x), y = Number(bounds.y), width = Number(bounds.width), height = Number(bounds.height);
    if (![x, y, width, height].every(Number.isFinite) || width < 1 || height < 1 || x < 0 || y < 0) return;
    tb.hole = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    if (tb.ready) placeToolbox(rec, pageNow(rec)); else checkToolbox(rec);
  }
  /** What the page's rectangle will be once DevTools is in: the toolbox is made at that size while the slide waits for it. */
  function finalPage(rec) {
    const current = pageNow(rec); if (rec.goal === 1 || !docked(rec.side) || !rec.outer) return current;
    const size = g().clampSize(rec.side, rec.sizes[rec.side], rec.outer); return size === null ? current : g().dockRects(rec.outer, rec.side, size, 1).page;
  }
  /** Seats the toolbox over the page's rectangle and the page view in its hole (or back in its rectangle when there is no hole). Runs after every placement of the page. */
  function placeToolbox(rec, pageRect) {
    const tb = rec.toolbox; if (!tb || rec.status === 'gone' || !pageRect) return;
    const view = tb.view, entry = rec.entry, win = getWindow(); if (!alive(view.webContents) || !win || win.isDestroyed()) return;
    rec.pageOuter = { x: pageRect.x, y: pageRect.y, width: pageRect.width, height: pageRect.height };
    const early = rec.goal !== 1 && docked(rec.side) && !rec.sliding && !!rec.outer, frame = early ? finalPage(rec) : pageRect;   // DevTools not in yet: the toolbox is already the size it will be (its hole is for that size)
    const shown = entry.view.getVisible() && !isFullscreen(entry), active = !!rec.deviceMode;
    setVisible(view, shown && active); if (!shown) return;
    if (!active) { if (rec.holed) unhole(rec); return; }
    setBounds(view, frame);
    const round = Math.round(radius()); if (tb.radius !== round) { tb.radius = round; view.setBorderRadius?.(round); }
    const children = win.contentView.children, at = children.indexOf(entry.view), here = children.indexOf(view);
    if (at >= 0 && (here < 0 || here > at)) win.contentView.addChildView(view, at);   // right below the page view
    if (tb.ready && tb.hole && (rec.goal === 1 || !docked(rec.side))) {
      const x = Math.min(tb.hole.x, Math.max(0, pageRect.width - 1)), y = Math.min(tb.hole.y, Math.max(0, pageRect.height - 1));
      const screen = { x: pageRect.x + x, y: pageRect.y + y, width: Math.max(1, Math.min(tb.hole.width, pageRect.width - x)), height: Math.max(1, Math.min(tb.hole.height, pageRect.height - y)) };
      rec.holed = true; setBounds(entry.view, screen);
      if (entry.radius !== 0) { entry.view.setBorderRadius(0); entry.radius = 0; }   // a device's screen is square
    } else if (rec.holed) unhole(rec);
  }
  /** The page goes back to its rectangle and its corners. */
  function unhole(rec) {
    const entry = rec.entry; rec.holed = false;
    if (rec.pageOuter && alive(entry.view?.webContents)) setBounds(entry.view, rec.pageOuter);
    const wanted = entry.wantedRadius; if (Number.isFinite(wanted) && entry.radius !== wanted) { entry.view.setBorderRadius(wanted); entry.radius = wanted; }
  }
  /** The toolbox is not needed (device mode is off, or DevTools goes): its view and page are closed. */
  function dropToolbox(rec, { restore = true } = {}) {
    clock.cancel?.(rec.toolboxCap); rec.toolboxCap = null; rec.toolboxAsked = false;
    const tb = rec.toolbox; if (!tb) return;
    rec.toolbox = null;
    const win = getWindow(); try { if (win && !win.isDestroyed()) win.contentView.removeChildView(tb.view); } catch {}
    try { if (alive(tb.view.webContents)) tb.view.webContents.close(); } catch {}
    if (rec.holed) { if (restore) { unhole(rec); if (rec.status !== 'gone') afterLayout(); } else rec.holed = false; }
    if (restore) releaseSlide(rec);
  }
  /** A slide that waited for the toolbox goes on (it came up, or it did not). */
  function releaseSlide(rec) { if (!rec.slideWaits) return; rec.slideWaits = false; if (rec.status === 'open') slideIn(rec); }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- the divider
  function sendDividerState(rec) {
    if (!rec.divider || !alive(rec.divider.webContents) || !rec.dividerLoaded) return;
    const state = { side: rec.side, dark: !!dark(), accent: accent() || undefined, motionScale: motionScale(), label: label(), value: Math.round(rec.size || 0), shown: !rec.sliding && rec.goal === 1 && rec.status === 'open' };
    const key = JSON.stringify(state); if (rec.dividerSent === key) return; rec.dividerSent = key;
    try { rec.divider.webContents.send('acira:devtools-divider-state', state); } catch {}
  }
  function makeDivider(rec) {
    const view = new WebContentsView({ webPreferences: { preload: DIVIDER_PRELOAD, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, transparent: true } });
    view.setBackgroundColor?.('#00000000'); view.setVisible(false); rec.divider = view;
    view.webContents.once('did-finish-load', () => { rec.dividerLoaded = true; sendDividerState(rec); });
    view.webContents.ipc.on('acira:devtools-divider', (event, message) => { if (event.sender === view.webContents) guarded('divider', onDivider)(rec, message); });
    view.webContents.loadFile(DIVIDER_PAGE).catch(() => {});
  }
  /** A drag that is over, however it ended (the pointer went up, the side changed or DevTools moved to its window or closed under it, the divider went out of sight under the pointer, a tab switch): nothing of it stays armed
   * (the pointer's release is the divider page's to send, and it cannot when its view is hidden or gone). Round 6 of the full pass asked whether a press without a release stays armed: it did, on every one of those paths but the release. */
  function endDrag(rec) {
    const d = rec.drag; rec.drag = null; if (d?.timer) clock.cancel(d.timer);
    rec.entry.dockDragging = false; motion.endLive(rec.entry, clock);
    return d;
  }
  /** At most one layout of the page per frame of the display the window is on (a mouse that reports at 120 or 1000 Hz must not cost the page more layouts than a window resize, which the OS delivers once a frame). */
  const dragStep = () => Math.max(4, Math.round((Number(frameMs()) || 1000 / 60) - 1));
  /** A drag in screen pixels, relative to where the press began; the arrows move it by a step; a double click or Home goes back to the default size.*/
  function onDivider(rec, message) {
    if (rec.status !== 'open' || !rec.outer) { if (message.type === 'up' && rec.drag) endDrag(rec); return; }
    if (!docked(rec.side)) { if (rec.drag) endDrag(rec); return; }   // no divider stands between the page and a window: a message that still comes was sent before it left
    const side = rec.side, along = side === 'bottom' ? 'y' : 'x';
    // The page reports the pointer in screen pixels; a page that cannot (synthetic input has no screen position: 0, 0) is asked for the pointer's real place instead.
    const at = () => { if (Number.isFinite(message.x) && Number.isFinite(message.y) && (message.x !== 0 || message.y !== 0)) return message[along]; const point = cursorPoint(); return point ? point[along] : message[along]; };
    if (message.type === 'down') { rec.drag = { start: rec.size, at: at(), pending: null, last: 0, began: clock.now(), focus: rec.dev.webContents.isFocused?.() ? rec.dev.webContents : rec.page.isFocused?.() ? rec.page : null }; rec.entry.dockDragging = true; return; }
    if (message.type === 'move' && rec.drag) {
      rec.drag.pending = at(); if (!Number.isFinite(rec.drag.pending)) return;
      const due = () => { const d = rec.drag; if (!d || d.pending === null) return; if (pageGliding(rec) && clock.now() - d.began < GLIDE_WAIT_MS) { if (!d.timer) d.timer = clock.later(() => { if (rec.drag) { rec.drag.timer = null; guarded('drag', due)(); } }, 16); return; } /* the pointer went down during the sidebar's slide: the position waits for it to land */ const size = g().draggedSize(side, d.start, d.pending - d.at, rec.outer); d.pending = null; d.last = clock.now(); if (size !== null) resize(rec, size, true); };
      if (clock.now() - rec.drag.last >= dragStep()) due(); else if (!rec.drag.timer) rec.drag.timer = clock.later(() => { if (rec.drag) { rec.drag.timer = null; guarded('drag', due)(); } }, dragStep());
      return;
    }
    if (message.type === 'up') { const d = rec.drag; rec.drag = null; if (d?.focus && alive(d.focus)) focus(d.focus);   // the press gave the divider's page the keyboard: back to where it was
      if (d?.timer) clock.cancel(d.timer); if (d && d.pending !== null && Number.isFinite(d.pending)) { const size = g().draggedSize(side, d.start, d.pending - d.at, rec.outer); if (size !== null) resize(rec, size, true); } endDrag(rec); remember(rec); relayout(); return; }
    if (message.type === 'reset') { resize(rec, g().defaultSize(side, rec.outer), false); remember(rec); return; }
    if (message.type === 'key') { const size = g().keyedSize(side, rec.size, message.key, message.big ? KEY_STEP_BIG : KEY_STEP, rec.outer); if (size !== null && size !== rec.size) { resize(rec, size, false); remember(rec); } }
  }
  /** The divider moved: the page and DevTools take their new sizes at once (a drag is live: the page's layout is held while the pointer is down). */
  function resize(rec, size, live) {
    const entry = rec.entry, rects = g().dockRects(rec.outer, rec.side, size, 1), here = entry.view.getBounds();
    // A step that moves nothing (the pointer pushed on past the limit: DevTools already as large, or as small, as it may be) touches nothing: no layout held and let go again (a viewport override on and off, a full layout of the page on release), no placement. Only before anything of this drag stands (a hold, a glide, a slide).
    const still = live && !entry.liveHold && !entry.boundsTimer && !rec.sliding && size === rec.size && Math.abs(here.x - rects.page.x) <= 1 && Math.abs(here.y - rects.page.y) <= 1 && Math.abs(here.width - rects.page.width) <= 1 && Math.abs(here.height - rects.page.height) <= 1;
    rec.sizes[rec.side] = size; rec.chosen[rec.side] = true; rec.size = size; if (still) return;
    stopSliding(rec);
    entry.targetBounds = rects.page;
    // A drag that makes the page narrower keeps the page's layout at the size it had when the pointer went down (one layout, none per step, as the sidebar's glide does); a drag that makes it wider than
    // that has to lay out at the new size on each step, as a resize of the window does, and does it WITHOUT touching the page's viewport override (growing a hold on every step costs a layout each time more).
    if (live) { const held = rec.drag ? (rec.drag.hold ||= { width: here.width, height: here.height }) : undefined, fits = !!held && rects.page.width <= held.width && rects.page.height <= held.height; motion.placeLive(entry, rects.page, fits ? held : undefined, clock, Math.round(radius())); }
    else { entry.view.setBounds(rects.page); entry.onBounds?.(rects.page); }
  }
  /** The side and the sizes the person chose (a size the dock picked by default is not remembered: the next open picks again from the pane it opens in). */
  const remember = rec => {
    try { store.write({ ...(rec.auto ? {} : { side: rec.side }), sizes: Object.fromEntries(Object.entries(rec.sizes).filter(([name, value]) => rec.chosen[name] && Number.isFinite(value))) }); }
    catch (error) { log('devtools dock: the side and sizes could not be saved: ' + (error && error.message || error)); }
  };
  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- the front-end
  function onFrontend(rec, event) {
    if (rec.status === 'gone') return;
    const { kind, value } = event;
    if (kind === 'close') close(rec.tabId);
    else if (kind === 'side') setSide(rec.tabId, value);
    else if (kind === 'toggleDock') setSide(rec.tabId, docked(rec.side) ? 'window' : rec.lastDocked || 'right');
    else if (kind === 'deviceMode') setDeviceMode(rec, value);
    else if (kind === 'hole') onHole(rec, value);
    else if (kind === 'docked') trace('devtools dock: the front-end docked itself (a command menu entry?): its layout will carry a dead strip until it is closed');
    else if (kind === 'front') { if (rec.side === 'window') showWindow(rec); else focus(rec.dev.webContents); }
    else if (kind === 'key' && value) {
      const input = { type: value.type === 'keyUp' ? 'keyUp' : 'keyDown', key: String(value.key || '').slice(0, 24), code: String(value.code || '').slice(0, 24), shift: !!value.shift, control: !!value.control, alt: !!value.alt, meta: !!value.meta, isAutoRepeat: !!value.repeat, isComposing: false };
      shortcut(rec.dev.webContents, { preventDefault() {} }, input);
    }
  }
  /** Tells the front-end's menu which side Acira has DevTools on (the front-end believes it is undocked). */
  function pushSide(rec) { if (rec.dev && alive(rec.dev.webContents)) rec.dev.webContents.executeJavaScript(`window.__acira&&(window.__acira.side=${JSON.stringify(rec.side)})`).catch(() => {}); }
  /** The front-end has loaded and painted twice: the dock may move. */
  function markReady(rec) {
    if (rec.ready || rec.status !== 'loading' || !rec.loaded) return;
    if (!docked(rec.side)) { begin(rec); return; }   // a window that is not shown paints no frames to wait for: it is shown at once, with the surface colour behind it
    if (rec.painting || !alive(rec.dev.webContents)) return;
    rec.painting = rec.dev.webContents.executeJavaScript(PAINTED).then(() => rec).catch(() => rec).then(r => { if (recs.get(rec.tabId) === r && r.status === 'loading') begin(r); });
  }
  function begin(rec) {
    if (rec.ready) return; rec.ready = true; clock.cancel?.(rec.readyCap); rec.readyCap = null;
    rec.status = 'open';
    if (docked(rec.side) && rec.outer && g().clampSize(rec.side, rec.sizes[rec.side], rec.outer) === null) {
      // A pane too small for both is not a DevTools nobody can see: the bottom dock is tried (a narrow pane is often tall), then a window. Chosen by the dock, so never remembered (`rec.auto`).
      const from = rec.side, wanted = ['right', 'bottom', 'left'].find(side => side !== from && g().clampSize(side, rec.sizes[side], rec.outer) !== null) || 'window';
      rec.auto = true; rec.side = wanted; rec.dividerSent = null; rec.windowReason = 'automatic: no dock fits the pane'; log('devtools dock: the ' + from + ' dock does not fit a pane of ' + Math.round(rec.outer.width) + 'x' + Math.round(rec.outer.height) + ' px: opened ' + (wanted === 'window' ? 'in a window' : 'at the ' + wanted) + ' this time (not remembered)');
      if (wanted === 'window') moveToWindow(rec, { show: false });
      pushSide(rec);
    }
    if (!docked(rec.side)) { showWindow(rec); onChange(rec.tabId, true); afterOpen(rec); if (rec.deviceMode) openToolbox(rec); return; }
    // The device toolbar was left on: its toolbox comes up first, so the slide shows the finished layout. (A front-end whose device mode is on opens its toolbox by itself while it loads: it may be here, even drawn.)
    if (rec.deviceMode && !rec.toolbox?.ready) { rec.slideWaits = true; if (rec.toolbox) armToolboxCap(rec); else openToolbox(rec); return; }
    slideIn(rec);
  }
  function slideIn(rec) { if (rec.status !== 'open') return; raise(rec); startSlide(rec, 1); afterOpen(rec); }   // above the page from the first frame of the slide
  function afterOpen(rec) {
    const wanted = rec.afterOpen; rec.afterOpen = null; if (!wanted) return;
    if (wanted.inspect && alive(rec.page)) { try { rec.page.inspectElement(Math.round(wanted.inspect.x), Math.round(wanted.inspect.y)); } catch {} }
    if (wanted.focus !== false && alive(rec.dev?.webContents)) focus(rec.dev.webContents);
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- open, close, move
  function open(tabId, options = {}) {
    const entry = getEntry(tabId), win = getWindow();
    failure = null;
    if (!entry) return fail('no page for this tab');
    if (!win || win.isDestroyed()) return fail('no browser window');
    if (!alive(entry.view?.webContents)) return fail('the tab\'s page is gone');
    let rec = recs.get(tabId);
    if (rec) {
      rec.afterOpen = { ...(rec.afterOpen || {}), ...options };
      if (rec.status === 'closing') { rec.status = 'open'; if (!docked(rec.side)) showWindow(rec); else startSlide(rec, 1); }
      if (rec.status === 'open') afterOpen(rec);
      return true;
    }
    const remembered = store.read() || {}, side = ALL_SIDES.includes(remembered.side) ? remembered.side : 'right';
    rec = { windowReason: side === 'window' ? 'the last side chosen in the Dock side row was a window (remembered)' : undefined, tabId, entry, page: entry.view.webContents, side, sizes: { right: undefined, bottom: undefined, left: undefined, ...(remembered.sizes || {}) }, chosen: { right: Number.isFinite(remembered.sizes?.right), bottom: Number.isFinite(remembered.sizes?.bottom), left: Number.isFinite(remembered.sizes?.left) }, size: 0, fits: true, outer: entry.targetBounds ? { ...entry.targetBounds } : null,
      status: 'loading', goal: 0, sliding: false, progress: 0, ready: false, loaded: false, noHold: true, deviceMode: undefined, afterOpen: { ...options } };
    recs.set(tabId, rec); entry.dock = rec; entry.onBounds = bounds => afterBounds(rec, bounds);
    try { build(rec, win); } catch (error) { teardown(rec); return fail('could not open: ' + (error && error.message || error)); }
    return true;
  }
  function build(rec, win) {
    const page = rec.page;
    // A DevTools Electron manages itself (a window opened the old way) would keep ours empty: it is closed first, before any listener of ours hears it go.
    try { if (page.isDevToolsOpened()) page.closeDevTools(); } catch {}
    const dev = new WebContentsView({ webPreferences: { session: page.session, spellcheck: false } });
    dev.setBackgroundColor?.(surface()); rec.dev = dev; rec.devEntry = { view: dev, layoutHold: null };
    const contents = dev.webContents; trackFocus(contents);
    if (docked(rec.side)) { win.contentView.addChildView(dev); makeDivider(rec); placeAll(rec, pageNow(rec)); } else moveToWindow(rec, { show: false });
    contents.setWindowOpenHandler(details => {
      try {
        if (TOOLBOX_URL.test(String(details.url))) {
          // A front-end opens its toolbox page by itself while it loads, device mode on or not (measured): it is only wanted while device mode is on (a page and a process for nothing otherwise), and asked for when it is turned on.
          const win = getWindow(); if (rec.status !== 'gone' && (rec.deviceMode === true || rec.toolboxAsked) && win && !win.isDestroyed()) return { action: 'allow', createWindow: options => makeToolbox(rec, options) };
          return { action: 'deny' };
        }
        if (/^https?:/i.test(details.url)) openTab(details.url);
      } catch {}
      return { action: 'deny' };
    });
    contents.on('will-navigate', event => { try { if (!String(event.url).startsWith('devtools://')) event.preventDefault(); } catch {} });
    contents.on('console-message', event => {
      const text = String(event.message ?? ''); if (!text.startsWith(HOOK_PREFIX)) return;
      let parsed; try { parsed = JSON.parse(text.slice(HOOK_PREFIX.length)); } catch { return; }
      guarded('frontend', onFrontend)(rec, parsed);
    });
    contents.on('dom-ready', () => { if (alive(contents)) contents.executeJavaScript(frontendHook()).then(() => pushSide(rec)).catch(() => {}); });
    contents.on('did-finish-load', () => { rec.loaded = true; markReady(rec); });
    contents.once('destroyed', () => { if (rec.status !== 'gone' && !rec.destroying) { rec.devGone = true; guarded('teardown', teardown)(rec, { relayout: true }); } });
    contents.on('render-process-gone', () => { if (rec.status !== 'gone') guarded('teardown', teardown)(rec, { relayout: true }); });
    page.on('devtools-closed', rec.onClosed = () => { if (rec.status !== 'gone' && !rec.closingByUs) guarded('teardown', teardown)(rec, { relayout: true }); });
    page.on('devtools-open-url', rec.onOpenUrl = (_event, url) => { try { if (/^https?:/i.test(String(url))) openTab(String(url)); } catch {} });
    page.on('did-navigate', rec.onNavigate = () => titleWindow(rec));
    page.once('destroyed', rec.onPageGone = () => { if (rec.status !== 'gone') guarded('teardown', teardown)(rec, { relayout: false }); });
    page.setDevToolsWebContents(contents);
    page.openDevTools({ mode: 'undocked', activate: false });
    rec.readyCap = clock.later(() => { rec.readyCap = null; if (rec.status === 'loading') { rec.loaded = true; begin(rec); } }, READY_CAP_MS);
  }
  /** Closes with the slide reversed (or at once when nothing is on screen). */
  function close(tabId) {
    const rec = recs.get(tabId); if (!rec || rec.status === 'gone') return false;
    if (rec.status === 'loading') { teardown(rec, { relayout: true }); return true; }
    if (rec.status === 'closing') return true;
    rec.status = 'closing'; onChange(tabId, false); endDrag(rec);
    if (!docked(rec.side) || !rec.fits || !rec.entry.view.getVisible() || motionScale() <= 0 || holding(rec)) { teardown(rec, { relayout: true, refocus: true }); return true; }
    if (motion.canHoldLayout(rec.devEntry) && rec.outer) motion.holdLayout(rec.devEntry, g().finalLayoutSize(rec.outer, rec.side, rec.size, captionInset(rec.outer)));
    setVisible(rec.divider, false); startSlide(rec, 0);
    return true;
  }
  const toggle = (tabId, options) => { const rec = recs.get(tabId); return rec && rec.status !== 'closing' && rec.status !== 'gone' ? close(tabId) : open(tabId, options); };
  function finish(rec) { if (rec.status === 'gone') return; teardown(rec, { relayout: true, refocus: true }); }

  /** Everything the dock made, taken down: the views, the window, the listeners, the page's mark. Idempotent. */
  function teardown(rec, { relayout: again = false, refocus = false } = {}) {
    if (rec.status === 'gone') return; rec.status = 'gone'; rec.destroying = true;
    clock.cancel?.(rec.slideCap); clock.cancel?.(rec.readyCap); clock.cancel?.(rec.glideWait); clock.cancel?.(rec.healTimer); if (rec.drag?.timer) clock.cancel(rec.drag.timer); rec.drag = null;
    const entry = rec.entry, hadFocus = !!rec.dev && alive(rec.dev.webContents) && rec.dev.webContents.isFocused?.(); recs.delete(rec.tabId); if (hadFocus) refocus = true;
    if (entry.dock === rec) { entry.dock = null; entry.onBounds = null; entry.dockDragging = false; }
    motion.releaseLayout(rec.devEntry || { view: rec.dev }, clock);
    dropToolbox(rec);   // the page goes back to its rectangle and its corners (the layout may not move it again)
    const win = getWindow();
    for (const view of [rec.dev, rec.divider]) { if (!view) continue; try { if (win && !win.isDestroyed()) win.contentView.removeChildView(view); } catch {} try { if (rec.win && !rec.win.isDestroyed()) rec.win.contentView.removeChildView(view); } catch {} }
    const page = rec.page;
    if (alive(page)) {
      rec.closingByUs = true;
      for (const [event, fn] of [['devtools-closed', rec.onClosed], ['devtools-open-url', rec.onOpenUrl], ['did-navigate', rec.onNavigate], ['destroyed', rec.onPageGone]]) { if (fn) try { page.removeListener(event, fn); } catch {} }
      try { if (!rec.devGone) page.closeDevTools(); } catch {}
    }
    for (const view of [rec.dev, rec.divider]) { try { if (view && alive(view.webContents)) view.webContents.close(); } catch {} }
    if (rec.win && !rec.win.isDestroyed()) { dockClosed.add(rec.win); try { store.write({ window: rec.win.getBounds() }); } catch {} try { rec.win.destroy(); } catch {} }
    onChange(rec.tabId, false);
    if (again) { try { relayout(); } catch {} }
    if (refocus && alive(page) && entry.view.getVisible()) focus(page);
  }

  /** The side chosen in the front-end's own "Dock side" row (or by Ctrl/Cmd+Shift+D): right, bottom, left (docked) or window. The page and DevTools take their places at once. */
  function setSide(tabId, side) {
    const rec = recs.get(tabId); if (!rec || rec.status === 'gone' || rec.status === 'closing' || !ALL_SIDES.includes(side) || side === rec.side) return false;
    if (pageGliding(rec)) { rec.sideWanted = side; if (!rec.sideWaits) { rec.sideWaits = true; afterGlide(rec, () => { rec.sideWaits = false; const wanted = rec.sideWanted; rec.sideWanted = null; if (wanted) applySide(tabId, wanted); }); } return true; }
    return applySide(tabId, side);
  }
  function applySide(tabId, side) {
    const rec = recs.get(tabId); if (!rec || rec.status === 'gone' || rec.status === 'closing' || !ALL_SIDES.includes(side) || side === rec.side) return false;
    const from = rec.side; if (docked(from)) rec.lastDocked = from; rec.side = side; rec.auto = false; rec.windowReason = 'chosen now (the front-end\'s Dock side row or Ctrl/Cmd+Shift+D)'; rec.dividerSent = null; remember(rec); pushSide(rec);   // the person's own choice: saved
    if (side === 'window') { moveToWindow(rec); return true; }
    if (from === 'window') moveToDock(rec);
    stopSliding(rec); rec.goal = 1; rec.fits = true; endDrag(rec); sendDividerState(rec);
    // a move of DevTools to another side is placed at once: the page keeps its size and would otherwise glide sideways with DevTools coming from outside the window
    rec.entry.dockSnap = true; try { relayout(); } finally { rec.entry.dockSnap = false; }
    afterLayout();
    return true;
  }
  function moveToWindow(rec, { show = true } = {}) {
    const win = getWindow(); if (!rec.dev || !win) return;
    log('devtools dock: DevTools is going to a window of its own: ' + JSON.stringify(stateOf(rec)));
    try { win.contentView.removeChildView(rec.dev); } catch {} if (rec.divider) { try { win.contentView.removeChildView(rec.divider); } catch {} setVisible(rec.divider, false); }
    rec.goal = 0; rec.sliding = false; motion.releaseLayout(rec.devEntry, clock); endDrag(rec);
    const saved = (store.read() || {}).window || {}, bounds = { width: Math.max(480, saved.width || 900), height: Math.max(360, saved.height || 700) };
    const own = new BaseWindow({ ...bounds, ...(Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y } : {}), minWidth: 400, minHeight: 300, show: false, title: windowTitle(rec), backgroundColor: surface() });
    rec.win = own; own.contentView.addChildView(rec.dev); fitWindow(rec);
    own.on('resize', () => fitWindow(rec));
    own.on('close', () => { try { if (!dockClosed.has(own)) store.write({ window: own.getBounds() }); } catch {} });
    own.on('closed', () => { if (!dockClosed.has(own) && rec.status !== 'gone' && rec.win === own) guarded('teardown', teardown)(rec, { relayout: true, refocus: true }); });
    setVisible(rec.dev, true); if (show) showWindow(rec); relayout();
  }
  function moveToDock(rec) {
    const win = getWindow(), own = rec.win; rec.win = null;
    if (own && !own.isDestroyed()) { try { store.write({ window: own.getBounds() }); } catch {} dockClosed.add(own); try { own.contentView.removeChildView(rec.dev); } catch {} try { own.destroy(); } catch {} }
    if (!win || win.isDestroyed()) return;
    win.contentView.addChildView(rec.dev); if (!rec.divider) makeDivider(rec); else if (!win.contentView.children.includes(rec.divider)) win.contentView.addChildView(rec.divider);
    rec.outer = rec.outer || (rec.entry.targetBounds ? { ...rec.entry.targetBounds } : null); raise(rec);
  }
  const fitWindow = rec => { if (!rec.win || rec.win.isDestroyed() || !rec.dev) return; const [width, height] = rec.win.getContentSize(); rec.dev.setBounds({ x: 0, y: 0, width, height }); };
  function windowTitle(rec) { let name = ''; try { const url = new URL(rec.page.getURL()); name = url.host + (url.pathname === '/' ? '' : url.pathname); } catch {} return name ? 'DevTools - ' + name : 'DevTools'; }
  const titleWindow = rec => { if (rec.win && !rec.win.isDestroyed()) try { rec.win.setTitle(windowTitle(rec)); } catch {} };

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- the rest of the browser
  /** DevTools' contents of a tab, and whether this contents is DevTools' and on screen (the focus gate gives the keyboard only to a surface that is visible). */
  const contentsOf = tabId => { const rec = recs.get(tabId); return rec?.dev && alive(rec.dev.webContents) ? rec.dev.webContents : undefined; };
  const visibleContents = contents => { for (const rec of recs.values()) { if (rec.toolbox && rec.toolbox.view.webContents === contents) return rec.status !== 'gone' && rec.toolbox.view.getVisible(); } for (const rec of recs.values()) if (rec.dev && rec.dev.webContents === contents) return rec.status !== 'gone' && rec.dev.getVisible() && (docked(rec.side) || !!(rec.win && !rec.win.isDestroyed())); return false; };
  const ownerOf = contents => { for (const rec of recs.values()) if ((rec.dev && rec.dev.webContents === contents) || (rec.toolbox && rec.toolbox.view.webContents === contents)) return rec.tabId; return undefined; };
  return {
    open: guarded('open', open), close: guarded('close', close), toggle: guarded('toggle', toggle), setSide: guarded('side', setSide), isOpen: tabId => { const rec = recs.get(tabId); return !!rec && rec.status !== 'gone' && rec.status !== 'closing'; },
    why: () => failure,
    has: tabId => recs.has(tabId), trim, refresh, afterLayout, ownerOf, contentsOf, visibleContents,
    /** Every view the docks have in the browser window (the interface floating over the pages goes above these too). */
    views: () => { const list = []; for (const rec of recs.values()) if (docked(rec.side)) for (const view of [rec.dev, rec.divider]) if (view) list.push(view); return list; },
    /** A tab that has DevTools open never goes to sleep. */
    protects: tabId => recs.has(tabId),
    /** The tab's page is going away (closing the tab, putting it to sleep by force): its DevTools go first. */
    forget: tabId => { const rec = recs.get(tabId); if (rec) guarded('teardown', teardown)(rec, { relayout: false }); },
    closeAll: () => { for (const rec of [...recs.values()]) guarded('teardown', teardown)(rec, { relayout: false }); },
    /** The appearance or the accent changed. */
    restyle: () => { for (const rec of recs.values()) { rec.dividerSent = null; sendDividerState(rec); try { rec.dev?.setBackgroundColor?.(surface()); } catch {} } },
    /** Test and diagnostics: the dock's state of a tab. */
    state: tabId => { const rec = recs.get(tabId); return rec ? { status: rec.status, side: rec.side, size: rec.size, progress: rec.progress, sliding: rec.sliding, goal: rec.goal, sizes: { ...rec.sizes }, windowed: !!rec.win, outer: rec.outer && { ...rec.outer }, target: rec.entry.targetBounds && { ...rec.entry.targetBounds }, page: rec.entry.view.getBounds(), gliding: !!rec.entry.boundsTimer, deviceMode: rec.deviceMode, toolbox: rec.toolbox ? { ready: rec.toolbox.ready, hole: rec.toolbox.hole } : null, holed: !!rec.holed, drag: !!rec.drag, dragging: !!rec.entry.dockDragging } : null; },
  };
}

module.exports = { createDevtoolsDock, frontendHook, toolboxHook, HOOK_PREFIX, DIVIDER_PAGE, DIVIDER_PRELOAD, TOOLBOX_URL };
