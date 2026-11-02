// Reference for qa/r6-google-youtube.mjs: the same Google searches in a clean Chromium from Playwright's cache (fresh temporary profile,
// never the founder's Chrome), plus the headers that Chromium sends to a local echo server. Window kept off-screen; page captures only.
//   node qa/r6-google-youtube-chromium.mjs --variants typedurl,u3 [--name chromium] [--gap 25000] [--echo-only]
import './live-google-gate.mjs'; import fs from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import {chromium} from 'playwright';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const G = 'https://www.google.com/search?q=youtube';
const VARIANTS = {u1: G, u2: G + '&hl=en', u3: G + '&sourceid=chrome&ie=UTF-8', u4: G + '&sourceid=chrome&ie=UTF-8&hl=en', ar: G + '&hl=ar'};
const names = arg('variants', 'u2,u3').split(',').filter(Boolean), gap = Number(arg('gap', '25000'));
const out = path.resolve(process.env.PROBE_OUT || 'C:/ae/r6/google/evidence', arg('name', 'chromium'));
await fs.mkdir(out, {recursive: true});
const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'r6-chromium-'));
const seen = [];
const server = http.createServer((req, res) => { seen.push({path: req.url, headers: req.headers}); res.setHeader('content-type', 'text/html'); res.setHeader('accept-ch', 'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version'); res.end('<!doctype html><title>echo</title>ok'); });
await new Promise(r => server.listen(0, '127.0.0.1', r));
// Whatever Chromium build Playwright's cache already holds (nothing is downloaded); CHROMIUM_EXE overrides.
const cache = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
const cached = (await fs.readdir(cache).catch(() => [])).filter(name => /^chromium-\d+$/.test(name)).sort().reverse().map(name => path.join(cache, name, 'chrome-win64', 'chrome.exe'));
let executablePath = process.env.CHROMIUM_EXE; for (const file of cached) { if (executablePath) break; try { await fs.access(file); executablePath = file; } catch {} }
const context = await chromium.launchPersistentContext(userData, {executablePath, headless: false, viewport: {width: 1280, height: 900}, args: ['--window-position=-2600,-2600']});
const report = {browser: context.browser()?.version?.() ?? null, variants: []};
try {
  const page = context.pages()[0] || await context.newPage();
  const port = server.address().port;
  await page.goto(`http://127.0.0.1:${port}/a`); await page.goto(`http://127.0.0.1:${port}/b`);
  report.echo = seen.map(s => ({path: s.path, headers: Object.fromEntries(Object.entries(s.headers).filter(([k]) => /^(user-agent|accept-language|sec-ch-)/.test(k)))}));
  report.identity = await page.evaluate(async () => { const d = navigator.userAgentData; const h = await d.getHighEntropyValues(['fullVersionList', 'platformVersion']); return {ua: navigator.userAgent, languages: [...navigator.languages], brands: d.brands, fullVersionList: h.fullVersionList}; });
  if (!process.argv.includes('--echo-only')) for (const [index, name] of names.entries()) {
    if (index) await new Promise(r => setTimeout(r, gap));
    const url = VARIANTS[name]; const entry = {name, input: url};
    await page.goto(url, {waitUntil: 'load', timeout: 30000}).catch(e => entry.error = String(e.message));
    await page.waitForTimeout(4000);
    Object.assign(entry, await page.evaluate(() => {
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      const isRoot = href => { try { const u = new URL(href); return /^(www\.)?youtube\.com$/.test(u.hostname) && u.pathname === '/'; } catch { return false; } };
      const shown = [...document.querySelectorAll('#rso a h3, #search a h3')].filter(visible).map(h => ({title: h.innerText.slice(0, 90), href: h.closest('a')?.href || '', top: h.getBoundingClientRect().top})).sort((a, b) => a.top - b.top);
      const text = document.body?.innerText || '';
      return {url: location.href, robot: location.pathname.startsWith('/sorry') || /unusual traffic/i.test(text), firstOrganic: shown[0] || null, youtubeFirst: !!shown[0] && isRoot(shown[0].href), firstFive: shown.slice(0, 5).map(r => r.title + ' <' + r.href.slice(0, 60) + '>')};
    }).catch(e => ({error: String(e.message)})));
    await page.screenshot({path: path.join(out, `${name}-page.png`)}).catch(() => {});
    console.log(`${name}: youtubeFirst=${entry.youtubeFirst} robot=${entry.robot} first=${JSON.stringify(entry.firstOrganic?.title)} <${entry.firstOrganic?.href}>`);
    report.variants.push(entry);
    if (entry.robot) { report.stopped = 'unusual traffic page'; break; }
  }
} finally {
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
  await context.close().catch(() => {}); server.close();
  await fs.rm(userData, {recursive: true, force: true}).catch(() => {});
}
console.log('wrote', path.join(out, 'result.json'));
