// Real-app check of tab and screen capture: chrome.tabCapture / chrome.desktopCapture for extensions (fixtures/media-capture), Acira's
// share picker, the sharing pill and Stop, and a web page's own getDisplayMedia through the same picker. One isolated profile, one app,
// a native slot held for the run. Only Acira's own test window is ever chosen in the picker; evidence is window capture of Acira's own
// surfaces (picker, pill, window), never the screen.
// Usage (cwd = repo, after npm run build): node qa/extension-matrix/media-capture.mjs [--loom] [--scale=1.5] [--theme=light|dark]
import http from 'node:http';
import fs from 'node:fs/promises';
import {openSync, closeSync, writeSync, unlinkSync} from 'node:fs';
import path from 'node:path';
import {launch, install, sleep} from './lib.mjs';
import {RUN} from './run-context.mjs';

// Launched hidden by default, then Acira's own window is shown without taking focus before anything is captured: desktopCapturer lists
// only windows that are shown. D_VISIBLE=1 also works: lib.mjs answers Acira's own review window there (the earlier "UI renderer crash"
// at the review was an unanswered review plus the outer timeout's kill, see qa/extension-matrix/review-visible.mjs).
const argv = process.argv.slice(2), WANT_LOOM = argv.includes('--loom');
const SCALE = (argv.find(a => a.startsWith('--scale=')) || '').split('=')[1] || '';
const THEME = (argv.find(a => a.startsWith('--theme=')) || '').split('=')[1] || 'dark';
const TAG = `${THEME}${SCALE ? '-' + SCALE.replace('.', '') : ''}`;
const EVIDENCE = 'C:\\ae\\r4\\media-capture';
await fs.mkdir(EVIDENCE, {recursive: true});
const out = path.join(RUN.output, 'media-capture');
await fs.mkdir(out, {recursive: true});

// Native slot (ROUND3_BRIEF §3): one of C:\ae\slot-1..3.lock, created with 'wx', removed in finally.
async function takeSlot() {
  const end = Date.now() + 20 * 60 * 1000;
  while (Date.now() < end) {
    for (const n of [1, 2, 3]) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const fd = openSync(file, 'wx'); writeSync(fd, `media-capture ${new Date().toISOString()}\n`); closeSync(fd); return file; } catch {}
    }
    await sleep(30000);
  }
  throw Error('no native slot free');
}

const PAGE = `<!doctype html><meta charset=utf-8><title>Tab fixture</title><style>html,body{margin:0;height:100%;background:#0b3d91;color:#fff;font:700 64px system-ui}canvas{position:fixed;inset:0}</style>
<canvas id=c></canvas><script>const c=document.getElementById('c'),x=c.getContext('2d');function f(t){c.width=innerWidth;c.height=innerHeight;x.fillStyle='hsl('+(t/20%360)+' 70% 45%)';x.fillRect(0,0,c.width,c.height);x.fillStyle='#fff';x.fillText('TAB FIXTURE '+Math.round(t),40,120);requestAnimationFrame(f);}requestAnimationFrame(f);</script>`;
const SHARE = `<!doctype html><meta charset=utf-8><title>Share fixture</title><h1>Share fixture</h1><script>
window.ended=0;window.live=null;
window.startShare=async(ms)=>{try{const s=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});const tr=s.getVideoTracks()[0];tr.addEventListener('ended',()=>{window.ended++;});
 if(!ms){window.live=s;return {live:true,settings:tr.getSettings(),label:tr.label};}
 const chunks=[],r=new MediaRecorder(s,{mimeType:'video/webm;codecs=vp8'});r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};const stopped=new Promise(z=>r.onstop=z);r.start(250);await new Promise(z=>setTimeout(z,ms));r.stop();await stopped;
 const b=new Blob(chunks,{type:'video/webm'}),v=document.createElement('video');v.muted=true;v.src=URL.createObjectURL(b);const d=await new Promise(z=>{v.onloadedmetadata=()=>z({width:v.videoWidth,height:v.videoHeight});setTimeout(()=>z({timeout:true}),4000)});
 const settings=tr.getSettings();s.getTracks().forEach(t=>t.stop());return {size:b.size,decoded:d,settings:{width:settings.width,height:settings.height,displaySurface:settings.displaySurface}};}catch(e){return {error:String(e&&e.message||e),name:e&&e.name};}};
window.state=()=>({ended:window.ended,live:!!window.live&&window.live.getTracks().some(t=>t.readyState==='live')});
</script>`;
const server = await new Promise(resolve => { const s = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(req.url.startsWith('/share') ? SHARE : PAGE); }); s.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const until = async (read, ms = 8000, every = 200) => { const end = Date.now() + ms; let value; do { value = await read().catch(() => null); if (value) return value; await sleep(every); } while (Date.now() < end); return value; };
const R = {runId: RUN.id, started: new Date().toISOString(), theme: THEME, scale: SCALE || '1', checks: {}};
const check = (name, ok, detail) => { R.checks[name] = {ok: !!ok, detail}; console.log((ok ? 'PASS ' : 'FAIL ') + name, JSON.stringify(detail).slice(0, 500)); };

let app, slot;
try {
  slot = await takeSlot();
  app = await launch('media-capture-' + TAG + (WANT_LOOM ? '-loom' : ''), {env: {ACIRA_TEST_SHARE_PICKER: '1'}, args: SCALE ? [`--force-device-scale-factor=${SCALE}`] : []});
  await app.main(({nativeTheme}, theme) => { nativeTheme.themeSource = theme; }, THEME);
  // Helpers in the main process: Acira's own window, the picker and pill surfaces, pictures of them.
  await app.main(({BaseWindow, webContents}) => {
    globalThis.__qa = {
      own: () => [...BaseWindow.getAllWindows()].filter(w => !w.isDestroyed() && !w.contentView.children.some(v => /share.html|native-dialog/.test(v.webContents?.getURL?.() || ''))).sort((a, b) => b.getBounds().width * b.getBounds().height - a.getBounds().width * a.getBounds().height)[0],
      surface: kind => webContents.getAllWebContents().find(w => !w.isDestroyed() && /\/share\.html(\?pill)?$/.test(w.getURL()) && (kind === 'pill') === w.getURL().endsWith('?pill')),
      shown: kind => { const wc = globalThis.__qa.surface(kind); return !!wc && BaseWindow.getAllWindows().some(w => w.isVisible() && w.contentView.children.some(v => v.webContents === wc)); },
    };
  });
  const shot = async (kind, name) => {
    const b64 = await app.main(async (_e, kind) => { const wc = globalThis.__qa.surface(kind); if (!wc) return null; const image = await wc.capturePage(); return image.isEmpty() ? null : image.toPNG().toString('base64'); }, kind);
    if (!b64) return null; const file = path.join(EVIDENCE, `${name}-${TAG}.png`); await fs.writeFile(file, Buffer.from(b64, 'base64')); return file;
  };
  // Picks Acira's own test window in the open picker, then Share.
  const pickOwnWindow = async name => {
    const shown = await until(() => app.main(() => globalThis.__qa.shown('picker')), 10000);
    if (!shown) return {error: 'picker did not open'};
    const own = await app.main(() => globalThis.__qa.own()?.getMediaSourceId());
    // Evidence never holds the founder's screen: every picture and name except Acira's own test window (and its tabs) is blanked in the
    // picker before anything is captured.
    await app.main(async (_e, own) => globalThis.__qa.surface('picker').executeJavaScript(`(()=>{if(document.getElementById('qa-redact'))return;const s=document.createElement('style');s.id='qa-redact';const other='.card:not([data-key="${own}"]):not([data-key^="tab:"])';s.textContent=other+' .thumb img,'+other+' .thumb .initial{visibility:hidden!important}'+other+' .name{color:transparent!important}';document.head.append(s);})()`), own);
    await sleep(900); // pictures arrive and fade in
    const first = await shot('picker', `${name}-open`);
    const clicked = await app.main(async (_e, own) => { const wc = globalThis.__qa.surface('picker'); return wc.executeJavaScript(`(()=>{document.querySelector('[data-group="window"]')?.click();const card=document.querySelector('.card[data-key="${own}"]');if(!card)return {cards:[...document.querySelectorAll('.card')].map(c=>c.dataset.key)};card.click();return {ok:true,groups:[...document.querySelectorAll('.seg button')].map(b=>b.textContent),audioShown:!document.getElementById('audio-row').hidden};})()`); }, own);
    await sleep(400);
    const selected = await shot('picker', `${name}-window-selected`);
    if (!clicked?.ok) return {error: 'own window not listed', clicked, own};
    await app.main(async () => globalThis.__qa.surface('picker').executeJavaScript(`document.getElementById('share').click()`));
    return {own, clicked, shots: [first, selected]};
  };

  // 1. The fixture extension, loaded the way Settings › Extensions › Developer loads a folder.
  const folder = path.resolve('qa/extension-matrix/fixtures/media-capture');
  await app.main(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]}); }, folder);
  const loaded = await app.ext({type: 'load'});
  const entry = (loaded.extensions || []).find(e => e.name === 'Acira capture probe');
  check('fixture loads', entry?.status === 'loaded', {error: loaded.error, id: entry?.id});
  if (!entry) throw Error('fixture did not load');
  const id = entry.id;
  await app.ext({type: 'pin', extensionId: id, pinned: true}).catch(() => {});
  const partition = (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;

  // 2. A web tab to capture.
  await app.act({type: 'tab.new', url: base + '/page'});
  const tabId = await until(() => app.main(({webContents}, url) => webContents.getAllWebContents().find(w => w.getURL().startsWith(url))?.id, base + '/page'), 10000);
  check('web tab open', Number.isInteger(tabId), {tabId});
  await app.main(() => { const w = globalThis.__qa.own(); if (w && !w.isVisible()) w.showInactive(); });
  await sleep(1200);

  // 3. The probe page (an extension page in the profile's session, as a recorder tab or popup would be).
  const probeUrl = `chrome-extension://${id}/probe.html`, previous = new Set(app.context.pages());
  await app.main(({BrowserWindow, session}, args) => { const w = new BrowserWindow({show: false, width: 420, height: 300, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}}); globalThis.__probe = w; w.loadURL(args.url); }, {partition, url: probeUrl});
  const probe = await until(async () => app.context.pages().find(p => { try { return !previous.has(p) && p.url() === probeUrl; } catch { return false; } }), 10000, 300);
  await probe.waitForLoadState('domcontentloaded'); await sleep(500);
  check('namespaces present', await probe.evaluate(() => typeof chrome.tabCapture?.getMediaStreamId === 'function' && typeof chrome.desktopCapture?.chooseDesktopMedia === 'function'), {});

  // 4. tabCapture before the toolbar click is refused with Chrome's message.
  const early = await probe.evaluate(t => window.probe.tab(t), tabId);
  check('tabCapture refused before the toolbar click', /not been invoked/.test(early.error || ''), early);

  // 5. The toolbar click (the extension's action button in Acira's toolbar, a DOM click in the UI page; the real mouse is not used).
  const viaToolbar = await app.ui.evaluate(id => { for (const list of document.querySelectorAll('browser-action-list')) { const b = list.shadowRoot?.querySelector(`browser-action[id="${id}"]`); if (b) { b.click(); return true; } } return false; }, id);
  if (!viaToolbar) await app.main(({session}, args) => { const ext = process.mainModule.require(args.module).ElectronChromeExtensions.fromSession(session.fromPartition(args.partition)); return ext.ctx.router.handlers.get('browserAction.activate').callback({type: 'frame', sender: null}, {eventType: 'click', extensionId: args.id, tabId: args.tabId}); }, {partition, id, tabId, module: path.resolve('node_modules/electron-chrome-extensions')});
  await sleep(600);
  const clickSeen = await probe.evaluate(() => window.probe.statuses());
  check('toolbar click reaches the extension', clickSeen?.clicked === tabId, {viaToolbar, clicked: clickSeen?.clicked});

  // 6. tabCapture from the extension page: 2 s recorded into a Blob of the tab's size.
  const tabView = await app.main(({webContents}, id) => { const wc = webContents.fromId(id); return wc ? {...(wc.getOwnerBrowserWindow?.()?.getBounds() || {}), zoom: wc.getZoomFactor()} : null; }, tabId);
  const pillDuring = (async () => { await sleep(900); const shown = await app.main(() => globalThis.__qa.shown('pill')); const file = shown ? await shot('pill', 'pill-tab') : null; return {shown, file}; })();
  const tab = await probe.evaluate(t => window.probe.tab(t), tabId);
  const pillTab = await pillDuring;
  check('tabCapture records 2 s of the tab', tab.result?.size > 1000 && tab.result?.decoded?.width > 0, {tab, tabView});
  check('tabCapture.getCapturedTabs lists it while recording', Array.isArray(tab.during) && tab.during.some(t => t.tabId === tabId && t.status === 'active'), tab.during);
  check('sharing pill shows while the tab is captured', pillTab.shown, pillTab);
  await sleep(600);
  const statuses = await probe.evaluate(() => window.probe.statuses());
  check('tabCapture.onStatusChanged pending → active → stopped', JSON.stringify(statuses.statuses.filter(s => s.tabId === tabId).map(s => s.status)).includes('"pending","active","stopped"'), statuses.statuses);
  check('pill hides after the capture ends', !(await app.main(() => globalThis.__qa.shown('pill'))), {});
  await sleep(600);

  // 7. The MV3 pattern: the worker gets the id, an offscreen document (reason USER_MEDIA) records it.
  const offscreen = await probe.evaluate(t => window.probe.offscreen(t), tabId);
  check('offscreen document (USER_MEDIA) records the tab stream', offscreen?.result?.size > 1000 && offscreen.result.decoded?.width > 0, offscreen);
  await sleep(600);
  const reuse = await probe.evaluate(t => window.probe.reuse(t), tabId);
  check('a stream id works once', /unknown, used or expired/.test(reuse.error || ''), reuse);
  await sleep(600);
  const again = await probe.evaluate(t => window.probe.tab(t), tabId);
  check('the tab can be captured again from the page', again.result?.size > 1000, again.error || again.result?.decoded);
  await sleep(600);

  // 8. desktopCapture: Acira's picker, Acira's own window chosen, 2 s recorded.
  const desktopRun = probe.evaluate(() => window.probe.desktop());
  const picked = await pickOwnWindow('picker-extension');
  const pillDesk = await (async () => { await sleep(900); const shown = await app.main(() => globalThis.__qa.shown('pill')); return {shown, file: shown ? await shot('pill', 'pill-window') : null}; })();
  const desktop = await desktopRun;
  const own = await app.main(({screen}) => { const w = globalThis.__qa.own(), b = w.getContentBounds(), s = screen.getDisplayMatching(w.getBounds()).scaleFactor; return {bounds: w.getBounds(), content: b, scale: s}; });
  check('desktopCapture picker lists screens, windows and tabs; own window chosen', !!picked.clicked?.ok, picked);
  check('desktopCapture records 2 s of the chosen window', desktop.result?.size > 1000 && desktop.result?.decoded?.width > 0, {desktop, own});
  check('pill shows while the window is shared', pillDesk.shown, pillDesk);
  const cancelled = await probe.evaluate(() => window.probe.cancelDesktop());
  check('cancelChooseDesktopMedia closes the picker with an empty id', cancelled.streamId === '' && !(await app.main(() => globalThis.__qa.shown('picker'))), cancelled);

  // 9. A web page's own getDisplayMedia uses the same picker; then Stop on the pill ends a live share.
  await app.act({type: 'tab.navigate', tabId: (await app.state()).activeTabId, url: base + '/share'}).catch(() => {});
  let shareWc = await until(() => app.main(({webContents}, url) => webContents.getAllWebContents().find(w => w.getURL().startsWith(url))?.id, base + '/share'), 6000);
  if (!shareWc) { await app.act({type: 'tab.new', url: base + '/share'}); shareWc = await until(() => app.main(({webContents}, url) => webContents.getAllWebContents().find(w => w.getURL().startsWith(url))?.id, base + '/share'), 10000); }
  await sleep(800);
  const runPage = code => app.main(async ({webContents}, a) => webContents.fromId(a.id).executeJavaScript(a.code, true), {id: shareWc, code});
  const webRun = runPage('startShare(2000)');
  const webPicked = await pickOwnWindow('picker-web');
  const web = await webRun;
  check('web getDisplayMedia uses Acira\'s picker and records the chosen window', !!webPicked.clicked?.ok && web.size > 1000 && web.decoded?.width > 0, {web, groups: webPicked.clicked?.groups});
  await sleep(500);
  const liveRun = runPage('startShare(0)');
  const livePicked = await pickOwnWindow('picker-web-live');
  const live = await liveRun;
  const pillShown = await until(() => app.main(() => globalThis.__qa.shown('pill')), 4000);
  const pillShot = pillShown ? await shot('pill', 'pill-web') : null;
  await app.main(async () => globalThis.__qa.surface('pill').executeJavaScript(`document.getElementById('stop').click()`));
  const afterStop = await until(async () => { const s = await runPage('state()'); return s && !s.live ? s : null; }, 8000);
  check('pill Stop ends the page\'s share', live.live && pillShown && afterStop && !afterStop.live && afterStop.ended >= 1, {live: live.live, pillShown, pillShot, afterStop, picked: !!livePicked.clicked?.ok});
  check('pill hides after Stop', !(await until(() => app.main(() => globalThis.__qa.shown('pill')).then(v => v ? null : true), 4000) === null), {});

  // 10. Loom from the Chrome Web Store (isolated profile, no account): how far it gets.
  if (WANT_LOOM) {
    const LOOM = 'liecbddmkiiihnedobmlmillhodjkdmb';
    const installed = await install(app, LOOM);
    check('Loom installs', !installed.error, {ms: installed.ms, error: installed.error, permissions: installed.entry?.permissions});
    if (!installed.error) {
      await app.ext({type: 'pin', extensionId: LOOM, pinned: true}).catch(() => {});
      await app.act({type: 'tab.new', url: base + '/page'}); await sleep(1500);
      const before = new Set(app.context.pages().map(p => { try { return p.url(); } catch { return ''; } }));
      const clickedLoom = await app.ui.evaluate(id => { for (const list of document.querySelectorAll('browser-action-list')) { const b = list.shadowRoot?.querySelector(`browser-action[id="${id}"]`); if (b) { b.click(); return true; } } return false; }, LOOM);
      await sleep(6000);
      const pages = app.context.pages().map(p => { try { return p.url(); } catch { return ''; } }).filter(u => u && !before.has(u));
      const pickerOpen = await app.main(() => globalThis.__qa.shown('picker'));
      const windowShot = await app.main(async ({desktopCapturer}) => { const w = globalThis.__qa.own(), own = w.getMediaSourceId(), sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: 1600, height: 1000}}); const s = sources.find(x => x.id === own); return s ? s.thumbnail.toPNG().toString('base64') : null; });
      if (windowShot) await fs.writeFile(path.join(EVIDENCE, `loom-after-click-${TAG}.png`), Buffer.from(windowShot, 'base64'));
      if (pickerOpen) await shot('picker', 'loom-picker');
      const tabs = (await app.state()).tabs.map(t => t.url).filter(u => !String(u).startsWith(base));
      check('Loom after its toolbar button (no account)', clickedLoom, {newPages: pages, pickerOpen, tabs});
      R.loom = {newPages: pages, pickerOpen, tabs};
    }
  }
} catch (error) {
  console.log('ERROR', error && error.stack || error); console.log('LOGS', (app?.logs || []).join('').slice(-4000)); R.error = String(error && error.message || error);
} finally {
  try { await app?.close(); } catch {}
  server.close();
  if (slot) try { unlinkSync(slot); } catch {}
  R.finished = new Date().toISOString();
  await fs.writeFile(path.join(EVIDENCE, `result-${TAG}${WANT_LOOM ? '-loom' : ''}.json`), JSON.stringify(R, null, 2));
  const failed = Object.entries(R.checks).filter(([, c]) => !c.ok).map(([n]) => n);
  console.log(failed.length || R.error ? `DONE with ${failed.length} failing: ${failed.join('; ')}` : 'DONE all pass');
  process.exit(0);
}
