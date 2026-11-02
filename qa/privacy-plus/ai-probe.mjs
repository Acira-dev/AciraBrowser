// Stream J: where do AI answers live in each search engine's DOM?  node qa/privacy-plus/ai-probe.mjs [name,name]   (real app, isolated profile, AI filter off)
import fs from 'node:fs/promises';
import {startApp, sleep} from '../d-harness.mjs';
const root = '.qa-profiles/j-ai-probe'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const Q = 'how+do+solar+panels+work';
const TARGETS = {
  'google-search': `https://www.google.com/search?q=${Q}&hl=en`,
  'google-home': 'https://www.google.com/?hl=en',
  'bing-search': `https://www.bing.com/search?q=${Q}&setlang=en`,
  'bing-home': 'https://www.bing.com/?setlang=en',
  'ddg-search': `https://duckduckgo.com/?q=why+is+the+sky+blue&ia=web`,
  'ddg-home': 'https://duckduckgo.com/',
  'brave-search': `https://search.brave.com/search?q=${Q}`,
  'youtube-watch': 'https://www.youtube.com/watch?v=aqz-KE-bpKQ',
  'yahoo-search': `https://search.yahoo.com/search?p=${Q}`,
  'ecosia-search': `https://www.ecosia.org/search?q=${Q}`,
  'amazon-home': 'https://www.amazon.com/',
  'reddit-search': `https://www.reddit.com/search/?q=${Q}`,
};
const names = (process.argv[2] ? process.argv[2].split(',') : Object.keys(TARGETS));
const LOCATE = `(() => {
  const re = /(AI Overview|AI Mode|AI-generated|AI generated|AI answer|AI summar|Copilot|DuckAssist|Duck\\.ai|\\bAssist\\b|Ask Brave|\\bAsk\\b|Summar|Rufus|Search Assist|Gemini|Perplexity|Quick answer|Reddit Answers|\\bAnswers\\b|Deep Search|Think Deeper|Smart answer|Overview)/i;
  const attrs = el => [...el.attributes].filter(a => !/^(class|style|id|href|src|d|viewBox|xmlns|fill|width|height)$/.test(a.name) && a.name.length < 40).slice(0, 6).map(a => a.name + '=' + String(a.value).slice(0, 28)).join(' ');
  const d = el => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].slice(0, 3).join('.') : '') + (attrs(el) ? ' {' + attrs(el) + '}' : '');
  const out = [], seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  while (walker.nextNode() && out.length < 40) {
    const el = walker.currentNode; if (el.children.length > 4 || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'PATH', 'SVG'].includes(el.tagName.toUpperCase())) continue;
    const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
    const text = (own + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.getAttribute('alt') || '')).trim();
    if (!text || text.length > 140 || !re.test(text)) continue;
    const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
    const chain = []; let p = el; for (let i = 0; i < 6 && p && p !== document.body; i++) { chain.push(d(p)); p = p.parentElement; }
    const key = chain.slice(0, 3).join('>'); if (seen.has(key)) continue; seen.add(key);
    out.push({text: text.slice(0, 80), href: el.closest('a') ? el.closest('a').getAttribute('href') : undefined, rect: [r.left | 0, r.top | 0, r.width | 0, r.height | 0], chain});
  }
  return {url: location.href, title: document.title, hits: out};
})()`;
const app = await startApp({root});
const results = {};
try {
  await app.svc({type: 'filters.profile-set', patch: {aiContent: false}});
  for (const name of names) {
    await app.act({type: 'tab.new', url: TARGETS[name]}); await sleep(9000);
    const host = new URL(TARGETS[name]).hostname.replace(/^www\./, '').split('.').slice(-2, -1)[0];
    const page = app.web(url => { try { return new URL(url).hostname.includes(host); } catch { return false; } });
    let data = {error: 'no page'};
    if (page) { try { data = await Promise.race([page.evaluate(LOCATE), sleep(20000).then(() => ({error: 'timeout'}))]); await fs.mkdir('.scratch-src/out/ai', {recursive: true}); await page.screenshot({path: `.scratch-src/out/ai/${name}.png`, timeout: 8000}).catch(() => {}); } catch (error) { data = {error: String(error.message).slice(0, 100)}; } }
    results[name] = data; console.log('==', name, data.error || `${data.title} | ${data.url} | ${data.hits.length} hits`);
    const state = await app.state(); const tab = state.tabs.at(-1); if (tab) await app.act({type: 'tab.close', tabId: tab.id}).catch(() => {});
  }
  await fs.mkdir('.scratch-src/out', {recursive: true}); await fs.writeFile('.scratch-src/out/ai-probe.json', JSON.stringify(results, null, 1));
} finally { await app.close(); process.exit(0); }
