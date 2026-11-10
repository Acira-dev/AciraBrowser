'use strict';
// Real Electron (13.5): a website's zoom step is not glided while its main frame navigates, and a navigation that starts under a running glide lands it at once. A renderer crashed
// once (exit 11) with a dozen Emulation.setPageScaleFactor commands in flight while the page's second navigation (a JS challenge redirect) was committing. This runs the real glide
// (desktop/page-zoom-glide.cjs, watch()) against a real page and counts the page scale commands that reach the debugger, through slow loads, a redirect, a script redirect after the
// first commit, a hash change, a failed load, Stop and a 204. Prints one line: RESULT <json>. Run by tests/zoom-glide-navigation.test.cjs.
const {app, BrowserWindow} = require('electron'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
app.commandLine.appendSwitch('use-mock-keychain'); app.commandLine.appendSwitch('mute-audio');
const root = path.resolve(__dirname, '..', '..', '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-zoom-nav-')); app.setPath('userData', data); app.setName('Acira zoom navigation qualification');
const {createZoomGlide, glideSeconds} = require(path.join(root, 'desktop', 'page-zoom-glide.cjs'));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const out = {steps: [], gone: []};
const done = (code, error) => { console.log('RESULT ' + JSON.stringify({...out, ...(error ? {error: String(error)} : {})})); try { fs.rmSync(data, {recursive: true, force: true}); } catch { /* left for the OS */ } app.exit(code); };
setTimeout(() => done(3, 'timed out'), 100000).unref();
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(10); } return false; };
const PAGE = '<!doctype html><meta charset=utf-8><title>page</title><body style="margin:0;font:16px sans-serif"><h1>A page</h1>' + '<p>Some text to lay out.</p>'.repeat(60);

app.whenReady().then(async () => {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://x');
    if (url.pathname === '/slow') { setTimeout(() => { response.setHeader('content-type', 'text/html'); response.end(PAGE + '<!-- slow -->'); }, Number(url.searchParams.get('ms')) || 600); return; }
    if (url.pathname === '/redir') { response.statusCode = 302; response.setHeader('location', '/slow?ms=' + (url.searchParams.get('ms') || 600)); response.end(); return; }
    if (url.pathname === '/challenge') { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>challenge</title><script>setTimeout(function(){location.replace("/slow?ms=700")},30)</script><p>checking</p>'); return; }
    if (url.pathname === '/nocontent') { response.statusCode = 204; response.end(); return; }
    response.setHeader('content-type', 'text/html'); response.end(PAGE);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const window = new BrowserWindow({show: false, width: 700, height: 500, webPreferences: {partition: 'zoom-nav', offscreen: true, backgroundThrottling: false}}), wc = window.webContents;
    wc.setFrameRate(30);
    wc.on('render-process-gone', (_e, details) => out.gone.push(details.reason + ' ' + details.exitCode));
    // every page scale command that reaches the debugger, with whether the main frame was navigating when it was sent. `mine` follows the navigation from the events alone (an observer that
    // does not depend on the module under test), so the same run on the code without the guard shows how many commands it sent during navigations.
    const glide = createZoomGlide();
    let mine = false;
    const commands = [];
    const dbg = wc.debugger, send = dbg.sendCommand.bind(dbg);
    dbg.sendCommand = (method, params, ...rest) => { if (method === 'Emulation.setPageScaleFactor') commands.push({scale: params.pageScaleFactor, navigating: mine, at: Date.now()}); return send(method, params, ...rest); };
    const events = [];
    for (const name of ['did-start-navigation', 'did-navigate', 'did-stop-loading', 'did-fail-load']) wc.on(name, (event, ...args) => {
      events.push(name === 'did-start-navigation' ? (event.isMainFrame && !event.isSameDocument ? 'start' : 'sub') : name === 'did-fail-load' ? 'fail' + args[0] : name.slice(4));
      if (name === 'did-start-navigation' && event.isMainFrame && !event.isSameDocument) mine = true;
      else if (name === 'did-navigate' || name === 'did-stop-loading' || (name === 'did-fail-load' && args[3] && args[0] !== -3)) mine = false;
    });
    glide.watch?.(wc); // as main.cjs does when the page is made
    const step = (target) => { const glided = glide.request({wc, target, speed: 'premium', seconds: glideSeconds('premium'), visible: () => true}); if (!glided) wc.setZoomFactor(target); return glided; };
    const note = (name, extra = {}) => out.steps.push({name, navigating: mine, guard: Boolean(glide.isNavigating?.(wc)), gliding: glide.isGliding(wc), zoom: Math.round(wc.getZoomFactor() * 100), ...extra});
    const startLoad = url => { const p = wc.loadURL(url).catch(() => {}); return p; };
    const settled = async () => { await until(() => !mine && !glide.isGliding(wc), 6000); await sleep(150); };

    await wc.loadURL(origin + '/'); await settled(); note('loaded');

    // 1. outside a navigation the glide is what it was: many page scale frames, then the zoom lands
    let from = commands.length;
    const baseline = step(1.1); await until(() => !glide.isGliding(wc), 3000); await sleep(100);
    note('baseline glide outside a navigation', {glided: baseline, frames: commands.length - from, lastScale: commands.at(-1)?.scale});
    step(1); await until(() => !glide.isGliding(wc), 3000); await sleep(100); note('baseline reset');

    // 2. a step while a slow navigation is in flight: applied at once, no page scale command at all
    from = commands.length;
    startLoad(origin + '/slow?ms=900');
    out.sawStart = await until(() => mine, 2000);
    out.guardSawStart = Boolean(glide.isNavigating?.(wc));
    const during = step(.9); await sleep(250);
    note('step during a slow navigation', {glided: during, frames: commands.length - from, zoomNow: Math.round(wc.getZoomFactor() * 100)});
    await settled(); note('after it commits');

    // 3. a navigation that starts under a running glide lands it at once
    wc.setZoomFactor(1); await sleep(200);
    from = commands.length;
    const running = step(1.1); await sleep(35);
    const wasGliding = glide.isGliding(wc);
    startLoad(origin + '/slow?ms=700');
    await until(() => mine, 2000);
    note('glide, then a navigation starts', {glided: running, wasGliding, framesBeforeNav: commands.slice(from).filter(c => !c.navigating).length - 1, framesWhileNavigating: commands.slice(from).filter(c => c.navigating).length, lastScale: commands.at(-1)?.scale, zoomNow: Math.round(wc.getZoomFactor() * 100)});
    await settled(); note('after it commits (3)');

    // 4. a redirect: the guard holds across the hop and the slow second request
    from = commands.length;
    startLoad(origin + '/redir?ms=900'); await until(() => mine, 2000);
    const early = step(.8); await sleep(300); const late = step(.9); await sleep(300);
    note('steps during a redirect chain', {glided: [early, late], frames: commands.length - from});
    await settled(); note('after it commits (4)');

    // 5. a script redirect after the first commit (the JS challenge): the second navigation is guarded too
    from = commands.length; events.length = 0;
    startLoad(origin + '/challenge');
    await until(() => events.filter(e => e === 'start').length >= 2, 4000);
    const second = step(1.1); await sleep(300);
    note('step during the second navigation of a challenge', {glided: second, frames: commands.length - from, events: events.slice()});
    await settled(); note('after it commits (5)');

    // 6. a hash change / pushState is not a navigation to another document
    await wc.executeJavaScript(`history.pushState({}, '', '/pushed'); location.hash = '#a'; 1`); await sleep(150);
    from = commands.length; const same = step(1); await until(() => !glide.isGliding(wc), 3000); await sleep(100);
    note('step after a hash change / pushState', {glided: same, frames: commands.length - from});

    // 7. a failed load ends the guard
    startLoad('http://127.0.0.1:1/'); await until(() => mine, 2000);
    const failing = step(1.1);
    out.failEnded = await until(() => !mine && !glide.isNavigating?.(wc), 6000);
    note('failed load', {glidedDuring: failing});
    await settled();

    // 8. Stop ends the guard
    startLoad(origin + '/slow?ms=3000'); await until(() => mine, 2000);
    wc.stop(); out.stopEnded = await until(() => !mine && !glide.isNavigating?.(wc), 3000);
    note('stop');

    // 9. a 204 ends the guard
    startLoad(origin + '/nocontent'); await until(() => mine, 2000);
    out.noContentEnded = await until(() => !mine && !glide.isNavigating?.(wc), 3000);
    note('204');
    from = commands.length; const after = step(1.1); await until(() => !glide.isGliding(wc), 3000); await sleep(100);
    note('glide again after all of it', {glided: after, frames: commands.length - from});

    out.commandsWhileNavigating = commands.filter(c => c.navigating).length;
    out.totalCommands = commands.length;
    done(0);
  } catch (error) { done(2, error && error.stack || error); }
});
