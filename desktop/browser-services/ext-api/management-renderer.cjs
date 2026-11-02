'use strict';
// chrome.management in extension pages and service workers (WP4). Chromium binds the namespace for every extension and gives the ones
// without the "management" permission three members only: getSelf, uninstallSelf and getPermissionWarningsByManifest. The same here:
// the namespace is always built, and the permissioned members are hidden (and reappear if the permission is granted later).
// This function is copied into the preload as text: it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['management'],
  renderer(acira) {
    const NEEDS_PERMISSION = ['get', 'getAll', 'getPermissionWarningsById', 'setEnabled', 'uninstall', 'launchApp', 'createAppShortcut',
      'setLaunchType', 'generateAppForLink', 'onInstalled', 'onUninstalled', 'onEnabled', 'onDisabled'];
    // A confirmation dialog needs a user gesture (ManagementUninstallFunctionBase::Uninstall): the page's transient activation. A service
    // worker has none of its own (Chromium carries one in with gesture events Acira cannot see here); there the dialog itself is the user's decision.
    const gesture = () => {
      if (acira.isWorker) return true;
      const activation = typeof navigator === 'object' && navigator ? navigator.userActivation : undefined;
      return !!(activation && activation.isActive);
    };
    const GESTURE_ERROR = 'chrome.management.uninstall requires a user gesture.';
    // Another extension's removal always shows the dialog; the caller's own only when it passes showConfirmDialog: true.
    const needsDialog = (id, options) => id !== acira.extensionId || !!(options && options.showConfirmDialog === true);
    return {
      management: {
        // Always built: getSelf / uninstallSelf exist for every extension.
        gate: () => true,
        factory: base => {
          const passThrough = {};
          for (const name of ['getPermissionWarningsByManifest']) {
            if (base && typeof base[name] === 'function') passThrough[name] = (...args) => base[name](...args);
          }
          const built = acira.build('management', {
            functions: {
              ...passThrough,
              getAll: () => acira.call('management.getAll')(),
              get: id => acira.call('management.get')(id),
              getSelf: () => acira.call('management.getSelf')(),
              setEnabled: (id, enabled) => acira.call('management.setEnabled')(id, enabled),
              uninstall: (id, options) => (needsDialog(id, options) && !gesture()
                ? Promise.reject(new Error(GESTURE_ERROR))
                : acira.call('management.uninstall')(id, options)),
              uninstallSelf: options => (needsDialog(acira.extensionId, options) && !gesture()
                ? Promise.reject(new Error(GESTURE_ERROR))
                : acira.call('management.uninstallSelf')(options))
            }
          });
          const hidden = key => typeof key === 'string' && NEEDS_PERMISSION.includes(key) && !acira.has('management');
          // A proxy over an empty target, so the answers can change when the permission is granted or removed.
          return new Proxy({}, {
            get: (target, key) => (hidden(key) ? undefined : built[key]),
            has: (target, key) => (hidden(key) ? false : key in built),
            ownKeys: () => Reflect.ownKeys(built).filter(key => !hidden(key)),
            getOwnPropertyDescriptor: (target, key) => {
              if (hidden(key)) return undefined;
              const descriptor = Reflect.getOwnPropertyDescriptor(built, key);
              return descriptor ? {...descriptor, configurable: true} : undefined;
            },
            set: (target, key, value) => { built[key] = value; return true; },
            defineProperty: () => false,
            deleteProperty: () => false
          });
        }
      }
    };
  }
};
