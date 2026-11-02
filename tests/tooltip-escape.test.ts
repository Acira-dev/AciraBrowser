import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { tipKeyAction } from '../src/components/transient/tooltipKeys';

// Live finding (usage-consent, Round 3 source re-run): Esc on a pinned (i) tip hid the tip AND skipped setup, because the tip
// let the key pass on. The tip that a click pinned open is a layer of its own: Esc closes it and stops there.
test('Esc on a pinned info tip is used up closing it', () => {
  assert.equal(tipKeyAction('Escape', true, true), 'consume');
});

test('Esc on a tip that is only hovered or focused passes through (it is not a layer)', () => {
  assert.equal(tipKeyAction('Escape', true, false), 'hide');
});

test('Esc with no tip showing is never swallowed, even when a pin was remembered', () => {
  assert.equal(tipKeyAction('Escape', false, true), 'hide');
  assert.equal(tipKeyAction('Escape', false, false), 'hide');
});

test('any other key only hides the tip and goes on to its owner', () => {
  for (const key of ['Enter', 'Tab', ' ', 'a', 'ArrowDown']) assert.equal(tipKeyAction(key, true, true), 'hide', key);
});

test('TooltipHost routes keydown through the rule and stops the key it consumes', () => {
  const source = fs.readFileSync(new URL('../src/components/transient/Tooltip.tsx', import.meta.url), 'utf8');
  assert.match(source, /tipKeyAction\(event\.key, shown, pinned !== null\)/);
  assert.match(source, /action === 'consume'[^\n]*preventDefault\(\)[^\n]*stopPropagation\(\)/);
  assert.match(source, /addEventListener\('keydown', key, options\)/);
  assert.doesNotMatch(source, /addEventListener\('keydown', hide, options\)/);
});
