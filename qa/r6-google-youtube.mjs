// R6 P0: "youtube" on Google in Acira shows YouTube channel cards first, Chrome shows https://www.youtube.com with sitelinks.
// Loads Google searches in the REAL app on an isolated profile (.qa-profiles, ACIRA_BROWSER_TEST_DATA) and records, per variant, whether the
// first visible organic result is https://www.youtube.com, the final URL (after Acira's own network hooks), the main-frame request headers,
// and whether a youtube.com result exists in the DOM but is hidden. Google requests are few and spaced (GAP ms); the run stops at the first
// "unusual traffic" page. One Electron, one native slot (C:\ae\slot-N.lock, flag wx), closed in finally.
//   D_VISIBLE=1 node qa/r6-google-youtube.mjs --variants typed,u1,u2 [--name before] [--gap 25000] [--setup ai-off|annoy-off|blocking-off|all-off]
import './live-google-gate.mjs'; import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep, poll} from './d-harness.mjs';

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback; };
const G = 'https://www.google.com/search?q=youtube';
const CHROME = '&sourceid=chrome&ie=UTF-8';
const VARIANTS = {
  typed: {input: 'youtube', note: 'address bar text (resolveNavigation)'},
  omnibox: {input: 'youtube', omnibox: true, note: 'typed into the address bar of the current tab and Enter'},
  u1: {input: G, note: 'no hl'},
  u2: {input: G + '&hl=en', note: 'hl=en'},
  u3: {input: G + CHROME, note: 'sourceid=chrome&ie=UTF-8'},
  u4: {input: G + CHROME + '&hl=en', note: 'u3 + hl=en'},
  u5: {input: G + CHROME + '&oq=youtube', note: 'u3 + oq'},
  ar: {input: G + '&hl=ar', note: 'hl=ar (region language)'},
  chrome: {input: G + '&oq=youtube&gs_lcrp=EgZjaHJvbWUyBggAEEUYOTIHCAEQABiPAjIHCAIQABiPAtIBCDEyMjZqMGo3qAIAsAIA&sourceid=chrome&source=chrome.ob&ie=UTF-8', note: "Chrome's own omnibox URL"},
  home: {input: 'https://www.google.com/', typeOnPage: 'youtube', note: 'typed on google.com itself'},
};
const names = arg('variants', 'typed,u1,u2,u3,u4,u5').split(',').filter(Boolean);
const runName = arg('name', 'run'), gap = Number(arg('gap', '25000')), setup = arg('setup', '');
const out = path.resolve(process.env.PROBE_OUT || 'C:/ae/r6/google/evidence', runName);
await fs.mkdir(out, {recursive: true});

const analyse = () => {
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const hiddenBy = el => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : ''} (${cs.display}/${cs.visibility}/${cs.opacity})`; } return null; };
  const text = document.body?.innerText || '';
  const robot = location.pathname.startsWith('/sorry') || /unusual traffic|not a robot/i.test(text) || !!document.querySelector('#captcha-form, iframe[src*="recaptcha"]');
  // Result links can be Google's own /goto?url=… redirects, so the shown address (cite) decides too.
  const isRoot = href => { try { const u = new URL(href); return /^(www\.)?youtube\.com$/.test(u.hostname) && u.pathname === '/'; } catch { return /^https?:\/\/(www\.)?youtube\.com\/?$/.test(String(href).trim()); } };
  const results = [...document.querySelectorAll('#rso a h3, #search a h3, #botstuff a h3')].map(h => { const a = h.closest('a'); const cite = (a?.querySelector('cite')?.innerText || '').replace(/\s+/g, ' ').trim(); return {title: h.innerText.replace(/\s+/g, ' ').slice(0, 90), href: cite && !isRoot(a?.href || '') && isRoot(cite) ? cite : (a?.href || '').slice(0, 140), cite: cite.slice(0, 80), visible: visible(h), hiddenBy: hiddenBy(h), top: Math.round(h.getBoundingClientRect().top + scrollY)}; });
  const shown = results.filter(r => r.visible).sort((a, b) => a.top - b.top);
  const rootLinks = [...document.querySelectorAll('a[href]')].filter(a => isRoot(a.href)).map(a => ({text: a.innerText.replace(/\s+/g, ' ').slice(0, 60), visible: visible(a), hiddenBy: hiddenBy(a), hasH3: !!a.querySelector('h3')}));
  const headings = [...document.querySelectorAll('#rcnt h2, #rcnt h3, #rcnt [role="heading"]')].filter(visible).sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(h => h.innerText.replace(/\s+/g, ' ').slice(0, 70)).filter(Boolean).slice(0, 14);
  const aciraHidden = [...document.querySelectorAll('[data-acira-hidden], [data-acira-ai], .acira-ai-note')].length;
  return {url: location.href, lang: document.documentElement.lang, title: document.title, robot,
    firstOrganic: shown[0] || null, youtubeFirst: !!shown[0] && isRoot(shown[0].href),
    youtubeRootResult: results.filter(r => isRoot(r.href)), rootLinks: rootLinks.slice(0, 6),
    sitelinks: /More results from youtube\.com/i.test(text),
    firstFive: shown.slice(0, 5).map(r => r.title + ' <' + r.href.slice(0, 60) + '>'), headings, aciraHidden,
    hiddenResults: results.filter(r => !r.visible).slice(0, 8)};
};
const identity = async () => { const d = navigator.userAgentData, high = d ? await d.getHighEntropyValues(['fullVersionList', 'platformVersion', 'uaFullVersion']) : null; return {ua: navigator.userAgent, languages: [...navigator.languages], brands: d?.brands, fullVersionList: high?.fullVersionList, platformVersion: high?.platformVersion, webdriver: navigator.webdriver}; };

let slot = null;
for (let attempt = 0; attempt < 40 && !slot; attempt++) {
  for (const n of [1, 2, 3]) { const file = `C:/ae/slot-${n}.lock`; try { await fs.writeFile(file, `r6-google-youtube ${new Date().toISOString()}`, {flag: 'wx'}); slot = file; break; } catch {} }
  if (!slot) await sleep(30000);
}
if (!slot) throw new Error('no native slot');
const report = {run: runName, setup, started: new Date().toISOString(), variants: []};
let app;
try {
  app = await startApp({root: `.qa-profiles/yt-${runName}`});
  await app.main(({BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; w.setBounds({x: 40, y: 40, width: 1280, height: 960}); });
  await app.act({type: 'settings.update', patch: {appearance: 'light'}}).catch(() => {});
  report.system = await app.main(({app}) => ({locale: app.getLocale(), preferred: app.getPreferredSystemLanguages()}));
  report.websiteLanguage = (await app.state()).websiteLanguage;
  if (setup === 'blocking-off' || setup === 'all-off') await app.act({type: 'settings.update', patch: {blocking: false}});
  if (setup === 'ai-off' || setup === 'all-off') await app.svc({type: 'filters.profile-set', patch: {aiContent: false}});
  if (setup === 'annoy-off' || setup === 'all-off') await app.svc({type: 'filters.profile-set', patch: {annoyances: false}});
  report.filters = await app.svc({type: 'filters.profile-status'}).then(f => f?.filters?.profileDefaults ?? f).catch(e => String(e.message));
  // --pref <value>: a test-profile fixture of Google's own signed-out preference cookie (what google.com/preferences saves), to model a profile
  // where Google already holds a language. Only ever written into this disposable .qa-profiles session.
  const pref = arg('pref', '');
  if (pref) {
    const snapshot = await app.state(); report.activeProfile = snapshot.activeBrowserProfileId;
    const partition = snapshot.browserProfiles.find(p => p.id === snapshot.activeBrowserProfileId)?.partition;
    report.prefFixture = await app.main(async ({session}, {partition, pref}) => { const s = partition ? session.fromPartition(partition) : session.defaultSession; await s.cookies.set({url: 'https://www.google.com/', domain: '.google.com', path: '/', name: 'PREF', value: pref, secure: true, expirationDate: Math.floor(Date.now() / 1000) + 86400 * 30}); return (await s.cookies.get({url: 'https://www.google.com/'})).map(c => c.name + '=' + c.value); }, {partition, pref});
  }
  const navs = [];
  app.context.on('request', request => { try { if (request.isNavigationRequest() && /^https:\/\/www\.google\.[a-z.]+\//.test(request.url())) navs.push(request); } catch {} });
  for (const [index, name] of names.entries()) {
    const variant = VARIANTS[name]; if (!variant) { report.variants.push({name, error: 'unknown variant'}); continue; }
    if (index) await sleep(gap);
    const before = new Set(app.context.pages()); navs.length = 0;
    const entry = {name, note: variant.note, input: variant.input};
    try {
      if (variant.omnibox) { const field = app.ui.locator('.address-bar input:visible').first(); await field.focus({timeout: 8000}); await field.fill(variant.input); await sleep(400); await field.press('Enter'); }
      else await app.act({type: 'tab.new', url: variant.input});
      const page = await poll(() => app.context.pages().find(p => !before.has(p) && /^https:\/\/www\.google\./.test(p.url())), Boolean, 'google page', 30000);
      await page.waitForLoadState('load', {timeout: 30000}).catch(() => {});
      if (variant.typeOnPage) {
        await sleep(2500);
        const box = page.locator('textarea[name="q"], input[name="q"]').first();
        await box.click({timeout: 8000}); await box.pressSequentially(variant.typeOnPage, {delay: 90}); await sleep(600); await box.press('Enter');
        await page.waitForURL(/\/search\?/, {timeout: 20000}); await page.waitForLoadState('load', {timeout: 30000}).catch(() => {});
      }
      await sleep(4500);
      Object.assign(entry, await page.evaluate(analyse));
      entry.identity = await page.evaluate(identity).catch(e => String(e.message));
      entry.navigations = [];
      for (const r of navs) { let headers = null; try { headers = await r.allHeaders(); } catch {} entry.navigations.push({url: r.url(), redirectedFrom: r.redirectedFrom()?.url() || null, headers: headers && Object.fromEntries(Object.entries(headers).filter(([k]) => /^(user-agent|accept-language|sec-ch-|sec-fetch-|cookie$|referer|x-client-data|dnt|sec-gpc)/.test(k)).map(([k, v]) => [k, k === 'cookie' ? v.split(';').map(c => c.trim().split('=')[0]).join(',') : v]))}); }
      await page.screenshot({path: path.join(out, `${name}-page.png`)}).catch(e => entry.pageShotError = String(e.message));
      const png = await app.main(async ({desktopCapturer, BaseWindow}) => { const w = BaseWindow.getAllWindows()[0]; const b = w.getBounds(); const sources = await desktopCapturer.getSources({types: ['window'], thumbnailSize: {width: b.width, height: b.height}}); const s = sources.find(x => x.id === w.getMediaSourceId()); return s ? s.thumbnail.toPNG().toString('base64') : null; }).catch(() => null);
      if (png) await fs.writeFile(path.join(out, `${name}-window.png`), Buffer.from(png, 'base64'));
      console.log(`${name}: youtubeFirst=${entry.youtubeFirst} robot=${entry.robot} url=${entry.url}\n   first=${JSON.stringify(entry.firstOrganic?.title)} <${entry.firstOrganic?.href}>`);
      if (entry.robot) { report.variants.push(entry); report.stopped = 'unusual traffic page'; break; }
    } catch (error) { entry.error = String(error.stack || error).slice(0, 600); console.log(name, 'error', entry.error); }
    report.variants.push(entry);
  }
} finally {
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(report, null, 2)).catch(() => {});
  try { await app?.close(); } catch {}
  try { app?.app.process().kill(); } catch {}
  await fs.unlink(slot).catch(() => {});
}
console.log('wrote', path.join(out, 'result.json'));
process.exit(0);
