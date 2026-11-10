// Memory (13.5): V8 keeps every script's source text for the life of the renderer, and any character above U+00FF makes the whole script a two-byte string.
// The interface chunks (App 1.4 MB, index 0.5 MB: held by each of the two interface renderers) and the preloads every page reads (autoconsent 177 KB, ...) had a few
// hundred such characters (an ellipsis, a curly apostrophe, an arrow in a regular expression or a comment). They are Latin-1 text now, with the program unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {build as esbuild} from 'esbuild';
import {build as viteBuild, loadConfigFromFile} from 'vite';
import {oneByteSource, oneByteFile, sameProgram, hasWideText, countWide, LATIN1, ASCII} from '../scripts/one-byte-source.mjs';
import {oneByteChunk, oneByteChunks, worthEscaping} from '../scripts/one-byte-chunks.mjs';
import {bundleAnswerPreload, ANSWER_PRELOAD_ENTRY, PATH_LOADED} from '../scripts/desktop-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const run = code => vm.runInNewContext(code);
const walk = async dir => { const out = []; for (const entry of await fs.readdir(dir, {withFileTypes: true})) { const file = path.join(dir, entry.name); if (entry.isDirectory()) out.push(...await walk(file)); else out.push(file); } return out; };
/** The highest UTF-16 unit of a text (a script is held as one byte per character exactly when this is at most 0xFF). */
const highest = text => { let max = 0; for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); if (c > max) max = c; } return max; };

test('Latin-1 limit: accented letters stay, everything above U+00FF becomes the escape that means the same', () => {
  const text = 'var r = /Rücktaste|Retour arrière|[‐-―−]|‘x’/; // café … “quoted”\nvar s = "ok… é", t = `${1}→${2} é`, u = /[̀-ͯ]/g;';
  const out = oneByteSource(text, LATIN1);
  assert.equal(highest(out) <= LATIN1, true);
  assert.equal(hasWideText(out, LATIN1), false);
  assert.equal(hasWideText(out, ASCII), true, 'é is still there: Latin-1 is the limit, not ASCII');
  assert.ok(out.includes('Rücktaste') && out.includes('arrière') && out.includes('café') && out.includes('é"'), 'Latin-1 letters are not touched');
  assert.ok(out.includes('\\u2026') && out.includes('\\u2192') && out.includes('\\u201C') && out.includes('[\\u2010-\\u2015\\u2212]'));
  assert.equal(sameProgram(text, out), null);
  const pick = code => run(`${code}; JSON.stringify([s, t, r.test("Rücktaste"), r.test("‘x’"), r.test("−"), "e\\u0301".replace(u, "")])`);
  assert.equal(pick(out), pick(text));
});

test('Latin-1 limit: a backslash before the character, astral characters and class ranges keep their meaning', () => {
  for (const text of ['var r = /a\\…b/, s = "x\\…y";', 'var r = /a\\\\…b/, s = "x\\\\…y";', 'var e = /😀/u, f = /[😀-😎]/u, g = "😀";']) {
    const out = oneByteSource(text, LATIN1);
    assert.equal(highest(out) <= LATIN1, true, text);
    assert.equal(sameProgram(text, out), null, text);
    const probe = code => run(`${code}; JSON.stringify([typeof s === "string" ? s : 0, typeof r === "object" ? [r.test("a…b"), r.test("a\\\\…b")] : 0, typeof e === "object" ? [e.test("\\u{1F600}"), f.test("\\u{1F60A}"), f.test("a"), g] : 0])`);
    assert.equal(probe(out), probe(text), text);
  }
});

test('Latin-1 limit: what an escape cannot keep identical still stops the build, a Latin-1 name does not', () => {
  assert.throws(() => oneByteSource('var t = String.raw`a…b`;', LATIN1), /tagged template/);
  assert.throws(() => oneByteSource('var Ω = 1;', LATIN1), /identifier/);
  assert.throws(() => oneByteSource('var s = "a\\\u2028b…";', LATIN1), /line continuation/);
  const text = 'var café = "…"; café;';
  assert.equal(run(oneByteSource(text, LATIN1)), '\u2026');
  assert.throws(() => oneByteSource(text, ASCII), /identifier/, 'for the main-process bundle (ASCII) the Latin-1 name is still refused');
});

test('ES module text (import, export, import.meta, dynamic import) is rewritten and compared the same way', async () => {
  const text = 'import a from "./a.js";\nconst x = import.meta.url, l = () => import("./b.js");\n/* “c” */ export default {a, x, l, s: "Searching…", r: /…/u};';
  const result = await oneByteChunk(text, {name: 'sample.js'});
  assert.equal(result.changed, true);
  assert.equal(highest(result.code) <= LATIN1, true);
  assert.equal(sameProgram(text, result.code), null);
  assert.ok(result.code.startsWith('import a from "./a.js";') && result.code.includes('"Searching\\u2026"'));
  assert.throws(() => oneByteSource(text, LATIN1), /Unexpected token|import|export|SyntaxError/i, 'a script syntax check cannot read a module: chunks pass {module: true}');
  assert.equal(oneByteSource(text, LATIN1, {module: true}), result.code);
});

test('a chunk that is mostly such characters is left alone: its escapes would be longer than the two-byte string', async () => {
  assert.equal(worthEscaping(1000, 99), true);
  assert.equal(worthEscaping(1000, 101), false);
  const russian = 'export default {a: "' + 'Привет, мир '.repeat(100) + '"};';
  const result = await oneByteChunk(russian, {name: 'ru.js'});
  assert.equal(result.changed, false);
  assert.equal(result.dense, true);
  assert.equal(result.code, russian);
  const plain = 'export default {a: "abc"};';
  assert.deepEqual(await oneByteChunk(plain), {code: plain, wide: 0, changed: false, dense: false});
  // 200 accented letters and one curly apostrophe: rewritten (the apostrophe only).
  const french = 'export default {a: "' + 'é'.repeat(200) + '’"};';
  const done = await oneByteChunk(french);
  assert.equal(done.changed, true);
  assert.equal(done.code, 'export default {a: "' + 'é'.repeat(200) + '\\u2019"};');
});

test('oneByteFile rewrites a script in place, proves it means the same, and leaves a Latin-1 file alone', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-onebyte-file-'));
  try {
    const file = path.join(dir, 'p.cjs');
    await fs.writeFile(file, 'const r = /[‘’]/g; // see “this”\nmodule.exports = "é…".replace(r, "");');
    assert.equal(await oneByteFile(file, LATIN1), true);
    const text = await fs.readFile(file, 'utf8');
    assert.equal(highest(text) <= LATIN1, true);
    assert.equal(await oneByteFile(file, LATIN1), false);
    const module = {exports: null};
    new Function('module', text)(module);
    assert.equal(module.exports, 'é…');
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});

/** The interface, built twice from the real Vite config: as it is (with the plugin) and without the plugin. */
async function buildInterface(withPlugin) {
  const loaded = await loadConfigFromFile({command: 'build', mode: 'production'}, path.join(root, 'vite.config.ts'), root);
  const plugins = (loaded.config.plugins || []).flat(Infinity).filter(plugin => withPlugin || plugin?.name !== oneByteChunks().name);
  assert.equal(plugins.some(plugin => plugin?.name === oneByteChunks().name), withPlugin, withPlugin ? 'vite.config.ts uses oneByteChunks()' : 'the plain build has no such plugin');
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), withPlugin ? 'acira-onebyte-ui-' : 'acira-plain-ui-'));
  await viteBuild({...loaded.config, configFile: false, root, plugins, publicDir: false, build: {...loaded.config.build, outDir, emptyOutDir: true}, logLevel: 'silent'});
  return outDir;
}

test('every built script of the interface is Latin-1 text and the same program as the plain build', {timeout: 240000}, async () => {
  const built = await buildInterface(true), plain = await buildInterface(false);
  try {
    const files = (await walk(built)).filter(file => file.endsWith('.js')).map(file => path.relative(built, file).split(path.sep).join('/')).sort();
    const plainFiles = (await walk(plain)).filter(file => file.endsWith('.js')).map(file => path.relative(plain, file).split(path.sep).join('/')).sort();
    assert.deepEqual(files, plainFiles, 'the plugin neither adds nor drops a file');
    assert.ok(files.some(file => /^assets\/App-.+\.js$/.test(file)) && files.some(file => /^assets\/index-.+\.js$/.test(file)), 'the two big chunks are in the build');
    const dense = [];
    for (const file of files) {
      const after = await fs.readFile(path.join(built, file), 'utf8'), before = await fs.readFile(path.join(plain, file), 'utf8');
      if (highest(after) <= LATIN1) {
        if (before !== after) assert.equal(sameProgram(before, after), null, `${file} means the same as the plain build`);
        continue;
      }
      // Above U+00FF after the build: only a catalog that is mostly such characters (a language in another script), unchanged.
      assert.equal(after, before, `${file} is left as it is`);
      assert.equal(worthEscaping(after.length, countWide(after, LATIN1)), false, `${file} still has characters above U+00FF although escapes would have paid`);
      dense.push(file.replace(/^assets\//, '').replace(/-[\w-]{8}\.js$/, ''));
    }
    assert.deepEqual(dense.sort(), ['ar', 'hi', 'ja', 'ko', 'ru', 'zh-CN'], 'only the catalogs written in Arabic, Devanagari, Japanese, Korean, Cyrillic and Chinese script stay two-byte');
    // The point of it: the chunks both interface renderers load were two-byte before.
    for (const name of [/^assets\/App-.+\.js$/, /^assets\/index-.+\.js$/]) {
      const file = files.find(candidate => name.test(candidate));
      assert.equal(highest(await fs.readFile(path.join(built, file), 'utf8')) <= LATIN1, true, file);
    }
    for (const file of files.filter(file => /^assets\/(?:fr|de|es|it|pt-BR|tr)-/.test(file))) assert.equal(highest(await fs.readFile(path.join(built, file), 'utf8')) <= LATIN1, true, `${file}: the catalog of a language written in the Latin alphabet`);
    // Every language catalog (a chunk that is nothing but `const e = {...}; export {e as default}`) evaluates to the very same object: no letter changed in any of the 12 other languages.
    const catalogs = files.filter(file => /^assets\/(?:[a-z]{2}|pt-BR|zh-CN)-[\w-]{8}\.js$/.test(file));
    assert.equal(catalogs.length, 12, 'the twelve languages besides English (which is inside the entry chunk)');
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-onebyte-catalogs-'));
    try {
      for (const file of catalogs) {
        const load = async (dir, tag) => { const copy = path.join(scratch, `${tag}-${path.basename(file)}.mjs`); await fs.copyFile(path.join(dir, file), copy); return (await import(pathToFileURL(copy).href)).default; };
        const after = await load(built, 'after'), before = await load(plain, 'before');
        assert.ok(Object.keys(before).length > 1000, `${file} is a catalog`);
        assert.deepStrictEqual(after, before, `${file} holds the same text`);
      }
    } finally { await fs.rm(scratch, {recursive: true, force: true}); }
    // The scripts in public/ are copied into dist/ as they are (native-dialog.js, share.js): they must be Latin-1 in the source.
    for (const file of (await walk(path.join(root, 'public'))).filter(file => file.endsWith('.js'))) assert.equal(highest(await fs.readFile(file, 'utf8')) <= LATIN1, true, path.relative(root, file));
    // The built page itself.
    const html = await fs.readFile(path.join(built, 'index.html'), 'utf8');
    assert.match(html, /<script type="module" crossorigin src="\.\/assets\/index-[\w-]+\.js">/);
  } finally { await fs.rm(built, {recursive: true, force: true}); await fs.rm(plain, {recursive: true, force: true}); }
});

test('the cookie-banner preload every frame of every page reads is Latin-1 and the same program as esbuild wrote', {timeout: 120000}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-onebyte-answer-'));
  try {
    const outfile = path.join(dir, 'autoconsent-preload.cjs'), plainFile = path.join(dir, 'plain.cjs');
    const result = await bundleAnswerPreload({root, outfile, metafile: true});
    assert.deepEqual(result.warnings, []);
    const text = await fs.readFile(outfile, 'utf8');
    assert.equal(highest(text) <= LATIN1, true, 'no character above U+00FF');
    new vm.Script(text, {filename: 'autoconsent-preload.cjs'});
    await esbuild({absWorkingDir: root, entryPoints: [ANSWER_PRELOAD_ENTRY], outfile: plainFile, bundle: true, platform: 'browser', format: 'cjs', target: 'chrome130', external: ['electron'], legalComments: 'inline', logLevel: 'silent'});
    const plain = await fs.readFile(plainFile, 'utf8');
    assert.equal(sameProgram(plain, text), null);
    assert.ok(text.length < plain.length * 1.1, 'the escapes add only a few KB to a 177 KB script');
    assert.deepEqual(Object.values(result.metafile.outputs).flatMap(file => file.imports.filter(entry => entry.external && entry.path !== 'electron')), [], 'bundled completely, like the other builds expect');
  } finally { await fs.rm(dir, {recursive: true, force: true}); }
});

test('the four builds that write the cookie-banner preload all go through bundleAnswerPreload', async () => {
  for (const file of ['scripts/build-ui-preload.mjs', 'scripts/release-build.mjs', 'scripts/release-build-head.mjs', 'scripts/release-build-mac-head.mjs']) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    assert.match(text, /bundleAnswerPreload\(/, file);
    assert.doesNotMatch(text, /entryPoints:\[['"]desktop\/browser-services\/autoconsent-preload-entry\.cjs['"]\]/, `${file} bundles it by itself, without the Latin-1 rewrite`);
  }
});

test('the committed-source builds carry the helpers vite.config.ts imports beside the captured config', async () => {
  const config = await fs.readFile(path.join(root, 'vite.config.ts'), 'utf8');
  const imported = [...config.matchAll(/from\s+["'](\.\/scripts\/[^"']+)["']/g)].map(match => match[1].slice(2));
  assert.deepEqual(imported, ['scripts/one-byte-chunks.mjs']);
  for (const file of ['scripts/release-build-head.mjs', 'scripts/release-build-mac-head.mjs']) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    assert.match(text, /chunkHelpers=\['scripts\/one-byte-chunks\.mjs','scripts\/one-byte-source\.mjs'\]/, file);
    assert.match(text, /for\(const file of chunkHelpers\)await write\(file,path\.join\(output,file\)\)/, `${file} writes them beside captured-vite.config.ts`);
    assert.match(text, /chunkHelpers\.includes\(file\)/, `${file} reads them from the commit`);
  }
  // one-byte-chunks.mjs reaches its sibling and the parser by name only, so the copy beside the captured config works.
  const chunks = await fs.readFile(path.join(root, 'scripts/one-byte-chunks.mjs'), 'utf8');
  assert.deepEqual([...chunks.matchAll(/import\(['"]([^'"]+)['"]\)/g)].map(match => match[1]), ['./one-byte-source.mjs']);
  assert.equal(/^import .* from ['"]\.\.?\//m.test(chunks), false);
  const source = await fs.readFile(path.join(root, 'scripts/one-byte-source.mjs'), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from '([^']+)'/gm)].map(match => match[1]).sort(), ['node:fs/promises', 'node:vm', 'typescript']);
});

test('the scripts read into page renderers are Latin-1 text', async () => {
  // Hand-written preloads (registered for every frame of a page, or used as the page view's preload): read by path, so what is in the file is what the renderer holds.
  const desktop = await walk(path.join(root, 'desktop'));
  const preloads = desktop.map(file => path.relative(root, file).replaceAll('\\', '/')).filter(file => /preload[^/]*\.cjs$/.test(file) && !/^desktop\/(?:ui-preload|browser-services\/autoconsent-preload)\.cjs$/.test(file) && !/-entry\.cjs$/.test(file) && !file.includes('/node_modules/') && !file.includes('/tor-engine/'));
  assert.ok(preloads.length >= 25 && preloads.includes('desktop/page-input-preload.cjs') && preloads.includes('desktop/browser-services/content-filter-preload.cjs'), preloads.join(' '));
  const listed = PATH_LOADED.filter(file => /preload[^/]*\.cjs$/.test(file));
  for (const file of listed) assert.ok(preloads.includes(file), `${file} is a preload on disk`);
  for (const file of preloads) { const text = await fs.readFile(path.join(root, file), 'utf8'); assert.equal(highest(text) <= LATIN1, true, `${file} has a character above U+00FF (write it as a \\u escape, or a plain ASCII word in a comment)`); }
  // The extension preload Acira writes for extension pages and workers: the engine's preload plus Acira's renderer-side namespaces, assembled at run time from several sources.
  const patch = require('../desktop/browser-services/extension-runtime-patch.cjs');
  const original = await fs.readFile(require.resolve('electron-chrome-extensions/preload'), 'utf8');
  const patched = patch.patchPreload(original, {userScriptsAllowed: [], grants: {}});
  assert.ok(patched && patched.length > 300000, 'the patched extension preload is about 360 KB');
  assert.equal(highest(patched) <= LATIN1, true, 'the patched extension preload has a character above U+00FF in one of the sources it is made of');
  // The interface renderers' own preload.
  const ui = await esbuild({entryPoints: [path.join(root, 'desktop/ui-preload-entry.cjs')], bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], write: false, logLevel: 'silent'});
  assert.equal(highest(ui.outputFiles[0].text) <= LATIN1, true, 'ui-preload.cjs');
});
