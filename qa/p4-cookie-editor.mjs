// Host access on a page with a PORT, with a real store extension: Cookie-Editor (hlkenndednhfkekhgcdicdfddnkalmdm) has only optional host access.
// A local server on 127.0.0.1:<port> sets two cookies; the extension's popup (hidden window, no focus taken) must
//   1. say it has no permission before anything is granted,
//   2. after its own "This site" button (permissions.request for [http://127.0.0.1/*, http://*.0.1/*], answered through Acira's prompt like a person
//      pressing "Allow") list the cookies of the tab at http://127.0.0.1:<port>/ - Chrome's match patterns ignore the port unless the pattern
//      names one, so permissions.contains for the tab's own URL (with the port) is true, and so is cookies.getAll({url}),
//   3. and the other way round: a pattern that names a port covers only that port.
//   node qa/p4-cookie-editor.mjs      (cwd = repo; one native slot; hard cap 6 minutes; app closed in finally)
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {httpFixture, poll} from './d-harness.mjs';
import {launchIsolated, installWithRetry as install, installedManifest, openExtensionPage, sleep} from './p4-live.mjs';
import {takeSlot, releaseSlot} from './native-slot.mjs';

const ID = 'hlkenndednhfkekhgcdicdfddnkalmdm';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve('qa/artifacts/p4-cookie-editor', stamp);
await fs.mkdir(OUT, {recursive: true});
const result = {extension: 'Cookie-Editor', id: ID, steps: []};
const step = (name, value) => { result.steps.push({name, value}); console.log('STEP', name, value === undefined ? '' : JSON.stringify(value).slice(0, 500)); };
const DOC = '(document.querySelector("iframe") && document.querySelector("iframe").contentDocument || document)';
const text = page => page.run(`${DOC}.body.innerText`, false).catch(error => 'ERR ' + error.message);

const site = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.setHeader('set-cookie', ['p4_seen=hello; Path=/; Max-Age=3600', 'p4_second=two; Path=/; Max-Age=3600']);
  res.end('<title>cookie site</title>ok');
});
const origin = `http://127.0.0.1:${site.port}`;
const slot = await takeSlot('p4-cookie-editor');
let app;
const pages = [];
try {
  app = await launchIsolated('p4c' + Date.now().toString(36).slice(-4));
  await app.act({type: 'tab.new', url: `${origin}/`});
  await poll(async () => ((await app.state()).tabs.find(t => t.url.includes(`127.0.0.1:${site.port}`)))?.title, t => t === 'cookie site', 'cookie page loaded', 15000);
  const installed = await install(app, ID);
  assert.ok(!installed.error, 'store install: ' + installed.error);
  const {manifest} = await installedManifest(app, ID);
  const popup = (manifest.action || manifest.browser_action || {}).default_popup;
  assert.ok(popup, 'popup page');
  step('installed', {name: installed.entry.name, version: installed.entry.version, optionalHosts: manifest.optional_host_permissions, hosts: manifest.host_permissions, permissions: manifest.permissions});

  // 1. Before the grant.
  const page = await openExtensionPage(app, ID, popup, 'ce1'); pages.push(page);
  await sleep(4000);
  const before = String(await text(page));
  assert.ok(!/p4_seen/.test(before), 'no cookies listed before the grant');
  assert.equal(await page.run(`chrome.permissions.contains({origins: ['${origin}/']})`, false), false);
  step('before the grant', {popup: before.replace(/\s+/g, ' ').slice(0, 160)});

  // 1b. Granting only http://127.0.0.1/* (what qa/p6-store-extensions.mjs did) is not what the popup asks for: its check is
  //     contains([http://127.0.0.1/*, http://*.0.1/*]) - host and "root domain" of the URL - so it still complains, in Chrome too. The port is not
  //     the reason: the single pattern already covers the tab's URL with its port.
  assert.equal(await page.run(`chrome.permissions.request({origins: ['http://127.0.0.1/*']})`, true), true);
  assert.equal(await page.run(`chrome.permissions.contains({origins: ['${origin}/']})`, false), true, 'the tab URL with its port is covered by http://127.0.0.1/*');
  assert.equal(await page.run(`chrome.permissions.contains({origins: ['http://127.0.0.1/*', 'http://*.0.1/*']})`, false), false, "the popup's two-pattern check needs the second pattern too");
  step('only http://127.0.0.1/* granted', {tabUrlWithPortCovered: true, popupsTwoPatternCheck: false});

  // 2. The popup's own "This site" button.
  const baseline = (await app.asked()).length;
  assert.equal(await page.run(`(${DOC}.getElementById('request-permission').click(), true)`, true), true);
  await poll(async () => (await app.asked()).length, n => n > baseline, 'Acira asked for the access', 15000);
  const prompt = (await app.asked()).slice(baseline);
  assert.equal(prompt.length, 1, 'one prompt');
  step('granted through the popup', {prompt: {message: prompt[0].message, detail: prompt[0].detail}});
  const listed = await poll(() => text(page), t => /p4_seen/.test(String(t)) && /p4_second/.test(String(t)), "Cookie-Editor lists the open tab's cookies", 25000);
  // The popup keeps its "no permission" box in the page and shows or hides it: what counts is whether a person would see it.
  const complaintVisible = () => page.run(`(() => {
    const d = ${DOC};
    const el = [...d.querySelectorAll('div,p,span')].find(e => [...e.childNodes].some(n => n.nodeType === 3 && /do not have the permission/i.test(n.textContent)));
    return !!el && (el.checkVisibility ? el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) : !!el.offsetParent);
  })()`, false);
  await poll(complaintVisible, visible => visible === false, 'the "no permission" box is hidden once the cookies are listed', 15000);
  step('popup after the grant', {listsCookies: true, complaintVisible: false, text: String(listed).replace(/\s+/g, ' ').slice(0, 200)});
  const checks = {};
  for (const pattern of [`${origin}/`, `${origin}/*`, 'http://127.0.0.1/*', 'http://127.0.0.1:1/*', 'https://127.0.0.1/*', 'http://localhost/*'])
    checks[pattern] = await page.run(`chrome.permissions.contains({origins: [${JSON.stringify(pattern)}]})`, false);
  assert.deepEqual(checks, {[`${origin}/`]: true, [`${origin}/*`]: true, 'http://127.0.0.1/*': true, 'http://127.0.0.1:1/*': true, 'https://127.0.0.1/*': false, 'http://localhost/*': false});
  step('permissions.contains (the granted pattern names no port, so every port is covered)', checks);
  assert.equal(await page.run(`chrome.permissions.contains({origins: ['http://127.0.0.1/*', 'http://*.0.1/*']})`, false), true, "the popup's own two-pattern check");
  const viaApi = await page.run(`chrome.cookies.getAll({url: '${origin}/'}).then(list => list.map(c => c.name).sort())`, false);
  assert.deepEqual(viaApi, ['p4_second', 'p4_seen']);

  // 3. A pattern that names a port covers only that port.
  const base = site.port;
  const other = base === 65535 ? base - 1 : base + 1;
  const probe = await page.run(`(async () => ({
    narrowBefore: await chrome.permissions.contains({origins: ['http://localhost:${base}/*']}),
    grantedNarrow: await chrome.permissions.request({origins: ['http://localhost:${base}/*']}),
    same: await chrome.permissions.contains({origins: ['http://localhost:${base}/x']}),
    otherPort: await chrome.permissions.contains({origins: ['http://localhost:${other}/x']}),
    cookiesSamePort: await chrome.cookies.getAll({url: 'http://localhost:${base}/'}).then(l => l.length, e => e.message),
    cookiesOtherPort: await chrome.cookies.getAll({url: 'http://localhost:${other}/'}).then(l => l.length, e => e.message)
  }))()`, true);
  assert.equal(probe.narrowBefore, false);
  assert.equal(probe.grantedNarrow, true);
  assert.equal(probe.same, true);
  assert.equal(probe.otherPort, false, 'a pattern that names a port does not cover another port');
  assert.equal(typeof probe.cookiesSamePort, 'number');
  assert.match(String(probe.cookiesOtherPort), /No host permissions for cookies at url/);
  step('a pattern with a port covers only that port', probe);
  result.ok = true;
} catch (error) {
  result.ok = false;
  result.error = String(error && error.stack || error).slice(0, 1800);
  console.log('FAILED', result.error);
} finally {
  for (const p of pages) try { await p.close(); } catch {}
  try { result.asked = await app?.asked(); } catch {}
  try { await app?.close(); } catch {}
  site.close();
  await releaseSlot(slot);
}
await fs.writeFile(path.join(OUT, 'result.json'), JSON.stringify(result, null, 1));
console.log(result.ok ? 'PASS' : 'FAIL', 'wrote', OUT);
process.exitCode = result.ok ? 0 : 1;
