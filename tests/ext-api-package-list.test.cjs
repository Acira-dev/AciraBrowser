'use strict';
// 13.8: the extension API work packages (desktop/browser-services/ext-api/) must be in the release bundle.
// Until 13.8 the loader read the ext-api folder at run time and require()d each file it found. The release builds bundle the main process into ONE file and rewrite
// __dirname to a folder that does not exist in the packaged app, so the folder read failed inside a try/catch and returned []: the packaged Mac and Windows apps shipped
// NONE of Acira's own extension API work (activeTab / scripting shims, downloads, storage, runtime, tabs, windows, cookies, side panel, permissions, webRequest, ...).
// Linux ships the unbundled tree, which is why it worked there. _packages.cjs now lists every package by literal name so the bundler follows each one.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');

const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'desktop/browser-services/ext-api');
const extApi = require('../desktop/browser-services/ext-api/index.cjs');
const written = require('../desktop/browser-services/ext-api/_packages.cjs');
const onDisk = () => fs.readdirSync(folder, {withFileTypes: true}).filter(entry => entry.isFile() && entry.name.endsWith('.cjs') && entry.name !== 'index.cjs' && !entry.name.startsWith('_')).map(entry => entry.name).sort();

test('_packages.cjs lists exactly the package files of the folder, once each and sorted: a package added without listing it fails here', () => {
  const files = onDisk();
  assert.deepEqual([...written.FILES], files, 'add each new ext-api/<name>.cjs and <name>-renderer.cjs to FILES and modules() in ext-api/_packages.cjs');
  assert.equal(new Set(written.FILES).size, written.FILES.length);
  assert.ok(files.length >= 40, 'the folder has its packages: ' + files.length);
  const source = fs.readFileSync(path.join(folder, '_packages.cjs'), 'utf8');
  for (const file of files) assert.ok(source.includes(`require('./${file}')`), `${file} is required by its literal name (a bundler cannot follow a name read at run time)`);
  assert.deepEqual(Object.keys(written.modules()).sort(), files, 'modules() has an entry for every listed file');
});

test('every listed file exports the package contract: main files install(api), renderer files renderer(acira), both name their namespaces', () => {
  const modules = written.modules();
  for (const [file, mod] of Object.entries(modules)) {
    assert.ok(Array.isArray(mod.namespaces) && mod.namespaces.length, `${file} names its namespaces`);
    if (file.endsWith('-renderer.cjs')) assert.equal(typeof mod.renderer, 'function', `${file} exports renderer(acira)`);
    else assert.equal(typeof mod.install, 'function', `${file} exports install(api)`);
  }
});

test('loadPackages() with no folder gives every package of the list, the same ones reading the folder gives', () => {
  const listed = extApi.loadPackages({fresh: true}), read = extApi.loadPackages({dir: folder, fresh: true});
  const shape = list => list.map(entry => [entry.name, entry.files.join('+'), [...entry.namespaces].sort().join(','), !!entry.install, !!entry.renderer]);
  assert.deepEqual(shape(listed), shape(read));
  assert.ok(listed.filter(entry => entry.install).length >= 20, 'the main-process packages: ' + listed.filter(entry => entry.install).length);
  assert.ok(listed.some(entry => entry.name === 'downloads' && entry.install && entry.renderer), 'downloads has both halves');
  assert.ok(listed.some(entry => entry.name === 'scripting' && entry.install && entry.renderer), 'scripting has both halves');
});

test('a build that finds no packages THROWS (code EXT_API_NO_PACKAGES) instead of returning an empty list; a list that disagrees with the folder throws too', () => {
  const key = require.resolve('../desktop/browser-services/ext-api/_packages.cjs'), real = require.cache[key].exports;
  try {
    require.cache[key].exports = {FILES: Object.freeze([]), modules: () => ({})};
    assert.throws(() => extApi.loadPackages({fresh: true}), error => error.code === 'EXT_API_NO_PACKAGES' && /lost them/.test(error.message));
    const [first, ...rest] = real.FILES, modules = real.modules();
    require.cache[key].exports = {FILES: Object.freeze(rest), modules: () => Object.fromEntries(rest.map(file => [file, modules[file]]))};
    assert.throws(() => extApi.loadPackages({fresh: true}), error => /disagree/.test(error.message) && error.message.includes(first));
  } finally { require.cache[key].exports = real; extApi.loadPackages({fresh: true}); }
  // A folder named by the caller (a test's own packages) that has none is still an empty list, as before.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-no-packages-'));
  try { assert.deepEqual(extApi.loadPackages({dir: empty, fresh: true}), []); } finally { fs.rmSync(empty, {recursive: true, force: true}); }
});

test('extension-apis.cjs says ANY package problem loudly (stderr and the local trace), per profile session, and a clean session writes the line a packaged launch check looks for', () => {
  const source = fs.readFileSync(path.join(root, 'desktop/browser-services/extension-apis.cjs'), 'utf8');
  assert.match(source, /trace\('ext-api packages FAILED',storeKey,`\$\{packages\.packages\.length\} of \$\{wanted\} installed`,problems\.join\(' \| '\)\)/);
  assert.match(source, /trace\('ext-api packages installed',storeKey,packages\.packages\.length\)/);
  assert.match(source, /console\.error\(`\[ext-api\] \$\{problems\.length\} package problem\(s\)/);
  assert.match(source, /console\.error\('\[ext-api\] packages not installed: '/);
  assert.match(source, /\.\.\.\(list\.problems\|\|\[\]\)\.map\(/, 'problems found while loading the list are reported');
  assert.match(source, /\.\.\.\(packages\.failed\|\|\[\]\)\.map\(/, 'and so are install() failures');
});

test('one package that breaks the contract does not cost the other 21: the rest load, the problem is on the list (and on stderr)', () => {
  const key = require.resolve('../desktop/browser-services/ext-api/_packages.cjs'), real = require.cache[key].exports;
  const errors = [], original = console.error;
  try {
    const modules = real.modules(), broken = {...modules, 'runtime.cjs': {namespaces: ['runtime']}};      // no install(): what the bundle once bound ext-api/runtime.cjs to
    require.cache[key].exports = {FILES: real.FILES, modules: () => broken};
    console.error = (...args) => errors.push(args.join(' '));
    const list = extApi.loadPackages({fresh: true});
    assert.deepEqual(list.problems.map(item => item.file), ['runtime.cjs']);
    assert.match(list.problems[0].message, /ext-api\/runtime\.cjs must export install\(api\)/);
    assert.equal(list.filter(entry => entry.install).length, extApi.loadPackages({dir: folder, fresh: true}).filter(entry => entry.install).length - 1, 'the other main-process packages loaded');
    assert.ok(errors.some(text => /must export install\(api\).*was left out/.test(text)), 'said on stderr: ' + errors.join(' | '));
    assert.equal(Object.keys(list).includes('problems'), false, 'the problems are not part of the array\'s own list');
  } finally { console.error = original; require.cache[key].exports = real; extApi.loadPackages({fresh: true}); }
});

test('a folder a caller names (a test\'s own packages) is still read strictly: a package without install(api) throws', () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-strict-packages-'));
  try {
    fs.writeFileSync(path.join(work, 'demo.cjs'), "module.exports = {namespaces: ['runtime']};\n");
    assert.throws(() => extApi.loadPackages({dir: work, fresh: true}), /ext-api\/demo\.cjs must export install\(api\)/);
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
});

test('installPackages reports an install() that throws in `failed` (and logs it), and goes on with the other packages', () => {
  const log = [], list = [
    {name: 'good-one', namespaces: [], install: () => ({})},
    {name: 'bad-one', namespaces: [], install: () => { throw new Error('boom'); }},
    {name: 'good-two', namespaces: [], install: () => ({})},
  ];
  const router = {listeners: new Map(), addListener() {}, sendEvent() {}, removeListener() {}};
  const installed = extApi.installPackages({session: {}, runtime: {}, router, userData: os.tmpdir(), storeKey: 'p', emit() {}}, {packages: list, log: (...args) => log.push(args.join(' '))});
  assert.deepEqual(installed.packages, ['good-one', 'good-two']);
  assert.deepEqual(installed.failed, [{name: 'bad-one', message: 'boom'}]);
  assert.match(log[0], /bad-one was not installed/);
  installed.dispose();
});

test('THE PACKAGED SITUATION: the loader bundled into one file, with __dirname rewritten to a folder that does not exist, still finds every package, and its renderer source parses', async () => {
  const {workingTreeSource, runtimeAlias} = await import('../scripts/desktop-bundle.mjs');
  const {build} = require('esbuild');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-ext-api-bundle-')), out = path.join(work, 'desktop', 'ext-api-loader.cjs');
  try {
    // the SAME plugins the release builds use (runtimeAlias turned ext-api/runtime.cjs into the reducer once, and no test noticed)
    await build({absWorkingDir: root, entryPoints: [path.join(folder, 'index.cjs')], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'electron-chrome-extensions'], logLevel: 'silent', plugins: [runtimeAlias(root), workingTreeSource(root)]});
    const bundled = fs.readFileSync(out, 'utf8');
    assert.ok(bundled.includes('scripting.activeTab.executeScript'), 'the scripting package is inside the bundle');
    assert.ok(!fs.existsSync(path.join(work, 'desktop', 'browser-services', 'ext-api')), 'the folder the rewritten __dirname points at does not exist, as in the packaged app');
    const script = `const api=require(${JSON.stringify(out)});const p=api.loadPackages({fresh:true});const src=api.rendererSource({packages:p});process.stdout.write(JSON.stringify({n:p.length,main:p.filter(x=>x.install).length,renderer:p.filter(x=>x.renderer).length,names:p.map(x=>x.name),problems:p.problems,src}));`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], {env: {...process.env, NODE_PATH: path.join(root, 'node_modules')}, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}));
    const expected = extApi.loadPackages({fresh: true});
    assert.deepEqual(result.problems, [], 'no package of the bundle breaks the contract (every main file exports install(api), every renderer file renderer(acira))');
    assert.equal(result.n, expected.length, 'every package is found in the bundle');
    assert.equal(result.main, expected.filter(entry => entry.install).length);
    assert.equal(result.renderer, expected.filter(entry => entry.renderer).length);
    assert.deepEqual([...result.names].sort(), expected.map(entry => entry.name).sort());
    assert.doesNotThrow(() => new vm.Script(`const acira_ext = ${result.src};`), 'the preload text the bundled renderers produce is valid JavaScript');
    assert.ok(result.src.includes('downloads') && result.src.includes('scripting'), 'and carries the packages\' renderers');
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
});

test('the release bundler checks its own output: a package file missing from the bundle fails the build and names it', async () => {
  const {checkBundledPackages, extApiPackageFiles, EXT_API_DIR} = await import('../scripts/desktop-bundle.mjs');
  assert.equal(EXT_API_DIR, 'desktop/browser-services/ext-api');
  const files = extApiPackageFiles([...written.FILES.map(file => `${EXT_API_DIR}/${file}`), `${EXT_API_DIR}/index.cjs`, `${EXT_API_DIR}/_settings.cjs`, `${EXT_API_DIR}/_packages.cjs`, `${EXT_API_DIR}/downloads/item.cjs`, 'desktop/main.cjs']);
  assert.deepEqual(files, [...written.FILES], 'the loader\'s rule: top-level .cjs files, not index.cjs, not _-files, not sub-folders');
  const inputs = [...files.map(file => `${EXT_API_DIR}/${file}`), `${EXT_API_DIR}/_packages.cjs`, `${EXT_API_DIR}/index.cjs`];
  assert.doesNotThrow(() => checkBundledPackages(inputs, files));
  assert.doesNotThrow(() => checkBundledPackages(inputs.map(item => 'immutable-committed-source:' + item), files), 'a plugin namespace in front of the path is fine');
  assert.throws(() => checkBundledPackages(inputs.filter(item => !item.endsWith('/scripting.cjs')), files), /missing 1 of \d+ extension API package files \(scripting\.cjs\)/);
  assert.throws(() => checkBundledPackages(inputs.filter(item => !item.endsWith('/_packages.cjs')), files), /_packages\.cjs/);
  assert.throws(() => checkBundledPackages([], []), /No extension API packages found/);
});

test('both committed-source release builds (Mac and Windows) pass the committed tree\'s package files to the bundler; the working-tree build reads the folder', () => {
  for (const file of ['release-build-mac-head.mjs', 'release-build-head.mjs']) {
    const source = fs.readFileSync(path.join(root, 'scripts', file), 'utf8');
    assert.match(source, /packageFiles:extApiPackageFiles\(\[\.\.\.tree\.keys\(\)\]\)/, file);
  }
  const bundler = fs.readFileSync(path.join(root, 'scripts', 'desktop-bundle.mjs'), 'utf8');
  assert.match(bundler, /checkBundledPackages\(result\.metafile\.inputs,/);
});

test('the BUNDLED package map binds every entry to the ext-api file it names: main files export install(api), renderer files renderer(acira), and runtime.cjs is the chrome.runtime package, not the reducer', async () => {
  const {workingTreeSource, runtimeAlias} = await import('../scripts/desktop-bundle.mjs');
  const {build} = require('esbuild');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'acira-ext-api-map-')), out = path.join(work, 'desktop', 'packages-map.cjs');
  try {
    await build({absWorkingDir: root, entryPoints: [path.join(folder, '_packages.cjs')], outfile: out, bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron', 'electron-chrome-extensions'], logLevel: 'silent', plugins: [runtimeAlias(root), workingTreeSource(root)]});
    const script = `const w=require(${JSON.stringify(out)});const m=w.modules();const rows=Object.keys(m).map(f=>({f,install:typeof m[f].install,renderer:typeof m[f].renderer,ns:Array.isArray(m[f].namespaces)?m[f].namespaces:null}));process.stdout.write(JSON.stringify({files:w.FILES,rows}));`;
    const result = JSON.parse(execFileSync(process.execPath, ['-e', script], {env: {...process.env, NODE_PATH: path.join(root, 'node_modules')}, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}));
    assert.deepEqual(result.rows.map(row => row.f), [...written.FILES]);
    const wrong = result.rows.filter(row => (row.f.endsWith('-renderer.cjs') ? row.renderer !== 'function' : row.install !== 'function') || !row.ns || !row.ns.length).map(row => row.f);
    assert.deepEqual(wrong, [], 'each bundled module is the ext-api package its file name says');
    const runtime = result.rows.find(row => row.f === 'runtime.cjs');
    assert.equal(runtime.install, 'function');
    assert.ok(runtime.ns.includes('runtime'), 'ext-api/runtime.cjs owns the runtime namespace');
  } finally { fs.rmSync(work, {recursive: true, force: true}); }
});
