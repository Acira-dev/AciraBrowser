/** Command-bar matching: a contiguous match beats a scattered one, word starts beat mid-word letters, and earlier and
 * shorter targets win ties. Returns the matched character positions for highlighting, or null for no match. */
export interface FuzzyMatch { score: number; indices: number[] }

const boundary = (text: string, i: number) => i === 0 || /[\s\-_./:·(]/.test(text[i - 1]) || /[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]);

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase(), at = t.indexOf(q);
  if (at >= 0) return { score: 100 + q.length * 4 + (at === 0 ? 30 : boundary(text, at) ? 15 : 0) - at * .5 - text.length * .05, indices: Array.from({ length: q.length }, (_, i) => at + i) };
  const letters = q.replace(/ /g, '');
  let best: FuzzyMatch | null = null;
  for (let start = t.indexOf(letters[0]), tries = 0; start >= 0 && tries < 24; start = t.indexOf(letters[0], start + 1), tries++) {
    const indices = [start];
    let score = boundary(text, start) ? 10 : 1, from = start + 1;
    for (let i = 1; i < letters.length && score >= 0; i++) {
      // Prefer the next word start when the letter is not adjacent: "nw" → New Window, not "New ..w".
      let next = t.indexOf(letters[i], from);
      if (next > from) { for (let j = from; j < t.length; j++) if (t[j] === letters[i] && boundary(text, j)) { next = j; break; } }
      if (next < 0) { score = -1; break; }
      score += next === from ? 6 : boundary(text, next) ? 8 : 1 - Math.min(3, (next - from) * .2);
      indices.push(next); from = next + 1;
    }
    if (score >= 0 && (!best || score > best.score)) best = { score, indices };
  }
  return best && best.score >= letters.length * 2.5 ? { score: best.score - text.length * .05, indices: best.indices } : null;
}
