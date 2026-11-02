// A real onion service for QA, protected by client authorization: a second tor.exe (the pinned one) hosts it with ADD_ONION ... Flags=V3Auth ClientAuthV3=<public key>,
// pointing at a tiny local HTTP server. The client key pair is generated here, in memory, for this run only; nothing is a real secret and nothing leaves this machine except
// the service's own descriptor on the Tor network. The second tor dies with this process (__OwningControllerProcess) and with close().
import fs from 'node:fs/promises';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {sleep} from './d-harness.mjs';

const require = createRequire(import.meta.url);
export const base32 = buffer => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0, out = ''; for (const b of buffer) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += A[(value << (5 - bits)) & 31]; return out; };
/** A fresh x25519 key pair as raw 32-byte buffers. */
export function clientKeys() {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('x25519');
  return {secret: privateKey.export({format: 'der', type: 'pkcs8'}).subarray(-32), pub: publicKey.export({format: 'der', type: 'spki'}).subarray(-32)};
}
function control(port, cookie) {
  const socket = net.connect({host: '127.0.0.1', port}); socket.setEncoding('latin1'); socket.unref?.();
  let buffer = '', waiting = null; const events = [], listeners = [];
  socket.on('data', chunk => {
    buffer += chunk; let at;
    while ((at = buffer.indexOf('\r\n')) >= 0) {
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 2);
      if (/^650[ -]/.test(line)) { events.push(line.slice(4)); for (const fn of listeners) fn(line.slice(4)); continue; }
      if (waiting) { waiting.lines.push(line); if (/^\d{3} /.test(line)) { const done = waiting; waiting = null; done.resolve(done.lines); } }
    }
  });
  const send = command => new Promise((resolve, reject) => { waiting = {lines: [], resolve, reject}; socket.write(command + '\r\n'); });
  return new Promise((resolve, reject) => { socket.once('error', reject); socket.once('connect', async () => { await send('AUTHENTICATE ' + cookie); resolve({send, events, onEvent: fn => listeners.push(fn), close: () => socket.destroy()}); }); });
}
/** Starts the fixture and waits until the service's descriptor is on the HSDirs. Resolves to {id, address, secretBase32, secretBase64, close(), hits()}. */
export async function startAuthOnion({root, timeoutMs = 300000} = {}) {
  const {torExecutable} = require('../desktop/browser-services/tor-engine.cjs'), exe = torExecutable();
  if (!exe) throw new Error('tor.exe is missing (node scripts/fetch-tor.mjs)');
  await fs.mkdir(root, {recursive: true});
  const run = path.join(root, 'run'); await fs.rm(run, {recursive: true, force: true}); await fs.mkdir(run, {recursive: true});
  let hits = 0;
  const server = http.createServer((req, res) => { hits++; res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>auth onion</title><body><p id=ok>acira-onion-auth-ok</p>'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const args = ['--ignore-missing-torrc', '-f', path.join(run, 'torrc-none'), '--defaults-torrc', path.join(run, 'torrc-defaults-none'), '--DataDirectory', path.join(root, 'data'), '--ClientOnly', '1', '--SocksPort', '0',
    '--ControlPort', '127.0.0.1:auto', '--ControlPortWriteToFile', path.join(run, 'controlport'), '--CookieAuthentication', '1', '--CookieAuthFile', path.join(run, 'cookie'), '--__OwningControllerProcess', String(process.pid), '--Log', 'notice stdout'];
  const child = spawn(exe, args, {cwd: path.dirname(exe), windowsHide: true, stdio: 'ignore'});
  const stop = async () => { try { child.kill(); } catch {} await new Promise(resolve => server.close(resolve)); };
  try {
    const end = Date.now() + timeoutMs; let port = 0;
    while (!port && Date.now() < end) { try { port = Number(/:(\d+)/.exec(await fs.readFile(path.join(run, 'controlport'), 'utf8'))?.[1]) || 0; } catch {} if (!port) await sleep(300); }
    if (!port) throw new Error('the fixture tor did not open its control port');
    const cookie = (await fs.readFile(path.join(run, 'cookie'))).toString('hex'), tor = await control(port, cookie);
    await tor.send('SETEVENTS HS_DESC');
    for (;;) { const phase = (await tor.send('GETINFO status/bootstrap-phase')).join(' '); if (/PROGRESS=100/.test(phase)) break; if (Date.now() > end) throw new Error('the fixture tor did not bootstrap: ' + phase); await sleep(2000); }
    const keys = clientKeys();
    const reply = await tor.send(`ADD_ONION NEW:ED25519-V3 Flags=V3Auth Port=80,127.0.0.1:${server.address().port} ClientAuthV3=${base32(keys.pub)}`);
    const id = /ServiceID=([a-z2-7]{56})/.exec(reply.join('\n'))?.[1];
    if (!id) throw new Error('ADD_ONION failed: ' + reply.join(' | '));
    // The descriptor reaches the HSDirs a few seconds later; two uploads are enough for a client to find it.
    const uploaded = () => new Set(tor.events.map(line => /^HS_DESC UPLOADED (\S+) \S+ (\S+)/.exec(line)).filter(m => m && m[1] === id).map(m => m[2])).size;
    while (uploaded() < 2 && Date.now() < end) await sleep(1000);
    if (uploaded() < 2) throw new Error('the onion descriptor was not uploaded in time');
    return {id, address: `${id}.onion`, secret: keys.secret, secretBase32: base32(keys.secret), secretBase64: keys.secret.toString('base64'), hits: () => hits, close: stop};
  } catch (error) { await stop(); throw error; }
}
