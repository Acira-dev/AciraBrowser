// E01–E03 + remaining tooltip copy: real native pixels, M's scanners, 8 locale/scale/theme cases.
// One app at a time, isolated profile + import environment, at most 18 tabs, closed in finally.
// Run after the build: node qa/l-edge-proof.mjs [artifact-directory]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const out = path.resolve(process.argv[2] || 'qa/artifacts/l-edge-proof');
fs.mkdirSync(out, { recursive: true });
const edge = fs.readFileSync('qa/m-edge-scan.js', 'utf8');
const clip = fs.readFileSync('qa/m-clip-scan.js', 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = [];
for (const locale of ['fr', 'de']) {
  const catalog = JSON.parse(fs.readFileSync(`src/i18n/${locale}.json`, 'utf8'));
  const data = path.resolve(`.qa-profiles/l-edge-proof-${locale}-${Date.now()}`);
  const appData = path.join(data, 'import-fixture', 'roaming');
  const localData = path.join(data, 'import-fixture', 'local');
  fs.mkdirSync(appData, { recursive: true }); fs.mkdirSync(localData, { recursive: true });
  const app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, APPDATA: appData, LOCALAPPDATA: localData, ACIRA_BROWSER_TEST_HIDDEN: '1' },
  });
  const watchdog = setTimeout(() => { console.error(`${locale}: native QA watchdog expired`); void app.close(); }, 150000);
  watchdog.unref();
  const pick = async test => {
    for (let i = 0; i < 100; i++) { const page = app.windows().find(page => test(page.url())); if (page) return page; await wait(100); }
    throw Error('Expected renderer did not open');
  };
  try {
    let ui = await pick(url => url === 'acira-browser-ui://ui/index.html');
    const act = action => ui.evaluate(action => window.acira.dispatch(action), action);
    await app.evaluate(({ BaseWindow }) => {
      const win = BaseWindow.getAllWindows().sort((a, b) => b.getBounds().width - a.getBounds().width)[0];
      win.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); win.showInactive();
    });
    await ui.getByRole('button', { name: 'Skip setup', exact: true }).click({ timeout: 15000 });
    await act({ type: 'settings.update', patch: { language: locale, verticalTabs: true } });
    await wait(2500);
    ui = await pick(url => url === 'acira-browser-ui://ui/index.html');
    assert.equal(await ui.evaluate(() => document.documentElement.lang), locale);
    for (const scale of [100, 150]) for (const theme of ['light', 'dark']) {
      const tag = `${locale}-${scale}-${theme}`, result = { tag, edge: [], focus: [], clip: {}, keys: [], copy: {} };
      await act({ type: 'settings.update', patch: { interfaceScale: scale, appearance: theme, verticalTabs: true } });
      await wait(900); await ui.evaluate(edge);
      for (const page of ['history', 'bookmarks', 'downloads', 'rewind']) {
        const tabs = await ui.evaluate(() => window.acira.getSnapshot().then(s => s.tabs.length));
        assert.ok(tabs < 30, 'Hard tab cap');
        await act({ type: 'tab.new', url: `acira://${page}` }); await wait(850);
        await ui.locator('.lib').waitFor({ state: 'visible', timeout: 7000 });
        result.clip[page] = await ui.evaluate(clip);
        const keys = await ui.locator('.lib kbd').evaluateAll(elements => elements.map(el => {
          const c = getComputedStyle(el), r = el.getBoundingClientRect();
          return { text: el.textContent, left: c.paddingLeft, right: c.paddingRight, height: r.height, findings: window.__edge.el(el) };
        }));
        result.keys.push({ page, keys });
        for (const key of keys) {
          assert.ok(parseFloat(key.left) >= 6 && parseFloat(key.right) >= 6, `${tag} ${page}: key padding`);
          result.edge.push(...key.findings);
        }
        if (page === 'bookmarks') {
          const profile = ui.locator('.sb-foot-profile').first();
          await profile.hover(); await wait(700);
          result.edge.push(...await profile.evaluate(el => window.__edge.el(el)));
          await ui.screenshot({ path: path.join(out, `${tag}-profile-hover.png`) });
          await ui.locator('button[title*=" · "]:not(:disabled)').first().hover(); await wait(700);
          const tip = ui.locator('[role="tooltip"] kbd');
          assert.equal(await tip.count(), 1, `${tag}: real tooltip keycap`);
          result.edge.push(...await tip.evaluate(el => window.__edge.el(el)));
          await ui.screenshot({ path: path.join(out, `${tag}-library-hover.png`) });
          await ui.keyboard.press('Tab'); await profile.focus();
          result.focus.push(await ui.evaluate(() => window.__edge.focus()));
          await ui.screenshot({ path: path.join(out, `${tag}-profile-focus.png`) });
          await ui.locator('.lib-search input').focus();
          result.focus.push(await ui.evaluate(() => window.__edge.focus()));
        }
        if (page === 'rewind') {
          result.copy.rewindDescription = await ui.locator('.lib-head p').textContent();
          assert.equal(result.copy.rewindDescription, catalog['shortcuthints.rewind']);
          await ui.screenshot({ path: path.join(out, `${tag}-rewind.png`) });
        }
      }
      await ui.evaluate(async () => { const state = await window.acira.getSnapshot(); await window.acira.browserCommand({ type: 'ui', tabId: state.activeTabId, action: 'open', kind: 'menu' }); });
      const overlay = await pick(url => url.includes('view=overlay'));
      await overlay.locator('.popup-content-menu').last().waitFor({ state: 'visible', timeout: 7000 });
      const rewind = overlay.locator('.menu-row').filter({ hasText: /^Rewind/ }).first();
      result.copy.rewindTooltip = await rewind.getAttribute('title');
      assert.equal(result.copy.rewindTooltip, catalog['shortcuthints.rewind']);
      await rewind.hover(); await wait(700);
      result.clip.menu = await overlay.evaluate(clip);
      await overlay.screenshot({ path: path.join(out, `${tag}-menu-tooltip.png`) });
      await overlay.keyboard.press('Escape'); await wait(400);
      const layout = await ui.evaluate(() => window.acira.getBrowserLayout());
      if (layout?.overlay) await ui.evaluate(id => window.acira.closeOverlay(id), layout.overlay.id);
      await wait(250);
      await act({ type: 'settings.update', patch: { verticalTabs: false } }); await wait(650);
      result.copy.closeTitles = await ui.locator('.tab-close').evaluateAll(buttons => buttons.filter(button => button.closest('[aria-selected="false"]')).map(button => ({ title: button.getAttribute('title') || button.dataset.tipTitle, aria: button.getAttribute('aria-label') })));
      assert.ok(result.copy.closeTitles.length > 0, `${tag}: inactive tab close controls`);
      for (const item of result.copy.closeTitles) assert.equal(item.title, item.aria, `${tag}: localized close title`);
      report.push(result);
      fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
      console.log(`${tag}: edge ${result.edge.length}, focus ${result.focus.flatMap(item => item?.findings || []).length}, copy OK`);
    }
  } finally { clearTimeout(watchdog); await app.close().catch(() => {}); }
}
const failures = report.flatMap(result => [...result.edge, ...result.focus.flatMap(item => item?.findings || [])]);
console.log(`${failures.length ? 'REVIEW' : 'PASS'}: ${report.length} cases; ${failures.length} edge/focus findings; clip scans in report.json`);
process.exitCode = failures.length ? 1 : 0;
