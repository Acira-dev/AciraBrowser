// Ad-blocker proof rig: the real app in an isolated profile loads ad-block test pages, ad-heavy news sites, YouTube watch pages and a sanity set, and
// records blocked-request counts, ad-like element visibility, scores, page screenshots, launch time and memory. Run it once per condition (before/after).
//
//   cd <app root>   (a source tree with dist/ built: desktop/main.cjs is launched from it, and .qa-profiles + qa/prepare-native-profile.cjs are read from it)
//   node <this file> --label after [--exe <path to AciraBrowser.exe>] [--out C:/ae/r11-proof/after] [--only tests,news,youtube,sanity]
//
//   --exe   drives a packaged build instead of desktop/main.cjs (read only), e.g. release/round/r26/builder/win-unpacked/AciraBrowser.exe
//   Always wrap it: node qa/native-slot.mjs adblock-proof -- node <this file> ...  (cwd = the app root; the slot script is in this folder)
// Read only: no sign-in, no forms, no searches. A consent/bot/captcha page on YouTube stops the YouTube part and is reported, never solved.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {startApp, poll, sleep, finaleEnded} from './d-harness.mjs';

const args = process.argv.slice(2), opt = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const label = opt('label', 'run'), out = path.resolve(opt('out', `C:/ae/r11-proof/${label}`)), exe = opt('exe', ''), parts = new Set(opt('only', 'tests,news,youtube,sanity').split(','));
const MAX_TABS = 30;
fs.mkdirSync(out, {recursive: true});
if (exe) process.env.D_APP_EXE = path.resolve(exe);
// QA profiles cannot resolve google.com / youtube.com on purpose (desktop/browser-services/quiet-network.cjs: ERR_NAME_NOT_RESOLVED). --live-youtube is that file's deliberate opt-in
// (ACIRA_QA_LIVE_GOOGLE=1); use it only with --only youtube so nothing else of Google is opened, and stop at the first challenge.
if (args.includes('--live-youtube')) process.env.ACIRA_QA_LIVE_GOOGLE = '1';

const TESTS = [
  {id: 'd3ward', url: 'https://d3ward.github.io/toolz/adblock.html', wait: 22000},
  {id: 'adblock-tester', url: 'https://adblock-tester.com/', wait: 22000},
  // d3ward's page is archived (1 Nov 2026: it only shows "no longer maintained"), so it cannot score anything; this one runs live tests.
  {id: 'fivefilters', url: 'https://blockads.fivefilters.org/', wait: 20000}
];
const NEWS = [
  {id: 'dailymail', url: 'https://www.dailymail.co.uk/home/index.html'},
  {id: 'foxnews', url: 'https://www.foxnews.com/'},
  {id: 'nypost', url: 'https://nypost.com/'}
];
const YOUTUBE = [{id: 'dQw4w9WgXcQ'}, {id: '9bZkp7q19f0'}, {id: 'kJQP7kiw5Fk'}];
const SANITY = [
  ['wikipedia', 'https://en.wikipedia.org/wiki/Main_Page'], ['github', 'https://github.com/'], ['reddit', 'https://www.reddit.com/'], ['bbc', 'https://www.bbc.com/'],
  ['amazon', 'https://www.amazon.com/'], ['nytimes', 'https://www.nytimes.com/'], ['stackoverflow', 'https://stackoverflow.com/'], ['youtube-home', 'https://www.youtube.com/']
];

// Elements that are ads by their own markup, counted by what the person would see: laid out, not hidden, not collapsed.
const AD_PROBE = () => {
  const sel = '[id^="div-gpt-ad"],[id*="google_ads"],ins.adsbygoogle,[class*="adsbygoogle"],[class~="ad"],[class~="ads"],[class~="advert"],[class*="ad-slot"],[class*="ad-container"],[class*="advertisement"],[id*="ad-slot"],[data-ad-unit],[data-google-query-id],[class*="taboola"],[id*="taboola"],[class*="outbrain"],[id*="outbrain"],iframe[src*="doubleclick"],iframe[src*="googlesyndication"],iframe[id*="google_ads"],iframe[src*="adnxs"],iframe[src*="amazon-adsystem"]';
  let total = 0, visible = 0, hiddenByStyle = 0, withContent = 0; const samples = [];
  for (const el of document.querySelectorAll(sel)) {
    total++;
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden') { hiddenByStyle++; continue; }
    if (rect.width >= 40 && rect.height >= 20) { visible++; if (el.querySelector('iframe,img,video,canvas') || el.tagName === 'IFRAME') withContent++; if (samples.length < 6) samples.push((el.id || el.className || el.tagName).toString().slice(0, 60) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height)); }
  }
  return {total, visible, hiddenByStyle, visibleWithContent: withContent, samples, adFrames: document.querySelectorAll('iframe[src*="doubleclick"],iframe[src*="googlesyndication"],iframe[src*="adnxs"],iframe[src*="amazon-adsystem"]').length};
};

const report = {label, root: process.cwd(), exe: exe || null, startedAt: new Date().toISOString(), launch: {}, memory: {}, tests: {}, news: {}, youtube: {}, sanity: {}};
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
const log = (...a) => console.log(`[${label}]`, ...a);

{
  const profile = `.qa-profiles/adproof-${label}`;
  fs.rmSync(path.resolve(profile), {recursive: true, force: true});
  const t0 = Date.now();
  const app = await startApp({root: profile, skipSetup: false, args: ['--disable-features=CalculateNativeWinOcclusion', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows']});
  const pid = (() => { try { return app.app.process().pid; } catch { return 0; } })();
  try {
    report.launch = {processUptimeToUiReadyMs: Math.round(await app.main(() => process.uptime() * 1000)), harnessWallMs: Date.now() - t0, version: await app.main(({app: a}) => a.getVersion()), chromium: await app.main(() => process.versions.chrome)};
    try { const skip = app.ui.getByRole('button', {name: 'Skip setup'}); await skip.waitFor({timeout: 5000}); await skip.click(); await sleep(600); await finaleEnded(app.ui); } catch { /* past setup */ }
    // Shown off-screen and without taking focus so the compositor paints for screenshots and the real desktop is untouched.
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; if (win) { win.setBounds({x: -3200, y: 0, width: 1280, height: 900}); win.showInactive(); } });
    const isUi = p => /^acira-browser-ui:/.test(p.url());
    // Why a page did not load: the failure text of every top-level navigation request (net::ERR_...), kept per URL.
    const navErrors = [];
    app.context.on('requestfailed', r => { try { if (r.isNavigationRequest()) navErrors.push({url: r.url().slice(0, 100), error: r.failure()?.errorText || ''}); } catch { /* page gone */ } });
    report.navErrors = navErrors;
    const metrics = async () => app.main(({app: a}) => a.getAppMetrics().map(m => ({type: m.type, pid: m.pid, workingSetMB: Math.round(m.memory.workingSetSize / 1024), privateMB: Math.round((m.memory.privateBytes || 0) / 1024)})));
    const summarize = m => ({mainMB: m.filter(x => x.type === 'Browser').reduce((s, x) => s + x.workingSetMB, 0), totalMB: m.reduce((s, x) => s + x.workingSetMB, 0), processes: m.length});

    async function open(url) {
      const tabs = (await app.state()).tabs;
      if (tabs.length >= MAX_TABS - 2) throw new Error('tab cap');
      const before = new Set(app.context.pages());
      await app.act({type: 'tab.new', url});
      const page = await poll(async () => app.context.pages().find(p => !before.has(p) && !isUi(p)), Boolean, 'page for ' + url, 20000);
      const tab = await poll(async () => (await app.state()).tabs.at(-1), t => t && t.id, 'tab for ' + url, 10000);
      return {page, tab};
    }
    const close = async tab => { try { await app.act({type: 'tab.close', id: tab.id}); } catch { /* already gone */ } await sleep(300); };
    const blockedOf = async tab => { try { const p = (await app.svc({type: 'privacy.status', tabId: tab.id})).privacy; const byType = {}; for (const d of p.details || []) byType[d.type] = (byType[d.type] || 0) + 1; return {blocked: p.blocked, byType, hosts: [...new Set((p.details || []).map(d => d.hostname))].slice(0, 12)}; } catch (e) { return {error: String(e.message || e).slice(0, 120)}; } };
    const shot = async (page, name) => { const file = path.join(out, `${name}.png`); try { await page.screenshot({path: file, timeout: 20000}); return file; } catch (e) { return 'ERR ' + String(e.message).slice(0, 80); } };
    const settle = async (page, ms) => { await page.waitForLoadState('load', {timeout: 25000}).catch(() => {}); await sleep(ms); };

    if (parts.has('tests')) for (const t of TESTS) {
      try {
        const {page, tab} = await open(t.url); await settle(page, t.wait);
        const info = await page.evaluate(() => {
          const all = (document.body.innerText || '').replace(/\s+/g, ' '), score = document.querySelector('[class*="score-value"], [class*="score"] [class*="value"]');
          return {title: document.title, scoreValue: score?.textContent?.trim() || null, scoreMatches: [...new Set(all.match(/\b\d{1,3}\s*(?:points\s+)?(?:\/|out of)\s*\d{2,3}\b|\b\d{1,3}\s*%/g) || [])].slice(0, 12), passed: (all.match(/✅/g) || []).length, failed: (all.match(/❌/g) || []).length, textLength: all.length, text: all.slice(0, 800), textTail: all.slice(-900)};
        }).catch(e => ({error: String(e.message).slice(0, 100)}));
        report.tests[t.id] = {...info, ...(await blockedOf(tab)), screenshot: await shot(page, 'test-' + t.id)};
        log(t.id, 'score', info.scoreValue, 'passed/failed', info.passed + '/' + info.failed, 'numbers', (info.scoreMatches || []).join(' '), 'blocked', report.tests[t.id].blocked); await close(tab);
      } catch (e) { report.tests[t.id] = {error: String(e.message).slice(0, 160)}; }
      save();
    }

    if (parts.has('news')) for (const n of NEWS) {
      try {
        const {page, tab} = await open(n.url); await settle(page, 9000);
        await page.evaluate(() => window.scrollBy(0, 1400)).catch(() => {}); await sleep(3000);
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {}); await sleep(1500);
        const ads = await page.evaluate(AD_PROBE).catch(e => ({error: String(e.message).slice(0, 100)}));
        const info = await page.evaluate(() => ({title: document.title.slice(0, 80), url: location.href.slice(0, 100), height: document.documentElement.scrollHeight})).catch(() => ({}));
        report.news[n.id] = {...info, ads, ...(await blockedOf(tab)), screenshot: await shot(page, 'news-' + n.id)};
        log(n.id, 'blocked', report.news[n.id].blocked, 'ad-like visible', ads.visible, '/', ads.total); await close(tab);
      } catch (e) { report.news[n.id] = {error: String(e.message).slice(0, 160)}; }
      save();
    }
    report.memory.afterNews = summarize(await metrics());

    if (parts.has('youtube')) for (const v of YOUTUBE) {
      if (report.youtube.challenge) break;
      const rec = {id: v.id, samples: []};
      try {
        const {page, tab} = await open('https://www.youtube.com/watch?v=' + v.id);
        await page.waitForSelector('#movie_player, ytd-consent-bump-v2-lightbox, form[action*="consent"]', {timeout: 30000}).catch(() => {});
        const check = () => page.evaluate(() => {
          const text = (document.body?.innerText || '').slice(0, 4000), url = location.href;
          const challenge = /consent\.youtube|\/sorry\//.test(url) || /confirm you.re not a bot|unusual traffic|Before you continue to YouTube|Sign in to confirm/i.test(text) || !!document.querySelector('ytd-consent-bump-v2-lightbox, tp-yt-paper-dialog form[action*="consent"]');
          const p = document.querySelector('#movie_player'), v = document.querySelector('video');
          return {challenge, url: url.slice(0, 80), ad: !!p?.classList.contains('ad-showing'), adUi: !!document.querySelector('.ytp-ad-player-overlay, .ytp-ad-text, .ytp-ad-skip-button-container, .ytp-ad-preview-container, .video-ads .ytp-ad-module .ytp-ad-persistent-progress-bar-container'), adSlots: document.querySelectorAll('ytd-ad-slot-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, #masthead-ad, ytd-banner-promo-renderer').length, adSlotsVisible: [...document.querySelectorAll('ytd-ad-slot-renderer, ytd-display-ad-renderer, ytd-promoted-sparkles-web-renderer, #masthead-ad')].filter(e => e.offsetHeight > 20).length, t: v ? +v.currentTime.toFixed(1) : null, d: v && isFinite(v.duration) ? +v.duration.toFixed(1) : null, paused: v ? v.paused : null, title: document.title.slice(0, 60)};
        }).catch(e => ({error: String(e.message).slice(0, 80)}));
        for (let i = 0; i < 16; i++) {
          const s = await check(); s.at = i; rec.samples.push(s);
          if (s.challenge) { report.youtube.challenge = {video: v.id, url: s.url}; rec.challenge = true; rec.screenshot = await shot(page, 'youtube-challenge-' + v.id); log('YOUTUBE CHALLENGE - stopping YouTube part', s.url); break; }
          if (s.paused === true && i === 3) await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.play().catch(() => {}); } }).catch(() => {});
          if (i === 2 || i === 8) rec['screenshot' + i] = await shot(page, `youtube-${v.id}-t${i}`);
          await sleep(1000);
        }
        if (!rec.challenge) {
          rec.screenshotEnd = await shot(page, `youtube-${v.id}-end`);
          rec.adSeen = rec.samples.some(s => s.ad || s.adUi); rec.adSeconds = rec.samples.filter(s => s.ad).length; rec.played = rec.samples.some(s => (s.t || 0) > 2 && !s.ad);
          Object.assign(rec, await blockedOf(tab));
        }
        log('youtube', v.id, rec.challenge ? 'CHALLENGE' : `adSeen=${rec.adSeen} adSeconds=${rec.adSeconds} played=${rec.played} blocked=${rec.blocked}`);
        await close(tab);
      } catch (e) { rec.error = String(e.message).slice(0, 160); }
      rec.navErrors = navErrors.filter(e => /youtube|google/.test(e.url)).slice(-4); report.youtube[v.id] = rec; save();
    }

    if (parts.has('sanity')) for (const [id, url] of SANITY) {
      try {
        const {page, tab} = await open(url); await settle(page, 4000);
        const info = await page.evaluate(() => ({title: document.title.slice(0, 80), url: location.href.slice(0, 90), textLength: (document.body?.innerText || '').length, errorPage: /ERR_[A-Z_]+|This site can.t be reached|Access Denied|captcha|are you a robot/i.test((document.title + ' ' + (document.body?.innerText || '').slice(0, 600)))})).catch(e => ({error: String(e.message).slice(0, 100)}));
        const state = (await app.state()).tabs.find(t => t.id === tab.id);
        report.sanity[id] = {...info, tabTitle: state?.title?.slice(0, 60), ok: !!info.title && !info.error && info.textLength > 200 && !info.errorPage, ...(await blockedOf(tab))};
        log('sanity', id, report.sanity[id].ok ? 'ok' : 'CHECK', JSON.stringify(info.title).slice(0, 50)); await close(tab);
      } catch (e) { report.sanity[id] = {ok: false, error: String(e.message).slice(0, 160)}; }
      save();
    }
    const finalMetrics = await metrics();
    report.memory.end = {...summarize(finalMetrics), byProcess: finalMetrics};
    report.finishedAt = new Date().toISOString(); save();
  } finally {
    await app.close();
    if (pid) spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {windowsHide: true, stdio: 'ignore'});
  }
}
save();
log('done ->', path.join(out, 'report.json'));
process.exit(0);
