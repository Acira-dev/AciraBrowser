'use strict';
// Secured workspaces (R3-38, docs/launch/SECURED_WORKSPACES.md row 11): a page in a secured workspace never puts its own words in a
// notification. Registered only on secured sessions (main.cjs configureSession). The page's Notification and
// ServiceWorkerRegistration.showNotification are replaced, before any page script runs, by ones that tell main only "this tab has a
// notification" (no title, no body, no icon); main shows one neutral line while the workspace is unlocked and nothing while it is locked
// (secured-workspaces.cjs notify). Chromium's own notifications are refused for these sessions (permission-engine.cjs), so a page that
// reaches an untouched Notification (a fresh frame, a service worker) gets an error event and Windows shows nothing.
const {ipcRenderer, contextBridge} = require('electron');
if (/^https?:/.test(location.href)) {
  try {
    const listeners = new Map();
    ipcRenderer.on('acira:secured-notification-event', (_event, token, type) => { const fire = listeners.get(token); if (fire && (type === 'click' || type === 'close')) { try { fire(type); } catch { /* the page's handler threw */ } if (type === 'close') listeners.delete(token); } });
    const show = (token, silent) => { try { ipcRenderer.send('acira:secured-notification', {token: String(token).slice(0, 64), silent: silent === true}); } catch { /* a closing frame */ } };
    const permission = () => { try { const state = ipcRenderer.sendSync('acira:permission-state', 'notifications'); return state === 'granted' ? 'granted' : state === 'prompt' ? 'default' : 'denied'; } catch { return 'denied'; } };
    const subscribe = (token, fire) => { if (listeners.size < 200) listeners.set(String(token).slice(0, 64), fire); };
    contextBridge.executeInMainWorld({
      func: function (show, permission, subscribe) {
        const Original = window.Notification;
        if (typeof Original !== 'function') return;
        const askPermission = Original.requestPermission.bind(Original), tokens = new WeakMap();
        let counter = 0;
        const fireOn = (target, type) => { const event = new Event(type); target.dispatchEvent(event); const handler = target['on' + type]; if (typeof handler === 'function') handler.call(target, event); };
        class Notification extends EventTarget {
          constructor(title, options) {
            super();
            if (arguments.length < 1) throw new TypeError("Failed to construct 'Notification': 1 argument required, but only 0 present.");
            const o = options && typeof options === 'object' ? options : {};
            for (const [key, value] of [['title', String(title)], ['body', o.body == null ? '' : String(o.body)], ['tag', o.tag == null ? '' : String(o.tag)], ['icon', o.icon == null ? '' : String(o.icon)], ['data', o.data ?? null], ['silent', o.silent ?? null], ['requireInteraction', o.requireInteraction === true], ['dir', o.dir || 'auto'], ['lang', o.lang || '']]) Object.defineProperty(this, key, {value, enumerable: true});
            this.onclick = null; this.onshow = null; this.onerror = null; this.onclose = null;
            const token = 'n' + (++counter) + '-' + Math.random().toString(36).slice(2, 10);
            tokens.set(this, token);
            if (permission() !== 'granted') { setTimeout(() => fireOn(this, 'error'), 0); return; }
            subscribe(token, type => fireOn(this, type));
            show(token, o.silent === true);
            setTimeout(() => fireOn(this, 'show'), 0);
          }
          close() { const token = tokens.get(this); if (token) { tokens.delete(this); setTimeout(() => fireOn(this, 'close'), 0); } }
          static get permission() { return permission(); }
          static requestPermission(callback) { return askPermission(callback); }
          static get maxActions() { return 0; }
        }
        Object.defineProperty(window, 'Notification', {configurable: true, writable: true, enumerable: false, value: Notification});
        try {
          const proto = window.ServiceWorkerRegistration && window.ServiceWorkerRegistration.prototype;
          if (proto) {
            Object.defineProperty(proto, 'showNotification', {configurable: true, writable: true, value: function showNotification(title, options) {
              if (permission() !== 'granted') return Promise.reject(new TypeError('No notification permission has been granted for this origin.'));
              show('sw' + (++counter), !!(options && options.silent === true));
              return Promise.resolve();
            }});
            Object.defineProperty(proto, 'getNotifications', {configurable: true, writable: true, value: function getNotifications() { return Promise.resolve([]); }});
          }
        } catch (error) { /* no service workers in this frame */ }
      },
      args: [show, permission, subscribe],
    });
  } catch { /* A closing frame: the engine's refusal still stands. */ }
}
