// Beta 14 (the reference design notes, 17 Nov): "the spacing rulebook everywhere". docs/launch/POPUP_SPACING_RULEBOOK.md, rule 1: every padding, gap and margin of a pop-up or menu is on the 4 px grid
// (0, 4, 8, 12, 16, 20, 24, 28, 32, ...); 2 px and 6 px only to line an icon or a hairline up optically, 1 px for a hairline. The audit counted pop-ups with paddings of 10, 11, 5 px (the report pop-up, Take screenshot, the tab list).
// This is the checker, once: it reads every stylesheet under src/, takes the rules that style a pop-up or a menu (their selector names a pop-up surface), and lists every px value of padding / margin / gap / row-gap / column-gap that is not on the grid,
// grouped by the pop-up it belongs to. A value written as a token (var(--space-3)) is on the grid by construction; calc() and percentages are not judged.
//   node scripts/spacing-grid.mjs            the table (pop-up | values | off grid) and every off-grid value
//   import { audit } from './spacing-grid.mjs'   for tests/popup-grid.test.ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postcss = require('postcss');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The grid: multiples of 4, and the optical 1, 2 and 6. */
export const onGrid = px => { const v = Math.abs(px); return v % 4 === 0 || v === 1 || v === 2 || v === 6; };
const PROP = /^(padding|margin|gap|row-gap|column-gap)(-(top|right|bottom|left|block|inline)(-(start|end))?)?$/;

/** A rule styles a pop-up or a menu when its selector names a pop-up surface. Each surface group has the classes that tell which pop-up it is. */
const SURFACE = /\.content-filter|\.certificate|\.site-(info|report|data)|\.shields|\.pf-|\.workspace-cover|\.extension-(panel|more)|\.bookmark-(edit|popup)|\.recent-closed|\.update-pill|\.whats-new|\.browser-popup|\.sheet-popup|\.acira-popup|\.popup-|\.menu-(row|form|layout|heading|customize|toggle|choice|name)|\.acira-menu|\.submenu|\.tab-result|\.palette-|\.fb-|\.ins(-|\b)|\.mc-|\.b14v|\.v-note|\.dlg-|\.dialog|\.toast|\.tabs-popup|\.find-|\.zoom-pop|\.easy-|\.ef-|\.rc-card|\.aura|\.nt-aura/;
export const GROUPS = [
  ['Report pop-up', /\.fb-(?!rank)/],
  ['How credit works (ranks)', /\.fb-rank/],
  ['Insider pop-up and sheets', /\.ins(-|\b)|\.dlg-/],
  ['Member card pop-up', /\.mc-/],
  ['Card close-up (viewer)', /\.b14v|\.v-note/],
  ['Tab list and command bar', /\.tab-result|\.palette-|\.popup-search|\.popup-hints|\.popup-content-(tabs|palette)/],
  ['Take screenshot / Easy Files', /\.easy-|\.ef-|\.shot/],
  ['Find and zoom', /\.find-|\.zoom-pop/],
  ['Toasts', /\.toast/],
  ['Menus (main, context, sub, forms)', /\.menu-|\.acira-menu|\.submenu|\.popup-content-menu|\.popup-content-[a-z-]*context/],
];
const groupOf = selector => { for (const [name, re] of GROUPS) if (re.test(selector)) return name; return 'Other pop-up rules'; };

const walk = (dir, out = []) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) { if (!/node_modules|dist|\.git/.test(file)) walk(file, out); } else if (file.endsWith('.css')) out.push(file); } return out; };

/** Every px value of every pop-up or menu rule: { group, file, line, selector, prop, value, ok }. */
export function values() {
  const out = [];
  for (const file of walk(path.join(root, 'src'))) {
    let tree; try { tree = postcss.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    tree.walkDecls(decl => {
      if (!PROP.test(decl.prop) || /var\(/.test(decl.value) && !/\d+(\.\d+)?px/.test(decl.value.replace(/var\([^)]*\)/g, ''))) return;
      const rule = decl.parent; if (!rule || rule.type !== 'rule') return;
      const selector = String(rule.selector).replace(/\s+/g, ' ');
      if (!SURFACE.test(selector)) return;
      const clean = decl.value.replace(/var\([^)]*\)|calc\([^)]*\)/g, ' ');
      for (const m of clean.matchAll(/(-?\d*\.?\d+)px/g)) out.push({ group: groupOf(selector), file: path.relative(root, file), line: decl.source.start.line, selector: selector.slice(0, 110), prop: decl.prop, value: decl.value.trim(), px: parseFloat(m[1]), ok: onGrid(parseFloat(m[1])) });
    });
  }
  return out;
}

/** The table: pop-up -> { values, off }, and the list of off-grid values. */
export function audit() {
  const list = values(), table = new Map();
  for (const v of list) { const row = table.get(v.group) || { values: 0, off: 0 }; row.values++; if (!v.ok) row.off++; table.set(v.group, row); }
  return { table: [...table].map(([group, row]) => ({ group, ...row })).sort((a, b) => b.off - a.off || a.group.localeCompare(b.group)), off: list.filter(v => !v.ok), total: list.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { table, off, total } = audit();
  console.log('pop-up | values | off the 4 px grid'); for (const r of table) console.log(`${r.group} | ${r.values} | ${r.off}`);
  console.log(`total | ${total} | ${off.length}`);
  for (const v of off) console.log(`  ${v.group} :: ${v.file}:${v.line}  ${v.selector}  { ${v.prop}: ${v.value} }`);
  process.exit(off.length ? 1 : 0);
}
