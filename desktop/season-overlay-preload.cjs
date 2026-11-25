'use strict';
// The overlay page's only way to hear from main (Noël, desktop/season-overlay.cjs): `noel:state` in, `noel:ended` out. Nothing else is exposed.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('noelOverlay', {
  onState: (fn) => { if (typeof fn === 'function') ipcRenderer.on('noel:state', (_e, payload) => { try { fn(payload); } catch { /* the page is simple: nothing to recover */ } }); },
  ended: () => { ipcRenderer.send('noel:ended'); },
});
