// Tor controls and page protections, proved in the real app (one instance, ≤12 tabs, a native slot, closed in finally).
//   node qa/r10-tor-ux.mjs [--only=circuit-new,level,circuit-view,downloads,letterbox,onion-location,onion-location-meta,onion-auth]
// Each section prints PASS/FAIL lines; the profile root is fixed (.qa-profiles/r10-tor-ux) so tor's relay cache stays warm between runs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {startApp, sleep, poll, httpFixture} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';
import {startAuthOnion, clientKeys, base32} from './r10-onion-fixture.mjs';
import {IP_URL, showOffscreen, capture, pixel, sameColour, torControl, findInFiles, press, overlayPage, openTorTab, torReady, scan, scanHits, commandLine, probeLevel} from './r10-tor-lib.mjs';

const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const wanted = name => !only.length || only.includes(name);
const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const ROOT = path.resolve('.qa-profiles/r10-tor-ux');

/** The Tor exit IP a page in this tab sees (check.torproject.org's API), after it (re)loads. */
async function exitIp(app, match, previous) {
  return poll(async () => { const page = app.web(match); if (!page) return null; const text = await page.evaluate(() => document.body?.innerText || '').catch(() => ''); try { const json = JSON.parse(text); return json.IsTor && json.IP !== previous ? json.IP : null; } catch { return null; } }, Boolean, 'exit IP', 240000);
}
/** An onion page can need more than one try (rendezvous with the service): wait for the tab to finish; if it ends in an error, reload it (up to three tries). */
async function onionLoaded(app, tabId, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    const tab = await poll(async () => { const t = (await app.state()).tabs.find(x => x.id === tabId); return t && /\.onion(?::\d+)?\//.test(t.url) && !t.loading ? t : null; }, Boolean, 'onion page finished', 150000);
    if (!tab.error || attempt >= tries) return {...tab, attempts: attempt};
    await app.cmd({type: 'reload', tabId});
  }
}

/** Item 6b: the same offer from the page's HTML, <meta http-equiv="onion-location"> (Tor Browser reads both). A Tor window never asks for 127.0.0.1 (the gate refuses local hosts),
 * so the test pages come from a protocol handler on the Tor session itself: fake https hosts, no network, no Tor traffic for them. The product code under test is untouched:
 * dom-ready / main-frame finish -> isolated-world read -> the same noteOnion path -> the same chip and "Prefer .onion versions". torproject.org's real onion is the target so the
 * preference run lands on a page that really loads. */
const META_TWIN = '2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid', META_DECOY = 'vww6ybal4bd7szmgncyruucpgfkqahzddi37ktceo3ah7ngmcopnpyyd';
const META_PAGES = {
  'onion-meta-only.acira-qa.example': {html: `<!doctype html><html><head><title>meta only</title><meta http-equiv="Onion-Location" content="http://${META_TWIN}.onion/"></head><body><p>meta only</p></body></html>`, headers: {}},
  'onion-header-only.acira-qa.example': {html: '<!doctype html><html><head><title>header only</title></head><body><p>header</p></body></html>', headers: {'Onion-Location': `http://${META_DECOY}.onion/`}},
  'onion-header-and-meta.acira-qa.example': {html: `<!doctype html><html><head><title>header and meta</title><meta http-equiv="onion-location" content="http://${META_TWIN}.onion/"></head><body><p>both</p></body></html>`, headers: {'Onion-Location': `http://${META_DECOY}.onion/`}},
  'onion-meta-bad.acira-qa.example': {html: `<!doctype html><html><head><title>bad meta</title><meta http-equiv="onion-location" content="http://example.com/"><meta http-equiv="onion-location" content="http://user:pw@${META_TWIN}.onion/"></head><body><p>bad</p></body></html>`, headers: {}},
  'no-onion.acira-qa.example': {html: '<!doctype html><html><head><title>no onion</title></head><body><p>nothing</p></body></html>', headers: {}},
};
async function onionMetaSection(app) {
  const url = host => `https://${host}/`, offered = id => app.state().then(s => s.tabs.find(t => t.id === id));
  // Every Tor tab has a session of its own (a private tab), so the handler is put on each Tor session as its contents are created, and on the ones that exist.
  await app.main((electron, pages) => {
    const done = new WeakSet(), TOR = Symbol.for('acira.tor.session');
    const serve = ses => {
      if (done.has(ses) || !ses[TOR]) return;
      done.add(ses);
      ses.protocol.handle('https', request => {
        const page = pages[new URL(request.url).hostname];
        return page ? new Response(page.html, {status: 200, headers: {'content-type': 'text/html; charset=utf-8', ...page.headers}}) : ses.fetch(request, {bypassCustomProtocolHandlers: true});
      });
    };
    globalThis.__onionMetaServe = {done, serve, listener: (_event, wc) => { serve(wc.session); wc.on('did-start-navigation', () => serve(wc.session)); }};
    electron.app.on('web-contents-created', globalThis.__onionMetaServe.listener);
    for (const wc of electron.webContents.getAllWebContents()) if (!wc.isDestroyed()) serve(wc.session);
  }, META_PAGES);
  try {
    // A page with only the meta tag gets the chip, with the same target the header would give.
    const only = await openTorTab(app, url('onion-meta-only.acira-qa.example'));
    const twin = `http://${META_TWIN}.onion/`;
    const got = await poll(async () => (await offered(only.id))?.onionLocation, Boolean, 'the offered onion address from the meta tag', 60000).catch(async error => { const t = await offered(only.id); console.log('meta-only tab', JSON.stringify({url: t?.url, title: t?.title, loading: t?.loading, error: t?.error, onionLocation: t?.onionLocation})); throw error; });
    check(got === twin, `a Tor tab on a page with only <meta http-equiv="onion-location"> has the offer (${got})`);
    const chip = app.ui.locator('.tor-onion-chip');
    await chip.waitFor({timeout: 10000});
    check(/\.onion available/.test(await chip.innerText()), 'the address bar shows the ".onion available" chip for the meta-only page');
    await capture(app, 'onion-meta-chip');
    // Control: does a header reach Acira's header hook when the page comes from a protocol handler? (Electron's webRequest may not see such responses.)
    const decoy = `http://${META_DECOY}.onion/`;
    const headerOnly = await openTorTab(app, url('onion-header-only.acira-qa.example'));
    await poll(async () => { const t = await offered(headerOnly.id); return t && !t.loading && t.title; }, Boolean, 'header-only page loaded', 60000);
    await sleep(1500);
    const headerSeen = (await offered(headerOnly.id)).onionLocation === decoy;
    console.log(`control: the header of a handler-served page ${headerSeen ? 'reaches' : 'does NOT reach'} Acira's header hook`);
    await app.act({type: 'tab.close', id: headerOnly.id}).catch(() => {});
    // A header and a meta tag naming different onions: the header wins, and stays the offer after the page has finished loading.
    const both = await openTorTab(app, url('onion-header-and-meta.acira-qa.example'));
    await poll(async () => { const t = await offered(both.id); return t && !t.loading && t.title; }, Boolean, 'header+meta page loaded', 60000);
    await sleep(2500);
    const headerWins = (await offered(both.id)).onionLocation;
    if (headerSeen) check(headerWins === decoy, `with both, the header's onion is the offer (${headerWins})`);
    else console.log(`note: header-wins is covered by tests/tor-onion.test.cjs (this rig cannot deliver a header through a protocol handler); the tab's offer here is ${headerWins}`);
    // Tags that fail the header rules (not an onion; credentials) give nothing; neither does a page with no tag.
    for (const host of ['onion-meta-bad.acira-qa.example', 'no-onion.acira-qa.example']) {
      const tab = await openTorTab(app, url(host));
      await poll(async () => { const t = await offered(tab.id); return t && !t.loading && t.title; }, Boolean, host + ' loaded', 60000);
      await sleep(2000);
      check(!(await offered(tab.id)).onionLocation, `${host}: no offer`);
      await app.act({type: 'tab.close', id: tab.id}).catch(() => {});
    }
    await app.act({type: 'tab.close', id: both.id}).catch(() => {});
    // "Prefer .onion versions": the meta-only page moves to the onion by itself, once.
    await app.ui.evaluate(() => window.acira.native({type: 'tor.onion-prefer-set', prefer: true}));
    const auto = await openTorTab(app, url('onion-meta-only.acira-qa.example'));
    await poll(async () => /\.onion\//.test((await offered(auto.id))?.url || ''), Boolean, 'the tab moved to the onion version by itself', 240000);
    const landed = await onionLoaded(app, auto.id);
    check(landed.url === twin && !landed.error, `with the preference on, the meta-only page opened its onion version by itself (${landed.url})`);
    const visits = (await offered(auto.id)).history.filter(h => h === twin).length;
    check(visits === 1, `the onion is in the tab's history once (${visits})`);
    await app.cmd({type: 'back', tabId: auto.id});
    await poll(async () => (await offered(auto.id))?.url, u => u === url('onion-meta-only.acira-qa.example'), 'back on the meta-only page', 60000);
    await sleep(6000);
    const stays = await offered(auto.id);
    check(stays.url === url('onion-meta-only.acira-qa.example') && stays.history.filter(h => h === twin).length === 1, 'Back stays on the regular address (one automatic open per offered address)');
    await app.ui.evaluate(() => window.acira.native({type: 'tor.onion-prefer-set', prefer: false}));
    // At Safest the page has no JavaScript; the tag is read by Acira (a script run by the browser in an isolated world), so the chip still comes.
    for (const tab of [only, auto]) await app.act({type: 'tab.close', id: tab.id}).catch(() => {});
    await app.ui.evaluate(() => window.acira.native({type: 'tor.level-set', level: 'safest'}));
    const safest = await openTorTab(app, url('onion-meta-only.acira-qa.example'));
    const scriptOff = await poll(() => app.main(electron => electron.webContents.getAllWebContents().filter(w => !w.isDestroyed() && w.getURL().startsWith('https://onion-meta-only.')).map(w => w.getLastWebPreferences().javascript)), list => list.length > 0, 'the Safest page', 30000);
    check(scriptOff.every(js => js === false), 'the Safest tab has page JavaScript off (webPreferences.javascript false)');
    const safestOffer = await poll(async () => (await offered(safest.id))?.onionLocation, Boolean, 'the meta offer at Safest', 60000).catch(() => '');
    check(safestOffer === twin, `at Safest the meta tag still gives the offer (${safestOffer || 'none'})`);
    await app.ui.evaluate(() => window.acira.native({type: 'tor.level-set', level: 'standard'}));
  } finally {
    await app.main(electron => { const h = globalThis.__onionMetaServe; if (!h) return; electron.app.off('web-contents-created', h.listener); for (const wc of electron.webContents.getAllWebContents()) { try { if (!wc.isDestroyed() && h.done.has(wc.session)) { wc.session.protocol.unhandle('https'); h.done.delete(wc.session); } } catch {} } delete globalThis.__onionMetaServe; }).catch(() => {});
  }
}

export const sections = {
  /** Item 6b alone (the meta tag), for quick runs: needs a Tor session, so one Tor tab is opened first. */
  async 'onion-location-meta'(app) {
    await showOffscreen(app);
    await app.ui.evaluate(() => window.acira.native({type: 'tor.onion-prefer-set', prefer: false}));
    await openTorTab(app, 'https://www.torproject.org/');
    await torReady(app);
    await onionMetaSection(app);
    for (const t of (await app.state()).tabs.filter(t => t.privacy === 'tor')) await app.act({type: 'tab.close', id: t.id}).catch(() => {});
  },
  /** Item 1: Ctrl+Shift+L in a Tor tab and the site panel's row each reload the page on a new circuit (a new exit); Seamless keeps the key elsewhere. */
  async 'circuit-new'(app) {
    const tab = await openTorTab(app, IP_URL);
    const first = await exitIp(app, IP_URL);
    console.log('exit before', first);
    const viewBefore = (await app.state()).windowUi.view || 'full';
    check(await press(app, IP_URL, 'L', ['control', 'shift']), 'Ctrl+Shift+L sent to the Tor page');
    const second = await exitIp(app, IP_URL, first);
    check(Boolean(second) && second !== first, `Ctrl+Shift+L in a Tor tab: the page reloaded on a new circuit (exit ${first} → ${second})`);
    check(((await app.state()).windowUi.view || 'full') === viewBefore, `Ctrl+Shift+L in a Tor tab did not switch to Seamless view (${viewBefore})`);
    const toast = await poll(() => app.ui.evaluate(() => [...document.querySelectorAll('*')].some(n => n.childElementCount === 0 && /New Tor circuit for torproject\.org/.test(n.textContent || ''))).catch(() => false), Boolean, 'toast', 8000).catch(() => false);
    const overlayToast = toast || await overlayPage(app).then(o => o.evaluate(() => /New Tor circuit for torproject\.org/.test(document.body.innerText))).catch(() => false);
    check(overlayToast, 'a toast says "New Tor circuit for torproject.org"');
    // The site panel (Page information) of the Tor tab: its row does the same.
    await app.ui.locator('.address-security').first().click();
    const overlay = await overlayPage(app);
    const row = overlay.locator('.tor-site-new');
    await row.waitFor({timeout: 8000});
    check((await row.innerText()).includes('New Tor circuit for this site'), 'the Tor site panel offers "New Tor circuit for this site"');
    await row.click();
    const third = await exitIp(app, IP_URL, second);
    check(Boolean(third) && third !== second, `the site panel row reloaded the page on a new circuit (exit ${second} → ${third})`);
    // In an ordinary tab the key is still Seamless view.
    await app.act({type: 'tab.new'}); await sleep(800);
    const ui = await app.main(({webContents}) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); wc.focus(); wc.sendInputEvent({type: 'keyDown', keyCode: 'L', modifiers: ['control', 'shift']}); wc.sendInputEvent({type: 'keyUp', keyCode: 'L', modifiers: ['control', 'shift']}); return true; });
    const seamless = await poll(async () => (await app.state()).windowUi.view, view => view !== viewBefore, 'seamless', 6000).catch(() => null);
    check(ui && seamless === 'seamless', `in an ordinary tab Ctrl+Shift+L is still Seamless view (${viewBefore} → ${seamless})`);
    await app.main(({webContents}) => { const wc = webContents.getAllWebContents().find(w => w.getURL() === 'acira-browser-ui://ui/index.html'); wc.sendInputEvent({type: 'keyDown', keyCode: 'L', modifiers: ['control', 'shift']}); wc.sendInputEvent({type: 'keyUp', keyCode: 'L', modifiers: ['control', 'shift']}); }); await sleep(600);
    await app.act({type: 'tab.close', id: tab.id});
    await app.act({type: 'settings.update', patch: {windowView: 'full'}});
  },
  /** Item 3: the site panel lists the relays of the circuit the current site rides (guard, middle, exit, with country), read from tor's control port;
   * the exit it names is the address the site sees; New Tor circuit changes both; another site has its own circuit. */
  async 'circuit-view'(app) {
    await showOffscreen(app);
    const tab = await openTorTab(app, IP_URL);
    await torReady(app);
    await exitIp(app, IP_URL);
    const lastOf = hops => hops[2].detail.split(' · ').pop();
    // Tor builds extra circuits for one site (conflux legs, spares), so the exits a site has seen in a page's life are several: the panel must name one of them.
    const seenExits = async () => {
      const page = app.web(IP_URL), ips = new Set();
      for (let i = 0; i < 2; i++) ips.add(await page.evaluate(() => fetch('https://check.torproject.org/api/ip?x=' + Math.random()).then(r => r.json()).then(j => j.IP)));
      const doc = JSON.parse(await page.evaluate(() => document.body.innerText)).IP; ips.add(doc); ips.doc = doc;
      return ips;
    };
    const hopsOf = async () => {
      await app.ui.locator('.address-security').first().click();
      const overlay = await overlayPage(app);
      await overlay.locator('.tor-hop[data-role]').first().waitFor({timeout: 30000});
      const hops = await overlay.evaluate(() => [...document.querySelectorAll('.tor-hop[data-role]')].map(li => ({role: li.dataset.role, place: li.querySelector('.tor-hop-place')?.textContent, detail: li.querySelector('.tor-hop-detail')?.textContent, label: li.querySelector('.tor-hop-role')?.textContent})));
      const ends = await overlay.evaluate(() => [...document.querySelectorAll('.tor-hop-end-name')].map(n => n.textContent));
      return {overlay, hops, ends};
    };
    const renew = round => round.overlay.locator('.tor-site-new:not([tabindex="-1"])').click();
    const seen = await seenExits();
    const first = await hopsOf();
    console.log(JSON.stringify({hops: first.hops, ends: first.ends, seen: [...seen]}));
    check(first.hops.map(h => h.role).join() === 'guard,middle,exit', 'the site panel lists a guard, a middle and an exit');
    check(first.hops.every(h => h.place && h.place !== 'Unknown location'), `every relay has a country name (${first.hops.map(h => h.place).join(', ')})`);
    check(first.ends.length === 2 && first.ends[0] === 'This browser' && first.ends[1] === 'check.torproject.org', `the circuit starts at this browser and ends at the site (${first.ends.join(' → ')})`);
    check(seen.has(lastOf(first.hops)), `the exit shown (${lastOf(first.hops)}) is an address this site saw (${[...seen].join(', ')})`);
    await capture(app, 'circuit-view-panel');
    // New Tor circuit: the panel follows the new circuit, three times over.
    let previous = lastOf(first.hops), round = first, before = seen;
    for (let i = 0; i < 3; i++) {
      await renew(round);
      await exitIp(app, IP_URL, before.doc);
      const now = await seenExits();
      round = await hopsOf();
      const shown = lastOf(round.hops);
      check(now.has(shown) && shown !== previous, `renewal ${i + 1}: the panel names the new exit (${previous} → ${shown}; site saw ${[...now].join(', ')})`);
      previous = shown; before = now;
    }
    await app.ui.keyboard.press('Escape');
    // A second site has a circuit of its own; the first site's circuit is untouched.
    const other = await openTorTab(app, 'https://example.com/');
    await poll(async () => (await app.state()).tabs.find(t => t.id === other.id && !t.loading), Boolean, 'second page loaded', 90000).catch(() => {});
    const third = await hopsOf();
    check(third.ends[1] === 'example.com' && third.hops.length === 3 && lastOf(third.hops) !== previous, `another site has its own circuit (exit ${previous} vs ${lastOf(third.hops)})`);
    await app.ui.keyboard.press('Escape');
    await app.act({type: 'tab.select', id: tab.id});
    const again = await hopsOf();
    check(lastOf(again.hops) === previous, 'switching back: the first site circuit is unchanged');
    await app.ui.keyboard.press('Escape');
    for (const t of (await app.state()).tabs.filter(t => t.privacy === 'tor')) await app.act({type: 'tab.close', id: t.id}).catch(() => {});
  },
  /** Item 5: a Tor page's window is rounded to a few sizes (Tor Browser's letterboxing), its screen is that window, its pixel ratio 1; an ordinary page is untouched;
   * the margin around the view is the toolbar's colour. */
  async letterbox(app) {
    await showOffscreen(app, {width: 1500, height: 950});
    const facts = page => page.evaluate(() => ({iw: innerWidth, ih: innerHeight, sw: screen.width, sh: screen.height, aw: screen.availWidth, ah: screen.availHeight, ow: outerWidth, oh: outerHeight, dpr: devicePixelRatio, depth: screen.colorDepth, sx: screenX, sy: screenY}));
    const fixture = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>ordinary</title><body>plain page'); });
    const ordinary = `http://127.0.0.1:${fixture.port}/`;
    try {
      await app.act({type: 'tab.new', url: ordinary});
      const plain = await app.waitWeb(ordinary, 'ordinary page'); await sleep(800);
      const normal = await facts(plain);
      console.log('ordinary', JSON.stringify(normal));
      check(normal.sw !== normal.iw || normal.sh !== normal.ih, `an ordinary page keeps the real screen (${normal.sw}×${normal.sh}) and window (${normal.iw}×${normal.ih}); pixel ratio ${normal.dpr}`);
      const tab = await openTorTab(app, IP_URL);
      await torReady(app);
      await exitIp(app, IP_URL);
      const stepsOk = f => f.iw % 200 === 0 && f.ih % 100 === 0;
      const uniform = f => f.sw === f.iw && f.sh === f.ih && f.aw === f.iw && f.ah === f.ih && f.ow === f.iw && f.oh === f.ih && f.dpr === 1 && f.depth === 24 && f.sx === 0 && f.sy === 0;
      const read = async () => { await sleep(900); return facts(app.web(IP_URL)); };
      const sizes = [];
      let f = await read(); sizes.push(f); console.log('tor 1500x950', JSON.stringify(f));
      check(stepsOk(f), `a Tor page's window is a multiple of 200 × 100 (${f.iw}×${f.ih}) in a 1500×950 window`);
      check(uniform(f), 'screen, available screen and outer window equal the window; pixel ratio 1; colour depth 24; position 0,0');
      await capture(app, 'letterbox-dark-1500');
      const margin = await pixel('letterbox-dark-1500', 300, 76), toolbar = await pixel('letterbox-dark-1500', 300, 70);
      check(sameColour(margin, toolbar, 1), `dark: no seam where the toolbar meets the margin (${toolbar} above, ${margin} below)`);
      // The margin is the toolbar's colour (same computed surface), the card is centred.
      const colours = await app.ui.evaluate(() => { const pane = document.querySelector('.page-pane[data-letterbox]'), bar = document.querySelector('.browser-toolbar.acira-persistent-toolbar, .browser-toolbar'); const c = el => el ? getComputedStyle(el).backgroundColor : null; return {pane: c(pane), bar: c(bar), hasAttribute: Boolean(pane)}; });
      check(colours.hasAttribute && colours.pane === colours.bar, `the margin is painted in the toolbar's surface (${colours.pane} / ${colours.bar})`);
      // Other window sizes, and the interface at 150%: still whole steps, still uniform.
      for (const [width, height] of [[1317, 861], [1111, 777], [1920, 1010]]) {
        await app.main(({BaseWindow}, size) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -3000, y: 20, ...size}); }, {width, height});
        f = await read(); sizes.push(f); console.log(`tor ${width}x${height}`, JSON.stringify(f));
        check(stepsOk(f) && uniform(f), `${width}×${height} window: the page sees ${f.iw}×${f.ih}, screen ${f.sw}×${f.sh}, pixel ratio ${f.dpr}`);
      }
      await app.act({type: 'settings.update', patch: {interfaceScale: 150}});
      f = await read(); console.log('tor at 150% interface', JSON.stringify(f));
      check(stepsOk(f) && uniform(f), `interface at 150%: still whole steps (${f.iw}×${f.ih}) and uniform`);
      await capture(app, 'letterbox-dark-150');
      await app.act({type: 'settings.update', patch: {interfaceScale: 100}});
      // Light appearance, for the margin colour.
      await app.act({type: 'settings.update', patch: {appearance: 'light'}}); await sleep(1200);
      await app.main(({BaseWindow}, size) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: -3000, y: 20, ...size}); }, {width: 1500, height: 950}); await sleep(900);
      await capture(app, 'letterbox-light-1500');
      const lightMargin = await pixel('letterbox-light-1500', 300, 76), lightToolbar = await pixel('letterbox-light-1500', 300, 70);
      check(sameColour(lightMargin, lightToolbar, 1), `light: no seam where the toolbar meets the margin (${lightToolbar} above, ${lightMargin} below)`);
      await app.act({type: 'settings.update', patch: {appearance: 'dark'}});
      // A Tor tab's neighbour, an ordinary tab in the same window, is not letterboxed.
      await app.act({type: 'tab.select', id: (await app.state()).tabs.find(t => t.url === ordinary).id}); await sleep(900);
      const again = await facts(plain);
      check(again.iw === normal.iw && again.ih === normal.ih, `an ordinary tab in the same window is untouched (${again.iw}×${again.ih})`);
      check(!(await app.ui.evaluate(() => Boolean(document.querySelector('.page-pane[data-letterbox]')))), 'an ordinary page has no letterbox margin');
      for (const t of (await app.state()).tabs.filter(t => t.privacy === 'tor' || t.url === ordinary)) await app.act({type: 'tab.close', id: t.id}).catch(() => {});
    } finally { await fixture.close(); }
  },
  /** Item 6: a Tor tab on an https site that names its onion twin (Onion-Location) gets the chip; the chip opens the .onion version; "Prefer .onion versions"
   * (the Tor panel's switch, saved) opens it by itself, once. torproject.org sends the header. */
  async 'onion-location'(app) {
    await showOffscreen(app);
    await app.ui.evaluate(() => window.acira.native({type: 'tor.onion-prefer-set', prefer: false}));
    const SITE = 'https://www.torproject.org/', ONION = /^http:\/\/[a-z2-7]{56}\.onion\//;
    const tab = await openTorTab(app, SITE);
    await torReady(app);
    const offered = await poll(async () => (await app.state()).tabs.find(t => t.id === tab.id)?.onionLocation, Boolean, 'the offered onion address', 120000);
    console.log('offered', offered);
    check(ONION.test(offered), `the site's Onion-Location is on the tab (${offered})`);
    const chip = app.ui.locator('.tor-onion-chip');
    await chip.waitFor({timeout: 10000});
    check(/\.onion available/.test(await chip.innerText()), 'the address bar shows the ".onion available" chip');
    await capture(app, 'onion-chip');
    await chip.click();
    const landed = await onionLoaded(app, tab.id);
    check(landed.url === offered && !landed.error, `the chip opened the onion version in the same tab (${landed.url}), without an error`);
    check(await app.ui.locator('.tor-onion-chip').count() === 0, 'an onion page offers no onion chip');
    // The Tor panel's switch.
    await app.ui.locator('.tor-chip').first().click();
    const overlay = await overlayPage(app);
    const toggle = overlay.locator('[role=switch][aria-labelledby=tor-onion-prefer]').first();
    await toggle.waitFor({timeout: 8000});
    check(/Prefer \.onion versions/.test(await overlay.locator('#tor-onion-prefer').first().innerText()) && (await toggle.getAttribute('aria-checked')) === 'false', 'the Tor panel has "Prefer .onion versions", off');
    await toggle.click();
    await poll(async () => JSON.parse(await fs.readFile(path.join(app.root, 'tor', 'settings.json'), 'utf8')).preferOnion === true, Boolean, 'saved', 8000);
    check(true, 'switching it on is saved (tor/settings.json preferOnion true)');
    await capture(app, 'onion-prefer-panel');
    await app.ui.keyboard.press('Escape');
    // With it on, a regular address that offers an onion twin ends up on the twin by itself, once.
    const second = await openTorTab(app, SITE);
    await poll(async () => { const t = (await app.state()).tabs.find(x => x.id === second.id); return t && /\.onion\//.test(t.url); }, Boolean, 'the tab moved to the onion version by itself', 240000);
    const auto = await onionLoaded(app, second.id);
    check(ONION.test(auto.url) && !auto.error, `with the preference on, torproject.org opened its onion version by itself (${auto.url})`);
    // Back goes to the regular address and stays there (one automatic open per offered address).
    await app.cmd({type: 'back', tabId: second.id});
    await poll(async () => (await app.state()).tabs.find(x => x.id === second.id)?.url, url => /^https:\/\/www\.torproject\.org\//.test(url), 'back on the regular address', 60000);
    await sleep(6000);
    check(/^https:\/\/www\.torproject\.org\//.test((await app.state()).tabs.find(x => x.id === second.id).url), 'Back stays on the regular address (it is not undone by the preference)');
    await app.ui.evaluate(() => window.acira.native({type: 'tor.onion-prefer-set', prefer: false}));
    await onionMetaSection(app);
    for (const t of (await app.state()).tabs.filter(t => t.privacy === 'tor')) await app.act({type: 'tab.close', id: t.id}).catch(() => {});
  },
  /** Item 7: a real key-protected onion service (a second tor hosts it, qa/r10-onion-fixture.mjs): without a key the tab asks for one (tor's 0xF4), a wrong key says so (0xF5),
   * the right key opens the page; tor holds the key, the disk never does. */
  async 'onion-auth'(app) {
    await showOffscreen(app);
    const fixture = await startAuthOnion({root: path.resolve('.qa-profiles/r10-onion-fixture')});
    console.log('fixture onion', fixture.address);
    try {
      const url = `http://${fixture.address}/`, wrongKey = base32(clientKeys().secret);
      const tab = await openTorTab(app, url);
      await torReady(app);
      const card = app.ui.locator('.tor-onion-auth'), input = card.locator('input[type=password]');
      await card.waitFor({timeout: 240000});
      check(/This onion site needs a key/.test(await card.innerText()), 'a Tor tab that cannot open a key-protected onion site asks for the key');
      check((await app.state()).tabs.find(t => t.id === tab.id).onionAuth === 'missing', 'the tab says "missing" (tor reported 0xF4)');
      await capture(app, 'onion-auth-missing');
      await input.fill('this is not a key'); await card.getByRole('button', {name: 'Add key'}).click();
      await card.locator('.tor-auth-problem').waitFor({timeout: 8000});
      check(/doesn.t look like an onion service key/.test(await card.locator('.tor-auth-problem').innerText()), 'something that is not a key is refused before it reaches tor');
      await input.fill(wrongKey); await card.getByRole('button', {name: 'Add key'}).click();
      await poll(async () => /That key didn.t work/.test(await app.ui.locator('.tor-onion-auth').innerText().catch(() => '')), Boolean, 'the wrong-key page', 240000);
      check((await app.state()).tabs.find(t => t.id === tab.id).onionAuth === 'wrong', 'a key the service does not know: the tab says "wrong" (tor reported 0xF5)');
      await capture(app, 'onion-auth-wrong');
      await app.ui.locator('.tor-onion-auth input[type=password]').fill(fixture.secretBase32);
      await app.ui.locator('.tor-onion-auth').getByRole('button', {name: 'Add key'}).click();
      await poll(async () => { const t = (await app.state()).tabs.find(x => x.id === tab.id); return t && !t.onionAuth && !t.loading; }, Boolean, 'the key page gave way to the page', 240000);
      const opened = await onionLoaded(app, tab.id);
      console.log('onion page after the key:', JSON.stringify({error: opened.error, tries: opened.attempts}));
      const page = await poll(() => app.web(url), Boolean, 'the onion page', 120000);
      const text = await poll(async () => page.evaluate(() => document.body?.innerText || ''), value => /acira-onion-auth-ok/.test(value), 'page text', 120000);
      check(/acira-onion-auth-ok/.test(text) && fixture.hits() > 0, `with the right key the onion page opens (the service answered ${fixture.hits()} request${fixture.hits() === 1 ? '' : 's'})`);
      check(await app.ui.locator('.tor-onion-auth').count() === 0, 'the key page is gone');
      const view = await torControl(app.root, ['ONION_CLIENT_AUTH_VIEW']);
      check(view.includes(fixture.id), 'tor holds the key for this service (ONION_CLIENT_AUTH_VIEW lists it)');
      const found = await findInFiles(app.root, [fixture.secretBase32, fixture.secretBase64, wrongKey]);
      check(found.length === 0, `no key is on disk anywhere in the profile (${found.length ? found.join(', ') : 'scanned every file under 6 MB'})`);
    } finally {
      await fixture.close();
      for (const t of (await app.state()).tabs.filter(t => t.privacy === 'tor')) await app.act({type: 'tab.close', id: t.id}).catch(() => {});
    }
  },
  /** Item 4: a download started in a Tor tab goes through Tor (the file says so), is marked as a Tor download, shows Tor Browser's warning in the panel and the
   * Downloads page, and opening it asks first. The file is a few bytes of JSON and is never opened. */
  async downloads(app) {
    await showOffscreen(app);
    const tab = await openTorTab(app, IP_URL);
    await torReady(app);
    await exitIp(app, IP_URL);
    const streams = () => app.main(() => globalThis.__aciraTorIsolation?.streams().filter(s => s.host === 'check.torproject.org').length ?? -1);
    const before = await streams();
    await app.main(({webContents}, url) => { const wc = webContents.getAllWebContents().find(w => !w.isDestroyed() && w.getURL().startsWith(url)); wc.downloadURL(url + '?download=1'); }, IP_URL);
    const record = await poll(async () => (await app.state()).downloads.find(d => d.status === 'Ready'), Boolean, 'download finished', 120000);
    const body = await fs.readFile(record.path, 'utf8');
    console.log('downloaded', JSON.stringify({name: record.name, tor: record.tor, body: body.slice(0, 80)}));
    check(JSON.parse(body).IsTor === true, 'the downloaded file says the server saw a Tor exit (check.torproject.org: IsTor true), so the download went through Tor');
    check((await streams()) > before, `the download rode a Tor stream through the isolation relay (${before} → ${await streams()} streams to the site)`);
    check(record.tor === true && record.private === true, 'the record is marked as a Tor download and as private (never saved)');
    check(record.canRetry === false, 'a Tor download is never retried through another session');
    // Downloads page: the warning above the list.
    await app.act({type: 'tab.new', url: 'acira://downloads'});
    await poll(() => app.ui.evaluate(() => Boolean(document.querySelector('.lib-row.dl'))), Boolean, 'downloads page', 15000);
    const notice = app.ui.locator('.tor-dl-notice');
    await notice.waitFor({timeout: 8000});
    check(/Be careful opening downloads/.test(await notice.innerText()) && /outside Tor/.test(await notice.innerText()), 'the Downloads page shows the Tor download warning');
    await capture(app, 'downloads-page-warning');
    // The toolbar panel.
    await app.act({type: 'ui.open', panel: 'downloads'});
    const panel = await overlayPage(app);
    await panel.locator('.tor-dl-notice').first().waitFor({timeout: 8000}).catch(() => {});
    check(await panel.locator('.tor-dl-notice').count() >= 1, 'the downloads panel shows the warning too');
    await sleep(500); await capture(app, 'downloads-panel-warning');
    await app.ui.keyboard.press('Escape');
    // Opening asks first: Cancel opens nothing.
    const opening = app.ui.evaluate(id => window.acira.service({type: 'downloads.command', id, command: 'open'}).then(() => 'ran', error => String(error)), record.id).catch(error => String(error));
    const dialogPage = await poll(() => app.context.pages().find(p => { try { return /native-dialog/.test(p.url()); } catch { return false; } }), Boolean, 'the question', 15000);
    const text = await dialogPage.evaluate(() => document.body.innerText);
    check(/Be careful opening downloads/.test(text) && /outside Tor/.test(text),`opening the file asks first (${JSON.stringify(text.replace(/\s+/g, ' ').slice(0, 90))})`);
    await sleep(700); await capture(app, 'downloads-open-question');
    await dialogPage.getByRole('button', {name: 'Cancel'}).click();
    const result = await opening;
    check(result === 'ran', `Cancel closes the question and the file stays closed (${result})`);
    // "Got it" hides the warning and saves it.
    await notice.locator('button', {hasText: 'Got it'}).click();
    await poll(() => notice.count().then(n => n === 0), Boolean, 'warning hidden', 5000);
    check(JSON.parse(await fs.readFile(path.join(app.root, 'tor', 'settings.json'), 'utf8')).downloadWarning === false, 'Got it is saved (tor/settings.json downloadWarning false)');
    await app.ui.evaluate(() => window.acira.native({type: 'tor.download-warning-dismiss'}));
    // Put the warning back for the next run (the profile is fixed).
    const file = path.join(app.root, 'tor', 'settings.json'); const saved = JSON.parse(await fs.readFile(file, 'utf8')); delete saved.downloadWarning; await fs.writeFile(file, JSON.stringify(saved));
    for (const t of (await app.state()).tabs.filter(t => t.privacy === 'tor' || t.url.startsWith('acira://downloads'))) await app.act({type: 'tab.close', id: t.id}).catch(() => {});
  },
  /** Item 2: the Tor panel's Security level control and Settings' one choose Safer / Safest; open Tor tabs offer a reopen; the new pages really run
   * without JIT + WebAssembly + WebGL + MathML (Safer) and without JavaScript (Safest). */
  async level(app) {
    await showOffscreen(app);
    const pageOf = async () => poll(() => app.web(IP_URL), Boolean, 'Tor page', 60000);
    const settle = async () => { const page = await pageOf(); await page.waitForLoadState('domcontentloaded').catch(() => {}); return page; };
    const rendererOf = () => app.main(({webContents}, url) => { const wc = webContents.getAllWebContents().find(w => !w.isDestroyed() && w.getURL().startsWith(url)); return wc ? {pid: wc.getOSProcessId(), js: wc.getLastWebPreferences().javascript !== false} : null; }, IP_URL);
    const jitless = async () => { const r = await rendererOf(); return Boolean(r) && /--jitless/.test(commandLine(r.pid)); };
    await app.ui.evaluate(() => window.acira.native({type: 'tor.level-set', level: 'standard'}));
    const tab = await openTorTab(app, IP_URL);
    await torReady(app);
    let page = await settle();
    const standard = await probeLevel(page);
    console.log('standard', JSON.stringify(standard));
    check(standard.wasm === 'object' && standard.inlineScript && standard.mathml === 'function', `Standard: WebAssembly ${standard.wasm}, MathML ${standard.mathml}, inline scripts run`);
    // The Tor panel (the chip in the address field): Security level is a disclosure on the panel's rows.
    await app.ui.locator('.tor-chip').first().click();
    const overlay = await overlayPage(app);
    const row = overlay.locator('.tor-level-row > summary').first();
    await row.waitFor({timeout: 8000});
    check(/Security level/.test(await row.innerText()) && /Standard/.test(await row.innerText()), `the Tor panel has a Security level row showing Standard (${JSON.stringify((await row.innerText()).replace(/\s+/g, ' '))})`);
    await row.click();
    await overlay.locator('.tor-level [role=radio]').first().waitFor({timeout: 5000});
    check((await overlay.locator('.tor-level [role=radio]').allInnerTexts()).slice(0, 3).join('|') === 'Standard|Safer|Safest', 'the control offers Standard, Safer and Safest');
    await capture(app, 'level-panel-standard');
    await overlay.locator('.tor-level [role=radio]', {hasText: 'Safer'}).first().click();
    await overlay.locator('.tor-level-apply').first().waitFor({timeout: 8000});
    check(/Reopen Tor tabs to apply it\?/.test(await overlay.locator('.tor-level-apply').first().innerText()), 'choosing Safer offers to reopen the open Tor tabs');
    check(/JIT compiler/.test(await overlay.locator('.tor-level').first().innerText()), 'Safer lists what it turns off (JIT, WebAssembly, WebGL, autoplay)');
    await capture(app, 'level-panel-safer-apply');
    const still = await probeLevel(await pageOf());
    check(still.wasm === 'object', 'the open Tor tab keeps its previous level until it reopens (WebAssembly still there)');
    const savedFile = path.join(app.root, 'tor', 'settings.json');
    check(JSON.parse(await fs.readFile(savedFile, 'utf8')).level === 'safer', 'the choice is saved (tor/settings.json: safer)');
    await overlay.locator('.tor-level-apply button', {hasText: 'Reopen Tor tabs'}).first().click();
    await poll(async () => (await app.state()).tabs.every(t => t.id !== tab.id) && await jitless(), Boolean, 'reopened at Safer', 40000);
    page = await settle();
    const safer = await probeLevel(page), saferRenderer = await rendererOf();
    console.log('safer', JSON.stringify(safer));
    check(safer.wasm === 'undefined', 'Safer: WebAssembly is gone (typeof WebAssembly = undefined)');
    console.log('note: MathML stays at Safer (Chromium 152 has no runtime switch for it): typeof MathMLElement =', safer.mathml);
    check(safer.webgl === false, 'Safer: WebGL is off');
    check(safer.inlineScript === true, 'Safer: JavaScript still runs on an HTTPS page');
    check(safer.loopMs > standard.loopMs * 4, `Safer: no JIT, the same hot loop takes ${safer.loopMs} ms instead of ${standard.loopMs} ms`);
    const cmd = commandLine(saferRenderer.pid);
    check(/--jitless/.test(cmd) && /--no-expose-wasm/.test(cmd), 'Safer: the page\'s renderer process really runs with --jitless --no-expose-wasm');
    // Settings: the same control, Connection › Tor security level. Safest.
    await app.act({type: 'tab.new', url: 'acira://settings'});
    await poll(() => app.ui.evaluate(() => Boolean(document.querySelector('.bs-sidebar nav>button'))), Boolean, 'settings', 15000);
    await app.ui.evaluate(() => { const nav = [...document.querySelectorAll('.bs-sidebar nav>button')]; nav.find(b => /Connection/i.test(b.getAttribute('aria-label') || b.textContent || ''))?.click(); });
    const setting = app.ui.locator('[data-setting=tor-level]');
    await setting.waitFor({timeout: 10000});
    await setting.scrollIntoViewIfNeeded();
    check(/Tor security level|Security level/.test(await setting.innerText()), 'Settings › Connection has the Tor security level row');
    await setting.locator('[role=radio]', {hasText: 'Safest'}).click();
    await setting.locator('.tor-level-apply').waitFor({timeout: 8000});
    await capture(app, 'level-settings-safest-apply');
    await setting.locator('.tor-level-apply button', {hasText: 'Reopen Tor tabs'}).click();
    await poll(async () => { const r = await rendererOf(); return r && r.js === false; }, Boolean, 'reopened at Safest', 40000);
    page = await settle();
    const safest = await probeLevel(page);
    console.log('safest', JSON.stringify(safest));
    check(safest.inlineScript === false, 'Safest: JavaScript is off (an inline script added to the page does not run)');
    check(safest.wasm === 'undefined' && safest.webgl === false, 'Safest: still without WebAssembly and WebGL');
    check(JSON.parse(await fs.readFile(savedFile, 'utf8')).level === 'safest', 'Settings saved Safest (tor/settings.json)');
    // Back to Standard (the fixed profile keeps the choice between runs).
    await setting.locator('[role=radio]', {hasText: 'Standard'}).click();
    await poll(async () => JSON.parse(await fs.readFile(savedFile, 'utf8')).level === 'standard', Boolean, 'standard saved', 8000);
    await app.ui.evaluate(() => window.acira.native({type: 'tor.level-apply'}));
    await poll(async () => { const r = await rendererOf(); return r && r.js === true && !(await jitless()); }, Boolean, 'reopened at Standard', 40000);
    const back = await probeLevel(await settle());
    check(back.wasm === 'object' && back.inlineScript, 'back to Standard: WebAssembly and scripts are back');
    for (const t of (await app.state()).tabs.filter(t => t.privacy === 'tor' || t.url.startsWith('acira://settings'))) await app.act({type: 'tab.close', id: t.id}).catch(() => {});
  },
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('qa/r10-tor-ux.mjs')) {
  await withSlot('r10-tor-ux', async () => {
    // Tor's preferences start from their defaults each run (the download warning shows, onion preference off, Standard level); the relay cache beside them stays warm.
    await fs.rm(path.join(ROOT, 'tor', 'settings.json'), {force: true});
    const app = await startApp({root: ROOT, env: {ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(ROOT, 'downloads'), ACIRA_TEST_APP_DIALOG: '1'}});
    try {
      for (const [name, run] of Object.entries(sections)) if (wanted(name)) { console.log(`--- ${name}`); try { await run(app); } catch (error) { check(false, `${name}: ${error.message}`); } }
    } finally { await app.close(); }
  });
  const failed = results.filter(([ok]) => !ok).length;
  console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
  process.exit(failed ? 1 : 0);
}
