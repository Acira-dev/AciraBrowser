// Real-app proof of extension DevTools panels (P9): React DevTools (Chrome Web Store, installed into an isolated profile) on a local React page.
// DevTools is hosted in a hidden window of the rig (webContents.setDevToolsWebContents), so nothing appears on screen or takes focus.
// Checks: the Components and Profiler panels appear and render, chrome.devtools.inspectedWindow.tabId / eval, network.onNavigated.
// Usage: node qa/p9/devtools-live.mjs [--dump]   (after the build; takes a native slot; needs the network for the Web Store install)
import path from 'node:path';
import fs from 'node:fs/promises';
import {build} from 'esbuild';
import {withApp, fixtureServer, install, until, sleep, writeResult} from './lib.mjs';

const REACT_DEVTOOLS = 'fmkadmapgofadopljbjfkapdkoienihi';
const results = {checks: {}};
const check = (name, ok, detail) => { results.checks[name] = {ok: !!ok, detail}; console.log((ok ? 'PASS ' : 'FAIL ') + name, JSON.stringify(detail).slice(0, 500)); };
const dump = process.argv.includes('--dump');

const out = path.resolve('.qa-profiles/p9-react'); await fs.mkdir(out, {recursive: true});
await build({entryPoints: [path.resolve('qa/p9/fixtures/react-page/app.jsx')], bundle: true, format: 'iife', outfile: path.join(out, 'app.js'), jsx: 'automatic',
  define: {'process.env.NODE_ENV': '"development"'}, logLevel: 'error', nodePaths: [path.resolve('node_modules')]});
const bundle = await fs.readFile(path.join(out, 'app.js'));
const html = '<!doctype html><meta charset=utf-8><title>P9 React page</title><div id=root></div><script src="/app.js"></script>';
const fx = await fixtureServer((req, res, url) => {
  if (url.pathname === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(bundle); return true; }
  if (url.pathname === '/' || url.pathname === '/two') { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(html); return true; }
  return false;
});

/** Texts of every role=tab element in a page, looking through shadow roots (DevTools' panel strip). */
const tabLabels = () => {
  const found = [];
  const walk = root => { for (const el of root.querySelectorAll('*')) { if (el.getAttribute && el.getAttribute('role') === 'tab') found.push((el.getAttribute('aria-label') || el.textContent || '').trim()); if (el.shadowRoot) walk(el.shadowRoot); } };
  walk(document);
  return found;
};
const clickTab = label => {
  const walk = root => { for (const el of root.querySelectorAll('*')) { if (el.getAttribute && el.getAttribute('role') === 'tab' && (el.getAttribute('aria-label') || el.textContent || '').includes(label)) { for (const type of ['mousedown', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, {bubbles: true, composed: true, button: 0, view: window})); return true; } if (el.shadowRoot && walk(el.shadowRoot)) return true; } return false; };
  return walk(document);
};

try {
  await withApp('devtools', async app => {
    const installed = await install(app, REACT_DEVTOOLS);
    check('React DevTools installs from the Web Store', !installed.error, {ms: installed.ms, error: installed.error, permissions: installed.entry && installed.entry.permissions});
    if (installed.error) throw Error('install failed: ' + installed.error);
    await app.act({type: 'tab.new', url: fx.base + '/'});
    const tabId = await until(() => app.main(({webContents}, url) => webContents.getAllWebContents().find(w => w.getURL() === url)?.id, fx.base + '/'), 15000);
    check('local React page open', Number.isInteger(tabId), {tabId});
    await sleep(2000);
    const probeHook = () => app.main(({webContents}, id) => webContents.fromId(id).executeJavaScript(`document.getElementById('counter')?.textContent + '|' + !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ + '|' + (window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size ?? -1)`), tabId);
    // React DevTools registers its page hook from its service worker shortly after install: reload until the page has it.
    for (let attempt = 0; attempt < 4 && !/\|true\|[1-9]/.test(await probeHook()); attempt++) { await app.main(({webContents}, id) => webContents.fromId(id).reload(), tabId); await sleep(3000); }
    const rendered = await app.main(({webContents}, id) => webContents.fromId(id).executeJavaScript(`document.getElementById('counter')?.textContent + '|' + !!window.__REACT_DEVTOOLS_GLOBAL_HOOK__ + '|' + (window.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.size ?? -1)`), tabId);
    check('the page renders and React DevTools\' hook sees the renderer', /^Clicks: 0\|true\|[1-9]/.test(rendered), rendered);

    // DevTools in a hidden window of the rig.
    const before = new Set(app.context.pages());
    await app.main(({BrowserWindow, webContents}, id) => {
      const target = webContents.fromId(id);
      // The front-end must live in the inspected page's session: that is the browser context whose extensions DevTools lists, and the only one
      // allowed to load their chrome-extension:// pages (a host in the default session shows the built-in panels only).
      const host = new BrowserWindow({show: false, width: 1100, height: 760, webPreferences: {sandbox: true, session: target.session}});
      globalThis.__devtoolsHost = host;
      target.setDevToolsWebContents(host.webContents);
      target.openDevTools({mode: 'detach', activate: false});
    }, tabId);
    const devtools = await until(async () => app.context.pages().find(p => { try { return !before.has(p) && /^devtools:\/\//.test(p.url()); } catch { return false; } }), 20000, 400);
    check('DevTools front-end opens', !!devtools, {url: devtools && devtools.url()});
    if (!devtools) throw Error('no DevTools page');
    let labels = [];
    await until(async () => { labels = await devtools.evaluate(tabLabels); return labels.some(l => /Components/.test(l)); }, 25000, 800);
    results.devtoolsTabs = labels;
    check('the Components panel appears in DevTools', labels.some(l => /Components/.test(l)), labels);
    check('the Profiler panel appears in DevTools', labels.some(l => /Profiler/.test(l)), labels);
    if (dump) console.log('TABS', JSON.stringify(labels));

    const shoot = async name => { const shot = await app.main(async () => { const image = await globalThis.__devtoolsHost.webContents.capturePage(); return image.isEmpty() ? null : image.toPNG().toString('base64'); }); if (shot) { await fs.mkdir('qa/artifacts/p9', {recursive: true}); await fs.writeFile('qa/artifacts/p9/' + name + '.png', Buffer.from(shot, 'base64')); } };
    // The panels render: their pages are extension frames inside DevTools.
    const frameText = async pattern => until(async () => {
      for (const frame of devtools.frames()) { if (!frame.url().includes(REACT_DEVTOOLS)) continue; try { const text = await frame.evaluate(() => document.body.innerText); if (pattern.test(text)) return text.slice(0, 300); } catch {} }
      return null;
    }, 15000, 500);
    await devtools.evaluate(clickTab, 'Components');
    const components = await frameText(/Counter/);
    await shoot('devtools-react-components');
    check('Components lists the page\'s components (App, Counter)', !!components && /App/.test(components), components);
    await devtools.evaluate(clickTab, 'Profiler');
    const profiler = await frameText(/rofil/);
    await shoot('devtools-react-profiler');
    check('Profiler panel renders', !!profiler, profiler);
    if (dump) console.log('FRAMES', devtools.frames().map(f => f.url()).join('\n'));

    // The chrome.devtools.* members the panels depend on, read from the extension's devtools page (a frame inside DevTools).
    let dtFrame = null; for (const f of devtools.frames()) { if (!f.url().includes(REACT_DEVTOOLS)) continue; try { if (await f.evaluate(() => typeof chrome !== 'undefined' && !!chrome.devtools && !!chrome.devtools.inspectedWindow)) { dtFrame = f; break; } } catch {} }
    results.frames = devtools.frames().map(f => f.url());
    if (dtFrame) {
      const info = await dtFrame.evaluate(async () => {
        const d = chrome.devtools, r = {};
        r.tabId = d.inspectedWindow.tabId;
        r.eval = await new Promise(resolve => d.inspectedWindow.eval('1 + 1', (result, error) => resolve([result, error && (error.value || error.description || error.code)])));
        window.__navigated = []; d.network.onNavigated.addListener(url => window.__navigated.push(url));
        r.panels = typeof d.panels.create + '/' + typeof d.panels.themeName + '/' + d.panels.themeName;
        return r;
      });
      check('inspectedWindow.tabId is the inspected tab', info.tabId === tabId, info);
      check('inspectedWindow.eval runs in the inspected page', info.eval[0] === 2, info.eval);
      await app.main(({webContents}, a) => webContents.fromId(a.id).loadURL(a.url), {id: tabId, url: fx.base + '/two'});
      const navigated = await until(() => dtFrame.evaluate(() => window.__navigated.length ? window.__navigated : null), 8000, 400).catch(() => null);
      check('network.onNavigated fires on navigation', Array.isArray(navigated) && navigated.some(u => u.endsWith('/two')), navigated);
    } else check('the extension\'s devtools page is a frame of DevTools', false, results.frames);

    await app.main(({webContents}, id) => { try { webContents.fromId(id)?.closeDevTools(); } catch {} try { globalThis.__devtoolsHost?.destroy(); } catch {} }, tabId);
  });
} catch (error) {
  console.log('ERROR', error && error.stack || error); results.error = String(error && error.message || error);
} finally {
  fx.close();
  const failed = Object.entries(results.checks).filter(([, c]) => !c.ok).map(([n]) => n);
  results.failed = failed;
  console.log(failed.length || results.error ? `DONE with ${failed.length} failing: ${failed.join('; ')}` : 'DONE all pass');
  await writeResult('devtools-live', results);
  process.exit(0);
}
