// Stream N: real-network check of the Tor engine outside Electron (needs internet; not part of npm test).
// node qa/n-tor-engine.mjs → starts bundled tor in a throwaway folder, waits for 100%, asks check.torproject.org through
// socks5h (curl --socks5-hostname), sends NEWNYM, releases the lease and confirms tor.exe exited.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createTorEngine } = require('../desktop/browser-services/tor-engine.cjs');
const userData = mkdtempSync(path.join(tmpdir(), 'acira-tor-qa-'));
const engine = createTorEngine({ userData, log: message => console.log('  log:', message) });
const started = Date.now(), seen = [];
engine.onStatus(s => { const key = `${s.state} ${s.progress}%`; if (seen.at(-1) !== key) { seen.push(key); console.log(`  ${((Date.now() - started) / 1000).toFixed(1)}s ${key} ${s.summary || ''}${s.error ? ' ERROR ' + s.error.code : ''}`); } });
const release = engine.acquire('qa-window');
const ready = await new Promise(resolve => { const off = engine.onStatus(s => { if (s.state === 'ready' || s.state === 'error') { off(); resolve(s); } }); });
let ok = ready.state === 'ready';
if (ok) {
  const check = JSON.parse(execFileSync('curl', ['-s', '--max-time', '60', '--socks5-hostname', `127.0.0.1:${ready.socksPort}`, 'https://check.torproject.org/api/ip'], { encoding: 'utf8' }));
  console.log('check.torproject.org:', JSON.stringify(check));
  ok = check.IsTor === true;
  console.log('NEWNYM:', JSON.stringify(await engine.newIdentity()));
}
await release();
const stillUp = /tor.exe/i.test(execFileSync('tasklist', ['/FI', 'IMAGENAME eq tor.exe', '/NH'], { encoding: 'utf8' }));
console.log('status after release:', engine.status().state, '| leases:', engine.leases());
rmSync(userData, { recursive: true, force: true });
console.log(ok && engine.status().state === 'idle' && !stillUp ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
