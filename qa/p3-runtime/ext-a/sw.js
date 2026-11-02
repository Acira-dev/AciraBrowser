// Probe extension of the P3 live check (qa/p3-runtime-live.mjs): runs the storage and runtime members of P3 in the real app and reports.
importScripts('config.js');
const report = (name, data) => fetch(P3.server + '/report?name=' + encodeURIComponent(name), {method: 'POST', body: JSON.stringify(data === undefined ? null : data)}).catch(() => {});
const attempt = async run => { try { return {ok: await run()}; } catch (error) { return {error: String(error && error.message || error)}; } };
const changes = [];
chrome.storage.onChanged.addListener((c, area) => changes.push([area, c]));
chrome.storage.sync.onChanged.addListener(c => changes.push(['sync-area-event', c]));
chrome.runtime.onUpdateAvailable.addListener(details => report('a.onUpdateAvailable', details));

async function storage() {
  const out = {};
  out.nativeLocalNull = await attempt(async () => { await chrome.storage.local.set({nullValue: null, plain: 1}); return chrome.storage.local.get(['nullValue', 'plain']); });
  out.syncNull = await attempt(async () => { await chrome.storage.sync.set({nullValue: null, undef: undefined, plain: 2}); return chrome.storage.sync.get(null); });
  out.localAfterSync = await attempt(() => chrome.storage.local.get(null));
  out.localBytes = await attempt(() => chrome.storage.local.getBytesInUse(null));
  out.syncBytes = await attempt(() => chrome.storage.sync.getBytesInUse(null));
  out.syncKeys = await attempt(() => chrome.storage.sync.getKeys());
  out.perItem = await attempt(() => chrome.storage.sync.set({big: 'x'.repeat(9000)}));
  out.total = await attempt(async () => { for (let i = 0; i < 13; i++) await chrome.storage.sync.set({['f' + i]: 'y'.repeat(8100)}); });
  out.constants = {q: chrome.storage.sync.QUOTA_BYTES, i: chrome.storage.sync.QUOTA_BYTES_PER_ITEM, m: chrome.storage.sync.MAX_ITEMS, h: chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_HOUR, p: chrome.storage.sync.MAX_WRITE_OPERATIONS_PER_MINUTE};
  out.managedSchema = await attempt(() => chrome.storage.managed.get(null));
  out.managedDefaults = await attempt(() => chrome.storage.managed.get({policyKey: 'dflt'}));
  out.managedSet = await attempt(() => chrome.storage.managed.set({a: 1}));
  out.syncClear = await attempt(() => chrome.storage.sync.clear());
  out.localAfterClear = await attempt(() => chrome.storage.local.get(null));
  out.syncAfterClear = await attempt(() => chrome.storage.sync.get(null));
  out.localClear = await attempt(async () => { await chrome.storage.sync.set({keep: 1}); await chrome.storage.local.clear(); return [await chrome.storage.local.get(null), await chrome.storage.sync.get(null)]; });
  await new Promise(resolve => setTimeout(resolve, 1500));
  out.changes = changes.map(([area, c]) => [area, Object.keys(c).length > 3 ? Object.keys(c).length + ' keys' : c]);
  return out;
}

async function runtime() {
  const out = {};
  out.setUninstallURLBad = await attempt(() => chrome.runtime.setUninstallURL('not a url'));
  out.setUninstallURLFtp = await attempt(() => chrome.runtime.setUninstallURL('ftp://example.com/'));
  out.setUninstallURLLong = await attempt(() => chrome.runtime.setUninstallURL('https://example.com/' + 'a'.repeat(1100)));
  out.setUninstallURL = await attempt(() => chrome.runtime.setUninstallURL(P3.server + '/uninstalled'));
  out.requestUpdateCheck = await attempt(() => chrome.runtime.requestUpdateCheck());
  out.getContexts = await attempt(async () => (await chrome.runtime.getContexts({contextTypes: ['BACKGROUND']})).map(c => c.contextType));
  out.getContextsBad = await attempt(() => chrome.runtime.getContexts({contextTypes: ['NOPE']}));
  out.getURL = chrome.runtime.getURL('page.js');
  out.sendMessageToBogus = await attempt(() => chrome.runtime.sendMessage('abcdefghijklmnopabcdefghijklmnop', {x: 1}));
  out.toB = await attempt(() => chrome.runtime.sendMessage(P3.b, {hello: 'from A'}));
  out.connectToB = await attempt(() => new Promise((resolve, reject) => {
    const port = chrome.runtime.connect(P3.b, {name: 'p3-port'});
    port.onMessage.addListener(message => { resolve({message, name: port.name, senderId: port.sender && port.sender.id}); port.disconnect(); });
    port.onDisconnect.addListener(() => { if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message)); });
    port.postMessage({ping: 1});
    setTimeout(() => reject(new Error('no answer from B')), 4000);
  }));
  out.optionsPageAgain = await attempt(() => chrome.runtime.openOptionsPage());
  out.getViewsInWorker = typeof chrome.extension.getViews;
  out.isAllowedFileSchemeAccess = await attempt(() => new Promise(resolve => chrome.extension.isAllowedFileSchemeAccess(resolve)));
  out.isAllowedIncognitoAccess = await attempt(() => chrome.extension.isAllowedIncognitoAccess());
  return out;
}

(async () => {
  // The options page opens first and stays open: Chromium never delivers storage.onChanged to a service worker, an open page forwards it.
  const optionsPage = await attempt(() => chrome.runtime.openOptionsPage());
  await new Promise(resolve => setTimeout(resolve, 5000));
  const result = {optionsPage, storage: await storage(), runtime: await runtime()};
  report('a.sw', result);
})();
