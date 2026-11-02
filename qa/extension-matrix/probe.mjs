// Extension compatibility probe on a fresh, named QA run; old evidence/profiles are never removed.
// ACIRA_EXT_MATRIX_RUN identifies a shared run for explicit PHASES=1 then PHASES=2. Prefer run-current.mjs.
// Phase 1 (fresh app): install, manifest, service worker, toolbar pin, content script, popup, options page, native messaging, API surface.
// Phase 2 (restart with a fast memory saver): restore, pin, service worker, content script again, SW idle wake, tab sleep and wake.
// No account, vault or credential is touched; password managers are only installed and opened at their sign-in screen.
// Service workers are read from Electron's session.serviceWorkers (Playwright does not list extension workers); chrome.* behaviour is probed from an
// extension page opened in a hidden window of the same profile session, because worker contexts cannot be evaluated from here.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {CATALOG} from './catalog.mjs';
import {launch, install, installedManifest, summarize, sleep} from './lib.mjs';
import {SPECIFIC} from './specific.mjs';
import {RUN, artifactIdentity, sha} from './run-context.mjs';

const slug = process.argv[2], item = CATALOG.find(entry => entry.slug === slug);
if (!item) { console.error('usage: probe.mjs <slug>; one of ' + CATALOG.map(entry => entry.slug).join(', ')); process.exit(2); }
const PHASES = process.env.PHASES || 'all';
if (!['all', '1', '2'].includes(PHASES)) throw Error('PHASES must be all, 1 or 2.');
if (PHASES === '2' && !process.env.ACIRA_EXT_MATRIX_RUN) throw Error('Phase 2 requires the exact preceding run identifier.');
const output = path.join(RUN.output, 'phase-' + PHASES), resultFile = path.join(output, slug + '.json');
await fs.mkdir(output, {recursive: true});
const R = {runId: RUN.id, phase: PHASES, slug, id: item.id, name: item.name, started: new Date().toISOString(),
  status: 'running', steps: {}, errors: [], artifacts: [], limitations: [
    'Per-column observations, not a claim that every extension works. Accounts/vaults/desktop unlock are untested.',
    'Real installed native hosts are not deliberately connected by this probe; missing-host API behavior is separate.',
    'Permission review is answered by the QA adapter; real review UI is qualified separately.',
  ]};
if (PHASES === '2') {
  const priorFile = path.join(RUN.output, 'phase-1', slug + '.json'), bytes = await fs.readFile(priorFile), old = JSON.parse(bytes);
  if (old.runId !== RUN.id || old.slug !== slug || old.fatal || !old.artifacts?.length) throw Error('No complete same-run phase 1.');
  Object.assign(R, {steps: old.steps || {}, manifest: old.manifest, api: old.api, native: old.native,
    review: old.review, contentWorlds: old.contentWorlds, priorReceipt: {file: priorFile, sha256: sha(bytes)}, expectedArtifact: old.artifacts[0]});
}
await fs.writeFile(resultFile, JSON.stringify(R, null, 2), {flag: 'wx'});
const PAGE = `<!doctype html><meta charset=utf-8><title>Acira extension fixture</title><body><h1>Fixture page</h1><p>Sign in below.</p><form action="/login" method="post"><input name="user" type="text" autocomplete="username"><input name="pass" type="password" autocomplete="current-password"><button>Sign in</button></form><textarea id="t" rows="4" cols="40"></textarea><a href="/two">two</a></body>`;
const fixture = await new Promise(resolve => { const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE); }); server.listen(0, '127.0.0.1', () => resolve({server, base: `http://127.0.0.1:${server.address().port}`})); });
const until = async (read, ms = 8000, every = 250) => { const end = Date.now() + ms; let value; do { value = await read(); if (value) return value; await sleep(every); } while (Date.now() < end); return value; };
const step = async (name, fn) => { try { R.steps[name] = await fn(); } catch (error) { R.steps[name] = {status: 'error', detail: String(error.message || error).slice(0, 500)}; } console.log(name.padEnd(18), JSON.stringify(R.steps[name]).slice(0, 380)); };
const safeUrl = page => { try { return page.url(); } catch { return ''; } };
let app, manifestInfo, partition, helper;

const attachLogging = () => {
  const attach = page => { page.on('console', message => { if (message.type() === 'error' && R.errors.length < 80) R.errors.push({page: safeUrl(page).slice(0, 90), text: message.text().slice(0, 300)}); }); page.on('pageerror', error => { if (R.errors.length < 80) R.errors.push({page: safeUrl(page).slice(0, 90), text: String(error.message).slice(0, 300)}); }); };
  app.context.pages().forEach(attach); app.context.on('page', attach);
};
const extPages = () => app.context.pages().filter(page => safeUrl(page).startsWith(`chrome-extension://${item.id}/`) && page !== helper);
const swRunning = () => app.main(({session}, args) => Object.values(session.fromPartition(args.partition).serviceWorkers.getAllRunning()).some(worker => worker.scope.startsWith(`chrome-extension://${args.id}/`)), {partition, id: item.id}).catch(() => false);
const openTab = async (url, match) => { await app.act({type: 'tab.new', url}); const page = await until(() => app.web(match || url), 25000, 400); const tabs = (await app.state()).tabs; return {page, tabId: tabs.at(-1)?.id}; };
const worlds = async page => {
  const cdp = await app.context.newCDPSession(page), found = [];
  cdp.on('Runtime.executionContextCreated', ({context}) => found.push(context));
  await cdp.send('Runtime.enable'); await sleep(700); await cdp.send('Runtime.disable').catch(() => {}); await cdp.detach().catch(() => {});
  return found.filter(context => (context.origin || '').startsWith(`chrome-extension://${item.id}`)).map(context => ({name: context.name, type: context.auxData?.type}));
};
const contentUrl = () => {
  const spec = SPECIFIC[slug]; if (spec?.url) return {url: spec.url, match: spec.match};
  const matches = manifestInfo.manifest.content_scripts?.flatMap(script => script.matches || []) || [];
  if (!matches.length || matches.some(pattern => ['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'].includes(pattern))) return {url: fixture.base + '/', match: fixture.base + '/'};
  const host = matches.map(pattern => pattern.match(/^\*?[a-z*]*:\/\/(?:\*\.)?([a-z0-9.-]+)\//i)?.[1]).find(Boolean);
  return host ? {url: `https://${host}/`, match: address => { try { const name = new URL(address).hostname; return name === host || name.endsWith('.' + host); } catch { return false; } }} : {url: fixture.base + '/', match: fixture.base + '/'};
};
/** Any HTML page the package ships, preferring the ones an extension normally shows. */
const anyHtml = async folder => {
  const m = manifestInfo.manifest, preferred = [(m.action || m.browser_action || {}).default_popup, m.options_ui?.page, m.options_page].filter(Boolean);
  if (preferred.length) return preferred[0].replace(/^\//, '');
  const walk = async (dir, depth) => { for (const entry of await fs.readdir(dir, {withFileTypes: true})) { const full = path.join(dir, entry.name); if (entry.isFile() && entry.name.endsWith('.html')) return full; if (entry.isDirectory() && depth < 3 && !entry.name.startsWith('_')) { const found = await walk(full, depth + 1); if (found) return found; } } return null; };
  const found = await walk(folder, 0); return found ? path.relative(folder, found).split(path.sep).join('/') : null;
};
const openHelper = async () => {
  const rel = await anyHtml(manifestInfo.folder); if (!rel) return null;
  await app.main(({BrowserWindow, session}, args) => { const window = new BrowserWindow({show: false, width: 500, height: 600, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}}); globalThis.__extHelper = window; window.loadURL(args.url); }, {partition, url: `chrome-extension://${item.id}/${rel}`});
  helper = await until(() => app.context.pages().find(page => safeUrl(page).startsWith(`chrome-extension://${item.id}/${rel.split('?')[0]}`)), 10000, 300);
  if (helper) { await helper.waitForLoadState('domcontentloaded').catch(() => {}); await sleep(1200); }
  return helper ? rel : null;
};
const closeHelper = async () => { await app.main(() => { try { globalThis.__extHelper?.destroy(); } catch {} }).catch(() => {}); helper = null; };
const NATIVE = `(async () => { const guard = read => { try { return read(); } catch (error) { return 'threw: ' + String(error.message || error).slice(0, 160); } };
  const out = { connectNative: guard(() => typeof chrome.runtime.connectNative), sendNativeMessage: guard(() => typeof chrome.runtime.sendNativeMessage) };
  out.call = await new Promise(resolve => { try { chrome.runtime.sendNativeMessage('com.acira.qa.nohost', {ping: 1}, response => resolve({response: response === undefined ? null : response, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message})); } catch (error) { resolve({threw: String(error.message || error).slice(0, 160)}); } setTimeout(() => resolve({timeout: true}), 5000); });
  try { const port = chrome.runtime.connectNative('com.acira.qa.nohost'); out.port = await new Promise(resolve => { port.onDisconnect.addListener(() => resolve({disconnected: true, lastError: chrome.runtime.lastError && chrome.runtime.lastError.message})); setTimeout(() => resolve({stillOpen: true}), 4000); }); } catch (error) { out.port = {threw: String(error.message || error).slice(0, 160)}; }
  return out; })()`;
const SKIP_PERMISSIONS = new Set(['activeTab', 'unlimitedStorage', 'clipboardWrite', 'clipboardRead', 'declarativeNetRequestFeedback', 'webRequestBlocking', 'webRequestAuthProvider', 'background', 'favicon', 'nativeMessaging', 'geolocation']);
const NAMESPACE = {declarativeNetRequestWithHostAccess: 'declarativeNetRequest'};
const popupWindowGuard = () => app.main(({app, session}, partition) => { const target = session.fromPartition(partition); app.on('browser-window-created', (_event, window) => { if (window.webContents?.session !== target || globalThis.__extHelper === window) return; window.setFocusable(false); window.setIgnoreMouseEvents(true); window.show = () => {}; window.showInactive = () => {}; window.focus = () => {}; globalThis.__popup = window; }); }, partition);
const actionButtons = () => app.ui.locator('.native-extension-actions:visible browser-action-list button.action').count();
const bindArtifact = async () => {
  const identity = await artifactIdentity(app), expected = R.expectedArtifact || R.artifacts[0];
  if (expected && JSON.stringify(identity) !== JSON.stringify(expected)) throw Error('Extension artifact identity changed across phases/restart.');
  R.artifacts.push(identity);
};

try {
  if (PHASES === 'all' || PHASES === '1') {
    app = await launch('ext-' + slug, {fresh: process.env.REUSE !== '1'}); attachLogging();
    await bindArtifact();
    partition = (await app.state()).browserProfiles[0].partition; await popupWindowGuard();
    await step('install', async () => {
      const listed = (await app.ext({type: 'list'})).extensions.find(e => e.id === item.id);
      const result = listed && process.env.REUSE === '1' ? {entry: listed, ms: 0} : await install(app, item.id);
      R.review = (await app.reviews()).at(-1) || null;
      return result.error ? {status: 'fail', detail: result.error} : {status: 'pass', detail: {name: result.entry.name, version: result.entry.version, seconds: Math.round(result.ms / 1000), warnings: result.entry.supportWarnings}};
    });
    if (R.steps.install.status !== 'pass') throw new Error('install failed; nothing else to test');
    manifestInfo = await installedManifest(app, item.id); R.manifest = summarize(manifestInfo.manifest);
    await step('service-worker', async () => {
      if (!manifestInfo.manifest.background?.service_worker) return {status: 'n/a', detail: 'no service worker in manifest'};
      const running = await until(swRunning, 15000, 500); return {status: running ? 'pass' : 'fail', detail: running ? 'running after install' : 'no running worker for the extension scope after 15 s'};
    });
    await step('pin', async () => {
      const onNewTab = await actionButtons();
      const result = await app.ext({type: 'pin', extensionId: item.id, pinned: true}); const entry = result.extensions.find(e => e.id === item.id);
      await sleep(1500); const afterPinOnNewTab = await actionButtons();
      return {status: entry?.pinned ? 'pass' : 'fail', detail: {pinned: entry?.pinned, hasAction: entry?.hasAction, buttonOnNewTabPage: afterPinOnNewTab > 0}};
    });
    await step('content', async () => {
      const spec = SPECIFIC[slug] || {}, target = contentUrl();
      const {page, tabId} = await openTab(target.url, target.match); if (!page) return {status: 'fail', detail: 'page did not open: ' + target.url};
      if (spec.blockingOff) await app.svc({type: 'privacy.set', tabId, blocking: false, scope: 'profile'}).catch(() => {});
      if (/youtube\.com/.test(target.url)) { await app.act({type: 'tab.mute', id: tabId, muted: true}); await page.evaluate(() => document.querySelector('video')?.pause()).catch(() => {}); }
      await sleep(spec.wait ?? 2500);
      const contexts = await worlds(page);
      const specific = spec.check ? await spec.check({app, page, id: item.id}).catch(error => ({ok: false, detail: 'check threw: ' + String(error.message || error)})) : null;
      R.contentWorlds = contexts;
      const injected = contexts.length > 0, scriptsDeclared = (manifestInfo.manifest.content_scripts || []).length > 0;
      const status = !scriptsDeclared ? (specific ? (specific.ok ? 'pass' : 'fail') : 'n/a') : (injected && (!specific || specific.ok) ? 'pass' : (injected ? 'partial' : 'fail'));
      return {status, detail: {url: target.url, extensionWorlds: contexts.length, specific}};
    });
    await step('toolbar-on-web-tab', async () => { const count = await until(async () => (await actionButtons()) || null, 8000, 400); const tab = (await app.state()).tabs.at(-1); return {status: (manifestInfo.manifest.action || manifestInfo.manifest.browser_action) ? (count ? 'pass' : 'fail') : 'n/a', detail: {buttons: count || 0, activeTab: {url: (tab?.url || '').slice(0, 60), loading: !!tab?.loading, kind: tab?.contentKind}}}; });
    await step('popup', async () => {
      if (!manifestInfo.manifest.action && !manifestInfo.manifest.browser_action) return {status: 'n/a', detail: 'no toolbar action in manifest'};
      const popupFile = (manifestInfo.manifest.action || manifestInfo.manifest.browser_action).default_popup;
      await app.ui.locator('.native-extension-actions:visible browser-action-list button.action').first().click({timeout: 8000});
      const failedRequests = [], onFailed = request => failedRequests.push(request.url().slice(0, 120) + ' ' + (request.failure()?.errorText || ''));
      const popup = await until(() => { const page = extPages()[0]; if (page && !page.__acira) { page.__acira = true; page.on('requestfailed', onFailed); } return page; }, 9000, 300);
      if (!popup) return {status: popupFile ? 'fail' : 'n/a', detail: popupFile ? 'toolbar click did not open ' + popupFile : 'click handler only (no default_popup); nothing to open'};
      const consoleErrors = []; popup.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200)); }); popup.on('pageerror', error => consoleErrors.push('pageerror: ' + String(error.message || error).slice(0, 200)));
      await popup.waitForLoadState('domcontentloaded').catch(() => {}); await sleep(+process.env.POPUP_WAIT || 2000);
      const content = await popup.evaluate(() => ({title: document.title, textLength: document.body?.innerText.length || 0, sample: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 140), elements: document.getElementsByTagName('*').length, chromeRuntime: (() => { try { return typeof chrome.runtime.id; } catch (error) { return 'threw: ' + String(error.message || error).slice(0, 140); } })()}));
      content.failedRequests = failedRequests.slice(0, 5); content.consoleErrors = consoleErrors.slice(0, 5);
      if (process.env.SHOT) await popup.screenshot({path: path.join(output, `${slug}-popup.png`)}).catch(() => {}); popup.off('requestfailed', onFailed);
      await app.main(() => { globalThis.__popup?.close(); }).catch(() => {});
      return {status: content.textLength > 0 ? 'pass' : 'partial', detail: content};
    });
    const rel = await openHelper(); R.helperPage = rel;
    await step('api-surface', async () => {
      if (!helper) return {status: 'n/a', detail: 'the package has no HTML page to probe from'};
      const permissions = [...new Set((manifestInfo.manifest.permissions || []).filter(p => !SKIP_PERMISSIONS.has(p)).map(p => NAMESPACE[p] || p))];
      const probe = await helper.evaluate(async permissions => { const guard = read => { try { return read(); } catch (error) { return 'threw: ' + String(error.message || error).slice(0, 140); } }; const out = { namespaces: guard(() => Object.keys(chrome).sort()), missing: permissions.filter(name => guard(() => typeof chrome[name]) === 'undefined'), runtimeId: guard(() => typeof chrome.runtime.id), storageSync: guard(() => typeof chrome.storage.sync), storageLocal: guard(() => typeof chrome.storage.local), userScripts: guard(() => typeof chrome.userScripts) }; out.storageSyncCall = await new Promise(resolve => { try { chrome.storage.sync.get(['acira-qa'], value => resolve({value: value === undefined ? 'undefined' : 'object', lastError: chrome.runtime.lastError && chrome.runtime.lastError.message})); } catch (error) { resolve({threw: String(error.message || error).slice(0, 140)}); } setTimeout(() => resolve({timeout: true}), 3000); }); return out; }, permissions);
      R.api = probe; return {status: probe.missing.length ? 'partial' : 'pass', detail: {missingNamespaces: probe.missing, storageSync: probe.storageSync, storageSyncCall: probe.storageSyncCall, userScripts: probe.userScripts}};
    });
    await step('native-messaging', async () => {
      if (!helper) return {status: 'n/a', detail: 'no extension page to probe from'};
      R.native = await helper.evaluate(NATIVE); const wants = R.manifest.nativeMessaging;
      // Real desktop/vault integration requires a separate authorized hardware/account journey.
      return {status: wants ? 'unverified-desktop-integration' : 'n/a', detail: {declaresPermission: wants, missingHostProbe: R.native, realHostProbed: false}};
    });
    await step('options', async () => {
      const page = manifestInfo.manifest.options_ui?.page || manifestInfo.manifest.options_page; if (!page) return {status: 'n/a', detail: 'no options page declared'};
      const url = `chrome-extension://${item.id}/${page.replace(/^\//, '')}`;
      // Render check: the options page in a window of the profile session.
      await closeHelper(); await app.main(({BrowserWindow, session}, args) => { const window = new BrowserWindow({show: false, width: 800, height: 700, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}}); globalThis.__extHelper = window; window.loadURL(args.url); }, {partition, url});
      helper = await until(() => app.context.pages().find(p => safeUrl(p).startsWith(url.split('?')[0])), 10000, 300); if (!helper) return {status: 'fail', detail: 'options page did not load: ' + url};
      await sleep(2000); const content = await helper.evaluate(() => ({title: document.title, textLength: document.body?.innerText.length || 0, sample: (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 120)}));
      // Route check: can the extension open its own options page as a tab (chrome.runtime.openOptionsPage), the one route a person has?
      const before = extPages().length; await helper.evaluate(() => { try { chrome.runtime.openOptionsPage(); } catch (error) { return String(error); } }).catch(() => {}); await sleep(3000);
      const tab = extPages().length > before; const tabs = (await app.state()).tabs;
      return {status: content.textLength > 0 ? (tab ? 'pass' : 'partial') : 'partial', detail: {...content, openOptionsPageOpensTab: tab, tabUrls: tabs.slice(-2).map(t => t.url)}};
    });
    if (SPECIFIC[slug]?.extra) await step('extra', () => SPECIFIC[slug].extra({app, helper: helper || null, id: item.id, manifest: manifestInfo.manifest}));
    await closeHelper(); await app.close(); app = null;
  }
  if (PHASES === 'all' || PHASES === '2') {
    app = await launch('ext-' + slug, {fresh: false, env: {ACIRA_MEMORY_SAVER_DEBUG: '1', ACIRA_MEMORY_SAVER_FREEZE_MS: '3000', ACIRA_MEMORY_SAVER_IDLE_MS: '9000', ACIRA_MEMORY_SAVER_TICK_MS: '2000'}}); attachLogging();
    await bindArtifact();
    partition = (await app.state()).browserProfiles[0].partition; await popupWindowGuard(); manifestInfo = manifestInfo || await installedManifest(app, item.id);
    // Under Playwright every page reports isBeingCaptured() === true (even about:blank), which makes tab sleep refuse with 'capturing'. Stub it so the real sleep path runs.
    await app.main(({app, webContents}) => { const patch = wc => { wc.isBeingCaptured = () => false; }; webContents.getAllWebContents().forEach(patch); app.on('web-contents-created', (_event, wc) => patch(wc)); });
    await step('restart-restore', async () => {
      const entry = await until(async () => { const found = (await app.ext({type: 'list'})).extensions.find(e => e.id === item.id); return found && found.status === 'loaded' ? found : null; }, 20000, 500);
      const sw = await until(swRunning, 15000, 500); const listed = (await app.ext({type: 'list'})).extensions.find(e => e.id === item.id);
      const web = await openTab(fixture.base + '/', fixture.base + '/'); const button = await until(async () => (await actionButtons()) || null, 8000, 400);
      return {status: entry && (sw || !manifestInfo.manifest.background?.service_worker) && entry.pinned && (button || !(manifestInfo.manifest.action || manifestInfo.manifest.browser_action)) ? 'pass' : (entry ? 'partial' : 'fail'), detail: {loaded: !!entry, serviceWorker: !!sw, pinned: listed?.pinned, buttonShownOnWebTab: !!button, error: listed?.error}};
    });
    await step('restart-content', async () => {
      const spec = SPECIFIC[slug] || {}, target = contentUrl(); const {page, tabId} = await openTab(target.url, target.match); if (!page) return {status: 'fail', detail: 'page did not open'};
      if (spec.blockingOff) await app.svc({type: 'privacy.set', tabId, blocking: false, scope: 'profile'}).catch(() => {});
      await sleep(spec.wait ?? 2500); const contexts = await worlds(page);
      const specific = spec.check && slug !== 'momentum' ? await spec.check({app, page, id: item.id}).catch(error => ({ok: false, detail: String(error.message || error)})) : null;
      return {status: (manifestInfo.manifest.content_scripts || []).length ? (contexts.length && (!specific || specific.ok) ? 'pass' : (contexts.length ? 'partial' : 'fail')) : 'n/a', detail: {extensionWorlds: contexts.length, specific}};
    });
    if (process.env.IDLE !== '0') await step('sw-idle-wake', async () => {
      // Leave the worker alone for 45 s, see whether Chromium stopped it, then send it a message from an extension page and see whether it runs again.
      const alive0 = await swRunning(); await sleep(45000); const idle = await swRunning();
      const rel = await openHelper(); let wake = null;
      if (helper) wake = await helper.evaluate(() => new Promise(resolve => { try { chrome.runtime.sendMessage({type: 'acira-qa-ping'}, () => resolve({lastError: chrome.runtime.lastError && chrome.runtime.lastError.message})); } catch (error) { resolve({threw: String(error.message || error)}); } setTimeout(() => resolve({timeout: true}), 6000); })).catch(error => ({error: String(error.message || error)}));
      await sleep(2500); const after = await swRunning(); await closeHelper();
      return {status: after ? 'pass' : (manifestInfo.manifest.background?.service_worker ? 'fail' : 'n/a'), detail: {runningAtStart: alive0, runningAfter45sIdle: idle, stoppedByIdle: alive0 && !idle, wakeMessage: wake, runningAfterWake: after}};
    });
    await step('tab-sleep', async () => {
      const target = contentUrl(), local = target.url.startsWith('http://127.0.0.1'), url = local ? fixture.base + '/a' : target.url, match = local ? fixture.base + '/a' : target.match;
      const a = await openTab(url, match); if (!a.page) return {status: 'fail', detail: 'page did not open'}; await sleep(2500); const before = (await worlds(a.page)).length;
      await openTab(fixture.base + '/b', fixture.base + '/b');
      const slept = await until(async () => (await app.state()).tabs.find(t => t.id === a.tabId)?.sleeping, 70000, 1500);
      const lines = app.logs.join('').split(/\r?\n/).filter(line => line.includes('[tab-sleep]')).slice(-2);
      const swAsleep = await swRunning();
      await app.act({type: 'tab.select', id: a.tabId}); const woke = await until(() => app.web(match), 25000, 500); await sleep(3000);
      const after = woke ? (await worlds(woke)).length : -1; const swAwake = await swRunning();
      return {status: slept && woke && swAsleep && swAwake && (before === 0 || after > 0) ? 'pass' : 'partial', detail: {tabDiscarded: !!slept, worldsBefore: before, worldsAfterWake: after, swRunningWhileAsleep: swAsleep, swRunningAfterWake: swAwake, lastSweeps: slept ? undefined : lines}};
    });
    await app.close(); app = null;
  }
} catch (error) { R.fatal = String(error.message || error); console.log('FATAL', R.fatal); }
finally {
  R.finished = new Date().toISOString();
  try { await app?.close(); } catch (error) { R.cleanupError = String(error.message || error); }
  fixture.server.closeAllConnections();
  await new Promise(resolve => fixture.server.close(resolve));
  R.status = R.fatal || R.cleanupError ? 'failed' : 'completed-with-per-column-verdicts';
  await fs.writeFile(resultFile, JSON.stringify(R, null, 2));
  console.log(JSON.stringify({resultFile, status: R.status, runId: RUN.id}));
  process.exitCode = R.status === 'failed' ? 1 : 0;
}
