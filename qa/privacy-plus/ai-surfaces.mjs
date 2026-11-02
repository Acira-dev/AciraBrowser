// Stream J: AI answers hidden on real search pages, in the real isolated app (default settings).  node qa/privacy-plus/ai-surfaces.mjs [bing,brave,ddg,google]
// Per site: AI filter off (control) -> the AI block is there; on (default) -> hidden with a "hidden · Show" line, organic results intact, Show reveals, site switch works.
import fs from 'node:fs/promises';
import {startApp, sleep} from '../d-harness.mjs';
const root = '.qa-profiles/j-ai-surfaces'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const Q = (process.argv.find(a => a.startsWith('--q=')) || '--q=how+do+solar+panels+work').slice(4);
const SITES = {
  bing: {url: `https://www.bing.com/search?q=${Q}&setlang=en`, host: 'bing', block: '#copans_container', unit: 'li.b_ans', entry: '#b-scopeListItem-copilotsearch', organic: '#b_results .b_algo'},
  brave: {url: `https://search.brave.com/search?q=${Q}`, host: 'brave', block: '#llm-snippet', unit: '#llm-snippet', entry: '#submit-llm-button', organic: '#mixed-main .snippet'},
  ddg: {url: 'https://duckduckgo.com/?q=what+is+photosynthesis&ia=web', host: 'duckduckgo', block: 'section[data-testid="mainline"] [data-assist-icon-trigger]', unit: 'section[data-testid="mainline"] > ol > li', entry: '#react-ai-button-slot', organic: 'article[data-testid="result"]'},
  google: {url: `https://www.google.com/search?q=${Q}&hl=en`, host: 'google', block: '[role=heading]', unit: null, entry: 'a[href*="udm=50"]', organic: 'a h3'}
};
const names = process.argv[2] ? process.argv[2].split(',') : ['bing', 'brave'];
const STATE = s => `(() => { const vis = el => !!el && el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== 'none';
  const block = document.querySelector(${JSON.stringify(s.block)}); const unit = block && ${JSON.stringify(s.unit)} ? block.closest(${JSON.stringify(s.unit)}) : block;
  const entries = [...document.querySelectorAll(${JSON.stringify(s.entry)})];
  const line = [...document.querySelectorAll('[data-acira-filter-control]')].map(n => n.innerText.trim()).filter(t => /hidden/.test(t));
  return {blockPresent: !!block, blockVisible: vis(block) && vis(unit), entryCount: entries.length, entryVisible: entries.filter(vis).length, line, organic: [...document.querySelectorAll(${JSON.stringify(s.organic)})].filter(vis).length, title: document.title}; })()`;
const app = await startApp({root});
const report = [];
try {
  for (const name of names) {
    const s = SITES[name];
    const open = async label => { await app.act({type: 'tab.new', url: s.url}); await sleep(12000); const pages = app.context.pages().filter(p => { try { return new URL(p.url()).hostname.includes(s.host); } catch { return false; } }); const page = pages.at(-1); const state = page ? await Promise.race([page.evaluate(STATE(s)), sleep(15000).then(() => ({error: 'timeout'}))]).catch(error => ({error: String(error.message).slice(0, 80)})) : {error: 'no page'}; if (page) await page.screenshot({path: `.scratch-src/out/ai/${name}-${label}.png`, timeout: 8000}).catch(() => {}); return {page, state}; };
    await fs.mkdir('.scratch-src/out/ai', {recursive: true});
    // Some engines (Bing) challenge a second load in one session, so --on-first runs the default-on page before the control.
    let off, on;
    const runOff = async () => { await app.svc({type: 'filters.profile-set', patch: {aiContent: false}}); off = await open('off'); };
    const runOn = async () => { await app.svc({type: 'filters.profile-set', patch: {aiContent: true}}); on = await open('on'); };
    if (process.argv.includes('--on-only')) { await runOn(); off = {state: null}; } else if (process.argv.includes('--off-only')) { await runOff(); on = {state: null}; } else if (process.argv.includes('--on-first')) { await runOn(); await runOff(); } else { await runOff(); await runOn(); }
    let revealed = null;
    if (on.page && on.state.line && on.state.line.length) { try { await on.page.locator('[data-acira-filter-control] button').first().click({timeout: 4000}); await sleep(600); revealed = await on.page.evaluate(STATE(s)); } catch (error) { revealed = {error: String(error.message).slice(0, 80)}; } }
    report.push({name, off: off.state, on: on.state, revealed});
    console.log(name.padEnd(8), 'OFF', JSON.stringify(off.state), '\n         ON ', JSON.stringify(on.state), '\n         SHOW', JSON.stringify(revealed));
  }
  await fs.writeFile('.scratch-src/out/ai-surfaces.json', JSON.stringify(report, null, 1));
} finally { await app.close(); process.exit(0); }
