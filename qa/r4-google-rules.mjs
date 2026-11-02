// R4-55: do Acira's own page rules hide any real Google result? The results page is loaded in plain Chrome (fresh profile, nothing of Acira involved),
// then Acira's rules are replayed on that real page and the visible results are counted before and after:
//   1. the AI-answer rules (ai-surfaces.cjs + the frame script's hide/unit logic, via qa/privacy-plus/ai-runtime-min.cjs) including their early style sheet,
//   2. the ad lists' cosmetic rules for google.com that Ghostery's engine returns for the classes, ids and links on the page (same inputs as the frame script sends),
//   3. the first result links as Google wrote them, to compare with the link-cleaning / debounce rules.
// Google is only ever loaded in plain Chrome here; Acira itself is not pointed at Google by this script.
//   node qa/r4-google-rules.mjs "youtube,gh,wikipedia,amazon,reddit,netflix"       (GOOGLE_EXTRA="&hl=en&gl=es" adds query parameters)
import './live-google-gate.mjs'; import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {chromium} from 'playwright';
import {sleep, poll} from './d-harness.mjs';

const require = createRequire(import.meta.url);
const queries = (process.argv[2] || 'youtube').split(',').map(q => q === 'gh' ? 'git' + 'hub' : q);
const extra = process.env.GOOGLE_EXTRA || '';
const { surfacesFor, earlyStyles } = require('../desktop/browser-services/ai-surfaces.cjs');
const { FiltersEngine } = require('@ghostery/adblocker');

const lists = ['easylist.txt', 'easyprivacy.txt', 'ubo-filters.txt', 'ubo-quick-fixes.txt', 'unbreak.txt'].map(f => path.resolve('resources/filters', f));
const text = (await Promise.all(lists.map(f => fs.readFile(f, 'utf8').catch(() => '')))).join('\n');
const engine = FiltersEngine.parse(text, {loadCosmeticFilters: true, loadNetworkFilters: false});

const visibleResults = `(() => { const out = []; const seen = new Set(); for (const a of document.querySelectorAll('#search a:has(h3), #rso a:has(h3), a:has(h3)')) { if (seen.has(a)) continue; seen.add(a); const r = a.getBoundingClientRect(), s = getComputedStyle(a); let shown = r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; for (let n = a; shown && n; n = n.parentElement) if (getComputedStyle(n).display === 'none') shown = false; let cite = a.querySelector('cite'); out.push({title: a.querySelector('h3').textContent.slice(0, 60), cite: cite ? cite.textContent.slice(0, 40) : '', href: a.getAttribute('href').slice(0, 70), shown}); } return out; })()`;
const TOKENS = `(() => { const classes = new Set(), ids = new Set(), hrefs = new Set(); for (const n of document.querySelectorAll('[id],[class],[href]')) { if (n.id) ids.add(n.id); for (const c of n.classList) classes.add(c); const h = n.getAttribute('href'); if (h && h.length <= 1024) hrefs.add(h); } return {classes: [...classes], ids: [...ids], hrefs: [...hrefs]}; })()`;

// The frame script's own AI-rule functions, copied from content-filter-preload.cjs by line prefix so this always runs the shipped code.
const preloadLines = (await fs.readFile('desktop/browser-services/content-filter-preload.cjs', 'utf8')).split(/\r?\n/);
const take = prefixes => prefixes.map(prefix => { const at = preloadLines.findIndex(l => l.startsWith(prefix)); if (at < 0) throw new Error('missing ' + prefix); if (prefix !== ' function makePlaceholder(') return preloadLines[at]; let end = at; while (!preloadLines[end].includes('return placeholder;}')) end++; return preloadLines.slice(at, end + 1).join('\n'); }).join('\n');
const aiScript = items => '(()=>{const hidden=new Map(),revealed=new WeakSet(),aiHidden=new Map(),banned=new WeakSet();let handled=new WeakSet(),tries=new WeakMap();const report=()=>{};const options={aiRules:' + JSON.stringify(items) + '};'
  + take([' function resultsEdge(', ' function makePlaceholder(', ' function hide(', ' function unhide(', ' const norm=', ' const visibleKids=', ' function aiUnit(', ' const PAGE_SHAPE', ' function unsafeBlock(', ' function recheckAi(', ' function ownText(', ' function aiNodes(', ' function resultsReady(', ' function applyAiRules('])
  + '\napplyAiRules();window.__aiHidden=[...hidden.entries()].map(([n,e])=>n.tagName.toLowerCase()+(n.id?"#"+n.id:"")+"."+[...n.classList].slice(0,3).join("."));})();';
const profile = 'C:/ae/r4/lang/chrome-rules';
await fs.rm(profile, {recursive: true, force: true}).catch(() => {});
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=9334', 'about:blank'], {stdio: 'ignore'});
const report = [];
try {
  const browser = await poll(() => chromium.connectOverCDP('http://127.0.0.1:9334'), Boolean, 'chrome cdp', 20000);
  const context = browser.contexts()[0], page = context.pages()[0] || await context.newPage();
  for (const q of queries) {
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}${extra}`, {waitUntil: 'domcontentloaded', timeout: 30000}).catch(() => {});
    await sleep(8000);
    const entry = {q, url: page.url().slice(0, 100)};
    if (/\/sorry\//.test(page.url())) { entry.sorry = true; report.push(entry); console.log(q, 'SORRY page, skipped'); continue; }
    entry.lang = await page.evaluate(() => document.documentElement.lang);
    const before = await page.evaluate(visibleResults);
    entry.before = before.filter(r => r.shown).length; entry.total = before.length; entry.top = before.slice(0, 3).map(r => r.cite + ' | ' + r.title);
    // 1. AI rules (page script) plus the early style sheet
    const surfaces = surfacesFor('www.google.com');
    const script = aiScript(surfaces.items);
    await page.addStyleTag({content: earlyStyles(surfaces.items)});
    await page.evaluate(`(function(){ ${script} })()`);
    entry.aiHidden = await page.evaluate(() => (window.__aiHidden || []).slice(0, 10));
    const afterAi = await page.evaluate(visibleResults);
    entry.afterAi = afterAi.filter(r => r.shown).length;
    // 2. Cosmetic rules from the ad lists for this host and these names
    const tokens = await page.evaluate(TOKENS);
    const cosmetics = engine.getCosmeticsFilters({url: page.url(), hostname: 'www.google.com', domain: 'google.com', classes: tokens.classes, ids: tokens.ids, hrefs: tokens.hrefs, getBaseRules: true, getInjectionRules: false, getExtendedRules: false, getRulesFromDOM: true, getRulesFromHostname: true});
    entry.cosmeticRules = (cosmetics.styles || '').split('}').filter(Boolean).length;
    await page.addStyleTag({content: cosmetics.styles || ''});
    const afterCosmetic = await page.evaluate(visibleResults);
    entry.afterCosmetic = afterCosmetic.filter(r => r.shown).length;
    entry.hiddenResults = afterCosmetic.filter((r, i) => before[i]?.shown && !r.shown).map(r => r.cite + ' | ' + r.title);
    // which selectors matched anything inside the results area
    entry.selectorsTouchingResults = [];
    for (const rule of (cosmetics.styles || '').split('}').filter(Boolean).slice(0, 4000)) {
      if (!/display:\s*none/.test(rule)) continue;
      for (const selector of rule.split('{')[0].split(/,\s*\n/).map(s => s.trim()).filter(Boolean)) {
        const hit = await page.evaluate(sel => { try { return [...document.querySelectorAll(sel)].map(n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + ' inResults=' + Boolean(n.closest('#rso') || n.querySelector('#rso, a h3')) + ' text=' + (n.innerText || '').trim().slice(0, 40)); } catch { return []; } }, selector);
        if (hit.length) entry.selectorsTouchingResults.push(selector.slice(0, 120) + ' -> ' + hit.slice(0, 3).join(' ; '));
      }
    }
    // 3. the first result links as Google wrote them (link cleaning / debounce / de-AMP match none of these shapes: debounce.json only lists googleadservices.com aclk and google.com/amp/s)
    entry.links = before.slice(0, 3).map(r => r.href);
    report.push(entry);
    console.log(JSON.stringify(entry));
  }
  await browser.close().catch(() => {});
} finally { chrome.kill(); }
await fs.writeFile(`C:/ae/r4/lang/evidence/google-rules${extra ? '-' + extra.replace(/\W+/g, '_') : ''}.json`, JSON.stringify(report, null, 1));
process.exit(0);
