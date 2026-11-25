'use strict';
/**
 * Beta 14 (smoothness B1): a `:has()` whose subject is <html> (`:root`, `html`), <body> or `.app` becomes a test of an attribute that the interface
 * mirrors on <html> (src/ui/rootMirror.ts). The source keeps its readable `:has()`; only the build sees the attribute.
 *
 * WHY. With a `:has()` on the root, every node inserted, removed or restyled anywhere in the interface makes Chromium re-check the root and invalidate
 * the whole subtree under it, so each layout read in a click paid a full recalculation of the interface (4 per tab click, ~595 elements each, on an M5).
 *
 * MEANS THE SAME.
 * - Matching: `S:has(X)` becomes `S:where(:root[data-m-K] *)` (or `S:where([data-m-K])` when S is the root itself), and `S:not(:has(X))` becomes
 *   `S:not(:where(…))`. The attribute is present exactly while the condition X holds (rootMirror.ts: set by a component inside the element X looks
 *   for, in the same commit). Only the conditions in TABLE are rewritten; any other `:has()` on the root stays as written, and
 *   tests/root-has.test.cjs fails until it is mirrored too.
 * - Specificity: `:has(X)` and `:not(:has(X))` count X's specificity; `:where()` counts nothing, so the compound is padded with `:not(.sp)` (an unused
 *   class) once per class-level unit of X. X never holds an id or an element name here; if one did, the selector is left as written.
 */
const { specificity } = require('./postcss-flatten-is.cjs');

/** Normalized `:has()` argument -> the attribute test on <html>. */
const TABLE = {
  '>.setup-dialog': "[data-m-setup]",
  '>.ed-rail.is-expanded': "[data-m-rail~='expanded']",
  '>.ed-rail.is-expanded:not(.is-peek)': "[data-m-rail~='docked']",
  '>.ed-rail.is-peek': "[data-m-rail~='peek']",
  '>.acira-sidebar.is-peek': "[data-m-rail~='peek']",
  '>.ed-rail.is-shelf': "[data-m-rail~='shelf']",
  '>.acira-sidebar.is-mini': "[data-m-rail~='mini']",
  '.acira-sidebar.is-mini': "[data-m-rail~='mini']",
  '>.acira-sidebar.is-mini-docked': "[data-m-rail~='minidocked']",
  ">.sb-mini-shade[data-mini='open']": "[data-m-mini~='open']",
  ">.sb-mini-shade[data-mini='closing']": "[data-m-mini~='closing']",
  ">.sb-mini-shade[data-mini='rail']": "[data-m-mini~='rail']",
  '.ed-rail:not(.is-expanded)': "[data-m-rail-collapsed]",
  ".browser-shell[data-sbmode]": "[data-m-sbmode]",
  ".browser-shell[data-sbmode='bare']": "[data-m-sbmode~='bare']",
  ".browser-shell[data-sbmode='block']": "[data-m-sbmode~='block']",
  ">.browser-root>.browser-shell[data-sbmode='block']": "[data-m-sbmode~='block']",
  // the root's addr-side (App: the address block is shown), in the same commit as the sidebar in every layout, Seamless included (guard c3, address-in-sidebar.css)
  '>.browser-root.addr-side': "[data-m-addr~='side']",
  ".browser-shell[data-seamless]": "[data-m-seamless]",
  ".browser-shell[data-seamless='hidden']": "[data-m-seamless~='hidden']",
  ".browser-shell[data-seamless='shown']": "[data-m-seamless~='shown']",
  ".browser-shell:is([data-layout='compact'],[data-layout='focus'])": ":is([data-m-layout~='compact'],[data-m-layout~='focus'])",
  ">.browser-root:is(.mode-compact,.side-tabs,.mode-focus)": ":is([data-m-broot~='mode-compact'],[data-m-broot~='side-tabs'],[data-m-broot~='mode-focus'])",
  ".browser-body>.page-area>.page-content[data-native]": "[data-m-page-native]",
  '.native-layer': "[data-m-native-layer]",
  '.local-overlay-scrim': "[data-m-scrim]",
  ".app[data-reduced-motion='true']": "[data-m-reduced]",
};
const PAD = ':not(.sp)';
const norm = arg => arg.replace(/\s*([>+~,])\s*/g, '$1').replace(/\s+/g, ' ').replace(/"/g, "'").replace(/=([\w-]+)\]/g, "='$1']").trim();
const SUBJECT = /(?::root|html|body|\.app)$/;

/** The start of the compound that ends at `end` (exclusive): back to whitespace or a combinator at the same bracket depth. */
function compoundStart(sel, end) {
  let depth = 0;
  for (let i = end - 1; i >= 0; i--) {
    const ch = sel[i];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') { if (depth === 0) return i + 1; depth--; }
    else if (depth === 0 && /[\s>+~,]/.test(ch)) return i + 1;
  }
  return 0;
}
/** Index just past the `)` that closes the `(` at `open`. */
function closeOf(sel, open) { let depth = 0; for (let i = open; i < sel.length; i++) { if (sel[i] === '(') depth++; else if (sel[i] === ')' && --depth === 0) return i + 1; } return -1; }

/** Rewrites every mapped root `:has()` of one selector (a whole list is fine). Returns { selector, unmapped: [normalized args left as written] }. */
function rewrite(selector) {
  let out = selector, unmapped = [], guard = 0;
  for (;;) {
    if (++guard > 200) break;
    // the leftmost `:not(:has(` or `:has(` that sits on a root subject and is mapped
    const re = /:not\(\s*:has\(|:has\(/g; let m, done = true;
    while ((m = re.exec(out))) {
      const negated = m[0].startsWith(':not'), at = m.index;
      let start = compoundStart(out, at), head = out.slice(start, at);
      // `S:is(:has(A), :has(B))` / `S:where(:has(A))`: a :has() that is an argument of an :is() or :where() list on S takes S as its subject
      if (head === '') {
        let k = at - 1; while (k >= 0 && out[k] === ' ') k--;
        if (out[k] === '(' || out[k] === ',') {
          let depth = 0, open = -1;
          for (let i = k; i >= 0; i--) { const ch = out[i]; if (ch === ')') depth++; else if (ch === '(') { if (depth === 0) { open = i; break; } depth--; } }
          const fn = open >= 0 ? /:(is|where)$/.exec(out.slice(0, open)) : null;
          if (fn) { start = compoundStart(out, open - fn[0].length); head = out.slice(start, open - fn[0].length); }
        }
      }
      // the subject: the compound's first simple selector (`.app`, `:root`, `html`, `body`), with anything else of the compound before the :has
      const first = /^(:root|html|body|\.app)(?![\w-])/.exec(head);
      if (!first) continue;
      const hasOpen = negated ? out.indexOf('(', out.indexOf(':has', at)) : at + 4, hasEnd = closeOf(out, hasOpen);
      if (hasEnd < 0) continue;
      const arg = out.slice(hasOpen + 1, hasEnd - 1), key = norm(arg), mapped = TABLE[key];
      const end = negated ? closeOf(out, at + 4) : hasEnd;
      if (!mapped) { if (!unmapped.includes(key)) unmapped.push(key); continue; }
      const spec = specificity(arg);
      if (spec[0] || spec[2]) { if (!unmapped.includes(key)) unmapped.push(key + ' (id/element)'); continue; }
      const onRoot = first[1] === ':root' || first[1] === 'html';
      const test = onRoot ? `:where(${mapped})` : `:where(:root${mapped} *)`;
      const replacement = (negated ? `:not(${test})` : test) + PAD.repeat(spec[1]);
      out = out.slice(0, at) + replacement + out.slice(end);
      done = false; break;
    }
    if (done) break;
  }
  return { selector: out, unmapped };
}

module.exports = (options = {}) => ({
  postcssPlugin: 'root-has',
  Once(root, { result }) {
    root.walkRules(rule => {
      if (rule.parent.type === 'atrule' && /keyframes/i.test(rule.parent.name)) return;
      if (!rule.selector.includes(':has(')) return;
      const { selector, unmapped } = rewrite(rule.selector);
      if (selector !== rule.selector) rule.selector = selector;
      for (const key of unmapped) if (options.warn !== false) result.warn(`root :has() not mirrored: ${key}`, { node: rule });
    });
  },
});
module.exports.postcss = true;
module.exports.rewrite = rewrite;
module.exports.TABLE = TABLE;
module.exports.norm = norm;
