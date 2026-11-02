'use strict';
// chrome.contextMenus in extension pages and service workers (work package P8). The function below is copied into the preload as text:
// it may use only `acira` and the page's globals.
module.exports = {
  namespaces: ['contextMenus'],
  renderer(acira) {
    return {
      contextMenus: {
        factory: () => {
          const manifest = acira.manifest || {};
          const background = manifest.background || {};
          // An event page or a service worker may be stopped at any time: its items need ids it chose itself and no onclick function.
          const lazy = acira.isWorker || manifest.manifest_version === 3 || background.persistent === false;
          const callbacks = Object.create(null);
          let counter = 1 + Math.floor(Math.random() * 900000), listening = false;
          const onClicked = acira.event('contextMenus.onClicked');
          const listen = () => {
            if (listening) return;
            listening = true;
            onClicked.addListener((info, tab) => { const callback = callbacks[info.menuItemId]; if (callback) callback(info, tab); });
          };
          // onclick is a function: it stays here, the main process gets the item without it.
          const strip = (id, props) => {
            const clean = Object.assign({}, props);
            if (typeof clean.onclick === 'function') {
              if (lazy) throw new Error('Extensions using event pages or Service Workers cannot pass an onclick parameter to chrome.contextMenus.create. Instead, use the chrome.contextMenus.onClicked event.');
              callbacks[id] = clean.onclick; listen();
            }
            delete clean.onclick;
            return clean;
          };
          return acira.build('contextMenus', {
            functions: {
              create: props => {
                let id = props.id;
                if (id === undefined || id === null) {
                  if (lazy) throw new Error('Extensions using event pages or Service Workers must pass an id parameter to chrome.contextMenus.create');
                  id = counter++;
                }
                const clean = strip(id, props);
                clean.id = id;
                return acira.later(id, acira.call('contextMenus.create')(clean));
              },
              update: (id, props) => acira.call('contextMenus.update')(id, strip(id, props || {})),
              remove: id => acira.call('contextMenus.remove')(id).then(value => { delete callbacks[id]; return value; }),
              removeAll: () => acira.call('contextMenus.removeAll')().then(value => { for (const key of Object.keys(callbacks)) delete callbacks[key]; return value; })
            },
            events: { onClicked }
          });
        }
      }
    };
  }
};
