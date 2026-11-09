// Memory: Electron's main process holds a script that has even one non-ASCII character (a full-width bracket in a regular expression, an accented
// letter in a comment) as two-byte text for as long as the process lives, twice the memory of the same script in plain ASCII (measured: the 7.5 MB
// release bundle with one 'u' with a diaeresis in it was a 14.3 MB string in the main process's heap; ASCII only, 7.1 MB). The release's main-process bundle is
// 12 MB of source, so a few stray characters in it cost 12 MB of the main process for nothing.
// oneByteSource() rewrites every non-ASCII character in a bundle as the escape that means the same thing where it stands, so the file is plain
// ASCII and behaves exactly as before. Strings and (untagged) templates are escaped already by esbuild (charset ascii); what is left is regular
// expression literals and comments. Anything the rewrite cannot make identical (a tagged template, an identifier, a line continuation) stops the
// build instead of changing a meaning. sameProgram() compares two texts node by node, for the tests.
import ts from 'typescript';
import vm from 'node:vm';

const WIDE = /[^\x00-\x7f]/g;
export const hasWideText = text => /[^\x00-\x7f]/.test(text);

function parse(text) { return ts.createSourceFile('bundle.cjs', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS); }
function children(node) { const out = []; ts.forEachChild(node, child => { out.push(child); }); return out; }
const K = ts.SyntaxKind;
const TEMPLATE_PARTS = new Set([K.NoSubstitutionTemplateLiteral, K.TemplateHead, K.TemplateMiddle, K.TemplateTail]);

/** The ranges [start, end) of every literal in the text, in source order, and which of them are inside a tagged template. */
function literalRanges(file) {
  const ranges = [], tagged = new Set(), stack = [file];
  while (stack.length) {
    const node = stack.pop();
    if (node.kind === K.TaggedTemplateExpression) {
      tagged.add(node.template);
      if (node.template.kind === K.TemplateExpression) { tagged.add(node.template.head); for (const span of node.template.templateSpans) tagged.add(span.literal); }
    }
    if (node.kind === K.RegularExpressionLiteral) ranges.push({start: node.getStart(file), end: node.end, kind: 'regex'});
    else if (node.kind === K.StringLiteral) ranges.push({start: node.getStart(file), end: node.end, kind: 'string'});
    else if (TEMPLATE_PARTS.has(node.kind)) ranges.push({start: node.getStart(file), end: node.end, kind: tagged.has(node) ? 'tagged' : 'template'});
    else if ((node.kind === K.Identifier || node.kind === K.PrivateIdentifier) && hasWideText(node.text)) ranges.push({start: node.getStart(file), end: node.end, kind: 'identifier'});
    const kids = children(node);
    for (let at = kids.length - 1; at >= 0; at--) stack.push(kids[at]);
  }
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

const hex4 = code => '\\u' + code.toString(16).toUpperCase().padStart(4, '0');

/** `text` with every non-ASCII character written as an escape; throws when a place cannot take an escape. Text that is ASCII already comes back as it is. */
export function oneByteSource(text) {
  if (!hasWideText(text)) return text;
  const ranges = literalRanges(parse(text));
  const out = [];
  let last = 0, at = 0;
  WIDE.lastIndex = 0;
  for (let match; (match = WIDE.exec(text));) {
    const index = match.index, code = text.charCodeAt(index);
    while (at < ranges.length && ranges[at].end <= index) at++;
    const inside = at < ranges.length && ranges[at].start <= index ? ranges[at] : null;
    const where = `offset ${index} (${JSON.stringify(text.slice(Math.max(0, index - 30), index + 10))})`;
    if (!inside) {
      // Trivia: a comment. A line separator ends a // comment, so it stays a line break; anything else becomes its escape, which is only text.
      out.push(text.slice(last, index), code === 0x2028 || code === 0x2029 ? '\n' : hex4(code));
      last = index + 1; continue;
    }
    if (inside.kind === 'identifier' || inside.kind === 'tagged') throw new Error(`A non-ASCII character cannot be escaped in ${inside.kind === 'tagged' ? 'a tagged template' : 'an identifier'} at ${where}; write it as an escape in the source.`);
    let slashes = 0;
    while (text[index - 1 - slashes] === '\\') slashes++;
    if (slashes % 2 === 1) {
      // "\X" for a character X that needs no escape means X; "\\uXXXX" would be a backslash. (A backslash before a line separator is a line continuation: no equivalent.)
      if (code === 0x2028 || code === 0x2029) throw new Error(`A line continuation with a line separator cannot be escaped at ${where}.`);
      out.push(text.slice(last, index - 1), hex4(code));
    } else out.push(text.slice(last, index), hex4(code));
    last = index + 1;
  }
  out.push(text.slice(last));
  const result = out.join('');
  if (hasWideText(result)) throw new Error('A non-ASCII character is left after the rewrite.');
  new vm.Script(result, {filename: 'one-byte-source-check.cjs'});
  return result;
}

/** What a regular expression's text means once escapes are read: \uXXXX and an escaped non-ASCII character both become the character. */
function readEscapes(source) {
  return source.replace(/\\(u[0-9A-Fa-f]{4}|[\s\S])/g, (all, part) => part.length === 5 && part[0] === 'u' ? String.fromCharCode(parseInt(part.slice(1), 16)) : part.charCodeAt(0) > 127 ? part : all);
}

/** null when the two texts are the same program (same tree, same values for every literal and name); otherwise a description of the first difference. */
export function sameProgram(original, changed) {
  const left = [parse(original)], right = [parse(changed)], tagged = new Set();
  while (left.length) {
    const a = left.pop(), b = right.pop();
    if (a.kind === K.TaggedTemplateExpression) { tagged.add(a.template); if (a.template.kind === K.TemplateExpression) { tagged.add(a.template.head); for (const span of a.template.templateSpans) tagged.add(span.literal); } }
    if (a.kind !== b.kind) return `different node kinds (${K[a.kind]} and ${K[b.kind]}) near offset ${a.pos}`;
    if (a.kind === K.RegularExpressionLiteral) { if (readEscapes(a.text) !== readEscapes(b.text)) return `a regular expression differs near offset ${a.pos}: ${a.text.slice(0, 80)}`; }
    else if (a.kind === K.StringLiteral || TEMPLATE_PARTS.has(a.kind)) { if (a.text !== b.text || tagged.has(a) && a.rawText !== b.rawText) return `a ${K[a.kind]} differs near offset ${a.pos}`; }
    else if (a.kind === K.Identifier || a.kind === K.PrivateIdentifier || a.kind === K.NumericLiteral || a.kind === K.BigIntLiteral) { if (a.text !== b.text) return `a name or number differs near offset ${a.pos}`; }
    const kidsA = children(a), kidsB = children(b);
    if (kidsA.length !== kidsB.length) return `different child counts near offset ${a.pos}`;
    for (let at = kidsA.length - 1; at >= 0; at--) { left.push(kidsA[at]); right.push(kidsB[at]); }
  }
  return null;
}
