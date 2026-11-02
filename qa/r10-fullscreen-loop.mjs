// Round 10: close a tab that is in HTML fullscreen, repeatedly, and report whether the app survives (and how it ends if it does not).
//   node qa/native-slot.mjs r10-fs-loop -- node qa/r10-fullscreen-loop.mjs
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep} from './d-harness.mjs';
const root = '.qa-profiles/r10-fullscreen-loop'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>t</title><button id=fs onclick="document.documentElement.requestFullscreen()" style="width:300px;height:200px">go</button><video id=v></video>'); });
const base = `http://127.0.0.1:${fx.port}/`, cap = (p, ms = 6000) => Promise.race([p, sleep(ms).then(() => 'HUNG')]);
const app = await startApp({root}); const proc = app.app.process(); let exited = null; proc.on('exit', (code, signal) => { exited = {code, signal}; });
/** The main process stopped answering: ask its inspector where it is (a JS loop shows its frames; a native wait shows none). */
async function stack() {
  const url = /ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+/.exec(app.logs.join(''))?.[0]; if (!url) return console.log('no inspector url');
  const ws = new WebSocket(url); await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const paused = new Promise(r => { ws.onmessage = m => { const d = JSON.parse(m.data); if (d.method === 'Debugger.paused') r(d.params.callFrames); }; });
  ws.send(JSON.stringify({id: 1, method: 'Debugger.enable'})); ws.send(JSON.stringify({id: 2, method: 'Debugger.pause'}));
  const frames = await Promise.race([paused, sleep(4000).then(() => null)]);
  console.log(frames ? frames.slice(0, 12).map(f => `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.location.lineNumber + 1}:${f.location.columnNumber}`).join('\n') : 'inspector did not pause (native block)');
}
try {
  for (let i = 0; i < 6 && !exited; i++) {
    await app.act({type: 'tab.new', url: base + '?' + i}); const page = await app.waitWeb(base + '?' + i); await sleep(400);
    await page.click('#fs'); await sleep(700);
    const id = (await app.state()).tabs.at(-1).id;
    const closed = await cap(app.act({type: 'tab.close', id}).then(() => 'ok', e => 'ERR ' + String(e.message).slice(0, 60)));
    await sleep(600);
    const win = await cap(app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => w.isFullScreen())).catch(e => 'ERR ' + String(e.message).slice(0, 60)));
    if (win === 'HUNG') { await stack(); break; }
    console.log('round', i, 'close', closed, 'win', JSON.stringify(win), 'exited', JSON.stringify(exited));
  }
} finally { console.log(app.logs.join('').split('\n').filter(l => l.trim() && !/MaxListeners|trace-warnings/.test(l)).slice(-12).join('\n')); await Promise.race([app.close(), sleep(5000)]); await fx.close(); process.exit(0); }
