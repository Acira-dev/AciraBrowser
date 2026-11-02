'use strict';
// node --expose-gc qa/adblock-bench/load.cjs --engine=ghostery|brave --file=<serialized>   (cached-start cost in a fresh process)
const fs = require('node:fs');
const arg = (name, fallback) => { const hit = process.argv.find(a => a.startsWith('--' + name + '=')); return hit ? hit.slice(name.length + 3) : fallback; };
const ENGINE = arg('engine', 'ghostery'), FILE = arg('file');
const mb = n => +(n / 1048576).toFixed(1), gc = () => { if (global.gc) { global.gc(); global.gc(); } };
const data = fs.readFileSync(FILE);
gc(); const base = process.memoryUsage(); const t0 = process.hrtime.bigint();
let engine;
if (ENGINE === 'ghostery') { const { ElectronBlocker } = require('@ghostery/adblocker-electron'); engine = ElectronBlocker.deserialize(new Uint8Array(data)); }
else { const { FilterSet, Engine } = require(process.env.ADBLOCK_RS_PATH); engine = new Engine(new FilterSet(false)); engine.deserialize(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); }
const t1 = process.hrtime.bigint(); gc(); const after = process.memoryUsage();
console.log(JSON.stringify({ engine: ENGINE, file: mb(data.length), loadMs: +(Number(t1 - t0) / 1e6).toFixed(0), rssDeltaMB: mb(after.rss - base.rss), rssAfterMB: mb(after.rss), heapDeltaMB: mb(after.heapUsed - base.heapUsed) }));
