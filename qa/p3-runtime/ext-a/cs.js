// Content script of the P3 live check. The test runner puts Acira's storage.sync shim first in its js list (as for a store package), so this reads and
// writes the extension's sync area from a web page, sees local data without the sync data, and hears sync changes made elsewhere (the worker, an extension page).
(async () => {
  const report = (name, data) => fetch(P3.server + '/report?name=' + encodeURIComponent(name), {method: 'POST', body: JSON.stringify(data === undefined ? null : data)}).catch(() => {});
  const attempt = async run => { try { return {ok: await run()}; } catch (error) { return {error: String(error && error.message || error)}; } };
  const heard = [];
  chrome.storage.onChanged.addListener((changes, area) => heard.push([area, Object.keys(changes).slice(0, 4)]));
  chrome.storage.sync.onChanged.addListener(changes => heard.push(['sync-area-event', Object.keys(changes).slice(0, 4)]));
  chrome.storage.local.onChanged.addListener(changes => heard.push(['local-area-event', Object.keys(changes).slice(0, 4)]));
  const out = {shim: !!chrome.storage.sync.__acira, constants: [chrome.storage.sync.QUOTA_BYTES, chrome.storage.sync.QUOTA_BYTES_PER_ITEM, chrome.storage.sync.MAX_ITEMS]};
  out.write = await attempt(() => chrome.storage.sync.set({fromCs: 'content script', n: 1}));
  out.tooBig = await attempt(() => chrome.storage.sync.set({big: 'x'.repeat(9000)}));
  out.callbackForm = await new Promise(resolve => chrome.storage.sync.get('fromCs', (...args) => resolve({args, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message})));
  out.syncNow = await attempt(() => chrome.storage.sync.get(null));
  out.localNow = await attempt(() => chrome.storage.local.get(null));
  out.localKeys = await attempt(() => chrome.storage.local.getKeys());
  await new Promise(resolve => setTimeout(resolve, 30000));
  out.heard = heard;
  out.syncLater = await attempt(() => chrome.storage.sync.get(null));
  report('cs.report', out);
})();
