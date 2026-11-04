// A typed address that cannot make a secure connection no longer opens over http by itself (someone on the network who blocks port 443
// used to land the person on the plain http page 60 ms later, with only a toast). The error page asks first; a site this profile
// already chose opens straight away; private tabs ask every time.
//   node qa/r14-https-fallback.mjs [shots]          (D_APP_MAIN=<other checkout>/desktop/main.cjs runs that checkout: "before")
// Prints one JSON line. Shots (light and dark, the armed question) go to the profile folder.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = '.qa-profiles/r14-https-' + process.pid; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const shots = process.argv.includes('shots'), report = [];
let hits = 0;
const site = await httpFixture((_request, response) => { hits++; response.setHeader('content-type', 'text/html'); response.end('<title>plain site</title><h1>plain</h1>'); });
// A name with no port, as people type it: an address with a port (or a reserved name such as .example) opens over http without an https try
// (src/runtime/navigation.ts). Both its https and http ports go to the local http server; the name never reaches real DNS.
const address = 'http-only.example.com', hostRules = `--host-resolver-rules=MAP http-only.example.com:443 127.0.0.1:${site.port},MAP http-only.example.com:80 127.0.0.1:${site.port},EXCLUDE localhost`;
const app = await startApp({root, args: ['--use-mock-keychain', hostRules]});
const lastTab = async () => (await app.state()).tabs.at(-1);
const settle = (label, accept) => poll(lastTab, accept, label, 20000);
let result;
try {
  assert.equal(await app.main(({app}) => app.commandLine.hasSwitch('use-mock-keychain')), true, 'mock keychain');
  const userData = await app.main(({app}) => app.getPath('userData'));
  assert.ok(path.resolve(userData).startsWith(path.resolve(root)), 'throwaway profile only: ' + userData);
  await app.act({type: 'settings.update', patch: {language: 'en', appearance: 'light', interfaceScale: 100}});
  await app.act({type: 'tab.new', url: address});
  const tab = await settle('secure connection fails', t => t.error || t.url.startsWith('http://'));
  await sleep(1500); const still = await lastTab();
  result = {firstError: tab.error, urlAfterWait: still.url, httpRequestsBeforeClick: hits};
  if (still.url.startsWith('http://')) { result.silentHttp = true; console.log(JSON.stringify(result)); process.exitCode = 1; } else {
    assert.match(tab.error, /\(-(?:100|101|102|103|104|107|113|118|324)\)/, tab.error); assert.equal(hits, 0, 'no http request before the click');
    report.push('no secure connection: the page asks and nothing opens over http (' + tab.error + ')');
    const page = app.ui, link = page.getByRole('button', {name: /Continue over http \(not secure\)/});
    await link.waitFor({timeout: 8000});
    assert.equal(await page.getByRole('heading', {name: 'No secure connection to this site'}).count(), 1, 'its own title');
    assert.equal(await page.locator('.ne-actions [data-primary]').textContent(), 'Go back', 'Go back is the default');
    await link.click();
    await page.getByRole('group', {name: 'Continue over http'}).waitFor({timeout: 5000});
    assert.equal(hits, 0, 'arming the choice must not load the page');
    if (shots) for (const appearance of ['light', 'dark']) { await app.act({type: 'settings.update', patch: {appearance}}); await sleep(900); if (!(await page.locator('.ne-unsafe [role=group]').count())) await page.locator('.ne-unsafe .ne-link').click(); await page.locator('.navigation-error').screenshot({path: path.join(root, `https-fallback-${appearance}.png`)}); }
    const clipped = [];
    for (const [appearance, interfaceScale, language] of [['light', 100, 'en'], ['dark', 150, 'de'], ['light', 100, 'ru'], ['dark', 100, 'ar'], ['light', 150, 'ja']]) {
      await app.act({type: 'settings.update', patch: {appearance, interfaceScale, language}}); await sleep(900);
      if (!(await page.locator('.ne-unsafe [role=group]').count())) await page.locator('.ne-unsafe .ne-link').click();
      await sleep(250);
      const bad = await page.evaluate(() => { const out = [], view = document.documentElement.clientWidth; for (const el of document.querySelectorAll('.navigation-error .ne-title, .ne-message, .ne-unsafe *, .ne-actions *')) { const r = el.getBoundingClientRect(); if (!r.width) continue; if (r.right > view + 1 || r.left < -1 || el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible') out.push(el.className + ' ' + Math.round(r.left) + '-' + Math.round(r.right)); } return out; });
      if (bad.length) clipped.push(`${appearance}-${interfaceScale}-${language}: ${bad.join('; ')}`);
    }
    assert.deepEqual(clipped, [], 'clipped: ' + clipped.join(' | ')); report.push('no clipping in light/dark, 100/150%, en/de/ru/ar/ja');
    await app.act({type: 'settings.update', patch: {appearance: 'light', interfaceScale: 100, language: 'en'}}); await sleep(900);
    if (!(await page.locator('.ne-unsafe [role=group]').count())) await page.locator('.ne-unsafe .ne-link').click();
    await page.locator('.ne-unsafe [role=group] .ne-button').click();
    await poll(async () => (await lastTab()).title, t => t === 'plain site', 'opens over http after the click', 20000);
    assert.ok(hits >= 1); assert.ok((await lastTab()).url.startsWith('http://http-only.example.com'), (await lastTab()).url); report.push('the click opens it over http');
    const before = hits; await app.act({type: 'tab.new', url: address});
    await poll(lastTab, t => t.title === 'plain site' && t.url.startsWith('http://'), 'the chosen site opens over http without asking', 20000); assert.ok(hits > before); report.push('a site this profile chose opens without asking');
    await app.act({type: 'tab.new', url: address, privacy: 'private'});
    await settle('the private tab asks', t => t.error); await sleep(1200); const privateTab = await lastTab();
    assert.ok(privateTab.url.startsWith('https://') && privateTab.error, 'a private tab stays on the page that asks: ' + privateTab.url); report.push('a private tab asks again');
    // Only that page can ask: a tab that is not on it is refused.
    const refused = await app.svc({type: 'https.allow-http', tabId: (await app.state()).tabs[0].id}).then(() => null, error => String(error.message || error));
    assert.match(refused || '', /secure connection page/); report.push('any other tab is refused');
    result = {...result, ok: true, report};
    console.log(JSON.stringify(result));
  }
} finally { await app.close(); await site.close(); if (!shots) await fs.rm(root, {recursive: true, force: true}); }
