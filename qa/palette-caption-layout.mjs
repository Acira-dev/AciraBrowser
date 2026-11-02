import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { paletteNativeIdentity, paletteNativeSourceStable } from './palette-native-identity.mjs';

const identity = await paletteNativeIdentity();
if (identity.checkOnly) { console.log('Runtime accepted; layout test not run.'); process.exit(0); }
const require = createRequire(import.meta.url), core = require(path.join(identity.codeRoot, 'desktop/runtime.cjs'));
const out = path.resolve('docs/design/color-research/production-qa/caption-layout-' + Date.now()); await fs.mkdir(out, { recursive: true });
const root = path.join(identity.codeRoot, 'dist');
const server = http.createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://fixture').pathname), file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!file.toLowerCase().startsWith((root + path.sep).toLowerCase())) { response.writeHead(403).end(); return; }
    const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.png': 'image/png', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream';
    response.setHeader('Content-Type', type); response.end(await fs.readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = `http://127.0.0.1:${server.address().port}`;
const checks = [], cases = [], errors = [], record = (name, pass, detail = {}) => checks.push({ name, pass, ...detail });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  for (const width of [1400, 915, 610]) {
    const page = await browser.newPage({ viewport: { width, height: 820 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message)); await page.route(/^https?:/, route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    let state = core.createInitialState(); state.settings.onboardingComplete = true; state.settings.reducedMotion = true; state.settings.bookmarksBar = false; state.settings.verticalTabs = false; state.settings.toolbarLayout = 'expanded'; state.tabs[0] = { ...state.tabs[0], url: 'http://example.test/controlled', title: 'Controlled website', contentKind: 'web' };
    await page.exposeFunction('__captionReduce', action => { state = core.reduceBrowser(state, action); return state; });
    await page.addInitScript(seed => {
      let state = seed, layout = { views: [], visible: true }; const states = new Set(), events = new Set();
      window.__captionQA = { emit: event => events.forEach(listener => listener(event)), layout: () => layout };
      window.acira = { platform: 'win32', initialSnapshot: seed, async getSnapshot() { return state; }, async dispatch(action) { state = await window.__captionReduce(action); states.forEach(listener => listener(state)); }, subscribe(listener) { states.add(listener); return () => states.delete(listener); }, subscribeBrowser(listener) { events.add(listener); return () => events.delete(listener); }, subscribeLayout() { return () => {}; }, setBrowserLayout(value) { layout = value; }, async getBrowserLayout() { return layout; }, async browserCommand() {}, async service(request) { if (request.type === 'extensions.toolbar-target') return { extensionToolbar: { supported: false, profileId: state.activeBrowserProfileId, partition: null, webContentsId: null, pinnedIds: [], actionIds: [] } }; return {}; }, async extensions() { return { profileId: state.activeBrowserProfileId, supported: false, supportNote: 'Controlled layout fixture.', extensions: [] }; }, closeOverlay() {}, async overlayReady() { return false; }, openWindow() {}, windowControl() {}, exportData() {} };
    }, state);
    await page.goto(origin + '/index.html?qa=1'); await page.locator('.browser-shell').waitFor();
    for (const mode of ['standard', 'compact', 'focus']) for (const rail of [false, true]) {
      await page.evaluate(async ({ mode, rail }) => { await window.acira.dispatch({ type: 'settings.update', patch: { toolbarLayout: mode === 'compact' ? 'automatic' : 'expanded' } }); await window.acira.dispatch({ type: 'ui.update', patch: { focusMode: mode === 'focus', workspaceOpen: rail, webWorkspaceOpen: rail } }); window.__captionQA.emit({ type: 'page-interaction', tabId: (await window.acira.getSnapshot()).activeTabId }); }, { mode, rail });
      await page.waitForFunction(mode => document.querySelector('.browser-shell')?.dataset.layout === mode, mode); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const value = await page.locator('.browser-shell').evaluate(header => {
        const box = node => node?.getBoundingClientRect().toJSON();
        const visible = node => { if (!node || node.closest('[inert],[aria-hidden=true]')) return false; const rect = node.getBoundingClientRect(); if (!rect.width || !rect.height) return false; for (let item = node; item; item = item.parentElement) { const style = getComputedStyle(item); if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity < .5) return false; } return true; };
        const toolbar = header.querySelector('.acira-persistent-toolbar'), caption = header.dataset.layout === 'compact' ? toolbar.querySelector('.compact-caption-space') : header.dataset.layout === 'focus' ? header.querySelector('.acira-focus-row .caption-reservation') : header.querySelector('.titlebar .caption-reservation');
        return { header: box(header), toolbar: box(toolbar), caption: box(caption), captionWidth: getComputedStyle(header).getPropertyValue('--caption-width'), columns: getComputedStyle(toolbar).gridTemplateColumns, native: document.documentElement.dataset.native, mode: header.dataset.layout, controls: [...header.querySelectorAll('button,input,.address-bar')].filter(visible).map(node => ({ tag: node.tagName, label: node.getAttribute('aria-label') || node.className, rect: box(node) })) };
      });
      const key = { width, mode, rail }; cases.push({ ...key, ...value });
      record('native renderer path is active', value.native === 'true', key);
      record('caption reservation stays within its header', value.caption && value.caption.left >= value.header.left - 1 && value.caption.right <= value.header.right + 1, { ...key, caption: value.caption, header: value.header, columns: value.columns });
      record('visible header controls stay within the viewport', value.controls.every(control => control.rect.left >= -1 && control.rect.right <= width + 1), { ...key, outside: value.controls.filter(control => control.rect.left < -1 || control.rect.right > width + 1) });
      if (mode === 'compact') record('compact address and actions end before the caption reservation', value.controls.filter(control => control.tag === 'FORM' || control.label.includes('Acira menu') || control.label.includes('Enter Focus mode')).every(control => control.rect.right <= Math.min(value.caption.left, value.header.right - parseFloat(value.captionWidth)) + 1), key);
      if (width === 610 || width === 915 && mode === 'compact' && rail) await page.screenshot({ path: path.join(out, `${width}-${mode}-${rail ? 'rail' : 'closed'}.png`) });
    }
    await page.close();
  }
} catch (error) { errors.push(error.stack || error.message); }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
const sourceStable = await paletteNativeSourceStable(identity); record('verified immutable source stays stable', sourceStable);
const report = { checkedAt: new Date().toISOString(), qualification: 'Exact verified642dist/native-renderer code served unchanged over isolated loopback, with explicit synthetic native state/service/layout bridge and the same immutable core reducer. Native-path CSS layout geometry only in headless Chrome, modeled915/610CSSpx native content widths plus1400. No Electron window/caption hit-target or actual native-view geometry acceptance. Complements the separately captured real native150compact+rail overlap image.', snapshot: identity.snapshot, source: identity.source, sourceStable, cases, checks, failures: checks.filter(check => !check.pass), errors };
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, cases: cases.length, checks: checks.length, failures: report.failures.reduce((all, item) => (all[item.name] = (all[item.name] || 0) + 1, all), {}), errors, sourceStable })); if (report.failures.length || errors.length) process.exitCode = 1;
