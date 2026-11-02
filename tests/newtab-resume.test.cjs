// Round 3 (motion fix): switching between two new tab pages never dips to the bare ground. A page starts from a picture it already has
// (its own tab's last decoded one, else the one the page it replaced was showing), the replacing picture crossfades on the workspace
// length once it has decoded (and not at all when it is the same picture), and a resumed page does not replay its reveal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const page = read('src/features/newtab/NewTabPage.tsx');
const css = read('src/styles/new-tab-page.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('decoded pictures are remembered per tab and as the last one shown, and only within the same profile owner', () => {
  assert.match(page, /const seenByTab = new Map<string, Seen>\(\)/);
  assert.match(page, /let lastSeen: Seen \| null = null/);
  assert.match(page, /own\?\.owner === owner \? own : lastSeen\?\.owner === owner \? lastSeen : null/, 'a private or other-profile picture is never carried over');
  assert.match(page, /seenByTab\.size > 24/, 'the per-tab memory is bounded');
  assert.match(page, /held\.size > 8/, 'the retained decoded images are bounded');
});

test('the same picture again changes nothing on screen; another one replaces a carried seed with a crossfade', () => {
  assert.match(page, /swap = old\.owner !== owner \|\| old\.src !== src/);
  assert.match(page, /crossfade: old\.owner === owner && old\.seed === 'carried'/);
  assert.match(page, /seed: old\.seed, crossfade: old\.crossfade/, 'an unchanged picture keeps its flags, so its layer is not restarted');
});

test('a seeded picture paints on the first frame without an entrance; the replacing one fades on the workspace length', () => {
  assert.match(page, /decoding=\{seed \? 'sync' : 'async'\}/);
  assert.match(css, /\.nt-art\[data-seeded\] > img\[data-current\]\s*\{\s*animation:\s*none;?\s*\}/);
  assert.match(css, /\.nt-art\[data-crossfade\] > img\[data-current\]\s*\{[^}]*animation-duration:\s*calc\(130ms \* var\(--motion-scale, 1\)\)/);
  assert.ok(css.indexOf('.nt-art[data-crossfade]') < css.indexOf('.nt-art[data-reduced] > img[data-current]'), 'the reduced-motion fade still wins');
});

test('a resumed page does not replay its reveal', () => {
  assert.match(page, /decoded\.seed === 'own' \|\| \(decoded\.seed === 'carried' && document\.documentElement\.dataset\.modeSwitch === 'workspace'\)/);
  assert.match(page, /data-resumed=\{resumed \|\| undefined\}/);
  assert.match(css, /\.nt-page\[data-resumed\]\[data-resumed\] :is\(\.nt-vapor, \.nt-glow\)\s*\{\s*animation:\s*none;?\s*\}/);
});

test('a page waits for the profile\'s own images instead of showing the first catalog painting while they load', () => {
  // The list of personal images arrives a moment after the page mounts. Until then the choice (a personal image, or a pool that
  // includes them) falls back to the first catalog painting, which flashed on every workspace switch and every new tab.
  assert.match(page, /const awaitingPersonal = artOn && personal\.pending && \(prefs\.perTab \|\| prefs\.artwork\.startsWith\('personal:'\)\)/);
  assert.match(page, /useDecodedArtwork\([^;]*awaitingPersonal\);/, 'the hold reaches the decoder');
  assert.match(page, /const target = hold \? null : candidate \?\?/, 'held: nothing new is decoded, so the shown picture (or the ground) stays');
});

test('a remote collection on a daily or hourly interval changes its picture on the same terms as the built-in ones', () => {
  // The built-in pictures follow useArtworkDay: identical all period, and changing only when the person is not typing. The remote seed read the
  // clock itself on every render, so the picture swapped right after midnight or the hour while a search was being typed.
  assert.match(page, /prefs\.hourly \? artworkDay\.toISOString\(\)\.slice\(0, 13\) : prefs\.daily \? artworkDay\.toDateString\(\) : 'fixed'/);
  assert.doesNotMatch(page, /new Date\(\)/, 'nothing in the page reads the clock during render');
});
