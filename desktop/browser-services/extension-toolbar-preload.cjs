'use strict';
// Bundle this entry (or import it into the bundled browser UI preload).
// The public management bridge is never installed in a website/extension frame.
// The library's listeners are given handles so they can be removed (extension-actions-bridge.cjs): through the context bridge a function is a new proxy at every call, and
// the library's own removeEventListener never matched anything (the interface printed a MaxListenersExceededWarning for -actions-update).
if(location.protocol==='acira-browser-ui:'&&location.hostname==='ui'&&location.pathname==='/index.html'){
 const {injectWithRemovableListeners}=require('./extension-actions-bridge.cjs');
 injectWithRemovableListeners(()=>require('electron-chrome-extensions/browser-action').injectBrowserAction());
}
