'use strict';
// The picker's layer page (desktop/zap-layer.html) can tell main what the person did (pointer, wheel, keys, click) and receive what to draw. Nothing else.
const {contextBridge, ipcRenderer} = require('electron');
const KINDS = new Set(['ready', 'move', 'leave', 'commit', 'level', 'stop', 'undo', 'scroll', 'menu']);
contextBridge.exposeInMainWorld('zapLayer', {
  command: message => {
    if (!message || typeof message.type !== 'string' || !KINDS.has(message.type)) return;
    const clean = {type: message.type};
    if (Number.isFinite(message.x)) clean.x = message.x;
    if (Number.isFinite(message.y)) clean.y = message.y;
    if (message.delta === 1 || message.delta === -1) clean.delta = message.delta;
    if ([1, -1, 2, -2].includes(message.dir)) clean.dir = message.dir;
    if (message.keys === true) clean.keys = true;
    if (message.type === 'menu') clean.open = message.open === true;
    ipcRenderer.send('acira:zap-layer', clean);
  },
  onState: listener => { ipcRenderer.on('acira:zap-layer-state', (_event, state) => listener(state)); },
});
