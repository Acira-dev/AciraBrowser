'use strict';
// The browser window is created while the browser services (content blocking, HTTPS-only, proxy, permissions, downloads) are still
// starting, so the window's interface can load in parallel. No tab page may exist before the services are in place, and a page must never
// load without content blocking, HTTPS-only and the proxy attached. This is that rule in one place:
//  - open() is called once, when every service exists; fail() when one could not be created (the gate then stays shut for good).
//  - ready resolves on open() and rejects on fail(); assertOpen(what) throws unless open.
function createServicesGate() {
  let opened = false, failure = null, resolve, reject;
  const ready = new Promise((ok, bad) => { resolve = ok; reject = bad; });
  ready.catch(() => {});
  return {
    ready,
    get isOpen() { return opened; },
    get failure() { return failure; },
    open() { if (opened || failure) return false; opened = true; resolve(); return true; },
    fail(error) { if (opened || failure) return false; failure = error instanceof Error ? error : new Error(String(error || 'Browser services could not start')); reject(failure); return true; },
    assertOpen(what = 'This') { if (!opened) throw new Error(`${what} needs the browser services, which are not ready${failure ? `: ${failure.message}` : ' yet'}`); },
  };
}

module.exports = {createServicesGate};
