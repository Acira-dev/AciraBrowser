// The New Tab caption row never scrolls or grows: one fixed 32px row, single-line ellipsized title and artist lines,
// controls that cannot wrap, a framed page that cannot scroll, and a stack width shared by the frame and the caption row.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '../src/styles/new-tab-page.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** Every declaration block whose selector list contains `selector` exactly, merged in source order. */
function rules(selector) {
  const out = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(s => s.trim());
    if (!selectors.includes(selector)) continue;
    for (const decl of match[2].split(';')) { const at = decl.indexOf(':'); if (at > 0) out[decl.slice(0, at).trim()] = decl.slice(at + 1).trim(); }
  }
  return out;
}

test('caption row is one fixed 32px grid row', () => {
  const credit = rules('.nt-credit');
  assert.equal(credit.height, '32px');
  assert.equal(credit['grid-template-rows'], '32px');
  assert.match(credit['grid-template-columns'], /^minmax\(0, 1fr\) auto$/);
});

test('title and artist lines are single-line and ellipsized', () => {
  for (const selector of ['.nt-credit-title', '.nt-credit-meta']) {
    const rule = rules(selector);
    assert.equal(rule['white-space'], 'nowrap', selector);
    assert.equal(rule['text-overflow'], 'ellipsis', selector);
    assert.equal(rule.overflow, 'hidden', selector);
    assert.match(rule.font, /11px\/15px/, selector);
  }
  // Two 15px lines and the 2px gap fill the 32px row exactly.
  assert.equal(rules('.nt-credit-text').gap, '2px');
});

test('controls never wrap below the caption', () => {
  assert.equal(rules('.app.style-acira .nt-page .nt-art-controls .nt-change')['white-space'], 'nowrap');
  assert.doesNotMatch(css, /\.nt-credit\[data-caption\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/, 'no narrow-window rule may stack the controls under the caption');
});

test('the framed page cannot scroll, and frame + caption share the stack width', () => {
  assert.equal(rules('.nt-page[data-style=framed] .nt-scroll').overflow, 'hidden');
  assert.match(rules('.nt-page[data-style=framed] .nt-stack').width, /var\(--nt-frame-height/);
  assert.equal(rules('.nt-frame').width, '100%');
  assert.equal(rules('.nt-page[data-style=framed] .nt-frame').width, undefined, 'the frame must not get its own narrower width');
});

test('artwork controls use tokens and the 4/6/8 radius scale only', () => {
  const tail = css.slice(css.indexOf('.nt-art-loading'));
  assert.doesNotMatch(tail, /#fff\b|rgb\(14 14 16/);
  for (const [, value] of tail.matchAll(/border-radius:\s*([^;]+);/g)) assert.match(value, /^(4px|6px|8px|var\(--radius-[a-z]+, (4|6|8)px\))$/, value);
});

test('the full-name tooltip never grows wider than the caption cell, so it cannot cover the buttons beside it (R3-21)', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/features/newtab/NewTabPage.tsx'), 'utf8');
  assert.match(page, /node\.style\.maxWidth = `\$\{Math\.min\(560, innerWidth - 16, Math\.max\(240, rect\.width \+ 16\)\)\}px`/);
  assert.match(page, /rect\.left - 8 \+ w \/ 2/, 'it still opens with its text on the caption text (8px pad)');
});
