'use strict';
// Runs before any page script in every frame of a website session. Chromium answers "may I?" questions (Notification.permission,
// navigator.permissions.query) from the browser's yes/no check, so a question nobody has answered yet reads "denied" and sites that
// look first never ask. Here those answers are corrected to "default" / "prompt" until the person has actually decided; the live
// answer always comes from the main process (this file only asks and reports).
const {ipcRenderer, contextBridge} = require('electron');
if (process.isMainFrame && /^https?:/.test(location.href)) {
  try {
    const read = name => { try { const state = ipcRenderer.sendSync('acira:permission-state', String(name)); return state === 'granted' || state === 'prompt' ? state : 'denied'; } catch { return 'denied'; } };
    contextBridge.executeInMainWorld({
      func: function (read) {
        const queryable = {notifications: 1, geolocation: 1, camera: 1, microphone: 1, midi: 1, 'clipboard-read': 1, 'idle-detection': 1};
        try {
          const descriptor = Object.getOwnPropertyDescriptor(Notification, 'permission');
          if (descriptor && descriptor.get) {
            const patched = {get permission() { const state = read('notifications'); return state === 'prompt' ? 'default' : state; }};
            Object.defineProperty(Notification, 'permission', {configurable: true, enumerable: descriptor.enumerable, get: Object.getOwnPropertyDescriptor(patched, 'permission').get});
          }
        } catch (error) { /* A page without Notification has nothing to correct. */ }
        try {
          const original = Permissions.prototype.query;
          const patched = {query(descriptor) {
            const name = descriptor && descriptor.name;
            const result = original.apply(this, arguments);
            if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(queryable, name)) return result;
            return result.then(status => { try { Object.defineProperty(status, 'state', {configurable: true, get: () => read(name)}); } catch (error) { /* Leave the engine's answer. */ } return status; });
          }};
          Object.defineProperty(Permissions.prototype, 'query', {configurable: true, writable: true, enumerable: true, value: patched.query});
        } catch (error) { /* No Permissions API in this frame. */ }
      },
      args: [read],
    });
  } catch { /* A closing frame. */ }
}
