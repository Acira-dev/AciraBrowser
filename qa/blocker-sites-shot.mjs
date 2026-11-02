// Content-blocker check on two real sites, with screenshots: Bing's results page and Microsoft's sign-in page (read only: no credentials, no form submitted;
// Bing gets one plain search query in its URL). For each page it records the failed requests, the <link rel=prefetch|preload> hrefs the page declares,
// the number of results and the page height, and saves a PNG of the tab. The window stays hidden until the page has loaded, is then shown off-screen and
// without focus (showInactive), so the run never touches the desktop, the mouse or the keyboard focus.
//   node qa/native-slot.mjs blocker-shot -- node qa/blocker-sites-shot.mjs <outDir> <label> [bing,microsoft-online]
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const SITES = {
  'bing': {url: 'https://www.bing.com/search?q=acira+browser', ready: '#b_results .b_algo, #b_results li'},
  'microsoft-online': {url: 'https://login.microsoftonline.com/', ready: 'input[name=loginfmt]'}
};
const [outDir, label = 'run', only] = process.argv.slice(2);
if (!outDir) { console.log('usage: node qa/blocker-sites-shot.mjs <outDir> <label> [site,site]'); process.exit(2); }
const names = (only ? only.split(',') : Object.keys(SITES)).filter(name => SITES[name]);
fs.mkdirSync(outDir, {recursive: true});

const {withSlot} = await import('./native-slot.mjs'), {launchPreparedNative} = await import('./prepared-native.mjs');
const report = {label, sites: {}};
await withSlot('blocker-shot', async () => {
  const data = path.resolve('.qa-profiles/blocker-shot-' + Date.now());
  const app = await launchPreparedNative({executablePath: createRequire(import.meta.url)('electron'), args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1'}});
  try {
    let ui; for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
    if (!ui) throw Error('UI page not found');
    try { await ui.getByRole('button', {name: 'Skip setup', exact: true}).click({timeout: 8000}); } catch { /* past setup */ }
    const isUi = p => /^acira-browser-ui:/.test(p.url()), known = new Set(app.windows());
    const failed = new Map();
    app.on('window', page => { if (isUi(page)) return; page.on('requestfailed', request => { const text = request.failure()?.errorText || ''; if (/BLOCKED/i.test(text)) (failed.get(page) || failed.set(page, []).get(page)).push(`${request.resourceType()} ${request.url().slice(0, 120)}`); }); });
    // Shown off-screen and without taking focus, so the compositor draws frames for the screenshot.
    await app.evaluate(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; if (!win) return; win.setBounds({x: -3200, y: 0, width: 1280, height: 900}); win.showInactive(); });
    for (const name of names) {
      const site = SITES[name], before = new Set(app.windows());
      await ui.evaluate(url => window.acira.dispatch({type: 'tab.new', url}), site.url);
      let page; for (let i = 0; i < 300 && !page; i++) { page = app.windows().find(p => !before.has(p) && !isUi(p) && !known.has(p)); if (!page) await wait(100); }
      if (!page) { report.sites[name] = {error: 'tab did not appear'}; continue; }
      known.add(page);
      await page.waitForSelector(site.ready, {timeout: 25000}).catch(() => {});
      await page.waitForLoadState('load', {timeout: 20000}).catch(() => {});
      await wait(4000);
      const info = await page.evaluate(() => ({
        url: location.href.slice(0, 100), title: document.title.slice(0, 60), height: document.documentElement.scrollHeight, results: document.querySelectorAll('#b_results .b_algo').length,
        stylesheets: [...document.styleSheets].length, hints: [...document.querySelectorAll('link[rel=prefetch],link[rel=preload],link[rel=prerender]')].map(l => `${l.rel} ${l.as || ''} ${l.href}`.slice(0, 150)).slice(0, 20),
        text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160)
      })).catch(error => ({error: String(error).slice(0, 160)}));
      info.blocked = (failed.get(page) || []).slice(0, 30);
      const file = path.join(outDir, `${label}-${name}.png`);
      await page.screenshot({path: file, timeout: 20000}).then(() => { info.screenshot = file; }).catch(error => { info.screenshotError = String(error).slice(0, 160); });
      report.sites[name] = info;
      console.log(name.padEnd(18), `results=${info.results} height=${info.height} sheets=${info.stylesheets} blocked=${info.blocked.length}`, info.screenshot ? 'shot ok' : info.screenshotError || '');
      for (const item of info.blocked) console.log('   blocked: ' + item);
    }
  } finally { await app.close().catch(() => {}); }
});
fs.writeFileSync(path.join(outDir, `${label}.json`), JSON.stringify(report, null, 1));
process.exit(0);
