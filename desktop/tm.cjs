'use strict';
/** The main process's messages in the interface language (Settings › Languages; "system" follows Windows).
 *  `tm('area.id', { name })` for menus, toasts and dialogs built in desktop/*.cjs; the catalogs are bundled into ./i18n.cjs. */
let language, bundle = null;
function setLanguage(setting) { language = setting; }
function tm(id, params) {
  bundle ??= require('./i18n.cjs');
  let system = 'en'; try { system = require('electron').app.getLocale() || 'en'; } catch { /* not running inside Electron (unit tests): English */ }
  bundle.setMainLocale(language, system);
  return bundle.tm(id, params);
}
module.exports = { tm, setLanguage };
