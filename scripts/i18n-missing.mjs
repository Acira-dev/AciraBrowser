// Lists the English messages that are missing from a locale (or all of them), and can split them into translator batches.
//   node scripts/i18n-missing.mjs                       counts per locale
//   node scripts/i18n-missing.mjs --batches <dir> [--size 120]
//        writes <dir>/batch-N.in.json: { "id": "English text", … } for every id missing from at least one locale.
//        A translator writes batch-N.out.json: { "id": { "es": "…", "fr": "…", …, "hi": "…" } } (the twelve languages below)
//        and `node scripts/i18n-seed.mjs <dir>/batch-N.out.json` merges it.
//   node scripts/i18n-missing.mjs --strict               exit 1 when any locale lacks any id (the release gate)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/i18n');
const LOCALES = ['es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']; // every language in src/i18n/locales.ts but English
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
const en = read('en'), catalogs = Object.fromEntries(LOCALES.map(code => [code, read(code)]));
const missingFor = code => Object.keys(en).filter(id => !(id in catalogs[code]));
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const ids = Object.keys(en).filter(id => LOCALES.some(code => !(id in catalogs[code])));

if (option('--batches')) {
  const out = path.resolve(option('--batches')), size = Number(option('--size') || 120);
  fs.mkdirSync(out, { recursive: true });
  for (let i = 0, n = 1; i < ids.length; i += size, n++) fs.writeFileSync(path.join(out, `batch-${n}.in.json`), JSON.stringify(Object.fromEntries(ids.slice(i, i + size).map(id => [id, en[id]])), null, 1));
  console.log(`${ids.length} messages in ${Math.ceil(ids.length / size)} batches -> ${out}`);
} else {
  for (const code of LOCALES) console.log(code.padEnd(6), `${missingFor(code).length} missing of ${Object.keys(en).length}`);
  if (args.includes('--strict') && ids.length) process.exit(1);
}
