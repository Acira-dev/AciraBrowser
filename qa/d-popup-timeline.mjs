// Stream D: timeline of one popup open inside the popup renderer (when it mounts, when its backdrop frames arrive, when it is first visible, when it has formed).
//   node qa/d-popup-timeline.mjs <menu|tabs|profile|palette>      BUSY=1 puts a busy animated page behind the popup. One visible instance, 3 tabs, closed in finally.
// Timeline of one popup open inside the popup renderer: which DOM/attribute/video events happen how many ms after the click.
//   node .tmp-d/popup-timeline.mjs <menu|tabs|profile|palette>
import {startApp, httpFixture, sleep} from './d-harness.mjs';
process.env.D_VISIBLE = '1';
const kind = process.argv[2] || 'menu', root = '.qa-profiles/d-popup-timeline-' + Date.now();
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><title>${req.url}</title><h1>${req.url}</h1>${process.env.BUSY?'<div id=b style="width:300px;height:300px;background:red"></div><script>setInterval(()=>{const t=performance.now();while(performance.now()-t<35);},45);(function f(){document.getElementById("b").style.transform="rotate("+(performance.now()/20)+"deg)";requestAnimationFrame(f);})();</script>':''}`); });
const app = await startApp({root});
try {
  for (const p of ['/a', '/b', '/c']) { await app.act({type: 'tab.new', url: `http://127.0.0.1:${fx.port}${p}`}); await sleep(400); }
  await sleep(1500);
  const overlay = app.context.pages().find(p => p.url().includes('view=overlay'));
  await overlay.evaluate(() => {
    window.__events = [];
    const note = what => window.__events.push([Math.round((performance.timeOrigin + performance.now()) * 10) / 10, what]);
    window.__note = note;
    new MutationObserver(records => { for (const r of records) { if (r.type === 'attributes') note(`attr ${r.target.className && String(r.target.className).split(' ')[0] || r.target.tagName} ${r.attributeName}=${String(r.target.getAttribute(r.attributeName)).slice(0, 24)}`); else for (const n of r.addedNodes) if (n.nodeType === 1) note('added ' + (String(n.className).split(' ')[0] || n.tagName)); } }).observe(document.body, {subtree: true, attributes: true, attributeFilter: ['data-formation-ready', 'data-preparing', 'data-shown', 'data-material-provider', 'data-popup-pending', 'data-sheet-origin', 'data-state', 'hidden', 'aria-hidden'], childList: true});
    const hookVideos = () => document.querySelectorAll('video').forEach((v, i) => { if (v.__hooked) return; v.__hooked = true; for (const name of ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'resize']) v.addEventListener(name, () => note(`video${i} ${name} ${v.videoWidth}x${v.videoHeight}`)); if (v.requestVideoFrameCallback) { let n = 0; const cb = () => { if (n++ < 3) note(`video${i} frame#${n}`); v.requestVideoFrameCallback(cb); }; v.requestVideoFrameCallback(cb); } });
    new MutationObserver(hookVideos).observe(document.body, {subtree: true, childList: true}); hookVideos();
  });
  for (let round = 0; round < 2; round++) {
    await overlay.evaluate(() => { window.__events.length = 0; });
    const tab = (await app.state()).activeTabId, start = Date.now();
    await app.cmd({type: 'ui', tabId: tab, action: 'open', kind}); await sleep(1000);
    const events = await overlay.evaluate(() => window.__events);
    console.log(`--- ${kind} open, round ${round} (ms after the command returned to the test: ${Date.now() - start} total wait)`);
    for (const [at, what] of events.slice(0, 60)) console.log(String(Math.round(at - start)).padStart(6), what);
    await overlay.keyboard.press('Escape'); await sleep(1000);
  }
} finally { await app.close(); await fx.close(); }
