// R10 tor-fresh: ONE fresh-profile Tor bootstrap in a built exe, with tor's own log (notice/warn + bootstrap events) captured through a second control-port connection.
//   D_APP_EXE=<AciraBrowser.exe> node qa/native-slot.mjs r10-tor-fresh -- node qa/r10-tor-fresh-run.mjs <label> <capSeconds> <outDir>
// Writes <outDir>/<label>.json (timeline, result) and <label>.log (tor log lines with seconds since the Tor tab opened). Own profile: .qa-profiles/r10-tor-fresh-<label>.
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import {startApp, sleep} from './d-harness.mjs';

const [label, capArg, outArg] = process.argv.slice(2);
const cap = Number(capArg || 260) * 1000, out = path.resolve(outArg || '.qa-profiles/r10-tor-fresh-out');
await fs.mkdir(out, {recursive: true});
const root = path.resolve('.qa-profiles/r10-tor-fresh-' + label);
await fs.rm(root, {recursive: true, force: true});
const result = {label, exe: process.env.D_APP_EXE, timeline: [], ready: null, error: null, final: null};
const lines = [];
let t0 = 0;
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);

async function findControl() {
  const walk = async dir => { let found = null; for (const e of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) { const p = path.join(dir, e.name); if (e.isDirectory()) { found = found || await walk(p); } else if (e.name === 'controlport' && p.includes(path.join('tor', 'run'))) return p; } return found; };
  return walk(root);
}
function tap(portFile) {
  return fs.readFile(portFile, 'latin1').then(async text => {
    const port = Number(/127\.0\.0\.1:(\d+)/.exec(text)?.[1]);
    const cookie = (await fs.readFile(path.join(path.dirname(portFile), 'control_auth_cookie'))).toString('hex');
    const s = net.connect({host: '127.0.0.1', port}); let buf = '';
    s.setEncoding('latin1');
    s.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\r\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 2); if (/^650/.test(l)) lines.push(stamp() + ' ' + l.slice(4)); } });
    s.on('error', () => {});
    s.write(`AUTHENTICATE ${cookie}\r\nSETEVENTS NOTICE WARN ERR STATUS_CLIENT\r\n`);
    return s;
  });
}

const app = await startApp({root});
let tapSock = null;
try {
  const status = () => app.ui.evaluate(() => window.acira.native({type: 'tor.status'}).then(r => r.tor));
  t0 = Date.now();
  await app.act({type: 'tab.new', privacy: 'tor'});
  let last = '', gotTap = false;
  while (Date.now() - t0 < cap) {
    if (!gotTap) { const f = await findControl(); if (f) { try { tapSock = await tap(f); gotTap = true; } catch {} } }
    const s = await status().catch(() => null);
    if (s) {
      const key = `${s.state}|${s.progress}|${s.tag || ''}|${s.error?.code || ''}|${s.blocked ? 'blocked' : ''}|${s.retryInMs || 0}`;
      if (key !== last) { last = key; result.timeline.push({t: +((Date.now() - t0) / 1000).toFixed(1), state: s.state, progress: s.progress, tag: s.tag, summary: s.summary, error: s.error?.code || null, blocked: !!s.blocked, retryInMs: s.retryInMs || 0, firstConnection: s.firstConnection}); }
      result.final = {state: s.state, progress: s.progress, tag: s.tag, error: s.error?.code || null};
      if (s.state === 'ready') { result.ready = +((Date.now() - t0) / 1000).toFixed(1); break; }
    }
    await sleep(1000);
  }
  if (!result.ready) result.final = {...result.final, capped: true, atSeconds: +((Date.now() - t0) / 1000).toFixed(1)};
} catch (e) { result.error = String(e.message).slice(0, 300); }
finally {
  try { tapSock?.destroy(); } catch {}
  await app.close().catch(() => {});
  await fs.writeFile(path.join(out, label + '.json'), JSON.stringify(result, null, 1));
  await fs.writeFile(path.join(out, label + '.log'), lines.join('\n'));
  console.log(`${label}: ${result.ready ? 'READY ' + result.ready + ' s' : 'NOT READY ' + JSON.stringify(result.final)} ${result.error || ''}`);
  await fs.rm(root, {recursive: true, force: true}).catch(() => {});
}
