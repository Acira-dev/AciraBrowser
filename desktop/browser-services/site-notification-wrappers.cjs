'use strict';
// 14.3, site notifications in Acira's own panel. The two main-world wrappers, kept apart from
// their preloads so a test can run each on a fake global (tests/site-notifications.test.cjs). Each is handed to contextBridge.executeInMainWorld,
// which copies the function's own source into the page or worker: it must use nothing from this file but its arguments.
//
// pageWrapper(show, permission, subscribe): a page's `Notification` and `ServiceWorkerRegistration.prototype.showNotification` become ones that hand
//   main the title, the body, the tag and the silent flag as TEXT (main keeps them in memory only and shows them in the panel), and fire the page's own
//   show / click / close events when main says so. Without the site's permission they fail as Chromium's do (an error event, a rejected promise).
// workerWrapper(send, register): a service worker's `self.registration.showNotification` (the way most mail and chat sites notify; Electron draws
//   nothing for it today) hands main the same, and a click in the panel reaches the worker as its own `notificationclick` event.

/** In a page (every frame of an ordinary or private window; never Tor, whose wrapped prototypes would be a mark; a secured workspace has its own). */
function pageWrapper(show, permission, subscribe) {
  const target = typeof window === 'object' && window ? window : globalThis;
  const Original = target.Notification;
  if (typeof Original !== 'function') return false;
  const askPermission = typeof Original.requestPermission === 'function' ? Original.requestPermission.bind(Original) : () => Promise.resolve('denied');
  const tokens = new WeakMap(), text = (value, max) => (value == null ? '' : String(value)).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max);
  let counter = 0;
  const fireOn = (note, type) => { const event = new Event(type); note.dispatchEvent(event); const handler = note['on' + type]; if (typeof handler === 'function') { try { handler.call(note, event); } catch (error) { setTimeout(() => { throw error; }, 0); } } };
  const fresh = (prefix) => prefix + (++counter) + '-' + Math.random().toString(36).slice(2, 10);
  class Notification extends EventTarget {
    constructor(title, options) {
      super();
      if (arguments.length < 1) throw new TypeError("Failed to construct 'Notification': 1 argument required, but only 0 present.");
      const o = options && typeof options === 'object' ? options : {};
      for (const [key, value] of [['title', String(title)], ['body', o.body == null ? '' : String(o.body)], ['tag', o.tag == null ? '' : String(o.tag)], ['icon', o.icon == null ? '' : String(o.icon)], ['data', o.data ?? null], ['silent', o.silent ?? null], ['requireInteraction', o.requireInteraction === true], ['dir', o.dir || 'auto'], ['lang', o.lang || '']]) Object.defineProperty(this, key, {value, enumerable: true});
      this.onclick = null; this.onshow = null; this.onerror = null; this.onclose = null;
      const token = fresh('n');
      tokens.set(this, token);
      if (permission() !== 'granted') { setTimeout(() => fireOn(this, 'error'), 0); return; }
      subscribe(token, type => fireOn(this, type));
      show({token, kind: 'page', title: text(title, 200), body: text(o.body, 600), tag: text(o.tag, 120), silent: o.silent === true});
      setTimeout(() => fireOn(this, 'show'), 0);
    }
    close() { const token = tokens.get(this); if (token) { tokens.delete(this); show({token, kind: 'close'}); setTimeout(() => fireOn(this, 'close'), 0); } }
    static get permission() { return permission(); }
    static requestPermission(callback) { return askPermission(callback); }
    static get maxActions() { return 0; }
  }
  Object.defineProperty(target, 'Notification', {configurable: true, writable: true, enumerable: false, value: Notification});
  try {
    const proto = target.ServiceWorkerRegistration && target.ServiceWorkerRegistration.prototype;
    if (proto) {
      Object.defineProperty(proto, 'showNotification', {configurable: true, writable: true, value: function showNotification(title, options) {
        if (arguments.length < 1) return Promise.reject(new TypeError("Failed to execute 'showNotification': 1 argument required, but only 0 present."));
        if (permission() !== 'granted') return Promise.reject(new TypeError('No notification permission has been granted for this origin.'));
        const o = options && typeof options === 'object' ? options : {};
        show({token: fresh('r'), kind: 'registration', title: text(title, 200), body: text(o.body, 600), tag: text(o.tag, 120), silent: o.silent === true});
        return Promise.resolve();
      }});
      Object.defineProperty(proto, 'getNotifications', {configurable: true, writable: true, value: function getNotifications() { return Promise.resolve([]); }});
    }
  } catch (error) { /* no service workers in this frame */ }
  return true;
}

/** In a service worker (ordinary and private sessions; never Tor or a secured workspace). `register(fire)` hands the preload this worker's own dispatcher:
 *  main calls it when the panel's row is pressed, and the worker gets its `notificationclick` (a script-made event: a site that needs the press itself,
 *  for clients.openWindow, falls back to main, which brings the site's tab forward or opens it). */
function workerWrapper(send, register, ask) {
  const scope = globalThis;
  const proto = scope.ServiceWorkerRegistration && scope.ServiceWorkerRegistration.prototype;
  if (!proto) return false;
  const text = (value, max) => (value == null ? '' : String(value)).replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, max);
  // the site's permission as main has it for the worker's origin (a worker's own Notification.permission reads 'denied' in Electron whatever the site
  // was allowed); without main's answer, the engine's
  const permission = () => { if (typeof ask === 'function') return Promise.resolve(ask()).then(state => state, () => 'denied'); try { return Promise.resolve(scope.Notification ? scope.Notification.permission : 'denied'); } catch (error) { return Promise.resolve('denied'); } };
  const notes = new Map();
  let counter = 0;
  register((token) => {
    const info = notes.get(token); if (!info) return false;
    const notification = {title: info.title, body: info.body, tag: info.tag, data: info.data, close() { notes.delete(token); }};
    let event;
    try { event = new scope.ExtendableEvent('notificationclick'); } catch (error) { event = new Event('notificationclick'); }
    Object.defineProperty(event, 'notification', {value: notification}); Object.defineProperty(event, 'action', {value: ''});
    try { scope.dispatchEvent(event); } catch (error) { /* the worker's handler threw */ }
    return true;
  });
  Object.defineProperty(proto, 'showNotification', {configurable: true, writable: true, value: function showNotification(title, options) {
    if (arguments.length < 1) return Promise.reject(new TypeError("Failed to execute 'showNotification': 1 argument required, but only 0 present."));
    const o = options && typeof options === 'object' ? options : {};
    let data = null; try { data = o.data === undefined ? null : JSON.parse(JSON.stringify(o.data)); } catch (error) { data = null; }
    const info = {title: String(title), body: o.body == null ? '' : String(o.body), tag: o.tag == null ? '' : String(o.tag), data};
    return permission().then(state => {
      if (state !== 'granted') throw new TypeError('No notification permission has been granted for this origin.');
      const token = 'w' + (++counter) + '-' + Math.random().toString(36).slice(2, 10);
      notes.set(token, info); if (notes.size > 100) notes.delete(notes.keys().next().value);
      send({token, kind: 'worker', title: text(info.title, 200), body: text(info.body, 600), tag: text(info.tag, 120), silent: o.silent === true});
    });
  }});
  Object.defineProperty(proto, 'getNotifications', {configurable: true, writable: true, value: function getNotifications() { return Promise.resolve([]); }});
  return true;
}

module.exports = {pageWrapper, workerWrapper};
