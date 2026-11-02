// Saves a structure-only copy of a real results page as a regression fixture (no scripts, no styles, no third-party text).
//   node qa/privacy-plus/capture-fixture.mjs <name> <url> <host>      -> tests/fixtures/ai-pages/<name>.html  (+ .json with the host)
// Text is replaced by filler of the same length except short labels the rules read; attributes keep tag, id, class, role, aria-*, data-* and trimmed hrefs.
import fs from 'node:fs/promises';
import {startApp, sleep} from '../d-harness.mjs';
const [name, url, host] = process.argv.slice(2);
if (!name || !url || !host) { console.error('usage: capture-fixture.mjs <name> <url> <host>'); process.exit(2); }
const root = '.qa-profiles/j-capture'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const SANITIZE = `(() => {
  const keepText = new Set(['ai overview','ai mode','copilot search','ask','search assist','duck.ai','übersicht mit ki','ki-modus']);
  const clone = document.documentElement.cloneNode(true);
  for (const el of [...clone.querySelectorAll('script,noscript,style,link,iframe,object,embed,video,audio,source,template,meta:not([charset]),base')]) el.remove();
  for (const svg of clone.querySelectorAll('svg')) svg.replaceChildren();
  const filler = text => text.replace(/\\S/g, 'x');
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
  for (const node of texts) { const trimmed = node.textContent.trim().toLowerCase().replace(/\\s+/g, ' '); node.textContent = keepText.has(trimmed) ? node.textContent : filler(node.textContent); }
  for (const el of clone.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const n = attr.name;
      if (n === 'class' || n === 'id' || n === 'role' || n === 'type' || n === 'lang' || n === 'dir' || n === 'charset' || n.startsWith('aria-')) { if (n.startsWith('aria-') && n !== 'aria-level' && n !== 'aria-label' && n !== 'aria-controls' && n !== 'aria-expanded' && n !== 'aria-current') el.removeAttribute(n); else if (n === 'aria-label') el.setAttribute(n, keepText.has(attr.value.trim().toLowerCase()) || /^(ask|more info about ai summary|copilot search branding|expand duck\\.ai chat input|learn more about search assist|change search assist settings)/i.test(attr.value) ? attr.value : filler(attr.value)); continue; }
      if (n === 'href') { el.setAttribute('href', attr.value.slice(0, 160)); continue; }
      if (n.startsWith('data-') && attr.value.length <= 40) { el.setAttribute(n, attr.value); continue; }
      el.removeAttribute(n);
    }
  }
  return '<!doctype html>' + clone.outerHTML;
})()`;
const app = await startApp({root});
try {
  await app.act({type: 'tab.new', url}); await sleep(13000);
  const key = host.replace(/^www\./, '').split('.').slice(-2, -1)[0];
  const page = app.context.pages().filter(p => { try { return new URL(p.url()).hostname.includes(key); } catch { return false; } }).at(-1);
  if (!page) throw new Error('no page for ' + host);
  const html = await page.evaluate(SANITIZE);
  await fs.mkdir('tests/fixtures/ai-pages', {recursive: true});
  await fs.writeFile(`tests/fixtures/ai-pages/${name}.html`, html);
  console.log(name, 'bytes', html.length, 'title', await page.title());
} finally { await app.close(); process.exit(0); }
