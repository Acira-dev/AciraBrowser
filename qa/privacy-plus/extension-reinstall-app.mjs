// Import receipt "add your extensions" checklist, end to end in the real app on a FIXTURE Chrome profile (LOCALAPPDATA redirected under
// .qa-profiles). One app instance, closed in finally. The checklist must offer MV3 extensions only, start with nothing chosen, install nothing until
// asked, and the install must go through Acira's Chrome Web Store path with the review dialog (answered "Add extension" by the harness).
// Needs network for the store download. node qa/privacy-plus/extension-reinstall-app.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import {launch, sleep} from '../extension-matrix/lib.mjs';

const UBO_LITE = 'ddkjiahejlhfcafbddmgiahcphecmpfh', OLD = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const fixture = path.resolve('.qa-profiles/j-reinstall-fixture');
const checks = [];
const check = (name, ok, detail) => { checks.push({name, ok: Boolean(ok), detail}); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : JSON.stringify(detail)); };

await fs.rm(fixture, {recursive: true, force: true});
const chrome = path.join(fixture, 'Local/Google/Chrome/User Data'), profile = path.join(chrome, 'Default');
for (const [id, name, mv] of [[UBO_LITE, 'uBlock Origin Lite', 3], [OLD, 'Old Panel', 2]]) {
  const folder = path.join(profile, 'Extensions', id, '1.0_0');
  await fs.mkdir(folder, {recursive: true});
  await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify({name, version: '1.0', manifest_version: mv}));
}
await fs.writeFile(path.join(profile, 'Bookmarks'), JSON.stringify({roots: {bookmark_bar: {name: 'Bookmarks bar', type: 'folder', children: []}}}));
await fs.writeFile(path.join(chrome, 'Local State'), JSON.stringify({profile: {info_cache: {Default: {name: 'Fixture'}}}}));

const app = await launch('j-reinstall', {env: {LOCALAPPDATA: path.join(fixture, 'Local'), APPDATA: path.join(fixture, 'Roaming')}});
try {
  const found = await app.svc({type: 'imports.discover'});
  const source = (found.sources || []).find(item => item.browser === 'Chrome');
  check('fixture Chrome profile discovered', source?.available?.extensions, found.sources);
  const preview = await app.svc({type: 'imports.preview', sourceId: source.id});
  check('preview lists both extensions with manifest version', preview.preview.extensions.length === 2 && preview.preview.extensions.some(e => e.manifestVersion === 2), preview.preview.extensions);
  const run = await app.svc({type: 'imports.run', sourceId: source.id, categories: ['extensions']});
  check('import records inventory only, installs nothing', run.batch.results[0].status === 'inventory only' && (await app.ext({type: 'list'})).extensions.length === 0, run.batch);
  // Drive the real checklist in Settings > Import.
  await app.act({type: 'tab.new', url: 'acira://settings'});
  await sleep(1500);
  const settings = app.web(url => url.startsWith('acira-browser-ui://') && /settings/.test(url)) || app.ui;
  console.log('settings page', settings.url());
  const installed = await app.ext({type: 'install', extensionId: UBO_LITE});
  check('Web Store install of the chosen id works with the review dialog', installed.extensions?.some(e => e.id === UBO_LITE), installed.error);
  const reviews = await app.reviews();
  check('a permission review was shown before the add', reviews.length >= 1 && /uBlock/i.test(String(reviews[0].message || '')), reviews.map(r => r.message));
} finally { await app.close(); }
const failed = checks.filter(item => !item.ok);
console.log(failed.length ? `${failed.length} FAILED` : 'ALL PASS');
process.exit(failed.length ? 1 : 0);
