// Live check of the "Add to Acira" bar on a real Chrome Web Store detail page, in an isolated profile.   node qa/extension-matrix/store-bar-live.mjs [id]
// Opens the detail page, reads the bar, clicks it (the native review dialog is answered by the harness like a person clicking "Load extension"),
// and checks the extension is installed and the bar says so after a reload. Screenshots go to qa/artifacts/ext-matrix/.
import fs from 'node:fs/promises';
import {launch, sleep} from './lib.mjs';
const id = process.argv[2] || 'eimadpbcbfnmbkopoojfekhnkhdbieeh'; // Dark Reader
const url = `https://chromewebstore.google.com/detail/dark-reader/${id}`;
const READ = `(() => { const host = document.getElementById('acira-store-bar'); if (!host) return {visible: false}; const root = host.shadowRoot, button = root.querySelector('button'); const rect = host.shadowRoot.querySelector('.bar').getBoundingClientRect();
  return {visible: true, name: root.querySelector('.name').textContent, note: root.querySelector('.note').textContent, button: button.textContent, disabled: button.disabled, rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)]}; })()`;
const app = await launch('ext-store-bar');
const out = {url};
try {
  await fs.mkdir('qa/artifacts/ext-matrix', {recursive: true});
  await app.act({type: 'tab.new', url}); const find = async () => { for (let i = 0; i < 80; i++) { const page = app.web(u => u.startsWith('https://chromewebstore.google.com/')); if (page) return page; await sleep(300); } };
  let page = await find(); if (!page) throw new Error('store page did not open'); for (let i = 0; i < 40; i++) { await sleep(1000); out.initial = await page.evaluate(READ).catch(() => ({visible: false})); if (out.initial.visible) break; }
  out.title = await page.title();
  await page.screenshot({path: 'qa/artifacts/ext-matrix/store-bar-1-initial.png'});
  out.storeButtonDisabled = await page.evaluate(() => { const button = [...document.querySelectorAll('button')].find(b => /add to chrome/i.test(b.innerText)); return button ? {text: button.innerText.trim(), disabled: button.disabled || button.getAttribute('aria-disabled')} : null; });
  if (out.initial.visible) {
    await page.evaluate(() => document.getElementById('acira-store-bar').shadowRoot.querySelector('button').click()); await sleep(600);
    out.adding = await page.evaluate(READ);
    for (let i = 0; i < 60; i++) { const state = await page.evaluate(READ); if (state.button !== 'Adding…') { out.after = state; break; } await sleep(1000); }
    await page.screenshot({path: 'qa/artifacts/ext-matrix/store-bar-2-after.png'});
    out.installed = (await app.ext({type: 'list'})).extensions.map(e => ({id: e.id, name: e.name, status: e.status}));
    out.review = (await app.reviews()).at(-1);
    await page.reload(); for (let i = 0; i < 25; i++) { await sleep(1000); out.afterReload = await page.evaluate(READ).catch(error => ({error: String(error.message || error)})); if (out.afterReload.visible) break; } out.afterReloadSeconds = 'polled';
  }
} catch (error) { out.error = String(error.message || error); }
finally { await fs.writeFile('qa/artifacts/ext-matrix/store-bar-live.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1).slice(0, 2500)); await app.close(); process.exit(0); }
