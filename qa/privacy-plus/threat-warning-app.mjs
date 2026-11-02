// The phishing/malware warning in the real app: a local host listed in seeded copies of the two lists is blocked with the warning page, the rest of the site loads,
// "Continue anyway" lets the site through. Seeded lists keep the daily refresh from replacing them (their saved time is "now").   node qa/privacy-plus/threat-warning-app.mjs
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {startApp, sleep} from '../d-harness.mjs';
const root = path.resolve('.qa-profiles/j-threat-warning'); await fs.rm(root, {recursive: true, force: true});
const filler = title => `! Title: ${title}\n! Updated: 2026-10-24T12:00:00Z\n${Array.from({length: 600}, (_, i) => `filler-${i}.example.test`).join('\n')}\n`;
await fs.mkdir(path.join(root, 'threat-lists'), {recursive: true});
await fs.writeFile(path.join(root, 'threat-lists', 'phishing.txt'), filler('Phishing URL Blocklist') + '||127.0.0.1/phish^$all\n');
await fs.writeFile(path.join(root, 'threat-lists', 'malware.txt'), filler('Online Malicious URL Blocklist') + '||127.0.0.1/malware^$all\n||127.0.0.1/payload.js^$all\n');
// The third feed (Phishing.Database, at least 50,000 domains) is seeded too: with it missing, the 6 s refresh downloads every list and replaces the seeded two.
await fs.writeFile(path.join(root, 'threat-lists', 'phishing-db.txt'), Array.from({length: 50001}, (_, i) => `db-filler-${i}.example.test`).join('\n') + '\n');
await fs.writeFile(path.join(root, 'threat-lists', 'threat-lists.json'), JSON.stringify({phishing: {updated: Date.now()}, malware: {updated: Date.now()}, 'phishing-db': {updated: Date.now()}}));
const page = (title, extra = '') => `<!doctype html><title>${title}</title><body><h1>${title}</h1>${extra}`;
const server = http.createServer((req, res) => { const routes = {'/phish/login': page('phish page'), '/phishing2': page('phishing2 page'), '/ok': page('ok page', '<script src="/payload.js"></script><script src="/clean.js"></script>'), '/malware/a': page('malware page'), '/payload.js': 'window.payloadRan = true', '/clean.js': 'window.cleanRan = true'};
  const body = routes[req.url.split('?')[0]]; res.statusCode = body ? 200 : 404; res.setHeader('content-type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(body || 'nf'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
const app = await startApp({root}); const out = {};
try {
  await sleep(2500);
  const open = async path => { await app.act({type: 'tab.new', url: base + path}); await sleep(3500); const tab = (await app.state()).tabs.at(-1); return {tab: {url: tab.url.replace(base, ''), error: tab.error, loading: tab.loading}, text: await app.ui.evaluate(() => document.querySelector('.navigation-error')?.innerText || '') }; };
  const blocked = await open('/phish/login'); out.phish = {tab: blocked.tab, title: await app.ui.evaluate(() => document.querySelector('.ne-title')?.textContent), message: await app.ui.evaluate(() => document.querySelector('.ne-message')?.textContent), buttons: await app.ui.evaluate(() => [...document.querySelectorAll('.navigation-error button')].map(b => b.textContent.trim()))};
  await app.ui.screenshot({path: 'qa/artifacts/threat-warning-1.png'});
  await app.ui.getByRole('button', {name: 'Continue anyway (unsafe)'}).click(); await sleep(400);
  out.armed = await app.ui.evaluate(() => [...document.querySelectorAll('.navigation-error [role=group] p, .navigation-error [role=group] button')].map(e => e.textContent.trim()));
  await app.ui.screenshot({path: 'qa/artifacts/threat-warning-2.png'});
  await app.ui.getByRole('button', {name: /^Proceed to/}).click(); await sleep(3500);
  const afterTab = (await app.state()).tabs.at(-1); const web = app.web(base + '/phish/login');
  out.afterContinue = {tab: {url: afterTab.url.replace(base, ''), error: afterTab.error}, title: web ? await web.title() : null};
  const ok = await open('/ok'); const okPage = app.web(base + '/ok'); out.ok = {tab: ok.tab, payloadRan: okPage ? await okPage.evaluate(() => window.payloadRan === true) : null, cleanScriptRan: okPage ? await okPage.evaluate(() => window.cleanRan === true) : null};
  const boundary = await open('/phishing2'); out.boundary = {tab: boundary.tab, title: app.web(base + '/phishing2') ? await app.web(base + '/phishing2').title() : null};
  const malware = await open('/malware/a'); out.malware = {tab: malware.tab, title: await app.ui.evaluate(() => document.querySelector('.ne-title')?.textContent), message: await app.ui.evaluate(() => document.querySelector('.ne-message')?.textContent)};
  out.status = (await app.svc({type: 'antitracking.status'})).antiTracking.stats.threats; out.row = (await app.svc({type: 'protection.status'})).protection.rows.find(row => row.id === 'phishing-malware');
} catch (error) { out.error = String(error.stack || error).slice(0, 500); }
finally { await fs.mkdir('qa/artifacts', {recursive: true}); await fs.writeFile('qa/artifacts/threat-warning-app.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1).slice(0, 3500)); await app.close(); server.close(); process.exit(0); }
