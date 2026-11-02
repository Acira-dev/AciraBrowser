// Extension page (options) of the P3 live check: its own view of storage and extension.* (the service worker has its own copy in sw.js).
const report = (name, data) => fetch(P3.server + '/report?name=' + encodeURIComponent(name), {method: 'POST', body: JSON.stringify(data === undefined ? null : data)}).catch(() => {});
const attempt = async run => { try { return {ok: await run()}; } catch (error) { return {error: String(error && error.message || error)}; } };
(async () => {
  const out = {};
  out.syncSet = await attempt(() => chrome.storage.sync.set({pageKey: 'from page', n: 1}));
  out.syncGetFromPage = await attempt(() => chrome.storage.sync.get(null));
  out.localGet = await attempt(() => chrome.storage.local.get(null));
  out.getViews = await attempt(() => chrome.extension.getViews({type: 'tab'}).length);
  out.isAllowedFileSchemeAccess = await attempt(() => new Promise(resolve => chrome.extension.isAllowedFileSchemeAccess(resolve)));
  out.isAllowedIncognitoAccess = await attempt(() => chrome.extension.isAllowedIncognitoAccess());
  out.inIncognitoContext = chrome.extension.inIncognitoContext;
  report('a.page', out);
})();
