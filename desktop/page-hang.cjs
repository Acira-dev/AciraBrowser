'use strict';
// A page stuck in an endless loop. Its own process runs everything for it, Stop, Reload and the next address included, so a stuck page
// held the tab for good (only closing the tab helped). Two ways out, as in Chrome:
//  - Electron says 'unresponsive' when the page has not answered for a while: the person is asked "This page isn't responding"
//    (Wait / Close page). The question goes away when the page answers again. Close page ends the page's process, so the tab shows its
//    error page and can be reloaded.
//  - Stop, Reload or a new address on a page that then gives no answer for a few seconds ends the page's process and repeats the action.
const PROBE_MS = 4000;

function createPageHang({ask, onChange = () => {}, waiting = () => false, setTimer = setTimeout, probeMs = PROBE_MS} = {}) {
  const probes = new WeakMap();
  const end = wc => { try { if (!wc.isDestroyed()) wc.forcefullyCrashRenderer(); } catch { /* Already gone. */ } };

  /** Listens to one page. ask({contents, host, stale}) resolves true for Close page; stale() turns true once the page answers again. */
  function watch(wc, {host = () => ''} = {}) {
    let stuck = false;
    wc.on('unresponsive', () => {
      if (stuck || wc.isDestroyed()) return;
      stuck = true;
      Promise.resolve(ask({contents: wc, host: host(), stale: () => !stuck || wc.isDestroyed()})).then(close => {
        if (close && stuck) end(wc);
        stuck = false; // Wait: the next 'unresponsive' asks again
      }, () => { stuck = false; });
    });
    wc.on('responsive', () => { if (!stuck) return; stuck = false; onChange(); });
  }

  /** After Stop, Reload or a new address: when the page that was showing has not answered within probeMs, end its process and run
   *  redo (the action again) once it is gone. A page that answers, or another document that took its place, is left alone. */
  function recover(wc, redo) {
    if (!wc || wc.isDestroyed() || waiting(wc)) return; // a page showing its own alert() waits for the person, it is not stuck
    const frame = wc.mainFrame;
    if (!frame) return;
    const process = frame.processId, routing = frame.routingId, probe = {answered: false};
    probes.set(wc, probe);
    try { Promise.resolve(frame.executeJavaScript('0')).then(() => { probe.answered = true; }, () => { probe.answered = true; }); } catch { return; }
    setTimer(() => {
      if (probes.get(wc) !== probe) return; // a later action watches now
      probes.delete(wc);
      if (probe.answered || wc.isDestroyed() || waiting(wc)) return;
      const now = wc.mainFrame;
      if (!now || now.processId !== process || now.routingId !== routing) return;
      if (typeof redo === 'function') wc.once('render-process-gone', () => setTimer(() => { if (!wc.isDestroyed()) redo(); }, 0));
      end(wc);
    }, probeMs);
  }

  return {watch, recover};
}

module.exports = {createPageHang, PROBE_MS};
