'use strict';
// Electron harness for the ad-blocker benchmark (docs/launch/research/ADBLOCK_BENCHMARK.md).
//   electron qa/adblock-bench/record.cjs --set=ads|normal --mode=none|ghostery|brave --out=<file.json> [--only=id,id] [--dwell=14000]
// mode=none  : records every request the page makes (no blocking) -> input for replay.cjs and the breakage baseline.
// mode=ghostery : the production engine path (same lists, same engine factory, same safe-scriptlet filter as content-blocking.cjs).
// mode=brave : Brave adblock-rust through the adblock-rs binding (ADBLOCK_RS_PATH), same lists, equivalent cosmetic + scriptlet delivery.
const fs = require('node:fs'), path = require('node:path');
const { app, BrowserWindow, session, ipcMain } = require('electron');
const { createEngines } = require('./engines.cjs');
const { createFarbling } = require('../../desktop/browser-services/fingerprint-farbling.cjs');
const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
const SET = arg('set', 'ads'), MODE = arg('mode', 'none'), OUT = arg('out', path.join(__dirname, 'out-' + SET + '-' + MODE + '.json'));
const ONLY = arg('only', '') ? arg('only').split(',') : null, DWELL = Number(arg('dwell', 14000)), LISTSET = arg('lists', 'ours');
const FARBLE = arg('farble', ''); // standard | strict: also run the fingerprint-protection script (desktop/browser-services/fingerprint-farbling.cjs)
const sites = JSON.parse(fs.readFileSync(path.join(__dirname, 'sites.json'), 'utf8'))[SET].filter(s => !ONLY || ONLY.includes(s.id));
app.setPath('userData', process.env.BENCH_USERDATA || path.join(require('node:os').tmpdir(), 'acira-adblock-bench-' + process.pid));
if (SET === 'normal' || arg('autoplay', '')) app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'BrowsingTopics,PrivacySandboxAdsAPIs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const within = (ms, p, fallback) => Promise.race([p, sleep(ms).then(() => fallback)]);
const trace = (...a) => { if (process.env.BENCH_TRACE) process.stderr.write('trace ' + a.join(' ') + '\n'); };
const ADISH = ['ins.adsbygoogle', '[id^="google_ads_iframe"]', '[id*="gpt-ad"]', '[id*="div-gpt"]', '[data-google-query-id]', 'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]', 'iframe[id*="google_ads"]', '[aria-label="Advertisement" i]', '[data-ad-slot]', '[data-testid*="ad-slot" i]', '[class*="ad-slot" i]', '[class*="adslot" i]', '[class*="advert" i]', '[id*="advert" i]', '[class*="sponsored" i]', '.taboola', '[id*="taboola"]', '[id*="outbrain"]', '.OUTBRAIN', 'iframe[src*="adnxs"]', 'iframe[src*="criteo"]', 'iframe[src*="amazon-adsystem"]'];
const RESIDUAL = `(()=>{const sel=${JSON.stringify(ADISH)};const seen=new Set();let visible=0;for(const s of sel){let list=[];try{list=document.querySelectorAll(s);}catch{}for(const el of list){if(seen.has(el))continue;seen.add(el);const r=el.getBoundingClientRect(),cs=getComputedStyle(el);if(r.width>=40&&r.height>=20&&cs.display!=='none'&&cs.visibility!=='hidden'&&cs.opacity!=='0')visible++;}}
const text=[...document.querySelectorAll('div,span,p,aside,section')].filter(e=>e.children.length===0&&/^(advertisement|sponsored|advertisement - story continues below|ad)$/i.test((e.textContent||'').trim())&&e.getBoundingClientRect().width>0).length;
return {adElements:seen.size,visibleAdBoxes:visible,adLabelsShown:text,iframes:document.querySelectorAll('iframe').length,title:document.title,bodyHeight:document.body?document.body.scrollHeight:0};})()`;
const YT = `(()=>{const p=document.querySelector('#movie_player'),v=document.querySelector('video.html5-main-video');return {adShowing:!!(p&&p.classList.contains('ad-showing')),adOverlay:document.querySelectorAll('.video-ads .ytp-ad-module *, .ytp-ad-player-overlay').length,videoTime:v?v.currentTime:-1,videoPaused:v?v.paused:null,videoReady:v?v.readyState:-1,renderers:document.querySelectorAll('ytd-ad-slot-renderer,ytd-display-ad-renderer,ytd-promoted-sparkles-web-renderer,ytd-in-feed-ad-layout-renderer,#masthead-ad').length};})()`;
async function probe(wc, spec) {
  if (!spec) return null;
  const js = `(async()=>{const spec=${JSON.stringify(spec)};const out={};
  if(spec.visible){const el=document.querySelector(spec.visible);out.visible=!!(el&&el.getBoundingClientRect().width>0);}
  if(spec.count){out.count=document.querySelectorAll(spec.count).length;out.ok=out.count>=(spec.min||1);}
  if(spec.video){const v=document.querySelector(spec.video);if(v){const t0=v.currentTime;await new Promise(r=>setTimeout(r,3000));out.videoStart=t0;out.videoTime=v.currentTime;out.playing=v.currentTime>t0+1||(v.currentTime>1&&!v.paused);out.paused=v.paused;}else out.playing=false;}
  return out;})()`;
  try { const r = await wc.executeJavaScript(js, true); let ok = true; if (spec.visible) ok = ok && r.visible; if (spec.count) ok = ok && r.ok; if (spec.video) ok = ok && r.playing; if (spec.frame) { ok = ok && !!(await frameSeen(wc, spec.frame)); r.frame = true; } r.pass = ok; return r; } catch (e) { return { pass: false, error: String(e.message || e) }; }
}
const frameSeen = (wc, host) => wc.mainFrame.framesInSubtree.some(f => f.url.includes(host));
process.on('uncaughtException', e => process.stderr.write('uncaught ' + (e && e.stack || e) + '\n'));
process.on('unhandledRejection', e => process.stderr.write('unhandled ' + (e && e.stack || e) + '\n'));
app.on('window-all-closed', () => { });
async function run() {
  await app.whenReady();
  if (FARBLE) { const farble = createFarbling({ getLevel: () => FARBLE }); ipcMain.on('acira:farbling', e => { try { e.returnValue = farble.scriptFor(e.sender.getURL(), e.senderFrame.url); } catch { e.returnValue = ''; } }); }
  let engines = null; if (MODE !== 'none') engines = await createEngines({ mode: MODE, listSet: LISTSET });
  const results = [];
  for (const site of sites) {
    const started = Date.now(), ses = session.fromPartition('bench-' + MODE + '-' + site.id + '-' + Date.now());
    const reqs = [], stat = { total: 0, blocked: 0, redirected: 0, byType: {}, blockedByType: {}, third: 0, blockedHosts: {} };
    const wcIds = new Set(); let bytes = 0, finished = 0, failed = 0, consoleErrors = 0, pageErrors = 0;
    const win = new BrowserWindow({ x: -2600, y: 0, width: 1366, height: 900, show: true, skipTaskbar: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    win.setIgnoreMouseEvents(true);
    const wc = win.webContents;
    const topHost = (() => { try { return new URL(site.url).hostname; } catch { return ''; } })();
    ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
    ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      if (!/^https?:|^wss?:/.test(details.url)) return callback({});
      stat.total++; stat.byType[details.resourceType] = (stat.byType[details.resourceType] || 0) + 1;
      let host = ''; try { host = new URL(details.url).hostname; } catch { }
      const pageNow = wc.isDestroyed() ? '' : wc.getURL();
      const entry = { url: details.url, type: details.resourceType, referrer: details.referrer || '', page: pageNow, method: details.method, frame: details.frame ? details.frame.url : '' };
      let patch = {};
      if (engines && details.resourceType !== 'mainFrame') {
        try { patch = engines.onBeforeRequest(details, pageNow) || {}; } catch (e) { patch = {}; entry.error = String(e.message || e); }
        if (patch.cancel) { stat.blocked++; stat.blockedByType[details.resourceType] = (stat.blockedByType[details.resourceType] || 0) + 1; stat.blockedHosts[host] = (stat.blockedHosts[host] || 0) + 1; entry.blocked = true; }
        else if (patch.redirectURL) { stat.redirected++; entry.redirected = true; }
      }
      if (MODE === 'none' || entry.blocked || entry.redirected) reqs.push(entry);
      callback(patch);
    });
    ses.webRequest.onCompleted({ urls: ['<all_urls>'] }, () => { finished++; });
    ses.webRequest.onErrorOccurred({ urls: ['<all_urls>'] }, d => { if (d.error !== 'net::ERR_BLOCKED_BY_CLIENT') failed++; });
    if (FARBLE) ses.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, '..', '..', 'desktop', 'browser-services', 'farbling-preload.cjs') });
    if (engines) for (const filePath of engines.preloads) ses.registerPreloadScript({ type: 'frame', filePath });
    wc.on('console-message', e => { if ((e.level === 'error' || e.level === 3)) consoleErrors++; });
    trace('debugger'); try { wc.debugger.attach('1.3'); await within(5000, wc.debugger.sendCommand('Network.enable')); wc.debugger.on('message', (_e, m, p) => { if (m === 'Network.loadingFinished') bytes += p.encodedDataLength || 0; }); } catch { }
    let loadMs = null, dcl = null, nav = null; const t0 = Date.now();
    wc.once('dom-ready', () => { dcl = Date.now() - t0; }); wc.once('did-finish-load', () => { loadMs = Date.now() - t0; });
    trace('load', site.id); try { await Promise.race([wc.loadURL(site.url), sleep(25000).then(() => { throw new Error('navigation timeout 25s'); })]); } catch (e) { nav = String(e.message || e).slice(0, 160); }
    await sleep(Math.min(2500, DWELL)); try { await within(3000, wc.executeJavaScript('window.scrollTo(0, (document.body||document.documentElement).scrollHeight/2)', true)); } catch { }
    await sleep(Math.min(2500, DWELL)); try { await within(3000, wc.executeJavaScript('window.scrollTo(0, 0)', true)); } catch { }
    await sleep(Math.max(0, DWELL - 5000));
    let residual = null, yt = null, pr = null, shot = null;
    trace('residual'); try { residual = await within(15000, wc.executeJavaScript(RESIDUAL, true), { error: 'timeout' }); } catch (e) { residual = { error: String(e.message || e) }; }
    if (site.probe === 'youtube-ads') { try { yt = await within(8000, wc.executeJavaScript(YT, true), { error: 'timeout' }); await sleep(6000); const yt2 = await within(8000, wc.executeJavaScript(YT, true), { error: 'timeout' }); yt.later = yt2; } catch (e) { yt = { error: String(e.message || e) }; } }
    else if (site.probe) pr = await within(15000, probe(wc, site.probe), { pass: false, error: 'timeout' });
    if (arg('shots', '')) { try { const img = await within(8000, wc.capturePage()); const dir = arg('shots'); fs.mkdirSync(dir, { recursive: true }); shot = path.join(dir, `${SET}-${MODE}-${site.id}.png`); fs.writeFileSync(shot, img.resize({ width: 683 }).toPNG()); } catch { } }
    const mem = (await app.getAppMetrics()).filter(m => m.type === 'Tab' || m.type === 'Browser').reduce((s, m) => s + (m.memory.workingSetSize || 0), 0);
    const finalUrl = wc.isDestroyed() ? '' : wc.getURL();
    results.push({ id: site.id, url: site.url, kind: site.kind, finalUrl, nav, loadMs, domReadyMs: dcl, stat, bytes, finished, failed, consoleErrors, residual, yt, probe: pr, memKB: mem, cosmetic: engines ? engines.takeStats() : null, reqs: MODE === 'none' ? reqs : reqs.slice(0, 400), shot, elapsedMs: Date.now() - started });
    process.stderr.write(`[${MODE}/${SET}] ${site.id}: total=${stat.total} blocked=${stat.blocked} redirected=${stat.redirected} load=${loadMs}ms visibleAds=${residual && residual.visibleAdBoxes} probe=${pr ? pr.pass : '-'}${yt ? ' yt-ad=' + yt.adShowing + ' t=' + yt.videoTime : ''}\n`);
    try { wc.debugger.detach(); } catch { }
    trace('destroy'); try { win.destroy(); } catch { } await sleep(400);
    trace('clear'); try { await within(5000, ses.clearStorageData()); await within(5000, ses.clearCache()); } catch { }
    fs.writeFileSync(OUT, JSON.stringify({ mode: MODE, set: SET, listSet: LISTSET, electron: process.versions.electron, chrome: process.versions.chrome, when: new Date().toISOString(), engineInfo: engines ? engines.info : null, results }));
  }
  app.exit(0);
}
run().catch(e => { console.error(e); app.exit(1); });
