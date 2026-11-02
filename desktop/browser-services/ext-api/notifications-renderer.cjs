'use strict';
// chrome.notifications in extension pages and service workers (work package P8). The function below is copied into the preload as text:
// it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['notifications'],
  renderer(acira) {
    return {
      notifications: {
        factory: () => acira.build('notifications', {
          functions: {
            create: acira.call('notifications.create'),
            update: acira.call('notifications.update'),
            clear: acira.call('notifications.clear'),
            getAll: acira.call('notifications.getAll'),
            getPermissionLevel: acira.call('notifications.getPermissionLevel')
          },
          events: {
            onClicked: acira.event('notifications.onClicked'),
            onButtonClicked: acira.event('notifications.onButtonClicked'),
            onClosed: acira.event('notifications.onClosed')
          }
        })
      }
    };
  }
};
