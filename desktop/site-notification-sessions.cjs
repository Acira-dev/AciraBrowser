'use strict';
// Site notifications: which sessions carry the two wrappers and listen for their service workers. Nothing is attached while the setting is As system
// notifications (the default): no preload, no service-worker listener, no worker IPC. In Acira attaches every known session; switching back detaches
// them all. A session whose windows are gone (a private window's) is released: detached and forgotten, so no session object is held after its end.
// Pure apart from the session objects it is given (tests/site-notifications.test.cjs drives it with stand-ins).

function createSiteNoteSessions({preloads = [], onWorkerNote = () => {}, permissionFor = () => 'denied', onRelease = () => {}} = {}) {
  const known = new Map();   // session -> {profileId, ids: preload ids, listener, workers: Map versionId -> ServiceWorkerMain (a stopped one is dropped)}
  let on = false;
  const detachWorker = sw => { try { sw.ipc?.removeAllListeners?.('acira:site-notification-worker'); } catch {} try { sw.ipc?.removeHandler?.('acira:site-notification-permission'); } catch {} };
  const attach = (ses, rec) => {
    if (rec.listener) return;
    for (const [type, filePath] of preloads) {
      try { const existing = (ses.getPreloadScripts?.() || []).find(script => script.filePath === filePath); rec.ids.push(existing ? existing.id : ses.registerPreloadScript({type, filePath})); } catch { /* that kind stays the engine's own */ }
    }
    rec.listener = details => {
      try {
        const versionId = details?.versionId; if (!Number.isSafeInteger(versionId)) return;
        if (details.runningStatus === 'stopped' || details.runningStatus === 'stopping') { const gone = rec.workers.get(versionId); if (gone) { detachWorker(gone); rec.workers.delete(versionId); } return; }
        const sw = ses.serviceWorkers.getWorkerFromVersionID?.(versionId); if (!sw || rec.workers.has(versionId) || !sw.ipc?.on) return;
        rec.workers.set(versionId, sw);
        sw.ipc.on('acira:site-notification-worker', (_event, note) => onWorkerNote(ses, sw, versionId, note));
        // the worker asks for its site's permission here: its own Notification.permission reads 'denied' in Electron
        try { sw.ipc.handle?.('acira:site-notification-permission', () => permissionFor(ses, sw)); } catch {}
      } catch {}
    };
    try { ses.serviceWorkers?.on?.('running-status-changed', rec.listener); } catch {}
  };
  const detach = (ses, rec) => {
    for (const id of rec.ids) try { ses.unregisterPreloadScript?.(id); } catch {}
    rec.ids = [];
    if (rec.listener) { try { ses.serviceWorkers?.removeListener?.('running-status-changed', rec.listener); } catch {} rec.listener = null; }
    for (const sw of rec.workers.values()) detachWorker(sw);
    rec.workers.clear();
  };
  const api = {
    /** A session the wrappers may go into (configureSession: ordinary and private, never Tor or a secured workspace). */
    add(ses, profileId = '') { if (!ses || known.has(ses)) return; const rec = {profileId: String(profileId || ''), ids: [], listener: null, workers: new Map()}; known.set(ses, rec); if (on) attach(ses, rec); },
    /** In Acira (true) or As system notifications (false): every known session follows. */
    set(value) { on = value === true; for (const [ses, rec] of known) { try { if (on) attach(ses, rec); else detach(ses, rec); } catch {} } },
    isOn: () => on,
    /** A session has ended: detached and forgotten (main also drops its click routes). */
    release(ses) { const rec = known.get(ses); if (!rec) return false; try { detach(ses, rec); } catch {} known.delete(ses); try { onRelease(ses, rec.profileId); } catch {} return true; },
    /** The profile a session belongs to ('' when unknown): a private one's start with 'private-'. */
    profileOf: ses => known.get(ses)?.profileId || '',
    workers: () => [...known.values()].reduce((n, rec) => n + rec.workers.size, 0),
    /** After a window or tab closes: every private session no open page uses any more is released. */
    sweep(inUse) { let released = 0; for (const [ses, rec] of [...known]) if (rec.profileId.startsWith('private-') && !inUse(ses)) { api.release(ses); released++; } return released; },
    size: () => known.size,
    attached: () => [...known.values()].filter(rec => rec.listener).length,
  };
  return api;
}

module.exports = {createSiteNoteSessions};
