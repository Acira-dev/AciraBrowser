// The main process ships as one bundle. Things a bundle cannot see: files the source opens by path, and __dirname.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';
import {bundleDesktop, runtimeAlias, workingTreeSource, rewriteDirname, EXTERNAL, PATH_LOADED, DATA_LOADED} from '../scripts/desktop-bundle.mjs';

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
