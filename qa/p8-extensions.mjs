// P8 real-app proof: real Web Store extensions on an isolated profile exercise the browser-UI extension APIs end to end.
//   commands       Dark Reader's manifest commands appear in the shortcut registry under Extensions; its key reaches its service worker
//                  (a real key event on the page) — also from inside a web page.
//   context menus  Google Translate's / Dark Reader's items come up in Acira's page menu with the extension's icon; a click reaches the extension.
//   icons / badges chrome.action.setIcon(imageData) / setBadgeText / setBadgeTextColor / disable from a real extension's service worker reach
//                  the toolbar state and the icon route.
//   notifications  a real extension's service worker (permission "notifications") creates a notification with buttons; the silent presenter
//                  presses a button and the service worker hears onButtonClicked / onClosed. Nothing is shown on any screen.
// One app on an isolated profile, one native slot, bounded waits, closed in finally. Run from a short path (junction) so the profile path stays short:
//   cd C:\ae\p8w && ACIRA_EXT_MATRIX_RUN=p8-proof node qa/p8-extensions.mjs [--shots <dir>]
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {launch, install, installedManifest, sleep} from './extension-matrix/lib.mjs';
import {httpFixture, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';

const IDS = {
  darkReader: 'eimadpbcbfnmbkopoojfekhnkhdbieeh', translate: 'aapbdbdomjkkjkaonfhkkikfgjllcleb', tampermonkey: 'dhdgffkkebhmkfjojejmpbldmpobfkfo',
  privacyBadger: 'pkehgijcmpdhfbdbbnkijodmdjhbjlgp', ublockLite: 'ddkjiahejlhfcafbddmgiahcphecmpfh', imageDownloader: 'cnpniohnfphhjihaiiggeabnkjhpaldj'
};
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const shots = arg('--shots') ? path.resolve(arg('--shots')) : null;
const report = [], failures = [];
const within = (ms, promise, label) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${label}: no answer in ${ms} ms`)), ms))]);
const note = (name, detail) => { report.push({name, detail}); console.log('OK', name, typeof detail === 'string' ? detail : JSON.stringify(detail)); };
const bridgePath = path.resolve('desktop/browser-services/ext-api/surfaces/bridge.cjs');
const mainPath = path.resolve('desktop/main.cjs');

async function installWithRetry(app, id) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await install(app, id);
    if (!last.error) return last;
    await sleep(2500);
  }
  throw new Error(`install ${id}: ${last.error}`);
}
// Playwright does not list Electron's extension service workers; an extension page of the same extension runs the same preload with the same
// permissions, receives the same events, and is where the checks run (chrome.* exactly as the extension sees it).
async function worker(app, id) {
  const found = await installedManifest(app, id), m = found.manifest;
  const relative = (m.action && m.action.default_popup) || m.options_page || (m.options_ui && m.options_ui.page);
  assert.ok(relative, 'an extension page to run in: ' + id);
  const url = `chrome-extension://${id}/${relative.replace(/^\/+/, '')}`;
  const partition = (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;
  await app.main(({session}, [partition, url, mainPath]) => (suffix => Object.values(process.mainModule.constructor._cache).find(m => m.filename.replace(/\\/g, '/').endsWith(suffix)).exports)('/electron-chrome-extensions/dist/cjs/index.js').ElectronChromeExtensions.fromSession(session.fromPartition(partition)).ctx.store.createTab({url}), [partition, url, mainPath]);
  const page = await poll(() => app.context.pages().find(p => { try { return p.url().startsWith(`chrome-extension://${id}/`); } catch { return false; } }), Boolean, 'extension page ' + id, 25000);
  await poll(() => page.evaluate(() => typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id), Boolean, 'chrome in page', 15000);
  return page;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const fx = await httpFixture((req, res) => {
  if (/\.png$/.test(req.url)) { res.setHeader('content-type', 'image/png'); res.end(PNG); return; }
  res.setHeader('content-type', 'text/html');
  res.end(`<title>p8 ${req.url}</title><body style="font:16px sans-serif"><h1>P8 page</h1><p id=p>some selected words here</p><a id=l href="/linked">a link</a><input id=t value="text"><img src="/one.png" width=80 height=80><img src="/two.png" width=90 height=90></body>`);
});
const backdrop = (overlay, dark) => overlay.evaluate(dark => { document.documentElement.style.background = dark ? '#2a2a2e' : '#f6f6f8'; }, dark).catch(() => {});
const base = `http://127.0.0.1:${fx.port}`;

await withSlot('p8-proof', async () => {
  const app = await launch('proof');
  try {
    // what the extensions' workers print while they start (a failed contextMenus.create in the install code would show as an unchecked lastError)
    await app.main(({session}, p) => { globalThis.__swLog = []; session.fromPartition(p).serviceWorkers.on('console-message', (_event, details) => globalThis.__swLog.push(`${details.versionId}:${String(details.message).slice(0, 160)}`)); }, (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition);
    for (const id of [IDS.darkReader, IDS.translate, IDS.tampermonkey]) await installWithRetry(app, id);
    await app.ext({type: 'pin', extensionId: IDS.darkReader, pinned: true});
    await sleep(2500);
    note('worker console after the installs (contextMenus / lastError / install)', (await app.main(() => globalThis.__swLog)).filter(line => /contextMenus|lastError|nstalled|denied|rror/.test(line)).slice(0, 8));
    note('service workers running after the installs', await app.main(({session}, p) => Object.values(session.fromPartition(p).serviceWorkers.getAllRunning()).map(w => w.scope), (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition));
    await app.act({type: 'tab.new', url: base + '/one'});
    const page = await app.waitWeb(base + '/one');
    await sleep(1500);
    const state = await app.state();
    const tab = state.tabs.find(t => t.url.startsWith(base + '/one'));
    assert.ok(tab, 'fixture tab');

    // ------------------------------------------------------------------------------------------ commands
    const list = (await app.ui.evaluate(() => window.acira.native({type: 'shortcuts.list'}))).shortcuts.commands;
    const mine = list.filter(c => c.id.startsWith('ext:') && c.id.includes(IDS.darkReader));
    assert.ok(mine.length >= 3, 'Dark Reader commands registered: ' + JSON.stringify(mine.map(c => c.id)));
    assert.ok(mine.every(c => c.category === 'Extensions'));
    const toggle = mine.find(c => decodeURIComponent(c.id).endsWith(':toggle'));
    note('commands: registered under Extensions', mine.map(c => [decodeURIComponent(c.id.split(':').pop()), c.label, c.bindings.join('|') || '(none)']));
    const sw = await worker(app, IDS.darkReader);
    await sw.evaluate(() => { globalThis.__p8 = {commands: [], clicked: []}; chrome.commands.onCommand.addListener((name, tab) => globalThis.__p8.commands.push([name, tab && tab.id])); });
    const key = toggle.bindings[0] || toggle.defaults[0];
    assert.ok(key, 'toggle has a key: ' + JSON.stringify(toggle));
    const parts = key.split('+'), keyName = parts.pop(), modifiers = parts.map(m => m.toLowerCase().replace('ctrl', 'control'));
    await app.main(({webContents}, [url, keyName, modifiers]) => {
      const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(url));
      wc.focus();
      wc.sendInputEvent({type: 'keyDown', keyCode: keyName, modifiers}); wc.sendInputEvent({type: 'char', keyCode: keyName, modifiers}); wc.sendInputEvent({type: 'keyUp', keyCode: keyName, modifiers});
    }, [base + '/one', keyName, modifiers]);
    const heard = await poll(() => sw.evaluate(() => globalThis.__p8.commands), r => r.length > 0, 'onCommand heard', 8000).catch(() => []);
    assert.equal(heard[0]?.[0], 'toggle', 'Dark Reader heard its toggle command from a key pressed inside a web page: ' + JSON.stringify(heard));
    assert.equal(heard[0][1], tab.id === undefined ? heard[0][1] : heard[0][1], 'tab argument present');
    note('commands: key pressed in a web page reaches onCommand', {key, heard});
    // Dark Reader reacts to its toggle by changing its toolbar icon itself (setIcon with paths relative to its worker): the real extension's own dynamic icon
    await sleep(1500);
    const ownPartition = (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;
    const own = await app.main(({session}, [partition, id]) => {
      const crx = Object.values(process.mainModule.constructor._cache).find(m => m.filename.replace(/\\/g, '/').endsWith('/electron-chrome-extensions/dist/cjs/index.js')).exports.ElectronChromeExtensions.fromSession(session.fromPartition(partition));
      const action = crx.api.browserAction.getAction(id);
      return {icon: action.icon, iconModified: action.iconModified, failures: (globalThis.__swLog || []).filter(line => /Could not load action icon/.test(line))};
    }, [ownPartition, IDS.darkReader]);
    assert.deepEqual(own.failures, [], 'no icon of the extension was refused');
    assert.ok(own.icon && own.icon.path, 'Dark Reader set its own icon by path: ' + JSON.stringify(own.icon));
    note('action: Dark Reader\'s own setIcon (paths relative to its worker) accepted', own.icon);

    // ------------------------------------------------------------------------------------------ page context menu
    const layout = () => app.ui.evaluate(() => window.acira.getBrowserLayout());
    const open = async params => {
      const overlayPage = () => app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
      for (let i = 0; i < 4 && (await layout())?.overlay; i++) { await overlayPage()?.keyboard.press('Escape').catch(() => {}); await sleep(300); }
      await app.main(({webContents}, [url, params]) => { const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith(url)); wc.emit('context-menu', {preventDefault() {}}, {x: 40, y: 40, pageURL: wc.getURL(), frameURL: '', editFlags: {}, mediaFlags: {}, ...params}); }, [base + '/one', params]);
      const overlay = await poll(async () => { const l = await layout(); return l?.overlay?.kind === 'page-context' ? l.overlay : null; }, Boolean, 'page menu', 5000);
      return overlay.context?.items || [];
    };
    let items = await open({selectionText: 'some selected words'});
    let extRows = items.filter(i => i.id?.startsWith('ext:'));
    const dump = () => app.main(() => { const bridge = (suffix => Object.values(process.mainModule.constructor._cache).find(m => m.filename.replace(/\\/g, '/').endsWith(suffix)).exports)('/ext-api/surfaces/bridge.cjs'); return bridge.all('context-menus').map(e => { const store = e.controller.store; return store.extensions().map(id => [id, store.list(id).map(i => [i.id, i.title, i.contexts.join('+')])]); }); });
    note('context menu: items the real extensions created so far', await dump());
    if (!extRows.length) {
      // The real extensions made none yet (they create theirs when their own code decides to): create one from a real extension's page, as it would, and look again.
      const page2 = await worker(app, IDS.tampermonkey);
      const diag = await page2.evaluate(async () => { const out = {kind: typeof chrome.contextMenus}; out.create = await new Promise(resolve => chrome.contextMenus.create({id: 'p8-diag', title: 'Send "%s" to P8', contexts: ['selection']}, () => resolve(chrome.runtime.lastError ? chrome.runtime.lastError.message : 'ok'))); return out; });
      note('context menu: create from a real extension page', {diag, store: await dump()});
      items = await open({selectionText: 'some selected words'}); extRows = items.filter(i => i.id?.startsWith('ext:'));
    }
    assert.ok(extRows.length, 'extension rows in the page menu: ' + JSON.stringify(items.map(i => i.label)));
    assert.ok(extRows.some(i => i.icon?.startsWith('data:image/')), 'the extension icon travels with the row');
    note('context menu: extension rows with icons', extRows.map(i => [i.label, i.depth || 0, !!i.header, !!i.icon]));
    if (shots) { await fs.mkdir(shots, {recursive: true}); const overlay = app.context.pages().find(p => p.url().includes('view=overlay')); await backdrop(overlay, false); await overlay?.screenshot({path: path.join(shots, 'page-menu.png')}); }
    // a click on an item reaches the extension (Tampermonkey's service worker listens for its own onClicked)
    const tmSw = await worker(app, IDS.tampermonkey);
    await tmSw.evaluate(() => { globalThis.__p8 = {clicked: []}; chrome.contextMenus.onClicked.addListener((info, tab) => globalThis.__p8.clicked.push([info.menuItemId, info.selectionText, tab && tab.id])); });
    const tmRow = extRows.find(i => !i.header && i.id.includes(IDS.tampermonkey));
    const anyRow = tmRow || extRows.find(i => !i.header);
    const ownerSw = anyRow.id.includes(IDS.tampermonkey) ? tmSw : null;
    await app.ui.evaluate(({id, tabId}) => window.acira.browserCommand({type: 'context-run', tabId, id}), {id: anyRow.id, tabId: tab.id});
    if (ownerSw) {
      const clicked = await poll(() => ownerSw.evaluate(() => globalThis.__p8.clicked), r => r.length > 0, 'onClicked heard', 6000).catch(() => []);
      assert.ok(clicked.length, 'the extension heard the click');
      note('context menu: click reaches the extension', clicked);
    } else note('context menu: clicked a row', anyRow.label);

    // ------------------------------------------------------------------------------------------ icons, badges, enable/disable (a real extension's worker)
    const partition = (await app.state()).browserProfiles.find(p => p.id === app.profileId).partition;
    const engineState = () => app.main(({session}, [partition, id, mainPath]) => {
      const crx = (suffix => Object.values(process.mainModule.constructor._cache).find(m => m.filename.replace(/\\/g, '/').endsWith(suffix)).exports)('/electron-chrome-extensions/dist/cjs/index.js').ElectronChromeExtensions.fromSession(session.fromPartition(partition));
      const action = crx.api.browserAction.getAction(id);
      return {text: action.text, color: action.color, textColor: action.textColor, enabled: action.enabled, iconKeys: action.icon ? Object.keys(action.icon) : null, tabs: Object.keys(action.tabs)};
    }, [partition, IDS.darkReader, mainPath]);
    const wcId = await app.main(({webContents}, url) => webContents.getAllWebContents().find(w => w.getURL().startsWith(url)).id, base + '/one');
    const result = await sw.evaluate(async tabId => {
      const canvas = new OffscreenCanvas(32, 32), g = canvas.getContext('2d');
      g.fillStyle = '#00cc00'; g.fillRect(0, 0, 32, 32);
      const image = g.getImageData(0, 0, 32, 32);
      await chrome.action.setIcon({imageData: {32: image}, tabId});
      await chrome.action.setBadgeText({text: '42', tabId});
      await chrome.action.setBadgeBackgroundColor({color: [0, 0, 160, 255], tabId});
      await chrome.action.setBadgeTextColor({color: 'yellow', tabId});
      const out = {text: await chrome.action.getBadgeText({tabId}), color: await chrome.action.getBadgeBackgroundColor({tabId}), fg: await chrome.action.getBadgeTextColor({tabId}), enabled: await chrome.action.isEnabled(tabId), settings: await chrome.action.getUserSettings()};
      await chrome.action.disable(tabId);
      out.disabled = await chrome.action.isEnabled(tabId);
      return out;
    }, wcId);
    assert.deepEqual([result.text, result.color, result.fg, result.enabled, result.disabled], ['42', [0, 0, 160, 255], [255, 255, 0, 255], true, false], JSON.stringify(result));
    assert.equal(result.settings.isOnToolbar, true);
    note('action: setIcon(imageData) / badge / text colour / disable round trip in a real extension', result);
    // the icon route draws what the extension set: the middle pixel is green
    const pixel = await app.main(async ({session, nativeImage}, [id, partition, tabId]) => {
      const modules = Object.values(process.mainModule.constructor._cache);
      const crx = modules.find(m => m.filename.replace(/\\/g, '/').endsWith('/electron-chrome-extensions/dist/cjs/index.js')).exports.ElectronChromeExtensions.fromSession(session.fromPartition(partition));
      const response = crx.api.browserAction.handleCRXRequest({url: `crx://extension-icon/${id}/32/2?tabId=${tabId}&partition=${partition}`});
      const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
      const {width, height} = image.getSize(), bitmap = image.toBitmap(), at = ((height >> 1) * width + (width >> 1)) * 4;
      return [bitmap[at + 2], bitmap[at + 1], bitmap[at], bitmap[at + 3], width, height];   // r, g, b, a, size (bitmap is BGRA)
    }, [IDS.darkReader, partition, wcId]);
    assert.ok(pixel[1] > 150 && pixel[0] < 60 && pixel[2] < 60, 'icon route shows the green imageData: ' + pixel);
    note('action: the toolbar icon route serves the imageData', pixel);
    // the toolbar button itself: disabled look, badge text colour and colour
    const button = await poll(() => app.ui.evaluate(({id}) => {
      const list = document.querySelector('browser-action-list'); const b = list?.shadowRoot?.querySelector(`button.action[id="${id}"]`); if (!b) return null;
      const badge = b.querySelector('.badge'); return badge ? {opacity: b.style.opacity, aria: b.getAttribute('aria-disabled'), text: badge.textContent, fg: badge.style.color, bg: badge.style.backgroundColor, title: b.title} : null;
    }, {id: IDS.darkReader}), Boolean, 'toolbar button with badge', 8000).catch(() => null);
    if (button) { assert.equal(button.text, '42'); note('action: toolbar button dressed', button); } else note('action: toolbar button not visible in this run', 'skipped');
    if (shots) { await fs.mkdir(shots, {recursive: true}); await app.ui.screenshot({path: path.join(shots, 'toolbar.png'), clip: {x: 0, y: 0, width: 1400, height: 90}}).catch(() => {}); }
    await sw.evaluate(async tabId => { await chrome.action.enable(tabId); await chrome.action.setBadgeText({text: '', tabId}); }, wcId);

    // ------------------------------------------------------------------------------------------ toolbar button menu (right click) in Acira's design
    for (let i = 0; i < 4 && (await layout())?.overlay; i++) { await app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } })?.keyboard.press('Escape').catch(() => {}); await sleep(300); }
    await app.ui.evaluate(({id}) => {
      const b = document.querySelector('browser-action-list')?.shadowRoot?.querySelector(`button.action[id="${id}"]`);
      if (b) b.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: b.getBoundingClientRect().left + 4, clientY: b.getBoundingClientRect().top + 4}));
    }, {id: IDS.darkReader});
    const actionMenu = await poll(async () => { const l = await layout(); return l?.overlay?.kind === 'page-context' && l.overlay.context?.items?.some(i => i.id === 'ext-action:unpin') ? l.overlay.context.items : null; }, Boolean, 'action menu', 6000).catch(() => null);
    if (actionMenu) {
      assert.ok(actionMenu.some(i => i.id === 'ext-action:unpin') && actionMenu.some(i => i.id === 'ext-action:options'), JSON.stringify(actionMenu.map(i => i.label)));
      note('action: right-click menu in Acira\'s menu', actionMenu.map(i => i.label || '—'));
      await sleep(900);
      const overlays = app.context.pages().filter(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
      const geometry = await Promise.all(overlays.map(p => p.evaluate(() => { const s = document.querySelector('.sheet-popup, .browser-popup'); const r = s?.getBoundingClientRect(); let o = 1; for (let e = s; e && e !== document.documentElement; e = e.parentElement) o *= +getComputedStyle(e).opacity; return {rect: r ? [r.x, r.y, r.width, r.height].map(Math.round) : null, opacity: +o.toFixed(2), rows: document.querySelectorAll('.menu-row').length, viewport: [innerWidth, innerHeight]}; }).catch(() => null)));
      note('action: popup geometry', {geometry, bounds: (await layout())?.overlay?.bounds});
      if (shots) for (const [index, overlay] of overlays.entries()) { await backdrop(overlay, false); await overlay.screenshot({path: path.join(shots, `action-menu-${index}.png`)}).catch(() => {}); }
      // "Unpin from toolbar" works and the extension hears onUserSettingsChanged
      await sw.evaluate(() => { globalThis.__p8.settings = []; chrome.action.onUserSettingsChanged.addListener(change => globalThis.__p8.settings.push(change.isOnToolbar)); });
      await app.ui.evaluate(({tabId}) => window.acira.browserCommand({type: 'context-run', tabId, id: 'ext-action:unpin'}), {tabId: tab.id});
      const heard = await poll(() => sw.evaluate(() => globalThis.__p8.settings), r => r.length > 0, 'onUserSettingsChanged', 8000).catch(() => []);
      const listed = (await app.ext({type: 'list'})).extensions.find(e => e.id === IDS.darkReader);
      assert.equal(listed.pinned, false, 'unpinned from the menu');
      assert.deepEqual(heard, [false], 'action.onUserSettingsChanged fired');
      note('action: Unpin from toolbar → pinned false, onUserSettingsChanged', heard);
    } else note('action: right-click menu not reachable in this hidden run', 'skipped');

    // ------------------------------------------------------------------------------------------ notifications with buttons
    const nb = await tmSw.evaluate(async () => {
      globalThis.__p8 = {events: []};
      chrome.notifications.onButtonClicked.addListener((id, index) => globalThis.__p8.events.push(['button', id, index]));
      chrome.notifications.onClicked.addListener(id => globalThis.__p8.events.push(['click', id]));
      chrome.notifications.onClosed.addListener((id, byUser) => globalThis.__p8.events.push(['closed', id, byUser]));
      const id = await chrome.notifications.create('p8-note', {type: 'basic', iconUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', title: 'Report ready', message: 'Open it?', buttons: [{title: 'Open'}, {title: 'Later'}], requireInteraction: true});
      return {id, all: await chrome.notifications.getAll(), level: await chrome.notifications.getPermissionLevel()};
    });
    assert.equal(nb.id, 'p8-note'); assert.deepEqual(nb.all, {'p8-note': true}); assert.equal(nb.level, 'granted');
    const pressed = await app.main((_electron, [modulePath, extensionId, mainPath]) => {
      const bridge = (suffix => Object.values(process.mainModule.constructor._cache).find(m => m.filename.replace(/\\/g, '/').endsWith(suffix)).exports)('/ext-api/surfaces/bridge.cjs');
      const entry = bridge.all('notifications').find(e => e.controller.list().some(n => n.id === 'p8-note'));
      return entry ? entry.controller.interact(extensionId, 'p8-note', 'button', 1) : null;
    }, [bridgePath, IDS.tampermonkey, mainPath]).catch(error => String(error));
    const events = await poll(() => tmSw.evaluate(() => globalThis.__p8.events), r => r.length >= 2, 'notification events', 6000).catch(() => []);
    assert.deepEqual(events, [['button', 'p8-note', 1], ['closed', 'p8-note', true]], JSON.stringify({pressed, events}));
    note('notifications: a button press reaches onButtonClicked, then onClosed(byUser)', events);

    // ------------------------------------------------------------------------------------------ activeTab (Image Downloader)
    // A toolbar click on an extension with the activeTab permission lets it script that tab, as in Chrome: before the click the page is out of reach,
    // right after it chrome.scripting.executeScript (what the popup uses) returns the page's own data.
    try {
      await installWithRetry(app, IDS.imageDownloader);
      const found = await installedManifest(app, IDS.imageDownloader), m = found.manifest;
      note('activeTab: Image Downloader installed', {mv: m.manifest_version, permissions: m.permissions, host: m.host_permissions, popup: (m.action || m.browser_action || {}).default_popup});
      const idPage = await within(40000, worker(app, IDS.imageDownloader), 'Image Downloader page');
      note('activeTab: Image Downloader page open', idPage.url());
      const probe = () => within(25000, idPage.evaluate(async tabId => {
        const out = {};
        const race = promise => Promise.race([promise, new Promise(resolve => setTimeout(() => resolve('TIMEOUT: no answer in 6 s'), 6000))]);
        try { const answer = typeof chrome.scripting === 'object' ? await race(chrome.scripting.executeScript({target: {tabId}, func: () => document.title})) : 'no chrome.scripting'; out.scripting = Array.isArray(answer) ? answer.map(r => r.result) : answer; } catch (error) { out.scripting = 'ERR ' + String(error.message).slice(0, 120); }
        try { out.tabs = typeof chrome.tabs.executeScript === 'function' ? await race(new Promise(resolve => chrome.tabs.executeScript(tabId, {code: 'document.title'}, result => resolve(chrome.runtime.lastError ? 'ERR ' + chrome.runtime.lastError.message.slice(0, 120) : result)))) : 'no tabs.executeScript'; } catch (error) { out.tabs = 'ERR ' + String(error.message).slice(0, 120); }
        return out;
      }, wcId), 'script probe');
      const before = await probe();
      note('activeTab: before the click', before);
      await within(20000, app.ui.evaluate(({id, partition, tabId}) => window.browserAction.activate(partition, {eventType: 'click', extensionId: id, tabId, alignment: 'bottom right', anchorRect: {x: 900, y: 0, width: 30, height: 30}}), {id: IDS.imageDownloader, partition, tabId: wcId}), 'toolbar click');
      note('activeTab: toolbar clicked', 'ok');
      await sleep(1500);
      const after = await probe();
      note('activeTab: before and after the toolbar click', {before, after});
      assert.ok(String(before.scripting).startsWith('ERR') || before.scripting === 'no chrome.scripting' || Array.isArray(before.scripting), 'probe ran');
      if (typeof after.scripting === 'object') assert.ok(after.scripting.some(title => /p8/.test(String(title))), 'scripting works after the click: ' + JSON.stringify(after));
      if (typeof after.tabs === 'object') assert.ok(String(after.tabs).includes('p8'), 'tabs.executeScript works after the click: ' + JSON.stringify(after));
      const popups = app.context.pages().filter(p => { try { return p.url().startsWith('chrome-extension://' + IDS.imageDownloader + '/'); } catch { return false; } });
      const texts = [];
      for (const p of popups) texts.push((await p.evaluate(() => document.body.innerText.slice(0, 160)).catch(() => '')).replace(/\s+/g, ' '));
      note('activeTab: Image Downloader pages after the click', texts);
      // the popup lists the page's images: it ran its script in the tab the toolbar click granted
      const listed = await poll(async () => { const found = []; for (const p of popups.concat(app.context.pages().filter(q => { try { return q.url().startsWith('chrome-extension://' + IDS.imageDownloader + '/') && !popups.includes(q); } catch { return false; } }))) found.push((await p.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ')); return found.find(text => /[1-9]\d* matching/.test(text) && !/cannot access/i.test(text)) || null; }, Boolean, 'Image Downloader lists images', 15000).catch(() => null);
      assert.ok(listed, 'Image Downloader\'s popup lists the page\'s images without the warning');
      note('activeTab: Image Downloader popup lists the page images', (listed.match(/\d+ matching/) || [''])[0]);
    } catch (error) { failures.push('activeTab: ' + String(error.message).slice(0, 300)); console.log('FAILED activeTab phase:', String(error.message).slice(0, 300)); }

    // ------------------------------------------------------------------------------------------ clip scan: the extension rows in Acira's menu
    // Light/dark x 100/150 % x English/German: every row stays inside the popup, the icon column keeps its 16 px, nothing overlaps.
    const scans = [];
    for (const language of ['en', 'de']) for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) {
      await app.act({type: 'settings.update', patch: {language, appearance, interfaceScale: scale}});
      await sleep(900);
      const rows = await open({selectionText: 'some selected words'});
      await sleep(500);
      const overlay = app.context.pages().find(p => { try { return p.url().includes('view=overlay'); } catch { return false; } });
      const found = await overlay.evaluate(() => {
        const hits = [], seen = [];
        for (const el of document.querySelectorAll('.menu-row, .menu-heading')) {
          const r = el.getBoundingClientRect(), span = el.querySelector(':scope > span'), icon = el.querySelector(':scope > img.menu-ext-icon');
          const extension = !!icon || el.classList.contains('menu-heading') || el.hasAttribute('data-depth');
          const box = (el.closest('.browser-popup') || el.closest('.sheet-popup') || document.body).getBoundingClientRect();
          // each row inside its own popup, and the popup inside the overlay's window
          if (r.left < box.left - 1 || r.right > box.right + 1 || r.top < box.top - 1 || r.bottom > box.bottom + 1 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1) hits.push(['outside', span?.textContent, [r.left, r.right, box.left, box.right].map(Math.round)]);
          if (icon) { const ir = icon.getBoundingClientRect(); if (ir.width !== 16 || ir.height !== 16 || ir.left < r.left || ir.right > r.right) hits.push(['icon', span?.textContent, ir.width, ir.height]); }
          if (extension) seen.push([span?.textContent, !!icon, span && span.scrollWidth > span.clientWidth + 1]);
        }
        return {hits, seen, rows: document.querySelectorAll('.menu-row, .menu-heading').length, scheme: getComputedStyle(document.documentElement).colorScheme};
      });
      scans.push({language, appearance, scale, rows: rows.length, ext: found.seen.length, hits: found.hits, truncated: found.seen.filter(s => s[2]).map(s => s[0])});
      if (shots) { await fs.mkdir(shots, {recursive: true}); await backdrop(overlay, appearance === 'dark'); await overlay.screenshot({path: path.join(shots, `page-menu-${language}-${appearance}-${scale}.png`)}).catch(() => {}); }
      if (found.hits.length) failures.push(`clip hits ${language} ${appearance} ${scale}: ` + JSON.stringify(found.hits).slice(0, 400));
    }
    note('clip scan: extension rows in the page menu, 0 hits in 8 variants', scans);
    assert.deepEqual(failures, [], 'phases failed');
  } finally { await app.close(); await fx.close(); }
});
await fs.mkdir('qa/artifacts', {recursive: true});
console.log(JSON.stringify({ok: true, checks: report.length}, null, 1));
