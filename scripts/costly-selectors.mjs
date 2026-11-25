// Costly selectors (the smoothness rule, 13.8 + Beta 14): Blink files every style rule under the rightmost compound of its selector, by its id, class or tag. A rule
// whose rightmost compound is a bare tag (`.x svg`, `.x > input:focus`) is tried on every element of that tag on every style recalculation, one ending in `*` (or a
// lone pseudo-class such as `:first-child`) or in an `:is()` / `:where()` list on EVERY element, and a `:has()` on the root, <body> or .app re-tests the whole
// window whenever anything inside it changes. A rule ends in a class instead (`.x svg.x-icon`, with the scope in :where() when the specificity must stay).
//
// costlySelectors(files) runs each stylesheet through the build's own PostCSS plugins (postcss.config.cjs: the root :has() rewrite and the :is() flattening) and
// esbuild's CSS minifier, as `vite build` does, and returns the costly selectors as the built CSS spells them, with the file each came from.
// tests/costly-selectors.test.mjs fails on any that is not in tests/costly-selectors-baseline.json (13.8's own set, which may only shrink).
//
//   node scripts/costly-selectors.mjs                 the costly selectors of this tree's src/, by kind
//   node scripts/costly-selectors.mjs --ref <git ref>  the same for a commit's src/ (13.8: release/beta13.8)
//   node scripts/costly-selectors.mjs --baseline <ref> writes tests/costly-selectors-baseline.json from that commit (only to start it: the list may only shrink)
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const postcss = require('postcss'), esbuild = require('esbuild'), {plugins} = require(path.join(root, 'postcss.config.cjs'));

const splitTop = text => { const out = []; let depth = 0, cur = ''; for (const ch of text) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()).filter(Boolean); };
const rightmost = s => { let depth = 0, last = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; else if (depth === 0 && /[\s>+~]/.test(c)) last = i + 1; } return s.slice(last).trim(); };

/** The kind of cost a selector has ('tag', 'star', 'is', 'roothas'), or null. Same rules as the full pass's scanner (earlier work/rigs/cssrules.cjs). */
export function costKind(selector) {
  if (/^(from|to|\d+(\.\d+)?%)$/.test(selector)) return null;
  const r = rightmost(selector).replace(/::?[a-z-]+(\([^)]*\))?$/i, m => /^:(is|where|has|not)\(/.test(m) ? m : '');
  if (/^\*/.test(r) || r === '') return 'star';
  if (/^[a-z][a-z0-9-]*(?:$|[:\[])/i.test(r) && !/^(html|body)/.test(r)) return 'tag';
  if (/^:(is|where)\(/.test(r)) return 'is';
  if (/(^|\s)(:root|html|body|\.app)[^\s>+~]*:has\(/.test(selector)) return 'roothas';
  return null;
}

/** Every selector of one built stylesheet text (rules inside @media/@supports/@container included, keyframe steps and at-rule preludes not). */
function selectorsOf(css) {
  const out = []; let buf = '';
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') { const s = buf.trim(); if (s && !s.startsWith('@')) out.push(...splitTop(s)); buf = ''; }
    else if (ch === '}' || ch === ';') buf = '';
    else buf += ch;
  }
  return out;
}

/** files: [{file, css}] -> [{selector, kind, file}] (one entry per selector and file, in file order). */
export function costlySelectors(files) {
  const out = [], seen = new Set();
  for (const {file, css} of files) {
    const processed = postcss(plugins).process(css, {from: path.join(root, file)}).css;
    const built = esbuild.transformSync(processed, {loader: 'css', minify: true, target: 'es2022'}).code;
    for (const selector of selectorsOf(built)) {
      const kind = costKind(selector), key = file + '\n' + selector;
      if (kind && !seen.has(key)) { seen.add(key); out.push({selector, kind, file}); }
    }
  }
  return out;
}

/** The stylesheets under src/ of this tree, or of a git commit. */
export function stylesheets(ref = null) {
  if (!ref) {
    const files = []; (function walk(dir) { for (const name of fs.readdirSync(path.join(root, dir)).sort()) { const rel = path.join(dir, name); if (fs.statSync(path.join(root, rel)).isDirectory()) walk(rel); else if (name.endsWith('.css')) files.push(rel); } })('src');
    return files.map(file => ({file, css: fs.readFileSync(path.join(root, file), 'utf8')}));
  }
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', maxBuffer: 1 << 28});
  return git('ls-tree', '-r', '--name-only', ref, 'src').split('\n').filter(f => f.endsWith('.css')).sort().map(file => ({file, css: git('show', `${ref}:${file}`)}));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2), at = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const baseline = at('--baseline'), ref = baseline || at('--ref');
  const found = costlySelectors(stylesheets(ref));
  if (baseline) {
    const selectors = [...new Set(found.map(x => x.selector))].sort();
    const commit = execFileSync('git', ['rev-parse', '--short=9', baseline], {cwd: root, encoding: 'utf8'}).trim();
    fs.writeFileSync(path.join(root, 'tests/costly-selectors-baseline.json'), JSON.stringify({
      note: 'The costly selectors 13.8 shipped (scripts/costly-selectors.mjs): the only ones the interface may still have. This list may only shrink; tests/costly-selectors.test.mjs fails on any other, and on a longer list.',
      from: `${baseline} ${commit}`, count: selectors.length, selectors}, null, 1) + '\n');
    console.log(`tests/costly-selectors-baseline.json: ${selectors.length} selectors from ${baseline} (${commit})`);
  } else {
    const by = {}; for (const x of found) by[x.kind] = (by[x.kind] || 0) + 1;
    console.log(JSON.stringify({unique: new Set(found.map(x => x.selector)).size, ...by}));
    if (args.includes('--list')) for (const x of found) console.log(`${x.kind}\t${x.file}\t${x.selector}`);
  }
}
