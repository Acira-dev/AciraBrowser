'use strict';
// Onion client authorization: tor's ExtendedErrors 0xF4 / 0xF5 reach the tab as "needs a key" / "wrong key", the key the person pastes is parsed from the formats onion keys come in,
// goes to tor with ONION_CLIENT_AUTH_ADD for the site the tab shows (never an address from the request), is kept in memory only and given to tor again if it restarts.
const test = require('node:test'), assert = require('node:assert/strict'), net = require('node:net'), crypto = require('node:crypto');
const {createTorWindows, onionAuthKey, onionService} = require('../desktop/browser-services/tor-window.cjs');
const {parseConnect} = require('../desktop/browser-services/tor-isolation.cjs');

const ID = '2gzyxa5ihm7nsggfxnu52rck2vv4rvmdlkiu3zzui5du4xyclen53wid';
const base32 = buffer => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0, out = ''; for (const b of buffer) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += A[(value >>> (bits - 5)) & 31]; bits -= 5; } } if (bits > 0) out += A[(value << (5 - bits)) & 31]; return out; };
const secret = () => crypto.generateKeyPairSync('x25519').privateKey.export({format: 'der', type: 'pkcs8'}).subarray(-32);

test('the key is accepted as the 52 letters and digits, a whole .auth_private line, or x25519 base64; anything else is refused', () => {
  const raw = secret(), b64 = raw.toString('base64');
  assert.equal(onionAuthKey(base32(raw)), b64);
  assert.equal(onionAuthKey(base32(raw).toLowerCase()), b64, 'case does not matter');
  assert.equal(onionAuthKey(`${ID}:descriptor:x25519:${base32(raw)}`), b64);
  assert.equal(onionAuthKey(`x25519:${b64}`), b64);
  assert.equal(onionAuthKey(`  ${b64}  `), b64, 'spaces around it are dropped');
  for (const bad of ['', 'nonsense', base32(raw).slice(1), base32(raw) + 'A', 'A'.repeat(52), `${ID}:descriptor:x25519:${base32(raw).slice(2)}`, 'x25519:' + b64.slice(4), 'x'.repeat(500), null, undefined, '\r\nQUIT'])
    assert.equal(onionAuthKey(bad), '', String(bad).slice(0, 30));
});

test('an onion service is told by its 56-character address, with or without a subdomain', () => {
  assert.equal(onionService(`${ID}.onion`), ID);
  assert.equal(onionService(`www.${ID}.onion.`), ID);
  for (const bad of ['', 'example.com', 'short.onion', `${ID}.example`, ID + 'a.onion', undefined]) assert.equal(onionService(bad), '', String(bad));
});

/** A fake tor SOCKS port that answers every CONNECT to a .onion host with `code` (what ExtendedErrors says) and everything else with success. */
function fakeTor(code) {
  const server = net.createServer(socket => {
    let buffer = Buffer.alloc(0), stage = 'greet';
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greet' && buffer.length >= 2 && buffer.length >= 2 + buffer[1]) { buffer = buffer.subarray(2 + buffer[1]); socket.write(Buffer.from([5, 2])); stage = 'auth'; }
      if (stage === 'auth' && buffer.length >= 2) { const u = buffer[1]; if (buffer.length < 3 + u) return; const p = buffer[2 + u]; if (buffer.length < 3 + u + p) return; buffer = buffer.subarray(3 + u + p); socket.write(Buffer.from([1, 0])); stage = 'request'; }
      if (stage === 'request') { const r = parseConnect(buffer); if (!r) return; socket.write(Buffer.from([5, /\.onion$/.test(r.host) ? code : 0, 0, 1, 0, 0, 0, 0, 0, 0])); stage = 'done'; }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({server, port: server.address().port})));
}
/** Chromium's side: no-auth greeting, CONNECT by name, and the reply code tor sent back. */
function connectCode(port, host) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1'), timer = setTimeout(() => { socket.destroy(); reject(new Error('timed out')); }, 5000); let buffer = Buffer.alloc(0), stage = 'greet';
    socket.on('error', reject);
    socket.on('connect', () => socket.write(Buffer.from([5, 1, 0])));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'greet' && buffer.length >= 2) { buffer = buffer.subarray(2); const h = Buffer.from(host); socket.write(Buffer.concat([Buffer.from([5, 1, 0, 3, h.length]), h, Buffer.from([0, 80])])); stage = 'reply'; }
      if (stage === 'reply' && buffer.length >= 10) { clearTimeout(timer); socket.destroy(); resolve(buffer[1]); }
    });
  });
}
const page = url => ({id: 3, getURL: () => url, isDestroyed: () => false, session: {[Symbol.for('acira.tor.session')]: true}, reloads: 0, reloadIgnoringCache() { this.reloads++; }});
function engineOn(port, sent) {
  let listener = () => {};
  return {status: () => ({state: 'ready', progress: 100, socksPort: port, error: null, version: '0.4.9.14'}), onStatus(fn) { listener = fn; return () => {}; }, acquire() { return async () => {}; }, retry() {},
    async request(line) { sent.push(line); return ['OK']; }, fire: status => listener(status)};
}

test('0xF4 and 0xF5 from tor become "missing" and "wrong" for the tab that shows that onion address', async () => {
  for (const [code, want] of [[0xF4, 'missing'], [0xF5, 'wrong']]) {
    const upstream = await fakeTor(code), tor = createTorWindows({engine: engineOn(upstream.port, []), userData: ''});
    try {
      const relay = await tor.isolation.open('w1');
      assert.equal(await connectCode(relay, `${ID}.onion`), code, 'the relay passes tor\'s reply on unchanged');
      assert.equal(tor.onionAuthOf(page(`http://${ID}.onion/`)), want);
      assert.equal(tor.onionAuthOf(page(`http://www.${ID}.onion/x`)), want, 'a subdomain of the service');
      assert.equal(tor.onionAuthOf(page('https://example.com/')), '', 'another site is not asking');
      assert.equal(await connectCode(relay, 'example.com'), 0);
      assert.equal(tor.onionAuthOf(page('https://example.com/')), '');
    } finally { tor.isolation.close('w1'); upstream.server.close(); }
  }
  const other = await fakeTor(0xF0), tor = createTorWindows({engine: engineOn(other.port, []), userData: ''});
  try { const relay = await tor.isolation.open('w1'); assert.equal(await connectCode(relay, `${ID}.onion`), 0xF0); assert.equal(tor.onionAuthOf(page(`http://${ID}.onion/`)), '', 'other onion errors (descriptor not found, ...) never ask for a key'); } finally { tor.isolation.close('w1'); other.server.close(); }
});

test('the key goes to tor for the tab\'s own site, the page reloads, the key is remembered in memory and given to tor again after a restart', async () => {
  const upstream = await fakeTor(0xF4), sent = [], engine = engineOn(upstream.port, sent), tor = createTorWindows({engine, userData: ''});
  try {
    const relay = await tor.isolation.open('w1');await connectCode(relay, `${ID}.onion`);
    const wc = page(`http://${ID}.onion/`), tab = {isTor: true, webContents: wc}, ctx = {inTor: true, activeTab: () => tab, tabById: () => tab};
    const raw = secret(), b64 = raw.toString('base64');
    await assert.rejects(tor.handle({type: 'tor.onion-auth-add', key: 'not a key'}, ctx), /onion service key/);
    assert.equal(sent.length, 0, 'nothing reaches tor for a key that is none');
    assert.deepEqual(await tor.handle({type: 'tor.onion-auth-add', key: base32(raw), address: 'evil.onion'}, ctx), {onionAuth: {ok: true}});
    assert.deepEqual(sent, [`ONION_CLIENT_AUTH_ADD ${ID} x25519:${b64}`], 'the address is the tab\'s, and the key is not permanent (no Flags=Permanent)');
    assert.equal(wc.reloads, 1);assert.equal(tor.onionAuthOf(wc), '', 'the question is answered');
    await assert.rejects(tor.handle({type: 'tor.onion-auth-add', key: base32(raw)}, {inTor: true, activeTab: () => ({isTor: true, webContents: page('https://example.com/')})}), /Open a site/);
    // tor restarts: connecting again gives the key back to it.
    await tor.prepare({windowId: 'w1', session: {getUserAgent: () => 'Mozilla/5.0', setUserAgent() {}, setProxy: async () => {}, closeAllConnections: async () => {}, resolveProxy: async () => '', setPermissionRequestHandler() {}, setPermissionCheckHandler() {}}, profileId: 'p', emit() {}});
    sent.length = 0;engine.fire({state: 'connecting'});engine.fire({state: 'ready', socksPort: upstream.port});
    assert.deepEqual(sent, [`ONION_CLIENT_AUTH_ADD ${ID} x25519:${b64}`]);
    engine.fire({state: 'ready', socksPort: upstream.port});assert.equal(sent.length, 1, 'only on the way back to ready');
    await tor.release('w1');
  } finally { tor.isolation.close('w1'); upstream.server.close(); }
});

test('tor\'s 251, 252 and 253 answers (replaced, decrypted the cached descriptor, no descriptor yet) are all success; a refusal is an error the page can show', async () => {
  const upstream = await fakeTor(0), engine = engineOn(upstream.port, []), tor = createTorWindows({engine, userData: ''});
  try {
    const tab = {isTor: true, webContents: page(`http://${ID}.onion/`)}, ctx = {inTor: true, activeTab: () => tab};
    for (const [code, text] of [['251', 'Client for onion existed and replaced'], ['252', 'Registered client and decrypted desc'], ['253', 'Registered client but could not decrypt desc']]) {
      engine.request = async () => { throw Object.assign(new Error(text), {code}); };
      assert.deepEqual(await tor.handle({type: 'tor.onion-auth-add', key: base32(secret())}, ctx), {onionAuth: {ok: true}}, code);
    }
    engine.request = async () => { throw Object.assign(new Error('Invalid v3 address'), {code: '512'}); };
    await assert.rejects(tor.handle({type: 'tor.onion-auth-add', key: base32(secret())}, ctx), /Tor didn.t accept the key/);
  } finally { upstream.server.close(); }
});
