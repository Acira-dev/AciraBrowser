'use strict';
/**
 * Flattens `:is(list)` at the END of a selector (the rightmost compound), and the nesting form `:is(list) { &::before { … } }`, into one plain selector per member, in every stylesheet of the
 * interface (13.8: all of them; a file can opt out with a first comment `/* @no-flatten-is *\/`). Only the build sees the result; the source keeps its readable lists.
 * First written for a single file; 13.8 applies it to every file, with one more safety rule (below).
 *
 * WHY. Blink sorts every style rule into a bucket by the rightmost compound of its selector: an id, a class, a tag. A rule whose rightmost compound is a `:is()` list of several selectors has
 * nothing to sort it by and goes to the universal bucket, which is matched against EVERY element on EVERY style recalculation. 13.8 had 231 such rules (Chromium's own selector statistics
 * over tab clicks, the sidebar, typing and a menu: 57 % of all selector-matching time), so every interaction paid for them on every element: a whole-interface recalculation was ~1.1 ms on an
 * M5 and several times that on a slow Windows laptop, and the sidebar slide, Seamless reveal, Sidebar mode and window resize run dozens of them.
 *
 * MEANS THE SAME. (1) Matching: `PREFIX :is(A, B)SUFFIX` becomes `PREFIX A SUFFIX, PREFIX B SUFFIX` only when that is the same set of elements: when every member is a single compound (no combinator
 * inside), or the prefix is empty, or the prefix is anchored on the interface's root (`:root…` or `.app…`, which encloses everything). Anything else is left exactly as written.
 * (2) Specificity: `:is()` takes the specificity of its MOST specific member, so every flattened selector is padded with `:not(.sp)` (an unused class: one class of specificity each) up to the
 * specificity the original had; the cascade order against every other rule is untouched. If a member cannot be padded to it exactly (it differs in ids or element names), the selector is left as written.
 * (3) Validity (13.8): inside `:is()` a member Chromium cannot parse is dropped on its own (a forgiving list); in a plain selector list it would drop the WHOLE rule. So a list with a member that
 * names a pseudo-element or a vendor-prefixed pseudo-class is never split, and a real-app rig checks every flattened selector with CSS.supports() in the real app.
 */
const PAD = ':not(.sp)';

function splitTop(text) {
  const out = []; let depth = 0, cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const matching = (text, open) => { let depth = 0; for (let i = open; i < text.length; i++) { if (text[i] === '(') depth++; if (text[i] === ')' && --depth === 0) return i; } return -1; };

/** [ids, classes/attributes/pseudo-classes, elements/pseudo-elements] of ONE complex selector (no top-level commas). */
function specificity(sel) {
  const s = [0, 0, 0], max = list => list.map(specificity).reduce((a, b) => (b[0] > a[0] || (b[0] === a[0] && (b[1] > a[1] || (b[1] === a[1] && b[2] > a[2])))) ? b : a, [0, 0, 0]);
  let i = 0;
  while (i < sel.length) {
    const ch = sel[i];
    if (ch === '#') { s[0]++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
    else if (ch === '.') { s[1]++; i++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
    else if (ch === '[') { s[1]++; i = sel.indexOf(']', i) + 1 || sel.length; }
    else if (ch === ':') {
      if (sel[i + 1] === ':') { s[2]++; i += 2; while (i < sel.length && /[\w-]/.test(sel[i])) i++; if (sel[i] === '(') i = matching(sel, i) + 1; continue; }
      i++; let name = ''; while (i < sel.length && /[\w-]/.test(sel[i])) name += sel[i++];
      if (sel[i] === '(') {
        const end = matching(sel, i), inner = sel.slice(i + 1, end);
        if (name === 'where') { /* no specificity */ }
        else if (name === 'not' || name === 'is' || name === 'has' || name === 'matches') { const m = max(splitTop(inner)); s[0] += m[0]; s[1] += m[1]; s[2] += m[2]; }
        else s[1]++;
        i = end + 1;
      } else if (['before', 'after', 'first-line', 'first-letter'].includes(name)) s[2]++;
      else s[1]++;
    } else if (/[a-zA-Z]/.test(ch)) { s[2]++; while (i < sel.length && /[\w-]/.test(sel[i])) i++; }
    else i++;   // combinators, whitespace, *, &
  }
  return s;
}
const same = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The last top-level `:is(…)` of a selector and the text after it, when that text is still the same compound (no combinator, no whitespace outside brackets). */
function lastIs(part) {
  let depth = 0, start = -1, end = -1;
  for (let i = 0; i < part.length; i++) {
    const ch = part[i];
    if (ch === '[') depth++;
    if (ch === ']') depth--;
    if (ch === '(') { if (depth === 0 && part.slice(Math.max(0, i - 3), i) === ':is') { start = i - 3; end = matching(part, i); i = end; continue; } depth++; }
    if (ch === ')') depth--;
  }
  if (start < 0 || end < 0) return null;
  const after = part.slice(end + 1), bare = after.replace(/\((?:[^()]|\([^()]*\))*\)/g, '').replace(/\[[^\]]*\]/g, '');
  return /[\s>+~,]/.test(bare) ? null : { start, end, after };
}
const ANCHOR = /^(?:(?::root|\.app)(?:\.[\w-]+|\[[^\]]*\]|:[\w-]+(?:\((?:[^()]|\([^()]*\))*\))?)*\s+)+$/;
const simple = member => !/[\s>+~]/.test(member.replace(/\((?:[^()]|\([^()]*\))*\)/g, '').replace(/\[[^\]]*\]/g, ''));
const padTo = (sel, target) => {
  const own = specificity(sel);
  if (own[0] !== target[0] || own[2] !== target[2] || own[1] > target[1]) return null;
  const k = target[1] - own[1], at = sel.search(/::[\w-]/) /* padding goes before ANY pseudo-element: after one, a pseudo-class makes the selector invalid and drops the rule */, pad = PAD.repeat(k);
  return at < 0 ? sel + pad : sel.slice(0, at) + pad + sel.slice(at);
};
function expandPart(part) {
  const g = lastIs(part); if (!g) return [part];
  const before = part.slice(0, g.start), members = splitTop(part.slice(g.start + 4, g.end));
  if (members.some(m => /::|:-webkit-|:-moz-|:-ms-|&/.test(m))) return [part];
  if (!(before.trim() === '' || ANCHOR.test(before) || members.every(simple))) return [part];
  const out = members.flatMap(m => expandPart(before + m + g.after));
  const target = specificity(part), padded = out.map(sel => padTo(sel, target));
  return padded.every(Boolean) ? padded : [part];
}
const expand = list => splitTop(list).flatMap(expandPart);

/** One rule: the nesting form `:is(list) { &:hover::before { … } }` becomes top-level rules; any other rule has its trailing `:is()` lists expanded. */
function flattenRule(rule) {
  const m = /^:is\(([\s\S]*)\)$/.exec(rule.selector.trim()), nested = rule.nodes.filter(n => n.type === 'rule');
  if (m && nested.length && matching(rule.selector.trim(), 3) === rule.selector.trim().length - 1) {
    // `:is(list) { &:hover::before { … } … }`: each nested rule becomes a top-level rule on the flattened members
    for (const child of nested) {
      const text = splitTop(child.selector).map(part => part.replace(/&/g, rule.selector.trim())).join(', ');
      child.selector = expand(text).join(',\n');
      rule.before(child.clone());
    }
    rule.nodes.some(n => n.type === 'decl') ? nested.forEach(n => n.remove()) : rule.remove();
    return;
  }
  if (rule.selector.includes(':is(')) rule.selector = expand(rule.selector).join(',\n');
}

module.exports = () => ({
  postcssPlugin: 'flatten-is',
  Once(root) {
    const first = root.first;
    if (first && first.type === 'comment' && /@no-flatten-is/.test(first.text)) return;
    // top-level rules and the rules of @media / @supports / @layer / @container blocks; never inside @keyframes, and never a nested rule (its `&` stands for a parent list)
    root.walkRules(rule => {
      const parent = rule.parent;
      if (parent.type === 'rule') return;
      if (parent.type === 'atrule' && !/^(media|supports|layer|container)$/i.test(parent.name)) return;
      flattenRule(rule);
    });
  },
});
module.exports.postcss = true;
module.exports.specificity = specificity;
module.exports.expand = expand;
