// Prints the structure of Google's Chrome promo on google.com/ncr (isolated profile). node qa/ua-google-dom.mjs
import './live-google-gate.mjs'; import { startApp } from './d-harness.mjs';
const app = await startApp({ root: `.qa-profiles/ua-google-dom-${Date.now()}` });
try {
  await app.act({ type: 'tab.new', url: 'https://www.google.com/ncr' });
  const page = await app.waitWeb(u => u.startsWith('https://www.google.com/'), 'google');
  await page.waitForLoadState('domcontentloaded').catch(() => {}); await new Promise(r => setTimeout(r, 6000));
  console.log(JSON.stringify(await page.evaluate(() => {
    const hit = [...document.querySelectorAll('button,a,div,span')].find(e => e.children.length === 0 && /Download Chrome/i.test(e.textContent));
    const chain = []; for (let e = hit; e && e !== document.body; e = e.parentElement) chain.push(e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + [...e.classList].map(c => '.' + c).join('') + [...e.attributes].filter(a => !['id', 'class', 'style'].includes(a.name)).map(a => `[${a.name}="${a.value.slice(0, 40)}"]`).join(''));
    const iframes = [...document.querySelectorAll('iframe')].map(f => f.src.slice(0, 120));
    return { chain, iframes };
  }), null, 1));
} finally { await app.close(); }
