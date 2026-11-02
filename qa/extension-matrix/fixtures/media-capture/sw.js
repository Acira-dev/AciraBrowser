// The worker side of the capture probe: remembers the toolbar click, hands tab stream ids to an offscreen document (reason USER_MEDIA),
// and keeps the tabCapture.onStatusChanged events it saw.
const statuses = [];
let clicked = null;
chrome.action.onClicked.addListener(tab => { clicked = tab.id; });
chrome.tabCapture.onStatusChanged.addListener(info => statuses.push({tabId: info.tabId, status: info.status}));
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'statuses') { sendResponse({statuses, clicked}); return false; }
  if (message.type === 'offscreen-ping') { (async () => { try { if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument(); await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: message.reasons, justification: 'ping'}); const reply = await chrome.runtime.sendMessage({type: 'offscreen-ping'}); const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']}); await chrome.offscreen.closeDocument(); sendResponse({reply, contexts: contexts.length}); } catch (error) { sendResponse({error: String(error && error.message || error)}); } })(); return true; }
  if (message.type !== 'record-in-offscreen') return false;
  (async () => {
    try {
      const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: message.targetTabId});
      if (!(await chrome.offscreen.hasDocument())) await chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['USER_MEDIA', 'DISPLAY_MEDIA'], justification: 'Record the tab'});
      const result = await chrome.runtime.sendMessage({type: 'offscreen-record', streamId});
      await chrome.offscreen.closeDocument();
      sendResponse(result);
    } catch (error) { sendResponse({error: String(error && error.message || error)}); }
  })();
  return true;
});
