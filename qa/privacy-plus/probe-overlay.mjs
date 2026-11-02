// What is still on top after banner hiding?  node qa/privacy-plus/probe-overlay.mjs host[,host]
import fs from 'node:fs/promises';
import {startApp, sleep, poll} from '../d-harness.mjs';
const root = '.qa-profiles/j-probe'; await fs.rm(root, {recursive: true, force: true}); await fs.mkdir(root, {recursive: true});
const app = await startApp({root});
const JS = `(() => { const d = el => el ? (el.tagName + (el.id ? '#' + el.id : '') + (el.className && el.className.toString ? '.' + el.className.toString().split(' ').filter(Boolean).slice(0, 3).join('.') : '')) : null;
 const big = [...document.querySelectorAll('body *')].filter(el => { const cs = getComputedStyle(el), r = el.getBoundingClientRect(); return ['fixed', 'absolute'].includes(cs.position) && cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > innerWidth * .8 && r.height > innerHeight * .6; }).map(el => d(el) + ' z=' + getComputedStyle(el).zIndex + ' bg=' + getComputedStyle(el).backgroundColor + ' text=' + (el.innerText || '').length).slice(0, 6);
 return {stack: document.elementsFromPoint(innerWidth / 2, innerHeight / 2).slice(0, 4).map(d), big, html: getComputedStyle(document.documentElement).overflow + '/' + document.documentElement.className.slice(0, 80), body: getComputedStyle(document.body).overflow + '/' + getComputedStyle(document.body).position + '/' + document.body.className.slice(0, 80)}; })()`;
try {
  for (const host of (process.argv[2] || 'elpais.com,www.marca.com').split(',')) {
    await app.svc({type: 'filters.profile-set', patch: {annoyances: true}});
    await app.act({type: 'tab.new', url: `https://${host}/`}); await sleep(11000);
    const key = host.replace(/^www\./, '').split('.')[0];
    const page = app.web(url => { try { return new URL(url).hostname.includes(key); } catch { return false; } });
    console.log(host, JSON.stringify(page ? await page.evaluate(JS) : 'no page'));
  }
} finally { await app.close(); process.exit(0); }
