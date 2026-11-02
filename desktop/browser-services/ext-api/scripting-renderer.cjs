'use strict';
// chrome.scripting in extension pages and service workers (work package P8, activeTab). The function below is copied into the preload as text:
// it may use only `acira` and the page's globals. An extension with the activeTab permission asks the main process first whether the person just used
// the extension on this tab (a toolbar click, its command or a menu item) and, if so, the code runs there; otherwise Chromium's own executeScript /
// insertCSS answer as before.
module.exports = {
  namespaces: ['scripting'],
  renderer(acira) {
    return {
      scripting: {
        factory: base => {
          const prepareScript = details => {
            const out = {target: details.target, world: details.world === 'MAIN' ? 'MAIN' : 'ISOLATED'};
            if (typeof details.func === 'function') out.source = '(' + details.func.toString() + ')(...' + JSON.stringify(details.args || []) + ')';
            else if (Array.isArray(details.files)) out.files = details.files.slice();
            return out;
          };
          const prepareCss = details => ({target: details.target, origin: details.origin, css: details.css, files: Array.isArray(details.files) ? details.files.slice() : undefined});
          const wrap = (name, handler, prepare) => function (details, callback) {
            const native = () => (base && typeof base[name] === 'function' ? Promise.resolve().then(() => base[name](details)) : Promise.reject(new Error('Cannot access contents of the page.')));
            const askMain = acira.has('activeTab') && !!details && typeof details === 'object' && !!details.target && Number.isInteger(details.target.tabId);
            const promise = askMain ? acira.call(handler)(prepare(details)).then(answer => (answer && answer.unavailable === true ? native() : answer)) : native();
            if (typeof callback === 'function') {
              promise.then(value => callback(value), error => acira.withLastError(String(error && error.message || error), () => callback()));
              return undefined;
            }
            return promise;
          };
          return acira.extend(base, {
            executeScript: wrap('executeScript', 'scripting.activeTab.executeScript', prepareScript),
            insertCSS: wrap('insertCSS', 'scripting.activeTab.insertCSS', prepareCss)
          });
        }
      }
    };
  }
};
