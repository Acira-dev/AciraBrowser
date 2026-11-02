// Writes desktop/browser-services/extension-compat.json from verdicts.mjs, checking each ID against the probe results so a wrong ID cannot ship a verdict.
//   node qa/extension-matrix/export-compat.mjs
//   RESULTS=<dir>[;<dir>...] CHECKED=2026-10-27 node qa/extension-matrix/export-compat.mjs   (probe result folders, searched in order, e.g. a run's phase-1)
// A catalog entry without a verdict or without a passing install in any result folder is left out (reported), never guessed.
import fs from 'node:fs/promises';
import path from 'node:path';
import {CATALOG} from './catalog.mjs';
import {VERDICTS} from './verdicts.mjs';
const dirs = (process.env.RESULTS || 'qa/artifacts/ext-matrix').split(';').filter(Boolean);
const checked = process.env.CHECKED || '2026-10-24';
if (!/^\d{4}-\d{2}-\d{2}$/.test(checked)) throw new Error('CHECKED must be a date');
const read = async slug => { for (const dir of dirs) { try { return JSON.parse(await fs.readFile(path.join(dir, slug + '.json'), 'utf8')); } catch {} } return null; };
const previous = await fs.readFile('desktop/browser-services/extension-compat.json', 'utf8').then(JSON.parse).catch(() => ({entries: {}}));
const entries = {}, skipped = [], kept = [];
for (const item of CATALOG) {
  const verdict = VERDICTS[item.slug]; if (!verdict) { skipped.push(item.slug + ' (no verdict)'); continue; }
  const result = await read(item.slug);
  if (!result || result.id !== item.id || result.steps?.install?.status !== 'pass') {
    // Not re-run this time: an entry checked before keeps its earlier verdict and name; anything else is left out.
    if (previous.entries?.[item.id]) { entries[item.id] = {...previous.entries[item.id], status: verdict[0], note: verdict[1]}; kept.push(item.slug); } else skipped.push(item.slug + ' (no passing install for this ID)');
    continue;
  }
  if (verdict[1].length > 280) throw new Error(item.slug + ': note too long');
  entries[item.id] = {name: result.steps.install.detail.name, status: verdict[0], note: verdict[1]};
}
await fs.writeFile('desktop/browser-services/extension-compat.json', JSON.stringify({version: 1, checked, engine: 'Electron 44.9.3 / Chromium 152', entries}, null, 1) + '\n');
console.log('wrote', Object.keys(entries).length, 'entries', kept.length ? 'kept from before: ' + kept.join(', ') : '', skipped.length ? 'skipped: ' + skipped.join(', ') : '');
