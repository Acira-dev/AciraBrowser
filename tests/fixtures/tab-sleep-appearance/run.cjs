'use strict';
// Real Electron (13.5): tabs that hold Website appearance's debugger session (Always dark; Light / Dark when they differ from Acira's own look) sleep like every other tab, and wake dark.
// The REAL modules run against real Chromium pages: desktop/site-appearance.cjs + page-debugger.cjs (leases), desktop/tab-sleep.cjs (createTabSleep + inspectPage), and the check
// main.cjs protectedReason makes of the debugger (`wc.isDevToolsOpened() || pageDebugger.inUseByOthers(wc)`). Each tab is a hidden window with the real page preload. The
// clock is a fake one, so the 5 / 15 minute rules run in seconds. A page that starts Web Workers non-stop with a cross-site frame is one of the tabs (the 13.4 crash).
// Prints one line: RESULT <json>. Run by tests/tab-sleep-appearance.test.cjs (also: electron tests/fixtures/tab-sleep-appearance/run.cjs).
// SLEEPAPP_OLD=1 asks the 13.4 question instead (any attached debugger = inspecting) and stops after the first sleep sweeps: the negative control that shows the fixture sees the bug.
// SLEEPAPP_MODE = always-dark (default) | dark | light | system, SLEEPAPP_ACIRA = Acira's own appearance light (default) | dark, SLEEPAPP_CYCLES = wake/sleep rounds (default 10), SLEEPAPP_PORT.
const {app, BrowserWindow, nativeTheme} = require('electron'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
app.commandLine.appendSwitch('use-mock-keychain'); app.commandLine.appendSwitch('mute-audio');
app.on('window-all-closed', () => {}); // a window closed on purpose (a tab put to sleep, a page done with) must not end the run: Electron quits when the last window goes unless this is heard
const OLD = process.env.SLEEPAPP_OLD === '1';
const mode = ['always-dark', 'dark', 'light', 'system'].includes(process.env.SLEEPAPP_MODE) ? process.env.SLEEPAPP_MODE : 'always-dark';
nativeTheme.themeSource = process.env.SLEEPAPP_ACIRA === 'dark' ? 'dark' : 'light';
const root = path.resolve(__dirname, '..', '..', '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-tab-sleep-appearance-')); app.setPath('userData', data); app.setName('Acira tab sleep appearance qualification');
const pageDebugger = require(path.join(root, 'desktop', 'page-debugger.cjs'));
const {createSiteAppearance} = require(path.join(root, 'desktop', 'site-appearance.cjs'));
const {createTabSleep, inspectPage} = require(path.join(root, 'desktop', 'tab-sleep.cjs'));
const inspectLive = wc => wc.executeJavaScript(`(${inspectPage.toString()})()`); // the page check of main.cjs protectedReason (sleepProbe), without the picture-in-picture and PDF lines
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), MIN = 60 * 1000, CYCLES = Number(process.env.SLEEPAPP_CYCLES || 10);
const out = {mode, acira: nativeTheme.themeSource, steps: [], gone: [], errors: []};
const note = (step, value) => out.steps.push({step, value});
const done = (code, error) => { console.log('RESULT ' + JSON.stringify({...out, ...(error ? {error: String(error)} : {})})); try { fs.rmSync(data, {recursive: true, force: true}); } catch { /* left for the OS */ } app.exit(code); };
setTimeout(() => done(3, 'timed out'), 170000).unref();
process.on('uncaughtException', error => out.errors.push('uncaught: ' + String(error && error.stack || error).slice(0, 300)));
process.on('unhandledRejection', error => out.errors.push('unhandled: ' + String(error && error.stack || error).slice(0, 300)));

const body = text => `<!doctype html><meta charset=utf-8><title>${text}</title><body style="margin:0"><h1>${text}</h1><p>${'plain white page text '.repeat(40)}</p>`;
const WORKERS = port => `<!doctype html><meta charset=utf-8><title>workers</title><body><iframe src="http://localhost:${port}/frame" width=300 height=100></iframe><script>
let n=0;function spawn(){const w=new Worker(URL.createObjectURL(new Blob(['postMessage(1);setTimeout(()=>close(),'+(n%3?5:40)+')'])));n++;w.onmessage=()=>{if(n%2)w.terminate();};}
setInterval(()=>{for(let i=0;i<3;i++)spawn();},30);</script>`;

app.whenReady().then(async () => {
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8'); const name = request.url.replace(/^\//, '').replace(/\?.*$/, '');
    response.end(name === 'frame' ? body('a frame from another site') : name === 'workers' ? WORKERS(server.address().port) : body(name));
  });
  await new Promise(resolve => server.listen(Number(process.env.SLEEPAPP_PORT || 0), '127.0.0.1', resolve));
  const port = server.address().port, address = id => `http://127.0.0.1:${port}/${id === 'w' ? 'workers' : id}`;
  // lease accounting: every lease taken through page-debugger by the appearance module and by tab sleep's freeze, and whether it was let go or ended under it
  const leases = []; const counting = (wc, owner) => { const lease = pageDebugger.acquire(wc, owner); if (lease) leases.push({owner, lease, wcId: wc.id}); return lease; };
  const appearance = createSiteAppearance({database: {policy: () => null, policies: () => [], setPolicy() {}, deletePolicy() {}}, mode: () => mode, nativeDark: () => nativeTheme.shouldUseDarkColors, profileOf: entry => entry.profileId, acquire: counting});
  const pages = new Map(), destroyedIds = new Set(); let active = 'a', time = 1_000_000;
  const darkOf = frame => frame.executeJavaScript("matchMedia('(prefers-color-scheme: dark)').matches");
  const meanLuminance = async wc => { try { const image = await Promise.race([wc.capturePage(), sleep(4000).then(() => null)]); if (!image || image.isEmpty()) return null; const {width, height} = image.getSize(), bitmap = image.toBitmap(); let sum = 0, count = 0; for (let y = 0; y < height; y += 7) for (let x = 0; x < width; x += 7) { const at = (y * width + x) * 4; sum += (bitmap[at] + bitmap[at + 1] + bitmap[at + 2]) / 3; count++; } return Math.round(sum / count); } catch { return null; } };
  async function open(id, {foreign = false} = {}) {
    const window = new BrowserWindow({show: false, width: 640, height: 400, webPreferences: {partition: 'tab-sleep-appearance-' + id + '-' + pages.size, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true, nodeIntegrationInSubFrames: true, preload: path.join(root, 'desktop', 'page-input-preload.cjs')}});
    const wc = window.webContents, entry = {window, wc, id}; pages.set(id, entry);
    wc.on('render-process-gone', (_event, details) => out.gone.push(id + ': ' + details.reason));
    wc.once('destroyed', () => destroyedIds.add(entry.wcId)); entry.wcId = wc.id;
    if (foreign) wc.debugger.attach('1.3');                         // somebody else (Tor, a hidden cookie page, any other client) holds the page before the appearance module can
    appearance.attach(wc, {id, browserProfileId: 'p1'});            // before the first load, as the browser does
    await wc.loadURL(address(id)); return entry;
  }
  const wantsSession = () => mode === 'always-dark' || mode === 'dark' && !nativeTheme.shouldUseDarkColors || mode === 'light' && nativeTheme.shouldUseDarkColors;
  const settle = async entry => { for (let i = 0; i < 100 && wantsSession() && !appearance.stateOf(entry.wc)?.session; i++) await sleep(100); await appearance.whenIdle(entry.wc); await sleep(150); };
  // the same two functions as desktop/main.cjs setFrozen, in short
  async function freeze(id) { const entry = pages.get(id); if (!entry || entry.frozen) return false; const lease = counting(entry.wc, 'sleep'); if (!lease) return false; try { await lease.sendCommand('Page.setWebLifecycleState', {state: 'frozen'}); entry.frozen = true; entry.freezeLease = lease; lease.onDetach(() => { if (entry.freezeLease === lease) { entry.frozen = false; entry.freezeLease = null; } }); return true; } catch { lease.release(); return false; } }
  async function unfreeze(id) { const entry = pages.get(id); if (!entry || !entry.frozen) return true; entry.frozen = false; const lease = entry.freezeLease; entry.freezeLease = null; try { await lease?.sendCommand('Page.setWebLifecycleState', {state: 'active'}); } catch { /* gone */ } lease?.release(); return true; }
  const slept = [];
  const sleeper = createTabSleep({now: () => time, freezeAfterMs: 5 * MIN, discardAfterMs: 15 * MIN, retryMs: 10 * MIN, settings: () => ({enabled: true, idleMinutes: 15, neverSleep: []}), memory: () => ({free: 8 * 1024 ** 3, total: 16 * 1024 ** 3}), adapter: {
    tabs: () => [...pages.keys()].map(id => ({id})), isVisible: id => id === active, freeze, unfreeze,
    async protectedReason(tab) {
      const entry = pages.get(tab.id), wc = entry.wc; if (wc.isDestroyed()) return 'gone';
      if (OLD ? wc.isDevToolsOpened() || wc.debugger.isAttached() : wc.isDevToolsOpened() || pageDebugger.inUseByOthers(wc)) return 'inspecting';    // the line in desktop/main.cjs protectedReason (13.4: any attached debugger)
      try { const found = await inspectLive(wc); return found?.safe ? null : (found?.reason || 'unsafe'); } catch { return 'inspection-failed'; }
    },
    async sleep(id) { const entry = pages.get(id); if (!entry || entry.wc.isDestroyed()) return {slept: false, reason: 'gone'}; const wc = entry.wc; await new Promise(resolve => { wc.once('destroyed', resolve); wc.close(); }); try { entry.window.destroy(); } catch { /* gone */ } pages.delete(id); slept.push(id); return {slept: true}; },
  }});
  const outstanding = () => leases.filter(item => !item.lease.over && !destroyedIds.has(item.wcId));
  const leftOnDead = () => leases.filter(item => !item.lease.over && destroyedIds.has(item.wcId)).length;
  const liveSessions = () => [...pages.values()].filter(entry => appearance.stateOf(entry.wc)?.session).length;
  try {
    for (const id of ['a', 'b', 'c', 'w']) await open(id);
    for (const id of ['a', 'b', 'c', 'w']) await settle(pages.get(id));
    note('opened', {wantsSession: wantsSession(), sessions: ['a', 'b', 'c', 'w'].map(id => appearance.stateOf(pages.get(id).wc)?.session === true), dark: await Promise.all(['a', 'b', 'c', 'w'].map(id => darkOf(pages.get(id).wc.mainFrame))), luminance: await meanLuminance(pages.get('b').wc)});
    // c has DevTools open (docked into a hidden window, so nothing shows); f is held by another debugger from the start
    // (docked at the bottom of the page's own hidden window: the one hidden setup that makes webContents.isDevToolsOpened() true; a custom host view does not)
    pages.get('c').wc.openDevTools({mode: 'bottom'}); for (let i = 0; i < 40 && !pages.get('c').wc.isDevToolsOpened(); i++) await sleep(100); await sleep(500);
    const foreign = await open('f', {foreign: true}); await sleep(300); await appearance.whenIdle(foreign.wc);
    note('protections', {devTools: pages.get('c').wc.isDevToolsOpened(), foreignInUse: pageDebugger.inUseByOthers(foreign.wc), tabsWithOurSession: liveSessions()});
    await sleeper.sweep();                                          // the clock starts
    time += 6 * MIN; const first = await sleeper.sweep(); note('frozen', {frozen: first.frozen.sort(), protected: first.protected, heldWhenFrozen: ['b', 'w'].map(id => pages.get(id) ? pageDebugger.held(pages.get(id).wc) : null)});
    time += 10 * MIN; const second = await sleeper.sweep(); note('slept', {slept: second.slept.sort(), protected: second.protected, awake: [...pages.keys()].sort(), leftOnDeadPages: leftOnDead()});
    if (OLD) { note('old-check', {awake: [...pages.keys()].sort(), sessions: liveSessions()}); out.final = {old: true, gone: out.gone, errors: out.errors}; done(0); return; }
    note('after-sleep', {outstanding: outstanding().map(item => item.owner).sort(), activeSession: appearance.stateOf(pages.get('a').wc)?.session === true, sessions: liveSessions()});
    // DevTools closed and the other debugger gone: both go to sleep at the next sweep
    pages.get('c').wc.closeDevTools(); await sleep(500); foreign.wc.debugger.detach(); await sleep(300);
    const third = await sleeper.sweep(); note('released', {slept: third.slept.sort(), protected: third.protected, awake: [...pages.keys()].sort(), leftOnDeadPages: leftOnDead()});
    // wake b and put it to sleep again and again: it is dark each time, and no lease is left behind
    const rounds = [];
    for (let round = 0; round < CYCLES; round++) {
      active = 'b'; const woke = await open('b'); await settle(woke); const dark = await darkOf(woke.wc.mainFrame), state = appearance.stateOf(woke.wc), luminance = round === 0 ? await meanLuminance(woke.wc) : undefined;
      sleeper.touch('b'); await sleeper.sweep(); active = 'a'; sleeper.touch('a');
      time += 6 * MIN; const frozenSweep = await sleeper.sweep(); const frozen = sleeper.frozen('b'), held = pageDebugger.held(woke.wc);
      time += 10 * MIN; const sweep = await sleeper.sweep();
      rounds.push({round, dark, session: state?.session === true, luminance, frozenSweep: frozenSweep.frozen, frozen, held, slept: sweep.slept.includes('b'), protected: sweep.protected, gone: woke.wc.isDestroyed(), leftOnDeadPages: leftOnDead(), outstanding: outstanding().length, sessions: liveSessions()});
    }
    note('rounds', rounds);
    // wake w (Web Workers non-stop and a cross-site frame): dark, then asleep again without a crash
    active = 'w'; const w = await open('w'); await settle(w); await sleep(1500);
    const frames = w.wc.mainFrame.framesInSubtree.filter(frame => frame !== w.wc.mainFrame);
    note('woken-workers-page', {page: await darkOf(w.wc.mainFrame), frames: await Promise.all(frames.map(frame => darkOf(frame).catch(error => 'error: ' + error.message))), state: appearance.stateOf(w.wc), alive: !w.wc.isDestroyed() && !w.wc.isCrashed()});
    sleeper.touch('w'); await sleeper.sweep(); active = 'a'; sleeper.touch('a');
    time += 6 * MIN; await sleeper.sweep(); time += 10 * MIN; const last = await sleeper.sweep();
    note('workers-page-slept-again', {slept: last.slept, protected: last.protected, awake: [...pages.keys()].sort(), leftOnDeadPages: leftOnDead()});
    // the shown tab never sleeps, however long it stays
    time += 60 * MIN; const long = await sleeper.sweep(); note('active-stays', {slept: long.slept, awake: [...pages.keys()].sort(), session: appearance.stateOf(pages.get('a').wc)?.session === true});
    out.final = {outstanding: outstanding().map(item => item.owner).sort(), liveSessions: liveSessions(), pages: [...pages.keys()].sort(), slept, gone: out.gone, errors: out.errors};
    done(0);
  } catch (error) { done(2, error && error.stack || error); }
});
