import { launchPreparedNative } from './prepared-native.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { nativePage, poll } from './native-helpers.mjs';
import { startNativeCapture, stopNativeCapture } from './native-capture.mjs';
import { paletteNativeIdentity, paletteNativeSourceStable } from './palette-native-identity.mjs';

const stamp = Date.now(), out = path.resolve('qa/artifacts/palette-native-loading-' + stamp), profile = path.resolve('.qa-profiles/palette-native-loading-' + stamp);
await fs.mkdir(out, { recursive: true });
const pending = new Map();
const html = '<!doctype html><title>Controlled loading fixture</title><h1>Controlled loading fixture</h1><p>Plain HTML with no authored background.</p>';
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/slow') { pending.set(url.searchParams.get('id'), response); response.on('close', () => pending.delete(url.searchParams.get('id'))); }
  else { response.setHeader('Content-Type', 'text/html'); response.end(html); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const report = { checkedAt: new Date().toISOString(), qualification: 'Exact verified code-only snapshot and qualified Electron only. Own900x750 offscreen/unfocusable disposable app, controlled loopback HTML/held navigation. Real interface zoom100/150, expanded/compact/Focus and rail open/closed, Burgundy/Porcelain. Native composite images plus DOM/lifecycle evidence. Does not prove user-profile behavior, external sites, arbitrary DPI/platforms, loading aesthetics or popup motion.', cases: [], checks: [], errors: [] };
const record = (name, pass, detail = {}) => report.checks.push({ name, pass, ...detail });
let app, ui, capturing = false;
try {
  const identity = await paletteNativeIdentity(); Object.assign(report, { runtime: identity.runtime, runtimeGate: identity.runtimeGate, snapshot: identity.snapshot, source: identity.source });
  if (identity.checkOnly) report.status = 'RUNTIME_ACCEPTED_TEST_NOT_RUN';
  else {
    app = await launchPreparedNative({ args: [identity.entry], executablePath: identity.executable, env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: profile, ACIRA_BROWSER_TEST_HIDDEN: '1', ACIRA_DEV: '0' }, timeout: 30000 });
    report.loadedRuntime = await app.evaluate(() => ({ electron: process.versions.electron, chromium: process.versions.chrome, node: process.versions.node }));
    assert.equal(report.loadedRuntime.electron, identity.runtime.version);
    ui = await nativePage(app, 'acira-browser-ui://ui/index.html'); await ui.locator('.browser-shell').waitFor();
    const skip = ui.getByRole('button', { name: 'Skip setup', exact: true });
    await ui.waitForFunction(() => !document.querySelector('.setup-dialog') || [...document.querySelectorAll('.setup-dialog button')].some(button => button.textContent.trim() === 'Skip setup'));
    if (await skip.count()) { await skip.evaluate(node => node.click()); await ui.locator('.setup-dialog').waitFor({ state: 'detached' }); }
    ui.on('pageerror', error => report.errors.push(error.message));
    report.window = await app.evaluate(({ BaseWindow }) => { const win = BaseWindow.getAllWindows()[0]; win.setFocusable(false); win.setIgnoreMouseEvents(true); win.setSkipTaskbar(true); win.setPosition(-20000, -20000); win.setSize(900, 750); win.showInactive(); return { bounds: win.getBounds(), focused: win.isFocused(), focusable: win.isFocusable() }; });
    assert.equal(report.window.focused, false); assert.equal(report.window.focusable, false);
    const act = action => ui.evaluate(action => window.acira.dispatch(action), action), snapshot = () => ui.evaluate(() => window.acira.getSnapshot());
    await act({ type: 'settings.update', patch: { onboardingComplete: true, reducedMotion: false, reducedTransparency: false, glassOpacity: 64, translucentOpacity: 64, verticalTabs: false, bookmarksBar: false } });
    for (const finish of ['Burgundy', 'Porcelain']) for (const scale of [100, 150]) for (const mode of ['standard', 'compact', 'focus']) for (const rail of [false, true]) {
      const key = { finish, scale, mode, rail };
      await act({ type: 'settings.update', patch: { interfaceScale: scale, appearance: 'light', colorPreset: finish, browserTint: finish === 'Burgundy' ? '#4d1821' : '#f8fbff', accentColor: finish === 'Burgundy' ? '#4d1821' : '#1769c2', toolbarLayout: mode === 'compact' ? 'automatic' : 'expanded' } });
      await act({ type: 'ui.update', patch: { focusMode: mode === 'focus', workspaceOpen: rail, webWorkspaceOpen: rail } });
      await act({ type: 'tab.navigate', url: base + '/plain' });
      await poll(snapshot, state => { const tab = state.tabs.find(tab => tab.id === state.activeTabId); return tab.url === base + '/plain' && !tab.loading && tab.progress === undefined; }, 'Controlled plain document settled');
      if (mode === 'compact') { const page = await nativePage(app, base + '/plain'); await page.getByRole('heading', { name: 'Controlled loading fixture' }).click(); }
      await poll(() => ui.locator('.browser-shell').getAttribute('data-layout'), value => value === mode, 'Requested layout mode');
      const native = await poll(() => app.evaluate(({ BaseWindow }, origin) => { const win = BaseWindow.getAllWindows()[0], views = win.contentView.children, chrome = views.find(view => view.webContents?.getURL() === 'acira-browser-ui://ui/index.html'), web = views.find(view => view.webContents?.getURL().startsWith(origin)); return { bounds: win.getBounds(), contentBounds: win.getContentBounds(), ui: chrome.getBounds(), web: web?.getBounds(), zoom: chrome.webContents.getZoomFactor(), focused: win.isFocused() }; }, base), value => Math.abs(value.zoom - scale / 100) < .001 && value.web?.width > 0, 'Native zoom and website view');
      await startNativeCapture(app, ui); capturing = true;
      const id = `${finish}-${scale}-${mode}-${rail}`, started = Date.now();
      await act({ type: 'tab.navigate', url: base + '/slow?id=' + encodeURIComponent(id) });
      await poll(snapshot, state => { const tab = state.tabs.find(tab => tab.id === state.activeTabId); return tab.loading && tab.progress > 0 && tab.progress < 1; }, 'Real pending navigation generation');
      await poll(() => pending.has(id), Boolean, 'Native request reaches held local route');
      await ui.waitForTimeout(350);
      const paint = await ui.locator('.navigation-progress').evaluateAll(nodes => {
        const painted = node => { const rect = node.getBoundingClientRect(); if (!rect.width || !rect.height || node.closest('[inert],[aria-hidden=true]:not(canvas):not(.navigation-progress)')) return false; for (let item = node; item; item = item.parentElement) { const style = getComputedStyle(item); if (style.display === 'none' || style.visibility === 'hidden' || +style.opacity < .5) return false; } return true; };
        const node = nodes.find(painted), rect = node => node.getBoundingClientRect().toJSON(); if (!node) return { missing: true, nodes: nodes.length };
        const fill = node.querySelector('.navigation-progress-fill'), header = node.closest('.browser-shell'), address = node.closest('.address-bar');
        return { progress: rect(node), fill: rect(fill), header: rect(header), address: address ? rect(address) : null, placement: node.dataset.placement, opacity: getComputedStyle(node).opacity, glowHeight: getComputedStyle(fill, '::before').height, glowDisplay: getComputedStyle(fill, '::before').display, core: getComputedStyle(fill).backgroundColor, shadow: getComputedStyle(fill).boxShadow, tabMatrices: [...document.querySelectorAll('.tab-agent-icon canvas[data-preset=loader],.ed-rail-tab canvas[data-preset=loader],.acira-compact-tabs canvas[data-preset=loader]')].filter(painted).length, addressMatrices: [...document.querySelectorAll('.address-security canvas[data-preset=loader]')].filter(painted).length, visibleTabSlots: [...document.querySelectorAll('.tab-agent-icon,.ed-rail-tab,.acira-compact-tabs [data-tab-id]')].filter(painted).length, matrixNodes: [...document.querySelectorAll('canvas[data-preset=loader]')].filter(painted).map(node => ({ rect: rect(node), parent: node.parentElement.className })), layout: header.dataset.layout };
      });
      assert.ok(!paint.missing, 'Real active progress must have a painted surface');
      const sample = await app.evaluate(async (_electron, data) => globalThis.__qaRecorder.webContents.executeJavaScript(`(${(data => {
        const cap = window.__nativeCapture, canvas = document.createElement('canvas'); canvas.width = cap.video.videoWidth; canvas.height = cap.video.videoHeight; const context = canvas.getContext('2d'); context.drawImage(cap.video, 0, 0);
        const sx = canvas.width / data.native.bounds.width, sy = canvas.height / data.native.bounds.height, ox = data.native.contentBounds.x - data.native.bounds.x + data.native.ui.x, oy = data.native.contentBounds.y - data.native.bounds.y + data.native.ui.y;
        const box = data.paint.fill, left = Math.max(0, Math.floor((ox + box.left * data.native.zoom) * sx)), right = Math.min(canvas.width, Math.ceil((ox + box.right * data.native.zoom) * sx)), top = Math.max(0, Math.floor((oy + box.top * data.native.zoom) * sy)), bottom = Math.min(canvas.height, Math.ceil((oy + box.bottom * data.native.zoom) * sy));
        let bluePixels = 0; if (right > left && bottom > top) { const pixels = context.getImageData(left, top, right - left, bottom - top).data; for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 2] > pixels[index] + 20 && pixels[index + 2] > pixels[index + 1] + 10) bluePixels++; }
        const web = data.native.web, px = Math.min(canvas.width - 1, Math.max(0, Math.round((data.native.contentBounds.x - data.native.bounds.x + web.x + web.width * .7) * sx))), py = Math.min(canvas.height - 1, Math.max(0, Math.round((data.native.contentBounds.y - data.native.bounds.y + web.y + web.height - 50) * sy)));
        return { time: Date.now(), mediaTime: cap.video.currentTime, width: canvas.width, height: canvas.height, image: canvas.toDataURL('image/png').split(',')[1], coreProbe: { left, right, top, bottom, bluePixels }, websiteCanvasPixel: { x: px, y: py, rgba: [...context.getImageData(px, py, 1, 1).data] } };
      }).toString()})(${JSON.stringify(data)})`), { native, paint });
      const file = id + '.png'; await fs.writeFile(path.join(out, file), Buffer.from(sample.image, 'base64')); delete sample.image;
      const frames = await stopNativeCapture(ui); capturing = false;
      record('real active progress paints at the expected mode position', paint.placement === (mode === 'standard' ? 'address' : 'boundary') && +paint.opacity > .95, key);
      record('core and glow stay within the browser header', paint.progress.top >= paint.header.top - .5 && paint.progress.bottom <= paint.header.bottom + .5 && paint.fill.bottom <= paint.header.bottom + .5, key);
      record('native composite contains the blue core at its measured bounds', sample.coreProbe.bluePixels >= 5, { ...key, probe: sample.coreProbe });
      record('normal material has a restrained inward glow', paint.glowHeight === '8px' && paint.glowDisplay !== 'none' && paint.shadow === 'none', key);
      record('visible loading tab slots use the matrix', paint.visibleTabSlots === 0 || paint.tabMatrices > 0, { ...key, slots: paint.visibleTabSlots, matrices: paint.tabMatrices });
      record('visible page-information slot uses the matrix', mode === 'focus' || paint.addressMatrices === 1, { ...key, matrices: paint.addressMatrices });
      const response = pending.get(id); response.setHeader('Content-Type', 'text/html'); response.end(html);
      const settled = await poll(snapshot, state => { const tab = state.tabs.find(tab => tab.id === state.activeTabId); return !tab.loading && tab.progress === undefined; }, 'Real navigation indicators settle');
      record('completed navigation clears progress and loading matrices', await ui.locator('.navigation-progress').count() === 0 && await ui.locator('.tab-agent-icon canvas[data-preset=loader],.address-security canvas[data-preset=loader],.ed-rail-tab canvas[data-preset=loader]').count() === 0, key);
      record('test window remains unfocused', !await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].isFocused()), key);
      report.cases.push({ ...key, started, ended: Date.now(), native, paint, sample, file, callbackFrameTimes: frames.map(frame => frame.time), settledTab: settled.tabs.find(tab => tab.id === settled.activeTabId) });
    }
    report.sourceStable = await paletteNativeSourceStable(identity); record('immutable source stays stable', report.sourceStable); report.status = 'EXECUTED';
  }
} catch (error) { report.errors.push(error.stack || error.message); }
finally { try { if (capturing) await stopNativeCapture(ui); } finally { await app?.close(); for (const response of pending.values()) response.destroy(); await new Promise(resolve => server.close(resolve)); report.failures = report.checks.filter(check => !check.pass); await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); } }
console.log(JSON.stringify({ out, cases: report.cases.length, checks: report.checks.length, failures: report.failures.reduce((all, item) => (all[item.name] = (all[item.name] || 0) + 1, all), {}), errors: report.errors, sourceStable: report.sourceStable }));
if (report.failures.length || report.errors.length) process.exitCode = 1;
