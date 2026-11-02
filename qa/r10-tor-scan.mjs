// Clip / overlap scan of every Tor surface this round touched, in the real app: light and dark x 100% and 150% interface x English and German (the long language).
//   node qa/r10-tor-scan.mjs [--langs=en,de] [--only=light-100-en,...]     (one instance, one native slot, closed in finally; needs internet for Tor)
// Surfaces: the address bar (Tor chip + Onion available chip), the Tor panel (security level opened with its reopen offer, the .onion switch), the Tor site panel (circuit),
// Settings > Connection (security level, onion switch), the Downloads page and panel with the Tor warning. The onion key page is scanned inside the onion-auth section of r10-tor-ux.mjs.
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';
import {withSlot} from './native-slot.mjs';
import {IP_URL, showOffscreen, capture, overlayPage, openTorTab, torReady, scan, scanHits} from './r10-tor-lib.mjs';

const option = (name, fallback) => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').slice(name.length + 3) || fallback;
const langs = option('langs', 'en,de').split(','), only = option('only', '').split(',').filter(Boolean);
const ROOT = path.resolve('.qa-profiles/r10-tor-scan');
const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };
const UI = 'acira-browser-ui://ui/index.html';
const uiPage = app => poll(() => app.context.pages().find(p => { try { return p.url() === UI; } catch { return false; } }), Boolean, 'ui page', 30000);
/** The text-only part of the hits, so a hit reads once however it is scanned. */
// Known non-hits (m-clip-scan.js documents them): visually hidden live regions (1px wide), and the tab strip's own truncated tab titles.
const KNOWN = /cw=1 ::|<span.tab-title>/;
const hitsOf = text => scanHits(text).filter(line => !KNOWN.test(line)).map(line => line.slice(0, 220));

await withSlot('r10-tor-scan', async () => {
  const app = await startApp({root: ROOT, env: {ACIRA_BROWSER_TEST_DOWNLOAD_DIR: path.join(ROOT, 'downloads')}});
  try {
    await showOffscreen(app, {width: 1500, height: 950});
    await app.act({type: 'settings.update', patch: {language: 'en', interfaceScale: 100, appearance: 'dark'}});
    // One Tor tab on a site that offers its onion address, one download from a Tor tab (a few bytes of JSON), the Downloads page.
    const tab = await openTorTab(app, 'https://www.torproject.org/');
    await torReady(app);
    await poll(async () => (await app.state()).tabs.find(t => t.id === tab.id)?.onionLocation, Boolean, 'the onion offer', 120000);
    await app.main(({webContents}) => { const wc = webContents.getAllWebContents().find(w => !w.isDestroyed() && w.getURL().startsWith('https://www.torproject.org/')); wc.downloadURL('https://check.torproject.org/api/ip?download=1'); });
    await poll(async () => (await app.state()).downloads.some(d => d.status === 'Ready'), Boolean, 'download finished', 120000);
    await app.act({type: 'tab.new', url: 'acira://downloads'});
    const downloadsTab = (await app.state()).tabs.at(-1).id;
    await app.act({type: 'tab.new', url: 'acira://settings'});
    const settingsTab = (await app.state()).tabs.at(-1).id;
    for (const lang of langs) for (const appearance of ['light', 'dark']) for (const scale of [100, 150]) {
      const name = `${appearance}-${scale}-${lang}`;
      if (only.length && !only.includes(name)) continue;
      console.log(`--- ${name}`);
      await app.act({type: 'settings.update', patch: {language: lang, interfaceScale: scale, appearance}});
      await sleep(3500);
      const ui = await uiPage(app), shot = label => capture(app, `scan-${name}-${label}`);
      const surfaces = {};
      // Address bar with both chips.
      await app.act({type: 'tab.select', id: tab.id}); await sleep(900);
      surfaces['address bar'] = await scan(ui);
      await shot('address-bar');
      // Tor panel: security level opened, Safer chosen (the reopen offer shows because the Tor page still runs at Standard), the onion switch.
      await ui.locator('.tor-chip').first().click();
      let overlay = await overlayPage(app);
      await overlay.locator('.tor-level-row > summary >> visible=true').first().waitFor({timeout: 10000});
      await overlay.locator('.tor-level-row > summary >> visible=true').first().click();
      await overlay.locator('.tor-level [role=radio] >> visible=true').nth(1).click();
      await overlay.locator('.tor-level-apply >> visible=true').first().waitFor({timeout: 8000});
      await sleep(700);
      surfaces['tor panel'] = await scan(overlay);
      await shot('tor-panel');
      await ui.evaluate(() => window.acira.native({type: 'tor.level-set', level: 'standard'}));
      await ui.keyboard.press('Escape'); await sleep(500);
      // Tor site panel: the circuit.
      await ui.locator('.address-security').first().click();
      overlay = await overlayPage(app);
      await overlay.locator('.tor-hop[data-role] >> visible=true').first().waitFor({timeout: 40000}).catch(() => {});
      await sleep(600);
      surfaces['site panel'] = await scan(overlay);
      await shot('site-panel');
      await ui.keyboard.press('Escape'); await sleep(500);
      // Settings > Connection.
      await app.act({type: 'tab.select', id: settingsTab}); await sleep(900);
      await ui.evaluate(() => { const nav = [...document.querySelectorAll('.bs-sidebar nav>button')]; nav.find(b => /Connection|Verbindung/i.test(b.getAttribute('aria-label') || b.textContent || ''))?.click(); });
      await ui.locator('[data-setting=tor-level]').waitFor({timeout: 10000});
      await ui.locator('[data-setting=tor-onion-prefer]').scrollIntoViewIfNeeded(); await sleep(600);
      surfaces['settings'] = await scan(ui);
      await shot('settings');
      // Downloads page and panel.
      await app.act({type: 'tab.select', id: downloadsTab}); await sleep(900);
      await ui.locator('.tor-dl-notice').waitFor({timeout: 8000}).catch(() => {});
      surfaces['downloads page'] = await scan(ui);
      await shot('downloads-page');
      await app.act({type: 'ui.open', panel: 'downloads'});
      overlay = await overlayPage(app);
      await overlay.locator('.tor-dl-notice').waitFor({timeout: 8000}).catch(() => {});
      await sleep(600);
      surfaces['downloads panel'] = await scan(overlay);
      await shot('downloads-panel');
      await ui.keyboard.press('Escape'); await sleep(400);
      for (const [surface, text] of Object.entries(surfaces)) {
        const hits = hitsOf(text);
        check(hits.length === 0, `${name} · ${surface}: ${hits.length ? hits.join(' | ') : 'no clipped or overlapping text'}`);
      }
    }
    await app.act({type: 'settings.update', patch: {language: 'en', interfaceScale: 100, appearance: 'dark'}});
  } finally { await app.close(); }
});
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
