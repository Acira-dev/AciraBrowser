// The build flattens rightmost :is() lists in every stylesheet (scripts/postcss-flatten-is.cjs, postcss.config.cjs): a rule whose last compound is a
// :is() list is matched against every element on every style recalculation; flattened, Blink buckets each member by its class / tag / id.
// 13.8: every file, not only the one first opted in. These tests fail on 13.8 ba6910ed (no plugin, no config).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const postcss = require('postcss');

const root = path.join(__dirname, '..');
const pluginPath = path.join(root, 'scripts', 'postcss-flatten-is.cjs');
const load = () => require(pluginPath);
const run = (css, from) => postcss([load()()]).process(css, {from}).css;
const split = text => { const out = []; let depth = 0, cur = ''; for (const ch of text) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
const rightmostIs = sel => /:is\((?:[^()]|\((?:[^()]|\([^()]*\))*\))*\)[^\s>+~,]*$/.test(sel.trim());
const sheets = [];
(function walk(dir) { for (const entry of fs.readdirSync(dir, {withFileTypes: true})) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (entry.name.endsWith('.css')) sheets.push(full); } })(path.join(root, 'src'));

test('the build runs the flattening on every stylesheet (postcss.config.cjs)', () => {
  assert.ok(fs.existsSync(path.join(root, 'postcss.config.cjs')), 'postcss.config.cjs exists');
  const config = require(path.join(root, 'postcss.config.cjs'));
  assert.ok(Array.isArray(config.plugins) && config.plugins.some(p => p && p.postcssPlugin === 'flatten-is'), 'flatten-is is a build plugin');
  // no marker needed: a file without any comment is flattened
  assert.strictEqual(run(':root .app :is(.a, .b) { color: red }'), ':root .app .a,\n:root .app .b { color: red }');
  // and a file can opt out
  assert.match(run('/* @no-flatten-is */\n:root .app :is(.a, .b) { color: red }'), /:is\(\.a, \.b\)/);
});

test('specificity is kept: every member is padded up to the list\'s most specific member', () => {
  const {specificity} = load();
  const out = run('.app :is(.a, .b.c, [data-x="1"]:hover) { color: red }');
  const target = specificity('.app :is(.a, .b.c, [data-x="1"]:hover)');
  const parts = split(out.slice(0, out.indexOf('{')));
  assert.strictEqual(parts.length, 3);
  for (const part of parts) assert.deepStrictEqual(specificity(part), target, part);
});

test('padding goes before a pseudo-element, never after it (that would make the selector invalid)', () => {
  const out = run('.app :is(.a, .b.c)::placeholder { color: red }');
  for (const sel of split(out.slice(0, out.indexOf('{')))) assert.match(sel, /::placeholder$/, sel);
  assert.match(out, /\.a:not\(\.sp\)::placeholder/);
});

test('a list is left as written when splitting could change what it matches or drop the rule', () => {
  // a member with a combinator under a prefix that is not the interface's root: `.x :is(.a .b)` also matches an .a outside .x
  assert.match(run('.x :is(.a .b, .c) { color: blue }'), /:is\(\.a \.b, \.c\)/);
  // a member that names a pseudo-element or a vendor prefix: inside :is() an unparsable member is skipped, in a plain list it would drop the whole rule
  assert.match(run('.y :is(.a, ::-webkit-scrollbar) { color: green }'), /:is\(\.a, ::-webkit-scrollbar\)/);
  assert.match(run('.y :is(.a, :-webkit-autofill) { color: green }'), /:is\(\.a, :-webkit-autofill\)/);
  // members that differ in element count (button vs .q) cannot be padded to one specificity
  assert.match(run('.app :is(button, .q):hover { top: 0 }'), /:is\(button, \.q\):hover/);
  // nested rules keep their & lists; keyframes are never touched
  assert.match(run('.p { & :is(.a, .b) { color: red } }'), /& :is\(\.a, \.b\)/);
  assert.match(run('@keyframes k { from { opacity: 0 } to { opacity: 1 } }'), /@keyframes k/);
});

test('@media, @supports and @layer blocks are flattened like top-level rules', () => {
  for (const at of ['@media (min-width: 1px)', '@supports (display: grid)', '@layer base']) {
    const out = run(`${at} { :root .app :is(.a, .b) { color: red } }`);
    assert.match(out, /:root \.app \.a,\s*:root \.app \.b \{/, at);
  }
});

test('across the interface\'s stylesheets most rightmost :is() lists are gone, and every flattened selector keeps its specificity', () => {
  const {specificity} = load();
  let before = 0, after = 0, checked = 0;
  for (const file of sheets) {
    const src = fs.readFileSync(file, 'utf8');
    const original = postcss.parse(src, {from: file}), flat = postcss([load()()]).process(src, {from: file}).root;
    original.walkRules(rule => { if (rule.parent.type !== 'rule') for (const s of split(rule.selector)) if (rightmostIs(s)) before++; });
    flat.walkRules(rule => { if (rule.parent.type !== 'rule') for (const s of split(rule.selector)) if (rightmostIs(s)) after++; });
    // rule by rule (same order, same declarations): each flattened member has the specificity of the :is() selector it came from
    const a = [], b = [];
    original.walkRules(rule => { if (rule.parent.type !== 'rule' && !/^(keyframes)$/i.test(rule.parent.name || '')) a.push(rule); });
    flat.walkRules(rule => { if (rule.parent.type !== 'rule' && !/^(keyframes)$/i.test(rule.parent.name || '')) b.push(rule); });
    if (a.length !== b.length) continue; // the nesting form `:is(list) { &… }` turns one rule into several; its members are covered by the unit tests above
    for (let i = 0; i < a.length; i++) {
      if (a[i].selector === b[i].selector) continue;
      assert.strictEqual(a[i].nodes.filter(n => n.type === 'decl').map(String).join(';'), b[i].nodes.filter(n => n.type === 'decl').map(String).join(';'), `${path.relative(root, file)}: declarations kept`);
      const sources = split(a[i].selector), maxOf = list => list.map(specificity).reduce((m, s) => (s[0] > m[0] || (s[0] === m[0] && (s[1] > m[1] || (s[1] === m[1] && s[2] > m[2])))) ? s : m, [-1, -1, -1]);
      const targets = new Set(sources.map(s => specificity(s).join(',')));
      for (const sel of split(b[i].selector)) { assert.ok(targets.has(specificity(sel).join(',')), `${path.relative(root, file)}: ${sel} has the specificity of one of the original selectors`); checked++; }
      assert.ok(maxOf(split(b[i].selector)).join(',') === maxOf(sources).join(','), 'the rule\'s highest specificity is unchanged');
    }
  }
  assert.ok(before > 300, `13.8 had ${before} rightmost :is() selectors`);
  assert.ok(after < before / 3, `after flattening ${after} remain (before ${before})`);
  assert.ok(checked > 200, `checked ${checked} flattened selectors`);
});
