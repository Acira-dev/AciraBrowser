import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { PICK_CONTROLS, PICK_ROWS, PICK_SKIP, pickRowFor, type PickNode } from '../src/components/popupPick';

// A tiny tree: each fake node knows what kind of thing it is, and answers the three selectors the helper asks about.
class N implements PickNode {
  parent: N | null = null;
  constructor(readonly name: string, readonly kind: { row?: boolean; control?: boolean; skip?: boolean } = {}) {}
  add(child: N) { child.parent = this; return child; }
  closest(selector: string): N | null {
    const flag = selector === PICK_ROWS ? 'row' : selector === PICK_CONTROLS ? 'control' : null;
    if (!flag) throw new Error('unexpected selector ' + selector);
    for (let node: N | null = this; node; node = node.parent) if (node.kind[flag]) return node;
    return null;
  }
  matches(selector: string) { if (selector !== PICK_SKIP) throw new Error('unexpected selector ' + selector); return !!this.kind.skip; }
  contains(other: PickNode | null | undefined) { for (let node = other as N | null; node; node = node.parent) if (node === this) return true; return false; }
}

test('a click on a plain menu button picks that row (blink, then replay on it)', () => {
  const root = new N('root'); const row = root.add(new N('button.menu-row', { row: true, control: true })); const label = row.add(new N('span'));
  assert.equal(pickRowFor(label, root), row);
  assert.equal(pickRowFor(row, root), row);
});

test('a switch inside a fact row is NOT swallowed: the control owns the click (R3 protection popup bug)', () => {
  const root = new N('root');
  const row = root.add(new N('div.acira-menu-row', { row: true }));
  const title = row.add(new N('span.acira-menu-title'));
  const toggle = row.add(new N('button[role=switch]', { control: true }));
  const thumb = toggle.add(new N('span'));
  assert.equal(pickRowFor(thumb, root), null, 'the thumb of the switch');
  assert.equal(pickRowFor(toggle, root), null, 'the switch itself');
  assert.equal(pickRowFor(title, root), row, 'the row text still picks');
  assert.equal(pickRowFor(row, root), row, 'the row background still picks');
});

test('buttons, links and fields inside a row keep their own clicks', () => {
  const root = new N('root'); const row = root.add(new N('div.menu-row', { row: true }));
  for (const name of ['button.undo', 'a[href]', 'input', 'select', 'div[role=checkbox]']) {
    const control = row.add(new N(name, { control: true })); const inner = control.add(new N('svg'));
    assert.equal(pickRowFor(inner, root), null, name);
  }
});

test('rows that toggle, expand or are disabled never blink', () => {
  const root = new N('root');
  const row = root.add(new N('button.menu-row', { row: true, control: true, skip: true }));
  assert.equal(pickRowFor(row.add(new N('span')), root), null);
});

test('a row outside the popup, or no row at all, is left alone', () => {
  const root = new N('root'); const stray = new N('div.menu-row', { row: true }); const plain = root.add(new N('p'));
  assert.equal(pickRowFor(stray, root), null);
  assert.equal(pickRowFor(plain, root), null);
  assert.equal(pickRowFor(null, root), null);
});

test('the popup surface uses the helper and the selectors name the house controls', () => {
  const source = fs.readFileSync('src/components/SheetPopupSurface.tsx', 'utf8');
  assert.match(source, /pickRowFor\(event\.target as Element,root\.current\)/);
  assert.doesNotMatch(source, /closest\?\.\(pickRows\)/);
  for (const token of ['button', 'input', '[role="switch"]', '[role="checkbox"]', 'a[href]']) assert.ok(PICK_CONTROLS.includes(token), token);
});
