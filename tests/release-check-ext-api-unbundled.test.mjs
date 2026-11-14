// 13.8: scripts/check-bundled-ext-api.mjs on the LINUX app.asar said "FAIL: missing 50 of 49 extension API package files". Linux ships the unbundled tree (desktop/main.cjs is source,
// the packages are files of the app.asar), so the script's bundle check, which looks for esbuild's source-path comments inside main.cjs, found none. The script now reads which kind of
// app it was given: a bundle is checked as before, an unbundled tree by its files (every package file and _packages.cjs must be there). And the count: _packages.cjs was counted in
// "missing" but not in the total. No Electron: fixtures are plain folders and an app.asar made with @electron/asar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {EXT_API_DIR, extApiPackageFiles, checkUnbundledTree, checkBundledText, checkBundledPackages, isBundledMain} from '../scripts/desktop-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asar = createRequire(import.meta.url)('@electron/asar');
const script = path.join(root, 'scripts', 'check-bundled-ext-api.mjs');
const realFiles = extApiPackageFiles((await fs.readdir(path.join(root, EXT_API_DIR))).map(name => `${EXT_API_DIR}/${name}`));
const SOURCE_MAIN = "'use strict';\nconst startupTrace = require('./startup-trace.cjs');\nconst {app} = require('electron');\n// desktop services are required by name below\n";

/** The Linux app's layout in a folder: main.cjs as source, every package file, the list, index.cjs, and a sub-folder (those entries are in the asar's count too). */
async function unbundledApp(dir, {leave = [], withList = true} = {}) {
  const folder = path.join(dir, EXT_API_DIR);
  await fs.mkdir(path.join(folder, 'surfaces'), {recursive: true});
  await fs.writeFile(path.join(dir, 'desktop/main.cjs'), SOURCE_MAIN);
  for (const file of realFiles) if (!leave.includes(file)) await fs.writeFile(path.join(folder, file), "'use strict';\nmodule.exports = {};\n");
  await fs.writeFile(path.join(folder, 'index.cjs'), "'use strict';\n");
  if (withList) await fs.writeFile(path.join(folder, '_packages.cjs'), "'use strict';\n");
  await fs.writeFile(path.join(folder, 'surfaces', 'active-tab.cjs'), "'use strict';\n");
  return dir;
}
const run = target => spawnSync(process.execPath, [script, target], {encoding: 'utf8'});
const withTemp = async body => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-unbundled-')); try { return await body(dir); } finally { await fs.rm(dir, {recursive: true, force: true}); } };

test('an unbundled app is told from a bundle by its main.cjs: the real source main is not a bundle; esbuild\'s helper or its path comments make one', async () => {
  assert.equal(isBundledMain(await fs.readFile(path.join(root, 'desktop/main.cjs'), 'utf8')), false, 'desktop/main.cjs as written');
  assert.equal(isBundledMain(SOURCE_MAIN), false);
  assert.equal(isBundledMain('"use strict";\nvar __create = Object.create;\nvar __commonJS = (cb, mod) => function __require() {};\n'), true, 'the helper');
  assert.equal(isBundledMain('"use strict";\n// desktop/main.cjs\nconsole.log(1);\n'), true, 'a module path comment, even without the helper');
  assert.equal(isBundledMain('"use strict";\nvar __commonJS = (cb) => cb;\n// x/browser-services/ext-api/scripting.cjs\n'), true, 'a bundle whose comments were stripped still has the helper');
});

test('checkUnbundledTree: every package file and the list are there as files; only the folder\'s own entries count; slashes and a leading slash do not matter', () => {
  const entries = [`${EXT_API_DIR}`, ...realFiles.map(file => `${EXT_API_DIR}/${file}`), `${EXT_API_DIR}/index.cjs`, `${EXT_API_DIR}/_packages.cjs`, `${EXT_API_DIR}/surfaces`, `${EXT_API_DIR}/surfaces/active-tab.cjs`];
  checkUnbundledTree(entries, realFiles);
  checkUnbundledTree(entries.map(item => '/' + item), realFiles);                                           // an app.asar's listing
  checkUnbundledTree(entries.map(item => '\\' + item.replaceAll('/', '\\')), realFiles);                    // the same listed on Windows
  const without = file => entries.filter(item => item !== `${EXT_API_DIR}/${file}`);
  assert.throws(() => checkUnbundledTree(without('scripting.cjs'), realFiles), new RegExp(`missing 1 of ${realFiles.length + 1} extension API package files \\(scripting\\.cjs\\)`));
  assert.throws(() => checkUnbundledTree(without('_packages.cjs'), realFiles), new RegExp(`missing 1 of ${realFiles.length + 1} extension API package files \\(_packages\\.cjs\\)`));
  assert.throws(() => checkUnbundledTree(entries.filter(item => !item.startsWith(`${EXT_API_DIR}/`)), realFiles), new RegExp(`missing ${realFiles.length + 1} of ${realFiles.length + 1} `), 'none of it: the list and every package');
  // a same-named file in a sub-folder is not the package
  assert.throws(() => checkUnbundledTree([`${EXT_API_DIR}/_packages.cjs`, `${EXT_API_DIR}/surfaces/a.cjs`], ['a.cjs']), /missing 1 of 2 extension API package files \(a\.cjs\)/);
  assert.throws(() => checkUnbundledTree(entries, []), /No extension API packages found/);
});

test('the count: _packages.cjs is in the total, in the bundle checks too ("missing 50 of 49" was "missing 50 of 50")', () => {
  const total = realFiles.length + 1;
  assert.throws(() => checkBundledPackages(['desktop/main.cjs'], realFiles), new RegExp(`missing ${total} of ${total} extension API package files`));
  assert.throws(() => checkBundledPackages(realFiles.map(file => `${EXT_API_DIR}/${file}`), realFiles), new RegExp(`missing 1 of ${total} extension API package files \\(_packages\\.cjs\\)`));
  assert.throws(() => checkBundledText('// desktop/main.cjs\n', realFiles), new RegExp(`missing ${total} of ${total} extension API package files`));
});

test('the script on an unbundled app folder: OK when every package and the list are files; names what is missing otherwise; never "of 49" for 50', async () => {
  await withTemp(async dir => {
    await unbundledApp(dir);
    const ok = run(dir);
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, new RegExp(`^OK: ${realFiles.length} extension API package files and _packages\\.cjs are in .* as files \\(an unbundled app`));
    assert.equal(run(path.join(dir, 'desktop/main.cjs')).status, 0, 'the main.cjs of that tree alone');
    await fs.rm(path.join(dir, EXT_API_DIR, 'scripting.cjs'));
    const lost = run(dir);
    assert.equal(lost.status, 1);
    assert.match(lost.stderr, new RegExp(`^FAIL: The unbundled app is missing 1 of ${realFiles.length + 1} extension API package files \\(scripting\\.cjs\\)`));
    await fs.rm(path.join(dir, EXT_API_DIR, '_packages.cjs'));
    const listless = run(dir);
    assert.equal(listless.status, 1);
    assert.match(listless.stderr, new RegExp(`missing 2 of ${realFiles.length + 1} extension API package files \\(_packages\\.cjs, scripting\\.cjs\\)`));
  });
});

test('the script on a Linux app.asar (the shape the laptop ran it on): OK with the packages in; a package left out of the asar fails with its name', async () => {
  await withTemp(async dir => {
    const full = await unbundledApp(path.join(dir, 'full'));
    await fs.mkdir(path.join(dir, 'out'), {recursive: true});
    await asar.createPackage(full, path.join(dir, 'out', 'app.asar'));
    const ok = run(path.join(dir, 'out', 'app.asar'));
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, new RegExp(`^OK: ${realFiles.length} extension API package files and _packages\\.cjs are in `));
    assert.match(ok.stdout, new RegExp(`${realFiles.length + 4} entries under ${EXT_API_DIR.replaceAll('/', '\\/')}`), 'the packages, index.cjs, the list and the sub-folder with its file');
    assert.equal(run(path.join(dir, 'out')).status, 0, 'the folder that holds app.asar');
    const lacking = await unbundledApp(path.join(dir, 'lacking'), {leave: ['downloads.cjs', 'tabs-renderer.cjs']});
    await asar.createPackage(lacking, path.join(dir, 'out', 'lacking.asar'));
    const lost = run(path.join(dir, 'out', 'lacking.asar'));
    assert.equal(lost.status, 1);
    assert.match(lost.stderr, new RegExp(`missing 2 of ${realFiles.length + 1} extension API package files \\(downloads\\.cjs, tabs-renderer\\.cjs\\)`));
    const listless = await unbundledApp(path.join(dir, 'listless'), {withList: false});
    await asar.createPackage(listless, path.join(dir, 'out', 'listless.asar'));
    const noList = run(path.join(dir, 'out', 'listless.asar'));
    assert.equal(noList.status, 1);
    assert.match(noList.stderr, new RegExp(`missing 1 of ${realFiles.length + 1} extension API package files \\(_packages\\.cjs\\)`));
  });
});

test('a bundled main.cjs is still checked as a bundle: package files in an unbundled tree next to it do not satisfy it', async () => {
  await withTemp(async dir => {
    await unbundledApp(dir);                                                                                // the files are all there ...
    await fs.writeFile(path.join(dir, 'desktop/main.cjs'), '"use strict";\nvar __commonJS = (cb, mod) => function __require() {};\n// desktop/main.cjs\n');   // ... but main.cjs is a bundle without them
    const bad = run(path.join(dir, 'desktop/main.cjs'));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, new RegExp(`^FAIL: The packaged main\\.cjs is missing ${realFiles.length + 1} of ${realFiles.length + 1} extension API package files`));
  });
});
