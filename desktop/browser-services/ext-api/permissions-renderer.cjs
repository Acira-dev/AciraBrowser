'use strict';
// chrome.permissions in extension pages and service workers (WP4). Every Chromium member exists; argument checks and Chromium's
// errors come from acira.build over the schema; behaviour is answered by ext-api/permissions.cjs in the main process.
// This function is copied into the preload as text: it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['permissions'],
  renderer(acira) {
    // permissions.request needs a user gesture (PermissionsRequestFunction::Run, first check): the page's transient user activation.
    // A service worker has no activation of its own; Chromium carries one in with gesture events (action click, command, menu item),
    // which Acira cannot see here, so a worker's request goes to the prompt, which is itself the user's decision.
    const gesture = () => {
      if (acira.isWorker) return true;
      const activation = typeof navigator === 'object' && navigator ? navigator.userActivation : undefined;
      return !!(activation && activation.isActive);
    };
    return {
      permissions: {
        factory: () => acira.build('permissions', {
          functions: {
            getAll: () => acira.call('permissions.getAll')(),
            contains: permissions => acira.call('permissions.contains')(permissions),
            request: permissions => (gesture()
              ? acira.call('permissions.request')(permissions)
              : Promise.reject(new Error('This function must be called during a user gesture'))),
            remove: permissions => acira.call('permissions.remove')(permissions)
          },
          events: {
            onAdded: acira.event('permissions.onAdded'),
            onRemoved: acira.event('permissions.onRemoved')
          }
        })
      }
    };
  }
};
