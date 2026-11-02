// Round 10: where does closing a tab in HTML fullscreen hang? Times each step with a 6 s cap.
import fs from 'node:fs/promises';
import {startApp, httpFixture, sleep} from './d-harness.mjs';
const root = '.qa-profiles/r10-fullscreen-hang'; await fs.rm(root, {recursive: true, force: true});
const fx = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end('<title>t</title><button id=fs onclick="document.documentElement.requestFullscreen()" style="width:300px;height:200px">go</button>'); });
const base = `http://127.0.0.1:${fx.port}/`, cap = (label, p) => Promise.race([p.then(v => console.log(label, 'ok', JSON.stringify(v)), e => console.log(label, 'ERR', String(e.message).slice(0, 100))), sleep(6000).then(() => console.log(label, 'HUNG >6s'))]);
const app = await startApp({root});
try {
  await app.act({type: 'tab.new', url: base}); const page = await app.waitWeb(base); await sleep(500);
  await page.click('#fs'); await sleep(900);
  const id = (await app.state()).tabs.at(-1).id;
  await cap('close', app.act({type: 'tab.close', id}));
  await cap('state', app.state().then(s => s.tabs.map(t => t.url)));
  await cap('main alive', app.main(({BaseWindow}) => BaseWindow.getAllWindows().map(w => w.isFullScreen())));
} finally { await Promise.race([app.close(), sleep(5000)]); await fx.close(); process.exit(0); }
