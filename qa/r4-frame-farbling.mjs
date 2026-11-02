// R4-37 guard: fingerprint protection must reach every frame, not only the top document.
//   node qa/r4-frame-farbling.mjs      (cwd = worktree root; takes one native slot, isolated profile under .qa-profiles)
// One local page holds: the top document, a same-origin iframe, an iframe made by script (about:blank, the classic way to reach
// untouched canvas functions), a srcdoc iframe, and a cross-site iframe (localhost vs 127.0.0.1: its own renderer process).
// Each draws the same canvas and reports a hash. With protection Off every frame reads the true value; with Standard every frame
// must read something else. Exit code 1 when any frame reads the true value under Standard. Result 27 Oct (tabs load the farbling
// preload in iframes): all five covered, and every frame reads the same farbled value as its page (one site key, never patched twice).
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const DRAW = `function fp(win){const c=win.document.createElement('canvas');c.width=220;c.height=40;const x=c.getContext('2d');x.fillStyle='#d8a';x.fillRect(0,0,220,40);x.fillStyle='#124';x.font='18px sans-serif';x.fillText('Acira frame 123',8,26);
let h=2166136261;const s=win.HTMLCanvasElement.prototype.toDataURL.call(c);for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)>>>0;}
let a=0;try{const d=win.CanvasRenderingContext2D.prototype.getImageData.call(x,0,0,220,40).data;for(let i=0;i<d.length;i+=7)a=(a*31+d[i])>>>0;}catch{a=-1;}return h.toString(16)+'/'+a.toString(16)+'/hw'+win.navigator.hardwareConcurrency;}`;
const child = where => `<!doctype html><script>${DRAW}parent.postMessage({where:${JSON.stringify(where)},value:fp(window)},'*');</script>`;
let crossPort = 0;
const top = () => `<!doctype html><title>frames</title><body><script>${DRAW}window.results={top:fp(window)};addEventListener('message',e=>{if(e.data&&e.data.where)window.results[e.data.where]=e.data.value;});</script>
<iframe src="/child?same"></iframe><iframe srcdoc="${child('srcdoc').replace(/"/g, '&quot;')}"></iframe><iframe src="http://localhost:${crossPort}/child?cross"></iframe>
<script>const f=document.createElement('iframe');document.body.appendChild(f);window.results.scripted=fp(f.contentWindow);</script>`;
const cross = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); r.end(child('cross-site')); });
crossPort = cross.port;
const server = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); r.end(q.url.startsWith('/child') ? child('same-origin') : top()); });

async function takeSlot() { for (let round = 0; round < 40; round++) { for (const n of [1, 2, 3]) { const file = `C:/ae/slot-${n}.lock`; try { const h = await fs.open(file, 'wx'); await h.writeFile(`r4-perf frame-farbling ${new Date().toISOString()}`); await h.close(); return file; } catch (e) { if (e.code !== 'EEXIST') throw e; } } await sleep(30000); } throw new Error('no slot in 20 min'); }
const root = '.qa-profiles/r4-frame-farbling'; await fs.rm(root, {recursive: true, force: true});
const slot = await takeSlot(); let app; const report = {};
try {
  app = await startApp({root});
  const read = async (query) => {
    const url = `http://127.0.0.1:${server.port}/?${query}`; await app.act({type: 'tab.new', url});
    const page = await app.waitWeb(u => u.startsWith(url), 'probe page');
    return poll(() => page.evaluate(() => window.results), v => v && ['top', 'same-origin', 'srcdoc', 'cross-site', 'scripted'].every(k => v[k]), 'frame results', 20000);
  };
  await app.svc({type: 'antitracking.set', patch: {fingerprint: 'off'}}); await sleep(500);
  report.off = await read('off');
  await app.svc({type: 'antitracking.set', patch: {fingerprint: 'standard'}}); await sleep(500);
  report.standard = await read('standard');
  report.covered = Object.fromEntries(Object.keys(report.off).map(k => [k, report.standard[k] !== report.off[k]]));
  report.pass = Object.values(report.covered).every(Boolean);
  report.openGaps = Object.entries(report.covered).filter(([, ok]) => !ok).map(([k]) => k);
  report.consistent = new Set(Object.values(report.standard)).size === 1; // one site key for the page and all its frames
} catch (e) { report.error = e.stack || String(e); }
finally { try { await app?.close(); } catch {} await fs.rm(slot, {force: true}); await server.close(); await cross.close(); }
console.log(JSON.stringify(report, null, 1));
if (!report.pass) process.exitCode = 1;
