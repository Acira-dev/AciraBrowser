// First pass: install every catalog extension into one isolated profile and print what each package declares.
//   node qa/extension-matrix/discover.mjs [slug ...]
import fs from 'node:fs/promises';
import {CATALOG} from './catalog.mjs';
import {launch, install, installedManifest, summarize} from './lib.mjs';
const only = process.argv.slice(2);
const app = await launch(process.env.DISCOVER_PROFILE || 'ext-discovery');
const out = [];
try {
  for (const item of CATALOG.filter(item => !only.length || only.includes(item.slug))) {
    const result = await install(app, item.id);
    const row = {slug: item.slug, id: item.id, ms: result.ms, error: result.error, loadedName: result.entry?.name, version: result.entry?.version, warnings: result.entry?.supportWarnings};
    if (!result.error) { const found = await installedManifest(app, item.id); if (found) row.summary = summarize(found.manifest); }
    out.push(row); console.log(JSON.stringify(row));
  }
  await fs.mkdir('qa/artifacts/ext-matrix', {recursive: true});
  await fs.writeFile('qa/artifacts/ext-matrix/discover-' + (process.env.DISCOVER_PROFILE || 'main') + '.json', JSON.stringify({out, reviews: await app.reviews()}, null, 1));
} finally { await app.close(); process.exit(0); }
