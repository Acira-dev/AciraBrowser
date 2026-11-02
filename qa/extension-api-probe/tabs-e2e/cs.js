// Answers tabs.sendMessage from the extension page, so the e2e can prove messaging still reaches a real page after chrome.tabs was rebuilt.
chrome.runtime.onMessage.addListener((message, sender, send) => { send({pong: message && message.ping, url: location.href}); });
// A content script's own message: the extension page records sender.tab (built by Electron, not by chrome.tabs).
chrome.runtime.sendMessage({hi: location.href}).catch(() => {});
