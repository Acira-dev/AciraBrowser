// Stream D: pop-up policy - user-initiated windows (OAuth/payment) open, load-time and delayed pop-ups are blocked.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-popups'; await fs.rm(root, {recursive: true, force: true});
const hits = [];
const fx = await httpFixture((req, res) => {
  hits.push(req.url); res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/popup')) return res.end('<title>popup</title>child');
  if (req.url === '/spam') return res.end('<title>spam</title><script>window.open("/popup-load");setTimeout(()=>window.open("/popup-timer"),300)</script>');
  if (req.url === '/oauth') return res.end('<title>oauth</title><button id=b style="position:fixed;left:10px;top:10px;width:200px;height:80px" onclick="window.open(\'/popup-click\');setTimeout(()=>window.open(\'/popup-late\'),6000)">Sign in</button><a id=l target=_blank href="/popup-link" style="position:fixed;left:10px;top:120px;width:200px;height:40px;display:block">link</a>');
  res.end('<title>home</title>');
});
const base = `http://127.0.0.1:${fx.port}`, report = [];
const app = await startApp({root});
const click = (url, x, y) => app.main(({webContents}, [url, x, y]) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === url); wc.focus(); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({type, x, y, button: 'left', clickCount: 1}); }, [url, x, y]);
const popups = () => hits.filter(h => h.startsWith('/popup'));
try {
  await app.act({type: 'tab.new', url: base + '/spam'}); await app.waitWeb(base + '/spam'); await sleep(1500);
  assert.deepEqual(popups(), [], 'load-time and timer pop-ups must not open'); report.push('unsolicited pop-ups blocked');
  assert.match((await app.state()).toast?.text || '', /Pop-up blocked/); report.push('user sees a notice');
  await app.act({type: 'tab.new', url: base + '/oauth'}); await app.waitWeb(base + '/oauth'); await sleep(800);
  await click(base + '/oauth', 50, 40); await poll(() => popups().includes('/popup-click'), Boolean, 'click pop-up opens'); report.push('pop-up after a real click opens (OAuth/payment)');
  await click(base + '/oauth', 50, 140); await poll(() => popups().includes('/popup-link'), Boolean, 'target=_blank link opens'); assert.ok((await app.state()).tabs.some(t => t.url === base + '/popup-link'), 'target=_blank opens as a TAB'); assert.equal(await app.main(({BrowserWindow}) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('/popup-link')).length), 0); report.push('target=_blank link opens as a tab, not a window');
  await sleep(6500); assert.ok(!popups().includes('/popup-late'), 'a pop-up long after the click is blocked'); report.push('late timer pop-up after the click window is blocked');
} finally { await app.close(); await fx.close(); }
console.log(JSON.stringify({ok: true, report}, null, 1));
