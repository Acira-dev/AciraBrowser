// Worker of qa/p3-worker-events.mjs: logs every storage.onChanged it hears (root and per-area), makes its own writes shortly after it starts, and reports each
// event to the QA server as it arrives. No popup, options page or any other extension page exists in this run.
importScripts('config.js');
const report = (name, data) => fetch(P3.server + '/report?name=' + encodeURIComponent(name), {method: 'POST', body: JSON.stringify(data === undefined ? null : data)}).catch(() => {});
chrome.storage.onChanged.addListener((changes, area) => report('w.event', {via: 'root', area, changes}));
chrome.storage.local.onChanged.addListener(changes => report('w.event', {via: 'local-area', area: 'local', changes}));
chrome.storage.sync.onChanged.addListener(changes => report('w.event', {via: 'sync-area', area: 'sync', changes}));
chrome.storage.session.onChanged.addListener(changes => report('w.event', {via: 'session-area', area: 'session', changes}));
report('w.started', {id: chrome.runtime.id});
setTimeout(async () => {
  // (a) the worker's own writes
  await chrome.storage.local.set({ownLocal: 1});
  await chrome.storage.sync.set({ownSync: 1});
  await chrome.storage.session.set({ownSession: 1});
  await chrome.storage.local.set({ownLocal: 2});
  report('w.ownWritesDone', true);
}, 2500);
