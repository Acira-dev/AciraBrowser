'use strict';
// Runs extension-popup-follow.cjs's page probe in a real Electron page on the popup-follow fixture, for each layout and state, and prints one RESULT line of JSON.
// (tests/extension-popup-follow-live.test.cjs starts this; it needs no extension: the fixture page only reads its mode from localStorage.)
const {app, BrowserWindow} = require('electron');
const path = require('node:path');
const {followScript} = require('../../../desktop/browser-services/extension-popup-follow.cjs');
const modes = JSON.parse(process.env.FOLLOW_MODES || '[]');
const VIEW = {width: 600, height: 600};   // the window the popup has when the page changes: tall, as it was for the larger state
app.whenReady().then(async () => {
  const win = new BrowserWindow({show: false, useContentSize: true, width: VIEW.width, height: VIEW.height, webPreferences: {sandbox: true, contextIsolation: true}});
  const wc = win.webContents, page = path.join(__dirname, 'popup.html');
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const out = [];
  let known = null;
  for (const mode of modes) {
    await win.loadFile(page);
    await wc.executeJavaScript(`localStorage.setItem('mode', ${JSON.stringify(mode)})`);
    await win.loadFile(page);
    win.setContentSize(VIEW.width, VIEW.height); await sleep(150);
    const read = async () => {
      const probe = await wc.executeJavaScript(followScript(known));
      if (probe && probe.rules) known = probe.rules;
      const dom = await wc.executeJavaScript('(()=>{const i=document.getElementById("inner").getBoundingClientRect(),b=document.getElementById("toggle").getBoundingClientRect();return {innerBottom:i.bottom,buttonBottom:b.bottom,ih:innerHeight}})()');
      return {probe, dom};
    };
    const a = await read();
    await wc.executeJavaScript('window.__toggle()'); await sleep(100);
    const b = await read();
    out.push({mode, a, b});
  }
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n');
  app.exit(0);
});
