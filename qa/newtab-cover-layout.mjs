// Real local new-tab controls and the shared cover picker, on a disposable native profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startApp, poll, sleep } from './d-harness.mjs';

const require = createRequire(import.meta.url), stamp = Date.now();
const root = path.resolve('.qa-profiles/newtab-cover-layout-' + stamp), out = path.resolve('qa/artifacts/newtab-cover-layout-' + stamp);
await fs.mkdir(root, { recursive: true }); await fs.mkdir(out, { recursive: true });
const { BrowserDatabase } = require('../desktop/database.cjs'), { createInitialState, makeTab } = require('../desktop/runtime.cjs');
const state = createInitialState(), profile = state.activeBrowserProfileId;
state.tabs = [makeTab('cover-layout', 'New tab', 'acira://new', profile)]; state.activeTabId = 'cover-layout';
Object.assign(state.settings, { onboardingComplete: true, askBeforeClosing: false, verticalTabs: true, reducedMotion: false, animationSpeed: 'premium', appearance: 'dark' });
Object.assign(state.windowUi, { view: 'compact', workspaceOpen: false, webWorkspaceOpen: false });
const db = new BrowserDatabase(path.join(root, 'browser.sqlite')); db.saveWindow('main', state); db.close();
const report = { passed: false, checks: [], errors: [] }; let app;
const preference = patch => app.ui.evaluate(({ profile, patch }) => {
  const key = 'acira-new-tab:' + profile, previous = JSON.parse(localStorage.getItem(key) || '{}');
  localStorage.setItem(key, JSON.stringify({ ...previous, ...patch, version: crypto.randomUUID() }));
  window.dispatchEvent(new StorageEvent('storage', { key }));
}, { profile, patch });
const edge = side => app.main(({ webContents }, side) => webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html').send('acira:browser-event', { type: 'chrome-edge', top: false, side, pinned: { top: false, side: false } }), side);
const shot = async name => {
  const png = await app.main(async ({ webContents }) => (await webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html').capturePage()).toPNG().toString('base64'));
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(png, 'base64'));
};
try {
  app = await startApp({ root, skipSetup: false, main: path.resolve('qa/mac-interface-entry.cjs'), env: { ACIRA_QA_MAIN: path.resolve('desktop/main.cjs'), ACIRA_TEST_QUIET_NETWORK: '1' } });
  app.ui.setDefaultTimeout(10000); app.ui.on('pageerror', error => report.errors.push(String(error)));
  await app.main(({ BaseWindow, screen }) => {
    const win = BaseWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents?.getURL() === 'acira-browser-ui://ui/index.html'));
    globalThis.__coverLayoutWindow = win.id; win.setBounds({ x: -18000, y: 100, width: 1280, height: 900 }); win.showInactive();
    screen.getCursorScreenPoint = () => { const bounds = win.getContentBounds(); return { x: bounds.x + 900, y: bounds.y + 500 }; };
  });
  await preference({ artStyle: 'framed', artwork: 'met-436535', collection: 'built-in', daily: false, hourly: false, perTab: false, modules: { workspace: true, name: true, mark: true, search: true, artwork: true, shortcuts: false, saved: false, recent: false } });
  await app.ui.locator('.nt-art[data-state=ready]').waitFor(); await sleep(500);
  await app.ui.evaluate(() => {
    window.__coverOpeningFrames = []; const started = performance.now(); window.__coverOpeningRecording = true;
    const sample = () => {
      if (!window.__coverOpeningRecording) return;
      const surface = document.querySelector('.local-popup'), plane = surface?.querySelector('.popup-sheet-plane');
      if (surface && plane) { const box = surface.getBoundingClientRect(); window.__coverOpeningFrames.push({ at: performance.now() - started, x: box.x, y: box.y, width: box.width, height: box.height, visible: getComputedStyle(surface).visibility !== 'hidden' && Number(getComputedStyle(plane).opacity) > .01, preparing: surface.hasAttribute('data-preparing'), opacity: getComputedStyle(plane).opacity }); }
      requestAnimationFrame(sample);
    }; sample();
  });
  await app.ui.locator('.nt-cover-choose').click();
  await app.ui.locator('.popup-content-workspace-cover').waitFor();
  await edge(true);
  await app.ui.locator('.local-popup[data-formation-ready=true]').waitFor(); await sleep(500);
  const opening = await app.ui.evaluate(() => { window.__coverOpeningRecording = false; return window.__coverOpeningFrames; });
  await fs.writeFile(path.join(out, 'picker-opening-frames.json'), JSON.stringify(opening, null, 2));
  const visibleOpening = opening.filter(frame => frame.visible), settledOpening = visibleOpening.at(-1);
  assert.ok(settledOpening, 'Picker becomes visible');
  for (const frame of visibleOpening) for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(frame[key] - settledOpening[key]) < 1, `First-open ${key} shifts at ${frame.at}: ${JSON.stringify(frame)}`);
  report.checks.push({ name: 'First visible cover frame uses measured bounds while sidebar starts revealing', frames: opening.length, visibleFrames: visibleOpening.length, bounds: settledOpening });
  await edge(false); await sleep(900);
  await shot('picker-before-reveal');
  await app.ui.evaluate(() => {
    window.__coverFrames = []; const started = performance.now(); window.__coverRecording = true;
    const rect = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height }; };
    const sample = () => {
      if (!window.__coverRecording) return;
      const surface = document.querySelector('.local-popup'), picker = surface?.querySelector('.workspace-cover-picker'), material = surface?.querySelector('.popup-material'), plane = surface?.querySelector('.popup-sheet-plane');
      window.__coverFrames.push({ at: performance.now() - started, surface: surface && rect(surface), picker: picker && rect(picker), plane: plane && { opacity: getComputedStyle(plane).opacity, transform: getComputedStyle(plane).transform }, material: material && { background: getComputedStyle(material).backgroundColor, backdrop: getComputedStyle(material).backdropFilter }, preparing: surface?.hasAttribute('data-preparing'), peek: !!document.querySelector('.acira-sidebar.is-peek'), ready: surface?.dataset.formationReady, cards: picker?.querySelectorAll('[role=radio]').length, vapor: surface?.querySelectorAll('[data-vapor-layer]').length });
      requestAnimationFrame(sample);
    }; sample();
  });
  await edge(true); await app.ui.locator('.acira-sidebar.is-peek').waitFor(); await sleep(850); await shot('picker-with-sidebar');
  await edge(false); await sleep(1000); await shot('picker-after-sidebar');
  const frames = await app.ui.evaluate(() => { window.__coverRecording = false; return window.__coverFrames; });
  await fs.writeFile(path.join(out, 'picker-frames.json'), JSON.stringify(frames, null, 2));
  const first = frames[0];
  for (const frame of frames) {
    assert.ok(frame.surface && frame.picker, 'Picker remains mounted during the entire reveal');
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(frame.surface[key] - first.surface[key]) < 1, `Popup ${key} jumps at ${frame.at}: ${JSON.stringify(frame)}`);
    assert.equal(frame.preparing, false, 'Open picker does not restart material preparation');
    assert.equal(frame.plane.opacity, '1', 'Open picker stays visible');
    assert.equal(frame.ready, 'true', 'Open picker does not restart its entry');
  }
  report.checks.push({ name: 'Cover picker keeps position, size and visible material through sidebar entry/exit', frames: frames.length, bounds: first.surface });
  await app.ui.keyboard.press('Escape'); await poll(() => app.ui.locator('.popup-content-workspace-cover').count(), count => count === 0, 'cover closes');
  if (process.env.COVER_LAYOUT_ONLY !== 'picker') {
    for (const appearance of ['light', 'dark']) for (const interfaceScale of [100, 150]) {
      await app.act({ type: 'settings.update', patch: { appearance, interfaceScale } });
      await preference({ artStyle: 'full' }); await sleep(650);
      const full = await app.ui.locator('.nt-page').evaluate(node => {
        const box = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom }; };
        const head = node.querySelector('.nt-head'), search = node.querySelector('.nt-search'), eye = node.querySelector('.nt-cover-visibility');
        return { header: head && box(head), search: search && box(search), eye: eye && box(eye), page: box(node), footer: !!node.querySelector('.nt-caption'), next: !!node.querySelector('.nt-next'), choose: !!node.querySelector('.nt-cover-choose'), name: node.querySelector('.nt-head .nt-title')?.textContent };
      });
      assert.ok(full.name && full.header.bottom <= full.search.y + 1, 'Profile identity remains above the search');
      assert.equal(full.footer, false); assert.equal(full.next, false); assert.equal(full.choose, false);
      assert.ok(full.eye.x >= full.page.x && full.eye.right <= full.page.right && full.eye.bottom <= full.search.y, 'The full-image eye stays in its page corner');
      await shot(`full-${appearance}-${interfaceScale}`);
      await app.ui.locator('.nt-cover-visibility').click(); await poll(() => app.ui.locator('.nt-page').getAttribute('data-art'), value => value === 'off', 'eye hides full image');
      await app.ui.locator('.nt-cover-visibility').click(); await poll(() => app.ui.locator('.nt-page').getAttribute('data-art'), value => value === 'on', 'eye restores full image');
      await preference({ artStyle: 'framed' }); await app.ui.locator('.nt-cover-choose').waitFor();
      assert.equal(await app.ui.locator('.nt-credit .nt-cover-visibility').count(), 1); assert.equal(await app.ui.locator('.nt-credit .nt-next').count(), 1);
      report.checks.push({ ...full, profileName: full.name, appearance, interfaceScale, name: `Full-image header, eye-only controls, hide/show and preserved framed controls: ${appearance} ${interfaceScale}%` });
    }
  }
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = String(error.stack || error); throw error; }
finally { await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await app?.close(); console.log(JSON.stringify({ out, ...report })); }
