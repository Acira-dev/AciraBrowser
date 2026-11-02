'use strict';
// R8 edge intent: is a native menu or dialog open? The sidebar and top bar must not come up under one (a right-click menu over a
// page, a file picker, a message box): the pointer is busy with it, and a reveal would move the page under the menu's target.
// Electron has no "a menu is open" query, so the two entry points are wrapped once and counted. Each entry expires after
// MAX_MS so a menu or dialog whose close event never arrives cannot block the edges for good.
const MAX_MS = 120_000;
const DIALOGS = ['showMessageBox', 'showOpenDialog', 'showSaveDialog', 'showCertificateTrustDialog'];
const open = new Map();   // token -> started at
let installed = false, nextToken = 1;

const begin = () => { const token = nextToken++; open.set(token, Date.now()); return token; };
const end = token => { open.delete(token); };

function install({ dialog, Menu } = {}) {
  if (installed) return;
  installed = true;
  for (const name of DIALOGS) {
    const original = dialog?.[name];
    if (typeof original !== 'function') continue;
    dialog[name] = function (...args) {
      const token = begin();
      let result;
      try { result = original.apply(this, args); } catch (error) { end(token); throw error; }
      if (result && typeof result.then === 'function') return result.finally(() => end(token));
      end(token);
      return result;
    };
  }
  const popup = Menu?.prototype?.popup;
  if (typeof popup === 'function') {
    Menu.prototype.popup = function (...args) {
      const token = begin();
      const done = () => end(token);
      try { this.once?.('menu-will-close', done); } catch { /* an older Menu: the expiry covers it */ }
      try { return popup.apply(this, args); } catch (error) { done(); throw error; }
    };
  }
}

/** True while a native menu or dialog opened through Electron is showing. */
function isOpen(now = Date.now()) {
  for (const [token, at] of open) if (now - at > MAX_MS) open.delete(token);
  return open.size > 0;
}

module.exports = { install, isOpen, MAX_MS };
