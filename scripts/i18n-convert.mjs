// Moves a file's literal UI strings into the catalog and rewrites them as t('…') calls.
//   node scripts/i18n-convert.mjs <file…> [--dry]
// Handles: JSX text that is a whole sentence, label-like JSX attributes, and label-like object properties (same rules as
// scripts/i18n-scan.mjs). Left alone and reported as MANUAL: text mixed with {expressions}, template strings. New ids go to
// src/i18n/en.json (same English text anywhere = same id). The call is `t` unless the file already has a variable called t
// (then `tr`). The file is added to nothing: once the report has no MANUAL lines left, add it to src/i18n/converted.json.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ts = createRequire(import.meta.url)('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'src/i18n/en.json');
const ATTRS = new Set(['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'label']);
const PROPS = new Set(['title', 'detail', 'description', 'label', 'text', 'placeholder', 'message', 'tooltip', 'caption', 'heading', 'ariaLabel']);
const hasWords = text => /[A-Za-zÀ-ɏ]{2}/.test(text);
const prose = text => hasWords(text) && !/^[a-z0-9_.:/#@-]+$/.test(text) && !/^(https?:|acira:|file:|#|\.|\/)/.test(text) && !/^[A-Z0-9_]+$/.test(text);
const isText = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
const ROWS = new Set(['row', 'renderRow', 'menuRow']);
const literals = node => ts.isParenthesizedExpression(node) ? literals(node.expression) : ts.isConditionalExpression(node) ? [...literals(node.whenTrue), ...literals(node.whenFalse)] : isText(node) ? [node] : [];
const args = process.argv.slice(2), dry = args.includes('--dry'), files = args.filter(a => !a.startsWith('--'));
const en = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const byText = new Map(Object.entries(en).map(([id, text]) => [text, id]));

const camel = words => words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
function area(file) { const base = path.basename(file).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' '); const name = camel(base.map(w => w.toLowerCase())); return name.replace(/^./, c => c.toLowerCase()); }
function idFor(file, text) {
  if (byText.has(text)) return byText.get(text);
  const words = text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).slice(0, 5).filter(Boolean);
  const base = area(file) + '.' + (camel(words) || 'text');
  let id = base, n = 2;
  while (id in en) id = base + n++;
  en[id] = text; byText.set(text, id);
  return id;
}
const q = text => JSON.stringify(text);

let totalConverted = 0, totalManual = 0;
for (const input of files) {
  const file = path.resolve(input), rel = path.relative(root, file).split(path.sep).join('/');
  let text = fs.readFileSync(file, 'utf8');
  const crlf = text.includes('\r\n'); text = text.replace(/\r\n/g, '\n');
  const kind = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const mainProcess = /^desktop\/.*\.cjs$/.test(rel) && rel !== 'desktop/tm.cjs' && !/(^|\/)(i18n|runtime)\.cjs$/.test(rel);
  if (!/\.(tsx|ts)$/.test(file) && !mainProcess) { console.log(`${rel}: other main-process files use tm('…') by hand; skipped`); continue; }
  const lines = text.split('\n'), skipLine = line => /i18n-ignore/.test(lines[line] || '') || /i18n-ignore/.test(lines[line - 1] || '');
  const lineOf = node => source.getLineAndCharacterOfPosition(node.getStart()).line;
  // Does the file use `t` as a variable? Then the import is `t as tr` and calls are tr(…).
  let shadows = false;
  const scanNames = node => { if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isBindingElement(node)) && ts.isIdentifier(node.name) && node.name.text === 't') shadows = true; ts.forEachChild(node, scanNames); };
  scanNames(source);
  const fn = mainProcess ? 'tm' : shadows ? 'tr' : 't';
  const edits = [], manual = [];
  const nameOf = (expr, used) => {
    const text = expr.getText();
    const base = /\.length\s*$/.test(text) || /^Math\./.test(text) ? 'count' : (text.match(/([A-Za-z_]\w*)\W*$/) || [, 'value'])[1];
    let name = base, i = 2; while (used.has(name)) name = base + i++; used.add(name); return name;
  };
  /** `Close ${tab.title}` becomes t('id', { title: tab.title }) with the message "Close {title}". Returns true when it took the node. */
  const templateEdit = node => {
    if (!ts.isTemplateExpression(node)) return false;
    const used = new Set(), params = []; let message = node.head.text;
    for (const span of node.templateSpans) { const name = nameOf(span.expression, used); params.push(name + ': ' + span.expression.getText()); message += '{' + name + '}' + span.literal.text; }
    if (!prose(message.replace(/\{\w+\}/g, ' ').trim() + ' ') || skipLine(lineOf(node))) return false;
    edits.push([node.getStart(), node.getEnd(), fn + '(' + q('@@' + message) + ', { ' + params.join(', ') + ' })', message]); return true;
  };
  const visit = node => {
    if (ts.isJsxText(node)) {
      const raw = node.getText(), value = raw.replace(/&\w+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
      if (prose(value) && value.length > 1 && !skipLine(lineOf(node))) {
        const parent = node.parent, mixed = parent.children && parent.children.some(c => ts.isJsxExpression(c) || (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) && c !== node && false);
        const expressionSibling = parent.children && parent.children.some(c => ts.isJsxExpression(c));
        if (expressionSibling || /&\w+;|&#\d+;/.test(raw) || mixed) manual.push(`${rel}:${lineOf(node) + 1} ${value.slice(0, 70)}`);
        else {
          const lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0], inner = raw.slice(lead.length, raw.length - trail.length).replace(/\s+/g, ' ');
          edits.push([node.getStart(), node.getEnd(), `${lead}{${fn}(${q('@@' + inner)})}${trail}`, inner]);
        }
      }
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      for (const lit of literals(node.expression)) if ((prose(lit.text) && lit.text.includes(' ') || prose(lit.text) && /^[A-Z][a-z]{3,}[?!.]?$/.test(lit.text)) && !skipLine(lineOf(lit))) edits.push([lit.getStart(), lit.getEnd(), `${fn}(${q('@@' + lit.text)})`, lit.text]);
    } else if (ts.isJsxAttribute(node) && node.initializer && ATTRS.has(node.name.getText())) {
      const init = node.initializer;
      if (ts.isStringLiteral(init) && prose(init.text) && !skipLine(lineOf(init))) edits.push([init.getStart(), init.getEnd(), `{${fn}(${q('@@' + init.text)})}`, init.text]);
      else if (ts.isJsxExpression(init) && init.expression && templateEdit(init.expression)) { /* done */ }
      else if (ts.isJsxExpression(init) && init.expression) for (const lit of literals(init.expression)) if (prose(lit.text) && !skipLine(lineOf(lit))) edits.push([lit.getStart(), lit.getEnd(), `${fn}(${q('@@' + lit.text)})`, lit.text]);
    } else if (ts.isPropertyAssignment(node) && PROPS.has(node.name.getText().replace(/['"]/g, ''))) {
      const v = node.initializer;
      for (const lit of literals(v)) if (prose(lit.text) && (lit.text.includes(' ') || (/^[A-Z][a-z]+$/.test(lit.text) && lit.text.length > 3)) && !skipLine(lineOf(lit))) edits.push([lit.getStart(), lit.getEnd(), `${fn}(${q('@@' + lit.text)})`, lit.text]);
      if (ts.isTemplateExpression(v) && !templateEdit(v) && prose(v.head.text + ' ') && !skipLine(lineOf(v))) manual.push(`${rel}:${lineOf(v) + 1} ${v.getText().slice(0, 70)}`);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ROWS.has(node.expression.text) && node.arguments[0]) {
      templateEdit(node.arguments[0]);
      for (const lit of literals(node.arguments[0])) if (prose(lit.text) && !skipLine(lineOf(lit))) edits.push([lit.getStart(), lit.getEnd(), `${fn}(${q('@@' + lit.text)})`, lit.text]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let out = text;
  for (const [start, end, replacement, english] of edits.sort((a, b) => b[0] - a[0])) {
    const id = idFor(rel, english);
    out = out.slice(0, start) + replacement.replace(q('@@' + english), q(id)) + out.slice(end);
  }
  if (edits.length && mainProcess && rel !== 'desktop/main.cjs' && !/require\(['"][./]*tm\.cjs['"]\)/.test(out)) {
    const up = path.relative(path.dirname(file), path.join(root, 'desktop')).split(path.sep).join('/');
    const statement = "const { tm } = require('" + (up ? up + '/' : './') + "tm.cjs');";
    const strict = out.match(/^['"]use strict['"];?\s*\n/);
    out = strict ? out.slice(0, strict[0].length) + statement + '\n' + out.slice(strict[0].length) : statement + '\n' + out;
  }
  if (edits.length && !mainProcess && !new RegExp(`from ['"][./]*i18n['"]`).test(out)) {
    const depth = path.relative(path.dirname(file), path.join(root, 'src/i18n')).split(path.sep).join('/');
    const statement = `import { t${shadows ? ' as tr' : ''} } from '${depth.startsWith('.') ? depth : './' + depth}';`;
    const importEnd = [...out.matchAll(/^import[\s\S]*?;\s*$/gm)].pop();
    out = importEnd ? out.slice(0, importEnd.index + importEnd[0].length) + '\n' + statement + out.slice(importEnd.index + importEnd[0].length) : statement + '\n' + out;
  }
  totalConverted += edits.length; totalManual += manual.length;
  console.log(`${rel}: ${edits.length} converted, ${manual.length} manual${shadows ? ' (uses tr)' : ''}`);
  for (const line of manual) console.log('   MANUAL ' + line);
  if (!dry && edits.length) fs.writeFileSync(file, crlf ? out.replace(/\n/g, '\r\n') : out);
}
if (!dry) fs.writeFileSync(catalogPath, JSON.stringify(en, null, 2) + '\n');
console.log(`\n${totalConverted} strings moved to the catalog, ${totalManual} left for hand work${dry ? ' (dry run, nothing written)' : ''}`);
