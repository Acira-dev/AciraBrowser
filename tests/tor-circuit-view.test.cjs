'use strict';
// The circuit display: tor's circuit-status is parsed, the circuit made for a site's SOCKS credentials is picked (never another site's), each relay gets its
// address, nickname and country from the control port, and the site's circuit password never leaves the main process.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const {createTorWindows, parseCircuitStatus, parseStreamStatus, circuitFor, relayFromConsensus} = require('../desktop/browser-services/tor-window.cjs');
const {parseInfo} = require('../desktop/browser-services/tor-engine.cjs');
const FP = {a: 'A'.repeat(40), b: 'B'.repeat(40), c: 'C'.repeat(40), d: 'D'.repeat(40)};
const sample = (user, pass) => `7 BUILT $${FP.a}~guardone,$${FP.b}=middletwo,$${FP.c}~exitthree BUILD_FLAGS=NEED_CAPACITY PURPOSE=GENERAL TIME_CREATED=2026-10-28T11:00:00.250000 SOCKS_USERNAME="${user}" SOCKS_PASSWORD="${pass}"\n8 BUILT $${FP.a}~guardone,$${FP.d}~other,$${FP.c}~exitthree PURPOSE=GENERAL TIME_CREATED=2026-10-28T11:01:00.000000 SOCKS_USERNAME="news.example.org" SOCKS_PASSWORD="zzz"\n9 LAUNCHED PURPOSE=GENERAL\n10 EXTENDED $${FP.a}~guardone PURPOSE=GENERAL`;

test('circuit-status lines are parsed: path, purpose, SOCKS credentials, creation time', () => {
  const parsed = parseCircuitStatus(sample('example.com', 'secret'));
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[0].path.map(h => [h.fingerprint.slice(0, 2), h.nickname]), [['AA', 'guardone'], ['BB', 'middletwo'], ['CC', 'exitthree']]);
  assert.equal(parsed[0].username, 'example.com');assert.equal(parsed[0].password, 'secret');assert.equal(parsed[0].purpose, 'GENERAL');assert.ok(parsed[0].created > 0);
  assert.equal(parsed[2].status, 'LAUNCHED');assert.deepEqual(parsed[2].path, []);assert.equal(parsed[2].username, null);
});

test('only a built circuit made for exactly these credentials is the site\'s circuit; the newest wins', () => {
  const parsed = parseCircuitStatus(sample('example.com', 'secret'));
  assert.equal(circuitFor(parsed, {username: 'example.com', password: 'secret'}).id, '7');
  assert.equal(circuitFor(parsed, {username: 'example.com', password: 'other'}), null, 'a different circuit password (a new circuit was asked for) is a different circuit');
  assert.equal(circuitFor(parsed, {username: 'news.example.org', password: 'zzz'}).id, '8');
  assert.equal(circuitFor(parsed, null), null);
  const twice = parseCircuitStatus(sample('example.com', 'secret') + '\n11 BUILT $' + FP.a + '~g,$' + FP.b + '~m,$' + FP.c + '~e PURPOSE=GENERAL TIME_CREATED=2026-10-28T12:00:00.000000 SOCKS_USERNAME="example.com" SOCKS_PASSWORD="secret"');
  assert.equal(circuitFor(twice, {username: 'example.com', password: 'secret'}).id, '11');
});

test('conflux legs: the circuit an open stream to the page host rides is the one shown, not merely the newest leg', () => {
  const leg = (id, exit, minute) => `${id} BUILT $${FP.a}~g${id},$${FP.b}~m${id},$${exit}~e${id} PURPOSE=CONFLUX_LINKED TIME_CREATED=2026-10-28T11:0${minute}:00.000000 SOCKS_USERNAME="example.com" SOCKS_PASSWORD="pw"`;
  const circuits = parseCircuitStatus([leg(3, FP.c, 1), leg(4, FP.d, 2)].join('\n')), credentials = {username: 'example.com', password: 'pw'};
  assert.equal(circuitFor(circuits, credentials).id, '4', 'no stream open: the newest');
  const streams = parseStreamStatus('8 SUCCEEDED 3 www.example.com:443\n9 SUCCEEDED 4 cdn.example.net:443\n10 NEW 0 x.example:80');
  assert.deepEqual(streams.map(x => [x.id, x.circuit, x.host]), [[8, '3', 'www.example.com'], [9, '4', 'cdn.example.net'], [10, '0', 'x.example']]);
  assert.equal(circuitFor(circuits, credentials, streams, 'www.example.com').id, '3', 'the stream to the page host rides leg 3');
  assert.equal(circuitFor(circuits, credentials, streams, 'shop.example.com').id, '3', 'else a stream to the same site');
  assert.equal(circuitFor(circuits, {username: 'example.com', password: 'other'}, streams, 'www.example.com'), null);
});

test('the circuit of a site\'s latest stream (STREAM events) beats "the newest", and tor.circuit follows it', async () => {
  const {parseStreamEvent} = require('../desktop/browser-services/tor-window.cjs');
  assert.deepEqual(parseStreamEvent('STREAM 12 SUCCEEDED 7 check.torproject.org:443 SOCKS_USERNAME="torproject.org" SOCKS_PASSWORD="abc" CLIENT_PROTOCOL=SOCKS5'), {id: 12, status: 'SUCCEEDED', circuit: '7', host: 'check.torproject.org', username: 'torproject.org', password: 'abc'});
  assert.equal(parseStreamEvent('SIGNAL NEWNYM'), null);
  const circuits = parseCircuitStatus(`3 BUILT $${FP.a}~g3,$${FP.b}~m3,$${FP.c}~e3 PURPOSE=GENERAL TIME_CREATED=2026-10-28T11:01:00.000000 SOCKS_USERNAME="example.com" SOCKS_PASSWORD="pw"\n4 BUILT $${FP.a}~g4,$${FP.b}~m4,$${FP.d}~e4 PURPOSE=GENERAL TIME_CREATED=2026-10-28T11:02:00.000000 SOCKS_USERNAME="example.com" SOCKS_PASSWORD="pw"`);
  assert.equal(circuitFor(circuits, {username: 'example.com', password: 'pw'}, [], '', '3').id, '3', 'the latest stream rode the older circuit');
  assert.equal(circuitFor(circuits, {username: 'example.com', password: 'pw'}, [], '', '99').id, '4', 'a circuit that no longer exists is ignored');
  let notify = () => {};
  const engine = fakeEngine({});
  engine.onStream = listener => { notify = listener; return () => {}; };
  const tor = createTorWindows({engine, userData: ''});
  tor.isolation.newCircuit('example.com');
  const {password} = tor.isolation.credentials('example.com');
  const status = `3 BUILT $${FP.a}~g3,$${FP.b}~m3,$${FP.c}~e3 PURPOSE=GENERAL TIME_CREATED=2026-10-28T11:01:00.000000 SOCKS_USERNAME="example.com" SOCKS_PASSWORD="${password}"\n4 BUILT $${FP.a}~g4,$${FP.b}~m4,$${FP.d}~e4 PURPOSE=GENERAL TIME_CREATED=2026-10-28T11:02:00.000000 SOCKS_USERNAME="example.com" SOCKS_PASSWORD="${password}"`;
  const answers = {'circuit-status': status};
  for (const fp of [FP.a, FP.b, FP.c, FP.d]) answers['ns/id/' + fp] = `r n${fp[0]} x x 2026-10-28 11:00:00 10.0.0.${fp.charCodeAt(0) - 64} 9001 0`;
  engine.getInfo = async (...keys) => { const out = {}; for (const key of keys) { if (!(key in answers) && !key.startsWith('ip-to-country/')) throw new Error('552'); out[key] = answers[key] ?? 'fr'; } return out; };
  const tab = {isTor: true, webContents: torPage('https://example.com/')};
  notify(`STREAM 5 SENTCONNECT 3 example.com:443 SOCKS_USERNAME="example.com" SOCKS_PASSWORD="${password}"`);
  const reply = await tor.handle({type: 'tor.circuit'}, {inTor: true, activeTab: () => tab});
  assert.equal(reply.circuit.hops[2].nickname, 'nC', 'the exit of circuit 3, where the latest stream went, not of the newer circuit 4');
  notify(`STREAM 6 SUCCEEDED 4 example.com:443 SOCKS_USERNAME="example.com" SOCKS_PASSWORD="${password}"`);
  assert.equal((await tor.handle({type: 'tor.circuit'}, {inTor: true, activeTab: () => tab})).circuit.hops[2].nickname, 'nD');
  notify('STREAM 7 SUCCEEDED 3 other.org:443 SOCKS_USERNAME="other.org" SOCKS_PASSWORD="zzz"');
  assert.equal((await tor.handle({type: 'tor.circuit'}, {inTor: true, activeTab: () => tab})).circuit.hops[2].nickname, 'nD', 'another site\'s streams do not move this site\'s circuit');
});

test('a relay\'s nickname and address come from its consensus entry', () => {
  assert.deepEqual(relayFromConsensus('r guardone AAAA BBBB 2026-10-28 11:00:00 185.1.2.3 9001 0\ns Fast Guard Running\nw Bandwidth=100'), {nickname: 'guardone', address: '185.1.2.3'});
  assert.deepEqual(relayFromConsensus(''), {nickname: '', address: ''});
});

test('GETINFO data blocks: a line that looks like a status line inside a block is data (circuit 250 ...)', () => {
  const info = parseInfo(['250+circuit-status=', '250 BUILT $AAAA~x PURPOSE=GENERAL', '.', '250 OK']);
  assert.match(info['circuit-status'], /^250 BUILT/);
});

function fakeEngine(answers) {
  const asked = [];
  return {asked, status: () => ({state: 'ready', progress: 100, socksPort: 9150, error: null, version: '0.4.9.14'}), onStatus() { return () => {}; }, acquire() { return async () => {}; }, retry() {},
    async getInfo(...keys) { asked.push(keys.join(' ')); const out = {}; for (const key of keys) { if (!(key in answers)) throw new Error('552 unrecognized key'); out[key] = answers[key]; } return out; }};
}
const torPage = url => { const session = {[Symbol.for('acira.tor.session')]: true}; return {session, isDestroyed: () => false, getURL: () => url}; };

test('tor.circuit returns the relays with country, nickname and address; the password is never in the reply', async () => {
  const engine = fakeEngine({});
  const tor = createTorWindows({engine, userData: ''});
  tor.isolation.newCircuit('example.com');
  const credentials = tor.isolation.credentials('example.com');
  Object.assign(engine, {});
  const answers = {
    'circuit-status': sample('example.com', credentials.password),
    ['ns/id/' + FP.a]: 'r guardone x x 2026-10-28 11:00:00 185.1.2.3 9001 0\ns Guard', ['ns/id/' + FP.b]: 'r middletwo x x 2026-10-28 11:00:00 94.2.3.4 443 0\ns Fast', ['ns/id/' + FP.c]: 'r exitthree x x 2026-10-28 11:00:00 171.25.193.9 443 0\ns Exit',
    'ip-to-country/185.1.2.3': 'de', 'ip-to-country/94.2.3.4': '??', 'ip-to-country/171.25.193.9': 'se',
  };
  engine.getInfo = async (...keys) => { const out = {}; for (const key of keys) { if (!(key in answers)) throw new Error('552 unrecognized key'); out[key] = answers[key]; } return out; };
  const reply = await tor.handle({type: 'tor.circuit'}, {inTor: true, activeTab: () => ({isTor: true, webContents: torPage('https://www.example.com/page')})});
  assert.equal(reply.circuit.site, 'example.com');assert.equal(reply.circuit.pending, false);assert.equal(reply.circuit.onion, false);
  assert.deepEqual(reply.circuit.hops.map(h => [h.role, h.nickname, h.address, h.country]), [['guard', 'guardone', '185.1.2.3', 'de'], ['middle', 'middletwo', '94.2.3.4', ''], ['exit', 'exitthree', '171.25.193.9', 'se']]);
  assert.ok(!JSON.stringify(reply).includes(credentials.password), 'the circuit password stays in the main process');
});

test('a site with no circuit yet is pending; a failing control port is an error, not a made-up circuit', async () => {
  const tor = createTorWindows({engine: fakeEngine({}), userData: ''});
  const tab = {isTor: true, webContents: torPage('https://fresh.example.net/')};
  assert.deepEqual((await tor.handle({type: 'tor.circuit'}, {inTor: true, activeTab: () => tab})).circuit, {site: 'example.net', onion: false, hops: [], pending: true});
  tor.isolation.newCircuit('example.net');
  await assert.rejects(tor.handle({type: 'tor.circuit'}, {inTor: true, activeTab: () => tab}), /unrecognized key/);
  await assert.rejects(tor.handle({type: 'tor.circuit'}, {inTor: true, activeTab: () => ({isTor: false, webContents: torPage('https://a.example/')})}), /Open a site/);
});

test('the geoip tables are pinned beside tor.exe and handed to tor, so countries can be named', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'desktop/browser-services/tor-engine/tor-version.json'), 'utf8'));
  assert.match(manifest.files.geoip.sha256, /^[0-9a-f]{64}$/);assert.match(manifest.files.geoip6.sha256, /^[0-9a-f]{64}$/);
  assert.equal(manifest.files.geoip.from, 'data/geoip');
  const {torArguments} = require('../desktop/browser-services/tor-engine.cjs');
  const args = torArguments({dataDirectory: 'd', runDirectory: 'r', ownerPid: 1, geoip: {v4: 'x/geoip', v6: 'x/geoip6'}});
  assert.equal(args[args.indexOf('--GeoIPFile') + 1], 'x/geoip');assert.equal(args[args.indexOf('--GeoIPv6File') + 1], 'x/geoip6');
  assert.ok(!torArguments({dataDirectory: 'd', runDirectory: 'r', ownerPid: 1}).includes('--GeoIPFile'));
});
