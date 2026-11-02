import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const argument = process.argv.indexOf('--packet');
if (argument < 0 || !process.argv[argument + 1]) throw Error('Use --packet with the explicit immutable renderer qualification directory.');
const packet = await fs.realpath(path.resolve(process.argv[argument + 1]));
const allowed = await fs.realpath(path.resolve('docs/design/color-research/production-qa'));
if (!packet.toLowerCase().startsWith((allowed + path.sep).toLowerCase())) throw Error('Packet must stay within the palette renderer evidence directory.');
const original = JSON.parse(await fs.readFile(path.join(packet, 'result.json'), 'utf8'));
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
for (const file of original.outputs) if (await hash(file.path) !== file.sha256) throw Error('Packet output changed: ' + file.path);
for (const file of original.source.filter(file => file.path.startsWith('src/features/import-export/'))) if (await hash(file.path) !== file.sha256) throw Error('Current component differs from packet: ' + file.path);
const out = path.resolve('docs/design/color-research/production-qa/import-error-retry-' + Date.now()); await fs.mkdir(out, { recursive: true });
const checks = [], cases = [], errors = [], record = (name, pass, detail = {}) => checks.push({ name, pass, ...detail });
const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
try {
  for (const scale of [1, 1.5]) for (const dark of [false, true]) {
    const page = await browser.newPage({ viewport: { width: Math.floor(900 / scale), height: Math.floor(950 / scale) }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message)); await page.route(/^https?:/, route => route.abort());
    await page.goto(pathToFileURL(path.join(packet, 'index.html')).href); await page.waitForFunction(() => window.__importQA);
    for (const [type, button, error] of [
      ['imports.html', 'Import bookmarks HTML…', "ENOENT: no such file or directory, open 'C:\\Controlled fixture\\same-missing-file.html'"],
      ['imports.export', 'Export profile JSON…', "EACCES: permission denied, open 'C:\\Controlled fixture\\same-export.json'"],
      ['imports.export', 'Export profile JSON…', 'EUNKNOWN: the same controlled unknown failure'],
    ]) {
      await page.evaluate(config => window.__importQA.show(config), { finish: dark ? 'Burgundy' : 'Porcelain', dark, scenario: 'discovered', long: false });
      await page.getByRole('button', { name: 'Import & export', exact: true }).click(); await page.waitForFunction(() => document.querySelector('.acira-import-panel')?.getAttribute('aria-busy') === 'false');
      for (let attempt = 1; attempt <= 3; attempt++) {
        await page.evaluate(({ type, error }) => window.__importQA.reply(type, { error }), { type, error });
        await page.getByRole('button', { name: button, exact: true }).click();
        await page.locator('.aip-error').waitFor();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const state = await page.locator('.aip-error').evaluate(node => { const box = node.getBoundingClientRect(); return { focused: document.activeElement === node, top: box.top, bottom: box.bottom, viewportHeight: innerHeight, text: node.textContent, role: node.getAttribute('role'), active: document.activeElement?.outerHTML.slice(0, 200) }; });
        const key = { scale, dark, type, error, attempt }; cases.push({ ...key, ...state });
        record('each identical retry focuses the current plain-language alert', state.focused && state.role === 'alert' && !/ENOENT|EACCES|EUNKNOWN|C:\\/.test(state.text), { ...key, state });
        record('repeated failure feedback stays inside the visible viewport', state.top >= 0 && state.bottom <= state.viewportHeight, key);
        record('identical retry retains the exact native diagnostic', await page.locator('.aip-error-details pre').textContent() === 'Error: ' + error, key);
        if (attempt === 1) await page.locator('.aip-error-details summary').click();
        if (attempt === 2) await page.screenshot({ path: path.join(out, `${scale}-${dark ? 'dark' : 'light'}-${type.replace('.', '-')}-${error.split(':')[0]}-retry.png`) });
      }
    }
    await page.close();
  }
} catch (error) { errors.push(error.stack || error.message); }
finally { await browser.close(); }
const sourceStable = (await Promise.all(original.source.filter(file => file.path.startsWith('src/features/import-export/')).map(async file => await hash(file.path) === file.sha256))).every(Boolean); record('tested component stays unchanged', sourceStable);
const report = { checkedAt: new Date().toISOString(), qualification: 'Exact verified prior actual ImportPanel/BrowserSettings bundle; explicitly synthetic immediately rejected service promises. Repeated identical missing/permission/unknown errors,100/150modeled host, Porcelain light/Burgundy dark, actual click/retry/focus/viewport/detail retention. No native dialogs/files or assistive-technology playback acceptance.', packet, source: original.source.filter(file => file.path.startsWith('src/features/import-export/')), outputs: original.outputs, sourceStable, cases, checks, failures: checks.filter(check => !check.pass), errors };
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, cases: cases.length, checks: checks.length, failures: report.failures.reduce((all, item) => (all[item.name] = (all[item.name] || 0) + 1, all), {}), errors, sourceStable })); if (report.failures.length || errors.length) process.exitCode = 1;
