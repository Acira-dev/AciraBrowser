'use strict';
// CNAME uncloaking (F15). A tracker can hide behind a first-party subdomain (`metrics.site.com` -> `site.tracker-cdn.net`),
// which no host-based list can see. Like uBlock Origin and Brave, we resolve the host's canonical name and judge the request
// again with the canonical host. The flow follows brave-core browser/net/brave_ad_block_tp_network_delegate_helper.cc
// (MPL-2.0, rev 1e6f002): query only after the normal check did not block, `include_canonical_name`, skip when a proxy
// carries the traffic, carry the first pass's exception flag into the second pass, and use the configured secure DNS
// (DoH) instead of the system resolver when the user enabled it.
const dns = require('node:dns');
const SKIP_HOST = /^(?:localhost|.*\.(?:local|localhost|internal|test|invalid|example|lan|home\.arpa))$/i, IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
/** Hosts worth a DNS question: real multi-label names. Apex names cannot be CNAMEs, IP literals and local names never are trackers. */
function eligibleHost(host, registrable) {
  if (typeof host !== 'string' || host.length < 4 || host.length > 253 || IPV4.test(host) || host.includes(':') || !host.includes('.') || SKIP_HOST.test(host)) return false;
  return !registrable || host !== registrable;
}
// --- DNS wire format (RFC 1035) for the DoH path ---------------------------------------------------------------------
function dnsQuery(name, type = 1) {
  const header = Buffer.alloc(12); header.writeUInt16BE(0x0100, 2); header.writeUInt16BE(1, 4); // id 0 (RFC 8484), RD set, one question
  const parts = [header];
  for (const label of name.split('.')) { const bytes = Buffer.from(label, 'ascii'); if (!bytes.length || bytes.length > 63) throw new Error('Invalid DNS name.'); parts.push(Buffer.from([bytes.length]), bytes); }
  parts.push(Buffer.from([0, 0, type, 0, 1]));
  return Buffer.concat(parts);
}
function readName(buffer, offset) {
  const labels = []; let position = offset, end = offset, jumped = false;
  for (let guard = 0; guard < 128; guard++) {
    if (position >= buffer.length) throw new Error('Truncated DNS name.');
    const length = buffer[position];
    if (length === 0) { if (!jumped) end = position + 1; return { name: labels.join('.').toLowerCase(), end }; }
    if ((length & 0xc0) === 0xc0) { if (!jumped) end = position + 2; jumped = true; position = ((length & 0x3f) << 8) | buffer[position + 1]; continue; }
    labels.push(buffer.toString('ascii', position + 1, position + 1 + length)); position += 1 + length;
  }
  throw new Error('DNS name too long.');
}
/** Reads the answer section of a DNS response: the CNAME map (owner -> target), the smallest CNAME TTL in seconds and the response code. */
function parseAnswer(buffer) {
  if (buffer.length < 12) throw new Error('Short DNS response.');
  const rcode = buffer[3] & 15, questions = buffer.readUInt16BE(4), answers = buffer.readUInt16BE(6), cnames = new Map(); let position = 12, ttl = Infinity;
  for (let i = 0; i < questions; i++) position = readName(buffer, position).end + 4;
  for (let i = 0; i < answers; i++) {
    const owner = readName(buffer, position); position = owner.end;
    const type = buffer.readUInt16BE(position), recordTtl = buffer.readUInt32BE(position + 4), length = buffer.readUInt16BE(position + 8); position += 10;
    if (type === 5) { cnames.set(owner.name, readName(buffer, position).name); ttl = Math.min(ttl, recordTtl); }
    position += length;
  }
  return { rcode, cnames, ttl: Number.isFinite(ttl) ? ttl : null };
}
const canonical = (host, cnames) => { let name = host; for (let hop = 0; hop < 10 && cnames.has(name); hop++) name = cnames.get(name); return name; };
/** Resolver over the user's DoH endpoint (the same templates Settings stores: a plain POST URL or a `{?dns}` GET template). */
function dohResolver({ servers, fetch }) {
  return async host => {
    const query = dnsQuery(host, 1); let lastError = null;
    for (const server of servers) {
      try {
        const get = server.endsWith('{?dns}'), base = get ? server.slice(0, -6) : server;
        const response = get ? await fetch(base + '?dns=' + query.toString('base64url'), { headers: { accept: 'application/dns-message' } }) : await fetch(base, { method: 'POST', headers: { 'content-type': 'application/dns-message', accept: 'application/dns-message' }, body: query });
        if (!response.ok) throw new Error('DoH status ' + response.status);
        const answer = parseAnswer(Buffer.from(await response.arrayBuffer()));
        if (answer.rcode !== 0) return { cname: null, ttl: null };
        const target = canonical(host, answer.cnames); return { cname: target === host ? null : target, ttl: answer.ttl };
      } catch (error) { lastError = error; }
    }
    throw lastError || new Error('No DoH server.');
  };
}
/** Resolver over the operating system's DNS servers: follows the CNAME chain one hop at a time. */
function systemResolver({ resolver = new dns.promises.Resolver({ timeout: 1500, tries: 1 }) } = {}) {
  return async host => {
    let name = host;
    for (let hop = 0; hop < 8; hop++) {
      let next;
      try { next = (await resolver.resolveCname(name))[0]; } catch (error) { if (['ENODATA', 'ENOTFOUND', 'ENOTIMP', 'EBADNAME'].includes(error.code)) break; throw error; }
      if (!next) break; name = next.toLowerCase();
    }
    return { cname: name === host ? null : name, ttl: null };
  };
}
/** Bounded, deduplicated lookups. `peek` is synchronous so most requests never wait; failures fail open and are remembered briefly. */
function createCnameUncloaker({ resolve, now = Date.now, max = 4096, timeoutMs = 1500, concurrency = 8, positiveMs = 60 * 60 * 1000, negativeMs = 10 * 60 * 1000, failureMs = 60 * 1000 }) {
  const cache = new Map(), inflight = new Map(), waiting = [], stats = { lookups: 0, cacheHits: 0, cloaked: 0, failures: 0 }; let active = 0;
  const store = (host, value, ms) => { cache.delete(host); cache.set(host, { value, expires: now() + ms }); while (cache.size > max) cache.delete(cache.keys().next().value); };
  const next = () => { while (active < concurrency && waiting.length) { active++; waiting.shift()(); } };
  const slot = () => new Promise(done => { waiting.push(done); next(); });
  async function run(host) {
    await slot(); stats.lookups++;
    let timer;
    try {
      const result = await Promise.race([resolve(host), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('CNAME lookup timed out.')), timeoutMs); timer.unref?.(); })]);
      const value = result?.cname && result.cname !== host ? result.cname : null; if (value) stats.cloaked++;
      store(host, value, value ? Math.min(positiveMs, Math.max(60000, (result.ttl || 0) * 1000 || positiveMs)) : negativeMs); return value;
    } catch { stats.failures++; store(host, null, failureMs); return null; } finally { clearTimeout(timer); active--; next(); }
  }
  return {
    /** undefined = unknown (call lookup), null = no alias, string = canonical host. */
    peek(host) { const entry = cache.get(host); if (!entry) return undefined; if (entry.expires <= now()) { cache.delete(host); return undefined; } stats.cacheHits++; return entry.value; },
    lookup(host) { const known = this.peek(host); if (known !== undefined) return Promise.resolve(known); if (!inflight.has(host)) inflight.set(host, run(host).finally(() => inflight.delete(host))); return inflight.get(host); },
    stats: () => ({ ...stats, cached: cache.size }), clear: () => cache.clear()
  };
}
module.exports = { createCnameUncloaker, systemResolver, dohResolver, eligibleHost, dnsQuery, parseAnswer, canonical };
