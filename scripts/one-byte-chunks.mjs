// Memory (13.5): the same rule as the main-process bundle (scripts/one-byte-source.mjs), for the scripts the renderers hold. V8 keeps every script's
// source text for the life of the process, and ANY character above U+00FF makes the whole script a two-byte string (twice the memory). The two
// interface renderers (the main view and the always-warm overlay view) each hold the built chunks dist/assets/App-*.js (1.4 MB) and index-*.js
// (0.5 MB), so a few hundred typographic characters (an ellipsis, a curly apostrophe, an arrow) in them cost about 4 MB for nothing.
// oneByteChunks() is a Vite plugin: after the build has minified and numbered every chunk, it writes each character above U+00FF in a chunk as the
// escape that means the same thing where it stands (a string, a template, a regular expression, a comment), so the chunk is Latin-1 text and is held
// at one byte per character. The program is the same: sameProgram() compares the two texts node by node, and a build that cannot keep it identical
// (a tagged template with such a character, an identifier) stops instead of shipping a changed meaning.
// A chunk whose text is mostly such characters (the Hindi, Arabic, Russian, Japanese, Korean and Chinese catalogs) is left alone: its escapes would be
// longer than the two-byte string it is now, and a person holds at most one of those at a time.
// (one-byte-source.mjs and its TypeScript parser are loaded when a build reaches the rewrite, not when the Vite config is read.)

/** Latin-1: U+0000 to U+00FF stays as it is (Chromium holds it as one byte per character), anything above is written as an escape. */
export const LATIN1 = 0xff;

/** Writing a character as an escape adds five characters; the chunk is rewritten only while that stays under half its length (a two-byte string doubles it). */
export const worthEscaping = (length, wide) => wide * 10 <= length;

/** The chunk's text as Latin-1: { code, wide, changed, dense }. `dense`: too many such characters for escapes to pay, left as it is. */
export async function oneByteChunk(code, {name = 'chunk', limit = LATIN1} = {}) {
  const {oneByteSource, sameProgram, countWide} = await import('./one-byte-source.mjs');
  const wide = countWide(code, limit);
  if (!wide) return {code, wide, changed: false, dense: false};
  if (!worthEscaping(code.length, wide)) return {code, wide, changed: false, dense: true};
  const out = oneByteSource(code, limit, {module: true});
  const difference = sameProgram(code, out);
  if (difference) throw new Error(`${name}: the Latin-1 rewrite changed the program (${difference})`);
  return {code: out, wide, changed: true, dense: false};
}

/** Vite plugin: every JavaScript chunk of a build comes out as Latin-1 text (see above). Runs last, after minifying and after the file names are fixed. */
export function oneByteChunks() {
  return {
    name: 'acira-one-byte-chunks', apply: 'build', enforce: 'post',
    generateBundle: {order: 'post', async handler(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const result = await oneByteChunk(file.code, {name: file.fileName});
        if (result.changed) file.code = result.code;
      }
    }},
  };
}
