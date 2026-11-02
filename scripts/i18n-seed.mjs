// Merges translations into src/i18n/<locale>.json: node scripts/i18n-seed.mjs <file.json>
// The file maps a message id to { es, fr, de, "pt-BR", it, ja, "zh-CN", ar, tr, ru, ko, hi }; English lives in en.json and is not touched here.
// Keys are written sorted to match en.json's order, so catalogs diff cleanly. An id missing from en.json is refused.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/i18n');
const LOCALES = ['es', 'fr', 'de', 'pt-BR', 'it', 'ja', 'zh-CN', 'ar', 'tr', 'ru', 'ko', 'hi']; // every language in src/i18n/locales.ts but English
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name + '.json'), 'utf8'));
const input = JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8'));
const english = read('en');
for (const id of Object.keys(input)) if (!(id in english)) throw new Error('Unknown message id: ' + id);
for (const locale of LOCALES) {
  const catalog = read(locale);
  for (const [id, translations] of Object.entries(input)) if (translations[locale]) catalog[id] = translations[locale];
  const ordered = Object.fromEntries(Object.keys(english).filter(id => id in catalog).map(id => [id, catalog[id]]));
  fs.writeFileSync(path.join(dir, locale + '.json'), JSON.stringify(ordered, null, 2) + '\n');
}
console.log('merged', Object.keys(input).length, 'messages into', LOCALES.length, 'catalogs');
