// Stream D: a manual HTTP proxy really carries a profile's traffic, and a proxy that answers 407 asks for a sign-in that is used and not stored.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import {startApp, httpFixture, sleep, poll} from './d-harness.mjs';
const root = '.qa-profiles/d-proxy'; await fs.rm(root, {recursive: true, force: true});
const report = [], seen = [];
let needAuth = false;
const origin = await httpFixture((req, res) => { res.setHeader('content-type', 'text/html'); res.end(`<title>via proxy: ${req.headers.host}</title>ok`); });
// A minimal forward proxy: absolute-URI requests are answered from the origin fixture whatever host the browser asked for.
const proxy = http.createServer((req, res) => {
  seen.push({url: req.url, auth: req.headers['proxy-authorization'] || ''});
  if (needAuth && req.headers['proxy-authorization'] !== 'Basic ' + Buffer.from('proxyuser:proxypass').toString('base64')) { res.writeHead(407, {'Proxy-Authenticate': 'Basic realm="acira-test"', 'content-type': 'text/plain', 'Connection': 'close'}); return res.end('proxy sign-in needed'); }
  const upstream = http.request({host: '127.0.0.1', port: origin.port, path: new URL(req.url).pathname, method: req.method, headers: {host: new URL(req.url).host}}, up => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
  upstream.on('error', () => res.destroy()); req.pipe(upstream);
});
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
const app = await startApp({root});
const tabByHost = async host => (await app.state()).tabs.find(t => t.url.includes(host));
try {
  await app.main(({dialog}) => { dialog.showMessageBox = async () => ({response: 1, checkboxChecked: false}); });
  const set = await app.svc({type: 'proxy.set', choice: {mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: proxy.address().port}, bypassHosts: []}});
  assert.equal(set.proxy.applied, true); assert.equal(set.proxy.authenticationSupported, true); report.push('manual HTTP proxy applied to the profile');
  // 1. Traffic for a name that only the proxy can resolve loads through it.
  await app.act({type: 'tab.new', url: 'http://plain.proxied.test/hello'}); await poll(async () => (await tabByHost('plain.proxied.test'))?.title, t => /via proxy: plain\.proxied\.test/.test(t), 'page loaded through the proxy', 20000);
  assert.ok(seen.some(r => r.url.startsWith('http://plain.proxied.test/hello')), 'the proxy saw the request'); report.push('a name only the proxy can resolve loads, and the proxy log shows the request');
  // 2a. Cancel closes the sign-in and leaves an error page instead of looping.
  needAuth = true;
  await app.act({type: 'tab.new', url: 'http://cancel.proxied.test/'});
  await app.ui.getByText('Sign in to this proxy').waitFor({timeout: 20000}); await app.ui.getByRole('button', {name: 'Cancel'}).click();
  await poll(() => app.ui.getByText('Sign in to this proxy').count(), n => n === 0, 'dialog closes', 10000); report.push('Cancel closes the sign-in');
  // 2. A proxy that wants a sign-in asks for it; wrong details are refused and asked again; right details load the page.
  needAuth = true; seen.length = 0;
  await app.act({type: 'tab.new', url: 'http://signin.proxied.test/'});
  const heading = app.ui.getByText('Sign in to this proxy'); await heading.waitFor({timeout: 20000}); report.push('a 407 from the proxy opens "Sign in to this proxy"');
  assert.ok(await app.ui.getByText(/not saved by Acira/i).count() > 0, 'says the details are not saved');
  await app.ui.getByLabel('Username').fill('proxyuser'); await app.ui.getByLabel('Password').fill('wrong'); await app.ui.getByRole('button', {name: 'Sign in', exact: true}).click();
  await poll(() => app.ui.getByText(/did not accept the previous details/i).count(), n => n > 0, 'asked again after wrong details', 20000); report.push('wrong details are refused and the sign-in is asked again');
  await app.ui.getByLabel('Username').fill('proxyuser'); await app.ui.getByLabel('Password').fill('proxypass'); await app.ui.getByRole('button', {name: 'Sign in', exact: true}).click();
  await poll(async () => (await tabByHost('signin.proxied.test'))?.title, t => /via proxy: signin\.proxied\.test/.test(t), 'page loads after signing in', 20000); report.push('right details load the page');
  assert.ok(seen.some(r => r.auth === 'Basic ' + Buffer.from('proxyuser:proxypass').toString('base64')), 'the proxy received the details');
  // 3. Nothing is written to disk.
  await sleep(1500); const files = (await fs.readdir(root, {recursive: true})).filter(f => !/(Cache|GPUCache|Code Cache|Dawn|Shader)/i.test(String(f)));
  for (const file of files) { const full = `${root}/${file}`; const stat = await fs.stat(full).catch(() => null); if (!stat?.isFile() || stat.size > 20_000_000) continue; const bytes = await fs.readFile(full).catch(() => Buffer.alloc(0)); assert.ok(!bytes.includes(Buffer.from('proxypass')), `password not written to ${file}`); }
  report.push('the proxy password is not found in any profile file');
  // 4. The profile's proxy sign-in is remembered for the session only: another tab loads without asking again.
  seen.length = 0; await app.act({type: 'tab.new', url: 'http://again.proxied.test/'});
  await poll(async () => (await tabByHost('again.proxied.test'))?.title, t => /via proxy: again.proxied.test/.test(t), 'second tab loads without a prompt', 20000);
  assert.equal(await app.ui.getByText('Sign in to this proxy').count(), 0); report.push('a second tab in the profile reuses the sign-in without asking again');
  console.log(JSON.stringify({ok: true, report}, null, 1));
} catch (error) {
  console.log('SEEN', JSON.stringify(seen.slice(-6))); console.log('TABS', JSON.stringify((await app.state()).tabs.map(t => [t.url, t.title, t.error, t.loading]))); console.log('DIALOG', JSON.stringify(await app.ui.evaluate(() => document.querySelector('.website-auth-dialog, [role=dialog]')?.innerText || 'none')));
  throw error;
} finally { await app.close(); proxy.close(); await origin.close(); }
