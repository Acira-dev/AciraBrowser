// R3-44 row "AI-free mode on Google, Bing and DuckDuckGo". Real search pages, real app, a FRESH isolated profile for every load (so no engine can
// challenge a second load in one session), closed in finally.   node qa/r3-proof/live-ai-free.mjs   (needs internet)
// Per engine: AI-free mode OFF (control) must show the engine's AI answer block; ON must hide it with the quiet "hidden - Show" line while the organic
// results stay; "Show" must bring the block back. Several queries are tried until the control shows an AI answer (engines do not answer every query with one).
// A human check from the engine (Google does this to automated browsers from some networks) is reported as such: that engine is then NOT proven.
import fs from 'node:fs';
import path from 'node:path';
import {startApp} from '../d-harness.mjs';
import {probe, withSlot, sleep, capturePage} from './lib.mjs';

const P = probe('live-ai-free');
const QUERIES = ['how do solar panels work', 'what is photosynthesis', 'why is the sky blue', 'how does a heat pump work'];
const ENGINES = {
  google: {host: 'google.', url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us`, block: '#m-x-content,[data-attrid="AIOverview"]', unit: null, entry: 'a[href*="udm=50"],button[jsname="B6rgad"]', organic: '#rso a h3'},
  bing: {host: 'bing.', url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}&setlang=en`, block: '#copans_container', unit: 'li.b_ans', entry: '#b-scopeListItem-copilotsearch', organic: '#b_results .b_algo'},
  duckduckgo: {host: 'duckduckgo.', url: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}&ia=web`, block: 'section[data-testid="mainline"] [data-assist-icon-trigger]', unit: 'section[data-testid="mainline"] > ol > li', entry: '#react-ai-button-slot', organic: 'article[data-testid="result"]'},
};
const only = process.env.PROOF_ENGINES ? process.env.PROOF_ENGINES.split(',') : Object.keys(ENGINES);
const STATE = s => `(() => { const vis = el => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
  const block = document.querySelector(${JSON.stringify(s.block)}); const unit = block && ${JSON.stringify(s.unit)} ? block.closest(${JSON.stringify(s.unit)}) : block;
  const entries = [...document.querySelectorAll(${JSON.stringify(s.entry)})];
  const line = [...document.querySelectorAll('[data-acira-filter-control]')].map(n => n.innerText.trim()).filter(t => /hidden/i.test(t));
  const text = document.body ? document.body.innerText : '';
  return {url: location.href, title: document.title, blockPresent: !!block, blockVisible: vis(block) && vis(unit), entryCount: entries.length, entryVisible: entries.filter(vis).length, line,
    organic: [...document.querySelectorAll(${JSON.stringify(s.organic)})].filter(vis).length, humanCheck: /\\/sorry\\/|unusual traffic|not a robot|captcha|verify you are human|one last step/i.test(location.href + ' ' + text.slice(0, 1500))}; })()`;

async function load(engine, mode, query) {
  const s = ENGINES[engine], root = path.resolve(`.qa-profiles/r3-proof-ai-${engine}-${mode}`);
  fs.rmSync(root, {recursive: true, force: true}); fs.mkdirSync(root, {recursive: true});
  const app = await startApp({root});
  try {
    await app.main(({BaseWindow}) => { const win = BaseWindow.getAllWindows()[0]; win.setFocusable(false); win.setSkipTaskbar(true); win.setBounds({x: -20000, y: -20000, width: 1440, height: 900}); win.showInactive(); });
    await app.svc({type: 'filters.profile-set', patch: {aiContent: mode === 'on'}});
    await app.act({type: 'tab.new', url: s.url(query)});
    await sleep(13000);
    const page = app.web(u => { try { return new URL(u).hostname.includes(s.host); } catch { return false; } });
    let state = {error: 'no page'};
    if (page) state = await Promise.race([page.evaluate(STATE(s)), sleep(15000).then(() => ({error: 'timeout'}))]).catch(error => ({error: String(error.message).slice(0, 100)}));
    const png = page ? await capturePage(app, s.host, P.shot(`${engine}-${mode}.png`)) : null;
    let revealed = null;
    if (mode === 'on' && page && state.line?.length) {
      try { await page.locator('[data-acira-filter-control] button').first().click({timeout: 4000}); await sleep(700); revealed = await page.evaluate(STATE(s)); } catch (error) { revealed = {error: String(error.message).slice(0, 80)}; }
    }
    return {state, png, revealed};
  } finally {
    await app.close();
  }
}

await withSlot('proof-live-ai-free', async () => {
  const report = {};
  for (const engine of only) {
    const tried = []; let control = null, query = null;
    for (const q of QUERIES) {
      const off = await load(engine, 'off', q);
      tried.push({query: q, blockVisible: off.state.blockVisible, humanCheck: off.state.humanCheck, error: off.state.error});
      if (off.state.humanCheck) { control = off; query = q; break; }
      if (off.state.blockPresent && off.state.blockVisible) { control = off; query = q; break; }
    }
    report[engine] = {tried};
    if (!control || control.state.humanCheck || !control.state.blockVisible) {
      const why = control?.state.humanCheck ? `${engine} answered with a human check (automated browser, this network), so the real page cannot be proven here` : `${engine} showed no AI answer for ${tried.length} queries with the mode off (control), so there is nothing to hide: ${JSON.stringify(tried)}`;
      P.check(`${engine}: real AI answer present with the mode off (control), hidden with it on`, false, why, control?.png);
      continue;
    }
    let on = await load(engine, 'on', query), attempts = 1;
    // A blank page (no organic results at all) is the engine's own flake on a fresh profile as often as it is a bug: look twice before judging.
    while (attempts < 3 && !on.state.humanCheck && !on.state.error && on.state.organic === 0 && control.state.organic > 0) { on = await load(engine, 'on', query); attempts++; }
    if (attempts > 1) P.note(`${engine}: the mode-on page needed ${attempts} loads (blank results: ${attempts === 3 && on.state.organic === 0 ? 'every time' : 'flake'})`);
    report[engine] = {query, off: control.state, on: on.state, revealed: on.revealed};
    P.check(`${engine}: AI answer hidden with the mode on (it was visible in the control)`, !on.state.humanCheck && on.state.blockVisible === false, `query "${query}": control block visible=${control.state.blockVisible}; on: present=${on.state.blockPresent} visible=${on.state.blockVisible}${on.state.humanCheck ? ' HUMAN CHECK' : ''}`, on.png);
    P.check(`${engine}: quiet "hidden - Show" line and the organic results are there`, on.state.line?.length > 0 && on.state.organic >= 3 && on.state.organic >= Math.min(3, control.state.organic), `line ${JSON.stringify(on.state.line)}, organic results ${on.state.organic} (control ${control.state.organic})`);
    P.check(`${engine}: Show brings the block back`, on.revealed && on.revealed.blockVisible === true, JSON.stringify(on.revealed && {blockVisible: on.revealed.blockVisible, error: on.revealed.error}));
    P.note(`${engine}: "${query}" -> AI block ${control.state.blockVisible ? 'visible' : 'absent'} off, ${on.state.blockVisible ? 'visible' : 'hidden'} on; ${on.state.entryCount ? `entry points ${control.state.entryVisible} -> ${on.state.entryVisible} visible` : 'no entry point on this page'}`);
  }
  fs.writeFileSync(P.shot('report.json'), JSON.stringify(report, null, 2));
});
P.finish();
process.exit(P.checks.every(c => c.ok) && P.checks.length ? 0 : 1);
