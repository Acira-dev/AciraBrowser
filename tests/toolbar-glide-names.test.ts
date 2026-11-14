import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toolbarItemLabels } from '../src/ui/toolbarPrefs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/styles/view-morph.css'), app = read('../src/App.tsx');

// A full test pass (sidebar on the right at 150 %): the toolbar's right group slid over the overflow ». A control with no view-transition-name rides the toolbar's own picture, which is the NEW layout,
// left-anchored and not stretched: it stood at its final place from the first frame while the named controls glided there from their old places and crossed it. Every control of the actions row
// is named, so the whole row glides on one clock and one curve (the spacing between neighbours is then a blend of two spacings that both clear the controls' width, which never shrinks below it).
const names = [...css.matchAll(/\.toolbar-actions>(\[data-toolbar-item=(\w+)\]|\.([\w-]+))\{view-transition-name:([\w-]+)\}/g)].map(m => ({ item: m[2], cls: m[3], name: m[4] }));

test('every optional toolbar button is named by its data-toolbar-item, except the AI-free toggle that has its own class', () => {
  for (const id of Object.keys(toolbarItemLabels).filter(id => id !== 'aifree')) assert.ok(names.some(n => n.item === id), `${id} has no view-transition-name`);
  assert.ok(names.some(n => n.item === 'screenshot'), 'the optional screenshot button');
  assert.ok(names.some(n => n.cls === 'toolbar-aifree'), 'the AI-free toggle');
  assert.match(read('../src/components/AiFreeButton.tsx'), /className=\{`icon-button toolbar-aifree /);
});

test('the controls that have no data-toolbar-item are named too: the », the profile overflow, the private chip, the update pill, the pinned extensions', () => {
  for (const cls of ['toolbar-overflow', 'toolbar-overflow-profile', 'toolbar-private-chip', 'update-pill', 'native-extension-actions']) {
    assert.ok(names.some(n => n.cls === cls), `.${cls} has no view-transition-name`);
    // the class it carries in the actions row (App.tsx, the update pill's own file, the pinned buttons' file)
    const source = [app, read('../src/features/updates/UpdatePill.tsx'), read('../src/components/BrowserExtensionActions.tsx')].join('\n');
    assert.ok(source.includes(cls), `${cls} is no longer rendered anywhere`);
  }
});

test('the names are unique, and the ones that were added are controls of the glide (view-transition-class acira-control)', () => {
  const all = [...css.matchAll(/view-transition-name:([\w-]+)\}/g)].map(m => m[1]);
  assert.equal(new Set(all).size, all.length, 'a duplicated name cancels the whole transition');
  const classRule = css.match(/\.acira-persistent-toolbar :is\(([^{]+)\)\{view-transition-class:acira-control\}/)?.[1] || '';
  for (const part of ['.toolbar-overflow', '.toolbar-overflow-profile', '.toolbar-private-chip', '.update-pill', '.native-extension-actions', '.toolbar-aifree']) assert.ok(classRule.includes(part), `${part} is not in the acira-control class rule`);
});

test('the », which sits between the Focus button and the menu, keeps that order in the DOM (the glide cannot cross controls that never swap)', () => {
  const row = app.slice(app.indexOf('const actions = <div className="toolbar-actions">'));
  const at = (needle: string) => row.indexOf(needle);
  assert.ok(at('optionalActions') > -1 && at('optionalActions') < at('overflowButton') && at('overflowButton') < at('<UpdatePill') && at('<UpdatePill') < at('toolbar-menu-control'), 'optional buttons, then », then the update pill, then the menu');
});
