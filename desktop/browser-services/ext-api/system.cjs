'use strict';
// chrome.system.display (P9), from Electron's screen module. Chromium's implementation needs a DisplayInfoProvider that Electron never
// creates (every call answered "System display API is not available."); Chrome on desktop reports every monitor with its geometry and
// scale, never lets an extension change the layout (that is ChromeOS only), and tells listeners when monitors come, go or change.
// The other system.* namespaces: system.cpu / system.memory are Chromium's own, system.storage is answered in extension-apis.cjs.
const FRONT = {top: 0, left: 0, right: 0, bottom: 0};
const rect = r => ({left: Math.round(r.x), top: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)});

/** Chrome's DisplayUnitInfo for one Electron display. */
function unitInfo(display, primaryId) {
  const dpi = 96 * (Number(display.scaleFactor) || 1);
  return {
    id: String(display.id),
    name: String(display.label || ''),
    mirroringSourceId: '',
    mirroringDestinationIds: [],
    isPrimary: display.id === primaryId,
    isInternal: !!display.internal,
    isEnabled: true,
    activeState: 'active',
    isUnified: false,
    dpiX: dpi,
    dpiY: dpi,
    rotation: [0, 90, 180, 270].includes(display.rotation) ? display.rotation : 0,
    bounds: rect(display.bounds),
    overscan: {...FRONT},
    workArea: rect(display.workArea),
    modes: [],
    hasTouchSupport: display.touchSupport === 'available',
    hasAccelerometerSupport: display.accelerometerSupport === 'available',
    availableDisplayZoomFactors: [],
    displayZoomFactor: 1
  };
}

/** The list for getInfo: the primary monitor first, the others in the system's order (as Chrome does). */
function listDisplays(screen) {
  const primaryId = screen.getPrimaryDisplay().id, all = screen.getAllDisplays();
  const ordered = [...all.filter(d => d.id === primaryId), ...all.filter(d => d.id !== primaryId)];
  return ordered.map(d => unitInfo(d, primaryId));
}

module.exports = {
  namespaces: ['system.display'],
  unitInfo,
  listDisplays,
  install(api) {
    const screen = () => require('electron').screen;
    api.handle('system.display.getInfo', () => listDisplays(screen()));
    // Only ChromeOS kiosk apps and Chrome's own pages get the layout; on desktop the list is empty.
    api.handle('system.display.getDisplayLayout', () => []);
    // onDisplayChanged: no arguments, once per burst of changes (a monitor change reports several events).
    let timer = null, detach = () => {};
    const changed = () => {
      if (timer || !api.listening('system.display.onDisplayChanged').length) return;
      timer = setTimeout(() => { timer = null; api.broadcast('system.display.onDisplayChanged'); }, 100);
      timer.unref?.();
    };
    try {
      const s = screen(), names = ['display-added', 'display-removed', 'display-metrics-changed'];
      for (const name of names) s.on(name, changed);
      detach = () => { for (const name of names) s.removeListener(name, changed); };
    } catch { /* no screen module (tests) */ }
    return {dispose() { clearTimeout(timer); detach(); }};
  }
};
