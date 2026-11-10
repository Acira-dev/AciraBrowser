'use strict';
// Real Electron (13.5): Always dark must survive every way a website's zoom or Acira's appearance changes. Chromium re-applies a page's web preferences when
// webContents.setVisualZoomLevelLimits is called and when the system colour scheme changes, and that resets the Auto Dark Mode override the debugger session holds: the page stayed
// attached but turned light until it was reloaded. This runs the real desktop modules (site-appearance, page-zoom-glide, page-debugger) on a white page without a dark theme
// of its own and measures what the page SHOWS (capturePage) after each step. Prints one line: RESULT <json>. Run by tests/always-dark-zoom.test.cjs.
const {app, BrowserWindow, nativeTheme} = require('electron'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
app.commandLine.appendSwitch('use-mock-keychain'); app.commandLine.appendSwitch('mute-audio');
nativeTheme.themeSource = 'light';
const root = path.resolve(__dirname, '..', '..', '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-dark-zoom-')); app.setPath('userData', data); app.setName('Acira dark zoom qualification');
const {createSiteAppearance} = require(path.join(root, 'desktop', 'site-appearance.cjs'));
const {createZoomGlide, glideSeconds, ensureLimits, clearMagnification} = require(path.join(root, 'desktop', 'page-zoom-glide.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = {steps: []};
const done = (code, error) => { console.log('RESULT ' + JSON.stringify({...out, ...(error ? {error: String(error)} : {})})); try { fs.rmSync(data, {recursive: true, force: true}); } catch { /* left for the OS */ } app.exit(code); };
setTimeout(() => done(3, 'timed out'), 100000).unref();
const PAGE = '<!doctype html><meta charset=utf-8><title>white page</title><body style="margin:0;background:#fff;color:#111;font:16px sans-serif"><h1>A page with no dark theme</h1><p>Ordinary text on white.</p><div style="height:900px;background:#f4f4f4"></div>';

app.whenReady().then(async () => {
  const server = http.createServer((_request, response) => { response.setHeader('content-type', 'text/html'); response.end(PAGE); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    // offscreen: nothing is ever shown, and capturePage still returns what the page paints
    const window = new BrowserWindow({show: false, width: 700, height: 500, webPreferences: {partition: 'dark-zoom', offscreen: true, backgroundThrottling: false}}), wc = window.webContents;
    wc.setFrameRate(30);
    const appearance = createSiteAppearance({database: {policy: () => null, policies: () => [], setPolicy() {}, deletePolicy() {}}, mode: () => 'always-dark', nativeDark: () => nativeTheme.shouldUseDarkColors, profileOf: entry => entry.profileId});
    nativeTheme.on('updated', () => appearance.refreshAll({force: true})); // as main.cjs does
    const luma = async () => { const image = await wc.capturePage(), {width, height} = image.getSize(), bitmap = image.toBitmap(); let sum = 0, count = 0; for (let y = 0; y < height; y += Math.max(1, height >> 4)) for (let x = 0; x < width; x += Math.max(1, width >> 5)) { const i = (y * width + x) * 4; sum += .2126 * bitmap[i + 2] + .7152 * bitmap[i + 1] + .0722 * bitmap[i]; count++; } return Math.round(sum / count); };
    const settle = async () => { await appearance.whenIdle(wc); await sleep(700); };
    const step = async (name, action) => { let error = null; try { await action(); } catch (e) { error = String(e.message || e); } await settle(); out.steps.push({name, luma: await luma(), session: Boolean(appearance.stateOf(wc)?.session), zoom: Math.round(wc.getZoomFactor() * 100), ...(error ? {error} : {})}); };
    ensureLimits(wc); // a link preview gets its limits when it is made, before it holds a session
    appearance.attach(wc, {id: 't1', browserProfileId: 'p1'});
    await wc.loadURL(`http://127.0.0.1:${server.address().port}/`);
    for (let i = 0; i < 100 && !appearance.stateOf(wc)?.session; i++) await sleep(100);
    await settle(); out.steps.push({name: 'loaded', luma: await luma(), session: Boolean(appearance.stateOf(wc)?.session), zoom: 100});
    out.limitsAgain = ensureLimits(wc); // the tab path finds them there: nothing is applied again
    await step('limits already applied (a link preview that becomes a tab)', async () => { ensureLimits(wc); });
    // the glide, as a zoom step does it (motion on)
    const glide = createZoomGlide();
    const gliding = target => { const ok = glide.request({wc, target, speed: 'premium', seconds: glideSeconds('premium'), visible: () => true}); if (!ok) wc.setZoomFactor(target); };
    await step('zoom out 90% (glide)', async () => { gliding(.9); await sleep(900); });
    await step('zoom in 110% (glide)', async () => { gliding(1.1); await sleep(900); });
    await step('reset 100% (glide)', async () => { gliding(1); await sleep(900); });
    await step('burst of steps during a glide', async () => { for (const z of [.9, .8, .9, 1]) { gliding(z); await sleep(70); } await sleep(900); });
    // the instant path (wheel step, motion off): a pinch is cleared first, then the zoom set
    await step('instant zoom 80% (page without a pinch)', async () => { await clearMagnification(wc, {afterToggle: () => appearance.reassert(wc)}); wc.setZoomFactor(.8); });
    await step('instant zoom 100% after a pinch (page scale 1.7 left on the page)', async () => { await wc.debugger.sendCommand('Emulation.setPageScaleFactor', {pageScaleFactor: 1.7}); await clearMagnification(wc, {afterToggle: () => appearance.reassert(wc)}); wc.setZoomFactor(1); const metrics = await wc.debugger.sendCommand('Page.getLayoutMetrics'); out.scaleAfterClear = metrics.cssVisualViewport.scale; });
    // Acira's own appearance changes (the app's, or the system's)
    await step('Acira appearance light -> dark', async () => { nativeTheme.themeSource = 'dark'; await sleep(400); });
    await step('Acira appearance dark -> light', async () => { nativeTheme.themeSource = 'light'; await sleep(400); });
    await step('Acira appearance flips twice, fast', async () => { nativeTheme.themeSource = 'dark'; await sleep(60); nativeTheme.themeSource = 'light'; await sleep(400); });
    // the cause itself, as a control: the old way of clearing a pinch drops the override, and one reassert brings it back
    await step('CONTROL: webContents.setVisualZoomLevelLimits(1,1) then (1,5), the old clearing', async () => { await wc.setVisualZoomLevelLimits(1, 1); await wc.setVisualZoomLevelLimits(1, 5); });
    await step('CONTROL: reassert() after it', async () => { appearance.reassert(wc); await sleep(200); });
    done(0);
  } catch (error) { done(2, error && error.stack || error); }
});
