'use strict';
// The computer is shutting down, restarting or logging the person off (Windows), or about to shut down (Linux, macOS).
// An ordinary quit saves every window at before-quit (main.cjs beginQuit), but a session that ends does not go through a quit:
// Electron emits no before-quit for it on Windows, and the process is ended a moment after the event. A change that was still
// waiting for its 400 ms debounce (a tab just closed, a page just opened) would then be lost, and the next start would bring
// it back. So the event writes what is waiting, now and in this call, because nothing runs after it.
//
// The events can come more than once: Windows tells every window of the app, and the shutdown notice can come on top of that.
// Each call is safe to repeat: a window is written in full the first time it is seen; after that only a change that is still
// waiting is written, so a second or twelfth call costs nothing and loses nothing.
//
// Hooks (main.cjs): a window's 'session-end' (Windows; the session cannot be stopped once it fires) and powerMonitor's
// 'shutdown' (Linux and macOS; the app does not ask to delay it, since all it needs is this write).

/**
 * @param {object} options
 * @param {()=>Iterable<{save:()=>any,flushSave?:()=>any}>} options.getControllers the windows that are open
 * @param {()=>void} [options.begin] the list of open windows stops following the windows that close from here (open-windows.cjs begin)
 * @param {()=>void} [options.flushSecured] writes what the secured workspaces keep (synchronous)
 * @param {(message:string)=>void} [options.warn]
 */
function createSessionEnd({ getControllers, begin = () => {}, flushSecured = () => {}, warn = message => console.warn(message) }) {
  const written = new WeakSet();
  let calls = 0;

  /** Writes every window. Returns how many windows were written in full and how many only had a waiting change written. */
  function flush(reason = 'session-end') {
    calls += 1;
    const result = { reason, full: 0, pending: 0, failed: 0 };
    // the three steps are independent: one failing never stops the others, because the process may be gone right after this
    try { begin(); } catch (error) { warn('Session end (open windows): ' + error.message); }
    try { flushSecured(); } catch (error) { warn('Session end (secured): ' + error.message); }
    let controllers;
    try { controllers = [...getControllers()]; } catch (error) { warn('Session end (windows): ' + error.message); controllers = []; }
    for (const controller of controllers) {
      try {
        if (!written.has(controller)) { controller.save(); written.add(controller); result.full += 1; }
        else if (typeof controller.flushSave === 'function' && controller.flushSave()) result.pending += 1;
      } catch (error) { result.failed += 1; warn('Session end (save): ' + error.message); }
    }
    return result;
  }

  return { flush, get calls() { return calls; } };
}

module.exports = { createSessionEnd };
