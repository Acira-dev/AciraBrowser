'use strict';
// QA-only trusted chrome surface; never injected into a website or extension.
if(location.protocol==='acira-extension-qa:'&&location.hostname==='chrome')require('electron-chrome-extensions/browser-action').injectBrowserAction();
