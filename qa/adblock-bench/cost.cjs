'use strict';
// Startup + memory cost of one engine in a fresh process.  node --expose-gc qa/adblock-bench/cost.cjs --engine=ghostery|brave [--lists=ours|brave]
// Prints one JSON line. Run it several times and take the median (see run-cost.cjs).
const fs = require('node:fs');
const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
const ENGINE = arg('engine', 'ghostery'), LISTS = arg('lists', 'ours');
const { listText, buildGhostery, buildBrave } = require('./engines.cjs');
const text = listText(LISTS);
const mb = n => +(n / 1048576).toFixed(1), ms = (a, b) => +(Number(b - a) / 1e6).toFixed(0);
const gc = () => { if (global.gc) { global.gc(); global.gc(); } };
gc(); const base = process.memoryUsage();
const t0 = process.hrtime.bigint();
const built = ENGINE === 'ghostery' ? buildGhostery(text) : buildBrave(text);
const t1 = process.hrtime.bigint(); gc();
const after = process.memoryUsage();
let serialized, serializeMs, deserializeMs, loadedRss;
if (ENGINE === 'ghostery') {
  const s0 = process.hrtime.bigint(); serialized = built.engine.serialize(); const s1 = process.hrtime.bigint(); serializeMs = ms(s0, s1);
  const { ElectronBlocker } = require('@ghostery/adblocker-electron'); const d0 = process.hrtime.bigint(); const e2 = ElectronBlocker.deserialize(serialized); const d1 = process.hrtime.bigint(); deserializeMs = ms(d0, d1); if (!e2) throw new Error('deserialize');
} else {
  const s0 = process.hrtime.bigint(); serialized = Buffer.from(built.engine.serialize()); const s1 = process.hrtime.bigint(); serializeMs = ms(s0, s1);
  const { FilterSet, Engine } = require(process.env.ADBLOCK_RS_PATH); const e2 = new Engine(new FilterSet(false)); const d0 = process.hrtime.bigint(); e2.deserialize(serialized.buffer.slice(serialized.byteOffset, serialized.byteOffset + serialized.byteLength)); const d1 = process.hrtime.bigint(); deserializeMs = ms(d0, d1);
}
console.log(JSON.stringify({ engine: ENGINE, lists: LISTS, listMB: mb(text.length), parseMs: ms(t0, t1), rssBaseMB: mb(base.rss), rssAfterMB: mb(after.rss), rssDeltaMB: mb(after.rss - base.rss), heapDeltaMB: mb(after.heapUsed - base.heapUsed), externalDeltaMB: mb(after.external - base.external), arrayBuffersDeltaMB: mb(after.arrayBuffers - base.arrayBuffers), serializedMB: mb(serialized.byteLength), serializeMs, deserializeMs }));
// Second phase (separate process so the parse garbage is not in RSS): load the serialized engine from disk, as a cached start would.
if (arg('save', '')) { fs.writeFileSync(arg('save'), Buffer.from(ENGINE === 'ghostery' ? serialized : serialized)); }
