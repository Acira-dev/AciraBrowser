// Registered first: counts every synchronous question the other preloads of this frame ask the main process, and reports them once the document is parsed.
const {ipcRenderer} = require('electron'), names = [], ask = ipcRenderer.sendSync.bind(ipcRenderer);
ipcRenderer.sendSync = (channel, ...args) => { names.push(channel); return ask(channel, ...args); };
document.addEventListener('DOMContentLoaded', () => setTimeout(() => { try { ipcRenderer.send('fixture:syncs', {main: process.isMainFrame, href: location.href, names}); } catch { /* closing */ } }, 100));
