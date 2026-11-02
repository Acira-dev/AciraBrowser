// The offscreen document does what a worker cannot (DOMParser) and reports to the service worker over runtime messaging.
const doc = new DOMParser().parseFromString('<ul><li>one</li><li>two</li></ul>', 'text/html');
chrome.runtime.sendMessage({from: 'offscreen', items: doc.querySelectorAll('li').length, visibility: document.visibilityState, hasRuntime: typeof chrome.runtime.sendMessage});
