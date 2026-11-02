// Receiver extension of the P3 live check (qa/p3-runtime-live.mjs): answers external messages and connections, reports to the QA server.
importScripts('config.js');
const report = (name, data) => fetch(P3.server + '/report?name=' + encodeURIComponent(name), {method: 'POST', body: JSON.stringify(data === undefined ? null : data)}).catch(() => {});
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  report('b.onMessageExternal', {message, sender: {id: sender.id, url: sender.url, origin: sender.origin, tab: !!sender.tab}});
  sendResponse({ok: true, echo: message, from: 'B'});
});
chrome.runtime.onConnectExternal.addListener(port => {
  report('b.onConnectExternal', {name: port.name, sender: {id: port.sender && port.sender.id, url: port.sender && port.sender.url}});
  port.onMessage.addListener(message => { port.postMessage({pong: message}); report('b.port.message', message); });
  port.onDisconnect.addListener(() => report('b.port.disconnect', true));
});
let internal = 0;
chrome.runtime.onMessage.addListener(() => { internal += 1; });
chrome.runtime.onUpdateAvailable.addListener(details => report('b.onUpdateAvailable', details));
report('b.started', {id: chrome.runtime.id});
