// Stream L: long-language safety. Runs M's clip scanner (qa/m-clip-scan.js) over the chrome, every Settings section, the main menu and the
// tab viewer in English, German and French at 150%, and reports text that is clipped or crosses its container in German/French but not in English.
//   node qa/l-clip-lang.mjs [--locales=de,fr] [--scale=150]   isolated profile, one Electron per language (closed in finally), off-screen.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { launchPreparedNative } from './prepared-native.mjs';

const option = (name, fallback) => (process.argv.find(a => a.startsWith('--' + name + '=')) || '').split('=')[1] || fallback;
const locales = ['en', ...option('locales', 'de,fr').split(',')], scale = Number(option('scale', '150'));
const scanner = fs.readFileSync(path.resolve('qa/m-clip-scan.js'), 'utf8');
const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Seite ' + req.url + '</title><h1>x</h1>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const wait = ms => new Promise(r => setTimeout(r, ms));
const results = {};
// --shots=<dir>: a picture of every surface whose scan reports clipped text (the interface page itself, never the screen);
// --json=<file>: every scan, for diffing later.
const shots = option('shots', ''), jsonOut = option('json', '');
if (shots) fs.mkdirSync(shots, { recursive: true });
const scanOf = async (page, locale, key) => {
  const text = await page.evaluate(scanner);
  if (shots && String(text).split('\n').some(line => / :: /.test(line))) await page.screenshot({ path: path.join(shots, `${locale}-${key.replace(/[^a-z0-9]+/gi, '_')}.png`) }).catch(() => {});
  return text;
};

async function run(locale) {
  const data = path.resolve('.qa-profiles/l-clip-' + locale + '-' + Date.now());
  const app = await launchPreparedNative({
    executablePath: createRequire(import.meta.url)('electron'),
    args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, LOCALAPPDATA: path.resolve('.qa-profiles/import-fixture'), ACIRA_BROWSER_TEST_HIDDEN: '1' },
  });
  try {
    const pick = async test => { for (let i = 0; i < 100; i++) { const p = app.windows().find(p => test(p.url())); if (p) return p; await wait(100); } return null; };
    let ui = await pick(u => u === 'acira-browser-ui://ui/index.html');
    await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({ x: -3000, y: 20, width: 1440, height: 900 }); w.showInactive(); });
    await ui.evaluate(a => window.acira.dispatch(a), { type: 'settings.update', patch: { language: locale, interfaceScale: scale } });
    await wait(3000);
    ui = await pick(u => u === 'acira-browser-ui://ui/index.html'); // the view reloads when the language changes
    const out0 = {}; // the first screen of setup, before it is skipped
    out0.setup = await scanOf(ui, locale, 'setup');
    try { await ui.getByRole('button', { name: /Skip setup|Skip|Einrichtung|Passer|Ignorer|Salta|Omitir|Pular|スキップ|跳过/ }).first().click({ timeout: 6000 }); } catch {}
    await wait(800);
    const act = a => ui.evaluate(a => window.acira.dispatch(a), a);
    for (const n of ['a', 'b']) { await act({ type: 'tab.new', url: base + '/' + n }); await wait(500); }
    const lang = await ui.evaluate(() => document.documentElement.lang);
    const out = { lang, surfaces: { ...out0 } };
    out.surfaces.chrome = await scanOf(ui, locale, 'chrome');
    await act({ type: 'tab.new', url: 'acira://settings' }); await wait(2000);
    const sections = await ui.evaluate(() => [...document.querySelectorAll('.bs-sidebar nav>button')].map(b => b.getAttribute('aria-label')));
    for (let i = 0; i < Math.min(sections.length, 20); i++) {
      await ui.evaluate(index => document.querySelectorAll('.bs-sidebar nav>button')[index]?.click(), i); await wait(500);
      out.surfaces['settings:' + i] = await scanOf(ui, locale, 'settings-' + i);
    }
    for (const page of ['acira://new', 'acira://history', 'acira://bookmarks', 'acira://downloads', 'acira://rewind', 'acira://routines']) {
      await act({ type: 'tab.new', url: page }); await wait(1800);
      out.surfaces[page] = await scanOf(ui, locale, page);
    }
    await act({ type: 'tab.new', privacy: 'private' }); await wait(1500);
    out.surfaces['private tab'] = await scanOf(ui, locale, 'private-tab');
    // The main menu and the tab viewer live in the overlay renderer.
    for (const [name, press] of [['menu', ['f', ['alt']]], ['tabs', ['t', ['alt']]]]) {
      await app.evaluate(({ webContents }, [key, mods]) => { const v = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); v.focus(); v.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods }); v.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods }); }, press);
      await wait(1500);
      const overlay = await pick(u => u.includes('view=overlay'));
      out.surfaces[name] = overlay ? await scanOf(overlay, locale, name) : 'overlay not found';
      await app.evaluate(({ webContents }) => { const v = webContents.getAllWebContents().find(w => w.getURL().includes('view=overlay')); v?.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); v?.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' }); });
      await wait(500);
    }
    results[locale] = out;
  } finally { await app.close().catch(() => {}); }
}

try { for (const locale of locales) await run(locale); } finally { server.close(); }
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(results, null, 1));
const hitsOf = text => String(text).split('\n').filter(line => / :: /.test(line));
let regressions = 0;
for (const locale of locales) console.log(locale, Object.entries(results[locale].surfaces).map(([k, v]) => k + ':' + String(v).slice(0, 14) + '/' + hitsOf(v).length).join(' '));
for (const locale of locales.filter(l => l !== 'en')) {
  console.log(`\n== ${locale} (page lang ${results[locale].lang}) at ${scale}%`);
  for (const [surface, text] of Object.entries(results[locale].surfaces)) {
    const baseline = new Set(hitsOf(results.en.surfaces[surface] ?? '').map(line => line.split(' :: ')[1]?.replace(/"[^"]*"/, '')));
    const fresh = hitsOf(text).filter(line => !baseline.has(line.split(' :: ')[1]?.replace(/"[^"]*"/, '')));
    regressions += fresh.length;
    for (const line of fresh) console.log(`  ${surface}: ${line}`);
  }
}
console.log(`\n${regressions} clipped strings in the long languages that are not clipped in English`);
process.exit(regressions ? 1 : 0);
