'use strict';
// Real-runtime check of fingerprint protection:  electron qa/privacy-plus/farbling-check.cjs
// Two hostnames (a.test, b.test -> 127.0.0.1) read canvas, WebGL, audio and device values at level off / standard / strict.
const http = require('node:http'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, session, ipcMain } = require('electron');
app.setPath('userData', path.join(os.tmpdir(), 'acira-farble-' + process.pid));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.test 127.0.0.1');
app.on('window-all-closed', () => { });
process.on('uncaughtException', e => process.stderr.write('uncaught ' + e.stack + '\n'));
const { createFarbling } = require('../../desktop/browser-services/fingerprint-farbling.cjs');
const PAGE = `<!doctype html><canvas id=c width=220 height=60></canvas><canvas id=g width=64 height=64></canvas><script>
const sha=async b=>{let h=2166136261;const u=new Uint8Array(b.buffer||b);for(let i=0;i<u.length;i++){h^=u[i];h=Math.imul(h,16777619)>>>0;}return h.toString(16);};
window.result=(async()=>{const out={};
const c=document.getElementById('c'),x=c.getContext('2d');x.fillStyle='#e8a';x.fillRect(0,0,220,60);x.fillStyle='#246';x.font='20px sans-serif';x.fillText('Acira fingerprint 123',8,36);x.strokeStyle='rgba(10,200,50,.6)';x.beginPath();x.arc(150,30,22,0,6.28);x.stroke();
out.dataUrl=await sha(new TextEncoder().encode(c.toDataURL()));
const img=x.getImageData(0,0,220,60);out.imageData=await sha(img.data);
const g=document.getElementById('g').getContext('webgl');g.clearColor(.3,.6,.9,1);g.clear(g.COLOR_BUFFER_BIT);const px=new Uint8Array(64*64*4);g.readPixels(0,0,64,64,g.RGBA,g.UNSIGNED_BYTE,px);out.webgl=await sha(px);
const ac=new OfflineAudioContext(1,44100,44100),o=ac.createOscillator();o.type='triangle';o.frequency.value=10000;const comp=ac.createDynamicsCompressor();o.connect(comp);comp.connect(ac.destination);o.start();const buf=await ac.startRendering();const ch=buf.getChannelData(0);let sum=0;for(let i=4500;i<5000;i++)sum+=Math.abs(ch[i]);out.audio=sum.toFixed(10);
out.hw=navigator.hardwareConcurrency;out.mem=navigator.deviceMemory;out.langs=navigator.languages.length;
out.native=Function.prototype.toString.call(HTMLCanvasElement.prototype.toDataURL);out.ok=true;
try{const hi=await navigator.userAgentData.getHighEntropyValues(['architecture','bitness','platformVersion','fullVersionList']);out.hints=JSON.stringify(hi).slice(0,160);}catch(e){out.hints='n/a '+e.message}
return out;})();</script>`;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(PAGE); });
async function read(level, host, port, fresh) {
  const ses = session.fromPartition('f-' + level + '-' + Math.random());
  const farble = createFarbling({ sessionKey: fresh || Buffer.alloc(32, 7), getLevel: () => level });
  ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, '..', '..', 'desktop', 'browser-services', 'farbling-preload.cjs') });
  const handler = event => { try { event.returnValue = farble.scriptFor(event.sender.getURL(), event.senderFrame.url); } catch { event.returnValue = ''; } };
  ipcMain.removeAllListeners('acira:farbling'); ipcMain.on('acira:farbling', handler);
  const win = new BrowserWindow({ x: -2600, y: 0, width: 600, height: 400, show: true, webPreferences: { session: ses, sandbox: true } });
  await win.loadURL(`http://${host}:${port}/`);
  const result = await win.webContents.executeJavaScript('window.result');
  win.destroy(); return result;
}
app.whenReady().then(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port, rows = {};
  for (const level of ['off', 'standard', 'strict']) { rows[level + '@a'] = await read(level, 'a.test', port); rows[level + '@a again'] = await read(level, 'a.test', port); rows[level + '@b'] = await read(level, 'b.test', port); }
  rows['standard@a new session'] = await read('standard', 'a.test', port, Buffer.alloc(32, 9));
  for (const [k, v] of Object.entries(rows)) console.error(k.padEnd(24), JSON.stringify({ dataUrl: v.dataUrl, imageData: v.imageData, webgl: v.webgl, audio: v.audio, hw: v.hw, mem: v.mem, langs: v.langs }));
  console.error('native toString:', rows['standard@a'].native); console.error('hints standard:', rows['standard@a'].hints); console.error('hints off:', rows['off@a'].hints);
  const same = (a, b, k) => rows[a][k] === rows[b][k];
  const verdict = { offStable: ['dataUrl', 'imageData', 'webgl', 'audio'].every(k => same('off@a', 'off@b', k)), standardChangesCanvas: !same('off@a', 'standard@a', 'dataUrl') && !same('off@a', 'standard@a', 'imageData') && !same('off@a', 'standard@a', 'webgl') && !same('off@a', 'standard@a', 'audio'), standardStableWithinSite: ['dataUrl', 'imageData', 'webgl', 'audio', 'hw', 'mem'].every(k => same('standard@a', 'standard@a again', k)), standardDiffersAcrossSites: !same('standard@a', 'standard@b', 'dataUrl') && !same('standard@a', 'standard@b', 'imageData') && !same('standard@a', 'standard@b', 'audio'), standardDiffersAcrossSessions: !same('standard@a', 'standard@a new session', 'dataUrl'), nativeToString: /\[native code\]/.test(rows['standard@a'].native), strictDropsLanguages: rows['strict@a'].langs <= 1 };
  console.error('VERDICT ' + JSON.stringify(verdict)); app.exit(0);
});
