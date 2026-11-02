// R3-44 row "Cookie-banner hiding". Real app, isolated profile, one instance.   node qa/r3-proof/cookie-banners.mjs   (needs internet for part B)
// A. Fixture (a local page named like a real site, with reviewed consent-manager markup): hidden by default, the page under it stays clickable,
//    the per-site switch brings it back for this site and hides it again.
// B. Real consent sites: for each one the setting is off (control) and on; a banner is any visible fixed/sticky box or consent frame that asks for
//    cookie consent. The control must show one for the site to count; with the setting on it must be gone and the page usable.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {startApp, poll} from '../d-harness.mjs';
import {probe, withSlot, sleep, captureOverlay, capturePage, showProtectionButton} from './lib.mjs';

const P = probe('cookie-banners');
const root = path.resolve('.qa-profiles/r3-proof-cookie-banners');
fs.rmSync(root, {recursive: true, force: true}); fs.mkdirSync(root, {recursive: true});
const SITES = (process.env.PROOF_SITES ? process.env.PROOF_SITES.split(',') : ['www.theguardian.com', 'www.spiegel.de', 'www.lemonde.fr', 'www.bbc.com', 'www.tripadvisor.com', 'www.imdb.com']).map(host => ({host, url: `https://${host}/`}));
const NEED_SHOWN = 2, BUDGET_MS = 4.5 * 60 * 1000;

const DETECT = `(() => {
  const consentText = /cookie|consent|gdpr|accept all|reject all|manage (preferences|options)|we use|your privacy|privacy (choices|settings|preferences)|agree and continue|partners/i, ask = /accept|agree|allow|reject|decline|manage|settings|got it|ok|continue|save/i;
  const banners = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    if (!['fixed', 'sticky', 'absolute'].includes(cs.position)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 240 || r.height < 36 || r.bottom < 0 || r.top > innerHeight) continue;
    const t = (el.innerText || '').trim(); if (t.length < 25 || t.length > 2500) continue;
    if (consentText.test(t) && ask.test(t)) banners.push((el.id || el.className || el.tagName).toString().slice(0, 40) + ' ' + (r.width | 0) + 'x' + (r.height | 0));
  }
  const frames = [...document.querySelectorAll('iframe')].filter(f => { const r = f.getBoundingClientRect(), cs = getComputedStyle(f); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 240 && r.height > 80 && /consent|cmp|sp_message|privacy|onetrust|didomi|cookie|sourcepoint|usercentrics|trustarc/i.test((f.id || '') + (f.src || '') + (f.title || '')); }).map(f => (f.id || f.src).slice(0, 50));
  const locked = [document.documentElement, document.body].some(e => e && getComputedStyle(e).overflowY === 'hidden' && e.scrollHeight > innerHeight * 1.2);
  return {banners: banners.slice(0, 5), bannerCount: banners.length, frames, scrollLocked: locked, textLength: (document.body && document.body.innerText || '').length, links: document.querySelectorAll('a[href]').length};
})()`;

const FIXTURE = `<!doctype html><title>Consent fixture</title><style>body{margin:0;font:16px system-ui;min-height:2200px}.notice{position:fixed;left:0;bottom:0;width:100%;height:96px;background:#eee;border-top:1px solid #999;z-index:9999}button{height:40px;margin:8px}</style>
<h1>Ordinary shop</h1><label>Shipping name <input id=shipping></label><button id=checkout onclick="window.clicked=(window.clicked||0)+1">Continue to checkout</button>
<div id="onetrust-banner-sdk" class="notice">We use cookies and similar technologies. Your privacy choices matter. <button id=accept onclick="window.accepted=(window.accepted||0)+1">Accept all</button><button>Manage preferences</button></div>
<div class="cky-consent-container cky-banner-bottom notice" style="bottom:100px" id="cky">We value your privacy. <button>Accept all</button><button>Reject all</button></div>`;

const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.setHeader('cache-control', 'no-store'); res.end(FIXTURE); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

await withSlot('proof-cookie-banners', async () => {
  const app = await startApp({root, args: ['--host-resolver-rules=MAP shop.ordinary-example.test 127.0.0.1']});
  try {
    const started = Date.now();
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setFocusable(false); win.setSkipTaskbar(true); win.setBounds({x: -20000, y: -20000, width: 1440, height: 900}); win.showInactive(); });
    await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true, appearance: 'light'}});
    await showProtectionButton(app);
    const state = () => app.state();
    const active = async () => { const s = await state(); return s.tabs.find(t => t.id === s.activeTabId); };
    const overlay = () => app.context.pages().filter(page => page.url().includes('view=overlay')).at(-1);
    const closePopup = async () => { const layout = await app.ui.evaluate(() => window.acira.getBrowserLayout()); if (layout?.overlay) await app.ui.evaluate(id => window.acira.closeOverlay(id), layout.overlay.id); await sleep(300); };
    const openPopup = async () => { await app.ui.locator('[data-protection-trigger]').filter({visible: true}).first().click(); await poll(async () => (await app.ui.evaluate(() => window.acira.getBrowserLayout()))?.overlay?.kind, v => v === 'protection', 'protection popup', 10000); await poll(overlay, Boolean, 'overlay page', 10000); await overlay().locator('.popup-content-protection').filter({visible: true}).last().waitFor({timeout: 10000}); await sleep(1500); };

    // ---------------- A. fixture
    const url = `http://shop.ordinary-example.test:${PORT}/`;
    await app.act({type: 'tab.new', url});
    let tab = await poll(active, t => t?.url?.startsWith('http://shop.ordinary-example.test') && !t.loading, 'fixture loaded', 20000);
    const page = await app.waitWeb(u => u.startsWith('http://shop.ordinary-example.test'), 'fixture page');
    const probeFixture = () => page.evaluate(() => { const vis = id => { const e = document.getElementById(id); if (!e) return false; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; }; const b = document.getElementById('checkout').getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return {onetrust: vis('onetrust-banner-sdk'), cookieyes: vis('cky'), checkoutReachable: hit === document.getElementById('checkout')}; });
    await sleep(1200);
    const defaultState = (await app.svc({type: 'filters.status', tabId: tab.id})).filters;
    const hidden = await probeFixture();
    await capturePage(app, 'shop.ordinary-example.test', P.shot('fixture-banners-hidden.png'));
    P.check('fixture: cookie-banner hiding is on by default', defaultState.annoyances === true, JSON.stringify({annoyances: defaultState.annoyances}));
    P.check('fixture: both consent banners are hidden, the page under them is clickable', !hidden.onetrust && !hidden.cookieyes && hidden.checkoutReachable, JSON.stringify(hidden), P.shot('fixture-banners-hidden.png'));
    // The per-site switch (service call the site panel uses) brings them back for this site; the popup shows the protection state.
    await openPopup(); await captureOverlay(app, P.shot('popup-protection.png')); await closePopup();
    await app.svc({type: 'filters.set', tabId: tab.id, scope: 'site', patch: {annoyances: false}});
    await app.cmd({type: 'reload', tabId: tab.id}); await sleep(2500);
    const shown = await probeFixture();
    await capturePage(app, 'shop.ordinary-example.test', P.shot('fixture-banners-shown-control.png'));
    P.check('fixture: with the site switch off the banners are back (control)', shown.onetrust && shown.cookieyes, JSON.stringify(shown), P.shot('fixture-banners-shown-control.png'));
    await app.svc({type: 'filters.set', tabId: tab.id, scope: 'site', patch: {annoyances: true}});
    await app.cmd({type: 'reload', tabId: tab.id}); await sleep(2500);
    const hiddenAgain = await probeFixture();
    P.check('fixture: switched back on, they are hidden again', !hiddenAgain.onetrust && !hiddenAgain.cookieyes && hiddenAgain.checkoutReachable, JSON.stringify(hiddenAgain));
    await app.act({type: 'tab.close', id: tab.id});

    // ---------------- B. real consent sites
    const rows = []; let shownCount = 0;
    const measure = async (site, label) => {
      await app.act({type: 'tab.new', url: site.url});
      const id = (await active()).id;
      await poll(async () => (await state()).tabs.find(t => t.id === id)?.loading, v => v === false, 'load ' + site.host, 40000).catch(() => {});
      await sleep(7000);
      const key = site.host.replace(/^(www|edition)\./, '').split('.')[0];
      const web = app.web(u => { try { return new URL(u).hostname.includes(key); } catch { return false; } });
      let result = {error: 'no page'};
      if (web) { try { result = await Promise.race([web.evaluate(DETECT), sleep(15000).then(() => ({error: 'timeout'}))]); } catch (error) { result = {error: String(error.message).slice(0, 80)}; } }
      const png = web ? await capturePage(app, key, P.shot(`${key}-${label}.png`)) : null;
      await app.act({type: 'tab.close', id}).catch(() => {});
      return {...result, png};
    };
    for (const site of SITES) {
      if (shownCount >= NEED_SHOWN || Date.now() - started > BUDGET_MS) break;
      await app.svc({type: 'filters.profile-set', patch: {annoyances: false}});
      const off = await measure(site, 'off');
      const hadBanner = !off.error && (off.bannerCount > 0 || off.frames.length > 0);
      if (!hadBanner) { rows.push({site: site.host, off, skipped: off.error || 'no consent banner shown here (region or earlier visit)'}); P.note(`${site.host}: no banner in the control run here, not counted`); continue; }
      await app.svc({type: 'filters.profile-set', patch: {annoyances: true}});
      const on = await measure(site, 'on');
      shownCount++;
      const clear = !on.error && on.bannerCount === 0 && on.frames.length === 0 && !on.scrollLocked && on.links > 20;
      rows.push({site: site.host, off, on, clear});
      P.check(`${site.host}: banner shown in the control, hidden with the setting on, page still usable`, clear, `control ${off.bannerCount} banner(s)/${off.frames.length} frame(s) [${off.banners.join('; ').slice(0, 80)}]; on ${on.error || `${on.bannerCount} banner(s)/${on.frames.length} frame(s), scrollLocked=${on.scrollLocked}, links=${on.links}`}`, on.png || off.png);
    }
    fs.writeFileSync(P.shot('real-sites.json'), JSON.stringify(rows, null, 2));
    // Whether a real site shows a banner depends on region and history: sites that showed none to this rig are noted, not counted. Every site that did show one must be clear with the setting on (checked above).
    P.note(shownCount ? `real sites measured: ${rows.filter(r => r.on).map(r => r.site + (r.clear ? ' clear' : ' STILL SHOWN')).join(', ')}` : 'no real consent banner was shown to this rig in this region (fixture checks above carry the row); tried: ' + rows.map(r => r.site).join(', '));
    await app.svc({type: 'filters.profile-set', patch: {annoyances: true}});
  } finally {
    await app.close();
  }
});
server.close();
P.finish();
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
