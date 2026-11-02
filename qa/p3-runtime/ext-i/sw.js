// Install/update test extension of qa/p3-installed-live.mjs: reports every runtime.onInstalled it receives, and every start of its worker.
importScripts('config.js');
const report = (name, data) => fetch(P3.server + '/report?name=' + encodeURIComponent(name), {method: 'POST', body: JSON.stringify(data === undefined ? null : data)}).catch(() => {});
chrome.runtime.onInstalled.addListener(details => {
  report('i.onInstalled', {details, version: chrome.runtime.getManifest().version});
  // What most extensions do here: defaults and a context menu. A menu created now must exist afterwards.
  chrome.storage.local.set({defaultsFrom: details.reason});
  chrome.contextMenus.create({id: 'p3-install-menu', title: 'P3 install menu', contexts: ['page']}, () => { void chrome.runtime.lastError; });
});
chrome.runtime.onStartup.addListener(() => report('i.onStartup', true));
report('i.started', {version: chrome.runtime.getManifest().version});
