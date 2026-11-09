// Memory (13.3): the main-process bundle is held by Electron as one byte per character only when it is plain ASCII, and the twelve catalogs
// a person is not using are stored packed. Neither may change what the program does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {build as esbuild} from 'esbuild';
import {oneByteSource, sameProgram, hasWideText} from '../scripts/one-byte-source.mjs';
import {bundleDesktop, runtimeAlias, workingTreeSource, packedCatalogs, PACKED_CATALOG} from '../scripts/desktop-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = code => vm.runInNewContext(code);

test('ASCII text is returned as it is', () => {
  const text = 'var a = /Rucktaste|Retour/; // cafe\nvar b = "Uni";';
  assert.equal(oneByteSource(text), text);
  assert.equal(hasWideText(text), false);
});

test('accented Latin letters are escaped too: Electron holds a script with any non-ASCII character as two-byte text', () => {
  const text = 'var r = /Rücktaste|Retour arrière/; // café\nvar s = "ok";';
  const out = oneByteSource(text);
  assert.equal(hasWideText(out), false);
  assert.equal(out, 'var r = /R\\u00FCcktaste|Retour arri\\u00E8re/; // caf\\u00E9\nvar s = "ok";');
  assert.equal(sameProgram(text, out), null);
  assert.equal(run(`${out}; r.test("Rücktaste") + "|" + r.test("Rucktaste")`), 'true|false');
});

test('a regular expression with full-width brackets means the same with escapes', () => {
  const text = 'var r = /Alt\\+[^+()（）\\s]+\\+N/;';
  const out = oneByteSource(text);
  assert.equal(hasWideText(out), false);
  assert.equal(out, 'var r = /Alt\\+[^+()\\uFF08\\uFF09\\s]+\\+N/;');
  assert.equal(sameProgram(text, out), null);
  for (const sample of ['Alt+Shift+N', 'Alt+（Umschalt）+N', 'Alt+Maj+N', 'Alt+(x)+N', 'Alt+x+y+N'])
    assert.equal(run(`${out}; r.test(${JSON.stringify(sample)})`), run(`${text}; r.test(${JSON.stringify(sample)})`), sample);
});

test('strings, templates, astral characters and combining ranges keep their value', () => {
  const text = 'var s = "\\u2026 ok…", t = `${1}…${2}`, r = /[̀-ͯ]/g, e = /😀/u, f = /[😀-😎]/u;';
  const out = oneByteSource(text);
  assert.equal(hasWideText(out), false);
  assert.equal(sameProgram(text, out), null);
  const pick = code => run(`${code}; JSON.stringify([s, t, "e\\u0301".replace(r, ""), e.test("\\u{1F600}"), f.test("\\u{1F60A}"), f.test("a")])`);
  assert.equal(pick(out), pick(text));
});

test('a backslash before the character still escapes exactly that character', () => {
  const odd = 'var r = /a\\（b/, s = "x\\（y";', even = 'var r = /a\\\\（b/, s = "x\\\\（y";';
  for (const text of [odd, even]) {
    const out = oneByteSource(text);
    assert.equal(hasWideText(out), false);
    assert.equal(sameProgram(text, out), null, text);
    const probe = code => run(`${code}; JSON.stringify([s, r.test("a（b"), r.test("a\\\\（b")])`);
    assert.equal(probe(out), probe(text));
  }
  assert.equal(run(`${oneByteSource(odd)}; s`), 'x（y');
  assert.equal(run(`${oneByteSource(even)}; s`), 'x\\（y');
});

test('comments lose nothing: a line separator still ends a // comment', () => {
  const text = 'var x = 0; // see… x = 5;\n/* “quoted” – dash */ x += 1;';
  const out = oneByteSource(text);
  assert.equal(hasWideText(out), false);
  assert.equal(run(`${out}; x`), 6);
  assert.equal(run(`${text}; x`), 6);
});

test('what an escape cannot keep identical stops the build instead of changing a meaning', () => {
  assert.throws(() => oneByteSource('var t = String.raw`a…b`;'), /tagged template/);
  assert.throws(() => oneByteSource('var Ω = 1;'), /identifier/);
  assert.throws(() => oneByteSource('var s = "a\\ b…";'), /line continuation/);
});

test('sameProgram sees a changed value', () => {
  assert.notEqual(sameProgram('var r = /a（/;', 'var r = /a）/;'), null);
  assert.notEqual(sameProgram('var s = "a…";', 'var s = "a...";'), null);
  assert.notEqual(sameProgram('var s = 1 + 2;', 'var s = 1 - 2;'), null);
  assert.equal(sameProgram('var s = 1 + 2; // …', 'var s = 1 + 2; // \\u2026'), null);
});

test('every catalog stored packed unpacks to the same object, English stays plain', async () => {
  const packed = (await fs.readdir(path.join(root, 'src/i18n'))).filter(name => PACKED_CATALOG.test(path.join(root, 'src/i18n', name)));
  assert.equal(packed.length, 12, 'the twelve other languages');
  assert.equal(PACKED_CATALOG.test(path.join(root, 'src/i18n/en.json')), false);
  for (const name of packed) {
    const file = path.join(root, 'src/i18n', name);
    const result = await esbuild({stdin: {contents: `module.exports = require(${JSON.stringify(file)});`, resolveDir: root}, bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent', plugins: [packedCatalogs()]});
    const code = result.outputFiles[0].text;
    assert.equal(code.includes('brotliDecompressSync'), true, name);
    const module = {exports: {}};
    new Function('module', 'exports', 'require', code)(module, module.exports, (id) => { if (id === 'node:zlib') return globalThis.process.getBuiltinModule('node:zlib'); throw new Error(id); });
    assert.deepStrictEqual(module.exports, JSON.parse(await fs.readFile(file, 'utf8')), `${name} unpacks to its file`);
    assert.ok(code.length < (await fs.stat(file)).size * 0.4, `${name} is stored packed (${code.length} of ${(await fs.stat(file)).size} bytes)`);
  }
  // Every locale main.ts can load is one of the packed ones (a language added later must be added to PACKED_CATALOG too).
  const main = await fs.readFile(path.join(root, 'src/i18n/main.ts'), 'utf8');
  const loaded = [...main.matchAll(/require\('\.\/([\w-]+)\.json'\)/g)].map(match => match[1]).sort();
  assert.deepEqual(loaded, packed.map(name => name.replace('.json', '')).sort());
});

test('the release bundle is plain ASCII and smaller for it', async () => {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'acira-onebyte-'));
  try {
    const result = await bundleDesktop({root, output, plugins: [runtimeAlias(root), workingTreeSource(root)]});
    assert.deepEqual(result.warnings, []);
    for (const file of ['desktop/main.cjs', 'desktop/browser-services/filter-engine-worker.cjs']) {
      const code = await fs.readFile(path.join(output, file), 'utf8');
      assert.equal(hasWideText(code), false, `${file} is plain ASCII, so the main process keeps one byte per character`);
      new vm.Script(code, {filename: file});
    }
    assert.ok((await fs.stat(path.join(output, 'desktop/main.cjs'))).size < 9 * 1024 * 1024, 'the catalogs of the other languages are packed (the bundle was 12.4 MB)');
  } finally { await fs.rm(output, {recursive: true, force: true}); }
});
