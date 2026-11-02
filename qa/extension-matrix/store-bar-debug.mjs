// Scratch: what does the main process answer the store bar, and does the bar appear? (ACIRA_STORE_BAR_DEBUG=1 prints each answer.)
import {launch, sleep} from './lib.mjs';
const id = 'eimadpbcbfnmbkopoojfekhnkhdbieeh', url = `https://chromewebstore.google.com/detail/dark-reader/${id}`;
const app = await launch('ext-store-bar-debug', {env: {ACIRA_STORE_BAR_DEBUG: '1'}});
const READ = `(() => { const h = document.getElementById('acira-store-bar'); return h ? {button: h.shadowRoot.querySelector('button').textContent, note: h.shadowRoot.querySelector('.note').textContent} : null; })()`;
const answers = () => app.logs.join('').split(String.fromCharCode(10)).filter(line => line.includes('[store-bar]')).slice(-6).join(' | ');
try {
  await app.act({type: 'tab.new', url});
  let page; for (let i = 0; i < 200 && !page; i++) { page = app.web(u => u.startsWith('https://chromewebstore.google.com/')); await sleep(300); }
  let bar = null; for (let i = 0; i < 30 && !bar; i++) { await sleep(1000); bar = await page.evaluate(READ); }
  console.log('first load bar:', JSON.stringify(bar), 'answers:', answers());
  if (bar) {
    await page.evaluate(() => document.getElementById('acira-store-bar').shadowRoot.querySelector('button').click());
    for (let i = 0; i < 90; i++) { await sleep(1000); const s = await page.evaluate(READ); if (s && s.button !== 'Adding…') break; }
    console.log('installed', JSON.stringify((await app.ext({type: 'list'})).extensions.map(e => [e.name, e.status])));
    await page.reload();
    for (let i = 0; i < 10; i++) { await sleep(2500); console.log(i, JSON.stringify(await page.evaluate(() => ({bar: !!document.getElementById('acira-store-bar'), darkreader: !!document.querySelector('style.darkreader'), ready: document.readyState})).catch(e => String(e)))); }
    console.log('answers after reload:', answers());
  }
} catch (error) { console.log('ERROR', String(error.stack || error).slice(0, 400), 'answers:', answers()); } finally { await app.close(); process.exit(0); }
