// Content script of qa/p3-worker-events.mjs (Acira's storage shim is put first, as for a store package): (b) writes the extension's local and sync storage.
(async () => {
  const report = (name, data) => fetch(P3.server + '/report?name=' + encodeURIComponent(name), {method: 'POST', body: JSON.stringify(data === undefined ? null : data)}).catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 1500));
  await chrome.storage.local.set({csLocal: 'x'});
  await chrome.storage.sync.set({csSync: 'y'});
  await chrome.storage.local.set({csLocal: 'z'});
  await chrome.storage.local.remove('csLocal');
  report('w.csDone', {shim: !!chrome.storage.sync.__acira});
})();
