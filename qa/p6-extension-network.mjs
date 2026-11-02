// Extensions P6 in the real app: chrome.proxy / chrome.privacy / chrome.cookies of an extension on an isolated profile.
//   node qa/p6-extension-network.mjs [--tor]     (--tor also opens a Tor tab, which starts tor.exe, to prove the Tor session is untouched)
// One Electron, one native slot (C:\ae\slot-N.lock), closed in finally. Local servers only; a name that only the fixture proxy can resolve proves the route.
//  1. proxy.settings.get/set: an extension's fixed_servers proxy really carries a tab's traffic; levelOfControl; Settings status says who controls it
//  2. the person's "Use my setting" (proxy.takeBack) puts the route back and the extension hears onChange
//  3. disabling the extension hands the route back; enabling it brings its proxy back
//  4. WebRTC: a stricter privacy.network policy reaches the open pages, a looser one is ignored
//  5. cookies: the ordinary store is readable with host permission, set / remove work; a private tab's cookie is not visible
//  6. (--tor) the Tor session's proxy and WebRTC lock are identical before, during and after
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const root = '.qa-profiles/p6-ext-network';
await fs.rm(root, {recursive: true, force: true});
const withTor = process.argv.includes('--tor');
const report = [];
const ok = label => { report.push(label); console.log('PASS', label); };

async function takeSlot() {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (let n = 1; n <= 3; n++) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`p6-extension-network ${new Date().toISOString()}\n`); await handle.close(); return file; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    console.log('all native slots busy; waiting 30 s'); await sleep(30000);
  }
  throw Error('no native slot within 20 minutes');
}

// The extension: a service worker that does nothing and a page the rig drives.
const extDir = path.resolve('.qa-profiles', 'p6-ext-network-files');
await fs.rm(extDir, {recursive: true, force: true}); await fs.mkdir(extDir, {recursive: true});
await fs.writeFile(path.join(extDir, 'manifest.json'), JSON.stringify({
  manifest_version: 3, name: 'P6 network test', version: '1.0', permissions: ['proxy', 'privacy', 'cookies'], host_permissions: ['<all_urls>'],
  background: {service_worker: 'sw.js'}, options_ui: {page: 'page.html', open_in_tab: true}
}));
await fs.writeFile(path.join(extDir, 'sw.js'), '// nothing: the rig drives chrome.* from page.html\n');
await fs.writeFile(path.join(extDir, 'page.html'), '<!doctype html><meta charset=utf-8><title>P6</title><script src="page.js"></script>');
await fs.writeFile(path.join(extDir, 'page.js'), 'window.events = []; chrome.proxy.settings.onChange.addListener(d => window.events.push(["proxy", d.levelOfControl, d.value && d.value.mode])); chrome.privacy.network.webRTCIPHandlingPolicy.onChange.addListener(d => window.events.push(["rtc", d.levelOfControl, d.value])); chrome.cookies.onChanged.addListener(i => window.events.push(["cookie", i.cookie.name, i.removed, i.cause]));\n');

const seen = [];
const proxy = http.createServer((req, res) => {
  seen.push(req.url);
  res.setHeader('content-type', 'text/html'); res.end(`<title>via proxy: ${new URL(req.url).host}</title>ok`);
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const site = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  if (req.url.startsWith('/cookie')) res.setHeader('set-cookie', [`p6_ordinary=${req.url.includes('private') ? 'private' : 'ordinary'}; Path=/; Max-Age=3600`]);
  res.end('<title>site</title>ok');
});

let slot, app;
const ui_reset = async () => { const ui = app.context.pages().find(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } }); await ui?.evaluate(() => window.acira.dispatch({type: 'settings.update', patch: {language: 'en', interfaceScale: 100, appearance: 'light'}})).catch(() => {}); };
try {
  slot = await takeSlot();
  app = await startApp({root});
  await app.main(({dialog}, folder) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [folder]});
    dialog.showMessageBox = async (...args) => { const o = args.at(-1) || {}; return {response: Array.isArray(o.buttons) && o.buttons.length === 2 ? 1 : 0, checkboxChecked: false}; };
  }, extDir);
  const state0 = await app.state(), profileId = state0.activeBrowserProfileId, partition = state0.browserProfiles.find(p => p.id === profileId).partition;
  const ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request});
  const loaded = await ext({type: 'load'});
  const entry = (loaded.extensions || []).find(e => e.name === 'P6 network test');
  assert.ok(entry, 'extension loaded: ' + JSON.stringify(loaded).slice(0, 300));
  const id = entry.id;
  await app.main(({BrowserWindow, session}, args) => {
    const w = new BrowserWindow({show: false, width: 500, height: 400, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
    globalThis.__p6page = w; return w.loadURL(args.url);
  }, {partition, url: `chrome-extension://${id}/page.html`});
  await poll(() => app.main(() => globalThis.__p6page.webContents.executeJavaScript('typeof chrome !== "undefined" && !!chrome.proxy && Array.isArray(window.events)')), Boolean, 'extension page ready', 30000);
  // Runs code in the extension page; a rejected promise comes back as {error}.
  const run = code => app.main(async (_, code) => { try { return {value: await globalThis.__p6page.webContents.executeJavaScript(code)}; } catch (error) { return {error: String(error && error.message || error)}; } }, code);
  const value = async code => { const r = await run(code); assert.equal(r.error, undefined, `${code} -> ${r.error}`); return r.value; };
  const route = url => app.main(async ({session}, args) => String(await session.fromPartition(args.partition).resolveProxy(args.url)), {partition, url});
  const tabByHost = async host => (await app.state()).tabs.find(t => t.url.includes(host));

  // Tor tab first (--tor): its session proxy must be the same before, during and after.
  let torProbe = null;
  const torSession = () => app.main(async ({webContents}) => {
    const wc = webContents.getAllWebContents().find(w => !w.isDestroyed() && w.session.__aciraTor);
    return wc ? {proxy: String(await wc.session.resolveProxy('https://example.org/')), rtc: wc.getWebRTCIPHandlingPolicy()} : null;
  });
  if (withTor) {
    await app.act({type: 'tab.new', privacy: 'tor', url: 'http://p6-tor-probe.test/'});
    torProbe = await poll(torSession, Boolean, 'tor session exists', 30000).catch(async error => {
      const seen = await app.main(({webContents}) => webContents.getAllWebContents().map(w => { try { return [w.getURL().slice(0, 60), !!w.session.__aciraTor]; } catch { return ['?', '?']; } }));
      console.log('NOTE no Tor session found: ' + error.message + ' | web contents: ' + JSON.stringify(seen) + ' | tabs: ' + JSON.stringify((await app.state()).tabs.map(t => [t.url.slice(0, 40), t.privacy])));
      return null;
    });
    // Tor's gate starts closed (a sentinel SOCKS address) and opens when tor.exe has connected: take the baseline after that, so a change can only be the extension's.
    if (torProbe) {
      const settled = await poll(torSession, s => s && s.proxy !== 'SOCKS5 127.0.0.1:9', 'tor gate opens', 120000).catch(() => null);
      if (settled) torProbe = settled; else console.log('NOTE Tor did not connect within 120 s: the baseline is the closed gate');
    }
    console.log('Tor session before:', JSON.stringify(torProbe));
  }

  // 1. get / set
  const before = await value('chrome.proxy.settings.get({})');
  assert.deepEqual(before, {value: {mode: 'system'}, levelOfControl: 'controllable_by_this_extension'});
  assert.equal((await app.svc({type: 'proxy.status'})).proxy.controlledBy, undefined);
  assert.match(await route('http://p6-viaext.test/'), /^DIRECT$/);
  ok('before: system proxy, controllable_by_this_extension, nothing controls the profile');
  await value(`chrome.proxy.settings.set({value: {mode: 'fixed_servers', rules: {singleProxy: {scheme: 'http', host: '127.0.0.1', port: ${proxy.address().port}}}}, scope: 'regular'})`);
  const after = await value('chrome.proxy.settings.get({})');
  assert.equal(after.levelOfControl, 'controlled_by_this_extension');
  assert.equal(after.value.mode, 'fixed_servers');
  const status = (await app.svc({type: 'proxy.status'})).proxy;
  assert.deepEqual([status.controlledBy?.name, status.controlledBy?.mode, status.controlledBy?.extensionId], ['P6 network test', 'fixed_servers', id]);
  assert.equal(status.choice.mode, 'system', 'the person\'s own choice is kept');
  assert.equal(await route('http://p6-viaext.test/'), `PROXY 127.0.0.1:${proxy.address().port}`);
  await app.act({type: 'tab.new', url: 'http://p6-viaext.test/hello'});
  await poll(async () => (await tabByHost('p6-viaext.test'))?.title, t => /via proxy: p6-viaext\.test/.test(t), 'page loaded through the extension proxy', 20000);
  assert.ok(seen.some(u => u.startsWith('http://p6-viaext.test/hello')));
  ok('an extension\'s fixed_servers proxy carries a tab\'s traffic; Settings status names the extension; the person\'s choice is kept');
  const rtcPolicy = () => app.main(({webContents}, host) => webContents.getAllWebContents().filter(w => !w.isDestroyed() && w.getURL().includes(host)).map(w => w.getWebRTCIPHandlingPolicy()), 'p6-viaext.test');
  assert.deepEqual(await rtcPolicy(), ['disable_non_proxied_udp']);
  ok('pages of the profile get disable_non_proxied_udp around an extension proxy');
  await assert.rejects(app.svc({type: 'proxy.set', choice: {mode: 'direct'}}), /P6 network test/);
  ok('the person\'s own Apply is refused with the extension\'s name while it holds the proxy');

  // 2. take back
  await app.svc({type: 'proxy.takeBack'});
  assert.equal((await app.svc({type: 'proxy.status'})).proxy.controlledBy, undefined);
  assert.equal(await route('http://p6-viaext.test/'), 'DIRECT');
  assert.equal((await value('chrome.proxy.settings.get({})')).levelOfControl, 'controllable_by_this_extension');
  await poll(() => value('window.events.filter(e => e[0] === "proxy").map(e => e[1])'), list => list.includes('controllable_by_this_extension'), 'extension heard onChange', 10000);
  ok('"Use my setting" returns the route to the person and the extension hears onChange');

  // 3. disable / enable
  await value(`chrome.proxy.settings.set({value: {mode: 'fixed_servers', rules: {proxyForHttp: {host: '127.0.0.1', port: ${proxy.address().port}}}}})`);
  assert.equal(await route('http://p6-viaext.test/'), `PROXY 127.0.0.1:${proxy.address().port}`);
  assert.equal(await route('https://p6-viaext.test/'), 'DIRECT', 'proxyForHttp covers http only');
  await ext({type: 'disable', extensionId: id});
  await poll(() => route('http://p6-viaext.test/'), r => r === 'DIRECT', 'route returns when the extension is disabled', 10000);
  assert.equal((await app.svc({type: 'proxy.status'})).proxy.controlledBy, undefined);
  ok('disabling the extension hands the route back');
  await ext({type: 'enable', extensionId: id});
  await poll(() => route('http://p6-viaext.test/'), r => r === `PROXY 127.0.0.1:${proxy.address().port}`, 'proxy returns when the extension is enabled', 15000);
  ok('enabling it again brings its proxy back (the saved value counts again)');
  // the page of a re-enabled extension is a new context: reopen it
  await app.main(({BrowserWindow}) => { try { globalThis.__p6page.destroy(); } catch {} }, null);
  await app.main(({BrowserWindow, session}, args) => {
    const w = new BrowserWindow({show: false, width: 500, height: 400, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
    globalThis.__p6page = w; return w.loadURL(args.url);
  }, {partition, url: `chrome-extension://${id}/page.html`});
  await poll(() => app.main(() => globalThis.__p6page.webContents.executeJavaScript('typeof chrome !== "undefined" && !!chrome.proxy && Array.isArray(window.events)')), Boolean, 'extension page ready again', 30000);
  await value('chrome.proxy.settings.clear({})');
  assert.equal(await route('http://p6-viaext.test/'), 'DIRECT');

  // 4. WebRTC
  assert.deepEqual(await value('chrome.privacy.network.webRTCIPHandlingPolicy.get({})'), {value: 'default_public_interface_only', levelOfControl: 'controllable_by_this_extension'});
  await value('chrome.privacy.network.webRTCIPHandlingPolicy.set({value: "default"})');
  assert.equal((await value('chrome.privacy.network.webRTCIPHandlingPolicy.get({})')).value, 'default_public_interface_only');
  assert.deepEqual(await rtcPolicy(), ['default_public_interface_only']);
  ok('a looser WebRTC policy than Acira\'s floor is ignored, and get() still says what is in effect');
  await value('chrome.privacy.network.webRTCIPHandlingPolicy.set({value: "disable_non_proxied_udp"})');
  assert.deepEqual(await rtcPolicy(), ['disable_non_proxied_udp']);
  assert.equal((await value('chrome.privacy.network.webRTCIPHandlingPolicy.get({})')).levelOfControl, 'controlled_by_this_extension');
  await value('chrome.privacy.network.webRTCIPHandlingPolicy.clear({})');
  assert.deepEqual(await rtcPolicy(), ['default_public_interface_only']);
  ok('a stricter policy reaches open pages at once and clear() puts Acira\'s back');
  assert.deepEqual(await value('chrome.privacy.network.networkPredictionEnabled.get({})'), {value: false, levelOfControl: 'not_controllable'});
  assert.deepEqual(await value('chrome.privacy.services.autofillCreditCardEnabled.get({})'), {value: false, levelOfControl: 'not_controllable'});
  ok('settings Acira fixes report their real value as not_controllable');

  // 5. cookies
  const origin = `http://127.0.0.1:${site.port}`;
  await app.act({type: 'tab.new', url: `${origin}/cookie`});
  await poll(async () => (await tabByHost(`127.0.0.1:${site.port}/cookie`))?.title, t => t === 'site', 'cookie page loaded', 15000);
  const found = await poll(() => value(`chrome.cookies.getAll({url: "${origin}/"})`), list => list.some(c => c.name === 'p6_ordinary'), 'ordinary cookie visible', 10000);
  assert.deepEqual(found.find(c => c.name === 'p6_ordinary').storeId, '0');
  assert.equal((await value(`chrome.cookies.get({url: "${origin}/", name: "p6_ordinary"})`)).value, 'ordinary');
  const stores = await value('chrome.cookies.getAllCookieStores()');
  assert.equal(stores.length, 1); assert.equal(stores[0].id, '0');
  ok('cookies.getAll/get/getAllCookieStores read the ordinary store');
  const setBack = await value(`chrome.cookies.set({url: "${origin}/", name: "p6_set", value: "x", expirationDate: ${Math.floor(Date.now() / 1000) + 3600}})`);
  assert.equal(setBack.name, 'p6_set'); assert.equal(setBack.session, false);
  assert.deepEqual(await value(`chrome.cookies.remove({url: "${origin}/", name: "p6_set"})`), {url: `${origin}/`, name: 'p6_set', storeId: '0'});
  assert.equal(await value(`chrome.cookies.get({url: "${origin}/", name: "p6_set"})`), null);
  const events = await value('window.events.filter(e => e[0] === "cookie").map(e => e.slice(1).join(":"))');
  assert.ok(events.includes('p6_set:false:explicit') && events.some(e => e.startsWith('p6_set:true')), 'onChanged: ' + events);
  const nope = await run('chrome.cookies.get({url: "' + origin + '/", name: "p6_ordinary", storeId: "1"})');
  assert.match(nope.error, /Invalid cookie store id: "1"/);
  ok('cookies.set/remove work, onChanged is heard, another store id is refused');
  // a private tab on the same site keeps its cookie to itself
  await app.act({type: 'tab.new', privacy: 'private', url: `${origin}/cookie-private`}); await sleep(2500);
  const all = await value(`chrome.cookies.getAll({domain: "127.0.0.1"})`);
  assert.deepEqual(all.filter(c => c.name === 'p6_ordinary').map(c => c.value), ['ordinary'], 'only the ordinary store\'s cookie is visible; the private tab\'s value is not');
  ok('a private tab\'s cookie is not visible to the extension');

  // 7. (--ui) Settings > Connection while an extension holds the proxy: the banner, light/dark x 100/150% x English/German, clip scan, pictures of the interface page
  if (process.argv.includes('--ui')) {
    const scanner = await fs.readFile(path.resolve('qa/m-clip-scan.js'), 'utf8');
    const shots = path.resolve('qa/artifacts/p6-connection'); await fs.mkdir(shots, {recursive: true});
    await value(`chrome.proxy.settings.set({value: {mode: 'fixed_servers', rules: {singleProxy: {host: '127.0.0.1', port: ${proxy.address().port}}}}})`);
    const pickUi = () => poll(() => app.context.pages().find(p => { try { return p.url() === 'acira-browser-ui://ui/index.html'; } catch { return false; } }), Boolean, 'ui page', 20000);
    const bad = [];
    for (const language of ['en', 'de']) for (const scale of [100, 150]) for (const appearance of ['light', 'dark']) {
      const label = `${language}-${scale}-${appearance}`;
      let ui = await pickUi();
      await ui.evaluate(patch => window.acira.dispatch({type: 'settings.update', patch}), {language, interfaceScale: scale, appearance});
      await sleep(2500); ui = await pickUi();
      await ui.evaluate(() => window.acira.dispatch({type: 'tab.new', url: 'acira://settings'})); await sleep(1800);
      const count = await ui.evaluate(() => document.querySelectorAll('.bs-sidebar nav>button').length);
      let found = false;
      for (let i = 0; i < Math.min(count, 24) && !found; i++) {
        await ui.evaluate(index => document.querySelectorAll('.bs-sidebar nav>button')[index]?.click(), i); await sleep(450);
        found = await ui.evaluate(() => Boolean(document.querySelector('[data-setting="proxy-controlled"]')));
      }
      if (!found) { bad.push(`${label}: the banner was not found in any Settings section`); continue; }
      const text = await ui.evaluate(() => document.querySelector('[data-setting="proxy-controlled"]').innerText);
      assert.ok(/P6 network test/.test(text), `${label}: banner names the extension: ${text}`);
      const scan = String(await ui.evaluate(scanner));
      // The rig's own tabs squeeze the strip (tab titles) and the hidden "Tab closed" live region is the scanner's known false positive: neither is the Settings page.
      const hits = scan.split('\n').filter(line => / :: /.test(line) && !/<span\.tab-title>|"Tab closed"|"Tab geschlossen"/.test(line));
      await ui.locator('[data-setting="proxy-controlled"]').scrollIntoViewIfNeeded().catch(() => {});
      await ui.screenshot({path: path.join(shots, `${label}.png`)}).catch(() => {});
      const disabledControls = await ui.evaluate(() => { const row = document.querySelector('[data-setting="proxy-controlled"]'); const group = row && (row.closest('section') || row.parentElement.parentElement); return [...(group ? group.querySelectorAll('button, select, input') : [])].filter(el => el.disabled).map(el => (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24)); });
      if (disabledControls.length < 2) bad.push(`${label}: the connection controls are not locked (disabled: ${JSON.stringify(disabledControls)})`);
      console.log(label, 'banner:', text.replace(/\s+/g, ' ').slice(0, 90), '| locked controls:', JSON.stringify(disabledControls), '| scan hits on this section:', hits.length);
      if (hits.length) bad.push(`${label}: ${hits.join(' || ').slice(0, 400)}`);
      // close the settings tab again (keep the tab count low)
      const tabs = (await app.state()).tabs.filter(t => /settings/.test(t.url)); for (const tab of tabs) await app.act({type: 'tab.close', id: tab.id}).catch(() => {});
    }
    await ui_reset();
    assert.deepEqual(bad, [], 'banner scan: ' + bad.join('\n'));
    ok('Settings > Connection banner: names the extension, controls locked, 0 clip hits in light/dark x 100/150% x English/German');
    await value('chrome.proxy.settings.clear({})');
  }

  // 6. Tor
  if (withTor) {
    assert.ok(torProbe, 'a Tor session was found before the extension acted (see the NOTE above)');
    await value(`chrome.proxy.settings.set({value: {mode: 'fixed_servers', rules: {singleProxy: {host: '127.0.0.1', port: ${proxy.address().port}}}}})`);
    await value('chrome.privacy.network.webRTCIPHandlingPolicy.set({value: "disable_non_proxied_udp"})');
    await sleep(1500);
    const during = await torSession();
    await value('chrome.proxy.settings.clear({})'); await value('chrome.privacy.network.webRTCIPHandlingPolicy.clear({})'); await sleep(1500);
    const afterTor = await torSession();
    console.log('Tor session during:', JSON.stringify(during), 'after:', JSON.stringify(afterTor));
    assert.ok(torProbe.proxy.startsWith('SOCKS5 127.0.0.1:'), 'the Tor session routes through its own SOCKS gate: ' + torProbe.proxy);
    assert.equal(during.proxy, torProbe.proxy); assert.equal(afterTor.proxy, torProbe.proxy);
    assert.equal(during.rtc, torProbe.rtc); assert.equal(afterTor.rtc, torProbe.rtc);
    assert.ok(!String(during.proxy).includes(String(proxy.address().port)), 'the extension\'s proxy never reached the Tor session');
    ok('the Tor session\'s proxy and WebRTC lock are identical before, during and after an extension proxy');
  }
  console.log(`\n${report.length} checks passed`);
} catch (error) {
  console.error('FAIL', error && error.stack || error);
  process.exitCode = 1;
} finally {
  try { await app?.close(); } catch {}
  proxy.close(); site.server.close();
  if (slot) await fs.rm(slot, {force: true});
}
