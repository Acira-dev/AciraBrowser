// Real-app check of the Chrome namespaces Acira adds to its extension engine (desktop/browser-services/extension-apis.cjs), with a local
// fixture extension (fixtures/api-probe) loaded the way Settings › Extensions › Developer loads a folder. One isolated profile, one app.
// Checks: chrome.offscreen (create/has/close, one per extension, DOMParser in the document, runtime messaging back), runtime.getContexts,
// chrome.userScripts behind the Allow user scripts switch (isolated USER_SCRIPT world, MAIN world, messaging answered by the worker),
// chrome.sidePanel.open (pane docked beside the page; capture saved), chrome.identity.launchWebAuthFlow (ends at the chromiumapp.org
// redirect without requesting it) and getAuthToken's error, chrome.bookmarks (read and change), read-only chrome.history/sessions.
// Usage (cwd = repo): node qa/extension-matrix/api-fixture.mjs   (D_VISIBLE=1 for a visible window and real-pixel captures)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {launch, sleep} from './lib.mjs';
import {RUN} from './run-context.mjs';

const out = path.join(RUN.output, 'api-fixture');
await fs.mkdir(out, {recursive: true});
const PAGE = '<!doctype html><meta charset=utf-8><title>User script fixture</title><script>window.aciraPageSecret = 1;</script><h1>User script fixture</h1><p>Plain page.</p>';
let authRequests = 0;
const server = await new Promise(resolve => { const s = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/auth') { authRequests++; res.statusCode = 302; res.setHeader('location', url.searchParams.get('redirect_uri') + '?code=fixture'); res.end(); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(PAGE);
}); s.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const until = async (read, ms = 8000, every = 250) => { const end = Date.now() + ms; let value; do { value = await read().catch(() => null); if (value) return value; await sleep(every); } while (Date.now() < end); return value; };
const R = {runId: RUN.id, started: new Date().toISOString(), checks: {}};
const check = (name, ok, detail) => { R.checks[name] = {ok: !!ok, detail}; console.log((ok ? 'PASS ' : 'FAIL ') + name, JSON.stringify(detail).slice(0, 400)); };
let app;
try {
  console.log('stage launch');
  app = await launch('api-fixture');
  console.log('stage launched');
  const folder = path.resolve('qa/extension-matrix/fixtures/api-probe');
  await app.main(({dialog}, folder) => { dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]}); }, folder);
  const loaded = await app.ext({type: 'load'});
  const entry = (loaded.extensions || []).find(e => e.name === 'Acira API probe');
  check('loads', entry?.status === 'loaded', {error: loaded.error, entry: entry && {id: entry.id, wantsUserScripts: entry.wantsUserScripts, userScriptsAllowed: entry.userScriptsAllowed}});
  if (!entry) throw Error('fixture did not load');
  const id = entry.id, state = await app.state(), partition = state.browserProfiles.find(p => p.id === app.profileId).partition;
  const helperUrl = `chrome-extension://${id}/probe.html`;
  const openHelper = async () => {
    const previous = new Set(app.context.pages());
    await app.main(({BrowserWindow, session}, args) => { try { globalThis.__extHelper?.destroy(); } catch {} const w = new BrowserWindow({show: false, width: 400, height: 300, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}}); globalThis.__extHelper = w; w.loadURL(args.url); }, {partition, url: helperUrl});
    const page = await until(async () => app.context.pages().find(p => { try { return !previous.has(p) && !p.isClosed() && p.url() === helperUrl; } catch { return false; } }), 10000, 300);
    await page?.waitForLoadState('domcontentloaded').catch(() => {}); await sleep(500); return page;
  };
  let helper = await openHelper();
  const send = message => helper.evaluate(m => new Promise(resolve => { chrome.runtime.sendMessage(m, reply => resolve(reply === undefined ? {noReply: true, lastError: chrome.runtime.lastError?.message} : reply)); }), message);
  const surface = await helper.evaluate(() => ({offscreen: typeof chrome.offscreen, sidePanel: typeof chrome.sidePanel, identity: typeof chrome.identity, userScripts: typeof chrome.userScripts, bookmarks: typeof chrome.bookmarks, history: typeof chrome.history, sessions: typeof chrome.sessions, search: typeof chrome.search, getContexts: typeof chrome.runtime.getContexts,
    userScriptsOff: (() => { try { chrome.userScripts.getScripts(); return 'available'; } catch (error) { return 'throws: ' + error.message; } })()}));
  check('namespaces', ['offscreen', 'sidePanel', 'identity', 'userScripts', 'bookmarks', 'history', 'sessions', 'search'].every(k => surface[k] === 'object') && surface.getContexts === 'function', surface);
  check('userScripts off by default (call throws, like Chrome 138+)', /^throws/.test(surface.userScriptsOff), surface.userScriptsOff);

  const off = await send({command: 'offscreen'});
  check('offscreen', off.ok && off.value.before === false && off.value.during === true && off.value.after === false && off.value.parsed?.items === 2 && /single offscreen/.test(off.value.duplicate.error || '') && /No current offscreen/.test(off.value.closeAgain.error || '') && off.value.contexts.length === 1, off);

  const switched = await app.ext({type: 'userScripts', extensionId: id, allowed: true});
  const after = (switched.extensions || []).find(e => e.id === id);
  check('Allow user scripts switch', after?.userScriptsAllowed === true && after?.status === 'loaded', {error: switched.error, allowed: after?.userScriptsAllowed});
  await sleep(1500); helper = await openHelper();
  const us = await send({command: 'userScripts'});
  check('userScripts register', us.ok && us.value.scripts.length === 2, us);
  await app.act({type: 'tab.new', url: base + '/page'});
  const page = await until(async () => app.web(base + '/page'), 15000, 300);
  const marks = page ? await until(async () => { const d = await page.evaluate(() => ({...document.documentElement.dataset})); return d.aciraUserScriptReply ? d : null; }, 10000, 300) || await page.evaluate(() => ({...document.documentElement.dataset})) : null;
  check('user script runs isolated, MAIN script sees the page, messaging answered', marks?.aciraUserScript === 'isolated' && marks?.aciraMainWorld === 'number' && /pong/.test(marks?.aciraUserScriptReply || ''), marks);

  const panel = await send({command: 'sidePanel'});
  const views = await app.main(({BaseWindow}) => BaseWindow.getAllWindows().filter(w => !w.isDestroyed()).map(w => w.contentView.children.map(v => { try { return {url: v.webContents?.getURL?.() || '', bounds: v.getBounds(), visible: v.getVisible()}; } catch { return null; } }).filter(Boolean)));
  const flat = views.flat(), frame = flat.find(v => v.url.endsWith('side-panel-frame.html')), content = flat.find(v => v.url.startsWith(`chrome-extension://${id}/panel.html`)), web = flat.find(v => v.url.startsWith(base));
  check('sidePanel opens docked beside the page', panel.ok && panel.value.opened.ok && frame && content && web && web.bounds.x + web.bounds.width <= frame.bounds.x && panel.value.contexts.length === 1, {panel, frame, content, web});
  try {
    // The QA window is hidden (in-window Acira dialogs would wait for a click when it is visible); show it, without focus, only for the capture.
    const shot = await app.main(async ({desktopCapturer, BaseWindow}) => {
      const w = BaseWindow.getAllWindows().find(x => !x.isDestroyed() && x.contentView.children.some(v => { try { return v.webContents?.getURL?.().endsWith('side-panel-frame.html'); } catch { return false; } }));
      if (!w) return null; const wasVisible = w.isVisible(); if (!wasVisible) w.showInactive(); await new Promise(r => setTimeout(r, 1200));
      try { const b = w.getBounds(); const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: b.width, height: b.height}}); const s = sources.find(x => x.name === w.getTitle()); return s ? s.thumbnail.toPNG().toString('base64') : null; }
      finally { if (!wasVisible) w.hide(); }
    });
    if (shot) { await fs.writeFile(path.join(out, 'side-panel.png'), Buffer.from(shot, 'base64')); R.sidePanelShot = path.join(out, 'side-panel.png'); }
  } catch (error) { R.shotError = String(error.message || error); }
  const closed = await send({command: 'closePanel'}); await sleep(800);
  const left = (await app.main(({BaseWindow}) => BaseWindow.getAllWindows().flatMap(w => w.isDestroyed() ? [] : w.contentView.children.map(v => { try { return v.webContents?.getURL() || ''; } catch { return ''; } })))).filter(u => u.endsWith('side-panel-frame.html'));
  check('sidePanel closes', closed.ok && left.length === 0, {closed, left});

  const auth = await send({command: 'identity', authUrl: base + '/auth'});
  check('identity.launchWebAuthFlow ends at the redirect', auth.ok && auth.value.flow.ok && auth.value.flow.value === `https://${id}.chromiumapp.org/cb?code=fixture` && authRequests === 1, {auth, authRequests});
  check('identity.getAuthToken fails clearly', auth.ok && auth.value.token.ok === false && /not signed in/.test(auth.value.token.error), auth.value?.token);

  await app.act({type: 'bookmark.add', url: base + '/page', title: 'Fixture bookmark', parentId: null, index: 0}).catch(error => { R.bookmarkAddError = String(error.message || error); });
  const stores = await send({command: 'stores'});
  check('bookmarks read and changed, history/sessions read and refused', stores.ok && stores.value.rootChildren.length === 2 && stores.value.write.ok === false && stores.value.bookmarkWrite.created === true && stores.value.bookmarkWrite.removed === true, stores);
} catch (error) {
  R.fatal = String(error.stack || error);
  console.error(error);
} finally {
  try { await app?.close(); } catch {}
  server.close();
  R.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(R, null, 2));
  console.log('result', path.join(out, 'result.json'));
}
if (R.fatal || Object.values(R.checks).some(check => !check.ok)) process.exitCode = 1;
