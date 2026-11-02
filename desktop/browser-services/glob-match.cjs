'use strict';
// Glob matching for the patterns an extension hands the main process (match-pattern paths, tabs.query titles, user-script globs, host
// permission containment). They used to become a regular expression ('*' -> '.*'), and a pattern with a few stars ('/*a*a*a*a*a*a*a*b') takes
// time that grows with the n-th power of the text, which an extension controls too (its own tab's address or title, a page it opened): one
// call froze the browser's main process. This is the linear-time form: '*' matches any run of characters (newlines included, as the 's' flag
// did), '?' one character when `single` is set, everything else itself. Worst case is glob length x text length, with no backtracking blow-up.
/** Does the whole of `text` match `glob`? */
function globMatch(glob, text, {single = false} = {}) {
  glob = String(glob); text = String(text);
  let g = 0, t = 0, star = -1, mark = 0;
  while (t < text.length) {
    if (g < glob.length && glob[g] === '*') { star = g++; mark = t; continue; }
    if (g < glob.length && (glob[g] === text[t] || (single && glob[g] === '?'))) { g++; t++; continue; }
    if (star >= 0) { g = star + 1; t = ++mark; continue; }
    return false;
  }
  while (g < glob.length && glob[g] === '*') g++;
  return g === glob.length;
}

/** A tester with the shape of a RegExp's (`.test(text)`), for code that held a compiled regular expression. */
const globTester = (glob, options) => ({test: text => globMatch(glob, text, options)});

module.exports = {globMatch, globTester};
