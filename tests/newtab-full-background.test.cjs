// R3-75 / R3-76: the full-background new tab. One press state on every control, a loader left of "Another image",
// text aligned to the search field's column, and tile labels with no per-label pill.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const css = read('src/styles/new-tab-page.css').replace(/\/\*[\s\S]*?\*\//g, '');
const controls = read('src/features/newtab/ArtworkControls.tsx');
/** Every declaration block whose selector list contains `selector` exactly, merged in source order. */
function rules(selector) {
  const out = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of match[2].split(';')) { const at = decl.indexOf(':'); if (at > 0) out[decl.slice(0, at).trim()] = decl.slice(at + 1).trim(); }
  }
  return out;
}

test('every new tab control shares one press state: scale .96, a pressed fill, a spring release that follows the speed setting', () => {
  const tokens = rules('.app.style-acira .nt-page');
  assert.equal(tokens['--nt-press-scale'], '.96');
  assert.match(tokens['--nt-press-out'], /var\(--motion-f, 1\)/);
  assert.match(tokens['--nt-spring'], /^linear\(/);
  for (const control of ['.nt-change', '.nt-hide', '.nt-tile', '.nt-submit']) {
    const active = rules(`.app.style-acira .nt-page ${control}:active`);
    assert.equal(active.scale, 'var(--nt-press-scale)', control);
    assert.match(rules(`.app.style-acira .nt-page ${control}`).transition ?? '', /scale var\(--nt-press-out\) var\(--nt-spring\)/, control);
  }
  // Off and the OS setting do not move anything.
  assert.equal(rules(".app[data-reduced-motion='true'] .nt-page")['--nt-press-scale'], '1');
  // "Another image" and "Collection" are covered in both modes: the full-background rail only changes the pressed fill, never the scale.
  assert.equal(rules('.app.style-acira .nt-page .nt-full-art-controls .nt-change:active').scale, undefined);
  assert.ok(rules('.app.style-acira .nt-page .nt-full-art-controls .nt-change:active').background);
});

test('the dot-matrix loader stands left of "Another image", outside the layout, and fades out with the crossfade', () => {
  assert.match(controls, /className="nt-art-pending"/);
  assert.match(controls, /<DotMatrix size=\{20\}/);
  // It is rendered before the button it stands beside.
  assert.ok(controls.indexOf('nt-art-pending') < controls.indexOf('nt-change nt-next'));
  const pending = rules('.nt-art-pending');
  assert.equal(pending.position, 'absolute');
  assert.match(pending.right, /^calc\(100% \+ \d+px\)$/);
  assert.match(rules('.nt-art-pending[data-state=in]').animation, /var\(--motion-scale, 1\)/);
  assert.match(rules('.nt-art-pending[data-state=out]').animation, /var\(--motion-scale, 1\)/);
  assert.equal(rules('.nt-page[data-style=framed] .nt-art-pending').display, 'none', 'framed mode keeps its own loader on the picture');
});

test('the search field keeps its column; the tile labels have no pill and no shelf behind them, only a soft multi-layer shadow', () => {
  const page = rules('.nt-page');
  assert.equal(page['--nt-col'], '640px');
  assert.match(page['--nt-edge'], /100cqw/);
  // Founder: no gray rectangle behind the tiles. No box of any kind on the row or the labels.
  assert.ok(!/\.nt-tiles::(before|after)/.test(css), 'no shelf pseudo-element behind the tile row');
  const label = rules('.app.style-acira .nt-page[data-style=full][data-art=on] .nt-tile-label');
  assert.equal(label.padding, '0');
  assert.equal(label.background, undefined, 'no per-label plate');
  assert.equal(label.color, '#fff');
  assert.equal(label['box-shadow'], undefined);
  // A text-shadow would be clipped by the label's own ellipsis box and read as a rectangle, so the shadow is drop-shadow filters (outside the clip).
  assert.equal(label['text-shadow'], undefined);
  // The ink follows the painting (labelInk.ts sets data-ink): near-black on pale ground, white on dark, each with exactly two soft layers so the ink change crossfades.
  const layers = (rule) => (rule.filter.match(/drop-shadow\(/g) || []).length;
  const light = rules('.app.style-acira .nt-page[data-style=full][data-art=on] .nt-tile-label[data-ink=light]');
  const dark = rules('.app.style-acira .nt-page[data-style=full][data-art=on] .nt-tile-label[data-ink=dark]');
  assert.equal(light.color, '#fff');
  assert.equal(dark.color, 'var(--nt-ink-pale)');
  assert.equal(rules('.nt-page')['--nt-ink-pale'], 'rgb(14 14 16)');
  for (const rule of [label, light, dark]) assert.equal(layers(rule), 2, 'two layers');
  assert.match(dark.filter, /rgb\(255 255 255/, 'a light glow behind dark ink');
  assert.match(light.filter, /rgb\(0 0 0/, 'a dark glow behind white ink');
  assert.match(read('src/features/newtab/NewTabPage.tsx'), /measureInks\(art, image, labels\)/, 'measured once per picture, layout and tile set');
  assert.doesNotMatch(read('src/features/newtab/labelInk.ts'), /requestAnimationFrame|setInterval/, 'no per-frame work in the sampler');
});
