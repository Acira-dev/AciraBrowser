// R3-44 row 'Google "Choose Chrome" promo hidden'. Real app, isolated profile, one instance.   node qa/r3-proof/chrome-promo.mjs   (needs internet for part A)
// A. Real google.com (/ncr, no country redirect): the page sees a Chrome identity, and no promo sheet or "Switch to Chrome" banner is on screen. If Google
//    serves the promo sheet into the page anyway it must be hidden (reported either way).
// B. A page named www.google.com (served here) carrying Google's promo markup: hidden with the setting on, shown with it off (control), hidden again on.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {startApp, poll} from '../d-harness.mjs';
import {probe, withSlot, sleep, capturePage} from './lib.mjs';

const P = probe('chrome-promo');
const root = path.resolve('.qa-profiles/r3-proof-chrome-promo');
fs.rmSync(root, {recursive: true, force: true}); fs.mkdirSync(root, {recursive: true});
const FIXTURE = `<!doctype html><title>Google-shaped page</title><style>body{margin:0;font:16px Arial;background:#fff}g-bottom-sheet{display:block;position:fixed;left:0;right:0;bottom:0;height:220px;background:#fff;box-shadow:0 -2px 12px #0006;z-index:999;padding:24px}</style>
<div style="padding:40px"><h1>Google</h1><input style="width:400px;height:36px"></div>
<g-bottom-sheet aria-labelledby="promo_label_id" aria-describedby="promo_desc_id"><h2 id="promo_label_id">Choose Chrome</h2><p id="promo_desc_id">Get Google Chrome for faster, safer browsing.</p><button>Switch to Chrome</button><button>No thanks</button></g-bottom-sheet>`;
const server = http.createServer((req, res) => { res.setHeader('content-type', 'text/html'); res.end(FIXTURE); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const PORT = server.address().port;

const PROMO = `(async () => {
  const text = document.body ? document.body.innerText : '';
  const sheets = [...document.querySelectorAll('g-bottom-sheet[aria-labelledby="promo_label_id"],g-bottom-sheet[aria-describedby="promo_desc_id"]')];
  const vis = el => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0; };
  const d = navigator.userAgentData, brands = d ? d.brands.map(b => b.brand) : [];
  const promoText = (text.match(/.{0,40}(choose chrome|switch to chrome|get chrome|use chrome|google chrome for)[^\\n]{0,40}/i) || [null])[0];
  return {url: location.href, ua: navigator.userAgent, brands, sheets: sheets.length, sheetsVisible: sheets.filter(vis).length, promoText, promoTextVisibleInBody: !!promoText, robot: /unusual traffic|not a robot|captcha/i.test(text) || /\\/sorry\\//.test(location.href), title: document.title, textLength: text.length};
})()`;

await withSlot('proof-chrome-promo', async () => {
  const app = await startApp({root, args: ['--host-resolver-rules=MAP www.google.com 127.0.0.1']});
  try {
    const active = async () => { const s = await app.state(); return s.tabs.find(t => t.id === s.activeTabId); };
    // ---------------- B first (no network): the filter itself
    await app.act({type: 'settings.update', patch: {language: 'en', onboardingComplete: true}});
    const fx = `http://www.google.com:${PORT}/`;
    await app.svc({type: 'filters.profile-set', patch: {annoyances: true}});
    await app.act({type: 'tab.new', url: fx});
    let tab = await poll(active, t => t?.url?.startsWith('http://www.google.com:') && !t.loading, 'fixture loaded', 20000);
    let page = await app.waitWeb(u => u.startsWith('http://www.google.com:'), 'fixture page'); await sleep(1500);
    const on = await page.evaluate(PROMO);
    await capturePage(app, 'www.google.com:', P.shot('fixture-promo-hidden.png'));
    P.check('fixture: the promo sheet is in the page but not on screen with the setting on', on.sheets === 1 && on.sheetsVisible === 0, JSON.stringify({sheets: on.sheets, visible: on.sheetsVisible}), P.shot('fixture-promo-hidden.png'));
    await app.svc({type: 'filters.profile-set', patch: {annoyances: false}});
    await app.cmd({type: 'reload', tabId: tab.id}); await sleep(2500);
    page = await app.waitWeb(u => u.startsWith('http://www.google.com:'), 'fixture page');
    const off = await page.evaluate(PROMO);
    await capturePage(app, 'www.google.com:', P.shot('fixture-promo-shown-control.png'));
    P.check('fixture: with the setting off the same sheet is on screen (control)', off.sheets === 1 && off.sheetsVisible === 1, JSON.stringify({sheets: off.sheets, visible: off.sheetsVisible}), P.shot('fixture-promo-shown-control.png'));
    await app.svc({type: 'filters.profile-set', patch: {annoyances: true}});
    await app.cmd({type: 'reload', tabId: tab.id}); await sleep(2500);
    page = await app.waitWeb(u => u.startsWith('http://www.google.com:'), 'fixture page');
    const again = await page.evaluate(PROMO);
    P.check('fixture: switched back on, hidden again', again.sheetsVisible === 0, JSON.stringify({visible: again.sheetsVisible}));
    await app.act({type: 'tab.close', id: tab.id});

  } finally {
    await app.close();
  }
  // ---------------- A: real Google, in a second app without the host map (the first one sends www.google.com to this PC for the fixture)
  const real = await startApp({root: path.resolve('.qa-profiles/r3-proof-chrome-promo-real')});
  try {
    await real.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setFocusable(false); win.setSkipTaskbar(true); win.setBounds({x: -20000, y: -20000, width: 1440, height: 900}); win.showInactive(); });
    const active = async () => { const s = await real.state(); return s.tabs.find(t => t.id === s.activeTabId); };
    const results = [];
    for (const [label, url] of [['home', 'https://www.google.com/ncr'], ['search', 'https://www.google.com/search?q=how+do+solar+panels+work&hl=en&gl=us']]) {
      await real.act({type: 'tab.new', url});
      const tab = await poll(active, t => t?.url?.includes('google.') && !t.loading, 'google ' + label, 40000).catch(() => null);
      await sleep(6000);
      const page = real.web(u => { try { return new URL(u).hostname.includes('google.'); } catch { return false; } });
      const data = page ? await Promise.race([page.evaluate(PROMO), sleep(15000).then(() => ({error: 'timeout'}))]).catch(error => ({error: String(error.message).slice(0, 80)})) : {error: 'no page'};
      const png = await capturePage(real, 'google.', P.shot(`real-google-${label}.png`));
      results.push({label, ...data, png});
      if (tab) await real.act({type: 'tab.close', id: tab.id}).catch(() => {});
    }
    fs.writeFileSync(P.shot('real-google.json'), JSON.stringify(results, null, 2));
    const ok = results.filter(r => !r.error);
    P.check('real google.com loaded in the real app', ok.length >= 1, results.map(r => r.error || `${r.label}: ${r.title}`).join(' / '));
    for (const r of ok) {
      P.check(`real Google ${r.label}: the page sees a Chrome identity (not Electron)`, /Chrome\/\d+/.test(r.ua) && !/Electron/i.test(r.ua) && r.brands.some(b => /Google Chrome/.test(b)), `${r.ua.slice(0, 90)} brands ${r.brands.join(',')}`);
      P.check(`real Google ${r.label}: no Chrome promo on screen`, r.sheetsVisible === 0 && !r.promoTextVisibleInBody, `promo sheets served ${r.sheets}, visible ${r.sheetsVisible}, promo text ${JSON.stringify(r.promoText)}${r.robot ? ' (Google showed a human check on this network)' : ''}`, r.png);
    }
  } finally {
    await real.close();
  }
});
server.close();
P.finish();
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
