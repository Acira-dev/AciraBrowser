'use strict';
// Bundle this entry (or import it into the bundled browser UI preload).
// The public management bridge is never installed in a website/extension frame.
if(location.protocol==='acira-browser-ui:'&&location.hostname==='ui'&&location.pathname==='/index.html')require('electron-chrome-extensions/browser-action').injectBrowserAction();
