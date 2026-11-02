// R4-37 guard for the single cosmetic path: EasyList generic element hiding still works on elements present at load and on
// elements added later (the mutation path), and ordinary content stays visible.
//   node qa/r4-slot-run.mjs qa/r4-cosmetic-check.mjs      (cwd = an app folder with qa/; isolated profile under .qa-profiles)
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const PAGE = `<!doctype html><title>cosmetic</title><body><div class="adsbygoogle-wrapper" id="atload">ad at load</div><div class="article" id="content">article text</div>
<script>setTimeout(()=>{const late=document.createElement('div');late.className='adsbygoogle-wrapper';late.id='later';late.textContent='ad added later';document.body.appendChild(late);
const named=document.createElement('div');named.id='named';named.textContent='plain';document.body.appendChild(named);setTimeout(()=>{named.className='adsbygoogle-box';},300);},1500);</script>`;
const server = await httpFixture((q, r) => { r.setHeader('content-type', 'text/html'); r.end(PAGE); });
const root = '.qa-profiles/r4-cosmetic'; await fs.rm(root, {recursive: true, force: true});
let app; const report = {};
try {
  app = await startApp({root, args: ['--host-resolver-rules=MAP www.example.com 127.0.0.1']}); // Ghostery gives IP-address hosts no cosmetic rules
  const url = `http://www.example.com:${server.port}/cosmetic`;
  await app.act({type: 'tab.new', url});
  const page = await app.waitWeb(u => u.startsWith(url), 'cosmetic page');
  await sleep(5000);
  report.display = await poll(() => page.evaluate(() => Object.fromEntries(['atload', 'later', 'named', 'content'].map(id => [id, document.getElementById(id) ? getComputedStyle(document.getElementById(id)).display : 'missing']))), v => v.later !== 'missing', 'elements', 10000);
  report.pass = report.display.atload === 'none' && report.display.later === 'none' && report.display.named === 'none' && report.display.content !== 'none';
} catch (e) { report.error = e.stack || String(e); }
finally { try { await app?.close(); } catch {} await server.close(); }
console.log(JSON.stringify(report));
if (!report.pass) process.exitCode = 1;
