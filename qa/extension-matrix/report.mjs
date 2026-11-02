// Turns qa/artifacts/ext-matrix/<slug>.json into the matrix table and a per-extension detail dump.   node qa/extension-matrix/report.mjs [--details]
import fs from 'node:fs/promises';
import {CATALOG} from './catalog.mjs';
const MARK = {pass: 'pass', partial: 'partial', fail: 'fail', 'n/a': 'n/a', error: 'error', undefined: 'not run'};
const COLUMNS = [['install', 'Installs'], ['service-worker', 'Service worker'], ['pin', 'Pin'], ['toolbar-on-web-tab', 'Toolbar button'], ['popup', 'Popup'], ['content', 'Content scripts'], ['options', 'Options page'], ['native-messaging', 'Native messaging'], ['restart-restore', 'Restart'], ['sw-idle-wake', 'SW idle wake'], ['tab-sleep', 'Tab sleep']];
const rows = [], details = [];
for (const item of CATALOG) {
  let result; try { result = JSON.parse(await fs.readFile(`qa/artifacts/ext-matrix/${item.slug}.json`, 'utf8')); } catch { rows.push(`| ${item.name} | ${COLUMNS.map(() => 'not run').join(' | ')} |`); continue; }
  const cells = COLUMNS.map(([key]) => MARK[result.steps[key]?.status]);
  rows.push(`| ${item.name} | ${cells.join(' | ')} |`);
  details.push({slug: item.slug, name: result.manifest ? undefined : undefined, fatal: result.fatal, steps: Object.fromEntries(Object.entries(result.steps).map(([k, v]) => [k, {status: v.status, detail: v.detail}])), manifest: result.manifest, nativeReal: result.nativeReal, errors: result.errors.slice(0, 6)});
}
console.log('| Extension | ' + COLUMNS.map(([, label]) => label).join(' | ') + ' |');
console.log('|' + ' --- |'.repeat(COLUMNS.length + 1));
console.log(rows.join('\n'));
if (process.argv.includes('--details')) for (const detail of details) console.log('\n## ' + detail.slug + '\n' + JSON.stringify(detail, null, 1).slice(0, 6000));
