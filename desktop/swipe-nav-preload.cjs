'use strict';
// The swipe arrow and list page (desktop/swipe-nav.html) only receives its own state from main and says when it is ready.
const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('swipeNav', {
  ready: () => ipcRenderer.send('acira:swipe-nav', 'ready'),
  onState: listener => { ipcRenderer.on('acira:swipe-nav-state', (_event, state) => listener(state)); },
});
