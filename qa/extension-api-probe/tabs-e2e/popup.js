// What a toolbar popup does first: ask for the active tab of its window. Reported to the QA server (the popup is a real one, hosted by the window).
const base = '__BASE__';
(async () => {
  const out = {};
  try {
    out.query = (await chrome.tabs.query({active: true, currentWindow: true})).map(tab => ({id: tab.id, url: tab.url, windowId: tab.windowId}));
    out.lastFocused = (await chrome.tabs.query({active: true, lastFocusedWindow: true})).map(tab => tab.id);
  } catch (error) { out.error = String(error && error.message || error); }
  fetch(base + '/popup-report', {method: 'POST', body: JSON.stringify(out)}).catch(() => {});
})();
