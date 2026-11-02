// Round 10: HTML fullscreen must end whenever the fullscreen page goes away, loses focus of the tab strip or leaves its document.
//   node qa/native-slot.mjs r10-fullscreen -- node qa/r10-fullscreen-probe.mjs
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = '.qa-profiles/r10-fullscreen'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>${req.url}</title><button id=fs onclick="document.documentElement.requestFullscreen()" style="width:300px;height:200px">go</button><video id=v></video>`); });
const base = `http://127.0.0.1:${fx.port}`;
const out = (k, v) => console.log(k.padEnd(34), typeof v === 'string' ? v : JSON.stringify(v));
const app = await startApp({root});
const winFs = () => app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => w.isFullScreen()));
const enter = async (path) => {
  await app.act({type: 'tab.new', url: base + path}); const page = await app.waitWeb(base + path); await sleep(500);
  await page.click('#fs'); await sleep(900);
  return {page, fs: await page.evaluate(() => Boolean(document.fullscreenElement)), win: await winFs()};
};
try {
  const tabsNow = async () => (await app.state()).tabs;
  let r = await enter('/a'); out('enter /a', r.fs + ' ' + JSON.stringify(r.win));
  let id = (await tabsNow()).at(-1).id;
  await app.act({type: 'tab.close', id}); await sleep(900);
  out('after closing fullscreen tab', {win: await winFs(), tabs: (await tabsNow()).map(t => t.url)});

  r = await enter('/b'); id = (await tabsNow()).at(-1).id; const first = (await tabsNow())[0].id;
  await app.act({type: 'tab.select', id: first}); await sleep(900);
  out('after selecting other tab', {win: await winFs(), docFs: await r.page.evaluate(() => Boolean(document.fullscreenElement)).catch(e => 'ERR')});
  await app.act({type: 'tab.close', id}); await sleep(500);

  r = await enter('/c'); id = (await tabsNow()).at(-1).id;
  await app.act({type: 'tab.navigate', tabId: id, url: base + '/c2'}); await sleep(1200);
  out('after navigate in fullscreen', {win: await winFs()});
  await app.act({type: 'tab.close', id}); await sleep(500);

  r = await enter('/d'); id = (await tabsNow()).at(-1).id;
  await app.act({type: 'tab.new', url: base + '/e'}); await sleep(1200);
  out('after new tab in fullscreen', {win: await winFs(), active: (await app.state()).activeTabId === id});
  for (const t of (await tabsNow()).slice(1)) await app.act({type: 'tab.close', id: t.id}); await sleep(500);

  r = await enter('/f'); await r.page.evaluate(() => document.exitFullscreen()); await sleep(900);
  out('after page exitFullscreen', {win: await winFs()});
  for (const t of (await tabsNow()).slice(1)) await app.act({type: 'tab.close', id: t.id}); await sleep(300);
  // Esc key
  r = await enter('/g'); await app.main(({webContents}) => { const c = webContents.getAllWebContents().find(w => w.getURL().endsWith('/g')); c.sendInputEvent({type: 'keyDown', keyCode: 'Escape'}); c.sendInputEvent({type: 'keyUp', keyCode: 'Escape'}); }); await sleep(900);
  out('after Escape', {win: await winFs(), docFs: await r.page.evaluate(() => Boolean(document.fullscreenElement)).catch(() => 'ERR')});
} catch (e) { console.log('FAILED', String(e.stack || e.message).slice(0, 400), 'exit', app.app.process().exitCode, app.app.process().signalCode); console.log(app.logs.join('').split(String.fromCharCode(10)).filter(l => l.trim()).slice(-30).join(String.fromCharCode(10))); } finally { await Promise.race([app.close(), sleep(8000)]); await fx.close(); process.exit(0); }
