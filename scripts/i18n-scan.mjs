// Lists user-visible literal strings that are not yet routed through the catalog (t('…') / tm('…')).
//   node scripts/i18n-scan.mjs                 counts per file for src/ and desktop/
//   node scripts/i18n-scan.mjs --list [path]   every finding (file:line text), optionally only files whose path contains `path`
//   node scripts/i18n-scan.mjs --converted     only the files named in src/i18n/converted.json (what the guard test checks)
// A line (or the line above) containing `i18n-ignore` is skipped: use it for text that must stay literal (product names, test hooks).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const ts = createRequire(import.meta.url)('typescript');

const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..');
const slash = value => value.split(path.sep).join('/');
const ATTRS = new Set(['title', 'aria-label', 'aria-description', 'placeholder', 'alt', 'label']);
const PROPS = new Set(['title', 'detail', 'description', 'label', 'text', 'placeholder', 'message', 'tooltip', 'caption', 'heading', 'ariaLabel']);
const SKIP_DIRS = new Set(['node_modules', 'upstream', 'i18n']), SKIP_FILES = new Set(['runtime.cjs', 'i18n.cjs']);
const hasWords = text => /[A-Za-zÀ-ɏ぀-ヿ一-鿿]{2}/.test(text);
const prose = text => hasWords(text) && !/^[a-z0-9_.:/#@-]+$/.test(text) && !/^(https?:|acira:|file:|#|\.|\/)/.test(text) && !/^[A-Z0-9_]+$/.test(text);
const isText = node => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
const ROWS = new Set(['row', 'renderRow', 'menuRow', 'item']);
/** The literal strings an expression can show: itself, or both branches of a ?: (possibly parenthesised). */
const literals = node => ts.isParenthesizedExpression(node) ? literals(node.expression) : ts.isConditionalExpression(node) ? [...literals(node.whenTrue), ...literals(node.whenFalse)] : isText(node) ? [node] : [];

export function scanSource(file, text) {
  const kind = /\.(tsx|jsx)$/.test(file) ? ts.ScriptKind.TSX : /\.ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const lines = text.split(/\r?\n/), found = [];
  const ignored = line => /i18n-ignore/.test(lines[line] || '') || /i18n-ignore/.test(lines[line - 1] || '');
  const add = (node, value) => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line;
    if (!ignored(line)) found.push({ file, line: line + 1, text: value.replace(/\s+/g, ' ').trim().slice(0, 90) });
  };
  const flagTemplate = node => { if (ts.isTemplateExpression(node) && prose(node.head.text + ' ') && /[A-Za-z]{3}/.test(node.head.text + node.templateSpans.map(x => x.literal.text).join(' '))) add(node, node.getText()); };
  const visit = node => {
    if (ts.isJsxText(node)) {
      const value = node.getText().replace(/&\w+;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
      if (prose(value) && value.length > 1) add(node, value);
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      for (const lit of literals(node.expression)) if (prose(lit.text) && lit.text.includes(' ') || prose(lit.text) && /^[A-Z][a-z]{3,}[?!.]?$/.test(lit.text)) add(lit, lit.text);
    } else if (ts.isJsxAttribute(node) && node.initializer && ATTRS.has(node.name.getText())) {
      const init = node.initializer;
      if (ts.isJsxExpression(init) && init.expression) flagTemplate(init.expression);
      if (ts.isStringLiteral(init) && prose(init.text)) add(init, init.text);
      else if (ts.isJsxExpression(init) && init.expression) for (const lit of literals(init.expression)) if (prose(lit.text)) add(lit, lit.text);
    } else if (ts.isPropertyAssignment(node) && PROPS.has(node.name.getText().replace(/['"]/g, ''))) {
      const v = node.initializer;
      for (const lit of literals(v)) if (prose(lit.text) && (lit.text.includes(' ') || (/^[A-Z][a-z]+$/.test(lit.text) && lit.text.length > 3))) add(lit, lit.text);
      flagTemplate(v);
      if (ts.isArrayLiteralExpression(v) && ['steps', 'items', 'tips', 'bullets'].includes(node.name.getText())) for (const item of v.elements) for (const lit of literals(item)) if (prose(lit.text) && lit.text.includes(' ')) add(lit, lit.text);
    } else if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ROWS.has(node.expression.text) && node.arguments[0]) {
      for (const lit of literals(node.arguments[0])) if (prose(lit.text)) add(lit, lit.text);
      flagTemplate(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(tsx|ts|cjs|mjs)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

export const exemptFiles = () => { try { return Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/converted.json'), 'utf8')).exempt || {}); } catch { return []; } };
export const scanFiles = files => files.filter(file => !exemptFiles().includes(slash(path.relative(root, file)))).flatMap(file => scanSource(slash(path.relative(root, file)), fs.readFileSync(file, 'utf8')));
export const convertedFiles = () => { try { return JSON.parse(fs.readFileSync(path.join(root, 'src/i18n/converted.json'), 'utf8')).files || []; } catch { return []; } };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(here)) {
  const args = process.argv.slice(2), list = args.includes('--list'), only = args.find(a => !a.startsWith('--'));
  const files = args.includes('--converted')
    ? convertedFiles().map(file => path.join(root, file))
    : [...walk(path.join(root, 'src')), ...walk(path.join(root, 'desktop'))].filter(file => !only || slash(file).includes(only));
  const found = scanFiles(files);
  if (list) for (const f of found) console.log(`${f.file}:${f.line}  ${f.text}`);
  else {
    const per = new Map();
    for (const f of found) per.set(f.file, (per.get(f.file) || 0) + 1);
    for (const [file, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(String(n).padStart(5), file);
  }
  console.log(`\n${found.length} untranslated strings in ${new Set(found.map(f => f.file)).size} files`);
}
