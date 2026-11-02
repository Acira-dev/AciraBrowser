'use strict';
// chrome.action in extension pages and service workers (work package P8). The function below is copied into the preload as text:
// it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['action'],
  renderer(acira) {
    return {
      action: {
        factory: () => {
          const call = name => acira.call('action.' + name);
          const isImage = value => !!value && typeof value === 'object' && typeof value.width === 'number' && typeof value.height === 'number' && 'data' in value;
          // ImageData cannot cross to the main process as an object with methods: raw RGBA goes, the main process makes the PNG.
          const wire = value => (isImage(value) ? {width: value.width, height: value.height, data: value.data} : value);
          const functions = {};
          for (const name of ['setTitle', 'getTitle', 'setPopup', 'getPopup', 'setBadgeText', 'getBadgeText', 'setBadgeBackgroundColor', 'getBadgeBackgroundColor',
            'setBadgeTextColor', 'getBadgeTextColor', 'enable', 'disable', 'isEnabled', 'getUserSettings', 'openPopup']) functions[name] = call(name);
          // A relative icon path is relative to the script or page that calls (Dark Reader's worker in background/ says '../icons/x.png'), and an
          // extension may give its own address in full (Tampermonkey): the main process wants the path from the extension's root.
          const fromRoot = value => {
            if (typeof value !== 'string') return value;
            try {
              const url = new URL(value, location.href);
              if (url.protocol === 'chrome-extension:' && url.hostname === acira.extensionId) return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
            } catch (error) { /* leave it as given */ }
            return value;
          };
          functions.setIcon = details => {
            const copy = Object.assign({}, details);
            if (typeof copy.path === 'string') copy.path = fromRoot(copy.path);
            else if (copy.path && typeof copy.path === 'object') copy.path = Object.fromEntries(Object.entries(copy.path).map(entry => [entry[0], fromRoot(entry[1])]));
            const image = copy.imageData;
            if (image !== undefined && image !== null) {
              copy.imageData = isImage(image) ? wire(image) : Object.fromEntries(Object.entries(image).map(entry => [entry[0], wire(entry[1])]));
            }
            return call('setIcon')(copy);
          };
          return acira.build('action', {
            functions,
            // The engine sends one click event for both chrome.action and chrome.browserAction.
            events: {onClicked: acira.event('browserAction.onClicked'), onUserSettingsChanged: acira.event('action.onUserSettingsChanged')}
          });
        }
      }
    };
  }
};
