// The command loop lives in page.html (a page never stops). The worker runs what Chrono Download Manager's worker runs to open its manager,
// in the worker context, and reports to the QA server: windows.getCurrent(callback), tabs.query, tabs.create with an extension page.
const base = '__BASE__';
const report = body => fetch(base + '/sw-report', {method: 'POST', body: JSON.stringify(body)}).catch(() => {});
chrome.runtime.onInstalled.addListener(() => {});
(async () => {
  const out = {};
  try {
    out.getCurrentCallback = await new Promise(resolve => chrome.windows.getCurrent(function (w) { resolve({id: w && w.id, lastError: chrome.runtime.lastError ? chrome.runtime.lastError.message : null}); }));
    out.getCurrentPromise = (await chrome.windows.getCurrent()).id;
    out.queryCurrent = (await chrome.tabs.query({currentWindow: true})).length;
    const created = await chrome.tabs.create({active: false, url: chrome.runtime.getURL('blank.html?fromWorker=1')});
    out.created = {id: created.id, url: created.url, windowId: created.windowId};
    out.found = (await chrome.tabs.query({url: chrome.runtime.getURL('blank.html') + '*'})).map(t => t.id);
    await chrome.tabs.remove(created.id);
  } catch (error) { out.error = String(error && error.message || error); }
  await report(out);
})();
