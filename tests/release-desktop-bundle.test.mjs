// The main process ships as one bundle. Things a bundle cannot see: files the source opens by path, and __dirname.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';
import {execFileSync} from 'node:child_process';
import {build as esbuildBuild} from 'esbuild';
import {bundleDesktop, runtimeAlias, workingTreeSource, rewriteDirname, extApiPackageFiles, checkBundledText, checkBundledPackages, packedCatalogs, ghosteryPreloadPathStub, EXT_API_DIR, EXTERNAL, PATH_LOADED, DATA_LOADED} from '../scripts/desktop-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = file => path.relative(root, file).replaceAll('\\', '/');
async function sources(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'vendor') out.push(...await sources(file)); } else if (/\.cjs$/.test(entry.name) && !['runtime.cjs', 'ui-preload.cjs'].includes(entry.name)) out.push(file);
  }
  return out;
}

test('__dirname follows the module into the bundle', () => {
  assert.equal(rewriteDirname('desktop/main.cjs', "path.join(__dirname,'../dist')"), "path.join(__dirname,'../dist')", 'main.cjs sits where the bundle sits');
  assert.equal(rewriteDirname('desktop/browser-services/reader.cjs', "path.join(__dirname,'vendor/x.js')"), "path.join(require('node:path').join(__dirname,\"browser-services\"),'vendor/x.js')");
  assert.equal(rewriteDirname('desktop/rewind/peek.cjs', 'a(__dirname)+b(__dirname)'), "a(require('node:path').join(__dirname,\"rewind\"))+b(require('node:path').join(__dirname,\"rewind\"))");
  assert.equal(rewriteDirname('src/runtime/core.ts', '__dirname'), '__dirname', 'only desktop sources are touched');
  assert.equal(rewriteDirname('desktop/x/y.cjs', 'my__dirnames'), 'my__dirnames', 'whole word only');
});

test('every file the main process opens by path is shipped by the release builds', async () => {
  const known = [...PATH_LOADED, ...DATA_LOADED], unaccounted = [];
  for (const file of await sources(path.join(root, 'desktop'))) {
    const text = await fs.readFile(file, 'utf8');
    for (const match of text.matchAll(/(?:join|resolve)\(\s*__dirname\s*,\s*((?:'[^']*'\s*,?\s*)+)\)/g)) {
      const target = rel(path.resolve(path.dirname(file), ...[...match[1].matchAll(/'([^']*)'/g)].map(part => part[1])));
      if (!known.some(item => target === item || target.startsWith(item + '/'))) unaccounted.push(`${rel(file)} opens ${target}`);
    }
  }
  assert.deepEqual(unaccounted, [], 'add each to PATH_LOADED (copied as is) or DATA_LOADED (copied by the release build) in scripts/desktop-bundle.mjs');
  for (const file of PATH_LOADED) await fs.access(path.join(root, file));
});

test('files copied as they are cannot be bundled, so they must not need anything but electron', async () => {
  for (const file of PATH_LOADED.filter(item => item.endsWith('.cjs'))) {
    const needs = [...(await fs.readFile(path.join(root, file), 'utf8')).matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map(match => match[1]);
    assert.deepEqual(needs.filter(name => name !== 'electron'), [], `${file} is a sandboxed preload and is copied verbatim`);
  }
});

test('the bundle is one file: every sibling inlined, only the intended packages left to require', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-bundle-'));
  try {
    const result = await bundleDesktop({root, output, plugins: [runtimeAlias(root), workingTreeSource(root)]});
    assert.deepEqual(result.warnings, []);
    const code = await fs.readFile(path.join(output, 'desktop/main.cjs'), 'utf8');
    assert.equal(/require\(\s*["']\.{1,2}\//.test(code), false, 'no relative require is left');
    const bare = new Set([...code.matchAll(/require\(\s*"([^".][^"]*)"\s*\)/g)].map(match => match[1]));
    const allowed = name => name.startsWith('node:') || builtinModules.includes(name) || EXTERNAL.some(external => name === external || name.startsWith(external + '/')) || ['electron'].includes(name);
    assert.deepEqual([...bare].filter(name => !allowed(name)), [], 'every other package is inside the bundle');
    assert.ok(code.includes('createContentBlocking') && code.includes('reduceBrowser'), 'services and the reducer are inside');
    assert.equal((code.match(/var ElectronBlocker = class/g) || []).length, 1, 'one copy of the blocker library, not one per file');
    assert.ok((await fs.stat(path.join(output, 'sourcemaps/main.cjs.map'))).size > 100000, 'the source map is kept for crash stacks, outside desktop/');
    await assert.rejects(fs.access(path.join(output, 'desktop/main.cjs.map')), 'and not shipped next to the product');
  } finally { await fs.rm(output, {recursive: true, force: true}); }
});

// 13.8: the extension API packages (desktop/browser-services/ext-api/) were left out of the packaged Mac and Windows apps because the loader read a folder at run time.
// A bundler follows only literal require() names, so nothing in the main process may load code by a name it reads at run time or from a folder.
test('nothing in the main process loads code by a name the bundler cannot see', async () => {
  const allowed = {
    'desktop/mac-material.cjs': 'a native addon (.node), copied by the release build (DATA_LOADED)',
    'desktop/passwords/mac-authentication.cjs': 'the same native addon',
    'desktop/browser-services/mac-passkeys.cjs': 'the same native addon',
    'desktop/browser-services/ext-api/index.cjs': 'a folder a caller names (a test\'s own packages); with no folder the packages come from _packages.cjs, which the bundler follows',
  };
  const offenders = [];
  for (const file of await sources(path.join(root, 'desktop'))) {
    const name = rel(file), text = await fs.readFile(file, 'utf8');
    for (const match of text.matchAll(/(?<![.\w])require\(\s*([^'"`\s)][^)]{0,80})/g)) {
      if (name in allowed || /^(?:node:path|'electron')/.test(match[1])) continue;
      offenders.push(`${name}: require(${match[1].trim()}...) is not a literal name`);
    }
    for (const match of text.matchAll(/readdir(?:Sync)?\(\s*([^,)]{0,60})/g)) if (/__dirname/.test(match[1]) && !(name in allowed)) offenders.push(`${name}: reads the source folder at run time (${match[1].trim()})`);
  }
  assert.deepEqual(offenders, [], 'list the module in a file the bundler follows (see ext-api/_packages.cjs), or add the file to the allowed list here with the reason');
});

test('the real main bundle carries every extension API package, and the checks that guard the release builds see it', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-bundle-packages-'));
  try {
    const files = extApiPackageFiles((await fs.readdir(path.join(root, EXT_API_DIR))).map(name => `${EXT_API_DIR}/${name}`));
    assert.ok(files.length >= 40, 'the folder has its packages: ' + files.length);
    const result = await bundleDesktop({root, output, plugins: [runtimeAlias(root), workingTreeSource(root)]});   // throws itself when a package is missing (checkBundledPackages)
    const inputs = Object.keys(result.metafile.inputs);
    for (const file of files) assert.ok(inputs.some(item => item.endsWith(`${EXT_API_DIR}/${file}`)), `${file} is in the bundle`);
    const code = await fs.readFile(path.join(output, 'desktop/main.cjs'), 'utf8');
    assert.ok(code.includes('scripting.activeTab.executeScript'), 'the scripting package is in the main bundle (the marker the packaged 13.7 and first 13.8 builds lacked)');
    checkBundledText(code, files);
    assert.throws(() => checkBundledText(code.replace(`// ${EXT_API_DIR}/scripting.cjs`, '// gone'), files), new RegExp(`missing 1 of ${files.length + 1} extension API package files \\(scripting\\.cjs\\)`));
    const script = path.join(root, 'scripts', 'check-bundled-ext-api.mjs');
    assert.match(execFileSync(process.execPath, [script, path.join(output, 'desktop/main.cjs')], {encoding: 'utf8'}), /^OK: \d+ extension API package files are in /);
    await fs.writeFile(path.join(output, 'desktop/stripped.cjs'), code.replaceAll(`// ${EXT_API_DIR}/`, '// x/'));
    assert.throws(() => execFileSync(process.execPath, [script, path.join(output, 'desktop/stripped.cjs')], {encoding: 'utf8', stdio: 'pipe'}), error => error.status === 1 && /missing \d+ of \d+ extension API package files/.test(String(error.stderr)));
  } finally { await fs.rm(output, {recursive: true, force: true}); }
});

// 13.8: runtimeAlias once matched the bare file name ./runtime.cjs, so ext-api/runtime.cjs (the chrome.runtime package) became the reducer in the packaged apps and no package installed.
test('runtimeAlias is exact: it aliases desktop/runtime.cjs and desktop/i18n.cjs from whichever folder asks, and never a same-named file elsewhere', async () => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-alias-'));
  const write = async (file, text) => { await fs.mkdir(path.dirname(path.join(work, file)), {recursive: true}); await fs.writeFile(path.join(work, file), text); };
  try {
    await write('src/runtime/core.ts', "export const WHO = 'reducer';");
    await write('src/i18n/main.ts', "export const WHO = 'i18n';");
    await write('desktop/main.cjs', "exports.fromDesktop = require('./runtime.cjs').WHO; exports.i18nFromDesktop = require('./i18n.cjs').WHO; exports.service = require('./browser-services/svc.cjs'); exports.pkg = require('./browser-services/ext-api/pkg.cjs');");
    await write('desktop/browser-services/svc.cjs', "module.exports = {runtime: require('../runtime.cjs').WHO, i18n: require('../i18n.cjs').WHO};");
    await write('desktop/browser-services/ext-api/pkg.cjs', "module.exports = {runtime: require('./runtime.cjs'), i18n: require('./i18n.cjs')};");
    await write('desktop/browser-services/ext-api/runtime.cjs', "module.exports = {install() {}, who: 'ext-api runtime package'};");
    await write('desktop/browser-services/ext-api/i18n.cjs', "module.exports = {who: 'ext-api i18n package'};");
    const out = path.join(work, 'out.cjs');
    await esbuildBuild({absWorkingDir: work, entryPoints: [path.join(work, 'desktop/main.cjs')], outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent', plugins: [runtimeAlias(work)]});
    const bundled = (await import('node:module')).createRequire(import.meta.url)(out);
    assert.equal(bundled.fromDesktop, 'reducer', "./runtime.cjs from desktop/");
    assert.equal(bundled.i18nFromDesktop, 'i18n', "./i18n.cjs from desktop/");
    assert.deepEqual(bundled.service, {runtime: 'reducer', i18n: 'i18n'}, "../runtime.cjs and ../i18n.cjs from desktop/browser-services/");
    assert.equal(bundled.pkg.runtime.who, 'ext-api runtime package', 'a ./runtime.cjs in another folder is that folder\'s file');
    assert.equal(typeof bundled.pkg.runtime.install, 'function');
    assert.equal(bundled.pkg.i18n.who, 'ext-api i18n package');
  } finally { await fs.rm(work, {recursive: true, force: true}); }
});

test('an alias that matches by file name is caught twice: when the bundle is built and in a finished main.cjs', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-bundle-bad-alias-'));
  const overMatching = {name: 'old-runtime-alias', setup(build) {
    build.onResolve({filter: /^(?:\.{1,2}\/)+runtime\.cjs$/}, () => ({path: path.join(root, 'src/runtime/core.ts')}));
    build.onResolve({filter: /^(?:\.{1,2}\/)+i18n\.cjs$/}, () => ({path: path.join(root, 'src/i18n/main.ts')}));
  }};
  try {
    // 1. the build itself refuses (checkBundledPackages reads what _packages.cjs required from the esbuild metafile)
    await assert.rejects(bundleDesktop({root, output, plugins: [overMatching, workingTreeSource(root)]}), /bound to the wrong module in the bundle: runtime\.cjs \(bound to src\/runtime\/core\.ts\)/);
    // 2. a finished bad main.cjs fails the text check (what scripts/check-bundled-ext-api.mjs runs on a packaged app)
    const bad = path.join(output, 'bad-main.cjs');
    await esbuildBuild({absWorkingDir: root, entryPoints: [path.join(root, 'desktop/main.cjs')], outfile: bad, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: EXTERNAL, logLevel: 'silent', plugins: [ghosteryPreloadPathStub(), packedCatalogs(), overMatching, workingTreeSource(root)]});
    const files = extApiPackageFiles((await fs.readdir(path.join(root, EXT_API_DIR))).map(name => `${EXT_API_DIR}/${name}`));
    const badText = await fs.readFile(bad, 'utf8');
    assert.throws(() => checkBundledText(badText, files), /bound to the wrong module in the packaged main\.cjs: runtime\.cjs/);
    // 3. the same check passes on the good bundle, and the metafile shows each package file bound to its own ext-api module
    const good = await bundleDesktop({root, output: path.join(output, 'good'), plugins: [runtimeAlias(root), workingTreeSource(root)]});
    const listKey = Object.keys(good.metafile.inputs).find(item => item.endsWith(`${EXT_API_DIR}/_packages.cjs`));
    for (const entry of good.metafile.inputs[listKey].imports) assert.ok(entry.path.endsWith(`${EXT_API_DIR}/${entry.original.slice(2)}`), `${entry.original} is bound to ${entry.path}`);
    checkBundledText(await fs.readFile(path.join(output, 'good', 'desktop/main.cjs'), 'utf8'), files);
    assert.ok(Object.keys(good.metafile.inputs).includes('src/runtime/core.ts') && Object.keys(good.metafile.inputs).includes('src/i18n/main.ts'), 'the reducer and the main-process catalogs are still aliased for the files that ask for desktop/runtime.cjs and desktop/i18n.cjs');
    assert.equal(Object.keys(good.metafile.inputs).some(item => item === 'desktop/runtime.cjs' || item === 'desktop/i18n.cjs'), false, 'and no built copy of them is bundled');
    assert.throws(() => checkBundledPackages(good.metafile.inputs, [...files, 'ghost.cjs']), new RegExp(`missing 1 of ${files.length + 2} extension API package files \\(ghost\\.cjs\\)`));
  } finally { await fs.rm(output, {recursive: true, force: true}); }
});
