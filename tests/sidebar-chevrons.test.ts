import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// R3-35 (sidebar part): every disclosure chevron in the sidebar turns with its section's state, and its turn takes the
// global speed setting (a duration times --motion-scale: Premium 1.7, Fast 1, Off 0; Fast until the setting lands).
const css = fs.readFileSync(new URL('../src/components/sidebar/sidebar.css', import.meta.url), 'utf8');
const rules = css.split('\n').filter(line => line.includes('{')).map(line => ({ selector: line.slice(0, line.indexOf('{')), body: line.slice(line.indexOf('{') + 1) }));

const chevrons = [
  ['a section header (Bookmarks, Downloads, History, Reading list)', '.sb-zone-chev{'],
  ['a tab group header', '.sb-group-header>svg{'],
  ['a bookmarks folder', '.sb-folder>svg:last-child{'],
  ['a split header', '.split-group-disclosure>svg{'],
] as const;

for (const [name, selector] of chevrons) {
  test(`the chevron of ${name} animates its turn, scaled by the speed setting`, () => {
    const rule = rules.find(item => (item.selector + '{').endsWith(selector));
    assert.ok(rule, `a rule for ${selector}`);
    const transform = /transition:([^;}]*)/.exec(rule!.body)?.[1] ?? '';
    const turn = transform.split(/,(?![^(]*\))/).find(part => part.trim().startsWith('transform'));
    assert.ok(turn, `${selector} transitions transform: ${transform}`);
    assert.match(turn!, /--motion-scale,\s*1\)/, `${selector}: its duration is multiplied by var(--motion-scale,1)`);
  });
}

test('a folded section, a collapsed group and a closed folder point right (-90deg); open ones point down', () => {
  assert.match(css, /\.sb-zone\[data-folded\] \.sb-zone-chev\{transform:rotate\(-90deg\)\}/);
  assert.match(css, /\.sb-group\[data-collapsed\]>\.sb-group-header>svg\{transform:rotate\(-90deg\)\}/);
  assert.match(css, /\.sb-folder>svg:last-child\{[^}]*transform:rotate\(-90deg\)/);
  assert.match(css, /\.sb-folder\[aria-expanded=true\]>svg:last-child\{transform:none\}/);
});

test('reduced motion still makes every chevron turn instant', () => {
  assert.match(css, /\[data-reduced-motion\] \*,[^{]*\{transition:none!important/);
});
