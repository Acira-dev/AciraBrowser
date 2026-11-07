import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compactRowHeight } from '../src/ui/chromeRow';

/** R4 leftovers (responsive sweep, 900x600, 80% interface, top tabs, Focus): a split pane's ribbon close button must never reach
 * into the strip the native caption buttons own. In Focus and Compact the chrome row is `compactRowHeight` CSS px, the page starts
 * right under it, and the overlay (so the caption buttons) is that same height times the interface scale, rounded up by the host.
 * The ribbon is 26px with a 20px close button centred in it, so the control starts 3px below the page edge. A generic 28px
 * `.icon-button` rule with the same weight used to win, which put the 28px box 1px above the page edge. */
const read = (file: string) => fs.readFileSync(path.resolve(file), 'utf8');
const css = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (text: string) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({ selector: match[1].trim(), body: match[2] }));
/** Specificity as [ids, classes+attributes+pseudo-classes, types]; enough for the flat selectors in these files. */
const weight = (selector: string): [number, number, number] => {
  const bare = selector.replace(/:(?:is|where|not|has)\(([^)]*)\)/g, (_all, inner) => (/^:where/.test(_all) ? '' : ` ${inner} `));
  return [(bare.match(/#[\w-]+/g) || []).length, (bare.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length, (bare.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length];
};
const heavier = (a: string, b: string) => { const [x, y] = [weight(a), weight(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

test('the ribbon close button is a 20px box in the 26px ribbon, whatever the generic icon-button rules say', () => {
  const split = css('src/features/split/split.css'), close = rules(split).find(rule => /\.split-label>\.split-label-close\.icon-button$/.test(rule.selector.split(',').pop()!.trim()));
  assert.ok(close, 'a rule for the ribbon close button');
  for (const property of ['width:20px', 'min-width:20px', 'height:20px', 'flex:0 0 20px']) assert.ok(close.body.includes(property), property);
  const generic = [] as { file: string; selector: string }[];
  for (const file of ['src/frost-preview.css', 'src/styles.css', 'src/shell-references.css', ...fs.readdirSync('src/styles').filter(name => name.endsWith('.css')).map(name => 'src/styles/' + name), ...fs.readdirSync('src/features/split').filter(name => name.endsWith('.css')).map(name => 'src/features/split/' + name)])
    for (const rule of rules(css(file))) {
      if (!/(^|[;\s])(width|min-width|height|flex-basis|flex):/.test(rule.body)) continue;
      // A size rule whose last compound is the bare .icon-button and whose context is not another component's own row.
      for (const part of rule.selector.split(',').map(item => item.trim())) if (/(^|[\s>])\.icon-button$/.test(part) && !/\.(?:find-row|tab-strip-add|navigation-controls|toolbar-actions|workspace-rail|acira-focus-row|compact-navigation|browser-toolbar|sb-addr-more-in)\b/.test(part)) generic.push({ file, selector: part });
    }
  assert.ok(generic.some(item => item.selector === '.app.style-acira .icon-button'), 'the generic 28px rule is the one this guards against');
  for (const item of generic) assert.ok(heavier('.app .split-label>.split-label-close.icon-button', item.selector), `${item.selector} (${item.file}) must not outweigh the ribbon close rule`);
  assert.match(split, /\.app \.split-label\{height:26px;/);
});

test('in Focus and Compact the ribbon close button starts below the caption strip at every interface scale', () => {
  const app = read('src/App.tsx');
  assert.match(app, /captionHeight: effectiveMode !== 'standard' \? compactRowHeight/, 'the host is told the row height as the caption height');
  const ribbon = 26, button = 20, inset = (ribbon - button) / 2;
  assert.ok(inset >= 0, 'the box never leaves the ribbon');
  for (const scale of [80, 90, 100, 110, 125, 150, 175]) {
    const factor = scale / 100, captionDip = Math.round(compactRowHeight * factor), buttonTopDip = (compactRowHeight + inset) * factor;
    assert.ok(buttonTopDip >= captionDip, `${scale}%: button top ${buttonTopDip} DIP vs caption ${captionDip} DIP`);
    assert.ok(buttonTopDip >= Math.ceil(compactRowHeight * factor), `${scale}%: clear of the rounded-up caption`);
  }
});
