// Scratch: why does the Vimium link-hint check see nothing? (REUSE profile ext-vimium)
import http from 'node:http';
import {launch, sleep} from './lib.mjs';
const server = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end('<!doctype html><title>t</title><body><h1>Fixture</h1><div style="height:4000px">tall</div><a href="/x">one</a> <a href="/y">two</a><input id=i>'); });
await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`;
const app = await launch('ext-vimium', {fresh: false});
try {
  await sleep(3000); await app.act({type: 'tab.new', url: base}); const page = await (async () => { for (let i = 0; i < 40; i++) { const p = app.web(base); if (p) return p; await sleep(250); } })();
  await sleep(9000);
  const probe = () => page.evaluate(() => ({focus: document.activeElement?.tagName, nodes: [...document.querySelectorAll('*')].filter(e => /vimium/i.test(e.className + e.id)).length, shadowHosts: [...document.querySelectorAll('*')].filter(e => e.shadowRoot).map(e => e.tagName + '.' + e.className).slice(0, 5), hasExt: !!document.querySelector('[class*=vimium i]')}));
  console.log('before', JSON.stringify(await probe()));
  await page.mouse.click(300, 200); await sleep(300);
  await page.keyboard.press('j'); await sleep(800); console.log('scrollY after j', await page.evaluate(() => scrollY)); for (const key of ['f', '?']) { await page.keyboard.press(key); await sleep(1500); console.log('after', key, JSON.stringify(await probe())); await page.keyboard.press('Escape'); await sleep(500); }
  await page.keyboard.type('f'); await sleep(1500); console.log('after type f', JSON.stringify(await probe()));
  const cdp = await app.context.newCDPSession(page); const worlds = []; cdp.on('Runtime.executionContextCreated', ({context}) => worlds.push(context.origin + ' ' + context.name)); await cdp.send('Runtime.enable'); await sleep(600);
  console.log('worlds', JSON.stringify(worlds.filter(w => w.startsWith('chrome-extension'))));
} finally { await app.close(); server.close(); process.exit(0); }
