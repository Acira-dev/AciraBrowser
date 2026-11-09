import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Windows High Contrast (forced colors) removes box-shadows and forces borders to one colour. These controls showed their keyboard focus only with a border colour or an inset shadow,
// so tabbing onto them in High Contrast showed nothing. Each now has a forced-colors block with a system-colour outline.
const read = (file: string) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const forcedBlocks = (css: string) => [...css.matchAll(/@media \(forced-colors: active\) \{([^}]*\{[^}]*\})\s*\}/g)].map(match => match[1]);

test('the shortcut key field, the settings text fields and the tab group label keep a focus ring in forced colors', () => {
  for (const [file, selector] of [
    ['src/features/settings/shortcuts.css', '.sk-keys:focus-visible'],
    ['src/features/settings/settings.css', ':is(.st-input, textarea, .st-textarea):focus-visible'],
    ['src/components/TabGroups.css', '.tab-group-label:focus-visible'],
  ] as const) {
    const blocks = forcedBlocks(read(file)).filter(block => block.includes(selector));
    assert.equal(blocks.length >= 1, true, `${file}: a forced-colors block for ${selector}`);
    assert.match(blocks[0], /outline:\s*2px solid Highlight/, file);
  }
});
