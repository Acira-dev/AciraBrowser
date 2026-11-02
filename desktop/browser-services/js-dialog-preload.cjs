'use strict';
// Runs before any page script in every frame of a website session. A page's alert(), confirm() and prompt() would open a system
// message box; here they ask the browser instead, and the browser answers with its own card in the page (desktop/site-prompt.cjs).
// Like the native ones they block the page until answered: the question is a synchronous message to the main process, which replies
// when the person has answered. If the browser can't show its card (a window with no interface), it replies {native: true} and
// the original function runs, so a dialog is never lost. Nothing the page passes is trusted; the main process clamps and validates it.
const {ipcRenderer, contextBridge} = require('electron');
if (process.isMainFrame && /^https?:/.test(location.href)) {
  try {
    const ask = (kind, message, initial) => {
      try {
        const reply = ipcRenderer.sendSync('acira:js-dialog', {kind: String(kind), message: String(message), initial: initial === undefined ? '' : String(initial)});
        return reply && typeof reply === 'object' ? reply : {native: true};
      } catch { return {native: true}; }
    };
    contextBridge.executeInMainWorld({
      func: function (ask) {
        const natives = {alert: window.alert, confirm: window.confirm, prompt: window.prompt};
        const install = (name, implementation) => { try { Object.defineProperty(window, name, {configurable: true, writable: true, enumerable: true, value: implementation}); } catch (error) { /* Leave the original. */ } };
        const shapes = {
          alert: {alert: function () { const reply = ask('alert', arguments.length ? arguments[0] : '', ''); if (reply && reply.native) return natives.alert.apply(window, arguments); }},
          confirm: {confirm: function () { const reply = ask('confirm', arguments.length ? arguments[0] : '', ''); if (reply && reply.native) return natives.confirm.apply(window, arguments); return reply.value === true; }},
          prompt: {prompt: function () { const reply = ask('prompt', arguments.length ? arguments[0] : '', arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : ''); if (reply && reply.native) return natives.prompt.apply(window, arguments); return typeof reply.value === 'string' ? reply.value : null; }},
        };
        for (const name of ['alert', 'confirm', 'prompt']) install(name, shapes[name][name]);
      },
      args: [ask],
    });
  } catch { /* A closing frame. */ }
}
