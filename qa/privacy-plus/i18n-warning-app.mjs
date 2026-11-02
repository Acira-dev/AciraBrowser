// The phishing/malware warning in the real app: a local host listed in seeded copies of the two lists is blocked with the warning page, the rest of the site loads,
// "Continue anyway" lets the site through. Seeded lists keep the daily refresh from replacing them (their saved time is "now").   node qa/privacy-plus/threat-warning-app.mjs
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {startApp, sleep} from '../d-harness.mjs';
const root = path.resolve('.qa-profiles/j-i18n-warning'); await fs.rm(root, {recursive: true, force: true});
const filler = title => `! Title: ${title}\n! Updated: 2026-10-24T12:00:00Z\n${Array.from({length: 600}, (_, i) => `filler-${i}.example.test`).join('\n')}\n`;
await fs.mkdir(path.join(root, 'threat-lists'), {recursive: true});
await fs.writeFile(path.join(root, 'threat-lists', 'phishing.txt'), filler('Phishing URL Blocklist') + '||127.0.0.1/phish^$all\n');
await fs.writeFile(path.join(root, 'threat-lists', 'malware.txt'), filler('Online Malicious URL Blocklist') + '||127.0.0.1/malware^$all\n||127.0.0.1/payload.js^$all\n');
await fs.writeFile(path.join(root, 'threat-lists', 'threat-lists.json'), JSON.stringify({phishing: {updated: Date.now()}, malware: {updated: Date.now()}}));
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>page</title><body>page'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
const checks = [];
const check = (name, ok, detail) => { checks.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(detail)); };
const expected = {de: 'Acira hat eine gefährliche Seite blockiert', fr: 'Acira a bloqué une page dangereuse', ja: 'Acira が危険なページをブロックしました', en: 'Acira blocked a dangerous page'};
const app = await startApp({root});
try {
  await sleep(2500);
  for (const language of ['de', 'fr', 'ja', 'en']) {
    await app.act({type: 'settings.update', patch: {language}}); await sleep(600);
    await app.act({type: 'tab.new', url: base + '/phish/login'}); await sleep(3500);
    const title = await app.ui.evaluate(() => document.querySelector('.ne-title')?.textContent);
    check(language + ': warning title in the chosen language', title === expected[language], title);
    await app.ui.locator('.ne-link').click(); await sleep(400);
    const fit = await app.ui.evaluate(() => { const root = document.querySelector('.navigation-error'); const bad = [...root.querySelectorAll('*')].filter(el => el.getBoundingClientRect().width > 0 && (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible')).map(el => el.className || el.tagName); const outside = [...root.querySelectorAll('p,button,summary,dt,dd')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).map(el => el.textContent.slice(0, 40)); return {bad, outside, text: [...root.querySelectorAll('[role=group] p, [role=group] button')].map(e => e.textContent.trim().slice(0, 90))}; });
    check(language + ': nothing clipped or outside the window', !fit.bad.length && !fit.outside.length, fit);
    console.log('  ', language, JSON.stringify(fit.text));
    await app.ui.screenshot({path: `qa/artifacts/i18n-warning-${language}.png`});
  }
} finally { await app.close(); server.close(); }
console.log(checks.every(Boolean) ? 'ALL PASS' : 'FAILED');
process.exit(checks.every(Boolean) ? 0 : 1);
