'use strict';
// Keyboard routing as Chromium does it (13.8). Until 13.7 every browser shortcut ran from `before-input-event` and called preventDefault(): the page
// never saw the key, so a web app's own Ctrl/Cmd+K (a command palette) or Ctrl+E could never be used: Webflow's Designer got the address bar instead.
// Chromium sends only a few keys to the browser first; every other browser shortcut goes to the page, and the browser acts only if the page left it
// unhandled (did not call preventDefault on the keydown).
//
// Ported from Chromium 152 (BSD-3-Clause, Copyright The Chromium Authors); the logic and its order, in Acira's names:
//  - chrome/browser/ui/browser_command_controller.cc  BrowserCommandController::IsReservedCommandOrKey: the reserved commands, and what changes in fullscreen.
//  - chrome/browser/ui/views/frame/browser_view.cc     BrowserView::PreHandleKeyboardEvent: only a key down or up is looked at; a key that is no browser command
//    (an extension's command is "processed" by the focus manager) is the browser's at once; a reserved command is the browser's at once and the page never
//    sees it; any other browser command is NOT_HANDLED_IS_SHORTCUT: it goes to the page first. BrowserView::HandleKeyboardEvent and
//    views::UnhandledKeyboardEventHandler::HandleKeyboardEvent then run it when the page did not consume the key.
//  - content/browser/renderer_host/render_widget_host_impl.cc  ForwardKeyboardEvent (what PreHandle may answer, is_browser_shortcut) and
//    OnKeyboardEventAck: "processed" = the renderer consumed the event (the page called preventDefault); only an unprocessed key is handed to the delegate,
//    and only while the page is not hidden.
//
// What Electron changes: `before-input-event` is PreHandleKeyboardEvent (preventDefault = HANDLED), but Electron does not report the renderer's
// acknowledgement of a key. The page preload (page-input-preload.cjs) reports it: after the page's own listeners have run for a keydown it sends
// {key, code, modifiers, prevented: event.defaultPrevented}, which is the renderer's "consumed". This file holds the decision and the small waiting
// room for the acknowledgement; main.cjs runs the command when it says so. A frame that cannot acknowledge (no preload: the PDF viewer, an error page)
// keeps the old behaviour: the browser takes the key first.

const RESULT = Object.freeze({HANDLED: 'handled', NOT_HANDLED: 'not-handled', NOT_HANDLED_IS_SHORTCUT: 'not-handled-is-shortcut'});

/**
 * IsReservedCommandOrKey, in Acira's command names (desktop/shortcuts.cjs). Chromium's list:
 * IDC_CLOSE_TAB, IDC_CLOSE_WINDOW, IDC_NEW_INCOGNITO_WINDOW, IDC_NEW_TAB, IDC_NEW_WINDOW, IDC_RESTORE_TAB, IDC_SELECT_NEXT_TAB, IDC_SELECT_PREVIOUS_TAB,
 * IDC_CYCLE_TO_NEXT_TAB, IDC_CYCLE_TO_PREV_TAB, IDC_EXIT.
 */
const RESERVED = Object.freeze(new Set([
  'close-tab',       // IDC_CLOSE_TAB (Ctrl+W, Ctrl+F4)
  'close-window',    // IDC_CLOSE_WINDOW
  'private-window',  // IDC_NEW_INCOGNITO_WINDOW
  'new-tab',         // IDC_NEW_TAB
  'new-window',      // IDC_NEW_WINDOW
  'restore',         // IDC_RESTORE_TAB
  'cycle-tab',       // IDC_SELECT_NEXT_TAB / IDC_SELECT_PREVIOUS_TAB (Ctrl+PageDown / PageUp; Cmd+Shift+] / [ and Cmd+Option+arrows on a Mac)
  'tab-switcher',    // IDC_CYCLE_TO_NEXT_TAB / IDC_CYCLE_TO_PREV_TAB (Ctrl+Tab, Ctrl+Shift+Tab)
  'quit'             // IDC_EXIT
]));
/**
 * Acira keys that are not a Chromium command and must stay the browser's: recording a shortcut in Settings (the key IS the answer), and Escape while one of
 * Acira's own pop-ups is open (main.cjs already lets a page have Escape when none is). An extension's command is not a browser command in Chromium either:
 * BrowserView::PreHandleKeyboardEvent hands it to the focus manager first, so it is the browser's too (Chrome's own documentation: extension shortcuts win).
 *
 * 'zoom' (Ctrl/Cmd with + - 0, the keypad keys too) is Acira's own rule and NOT Chromium's: Chromium sends the zoom keys to the page first, so a page that calls
 * preventDefault on every keydown can stop browser zoom there. Acira never allowed that (before 13.8 every shortcut was the browser's first, and a Mac still
 * takes these keys through its application menu), and the page-zoom rendering rig ("Keyboard zoom works over an editable website that cancels page keys",
 * qa/page-zoom-rendering.mjs) holds it: a person must always be able to zoom a page back to a size they can read, whatever the page does with its keys.
 * Typing in a text box was never the cause (the page's answer for an input is the same as for any element); a page that cancels every key was.
 */
const BROWSER_FIRST = Object.freeze(new Set(['record-key', 'record-pending', 'escape', 'extension-command', 'zoom']));

/**
 * BrowserCommandController::IsReservedCommandOrKey(command_id, event). In (browser) fullscreen only leaving it is reserved: "In fullscreen, all commands
 * except for IDC_FULLSCREEN and IDC_EXIT should be delivered to the web page". On a Mac with its toolbar showing the fullscreen key is reserved too and
 * everything else falls through to the list; Acira has no such state to read, so a Mac in fullscreen keeps the list plus the fullscreen key.
 */
function isReservedCommand(command, {fullscreen = false, platform = process.platform} = {}) {
  const action = command && command.action;
  if (!action) return false;
  if (fullscreen) {
    if (platform === 'darwin') return action === 'fullscreen' || RESERVED.has(action);
    return action === 'quit' || action === 'fullscreen';
  }
  return RESERVED.has(action);
}

/**
 * BrowserView::PreHandleKeyboardEvent + RenderWidgetHostImpl::ForwardKeyboardEvent. `input` is Electron's before-input-event input; `command` what the
 * shortcut table resolved it to (null: not a browser command); `ready`: the focused frame can acknowledge a key (the page preload is running there).
 * Returns RESULT.HANDLED (the browser acts now and preventDefault() is called: the page never sees the key), RESULT.NOT_HANDLED (nothing to do:
 * the key goes to the page and nothing runs afterwards) or RESULT.NOT_HANDLED_IS_SHORTCUT (the key goes to the page; the browser runs the command
 * when the page did not consume it).
 */
function preHandleKeyboardEvent({input, command, fullscreen = false, ready = true, platform = process.platform} = {}) {
  // "Only a RawKeyDown or a KeyUp": a key's other events are not looked at (and the table resolves only a keyDown).
  if (!input || (input.type !== 'keyDown' && input.type !== 'keyUp')) return RESULT.NOT_HANDLED;
  if (!command || !command.action) return RESULT.NOT_HANDLED;
  // BrowserView registers no released accelerators, so no command is found for a key up: nothing to handle and nothing to wait for.
  if (input.type === 'keyUp') return RESULT.NOT_HANDLED;
  if (BROWSER_FIRST.has(command.action)) return RESULT.HANDLED;
  if (isReservedCommand(command, {fullscreen, platform})) return RESULT.HANDLED;
  // A frame that cannot say whether it consumed the key (no preload there) keeps the old behaviour: the browser takes it.
  return ready ? RESULT.NOT_HANDLED_IS_SHORTCUT : RESULT.HANDLED;
}

// ------------------------------------------------------------------------------------------------ the macOS application menu

/**
 * The key combinations the macOS application menu binds (desktop/platform.cjs macMenuTemplate). AppKit offers a key the page did not consume to the menu
 * item with that accelerator, so if the browser also ran the command when the page declined, the menu item would run it a second time. For those keys the
 * browser keeps taking the key first, exactly as before 13.8 (the menu item then never sees it); every key that is not in the menu (Cmd+K, Cmd+L, Cmd+F,
 * Cmd+G, Cmd+J, Cmd+O, F5, F12, ...) goes to the page first. Windows and Linux have no application menu in the packaged app.
 */
function parseAccelerator(text) {
  const parts = String(text).split('+').map(part => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  const rule = {meta: false, control: false, alt: false, shift: false, key: ''};
  for (const part of parts.slice(0, -1)) {
    const name = part.toLowerCase();
    if (['command', 'cmd', 'commandorcontrol', 'cmdorctrl', 'super', 'meta'].includes(name)) rule.meta = true;
    else if (['control', 'ctrl'].includes(name)) rule.control = true;
    else if (['alt', 'option'].includes(name)) rule.alt = true;
    else if (name === 'shift') rule.shift = true;
  }
  const last = parts[parts.length - 1];
  rule.key = last.toLowerCase() === 'plus' ? '+' : last.toLowerCase();
  return rule;
}
function menuAccelerators(template) {
  const rules = [];
  const walk = items => { for (const item of Array.isArray(items) ? items : []) { if (item && item.accelerator) { const rule = parseAccelerator(item.accelerator); if (rule) rules.push(rule); } if (item && item.submenu) walk(item.submenu); } };
  walk(template);
  return rules;
}
/** Does this key (Electron's before-input-event input; `keyOf` is desktop/shortcuts.cjs shortcutKey) match one of the menu's accelerators? */
function matchesMenuAccelerator(rules, input, keyOf) {
  if (!rules || !rules.length || !input) return false;
  const key = String(keyOf(input));
  // "Plus" is the zoom-in key: it is typed as = (the same key, Shift held or not).
  const sameKey = rule => rule.key === key || (rule.key === '+' && key === '=');
  return rules.some(rule => sameKey(rule) && rule.meta === !!input.meta && rule.control === !!input.control && rule.alt === !!input.alt && (rule.shift === !!input.shift || (rule.key === '+' && key === '=')));
}

// ------------------------------------------------------------------------------------------------ the acknowledgement

/** How long the browser waits for the page's answer before it acts anyway: a renderer that is hung or gone (Chromium waits for its hang monitor). */
const ACK_TIMEOUT_MS = 1000;

const signatureOf = input => ({
  key: String(input.key ?? ''), code: String(input.code ?? ''),
  ctrl: !!(input.control ?? input.ctrl), alt: !!input.alt, shift: !!input.shift, meta: !!input.meta, repeat: !!(input.isAutoRepeat ?? input.repeat)
});
// The physical key (`code`) is what is compared when both sides have it: the page's `key` and Electron's can be spelled differently for a dead key or an Option combination.
const sameSignature = (a, b) => (a.code && b.code ? a.code === b.code : a.key === b.key) && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta && a.repeat === b.repeat;

/**
 * The waiting room: keys that went to a page first and are waiting for its answer (OnKeyboardEventAck), and which frames can answer.
 *   ready(wc, frameKey)            a frame's preload is running: it will answer keys typed in it
 *   forgetFrames(wc)               a new document replaces the old frames (main-frame navigation, renderer gone)
 *   canAcknowledge(wc, frameKey)   may a key typed in that frame wait for its answer?
 *   defer(wc, input, run, frameKey)  hold a key: `run()` is called when the page did not consume it, or when the time is up
 *   ack(wc, payload)               the page's answer: {key, code, ctrl, alt, shift, meta, repeat, prevented}; returns 'ran' | 'consumed' | 'unknown'
 *   abandon(wc)                    the page is gone or hidden: nothing is run (OnKeyboardEventAck: only "if we are not hidden")
 * A frame that never answers (its preload died with its document) costs one wait: it is then no longer asked until it says it is ready again.
 */
function createAckRouter({setTimer = setTimeout, clearTimer = clearTimeout, timeoutMs = ACK_TIMEOUT_MS} = {}) {
  const frames = new WeakMap();   // wc -> Set(frameKey)
  const waiting = new WeakMap();  // wc -> [{signature, run, timer, frameKey}]
  const list = wc => { let found = waiting.get(wc); if (!found) { found = []; waiting.set(wc, found); } return found; };
  const frameSet = wc => { let found = frames.get(wc); if (!found) { found = new Set(); frames.set(wc, found); } return found; };
  const release = entry => { clearTimer(entry.timer); };
  return {
    ready(wc, frameKey) { frameSet(wc).add(String(frameKey)); },
    forgetFrames(wc) { frames.delete(wc); },
    canAcknowledge(wc, frameKey) { const set = frames.get(wc); return !!set && set.has(String(frameKey)); },
    defer(wc, input, run, frameKey) {
      const entry = {signature: signatureOf(input), run, timer: null, frameKey: String(frameKey ?? '')};
      entry.timer = setTimer(() => {
        const queue = list(wc), at = queue.indexOf(entry);
        if (at < 0) return;
        queue.splice(at, 1);
        if (entry.frameKey) frameSet(wc).delete(entry.frameKey); // it did not answer: ask it no more until it says it is ready
        try { run('timeout'); } catch { /* the command's own errors are not the router's */ }
      }, timeoutMs);
      entry.timer && entry.timer.unref && entry.timer.unref();
      list(wc).push(entry);
      return entry;
    },
    ack(wc, payload) {
      if (!payload || typeof payload !== 'object') return 'unknown';
      const queue = list(wc), answered = signatureOf(payload);
      const at = queue.findIndex(entry => sameSignature(entry.signature, answered));
      if (at < 0) return 'unknown';
      const [entry] = queue.splice(at, 1);
      release(entry);
      if (payload.prevented === true) return 'consumed';
      try { entry.run('ack'); } catch { /* as above */ }
      return 'ran';
    },
    abandon(wc) { const queue = list(wc); for (const entry of queue.splice(0)) release(entry); },
    pending: wc => list(wc).length
  };
}

module.exports = {RESULT, RESERVED, BROWSER_FIRST, ACK_TIMEOUT_MS, isReservedCommand, preHandleKeyboardEvent, createAckRouter, signatureOf, parseAccelerator, menuAccelerators, matchesMenuAccelerator};
