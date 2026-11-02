// Real-app proof of chrome.identity (P9): launchWebAuthFlow against a LOCAL fake OAuth server (no real account, no network), from an extension
// page and from the service worker; getRedirectURL; the signed-out account members. The sign-in window is Acira's own (hidden in this rig:
// ACIRA_BROWSER_TEST_HIDDEN); the rig finds it by its title and answers the fake provider's page.
// Usage: node qa/p9/identity-live.mjs     (after npm run build:runtime + npx vite build + node scripts/build-ui-preload.mjs; takes a native slot)
import path from 'node:path';
import fs from 'node:fs/promises';
import {withApp, fixtureServer, loadUnpacked, stageFixture, partitionOf, until, sleep, writeResult} from './lib.mjs';

const results = {checks: {}};
const check = (name, ok, detail) => { results.checks[name] = {ok: !!ok, detail}; console.log((ok ? 'PASS ' : 'FAIL ') + name, JSON.stringify(detail).slice(0, 400)); };
const page = (title, body) => `<!doctype html><meta charset=utf-8><title>${title}</title><body style="font:16px system-ui;margin:32px">${body}`;
const fx = await fixtureServer((req, res, url) => {
  const redirect = url.searchParams.get('redirect_uri') || '', state = url.searchParams.get('state') || '';
  if (url.pathname === '/authorize') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(page('Fake provider', `<h1>Fake OAuth provider</h1><p>Local test server. The extension asks for access.</p><button id=approve>Approve</button><script>document.getElementById('approve').onclick=()=>{location.href=${JSON.stringify(redirect)}+'?code=fake-code&state='+${JSON.stringify(state)}+'#frag';};</script>`));
    return true;
  }
  if (url.pathname === '/auto') { res.statusCode = 302; res.setHeader('location', `${redirect}?code=auto-code&state=${state}`); res.end(); return true; }
  if (url.pathname === '/login') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(page('Login', '<h1>Sign in</h1><input id=u><input id=p type=password>')); return true; }
  if (url.pathname === '/broken') { req.socket.destroy(); return true; }
  return false;
});
try {
  await withApp('essentials', async app => {
    const folder = await stageFixture(path.resolve('qa/p9/fixtures/essentials'), path.resolve('.qa-profiles/p9-fx'));
    const id = await loadUnpacked(app, folder);
    const partition = await partitionOf(app);
    const probeUrl = `chrome-extension://${id}/probe.html`, previous = new Set(app.context.pages());
    await app.main(({BrowserWindow, session}, args) => { const w = new BrowserWindow({show: false, width: 420, height: 300, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}}); globalThis.__probe = w; w.loadURL(args.url); }, {partition, url: probeUrl});
    const probe = await until(async () => app.context.pages().find(p => { try { return !previous.has(p) && p.url() === probeUrl; } catch { return false; } }), 10000, 300);
    if (!probe) throw Error('probe page did not open');
    await probe.waitForLoadState('domcontentloaded'); await sleep(500);

    const redirectBase = `https://${id}.chromiumapp.org/`;
    check('getRedirectURL', (await probe.evaluate(() => window.probe.redirect('cb'))) === redirectBase + 'cb' && (await probe.evaluate(() => window.probe.redirect())) === redirectBase, {});
    check('getRedirectURL in the service worker', (await probe.evaluate(() => window.probe.viaWorker({type: 'worker-redirect', path: 'w'}))).url === redirectBase + 'w', {});

    // ---- chrome.system.display: the monitors Electron reports, in Chrome's shape
    const displays = await probe.evaluate(() => window.probe.displays());
    const electronDisplays = await app.main(({screen}) => ({count: screen.getAllDisplays().length, primary: screen.getPrimaryDisplay().bounds, scale: screen.getPrimaryDisplay().scaleFactor}));
    check('system.display.getInfo lists the monitors, primary first, bounds and dpi as Electron reports', Array.isArray(displays) && displays.length === electronDisplays.count && displays[0].isPrimary === true
      && displays[0].bounds.width === electronDisplays.primary.width && displays[0].dpiX === 96 * electronDisplays.scale && typeof displays[0].workArea.top === 'number' && typeof displays[0].id === 'string', displays);
    await probe.evaluate(() => window.probe.listenDisplays());

    // ---- chrome.idle: queryState, the 15 s minimum, onStateChanged from a changed system state (powerMonitor is faked in the rig only)
    const idleNow = await probe.evaluate(() => window.probe.idleQuery(15));
    check('idle.queryState answers a state', ['active', 'idle', 'locked'].includes(idleNow.state), idleNow);
    check('idle.queryState(5) is refused like Chrome', /Error at parameter 'detectionIntervalInSeconds': Value must be at least 15/.test((await probe.evaluate(() => window.probe.idleQuery(5))).error || ''), {});
    await app.main(({powerMonitor}) => { globalThis.__idleReal = powerMonitor.getSystemIdleState; powerMonitor.getSystemIdleState = () => 'active'; });
    await probe.evaluate(() => window.probe.idleListen(15));
    await sleep(7500);   // the listener is noticed (slow look every 5 s) and the 'active' baseline recorded
    await app.main(({powerMonitor}) => { powerMonitor.getSystemIdleState = () => 'idle'; });
    const idleEvents = await until(async () => { const e = await probe.evaluate(() => window.probe.events()); return e.idle.length ? e.idle : null; }, 8000, 500);
    check('idle.onStateChanged delivers "idle" when the system goes idle', Array.isArray(idleEvents) && idleEvents[0] === 'idle', idleEvents);
    await app.main(({powerMonitor}) => { powerMonitor.getSystemIdleState = () => 'active'; });
    const idleBack = await until(async () => { const e = await probe.evaluate(() => window.probe.events()); return e.idle.length > 1 ? e.idle : null; }, 8000, 500);
    check('and "active" when input resumes', Array.isArray(idleBack) && idleBack[1] === 'active', idleBack);
    await app.main(({powerMonitor}) => { powerMonitor.getSystemIdleState = globalThis.__idleReal; });

    // ---- chrome.sidePanel.open: Chrome's gesture rule and errors; the panel opens beside a page
    await app.act({type: 'tab.new', url: fx.base + '/'});
    const pageTab = await until(() => app.main(({webContents}, url) => webContents.getAllWebContents().find(w => w.getURL() === url)?.id, fx.base + '/'), 10000);
    check('web tab open', Number.isInteger(pageTab), {pageTab});
    await sleep(800);
    // Playwright's evaluate carries a user gesture; the call is made 6 s later, after the page's transient activation (5 s) has run out.
    const noGesture = await probe.evaluate(tab => new Promise(resolve => setTimeout(() => resolve(window.probe.openPanel({tabId: tab})), 6000)), pageTab);
    check('sidePanel.open without a user gesture: Chrome\'s message', noGesture.error === '`sidePanel.open()` may only be called in response to a user gesture.', noGesture);
    const gestureCall = code => app.main(({BrowserWindow, webContents}, args) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === args.url); return wc.executeJavaScript(args.code, true); }, {url: probeUrl, code});
    check('sidePanel.open with neither tabId nor windowId', (await gestureCall('window.probe.openPanel({})')).error === 'At least one of `tabId` and `windowId` must be provided', {});
    check('sidePanel.open for a tab that does not exist', (await gestureCall('window.probe.openPanel({tabId: 987654})')).error === 'No tab with id: 987654.', {});
    check('sidePanel.getOptions: the manifest\'s default path', (await probe.evaluate(() => window.probe.panelOptions({}))).path === 'panel.html', {});
    const openedPanel = await gestureCall(`window.probe.openPanel({tabId: ${pageTab}})`);
    check('sidePanel.open with a user gesture opens the panel', openedPanel.ok === true, openedPanel);
    const panelUp = await until(() => app.main(({webContents}, id) => webContents.getAllWebContents().some(w => w.getURL() === `chrome-extension://${id}/panel.html`), id), 8000, 400);
    check('the panel page is loaded beside the tab', panelUp, {});
    const openedEvent = await until(async () => { const e = await probe.evaluate(() => window.probe.events()); return e.opened.length ? e.opened : null; }, 5000, 300);
    check('sidePanel.onOpened is delivered', Array.isArray(openedEvent), openedEvent);
    check('sidePanel.close closes it', (await gestureCall(`window.probe.closePanel({tabId: ${pageTab}})`)).ok === true, {});
    await sleep(800);

    const authWindowInfo = () => app.main(({BrowserWindow}) => { const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && / sign-in · /.test(x.getTitle())); return w ? {title: w.getTitle(), url: w.webContents.getURL(), visible: w.isVisible()} : null; });
    const answerProvider = (script) => app.main(async ({BrowserWindow}, code) => { const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && / sign-in · /.test(x.getTitle())); return w ? w.webContents.executeJavaScript(code) : null; }, script);
    const redirectParam = `redirect_uri=${encodeURIComponent(redirectBase + 'cb')}&state=s1`;

    // 1. Interactive flow from an extension page: the sign-in window opens on the provider, the person approves, the redirect is intercepted.
    const flow = probe.evaluate(url => window.probe.flow(url, true), `${fx.base}/authorize?${redirectParam}`).catch(e => ({error: 'rig: ' + e.message}));
    const opened = await until(authWindowInfo, 10000);
    check('the sign-in window opens on the provider, titled with the extension and host', opened && /Acira essentials probe sign-in · 127\.0\.0\.1:\d+/.test(opened.title) && opened.url.startsWith(fx.base + '/authorize'), opened);
    await sleep(500);
    const shot = await app.main(async ({BrowserWindow}) => { const w = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && / sign-in · /.test(x.getTitle())); const image = w ? await w.webContents.capturePage() : null; return image && !image.isEmpty() ? image.toPNG().toString('base64') : null; });
    if (shot) { await fs.mkdir('qa/artifacts/p9', {recursive: true}); await fs.writeFile('qa/artifacts/p9/identity-window.png', Buffer.from(shot, 'base64')); }
    await answerProvider("document.getElementById('approve').click()");
    const done = await flow;
    check('launchWebAuthFlow (interactive) resolves with the full redirect URL, query and fragment kept', done.url === `${redirectBase}cb?code=fake-code&state=s1#frag`, done);
    check('the sign-in window is gone afterwards', await until(async () => (await authWindowInfo()) === null, 5000), {});

    // 2. The same from the service worker.
    const workerFlow = probe.evaluate(url => window.probe.viaWorker({type: 'worker-flow', url, interactive: true}), `${fx.base}/authorize?${redirectParam}`).catch(e => ({error: 'rig: ' + e.message}));
    await until(authWindowInfo, 10000); await sleep(300);
    await answerProvider("document.getElementById('approve').click()");
    const workerDone = await workerFlow;
    check('launchWebAuthFlow from the service worker', workerDone.url === `${redirectBase}cb?code=fake-code&state=s1#frag`, workerDone);

    // 3. Closing the window before approving: the person declined.
    const declined = probe.evaluate(url => window.probe.flow(url, true), `${fx.base}/authorize?${redirectParam}`).catch(e => ({error: 'rig: ' + e.message}));
    await until(authWindowInfo, 10000);
    await app.main(({BrowserWindow}) => { BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && / sign-in · /.test(x.getTitle()))?.close(); });
    check('closing the window rejects with "The user did not approve access."', (await declined).error === 'The user did not approve access.', await declined);

    // 4. Non-interactive: a provider that redirects at once answers without a window; one that needs the person says so; a broken one fails to load.
    const auto = await probe.evaluate(url => window.probe.flow(url, false), `${fx.base}/auto?${redirectParam}`);
    check('non-interactive flow through a redirecting provider resolves', auto.url === `${redirectBase}cb?code=auto-code&state=s1`, auto);
    const needs = await probe.evaluate(url => window.probe.flow(url, false), `${fx.base}/login`);
    check('non-interactive flow that needs the person: "User interaction required."', needs.error === 'User interaction required.', needs);
    const broken = await probe.evaluate(url => window.probe.flow(url, false), `${fx.base}/broken`);
    check('an unreachable provider: "Authorization page could not be loaded."', broken.error === 'Authorization page could not be loaded.', broken);
    const invalid = await probe.evaluate(() => window.probe.flow('not a url', true));
    check('an invalid url is refused', /^(Authorization page could not be loaded\.|Invalid)/.test(invalid.error || ''), invalid);

    // 5. Google-account members, signed out: Chrome's answers.
    check('getAuthToken (non-interactive): "The user is not signed in."', (await probe.evaluate(() => window.probe.token(false))).error === 'The user is not signed in.', {});
    check('getAuthToken (interactive) says the same: nothing to sign in to', (await probe.evaluate(() => window.probe.token(true))).error === 'The user is not signed in.', {});
    const cb = await probe.evaluate(() => window.probe.tokenCallback(false));
    check('getAuthToken callback form sets lastError', cb.token === undefined && cb.lastError === 'The user is not signed in.', cb);
    check('getAuthToken from the service worker', (await probe.evaluate(() => window.probe.viaWorker({type: 'worker-token', interactive: false}))).error === 'The user is not signed in.', {});
    const info = await probe.evaluate(() => window.probe.userInfo());
    check('getProfileUserInfo: empty email and id', info.email === '' && info.id === '', info);
    check('removeCachedAuthToken succeeds', (await probe.evaluate(() => window.probe.removeToken())).value === true, {});
    check('the main process survived', await app.main(() => true), {});
  });
} catch (error) {
  console.log('ERROR', error && error.stack || error); results.error = String(error && error.message || error);
} finally {
  fx.close();
  const failed = Object.entries(results.checks).filter(([, c]) => !c.ok).map(([n]) => n);
  results.failed = failed;
  console.log(failed.length || results.error ? `DONE with ${failed.length} failing: ${failed.join('; ')}` : 'DONE all pass');
  await writeResult('essentials-live', results);
  process.exit(0);
}
