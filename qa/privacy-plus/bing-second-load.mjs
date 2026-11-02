// Does an Acira feature cause Bing's "Verify you are human" on the second search of a session?  node qa/privacy-plus/bing-second-load.mjs <variant>   (env SITE=bing|google)
// variants: default | j-off (J anti-tracking off) | filters-off (+cookie banners, AI off) | blocking-off (+ads/trackers off)
// Finding, 24 Oct 2026: the Playwright/CDP harness itself is an automation tell (navigator.webdriver === true, shown in the "tells" line). The challenge appears
// on the second Bing load, and /sorry on Google, with every Acira protection on or off, so it is not caused by the filters, farbling, headers or blocking.
// The built-in browser pane (same Chromium, same IP, webdriver false) does three Bing searches in a row without a challenge.
// A genuine check of Acira itself must be done without automation: launch the app normally (ACIRA_BROWSER_TEST_DATA=<dir> node launch.mjs) and search twice by hand.
// This script does not hide the automation flag and must not be changed to: that would only defeat the site's bot check, not test the browser.
import fs from 'node:fs/promises';
import {startApp, sleep} from '../d-harness.mjs';
const variant = process.argv[2] || 'default', SITE = process.env.SITE || 'bing';
const root = '.qa-profiles/j-second-' + SITE + '-' + variant; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const app = await startApp({root});
const URLS = SITE === 'google'
  ? ['https://www.google.com/search?q=how+do+solar+panels+work&hl=en', 'https://www.google.com/search?q=best+hiking+boots&hl=en']
  : ['https://www.bing.com/search?q=how+do+solar+panels+work&setlang=en', 'https://www.bing.com/search?q=best+hiking+boots&setlang=en'];
const STATE = `(() => ({ organic: [...document.querySelectorAll('#b_results > li.b_algo, #rso a h3')].filter(e => e.getClientRects().length).length,
  humanCheck: /verify you are human|one last step|unusual traffic|not a robot/i.test(document.body.innerText) || location.pathname.startsWith('/sorry'), path: location.pathname.slice(0, 20) }))()`;
const TELLS = `(() => ({ webdriver: navigator.webdriver, ua: navigator.userAgent, brands: navigator.userAgentData && navigator.userAgentData.brands.map(b => b.brand + ' ' + b.version).join(', '), plugins: navigator.plugins.length, chrome: typeof window.chrome }))()`;
try {
  if (['j-off', 'filters-off', 'blocking-off'].includes(variant)) await app.svc({type: 'antitracking.set', patch: {cnameUncloaking: false, skipTrackingRedirects: false, fingerprint: 'off'}});
  if (['filters-off', 'blocking-off'].includes(variant)) await app.svc({type: 'filters.profile-set', patch: {annoyances: false, aiContent: false}});
  for (const [index, url] of URLS.entries()) {
    await app.act({type: 'tab.new', url}); await sleep(11000);
    const tab = (await app.state()).tabs.at(-1);
    if (index === 0 && variant === 'blocking-off') await app.svc({type: 'privacy.set', tabId: tab.id, blocking: false, scope: 'profile'});
    const page = app.context.pages().filter(p => { try { return new URL(p.url()).hostname.includes(SITE); } catch { return false; } }).at(-1);
    const privacy = (await app.svc({type: 'privacy.status', tabId: tab.id}).catch(() => ({}))).privacy || {};
    console.log(`[${SITE}/${variant}] load ${index + 1}: ${JSON.stringify(await page.evaluate(STATE))} blocked=${privacy.blocked}`);
    if (index === 0) console.log(`[${SITE}/${variant}] tells: ${JSON.stringify(await page.evaluate(TELLS))}`);
  }
} finally { await app.close(); process.exit(0); }
