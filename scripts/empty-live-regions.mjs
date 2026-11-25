// Beta 14 (the reference design notes, 17 Nov): "empty space under the last button". A live region (aria-live / role="status") that is drawn all the time but may hold no text takes room while it is empty: a min-height, a margin
// or a padding on an empty line is a band under the last button. The rule (docs/launch/POPUP_SPACING_RULEBOOK.md, point 8): such a line takes room only while it has text; `.popup-status` (styles/popup-menu.css) takes an empty one out of the layout
// and keeps it in the page for screen readers.
// This finds every live region in src/**/*.tsx that (1) is rendered whether or not it has text (it is not the right-hand side of `cond && <el>`, and its text is an expression that can be empty), and (2) has a stylesheet rule that reserves room
// for it (min-height, height, margin, padding, border), and (3) does not carry `popup-status`. Usage: node scripts/empty-live-regions.mjs   (prints the list; exit 1 when there is one)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const postcss = require('postcss');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const walk = (dir, ext, out = []) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) { if (!/node_modules|dist|\.git/.test(file)) walk(file, ext, out); } else if (file.endsWith(ext)) out.push(file); } return out; };

/** Classes whose rules reserve room (the class and what reserves it), from every stylesheet. */
export function reservingClasses() {
  const map = new Map(), handled = new Set();
  for (const file of walk(path.join(root, 'src'), '.css')) {
    let tree; try { tree = postcss.parse(fs.readFileSync(file, 'utf8')); } catch { continue; }
    tree.walkRules(rule => {
      const reserved = [];
      rule.walkDecls(decl => {
        if (decl.parent !== rule) return;
        const v = decl.value.trim();
        if (/^(min-height|height)$/.test(decl.prop) && /^\d/.test(v) && parseFloat(v) > 1) reserved.push(`${decl.prop}:${v}`);
        else if (/^margin(-block)?(-top|-bottom|-start|-end)?$|^padding(-block)?(-top|-bottom|-start|-end)?$/.test(decl.prop) && /\d/.test(v) && !/^0(px)?(\s+0(px)?)*$/.test(v)) reserved.push(`${decl.prop}:${v}`);
      });
      // a rule for the class's `:empty` state is the reset (margin or padding 0): the class is handled, whatever else it reserves while it has text
      if (/:empty/.test(rule.selector) && /(margin|padding|min-height|height)/.test(rule.toString())) for (const selector of rule.selectors || []) for (const m of (selector.trim().split(/[\s>+~]+/).pop() || '').matchAll(/\.([\w-]+)/g)) handled.add(m[1]);
      if (!reserved.length) return;
      for (const selector of rule.selectors || []) {
        const last = selector.trim().split(/[\s>+~]+/).pop() || '';
        for (const m of last.matchAll(/\.([\w-]+)/g)) { const list = map.get(m[1]) || []; list.push({ file: path.relative(root, file), line: rule.source?.start?.line, selector: selector.trim().slice(0, 90), reserved }); map.set(m[1], list); }
      }
    });
  }
  for (const name of handled) map.delete(name);
  return map;
}

const attr = (node, name) => node.attributes.properties.find(p => p.name && p.name.getText() === name);
const textOf = a => { if (!a || !a.initializer) return ''; const i = a.initializer; if (ts.isStringLiteral(i)) return i.text; if (i.expression && ts.isStringLiteral(i.expression)) return i.expression.text; if (i.expression && ts.isNoSubstitutionTemplateLiteral(i.expression)) return i.expression.text; if (i.expression) return i.expression.getText(); return ''; };

/** Can this expression give no text? A translated string (`t('key')`) and a literal with text cannot; a name, a property, `x || ''`, `cond ? text : ''` can. */
function emptyPossible(node) {
  while (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node)) node = node.expression;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text.trim() === '';
  if (ts.isTemplateExpression(node)) return !(node.head.text.trim() || node.templateSpans.some(span => span.literal.text.trim()));
  if (ts.isCallExpression(node)) { const callee = node.expression.getText(); return !/^(t|tr|i18n\.t|translate)$/.test(callee); }
  if (ts.isBinaryExpression(node)) { const op = node.operatorToken.kind; if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) return emptyPossible(node.right); return true; }
  if (ts.isConditionalExpression(node)) return emptyPossible(node.whenTrue) || emptyPossible(node.whenFalse);
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return false;
  return true;
}

/** Every live region that is drawn all the time and may be empty, with what reserves room for it. */
export function findings() {
  const reserving = reservingClasses(), out = [];
  for (const file of walk(path.join(root, 'src'), '.tsx')) {
    const source = fs.readFileSync(file, 'utf8');
    if (!/aria-live|role=("|')status/.test(source)) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = node => {
      const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
      if (opening) {
        const live = attr(opening, 'aria-live'), role = attr(opening, 'role');
        const isLive = (live && textOf(live) !== 'off') || (role && textOf(role) === 'status');
        if (isLive && ts.isJsxElement(node)) {
          // drawn only when a condition holds: the right-hand side of `cond && <el>` (or a branch of a ternary that is not the empty one)
          let p = node.parent; while (p && (ts.isParenthesizedExpression(p))) p = p.parent;
          const conditional = p && ((ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && p.right === node) || ts.isConditionalExpression(p));
          // may hold no text: its children are one expression (not a static string, not an element)
          const kids = node.children.filter(c => !(ts.isJsxText(c) && !c.getText().trim()));
          const expressions = kids.filter(c => ts.isJsxExpression(c) && c.expression);
          const hasStatic = kids.some(c => (ts.isJsxText(c) && c.getText().trim()) || ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
          const mayBeEmpty = expressions.length > 0 && !hasStatic && expressions.some(e => emptyPossible(e.expression));
          const classes = textOf(attr(opening, 'className')).split(/\s+/).filter(Boolean);
          if (!conditional && mayBeEmpty && !classes.includes('popup-status') && !classes.some(c => /^(sr-only|st-sr-only|tx-sr)$/.test(c))) {
            const rooms = classes.flatMap(c => (reserving.get(c) || []).map(r => ({ class: c, ...r })));
            if (rooms.length) out.push({ file: path.relative(root, file), line: sf.getLineAndCharacterOfPosition(node.getStart()).line + 1, classes, rooms });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const list = findings();
  for (const f of list) console.log(`${f.file}:${f.line}  <${f.classes.join(' ')}>  reserves: ${f.rooms.map(r => `${r.class} ${r.reserved.join(' ')} (${r.file}:${r.line})`).join('; ')}`);
  console.log(list.length ? `${list.length} live region(s) take room while empty` : 'no live region takes room while empty');
  process.exit(list.length ? 1 : 0);
}
