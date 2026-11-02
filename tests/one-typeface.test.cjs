// One typeface (founder, 2 Nov 2026): Inter everywhere, with the same features everywhere. Geist, Geist Mono and IBM Plex Sans
// are gone from the interface, the pages main draws itself and the package; scripts Inter lacks fall back to system faces.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const skip = /^desktop\/(?:browser-services\/(?:chromium-api|annoyance-lists|vendor)|native|browser-services\/tor-engine)\//;
const shipped = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const file = dir + '/' + entry.name;
    if (skip.test(file + '/')) continue;
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:css|ts|tsx|cjs|mjs|js|html)$/.test(entry.name)) shipped.push(file);
  }
})('src');
for (const dir of ['desktop', 'public']) (function walk(d) {
  for (const entry of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    const file = d + '/' + entry.name;
    if (skip.test(file + '/')) continue;
    if (entry.isDirectory()) walk(file);
    else if (/\.(?:css|cjs|js|html)$/.test(entry.name)) shipped.push(file);
  }
})(dir);

test('no Geist or Plex is named anywhere the browser ships', () => {
  assert.ok(shipped.length > 100, 'found the sources');
  const named = shipped.filter(file => /\bGeist\b|\bPlex\b/.test(read(file)));
  assert.deepStrictEqual(named, []);
});

test('the only font file is Inter, with its license', () => {
  assert.deepStrictEqual(fs.readdirSync(path.join(root, 'public/fonts')).sort(), ['InterVariable.woff2', 'inter-LICENSE.txt']);
  const faces = read('src/fonts.css').match(/@font-face\{[^}]*\}/g);
  assert.equal(faces.length, 1);
  assert.match(faces[0], /font-family:'Inter';[^}]*url\('\/fonts\/InterVariable\.woff2'\)/);
  assert.match(read('THIRD_PARTY_NOTICES.md'), /\| Inter font[^|]*\| public\/fonts\/InterVariable\.woff2/);
});

test('interface, subtitle and display text share one family and one set of features', () => {
  const css = read('src/styles.css'), token = name => css.match(new RegExp(`--${name}:([^;]+);`))[1];
  assert.match(token('font-ui'), /^'Inter',/);
  assert.equal(token('font-subtitle'), 'var(--font-ui)');
  assert.equal(token('font-display'), 'var(--font-ui)');
  assert.equal(token('font-features'), "'cv11','ss03'");
  assert.equal(token('display-features'), 'var(--font-features)');
  assert.match(token('font-mono'), /^ui-monospace,/, 'code keeps a system monospace');
  // The font shorthand resets font-feature-settings, so the features are set on every element, not inherited.
  assert.match(css, /\*,::before,::after\{font-feature-settings:var\(--font-features\)!important\}/);
  assert.doesNotMatch(read('src/styles/subtitles.css'), /font-feature-settings/, 'subtitles no longer turn the features off');
  assert.match(read('src/styles/rtl.css'), /--font-ui: 'Inter', 'Segoe UI', 'Nirmala UI', 'Malgun Gothic', system-ui, sans-serif;/, 'non-Latin fallbacks stay');
});

test('the pages main draws itself load the same Inter file, with the same features', () => {
  const features = read('src/styles.css').match(/--font-features:([^;]+);/)[1];
  const pages = {
    'desktop/tab-card.html': 'dist', 'desktop/site-prompt.html': 'dist', 'desktop/rewind/peek-frame.html': 'dist',
    'desktop/browser-services/side-panel-frame.html': 'dist', 'desktop/passwords/prompt-frame.html': 'dist',
    'public/native-dialog.html': 'served', 'public/share.html': 'served',
  };
  for (const [file, from] of Object.entries(pages)) {
    const html = read(file), face = html.match(/@font-face\{font-family:'Inter';[^}]*src:url\('([^']+)'\)/);
    assert.ok(face, `${file} declares Inter`);
    if (from === 'dist') {
      assert.equal(path.resolve(path.dirname(path.join(root, file)), face[1]), path.join(root, 'dist/fonts/InterVariable.woff2'), `${file} points at the built font`);
      assert.match(html, /Content-Security-Policy" content="default-src 'none'; font-src 'self';/, `${file} may load its own font, nothing else`);
      // The side panel frame never measures itself; the others report their size, so they say they are ready once Inter is in.
      if (!file.includes('side-panel')) assert.match(html, /document\.fonts\.load\('400 13px Inter'\)/, `${file} waits for Inter before it is measured`);
    } else assert.equal(face[1], '/fonts/InterVariable.woff2');
    assert.ok(html.includes(`*,::before,::after{font-feature-settings:${features}!important}`), `${file} uses the same features`);
    for (const [, stack] of html.matchAll(/font(?:-family)?:([^;}]*sans-serif)/g))
      assert.ok(/Inter/.test(stack) && stack.indexOf('Inter') < stack.search(/Segoe|system-ui|sans-serif/), `${file} names Inter first: ${stack}`);
  }
});

test('text measured to size a card counts Inter\'s features, as the screen does', () => {
  // Canvas measureText ignores font-feature-settings, and the single-storey a (cv11) is wider, so a canvas-sized status pill cut
  // its last letters. The toast and rating card measure in a hidden span instead, which the features rule reaches.
  for (const file of ['src/components/transient/Toast.tsx', 'src/features/metrics/ratingMoment.ts']) {
    const source = read(file);
    assert.doesNotMatch(source, /measureText|getContext\('2d'\)/, `${file} measures with a canvas`);
    assert.match(source, /measure\.style\.font = [^;]+; measure\.textContent = text;[^;]*getBoundingClientRect\(\)\.width/, `${file} measures in a span`);
  }
});

test('what people type stays literal in Inter', () => {
  // Inter's contextual alternates (calt, on by default) draw -> as an arrow and <=> as a double arrow, also in an address bar.
  assert.match(read('src/styles.css'), /input,textarea,\[contenteditable\],\.address-display\{font-variant-ligatures:no-contextual!important\}/);
  assert.match(read('desktop/site-prompt.html'), /input,textarea\{font-variant-ligatures:no-contextual!important\}/);
});
