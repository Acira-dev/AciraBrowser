// P7: which Chrome Web Store download extensions install in Acira and what they declare. Isolated profile, one app, one slot.
//   node qa/p7-store-discover.mjs [id ...]
import fs from 'node:fs/promises';
import {launch, install, installedManifest, summarize} from './extension-matrix/lib.mjs';
import {withSlot} from './native-slot.mjs';

const CANDIDATES = [
  ['image-downloader', 'cnpniohnfphhjihaiiggeabnkjhpaldj'],
  ['chrono', 'mciiogijehkdemklbdcbfkefimifhecn'],
  ['download-all-images', 'ifipmflagepipjokmbdecpmjbibjnakm'],
  ['fatkun', 'nnjjahlikiabnchcpehcpkdeckfgnohf'],
  ['imageye', 'agionbommeaifngbhincahgmoflcikhm'],
  ['video-downloadhelper', 'lmjnegcaeklhafolokijcfjliaokphfk']
];
const only = process.argv.slice(2);
const list = only.length ? only.map(id => [id, id]) : CANDIDATES;
const rows = [];
await withSlot('p7-store-discover', async () => {
  const app = await launch('d' + (Date.now() % 100000).toString(36));
  try {
    for (const [slug, id] of list) {
      const result = await install(app, id);
      const row = {slug, id, ms: result.ms, error: result.error, name: result.entry?.name, version: result.entry?.version, warnings: result.entry?.supportWarnings};
      if (!result.error) { const found = await installedManifest(app, id); if (found) row.summary = summarize(found.manifest); }
      rows.push(row); console.log(JSON.stringify(row));
    }
  } finally { await app.close(); }
});
await fs.mkdir('qa/artifacts/p7-downloads', {recursive: true});
await fs.writeFile('qa/artifacts/p7-downloads/store-discover.json', JSON.stringify(rows, null, 1));
process.exit(0);
