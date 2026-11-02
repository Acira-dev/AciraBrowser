// End-to-end user-agent check in the real app: a tab loads a local page; prints what the page reads and every header the server received.
//   node qa/privacy-plus/ua-app-check.mjs        (ACIRA_KEEP_ELECTRON_UA=1 shows Electron's own for comparison)
// Uses the QA harness only to open a tab on 127.0.0.1; it says nothing about how sites treat automation (see bing-second-load.mjs).
import http from 'node:http';
import fs from 'node:fs/promises';
import {startApp, sleep} from '../d-harness.mjs';
const seen = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); seen.push({path: url.pathname, headers: req.headers});
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('Accept-CH', 'Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version');
  res.end('<!doctype html><title>ua</title><body>ua');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const root = '.qa-profiles/j-ua-app'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const app = await startApp({root, env: process.env.ACIRA_KEEP_ELECTRON_UA ? {ACIRA_KEEP_ELECTRON_UA: process.env.ACIRA_KEEP_ELECTRON_UA} : {}});
try {
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${server.address().port}/`}); await sleep(5000);
  const page = app.context.pages().filter(p => { try { return new URL(p.url()).hostname === '127.0.0.1'; } catch { return false; } }).at(-1);
  const info = await page.evaluate(async () => ({ ua: navigator.userAgent, brands: navigator.userAgentData && navigator.userAgentData.brands.map(b => b.brand + ' ' + b.version).join(', '),
    high: navigator.userAgentData && JSON.stringify(await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'platformVersion', 'uaFullVersion'])), webdriver: navigator.webdriver, chromeObject: typeof window.chrome }));
  console.log('page reads:', JSON.stringify(info, null, 1));
  const headers = seen.map(s => s.headers); const header = headers.at(-1) || {};
  console.log('server saw user-agent:', header['user-agent']); console.log('server saw sec-ch-ua:', header['sec-ch-ua']);
  console.log('Electron/Acira token in any header:', /electron|acira/i.test(JSON.stringify(headers)) ? 'YES' : 'no');
} finally { await app.close(); server.close(); process.exit(0); }
