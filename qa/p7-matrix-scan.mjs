// P7: which members of chrome.history / bookmarks / topSites / readingList / downloads do the 26 matrix extensions' own code reference?
// Installs each from the Web Store into one isolated profile (no sign-in, nothing run) and reads their scripts.
//   ACIRA_EXT_MATRIX_RUN=p7m node qa/p7-matrix-scan.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import {CATALOG} from './extension-matrix/catalog.mjs';
import {launch, install, installedManifest} from './extension-matrix/lib.mjs';
import {withSlot} from './native-slot.mjs';

const NAMESPACES = ['history', 'bookmarks', 'topSites', 'readingList', 'downloads'];
const pattern = new RegExp(`(?:chrome|browser|\\bapi|\\bbrowserAPI|\\bext(?:ension)?API)\\??\\.(${NAMESPACES.join('|')})\\??\\.(\\w+)`, 'g');
async function* walk(dir) {
  for (const entry of await fs.readdir(dir, {withFileTypes: true}).catch(() => [])) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(file);
    else if (/\.(?:m?js|cjs|html)$/i.test(entry.name)) yield file;
  }
}
const rows = [];
await withSlot('p7-matrix-scan', async () => {
  const app = await launch('m' + (Date.now() % 100000).toString(36));
  try {
    for (const item of CATALOG) {
      const result = await install(app, item.id);
      const row = {slug: item.slug, error: result.error};
      if (!result.error) {
        const found = await installedManifest(app, item.id);
        const perms = [...(found.manifest.permissions || []), ...(found.manifest.optional_permissions || []).map(p => p + '?')];
        row.permissions = perms.filter(p => NAMESPACES.some(n => p.replace('?', '') === n));
        const members = {};
        for await (const file of walk(found.folder)) {
          const text = await fs.readFile(file, 'utf8').catch(() => '');
          if (text.length > 20e6) continue;
          for (const match of text.matchAll(pattern)) { const key = `${match[1]}.${match[2]}`; members[key] = (members[key] || 0) + 1; }
        }
        row.members = members;
      }
      rows.push(row); console.log(JSON.stringify(row).slice(0, 600));
    }
  } finally { await app.close(); }
});
await fs.mkdir('qa/artifacts/p7-downloads', {recursive: true});
await fs.writeFile('qa/artifacts/p7-downloads/matrix-scan.json', JSON.stringify(rows, null, 1));
process.exit(0);
