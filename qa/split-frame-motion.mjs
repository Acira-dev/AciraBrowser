// Real macOS split reveal regression: each pane must stay cut out of the desktop material,
// and the card's corners/outline must share the sidebar's transition from the first frame.
// Uses a disposable profile/window; never attaches to the person's running browser.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { startApp, sleep, httpFixture, poll } from './d-harness.mjs';

const out = path.resolve(process.env.SPLIT_FRAME_OUT || '.qa-evidence/split-frame-motion');
await fs.mkdir(out, { recursive: true });
const profile = path.resolve('.qa-profiles/split-frame-' + Date.now());
const fixture = await httpFixture((_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>Split frame fixture</title><body style="margin:0;background:#243a41;color:white;font:18px system-ui"><h1>Responsive page</h1><script>window.fixtureNonce=Math.random();window.fixtureResize=0;addEventListener("resize",()=>fixtureResize++);</script>');
});
const url = `http://127.0.0.1:${fixture.port}/`;
const result = { passed: false, platform: process.platform, cases: [], dockedCases: [] };
let app;
try {
  app = await startApp({ root: profile, main: path.resolve('qa/mac-interface-entry.cjs'), env: { ACIRA_QA_MAIN: path.resolve('desktop/main.cjs'), ACIRA_TEST_QUIET_NETWORK: '1' } });
  await app.main(({ BaseWindow, screen }) => {
    const w = BaseWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents?.getURL() === 'acira-browser-ui://ui/index.html'));
    w.setBounds({ x: -17000, y: 100, width: 1280, height: 840 });
    w.showInactive(); w.isFocused = () => true;
    screen.getCursorScreenPoint = () => { const r = w.getContentBounds(); return { x: r.x + 800, y: r.y + 400 }; };
  });
  await app.act({ type: 'settings.update', patch: { style: 'acira', appearance: 'dark', verticalTabs: true, reducedMotion: false, animationSpeed: 'premium', sidebarPeek: { full: true, compact: true, focus: true } } });
  await app.act({ type: 'ui.update', patch: { view: 'compact', workspaceOpen: false, webWorkspaceOpen: false } });
  const first = (await app.state()).activeTabId;
  await app.act({ type: 'tab.navigate', tabId: first, url });
  const site = await app.waitWeb(url);
  await app.act({ type: 'tab.new', url: 'acira://settings' });
  const internal = (await app.state()).activeTabId;
  await sleep(700);
  await app.ui.evaluate(() => {
    const original = document.startViewTransition.bind(document);
    window.splitTransitions = [];
    document.startViewTransition = update => {
      const row = { start: performance.now() }; window.splitTransitions.push(row);
      const transition = original(update);
      transition.ready.then(() => { row.ready = performance.now(); }, () => { row.skipped = true; });
      transition.finished.then(() => { row.finished = performance.now(); });
      return transition;
    };
  });
  for (const layout of ['columns', 'rows']) {
    await app.act({ type: 'split.open', tabIds: [first, internal], layout });
    await app.act({ type: 'tab.select', id: first });
    await sleep(900);
    const before = await site.evaluate(() => ({ width: innerWidth, height: innerHeight, nonce: fixtureNonce, resizes: fixtureResize }));
    await app.ui.evaluate(() => {
      window.splitFrames = []; window.splitRecording = true;
      const frame = () => {
        if (!window.splitRecording) return;
        const root = document.documentElement;
        window.splitFrames.push({ at: performance.now(), mode: root.dataset.modeSwitch, overlay: root.dataset.sidebarOverlay,
          sidebar: !!document.querySelector('.acira-sidebar.is-peek'), material: root.dataset.desktopMaterial,
          right: root.style.getPropertyValue('--desktop-clip-right'), bottom: root.style.getPropertyValue('--desktop-clip-bottom'),
          rim: [...document.querySelectorAll('.sidebar-page-rim path')].map(p => p.getAttribute('d')),
          animations: document.getAnimations().map(a => ({ name: a.animationName, progress: a.effect?.getComputedTiming().progress })) });
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await app.cmd({ type: 'edge', tabId: first, keys: { top: false, side: true } });
    await poll(() => app.ui.locator('.acira-sidebar.is-peek').count(), n => n === 1, 'Sidebar revealed');
    await sleep(650);
    const native = process.platform === 'darwin' ? await app.main(({ BaseWindow }, root) => {
      const require = process.getBuiltinModule('module').createRequire(root + '/package.json');
      const backing = require(root + '/desktop/native/build/mac-material.node');
      const w = BaseWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents?.getURL() === 'acira-browser-ui://ui/index.html'));
      return JSON.parse(backing.inspectViewFrames(w.getNativeWindowHandle()));
    }, process.cwd()) : [];
    await app.cmd({ type: 'edge', tabId: first, keys: { top: false, side: false }, dismiss: 'side' });
    await sleep(650);
    const trace = await app.ui.evaluate(() => { window.splitRecording = false; return { frames: window.splitFrames, transitions: window.splitTransitions.splice(0) }; });
    const after = await site.evaluate(() => ({ width: innerWidth, height: innerHeight, nonce: fixtureNonce, resizes: fixtureResize }));
    const material = native.find(row => row.class === 'AciraDesktopMaterial');
    result.cases.push({ layout, before, after, material, ...trace });
    assert.deepEqual(after, before, 'Floating sidebar must preserve the split website viewport and document');
    if (process.platform === 'darwin') assert(material?.connected && material.maskBounds[2] > 100, 'Native material must receive split page holes');
    for (const suffix of ['in', 'out']) {
      const frames = trace.frames.filter(frame => frame.mode === 'edge').flatMap(frame => {
        const sidebar = frame.animations.find(a => a.name === `sb-slide-${suffix}`);
        const corner = frame.animations.find(a => a.name === `sidebar-corners-${suffix}`);
        const rim = frame.animations.find(a => a.name === 'edge-rim-hold');
        return sidebar && corner && rim ? [{ sidebar, corner, rim }] : [];
      });
      assert(frames.length > 2, `${layout} ${suffix}: the outline and corners must move during the sidebar transition`);
      assert(frames.every(({ sidebar, corner, rim }) => Math.abs(sidebar.progress - corner.progress) < .025 && Math.abs(sidebar.progress - rim.progress) < .025), 'Split frame movement must use the sidebar clock');
    }
    assert.equal(trace.frames.at(-1).overlay, undefined, 'Floating page stacking must restore after hide');
    assert(trace.transitions.every(t => !t.skipped), 'The split transition must not skip');
  }
  // Docked splits follow the DOM page's live spring. Their first React layout must not
  // start a second native spring toward the final box before the old box is prepared.
  for (const layout of ['columns', 'rows']) {
    await app.act({ type: 'split.open', tabIds: [first, internal], layout });
    await sleep(650);
    for (const open of [true, false]) {
      await app.main(({ BaseWindow }, url) => {
        const w = BaseWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents?.getURL() === 'acira-browser-ui://ui/index.html'));
        const walk = view => [view, ...(view.children || []).flatMap(walk)];
        const view = walk(w.contentView).find(v => v.webContents?.getURL() === url);
        globalThis.splitWidthTrace = [{ at: performance.now(), width: view.getBounds().width }];
        globalThis.splitWidthView = view; view.splitOriginalBounds = view.setBounds;
        view.setBounds = function (bounds) { globalThis.splitWidthTrace.push({ at: performance.now(), width: bounds.width }); return this.splitOriginalBounds.call(this, bounds); };
      }, url);
      await app.act({ type: 'ui.update', patch: { workspaceOpen: open, webWorkspaceOpen: open } });
      await sleep(750);
      const widths = await app.main(() => {
        const view = globalThis.splitWidthView; view.setBounds = view.splitOriginalBounds; delete view.splitOriginalBounds;
        return globalThis.splitWidthTrace;
      });
      result.dockedCases.push({ layout, open, widths });
      assert(widths.length > 8, 'A docked split must resize through intermediate frames');
      // A column's left and right edges both move and are rounded independently. Their
      // difference may vary by one pixel even as the fractional DOM width moves one way.
      let edge = widths[0].width;
      assert(widths.slice(1).every(row => { const follows = open ? row.width <= edge + 1 : row.width >= edge - 1; edge = open ? Math.min(edge, row.width) : Math.max(edge, row.width); return follows; }), 'A docked split viewport must not reverse beyond one-pixel edge rounding');
    }
  }
  const errors = app.logs.filter(text => text.includes('Desktop material') || text.includes('INVALID_BRIDGE_PAYLOAD'));
  result.bridgeErrors = errors;
  assert.equal(errors.length, 0, 'Split geometry must be accepted by the desktop material bridge');
  result.passed = true;
} catch (error) { result.error = String(error.stack || error); process.exitCode = 1; }
finally {
  await app?.close(); await fixture.close();
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ passed: result.passed, error: result.error, out }));
}
