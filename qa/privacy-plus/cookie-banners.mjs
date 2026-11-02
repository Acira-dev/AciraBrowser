// Stream J: cookie-banner hiding on big consent sites, in the real isolated app.  node qa/privacy-plus/cookie-banners.mjs [host,host,...]
// For each site: banner hiding off (control) vs on (default). A banner is any visible fixed/sticky/absolute box or consent iframe whose text asks for cookie consent.
import fs from 'node:fs/promises';
import {startApp, sleep, poll} from '../d-harness.mjs';
const root = '.qa-profiles/j-cookie-banners'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const OFF_ONLY = process.argv.includes('--off-only'), SHOTS = process.argv.includes('--shots'), listArg = process.argv.slice(2).find(a => !a.startsWith('--'));
const SITES = (listArg ? listArg.split(',') : ['www.bbc.com', 'www.reddit.com', 'www.imdb.com', 'www.booking.com', 'www.spiegel.de', 'www.lemonde.fr', 'www.tripadvisor.com', 'www.ebay.com', 'www.theguardian.com', 'edition.cnn.com']).map(host => ({host, url: `https://${host}/`}));
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
  // keep only outermost
  const consentFrames = [...document.querySelectorAll('iframe')].filter(f => { const r = f.getBoundingClientRect(), cs = getComputedStyle(f); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 240 && r.height > 80 && /consent|cmp|sp_message|privacy|onetrust|didomi|cookie|sourcepoint|usercentrics|trustarc/i.test((f.id || '') + (f.src || '') + (f.title || '')); }).map(f => (f.id || f.src).slice(0, 50));
  const cx = innerWidth / 2, cy = innerHeight / 2, top = document.elementFromPoint(cx, cy);
  const covered = !!top && (top.closest && !!top.closest('[id*="consent" i],[class*="consent" i],[id*="cookie" i],[class*="cookie" i],[id*="cmp" i],[id*="onetrust" i],[class*="overlay" i],[class*="modal" i],iframe[id*="sp_message"]'));
  const login = [...document.querySelectorAll('a[href*="signin" i],a[href*="sign-in" i],a[href*="login" i],a[href*="log-in" i],button')].filter(a => /sign in|log in|login/i.test(a.innerText || a.getAttribute('aria-label') || '')).find(a => { const r = a.getBoundingClientRect(); return r.width > 8 && r.height > 8 && r.top >= 0 && r.top < innerHeight && r.left >= 0 && r.left < innerWidth; });
  let loginClickable = null; if (login) { const r = login.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); loginClickable = !!hit && (hit === login || login.contains(hit) || hit.contains(login)); }
  const locked = [document.documentElement, document.body].some(e => e && getComputedStyle(e).overflowY === 'hidden' && e.scrollHeight > innerHeight * 1.2);
  return {banners: banners.slice(0, 6), bannerCount: banners.length, consentFrames, centerCovered: covered, scrollLocked: locked, loginFound: !!login, loginClickable, links: document.querySelectorAll('a[href]').length, textLength: (document.body && document.body.innerText || '').length, scrollHeight: document.documentElement.scrollHeight};
})()`;
const app = await startApp({root});
const rows = [];
try {
  const measure = async (site, label) => {
    await app.act({type: 'tab.new', url: site.url});
    const tab = await poll(async () => (await app.state()).tabs.at(-1), t => t.url.includes(site.host.replace(/^www\./, '').split('.')[0]) && !t.loading, 'tab ' + site.host, 35000).catch(() => null);
    await sleep(7000);
    const page = app.web(url => { try { return new URL(url).hostname.includes(site.host.replace(/^(www|edition)\./, '').split('.')[0]); } catch { return false; } });
    let result = null; if (page) { try { result = await Promise.race([page.evaluate(DETECT), sleep(15000).then(() => ({error: 'timeout'}))]); } catch (error) { result = {error: String(error.message).slice(0, 80)}; } } else result = {error: 'no page'};
    if (SHOTS && page) { try { await fs.mkdir('.scratch-src/out/cb', {recursive: true}); await page.screenshot({path: `.scratch-src/out/cb/${site.host}-${label}.png`, timeout: 8000}); } catch {} }
    const hidden = tab ? (await app.svc({type: 'filters.status', tabId: tab.id}).catch(() => ({}))).filters : null;
    if (tab) await app.act({type: 'tab.close', tabId: tab.id}).catch(() => {});
    return {label, ...result, hiddenModules: hidden && hidden.hidden};
  };
  for (const site of SITES) {
    await app.svc({type: 'filters.profile-set', patch: {annoyances: false}});
    const off = await measure(site, 'off');
    if (OFF_ONLY) { rows.push({site: site.host, off}); console.log(site.host.padEnd(22), 'off:', off.error || `banners=${off.bannerCount} ${off.banners.join('; ')} frames=${off.consentFrames.length} ${off.consentFrames.join(';')} covered=${off.centerCovered} locked=${off.scrollLocked}`); continue; }
    await app.svc({type: 'filters.profile-set', patch: {annoyances: true}});
    const on = await measure(site, 'on');
    rows.push({site: site.host, off, on});
    console.log(site.host.padEnd(22), 'off:', off.error || `banners=${off.bannerCount} frames=${off.consentFrames.length} covered=${off.centerCovered} locked=${off.scrollLocked} login=${off.loginFound}/${off.loginClickable} links=${off.links}`, '| on:', on.error || `banners=${on.bannerCount} frames=${on.consentFrames.length} covered=${on.centerCovered} locked=${on.scrollLocked} login=${on.loginFound}/${on.loginClickable} links=${on.links} hidden=${on.hiddenModules}`);
  }
  await fs.mkdir('.scratch-src/out', {recursive: true}); await fs.writeFile('.scratch-src/out/cookie-banners.json', JSON.stringify(rows, null, 1));
} finally { await app.close(); process.exit(0); }
