// Sign-in and search pages in a tab and in a window.open pop-up: does each one load without an "unsupported / insecure browser" block, a
// CAPTCHA wall or a broken page, and does a pop-up keep window.opener / postMessage? Reads pages only: no credentials are typed, no form is submitted
// (the only interaction is the click on a local page's own button that opens the pop-up, and the Google Identity Services button on that local page).
//   node qa/native-slot.mjs identity-sites -- node qa/identity-sites.mjs --acira <out.json> [site,site]    isolated Acira profile under .qa-profiles/
//   node qa/identity-sites.mjs --chrome <out.json> [site,site]                                              the same pages in Google Chrome (reference)
//   node qa/identity-sites.mjs --show <out.json> [<chrome.json>]                                            prints the table
import './live-google-gate.mjs'; import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const BLOCK = /this browser or app may not be secure|couldn'?t sign you in|unsupported browser|browser (?:is )?not supported|we don'?t support your browser|update your browser|unusual traffic|captcha|verify you are human|are you a robot|confirm you are human|one last step|please solve|access denied|something went wrong/i;
const TEST_CLIENT = '1234567890-abcdefghijklmnopqrstuvwxyz012345.apps.googleusercontent.com';
export const SITES = {
  'google': {url: 'https://accounts.google.com/', expect: 'input[type=email]'},
  'google-mail': {url: 'https://accounts.google.com/ServiceLogin?service=mail&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F', expect: 'input[type=email]'},
  'microsoft-live': {url: 'https://login.live.com/', expect: 'input[name=loginfmt]'},
  'microsoft-online': {url: 'https://login.microsoftonline.com/', expect: 'input[name=loginfmt]'},
  'apple': {url: 'https://appleid.apple.com/sign-in', expect: 'iframe#aid-auth-widget-iFrame, #aid-auth-widget-iFrame, iframe'},
  'github': {url: 'https://github.com/login', expect: '#login_field'},
  'duckduckgo': {url: 'https://duckduckgo.com/?q=acira+browser&ia=web', expect: 'article, [data-testid=result], #links .result, .results'},
  'duckduckgo-html': {url: 'https://html.duckduckgo.com/html/?q=acira+browser', expect: '.result, .results'},
  'duckduckgo-email': {url: 'https://duckduckgo.com/email/', expect: 'body'},
  'duckduckgo-settings': {url: 'https://duckduckgo.com/settings', expect: 'body'},
  'bing': {url: 'https://www.bing.com/search?q=acira+browser', expect: '#b_results .b_algo, #b_results li'},
  'bing-q2': {url: 'https://www.bing.com/search?q=sourdough+starter+ratio', expect: '#b_results .b_algo, #b_results li'},
  'bing-q3': {url: 'https://www.bing.com/search?q=lisbon+tram+28+schedule', expect: '#b_results .b_algo, #b_results li'},
  'duckduckgo-q2': {url: 'https://duckduckgo.com/?q=sourdough+starter+ratio&ia=web', expect: 'article, [data-testid=result], #links .result, .results'},
  'bing-signin': {url: 'https://www.bing.com/fd/auth/signin?action=interactive&provider=windows_live_id&return_url=https%3a%2f%2fwww.bing.com%2f', expect: 'input[name=loginfmt], body'},
};

/** Local pages: an opener that opens a pop-up and records every postMessage it receives, and a Google Identity Services test page. */
async function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8'); res.setHeader('cache-control', 'no-store');
    if (url.pathname === '/opener') {
      res.end(`<!doctype html><title>opener</title><button id="go" style="font-size:22px;padding:14px">open pop-up</button><script>
window.__msgs = []; window.addEventListener('message', event => window.__msgs.push({ origin: event.origin, data: String(event.data).slice(0, 200) }));
document.getElementById('go').addEventListener('click', () => { window.__popup = window.open(${JSON.stringify(url.searchParams.get('target') || 'about:blank')}, 'sso', 'popup=yes,width=640,height=760'); });
</script>`); return;
    }
    if (url.pathname === '/gis') {
      res.end(`<!doctype html><title>gis</title><div id="btn"></div><button id="tok" style="font-size:20px;padding:10px">Sign in with Google (OAuth pop-up)</button><script>
window.__gis = { log: [], errors: [] }; const log = (...a) => window.__gis.log.push(a.join(' ').slice(0, 300));
window.addEventListener('error', e => window.__gis.errors.push(String(e.message).slice(0, 200)));
window.addEventListener('message', e => log('message', e.origin, String(e.data).slice(0, 80)));
const origWarn = console.warn, origErr = console.error; console.warn = (...a) => { log('warn', ...a); origWarn.apply(console, a); }; console.error = (...a) => { log('error', ...a); origErr.apply(console, a); };
</script>
<script src="https://accounts.google.com/gsi/client" async defer onload="
  log('loaded', typeof google, typeof (window.google && google.accounts));
  google.accounts.id.initialize({ client_id: '${TEST_CLIENT}', callback: r => log('callback', Object.keys(r)), use_fedcm_for_prompt: true });
  google.accounts.id.renderButton(document.getElementById('btn'), { type: 'standard', size: 'large' });
  const tokenClient = google.accounts.oauth2.initTokenClient({ client_id: '${TEST_CLIENT}', scope: 'openid email', callback: r => log('token cb', Object.keys(r)), error_callback: e => log('error_callback', e.type) });
  document.getElementById('tok').addEventListener('click', () => tokenClient.requestAccessToken());
  google.accounts.id.prompt(n => log('prompt', n.getMomentType(), n.isNotDisplayed() ? n.getNotDisplayedReason() : '', n.isSkippedMoment() ? n.getSkippedReason() : '', n.isDismissedMoment() ? n.getDismissedReason() : ''));
" onerror="log('script failed')"></script>`); return;
    }
    res.statusCode = 404; res.end('no');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {base: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve))};
}

async function inspect(page, site) {
  await page.waitForLoadState('load', {timeout: 30000}).catch(() => {});
  await wait(Number(process.env.IDENTITY_WAIT) || 5000);
  const info = await page.evaluate(({expect, blockSource}) => {
    const text = (document.body && document.body.innerText || '').replace(/\s+/g, ' ').trim();
    const block = new RegExp(blockSource, 'i').exec(text);
    return {url: location.href, title: document.title, text: text.slice(0, 220), blockHit: block ? block[0] : null, expected: expect ? !!document.querySelector(expect) : null, chrome: typeof window.chrome, webdriver: navigator.webdriver, opener: window.opener !== null, visibility: document.visibilityState, ready: document.readyState, bodyLen: (document.body && document.body.innerHTML.length) || 0};
  }, {expect: site.expect, blockSource: BLOCK.source}).catch(error => ({error: String(error).slice(0, 200)}));
  return info;
}

function recorder() {
  const failed = [], errors = [], bad = [];
  const attach = page => {
    page.on('requestfailed', request => { const f = request.failure()?.errorText || ''; if (!/ABORTED|abort/i.test(f)) failed.push(`${request.resourceType()} ${request.url().slice(0, 110)} ${f}`); });
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text().slice(0, 140)); });
    page.on('response', response => { const s = response.status(); if (s >= 400 && ['document', 'xhr', 'fetch', 'script'].includes(response.request().resourceType())) bad.push(`${s} ${response.request().resourceType()} ${response.url().slice(0, 110)}`); });
  };
  return {attach, take: () => { const out = {failedRequests: failed.splice(0).slice(0, 12), consoleErrors: errors.splice(0).slice(0, 6), badResponses: bad.splice(0).slice(0, 12)}; return out; }};
}

/** drivers: openTab(url) -> page, closePage(page), popupPage(opener) -> the new window's page, context hooks for recording. */
async function drive(driver, server, names, out) {
  const results = {};
  for (const name of names) {
    const site = SITES[name] || (name === 'gis' ? {url: server.base + '/gis'} : null); if (!site) continue;
    const entry = results[name] = {};
    // 1. in a tab
    driver.rec.take();
    const tab = await driver.openTab(site.url); entry.tab = await inspect(tab, site); Object.assign(entry.tab, driver.rec.take()); await driver.closePage(tab);
    // 2. in a pop-up opened by window.open from a local page, with the opener handshake checks
    if (name === 'gis') continue;
    const opener = await driver.openTab(server.base + '/opener?target=' + encodeURIComponent(site.url));
    driver.rec.take();
    const popupPromise = opener.waitForEvent('popup', {timeout: 25000});
    await opener.click('#go');
    const popup = await popupPromise;
    entry.popup = await inspect(popup, site);
    entry.popup.handshake = await popup.evaluate(() => { try { window.opener.postMessage('acira-handshake', '*'); return 'posted'; } catch (error) { return 'ERR ' + error.message; } }).catch(error => 'no opener: ' + String(error).slice(0, 60));
    await wait(400); entry.popup.openerReceived = await opener.evaluate(() => window.__msgs.length).catch(() => null);
    entry.popup.openerSeesPopup = await opener.evaluate(() => !!window.__popup && !window.__popup.closed).catch(() => null);
    entry.popup.cookiesFirstParty = await popup.context().newCDPSession(popup).then(async cdp => (await cdp.send('Network.getCookies', {urls: [site.url]})).cookies.length).catch(() => null);
    Object.assign(entry.popup, driver.rec.take());
    await driver.closePage(popup); await driver.closePage(opener);
    console.log(name.padEnd(20), 'tab:', summary(entry.tab), '| popup:', summary(entry.popup));
  }
  if (names.includes('gis')) {
    const tab = await driver.openTab(server.base + '/gis'); await wait(9000);
    const gis = await tab.evaluate(() => ({log: window.__gis.log, errors: window.__gis.errors, frames: [...document.querySelectorAll('iframe')].map(f => f.src.slice(0, 90)), fedcm: typeof window.IdentityCredential, hasButton: !!document.querySelector('#btn iframe, #btn div[role=button]')})).catch(error => ({error: String(error)}));
    gis.network = driver.rec.take();
    // The Google button on this local page opens the pop-up (the page's own button; no sign-in step is taken).
    // Google's OAuth pop-up flow (google.accounts.oauth2 token client): the page's own button opens accounts.google.com in a pop-up and then watches
    // it through window.opener / popup.closed. With the made-up client id Google answers with its own "invalid client" page, which still proves the
    // pop-up opens, loads, keeps its opener and that the opener sees it close (error_callback popup_closed). Nothing is typed; no form is submitted.
    const popupPromise = tab.waitForEvent('popup', {timeout: 20000}).catch(() => null);
    await tab.click('#tok').catch(() => {});
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState('load', {timeout: 20000}).catch(() => {}); await wait(5000);
      gis.popup = await popup.evaluate(() => ({url: location.href.slice(0, 110), title: document.title, text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200), opener: window.opener !== null})).catch(error => ({error: String(error).slice(0, 100)}));
      await popup.close().catch(() => {}); await wait(3000);
      gis.afterClose = await tab.evaluate(() => window.__gis.log.filter(l => /token cb|error_callback/.test(l))).catch(() => null);
    } else gis.popup = 'no pop-up appeared';
    results.gis = {tab: gis}; await driver.closePage(tab);
    console.log('gis'.padEnd(20), JSON.stringify(gis).slice(0, 1200));
  }
  fs.writeFileSync(out, JSON.stringify(results, null, 1));
}
const summary = r => r.error ? 'ERR ' + r.error : `${r.blockHit ? 'BLOCK(' + r.blockHit + ') ' : ''}expected=${r.expected} url=${r.url.slice(0, 60)} title="${(r.title || '').slice(0, 40)}" opener=${r.opener} chrome=${r.chrome} failed=${(r.failedRequests || []).length}`;

async function runChrome(out, names) {
  const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(file => fs.existsSync(file)), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chrome-sites-'));
  const server = await startServer();
  const context = await chromium.launchPersistentContext(profile, {executablePath: exe, headless: false, ignoreDefaultArgs: ['--enable-automation'], args: ['--no-first-run', '--no-default-browser-check', '--window-position=-2400,0']});
  const rec = recorder(); context.on('page', rec.attach);
  const driver = {rec, openTab: async url => { const page = await context.newPage(); await page.goto(url, {waitUntil: 'commit', timeout: 30000}).catch(() => {}); return page; }, closePage: page => page.close().catch(() => {}),
    nextPage: () => new Promise(resolve => context.once('page', resolve))};
  try { await drive(driver, server, names, out); } finally { await context.close().catch(() => {}); await server.close(); await wait(800); fs.rmSync(profile, {recursive: true, force: true, maxRetries: 3}); }
}

async function runAcira(out, names) {
  const {withSlot} = await import('./native-slot.mjs'), {launchPreparedNative} = await import('./prepared-native.mjs');
  await withSlot('identity-sites', async () => {
    const server = await startServer(), data = path.resolve('.qa-profiles/sites-' + Date.now());
    const app = await launchPreparedNative({executablePath: createRequire(import.meta.url)('electron'), args: [path.resolve('desktop/main.cjs'), '--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'], env: {...process.env, ACIRA_QA_RUN: '1', ACIRA_BROWSER_TEST_DATA: data, ACIRA_BROWSER_TEST_HIDDEN: '1'}});
    try {
      let ui; for (let i = 0; i < 300 && !ui; i++) { ui = app.windows().find(p => p.url() === 'acira-browser-ui://ui/index.html'); if (!ui) await wait(100); }
      if (!ui) throw Error('UI page not found');
      try { await ui.getByRole('button', {name: 'Skip setup', exact: true}).click({timeout: 8000}); } catch { /* past setup */ }
      const rec = recorder(), known = new Set(); const isUi = p => /^acira-browser-ui:/.test(p.url());
      for (const p of app.windows()) known.add(p); app.on('window', p => { if (!isUi(p)) rec.attach(p); });
      const fresh = async () => { for (let i = 0; i < 300; i++) { const p = app.windows().find(q => !known.has(q) && !isUi(q)); if (p) { known.add(p); return p; } await wait(100); } throw Error('no new page'); };
      const ids = new WeakMap(), tabIds = async () => ui.evaluate(async () => (await window.acira.getSnapshot()).tabs.map(t => t.id));
      const driver = {rec, openTab: async url => { const before = new Set(app.windows()), beforeIds = new Set(await tabIds()); await ui.evaluate(u => window.acira.dispatch({type: 'tab.new', url: u}), url); for (let i = 0; i < 300; i++) { const p = app.windows().find(q => !before.has(q) && !isUi(q) && !known.has(q)); if (p) { known.add(p); const now = await tabIds(); ids.set(p, now.find(id => !beforeIds.has(id))); return p; } await wait(100); } throw Error('tab did not appear for ' + url); },
        closePage: async page => { if (!ids.has(page)) await page.close().catch(() => {}); /* tabs stay open: a run is a handful of sites, and closing one while the next opens raced in the harness */ },
        nextPage: () => fresh()};
      await drive(driver, server, names, out);
    } finally { await app.close().catch(() => {}); await server.close(); }
  });
}

function show(file, referenceFile) {
  const a = JSON.parse(fs.readFileSync(file, 'utf8')), b = referenceFile ? JSON.parse(fs.readFileSync(referenceFile, 'utf8')) : {};
  for (const [name, r] of Object.entries(a)) {
    console.log('\n## ' + name);
    for (const kind of ['tab', 'popup']) if (r[kind]) { console.log(`  ${kind}: ${summary(r[kind])}`); if (r[kind].text) console.log('     text: ' + r[kind].text.slice(0, 160)); for (const key of ['failedRequests', 'badResponses', 'consoleErrors']) if (r[kind][key]?.length) console.log(`     ${key}: ${r[kind][key].slice(0, 5).join(' || ')}`); if (r[kind].handshake) console.log('     handshake: ' + r[kind].handshake + ' | opener received ' + r[kind].openerReceived + ' message(s) | opener sees popup: ' + r[kind].openerSeesPopup + ' | first-party cookies: ' + r[kind].cookiesFirstParty); if (b[name]?.[kind]) console.log(`  ${kind} (reference): ${summary(b[name][kind])}`); }
  }
}

const [mode, out, only] = process.argv.slice(2);
const names = (only ? only.split(',') : [...Object.keys(SITES), 'gis']);
if (mode === '--chrome') await runChrome(path.resolve(out), names);
else if (mode === '--acira') await runAcira(path.resolve(out), names);
else if (mode === '--show') show(path.resolve(out), only && path.resolve(only));
else { console.log('usage: --acira <out> [sites] | --chrome <out> [sites] | --show <out> [reference]'); process.exit(2); }
process.exit(0);
