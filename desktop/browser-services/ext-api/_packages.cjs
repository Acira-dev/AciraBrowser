'use strict';
// The list of Chrome extension API work packages, written out so the release bundle can follow it.
//
// Until 13.8 the loader (index.cjs loadPackages) found the packages by reading this folder and require()d each file by a name it had just read. A bundler
// cannot follow a require() whose argument is only known at run time, and the release builds bundle the main process into ONE file whose __dirname points at a
// folder that does not exist (scripts/desktop-bundle.mjs rewriteDirname): the folder read failed inside a try/catch and every package was silently left out of
// the packaged Mac and Windows apps. Here every package file is required by its literal name, so the bundler follows each one, once, together with the
// modules they share (request-pipeline.cjs, surfaces/active-tab.cjs, atomic-file.cjs, ...): a module has one instance in the bundle.
//
// Adding a package: add its file(s) here, in sorted order. tests/ext-api-package-list.test.cjs fails when this list and the folder disagree, and the release
// builds (scripts/desktop-bundle.mjs checkBundledPackages) fail when a package is missing from the bundle.
// The functions keep the loading lazy: nothing is required until loadPackages() asks (a package may require ./index.cjs for its helpers).

/** Every top-level package file of this folder (index.cjs and files starting with '_' are not packages), sorted. */
const FILES = Object.freeze([
    'action-renderer.cjs',
    'action.cjs',
    'capture-renderer.cjs',
    'commands-renderer.cjs',
    'commands.cjs',
    'context-menus-renderer.cjs',
    'context-menus.cjs',
    'cookies-renderer.cjs',
    'cookies.cjs',
    'debugger-renderer.cjs',
    'downloads-renderer.cjs',
    'downloads.cjs',
    'extension-renderer.cjs',
    'history-renderer.cjs',
    'history.cjs',
    'identity-renderer.cjs',
    'identity.cjs',
    'idle-renderer.cjs',
    'idle.cjs',
    'management-renderer.cjs',
    'management.cjs',
    'notifications-renderer.cjs',
    'notifications.cjs',
    'offscreen-renderer.cjs',
    'permissions-renderer.cjs',
    'permissions.cjs',
    'privacy-renderer.cjs',
    'privacy.cjs',
    'proxy-renderer.cjs',
    'proxy.cjs',
    'runtime-renderer.cjs',
    'runtime.cjs',
    'scripting-renderer.cjs',
    'scripting.cjs',
    'side-panel-renderer.cjs',
    'side-panel.cjs',
    'storage-renderer.cjs',
    'storage.cjs',
    'system-renderer.cjs',
    'system.cjs',
    'tab-groups-renderer.cjs',
    'tabs-renderer.cjs',
    'tabs.cjs',
    'web-navigation-renderer.cjs',
    'web-navigation.cjs',
    'web-request-renderer.cjs',
    'web-request.cjs',
    'windows-renderer.cjs',
    'windows.cjs'
]);

/** The modules by file name, required by their literal names. */
function modules() {
  return {
    'action-renderer.cjs'         : require('./action-renderer.cjs'),
    'action.cjs'                  : require('./action.cjs'),
    'capture-renderer.cjs'        : require('./capture-renderer.cjs'),
    'commands-renderer.cjs'       : require('./commands-renderer.cjs'),
    'commands.cjs'                : require('./commands.cjs'),
    'context-menus-renderer.cjs'  : require('./context-menus-renderer.cjs'),
    'context-menus.cjs'           : require('./context-menus.cjs'),
    'cookies-renderer.cjs'        : require('./cookies-renderer.cjs'),
    'cookies.cjs'                 : require('./cookies.cjs'),
    'debugger-renderer.cjs'       : require('./debugger-renderer.cjs'),
    'downloads-renderer.cjs'      : require('./downloads-renderer.cjs'),
    'downloads.cjs'               : require('./downloads.cjs'),
    'extension-renderer.cjs'      : require('./extension-renderer.cjs'),
    'history-renderer.cjs'        : require('./history-renderer.cjs'),
    'history.cjs'                 : require('./history.cjs'),
    'identity-renderer.cjs'       : require('./identity-renderer.cjs'),
    'identity.cjs'                : require('./identity.cjs'),
    'idle-renderer.cjs'           : require('./idle-renderer.cjs'),
    'idle.cjs'                    : require('./idle.cjs'),
    'management-renderer.cjs'     : require('./management-renderer.cjs'),
    'management.cjs'              : require('./management.cjs'),
    'notifications-renderer.cjs'  : require('./notifications-renderer.cjs'),
    'notifications.cjs'           : require('./notifications.cjs'),
    'offscreen-renderer.cjs'      : require('./offscreen-renderer.cjs'),
    'permissions-renderer.cjs'    : require('./permissions-renderer.cjs'),
    'permissions.cjs'             : require('./permissions.cjs'),
    'privacy-renderer.cjs'        : require('./privacy-renderer.cjs'),
    'privacy.cjs'                 : require('./privacy.cjs'),
    'proxy-renderer.cjs'          : require('./proxy-renderer.cjs'),
    'proxy.cjs'                   : require('./proxy.cjs'),
    'runtime-renderer.cjs'        : require('./runtime-renderer.cjs'),
    'runtime.cjs'                 : require('./runtime.cjs'),
    'scripting-renderer.cjs'      : require('./scripting-renderer.cjs'),
    'scripting.cjs'               : require('./scripting.cjs'),
    'side-panel-renderer.cjs'     : require('./side-panel-renderer.cjs'),
    'side-panel.cjs'              : require('./side-panel.cjs'),
    'storage-renderer.cjs'        : require('./storage-renderer.cjs'),
    'storage.cjs'                 : require('./storage.cjs'),
    'system-renderer.cjs'         : require('./system-renderer.cjs'),
    'system.cjs'                  : require('./system.cjs'),
    'tab-groups-renderer.cjs'     : require('./tab-groups-renderer.cjs'),
    'tabs-renderer.cjs'           : require('./tabs-renderer.cjs'),
    'tabs.cjs'                    : require('./tabs.cjs'),
    'web-navigation-renderer.cjs' : require('./web-navigation-renderer.cjs'),
    'web-navigation.cjs'          : require('./web-navigation.cjs'),
    'web-request-renderer.cjs'    : require('./web-request-renderer.cjs'),
    'web-request.cjs'             : require('./web-request.cjs'),
    'windows-renderer.cjs'        : require('./windows-renderer.cjs'),
    'windows.cjs'                 : require('./windows.cjs')
  };
}

module.exports = {FILES, modules};
