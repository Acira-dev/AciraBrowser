import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Sparkles, SparklesOff } from '../src/components/AppIcons';
import { ProtectionIcon } from '../src/components/ProtectionIcon';

/** beta.7 (founder): Ads and trackers and AI-free mode, one above the other in the Acira menu, both wore a shield (a shield with a
 * check, and a plain one), and the AI-free toolbar button turned into Ads and trackers' own shield with a check when on. Then: "people
 * know that it's off or on... shows that it is AI". AI-free mode now wears the icon set's sparkles (the AI mark) while AI is shown and
 * the sparkle crossed out while it is hidden, in the menu, on the toolbar and in its status toast; the shield stays protection's. */
const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);

test('AI-free mode (off and on) and Ads and trackers draw three different icons; on is the sparkle crossed out', () => {
  const shield = renderToStaticMarkup(createElement(ProtectionIcon)), sparkles = renderToStaticMarkup(createElement(Sparkles)), off = renderToStaticMarkup(createElement(SparklesOff));
  const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/g)].map(match => match[1]);
  assert.ok(paths(sparkles).length > 0 && paths(shield).length > 0);
  for (const path of [...paths(sparkles), ...paths(off)]) assert.ok(!paths(shield).includes(path), 'no shape in common with the shield');
  assert.doesNotMatch(sparkles + off, /M8 1\.8 13 3\.6/, 'no shield outline');
  assert.notEqual(off, sparkles);
  const big = paths(off)[0];
  assert.ok(paths(sparkles)[0].startsWith(big), 'on: the sparkles\' own big star');
  assert.match(off, /<g><path d="M2 2 14 14" fill="none" stroke="currentColor" stroke-width="1\.4" stroke-linecap="round"><\/path><\/g>/, 'crossed out corner to corner, in a group: the set\'s .ed-editor-icon>path rule would thin a direct child to .25px');
  assert.match(read('src/frost-preview.css'), /\.ed-editor-icon>path \{ stroke:currentColor; stroke-width:\.25px;/);
});

test('The menu row, the toolbar button and the status toast of AI-free mode use the sparkles; Ads and trackers keeps its shield', () => {
  const menu = read('src/components/BrowserMenu.tsx'), button = read('src/components/AiFreeButton.tsx');
  assert.match(menu, /<MenuToggle icon=\{on\?SparklesOff:Sparkles\} label=\{t\("browsermenu\.aiFreeMode"\)\}/, 'the icon turns with the switch');
  assert.match(menu, /protection:<button type="button" className="menu-row menu-row-more" aria-haspopup="dialog" onClick=\{\(\)=>p\.open\('protection'\)\}><ProtectionIcon\/>/);
  assert.doesNotMatch(menu, /M8 1\.8 13 3\.6/, 'the menu draws no second shield of its own');
  assert.match(button, /<PreviewIcon icon=\{on\?SparklesOff:Sparkles\} className="toolbar-icon" size=\{18\}\/>/, 'the toolbar button too, with its pressed state');
  assert.doesNotMatch(button, /M8 1\.8 13 3\.6|m5\.6 8 1\.7 1\.7/, 'no shield, and no check when on');
  assert.match(button, /className=\{`icon-button \$\{on\?'active':''\}`\} aria-pressed=\{!!on\}/);
  const main = read('desktop/main.cjs');
  assert.match(main, /text:now\?tm\("main\.aiFreeModeOn"\):tm\("main\.aiFreeModeOff"\),tone:'status',icon:now\?'sparkles-off':'sparkles'\}/, 'the shortcut\'s toast shows the new state');
  assert.match(main, /tone:'status',icon:request\.patch\.aiContent\?'sparkles-off':'sparkles'\}/, 'and the switch\'s');
  assert.doesNotMatch(main, /icon:'shield'/);
  assert.match(read('src/components/transient/Toast.tsx'), /name === 'sparkles' \? <Sparkles size=\{16\} \/> : name === 'sparkles-off' \? <SparklesOff size=\{16\} \/>/);
  const { validateAction } = require('../desktop/validation.cjs');
  for (const icon of ['sparkles', 'sparkles-off']) assert.doesNotThrow(() => validateAction({ type: 'toast', text: 'AI-free mode on', tone: 'status', icon }));
});
