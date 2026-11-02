// Real bridges, real network: Acira's Tor engine (desktop/browser-services/tor-engine.cjs, the code the app runs) started with each
// built-in bridge type of Tor Browser 15 in turn, from a fresh tor data folder, must bootstrap to 100% through the bundled, pinned
// lyrebird; then a request through tor's SOCKS port reaches check.torproject.org's API, which must say IsTor:true. It also reads
// tor's own view (GETCONF over the control port) to show UseBridges and every Bridge line really reached tor. No Electron is started.
//   node qa/r9-tor-bridges-bootstrap.mjs [obfs4] [snowflake] [meek]     (default: obfs4 snowflake)
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {createTorEngine, connectControl} = require('../desktop/browser-services/tor-engine.cjs');
const {createBridgeSettings} = require('../desktop/browser-services/tor-bridges.cjs');

const kinds = process.argv.slice(2).filter(a => !a.startsWith('-'));
const run = kinds.length ? kinds : ['obfs4', 'snowflake'];
const results = [];
const check = (ok, label) => { results.push([ok, label]); console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); };

/** GET https://host/path through tor's SOCKS5 port (host name sent to tor, nothing resolved here), with SOCKS auth so it gets its own circuit. */
function getThroughTor(port, host, pathname) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({host: '127.0.0.1', port}); let stage = 0, buffer = Buffer.alloc(0);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timed out')); }, 90000);
    socket.on('error', error => { clearTimeout(timer); reject(error); });
    socket.on('connect', () => socket.write(Buffer.from([5, 1, 2])));
    socket.on('data', function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0 && buffer.length >= 2) { buffer = buffer.subarray(2); stage = 1; const u = Buffer.from('r9-bridges'), p = Buffer.from(String(Date.now())); socket.write(Buffer.concat([Buffer.from([1, u.length]), u, Buffer.from([p.length]), p])); }
      if (stage === 1 && buffer.length >= 2) { if (buffer[1] !== 0) return reject(new Error('socks auth refused')); buffer = buffer.subarray(2); stage = 2; const h = Buffer.from(host); socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([1, 187])])); }
      if (stage === 2 && buffer.length >= 10) {
        if (buffer[1] !== 0) { clearTimeout(timer); socket.destroy(); return reject(new Error('socks connect failed, reply ' + buffer[1])); }
        stage = 3; socket.removeListener('data', onData);
        const secure = tls.connect({socket, servername: host}, () => secure.write(`GET ${pathname} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\nUser-Agent: r9\r\n\r\n`));
        let body = ''; secure.on('data', d => { body += d; }); secure.on('end', () => { clearTimeout(timer); resolve(body); }); secure.on('error', error => { clearTimeout(timer); reject(error); });
      }
    });
  });
}

for (const kind of run) {
  const userData = path.resolve(`.qa-profiles/r9-tor-bridges-bootstrap/${kind}-${Date.now()}`);
  fs.mkdirSync(userData, {recursive: true});
  createBridgeSettings({userData}).set({mode: 'builtin', builtin: kind});
  const logs = [];
  const engine = createTorEngine({userData, log: line => logs.push(line), repair: async () => false, isOnline: () => true});
  const seen = []; engine.onStatus(s => { const key = `${s.state} ${s.progress}${s.blocked ? ' blocked' : ''}`; if (seen.at(-1) !== key) { seen.push(key); console.log(`  [${kind}] ${key} ${s.summary || ''}`); } });
  const started = Date.now();
  try {
    const port = await engine.whenReady(660000); // the engine's own bridge limits (10 min) decide first
    const seconds = Math.round((Date.now() - started) / 1000), status = engine.status();
    check(status.state === 'ready' && status.bridges?.type === kind, `${kind}: tor bootstrapped to 100% through built-in ${kind} bridges in ${seconds}s (${JSON.stringify(status.bridges)})`);
    // tor's own configuration, read back over its control port.
    const portFile = fs.readFileSync(path.join(userData, 'tor', 'run', 'controlport'), 'latin1'), cookie = fs.readFileSync(path.join(userData, 'tor', 'run', 'control_auth_cookie')).toString('hex');
    const control = await connectControl(Number(/:(\d+)/.exec(portFile)[1]));
    await control.send('AUTHENTICATE ' + cookie);
    const conf = (await control.send('GETCONF UseBridges Bridge ClientTransportPlugin')).join('\n');
    const bridgeCount = (conf.match(/^Bridge=/gm) || []).length;
    const used = (await control.send('GETINFO entry-guards')).join('\n');
    control.close();
    check(/UseBridges=1/.test(conf) && bridgeCount > 0 && /ClientTransportPlugin=.*lyrebird(?:\.exe)?(?:\s|$)/.test(conf), `${kind}: tor reports UseBridges=1, ${bridgeCount} Bridge lines and the lyrebird plugin`);
    console.log('  entry guards (bridges in use):', used.split('\n').filter(l => /up|down|never/.test(l)).slice(0, 4).join(' | ') || used.slice(0, 200));
    const body = await getThroughTor(port, 'check.torproject.org', '/api/ip');
    const json = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
    check(json.IsTor === true, `${kind}: check.torproject.org/api/ip through it says IsTor=${json.IsTor} (exit ${json.IP})`);
  } catch (error) {
    check(false, `${kind}: ${error.message} (after ${Math.round((Date.now() - started) / 1000)}s; ${JSON.stringify(engine.status().blocked || engine.status().error || null)})`);
    console.log(logs.slice(-12).join('\n'));
  } finally { await engine.stop(); }
}
const failed = results.filter(([ok]) => !ok).length;
console.log(failed ? `FAIL ${failed}/${results.length}` : `PASS ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
