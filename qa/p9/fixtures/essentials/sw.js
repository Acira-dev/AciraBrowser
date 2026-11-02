// The same identity calls from the service worker (the usual place for a sign-in), driven by probe.js through runtime messages.
const fail = error => ({error: String(error && error.message || error)});
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      if (message.type === 'worker-flow') return sendResponse({url: await chrome.identity.launchWebAuthFlow({url: message.url, interactive: message.interactive})});
      if (message.type === 'worker-token') return sendResponse({token: await chrome.identity.getAuthToken({interactive: !!message.interactive})});
      if (message.type === 'worker-redirect') return sendResponse({url: chrome.identity.getRedirectURL(message.path)});
    } catch (error) { sendResponse(fail(error)); }
  })();
  return true;
});
