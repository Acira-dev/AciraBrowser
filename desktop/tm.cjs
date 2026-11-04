'use strict';
/** The main process's messages in the interface language (Settings › Languages; "system" follows Windows).
 *  `tm('area.id', { name })` for menus, toasts and dialogs built in desktop/*.cjs; the catalogs are bundled into ./i18n.cjs. */
let language, bundle = null;
function setLanguage(setting) { language = setting; }
function inUse() {
  bundle ??= require('./i18n.cjs');
  let system = 'en'; try { system = require('electron').app.getLocale() || 'en'; } catch { /* not running inside Electron (unit tests): English */ }
  bundle.setMainLocale(language, system);
  return bundle;
}
function tm(id, params) { return inUse().tm(id, params); }
/** The message `text` was made from by tm() (src/i18n/said.ts): a toast main writes as text keeps its id, so a language change shows it in the new language. */
function said(text) { return inUse().saidAs(text); }
module.exports = { tm, said, setLanguage };
