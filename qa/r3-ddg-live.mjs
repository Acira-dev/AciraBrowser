// R3 fix (AI-free on DuckDuckGo): load the REAL duckduckgo.com results page in the real app with AI-free mode ON (and OFF as the control), each in a
// fresh isolated profile, and report what is on screen: the search form, results, any <form> that wraps results, and the page's visible state.
// Never signs in. Holds ONE native slot, released in finally.   node qa/r3-ddg-live.mjs [on|off|both] [query]
import fs from 'node:fs/promises';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';

const mode = process.argv[2] || 'both';
const query = process.argv[3] || 'how do solar panels work';
const out = process.env.R3_EVIDENCE || 'C:/ae/r3/fix-switch/evidence';
await fs.mkdir(out, {recursive: true});

async function takeSlot(name) {
  const until = Date.now() + 20 * 60 * 1000;
  while (Date.now() < until) {
    for (const n of [1, 2, 3]) {
      const file = `C:/ae/slot-${n}.lock`;
      try { const handle = await fs.open(file, 'wx'); await handle.writeFile(`${name} ${new Date().toISOString()}`); await handle.close(); return file; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    await sleep(30000);
  }
  throw new Error('no native slot within 20 minutes');
}

const FACTS = `(() => {
  const vis = el => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const ask = document.querySelector('button[data-testid="ask"]');
  const form = ask && ask.closest('form');
  const describe = f => f && ({tag: f.tagName, id: f.id, cls: String(f.className).slice(0, 60), testid: f.getAttribute('data-testid'), role: f.getAttribute('role'), textLen: (f.textContent || '').length, hasSearchField: !!f.querySelector('input[name=q],input[type=search],[role=search],[role=searchbox]'), hasResults: !!f.querySelector('article[data-testid="result"]'), hasLandmark: !!f.querySelector('main,[role=main],header,nav,footer'), display: getComputedStyle(f).display, inline: f.style.cssText.slice(0, 60), html: f.outerHTML.slice(0, 300)});
  return {url: location.href, title: document.title, bodyVisible: vis(document.body), bodyTextLen: (document.body ? document.body.innerText : '').length,
    results: [...document.querySelectorAll('article[data-testid="result"]')].filter(vis).length, resultsTotal: document.querySelectorAll('article[data-testid="result"]').length,
    searchField: [...document.querySelectorAll('input[name=q],input[type=search]')].filter(vis).length,
    assist: !!document.querySelector('[data-assist-icon-trigger]'), assistVisible: [...document.querySelectorAll('[data-assist-icon-trigger]')].filter(vis).length,
    askButton: !!ask, askVisible: vis(ask), askForm: describe(form),
    forms: [...document.querySelectorAll('form')].map(describe).map(f => ({tag: f.tag, id: f.id, cls: f.cls, textLen: f.textLen, hasSearchField: f.hasSearchField, hasResults: f.hasResults, hasLandmark: f.hasLandmark, display: f.display})),
    hiddenByAcira: [...document.querySelectorAll('*')].filter(n => n.style && n.style.display === 'none' && n.style.getPropertyPriority('display') === 'important').slice(0, 12).map(n => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + '.' + String(n.className).slice(0, 40) + ' text=' + (n.textContent || '').length),
    quietLines: [...document.querySelectorAll('[data-acira-filter-control]')].map(n => n.innerText.trim()).slice(0, 5),
    humanCheck: /\\/sorry\\/|unusual traffic|not a robot|captcha|verify you are human/i.test(location.href + ' ' + (document.body ? document.body.innerText : '').slice(0, 1500))}; })()`;

async function load(label) {
  const root = path.resolve(`.qa-profiles/r3-ddg-${label}-${Date.now()}`);
  const app = await startApp({root, env: {ACIRA_BROWSER_TEST_HIDDEN: '0'}});
  try {
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setBounds({x: 20, y: 20, width: 1440, height: 900}); win.show(); win.focus(); });
    await app.svc({type: 'filters.profile-set', patch: {aiContent: label === 'on'}});
    await app.act({type: 'tab.new', url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}&ia=web`});
    await sleep(14000);
    const page = app.web(u => { try { return new URL(u).hostname.includes('duckduckgo.'); } catch { return false; } });
    let facts = {error: 'no page'};
    if (page) facts = await Promise.race([page.evaluate(FACTS), sleep(15000).then(() => ({error: 'timeout'}))]).catch(error => ({error: String(error.message).slice(0, 120)}));
    const data = await app.main(async ({webContents}) => { const view = webContents.getAllWebContents().find(w => { try { return new URL(w.getURL()).hostname.includes('duckduckgo.'); } catch { return false; } }); return view ? (await view.capturePage()).toPNG().toString('base64') : null; }).catch(() => null);
    if (data) await fs.writeFile(path.join(out, `ddg-${label}.png`), Buffer.from(data, 'base64'));
    return facts;
  } finally { await app.close(); }
}

let slot;
try {
  slot = await takeSlot('r3-fix-ddg');
  const report = {query};
  for (const label of mode === 'both' ? ['off', 'on'] : [mode]) { report[label] = await load(label); console.log(label, JSON.stringify(report[label]).slice(0, 2600)); }
  await fs.writeFile(path.join(out, `ddg-live-${mode}.json`), JSON.stringify(report, null, 2));
} finally { if (slot) await fs.unlink(slot).catch(() => {}); }
