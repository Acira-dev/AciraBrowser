// Real-app proof of the Loom recording path (P9): the toolbar click, chrome.tabCapture.getMediaStreamId in the worker, an offscreen document
// with reasons USER_MEDIA + DISPLAY_MEDIA that turns the stream id into a MediaStream (getUserMedia chromeMediaSource 'tab') and records 2 s.
// Loom itself needs an account before it records, so the extension is Acira's fixture (qa/extension-matrix/fixtures/media-capture) which
// makes the same API calls in the same order. Only a tab of Acira's own test window is captured; no screen or other window is ever listed.
// Usage: node qa/p9/capture-live.mjs     (after npm run build:runtime + npx vite build; takes a native slot)
import path from 'node:path';
import {withApp, fixtureServer, loadUnpacked, stageFixture, clickAction, partitionOf, until, sleep, writeResult, install} from './lib.mjs';

const results = {checks: {}};
const check = (name, ok, detail) => { results.checks[name] = {ok: !!ok, detail}; console.log((ok ? 'PASS ' : 'FAIL ') + name, JSON.stringify(detail).slice(0, 400)); };
const PAGE = `<!doctype html><meta charset=utf-8><title>Tab fixture</title><style>html,body{margin:0;height:100%;background:#0b3d91}canvas{position:fixed;inset:0}</style><canvas id=c></canvas><script>const c=document.getElementById('c'),x=c.getContext('2d');function f(t){c.width=innerWidth;c.height=innerHeight;x.fillStyle='hsl('+(t/20%360)+' 70% 45%)';x.fillRect(0,0,c.width,c.height);requestAnimationFrame(f)}requestAnimationFrame(f)</script>`;
const fx = await fixtureServer((req, res) => { if (req.url.startsWith('/page')) { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); return true; } return false; });
try {
  await withApp('capture', async app => {
    const folder = await stageFixture(path.resolve('qa/extension-matrix/fixtures/media-capture'), path.resolve('.qa-profiles/p9-fx'));
    const id = await loadUnpacked(app, folder);
    await app.ext({type: 'pin', extensionId: id, pinned: true}).catch(() => {});
    const partition = await partitionOf(app);
    await app.act({type: 'tab.new', url: fx.base + '/page'});
    const tabId = await until(() => app.main(({webContents}, url) => webContents.getAllWebContents().find(w => w.getURL().startsWith(url))?.id, fx.base + '/page'), 10000);
    check('web tab open', Number.isInteger(tabId), {tabId});
    await sleep(1500);
    const probeUrl = `chrome-extension://${id}/probe.html`, previous = new Set(app.context.pages());
    await app.main(({BrowserWindow, session}, args) => { const w = new BrowserWindow({show: false, width: 420, height: 300, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}}); globalThis.__probe = w; w.loadURL(args.url); }, {partition, url: probeUrl});
    const probe = await until(async () => app.context.pages().find(p => { try { return !previous.has(p) && p.url() === probeUrl; } catch { return false; } }), 10000, 300);
    if (!probe) throw Error('probe page did not open');
    await probe.waitForLoadState('domcontentloaded'); await sleep(500);
    check('namespaces present', await probe.evaluate(() => typeof chrome.tabCapture?.getMediaStreamId === 'function' && typeof chrome.tabCapture?.capture === 'function' && typeof chrome.desktopCapture?.chooseDesktopMedia === 'function'), {});

    const early = await probe.evaluate(t => window.probe.tab(t), tabId);
    check('tabCapture refused before the toolbar click, with Chrome\'s message', /not been invoked/.test(early.error || ''), early);

    await clickAction(app, id, tabId);
    await sleep(600);
    const seen = await probe.evaluate(() => window.probe.statuses());
    check('toolbar click reaches the extension', seen?.clicked === tabId, seen);

    const tab = await probe.evaluate(t => window.probe.tab(t), tabId);
    check('tabCapture.getMediaStreamId + getUserMedia records 2 s of the tab (extension page)', tab.result?.size > 1000 && tab.result?.decoded?.width > 0, tab);
    check('getCapturedTabs lists the tab while recording', Array.isArray(tab.during) && tab.during.some(t => t.tabId === tabId && t.status === 'active'), tab.during);
    await sleep(600);
    const statuses = await probe.evaluate(() => window.probe.statuses());
    check('onStatusChanged pending, active, stopped', JSON.stringify(statuses.statuses.filter(s => s.tabId === tabId).map(s => s.status)).includes('"pending","active","stopped"'), statuses.statuses);

    // The MV3 pattern: the worker holds the id and an offscreen document (USER_MEDIA + DISPLAY_MEDIA) records it. Needs a fresh click on the tab.
    await clickAction(app, id, tabId); await sleep(500);
    const offscreen = await probe.evaluate(t => window.probe.offscreen(t), tabId);
    check('offscreen document records the tab stream (the Loom path)', offscreen?.result?.size > 1000 && offscreen.result.decoded?.width > 0, offscreen);
    await sleep(600);
    check('the offscreen document is gone after closeDocument', (await probe.evaluate(() => chrome.offscreen.hasDocument())) === false, {});

    // Other offscreen reasons (the 48-of-258 census use: DOM_PARSER, AUDIO_PLAYBACK, CLIPBOARD ...) still get a working document.
    for (const reasons of [['DOM_PARSER'], ['AUDIO_PLAYBACK'], ['CLIPBOARD'], ['USER_MEDIA']]) {
      const ping = await probe.evaluate(r => chrome.runtime.sendMessage({type: 'offscreen-ping', reasons: r}), reasons);
      check(`offscreen document (${reasons[0]}) loads, answers messages and is listed by runtime.getContexts`, ping?.reply?.pong === true && ping.contexts === 1, {reasons, ping});
    }

    await clickAction(app, id, tabId); await sleep(500);
    const reuse =await probe.evaluate(t => window.probe.reuse(t), tabId);
    check('a stream id works once', /unknown, used or expired/.test(reuse.error || ''), reuse);

    // Optional: Loom itself from the Web Store (isolated profile, no account). It cannot record without signing in; this shows how far it gets.
    if (process.argv.includes('--loom')) {
      const LOOM = 'liecbddmkiiihnedobmlmillhodjkdmb';
      const installed = await install(app, LOOM);
      check('Loom installs', !installed.error, {ms: installed.ms, error: installed.error});
      if (!installed.error) {
        const known = new Set(app.context.pages().map(p => { try { return p.url(); } catch { return ''; } }));
        await clickAction(app, LOOM, tabId).catch(error => ({error: String(error && error.message || error)}));
        await sleep(7000);
        const pages = app.context.pages().map(p => { try { return p.url(); } catch { return ''; } }).filter(u => u && !known.has(u));
        const tabs = (await app.state()).tabs.map(t => t.url).filter(u => !String(u).startsWith(fx.base));
        results.loom = {newPages: pages, tabs};
        check('Loom after its toolbar click (no account): the browser stays up', await app.main(() => true), results.loom);
      }
    }
  });
} catch (error) {
  console.log('ERROR', error && error.stack || error); results.error = String(error && error.message || error);
} finally {
  fx.close();
  const failed = Object.entries(results.checks).filter(([, c]) => !c.ok).map(([n]) => n);
  results.failed = failed;
  console.log(failed.length || results.error ? `DONE with ${failed.length} failing: ${failed.join('; ')}` : 'DONE all pass');
  await writeResult('capture-live', results);
  process.exit(0);
}
