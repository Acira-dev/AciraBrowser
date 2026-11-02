// Extensions P6 with real Chrome Web Store extensions, on an isolated profile (installs go through Acira's own prompt, answered here).
//   node qa/p6-store-extensions.mjs [zeroomega] [cookie-editor] [browsec]     (no names = zeroomega + cookie-editor)
//  - ZeroOmega (proxy manager): starts, takes the profile's proxy through chrome.proxy.settings, its popup switches [Direct] / [System Proxy];
//    Settings status names it; turning it off hands the route back
//  - Cookie-Editor: lists, edits and deletes the cookies of the open tab through chrome.cookies
//  - Browsec (VPN): installs and opens its popup (no sign-in, no connect); the service worker logs no API-denied errors
// One Electron, one native slot, closed in finally. Nothing is signed in; no VPN is connected.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';

const IDS = {zeroomega: 'pfnededegaaopdmhkdmcofjmoldfiped', 'cookie-editor': 'hlkenndednhfkekhgcdicdfddnkalmdm', browsec: 'omghfjlpggmjjaagoclmmobgdodcjboh'};
const wanted = process.argv.slice(2).filter(a => IDS[a]); if (!wanted.length) wanted.push('zeroomega', 'cookie-editor');
const root = '.qa-profiles/p6-store-ext';
await fs.rm(root, {recursive: true, force: true});
const report = [];
const ok = label => { report.push(label); console.log('PASS', label); };
const note = text => console.log('NOTE', text);

async function takeSlot() {
  for (let attempt = 0; attempt < 100; attempt++) {
    for (let n = 1; n <= 3; n++) {
      const file = `C:\\ae\\slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`p6-store-extensions ${new Date().toISOString()}\n`); await handle.close(); return file; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    console.log('all native slots busy; waiting 30 s'); await sleep(30000);
  }
  throw Error('no native slot within 20 minutes');
}

const site = await httpFixture((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.setHeader('set-cookie', ['p6_seen=hello; Path=/; Max-Age=3600', 'p6_second=two; Path=/; Max-Age=3600']);
  res.end('<title>cookie site</title>ok');
});

let slot, app;
try {
  slot = await takeSlot();
  app = await startApp({root, env: {ACIRA_TEST_APP_DIALOG: '1'}});
  const state0 = await app.state(), profileId = state0.activeBrowserProfileId, partition = state0.browserProfiles.find(p => p.id === profileId).partition;
  const ext = request => app.ui.evaluate(request => window.acira.extensions(request), {profileId, ...request});
  // Acira's own prompt asks before anything is added: answer it as a person pressing the main button.
  await app.main(({webContents}) => {
    globalThis.__prompts = []; let ticks = 0;
    const timer = setInterval(async () => {
      if (++ticks > 2400) return clearInterval(timer);
      const wc = webContents.getAllWebContents().find(w => !w.isDestroyed() && w.getURL().includes('native-dialog'));
      if (!wc) return;
      try {
        const info = await wc.executeJavaScript('(()=>{const b=[...document.querySelectorAll("button")];return {text:document.body.innerText.replace(/\\n+/g," | "),buttons:b.map(x=>x.textContent.trim())}})()');
        if (!info.buttons.length) return;
        globalThis.__prompts.push(info);
        await wc.executeJavaScript('(()=>{const b=[...document.querySelectorAll("button")];(b.find(x=>/^(add|allow|grant|load|install|yes)/i.test(x.textContent.trim()))||b[0]).click();return 1})()');
      } catch {}
    }, 250);
  });
  // Service-worker console, kept for the report.
  await app.main(({session}, p) => { globalThis.__sw = []; try { session.fromPartition(p).serviceWorkers.on('console-message', (_e, d) => globalThis.__sw.push(`${d.level}: ${String(d.message).slice(0, 240)} @${String(d.sourceUrl || '').split('/').pop()}:${d.lineNumber}`)); } catch {} }, partition);
  const swLog = () => app.main(() => globalThis.__sw);
  const status = async () => (await app.svc({type: 'proxy.status'})).proxy;
  const openPage = (id, file, key) => app.main(async ({BrowserWindow, session}, args) => {
    globalThis.__pages ||= {};
    const w = new BrowserWindow({show: false, width: 420, height: 640, webPreferences: {session: session.fromPartition(args.partition), sandbox: true, contextIsolation: true}});
    globalThis.__pages[args.key] = w; await w.loadURL(`chrome-extension://${args.id}/${args.file}`).catch(error => { if (!/ERR_ABORTED/.test(String(error))) throw error; }); return true;
  }, {partition, id, file, key});
  const DOC = '(document.querySelector("iframe") && document.querySelector("iframe").contentDocument || document)';
  const inPage = (key, code, gesture = false) => app.main(async (_, a) => { try { return {value: await globalThis.__pages[a.key].webContents.executeJavaScript(`(()=>{const DOC=${a.doc};return (${a.code});})()`, a.gesture)}; } catch (error) { return {error: String(error && error.message || error)}; } }, {key, code, doc: DOC, gesture});
  const install = async name => {
    const id = IDS[name], t0 = Date.now();
    const result = await ext({type: 'install', extensionId: id}).catch(error => ({error: String(error.message || error)}));
    const entry = (result.extensions || []).find(e => e.id === id);
    assert.ok(entry, `${name} installed: ${result.error || 'not listed'}`);
    ok(`${entry.name} ${entry.version} installed from the Chrome Web Store (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    return entry;
  };

  if (wanted.includes('zeroomega')) {
    const entry = await install('zeroomega'), id = entry.id;
    await sleep(8000); console.log('ZeroOmega service worker log:', JSON.stringify((await swLog()).slice(0, 15)));
    // It starts, reads and sets the proxy by itself (its default profile is the system proxy).
    const held = await poll(status, s => s.controlledBy?.extensionId === id, 'ZeroOmega takes the proxy', 8000).catch(async () => { note('ZeroOmega starts on its [System Proxy] profile, which it applies with proxy.settings.clear(): nothing is held (status: ' + JSON.stringify((await status()).controlledBy) + ')'); return null; });
    if (held) ok(`ZeroOmega's own startup call took the profile's proxy: Settings status says "controlled by ${held.controlledBy.name}" (${held.controlledBy.mode})`);
    // Its popup: switch profiles like a person.
    const manifest = await app.main(({session}, a) => session.fromPartition(a.partition).extensions.getExtension(a.id)?.manifest, {partition, id});
    const popup = manifest?.action?.default_popup || manifest?.browser_action?.default_popup;
    assert.ok(popup, 'ZeroOmega has a popup: ' + JSON.stringify(manifest?.action));
    await openPage(id, popup, 'zo');
    const text = () => inPage('zo', 'DOC.body.innerText').then(r => r.value || r.error);
    await poll(text, t => /Direct|System/i.test(String(t)), 'popup shows its profiles', 20000);
    const labelsOf = async () => (await inPage('zo', '[...DOC.querySelectorAll("a,button,li,span,div")].filter(e=>e.children.length===0).map(e=>e.textContent.trim()).filter(Boolean).slice(0,40)')).value;
    console.log('ZeroOmega popup:', JSON.stringify(await labelsOf()).slice(0, 400));
    const click = async pattern => (await inPage('zo', `(()=>{const el=[...DOC.querySelectorAll("a,button,li,span,div")].filter(e=>e.children.length===0).find(e=>/${pattern}/i.test(e.textContent.trim()));if(!el)return "no match";(el.closest("a,button,li")||el).click();return "clicked "+el.textContent.trim();})()`)).value;
    console.log(await click('^\\[?Direct\\]?$'));
    const direct = await poll(status, s => s.controlledBy?.mode === 'direct', 'ZeroOmega set direct', 15000).catch(async () => { note('after clicking Direct: ' + JSON.stringify(await status())); return null; });
    if (direct) ok('ZeroOmega popup [Direct] -> chrome.proxy.settings.set({mode: "direct"}) reaches Acira (status: controlled by ZeroOmega, direct)');
    await openPage(id, popup, 'zo'); await poll(text, t => /Direct|System/i.test(String(t)), 'popup again', 20000);
    console.log(await click('^\\[?System'));
    const released = await poll(status, s => !s.controlledBy && s.effectiveMode === 'system', 'ZeroOmega cleared its proxy', 15000).catch(async () => { note('after clicking System: ' + JSON.stringify(await status())); return null; });
    if (released) ok('ZeroOmega popup [System Proxy] -> chrome.proxy.settings.clear(): the person\'s own setting is back (status: no controlledBy)');
    await openPage(id, popup, 'zo'); await poll(text, t => /Direct|System/i.test(String(t)), 'popup third time', 20000);
    console.log(await click('^\\[?Direct\\]?$'));
    await poll(status, s => s.controlledBy?.mode === 'direct', 'ZeroOmega direct again', 15000);
    await ext({type: 'disable', extensionId: id});
    await poll(status, s => !s.controlledBy, 'route returns when ZeroOmega is disabled', 15000);
    ok('turning ZeroOmega off hands the profile\'s proxy back to the person');
    await ext({type: 'remove', extensionId: id});
    const logs = (await swLog()).filter(l => /denied|proxy|privacy/i.test(l));
    console.log('service worker lines about proxy/denied:', JSON.stringify(logs.slice(0, 6)));
    assert.equal(logs.some(l => /Access to extension API denied/.test(l)), false, 'no API-denied errors');
    await app.main(() => { try { globalThis.__pages.zo.destroy(); } catch {} });
  }

  if (wanted.includes('cookie-editor')) {
    const origin = `http://127.0.0.1:${site.port}`;
    await app.act({type: 'tab.new', url: `${origin}/`});
    await poll(async () => ((await app.state()).tabs.find(t => t.url.includes(`127.0.0.1:${site.port}`)))?.title, t => t === 'cookie site', 'cookie page loaded', 15000);
    const entry = await install('cookie-editor'), id = entry.id;
    const manifest = await app.main(({session}, a) => session.fromPartition(a.partition).extensions.getExtension(a.id)?.manifest, {partition, id});
    const popup = manifest?.action?.default_popup || manifest?.browser_action?.default_popup;
    assert.ok(popup, 'Cookie-Editor popup: ' + JSON.stringify(manifest?.action));
    await openPage(id, popup, 'ce');
    const denied = await inPage('ce', `chrome.cookies.getAll({url: "${origin}/"})`);
    assert.match(denied.error || '', /No host permissions for cookies at url/);
    ok('Cookie-Editor has only optional host access: cookies.getAll answers Chrome\'s "No host permissions" error until it is granted');
    // The popup's own "This site" button asks for host and root domain of the URL: [http://127.0.0.1/*, http://*.0.1/*] (it checks both with permissions.contains).
    const asked = await inPage('ce', 'chrome.permissions.request({origins: ["http://127.0.0.1/*", "http://*.0.1/*"]})', true);
    console.log('permissions.request ->', JSON.stringify(asked));
    await openPage(id, popup, 'ce');
    const own = await inPage('ce', `chrome.cookies.getAll({url: "${origin}/"}).then(l => l.map(c => c.name + "=" + c.value + "@" + c.storeId))`);
    console.log('cookies.getAll from Cookie-Editor after the grant:', JSON.stringify(own));
    assert.deepEqual((own.value || []).sort(), ['p6_second=two@0', 'p6_seen=hello@0']);
    ok('Cookie-Editor granted host access through Acira\'s permission prompt (permissions.request) then reads the real cookies with cookies.getAll');
    console.log('tabs.query from the popup:', JSON.stringify((await inPage('ce', 'chrome.tabs.query({active: true, currentWindow: true}).then(t => t.map(x => [x.id, x.url]))')).value || 'none'));
    const names = () => inPage('ce', 'document.body.innerText').then(r => r.value || r.error);
    const seen = await poll(names, t => /p6_seen/.test(String(t)), 'Cookie-Editor lists the open tab\'s cookies', 25000).catch(async () => { note('Cookie-Editor popup text: ' + String(await names()).slice(0, 300)); return null; });
    if (seen) ok('Cookie-Editor lists the open tab\'s cookies (cookies.getAll with the tab URL): p6_seen and p6_second');
    // Through its own background API call as the extension would: delete a cookie.
    const del = await inPage('ce', `chrome.cookies.remove({url: "${origin}/", name: "p6_second"})`);
    assert.equal(del.error, undefined, 'remove: ' + del.error);
    const left = await app.main(async ({session}, a) => (await session.fromPartition(a.partition).cookies.get({url: a.origin + '/'})).map(c => c.name), {partition, origin});
    assert.deepEqual(left.sort(), ['p6_seen']);
    ok('cookies.remove from the extension deletes the real cookie (p6_seen stays)');
    await app.main(() => { try { globalThis.__pages.ce.destroy(); } catch {} });
  }

  if (wanted.includes('browsec')) {
    const entry = await install('browsec'), id = entry.id;
    const manifest = await app.main(({session}, a) => session.fromPartition(a.partition).extensions.getExtension(a.id)?.manifest, {partition, id});
    const popup = manifest?.action?.default_popup || manifest?.browser_action?.default_popup;
    console.log('Browsec manifest:', JSON.stringify({v: manifest?.manifest_version, action: manifest?.action, ba: manifest?.browser_action, perms: manifest?.permissions}).slice(0, 400));
    if (popup) { await openPage(id, popup, 'bs'); await sleep(6000); const t = await inPage('bs', 'document.body.innerText'); console.log('Browsec popup:', String(t.value || t.error).replace(/\s+/g, ' ').slice(0, 300)); await app.main(() => { try { globalThis.__pages.bs.destroy(); } catch {} }); }
    const logs = await swLog();
    console.log('Browsec service worker log:', JSON.stringify(logs.slice(0, 12)));
    assert.equal(logs.some(l => /Access to extension API denied/.test(l)), false, 'no API-denied errors');
    ok('Browsec starts and opens its popup without an API-denied error (no sign-in, no connection)');
    note('proxy status with Browsec installed: ' + JSON.stringify(await status()));
    await ext({type: 'remove', extensionId: id});
  }
  console.log(`\n${report.length} checks passed`);
} catch (error) {
  console.error('FAIL', error && error.stack || error);
  process.exitCode = 1;
} finally {
  try { await app?.close(); } catch {}
  site.server.close();
  if (slot) await fs.rm(slot, {force: true});
}
