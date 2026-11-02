// Real app, local fake proxy only: the proxy Test button, and WebRTC following the proxy (disable_non_proxied_udp while a manual proxy is on, back to the default after).
//   node qa/privacy-plus/webrtc-proxy-app.mjs        One instance, two tabs at most, closed in finally.
import fs from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import {sleep} from '../d-harness.mjs';
import {launch} from '../extension-matrix/lib.mjs'; // answers the native confirmation like a person clicking "Use this proxy"
const proxy = net.createServer(socket => { socket.on('error', () => {}); socket.once('data', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')); });
await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve)); const proxyPort = proxy.address().port;
const site = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end('<!doctype html><title>fixture</title><body>fixture'); });
await new Promise(resolve => site.listen(0, '127.0.0.1', resolve)); const sitePort = site.address().port;
const app = await launch('j-webrtc-proxy'); const out = {};
const policy = () => app.main(({webContents}, port) => webContents.getAllWebContents().filter(w => w.getURL().includes(':' + port)).map(w => w.getWebRTCIPHandlingPolicy()), sitePort);
const confirm = async () => { for (let i = 0; i < 40; i++) { for (const page of app.context.pages()) { try { const button = page.getByRole('button', {name: /Use this proxy/}); if (await button.count()) { await button.first().click({timeout: 2000}); return true; } } catch {} } await sleep(250); } return false; };
try {
  await sleep(2000);
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${sitePort}/`}); await sleep(3500);
  out.before = await policy();
  out.testGood = (await app.svc({type: 'proxy.test', choice: {mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: proxyPort}}})).proxy.test;
  out.testRefused = (await app.svc({type: 'proxy.test', choice: {mode: 'fixed_servers', server: {scheme: 'socks5', host: '127.0.0.1', port: 1}}})).proxy.test;
  const setting = app.svc({type: 'proxy.set', choice: {mode: 'fixed_servers', server: {scheme: 'http', host: '127.0.0.1', port: proxyPort}, bypassHosts: []}});
  out.confirmed = await confirm(); out.set = (await setting).proxy.choice; await sleep(500);
  out.withProxyExistingTab = await policy();
  await app.act({type: 'tab.new', url: `http://127.0.0.1:${sitePort}/?second`}); await sleep(3000); out.withProxyBothTabs = await policy();
  const reverting = app.svc({type: 'proxy.set', choice: {mode: 'system'}}); out.confirmedBack = await confirm(); await reverting; await sleep(500);
  out.afterSystem = await policy();
} catch (error) { out.error = String(error.stack || error).slice(0, 500); }
finally { await fs.mkdir('qa/artifacts', {recursive: true}); await fs.writeFile('qa/artifacts/webrtc-proxy-app.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1)); await app.close(); proxy.close(); site.close(); process.exit(0); }
