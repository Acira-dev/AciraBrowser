// Offscreen document (reason USER_MEDIA): records the tab stream id the worker hands it.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'offscreen-ping') { sendResponse({pong: true, getManifest: typeof chrome.runtime.getManifest === 'function', id: chrome.runtime.id}); return false; }
  if (message.type !== 'offscreen-record') return false;
  streamFor('tab', message.streamId).then(record).then(result => sendResponse({result}), error => sendResponse({error: String(error && error.message || error)}));
  return true;
});
