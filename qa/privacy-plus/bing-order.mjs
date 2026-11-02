// Is "no results on Bing" caused by the AI filter, or by Bing's second-load human check?  node qa/privacy-plus/bing-order.mjs on,on  (sequence of filter states, same app session)
import fs from 'node:fs/promises';
import {startApp, sleep} from '../d-harness.mjs';
const root = '.qa-profiles/j-bing-order'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const sequence = (process.argv[2] || 'on,on').split(',');
const app = await startApp({root});
try {
  for (const [index, state] of sequence.entries()) {
    await app.svc({type: 'filters.profile-set', patch: {aiContent: state === 'on'}});
    await app.act({type: 'tab.new', url: 'https://www.bing.com/search?q=how+do+solar+panels+work&setlang=en'}); await sleep(12000);
    const page = app.context.pages().filter(p => { try { return new URL(p.url()).hostname.includes('bing'); } catch { return false; } }).at(-1);
    const info = await page.evaluate(() => ({ organic: [...document.querySelectorAll('#b_results > li.b_algo')].filter(e => e.getClientRects().length).length, humanCheck: /verify you are human|one last step/i.test(document.body.innerText), title: document.title, text: document.body.innerText.slice(0, 60).replace(/\n/g, ' ') }));
    console.log(`load ${index + 1} filter=${state}:`, JSON.stringify(info));
  }
} finally { await app.close(); process.exit(0); }
