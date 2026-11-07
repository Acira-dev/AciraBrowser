'use strict';
// Electron runner for tests/privacy-plus-ai-early.test.cjs. Loads the app's real frame script (content-filter-preload.cjs) as a preload, with main-process
// handlers that answer exactly as optional-filtering.cjs does, against a Google-shaped page (google-2026.html) that adds its AI block at parse time, late, or streamed.
// It records, for every animation frame, whether any AI element was visible, and measures the "AI answer hidden · Show" line, including its contrast against what
// paints behind it. A case's `scheme` is the system appearance the page sees (light by default) and `switchTo` the appearance it is switched to before measuring.
// Usage: electron early.cjs '<cases json>'
// Set AI_EVIDENCE_DIR to also save a page screenshot per case that names `shot`. A case with `probe` runs the frame script under probe-preload.cjs, which counts the
// animation frames and style reads it asks for while the line sits idle, then while the tab is hidden; the page then turns dark through its style sheet (no event)
// while hidden, and the line is measured 100 ms after the tab is shown again; then it counts the layout reads while the page keeps changing, hidden and visible. A case with `page` loads that file as `host` instead (another engine's layout), `zoom` sets the page zoom, `rezoom` changes it under the line already drawn, `dir` sets the page direction and `ghost` adds a first result that is not
// really on screen (see duckduckgo-indent.html).
const http = require('node:http'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { app, BrowserWindow, ipcMain, nativeTheme } = require('electron');
const { surfacesFor, earlyStyles } = require('../../../desktop/browser-services/ai-surfaces.cjs');
app.setPath('userData', path.join(os.tmpdir(), 'acira-ai-early-' + process.pid));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP www.google.com 127.0.0.1, MAP duckduckgo.com 127.0.0.1');
app.on('window-all-closed', () => { });
process.on('uncaughtException', error => { process.stdout.write('ERROR ' + (error && error.stack || error) + '\n'); app.exit(1); });
const cases = JSON.parse(process.argv[process.argv.length - 1]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let aiOn = true, host = 'www.google.com';
const surface = () => surfacesFor(host);
ipcMain.on('acira:ai-early', event => { event.returnValue = aiOn ? { aiRules: surface().items, css: earlyStyles(surface().items) } : null; });
ipcMain.handle('acira:content-filter-options', () => ({ enabled: aiOn, selectors: [], sources: [], annoyanceSelectors: [], annoyanceStyles: '', cookieHints: false, aiRules: aiOn ? surface().items : [], preStyles: aiOn ? earlyStyles(surface().items) : '' }));
ipcMain.handle('acira:content-filter-dom', () => '');
ipcMain.on('acira:content-filter-stats', () => { });
const server = http.createServer((req, res) => { try { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(fs.readFileSync(path.join(__dirname, path.basename(decodeURIComponent(req.url.split('?')[0]))))); } catch { res.statusCode = 404; res.end(); } });
const MEASURE = `(() => {
  const frames = window.__frames || [];
  const settled = frames.filter(([time]) => time > 0);
  const line = document.querySelector('[data-acira-filter-control]');
  const link = document.querySelector('#rso a h3,article[data-testid="result"]:not(.slot) h2 a');
  const button = line && line.querySelector('button');
  const box = element => { if (!element) return null; const r = element.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width), h: Math.round(r.height) }; };
  const style = line && getComputedStyle(line);
  // WCAG contrast of the line's words and of Show against the background behind the line (semi-transparent layers composited, the canvas under them).
  const pen = new OffscreenCanvas(1, 1).getContext('2d', { willReadFrequently: true });
  const rgba = css => { pen.clearRect(0, 0, 1, 1); pen.fillStyle = '#0000'; pen.fillStyle = css; pen.fillRect(0, 0, 1, 1); const [r, g, b, a] = pen.getImageData(0, 0, 1, 1).data; return [r, g, b, a / 255]; };
  const over = (top, bottom) => [0, 1, 2].map(i => top[i] * top[3] + bottom[i] * (1 - top[3]));
  const lum = rgb => { const [r, g, b] = rgb.map(v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
  let contrast = null;
  if (line) {
   const layers = []; for (let node = line.parentElement; node; node = node.parentElement) { const c = rgba(getComputedStyle(node).backgroundColor); if (c[3] > 0) layers.push(c); if (c[3] >= 1) break; }
   let bg = matchMedia('(prefers-color-scheme: dark)').matches && /dark/.test(getComputedStyle(document.documentElement).colorScheme) ? [18, 18, 18] : [255, 255, 255];
   for (const c of layers.reverse()) bg = over(c, bg);
   contrast = { text: ratio(over(rgba(style.color), bg), bg), link: ratio(over(rgba(getComputedStyle(button).color), bg), bg), background: bg.map(Math.round), underline: getComputedStyle(button).textDecorationLine };
  }
  let textLeft = null, textRight = null;
  if (line && line.firstChild) { const range = document.createRange(); range.setStart(line.firstChild, 0); range.setEnd(line.firstChild, 1); textLeft = Math.round(range.getBoundingClientRect().left * 10) / 10; range.setEnd(line.firstChild, line.firstChild.length); textRight = Math.round(range.getBoundingClientRect().right * 10) / 10; }
  return {
    framesSeen: frames.length,
    framesWithAi: settled.filter(([, visible]) => visible > 0).length,
    firstVisibleAt: (settled.find(([, visible]) => visible > 0) || [null])[0],
    aiVisibleNow: [...document.querySelectorAll('#m-x-content,button[jsname="B6rgad"],a[href*="udm=50"]')].filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden').length,
    organic: [...document.querySelectorAll('#rso .g')].filter(el => el.getClientRects().length > 0).length,
    lines: [...document.querySelectorAll('[data-acira-filter-control]')].map(node => node.innerText.trim()),
    resultsLeft: link ? Math.round(link.getBoundingClientRect().left * 10) / 10 : null, resultsRight: link ? Math.round(link.getBoundingClientRect().right * 10) / 10 : null,
    textLeft, textRight, lineBox: box(line), buttonBox: box(button),
    fontSize: style && style.fontSize, lineHeight: style && style.lineHeight, marginTop: style && style.marginTop, marginBottom: style && style.marginBottom, color: style && style.color, buttonColor: button && getComputedStyle(button).color, contrast,
    firstResultTop: link ? Math.round(link.getBoundingClientRect().top) : null,
    tabs: [...document.querySelectorAll('.tabs [role=listitem]')].filter(el => el.getClientRects().length > 0).map(el => el.innerText.trim())
  };
})()`;
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port, out = [];
  for (const spec of cases) {
    aiOn = spec.ai !== false; host = spec.host || 'www.google.com'; nativeTheme.themeSource = spec.scheme || 'light';
    const preload = spec.probe ? path.join(__dirname, 'probe-preload.cjs') : path.join(__dirname, '..', '..', '..', 'desktop', 'browser-services', 'content-filter-preload.cjs');
    const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { sandbox: !spec.probe, contextIsolation: true, preload, zoomFactor: spec.zoom || 1 } });
    await win.loadURL(`http://${host}:${port}/${spec.page || 'google-2026.html'}?measure=1&mode=${spec.mode || 'sync'}&theme=${spec.theme || 'light'}&ink=${spec.ink || 'page'}&layout=${spec.layout || 'flush'}&dir=${spec.dir || 'ltr'}&ghost=${spec.ghost || 'none'}`);
    await sleep(spec.wait || 1400);
    // Windows may omit the media-query event; allow the existing 750 ms appearance fallback its documented one-second bound.
    if (spec.switchTo) { nativeTheme.themeSource = spec.switchTo; await sleep(1000); }
    if (spec.rezoom) { win.webContents.setZoomFactor(spec.rezoom); await sleep(700); }
    let probe = null;
    if (spec.probe) {
      const run = script => win.webContents.executeJavaScript(script);
      await run('window.__aciraProbe.reset()'); await sleep(3000); const visible = await run('window.__aciraProbe.read()');
      await run("window.__aciraProbe.visibility('hidden'); window.__aciraProbe.reset()"); await sleep(2000); const hiddenTab = await run('window.__aciraProbe.read()');
      await run('window.__aciraProbe.reset(); window.__churn(10, 150)'); await sleep(2000); const hiddenChurn = await run('window.__aciraProbe.read()');
      await run('window.__darkenByCssom()'); await sleep(300); const whileHidden = (await run(MEASURE)).buttonColor;
      await run("window.__aciraProbe.visibility('visible')"); await sleep(100); const shownColor = (await run(MEASURE)).buttonColor;
      await sleep(1000); await run('window.__aciraProbe.reset(); window.__churn(20, 100)'); await sleep(2600); const visibleChurn = await run('window.__aciraProbe.read()');
      probe = { visible, hidden: hiddenTab, hiddenChurn, whileHidden, shownColor, visibleChurn };
    }
    const measured = await win.webContents.executeJavaScript(MEASURE);
    let shown = null;
    if (spec.reveal && measured.lines.length) { await win.webContents.executeJavaScript("document.querySelector('[data-acira-filter-control] button').click()"); await sleep(200); shown = await win.webContents.executeJavaScript(MEASURE); }
    if (spec.shot && process.env.AI_EVIDENCE_DIR) { const image = await win.webContents.capturePage(); fs.mkdirSync(process.env.AI_EVIDENCE_DIR, { recursive: true }); fs.writeFileSync(path.join(process.env.AI_EVIDENCE_DIR, spec.shot), image.toPNG()); }
    out.push({ spec, measured, shown, probe });
    // Zoom is kept per host for the whole session: put it back so the next case on the same host starts at 100%.
    if (spec.zoom || spec.rezoom) win.webContents.setZoomFactor(1);
    win.destroy();
  }
  process.stdout.write('RESULT ' + JSON.stringify(out) + '\n'); server.close(); app.exit(0);
});
