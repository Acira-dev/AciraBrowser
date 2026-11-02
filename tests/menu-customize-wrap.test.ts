import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Settings › Appearance › Menu sits beside a live preview, so its row names get ~85-110px. Eight Arabic names ended in "…" after a few
// letters ("علامة تبويب خا…"). A long name now takes a second line (at most two), the row grows only then, and one-line rows keep their
// 34px. The toolbar's own Customize popup shares the row classes and stays one line.
const rules = (file: string) => fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (css: string, selector: string) => {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(match => match[1].trim() === selector);
  assert.ok(found, `no rule for ${selector}`);
  return Object.fromEntries(found![2].split(';').map(part => part.split(':').map(side => side.trim())).filter(([name]) => name));
};

test('menu customizer names wrap to two lines; one-line rows keep their height', () => {
  const css = rules('src/styles/menu-customize.css');
  const row = rule(css, '.menu-customize-row'), check = rule(css, '.menu-customize-row .toolbar-customize-check'), name = rule(css, '.menu-customize-row .toolbar-customize-check>span');
  assert.equal(row.height, 'auto');
  assert.equal(row['min-height'], '34px');
  // 26px controls + 4px above and below is the old fixed 34px row.
  assert.equal(row['padding-top'], '4px');
  assert.equal(row['padding-bottom'], '4px');
  assert.equal(check.height, 'auto');
  assert.equal(check['min-height'], '26px');
  assert.equal(name['white-space'], 'normal');
  assert.equal(name['-webkit-line-clamp'], '2');
  assert.equal(name.display, '-webkit-box');
  assert.equal(name['-webkit-box-orient'], 'vertical');
  // The rows are drawn by MenuCustomizer with both classes; its stylesheet loads after the shared one, so these rules win.
  const component = fs.readFileSync('src/components/MenuCustomizer.tsx', 'utf8');
  assert.ok(component.indexOf("'../styles/toolbar-customize.css'") < component.indexOf("'../styles/menu-customize.css'"));
  assert.match(component, /className="toolbar-customize-row menu-customize-row"/);
});

test('the toolbar Customize popup keeps one-line rows', () => {
  const css = rules('src/styles/toolbar-customize.css');
  assert.equal(rule(css, '.toolbar-customize-row').height, '34px');
  assert.equal(rule(css, '.toolbar-customize-check>span')['white-space'], 'nowrap');
});
