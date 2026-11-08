import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { CARRIED_SIZE, carriedState } from '../src/ui/useTabDragSurface';

test('R3-23/26: a dragged tab becomes its icon chip 10px below the strip and a pill again once back at the strip\'s bottom edge (hysteresis)', () => {
  assert.equal(CARRIED_SIZE, 28);
  assert.equal(carriedState(false, 40, 36), false, 'still over the strip');
  assert.equal(carriedState(false, 47, 36), true, 'past the 10px threshold: the chip forms');
  assert.equal(carriedState(true, 42, 36), true, 'stays a chip while it hovers just below the strip');
  assert.equal(carriedState(true, 37, 36), false, 'back at the strip: the pill returns');
});

test('R3-23/26: the carried chip morphs on the research springs, retargets on a reversal, cuts at speed Off, and hands over to the pane morph on a drop', () => {
  const source = fs.readFileSync(path.resolve('src/ui/useTabDragSurface.ts'), 'utf8'), strip = fs.readFileSync(path.resolve('src/components/BrowserTabsHorizontal.tsx'), 'utf8'), compact = fs.readFileSync(path.resolve('src/components/CompactTabs.tsx'), 'utf8');
  const css = fs.readFileSync(path.resolve('src/styles/split-picker.css'), 'utf8'), app = fs.readFileSync(path.resolve('src/App.tsx'), 'utf8');
  assert.match(source, /morphSpring\(target\?'tab\.split':'tab\.merge',scale\)/, 'the pill leaves on tab.split and returns on tab.merge');
  assert.match(source, /surface\.chip\.stop\?\.\(\)/, 'a reversal retargets from where the morph is');
  assert.match(source, /if\(scale===0\)\{surface\.chip\.p=target/, 'speed Off cuts');
  // The chip is keyed by its row (a linked split copy has its own row key), not the tab id.
  assert.match(strip, /L\.dragSurface\.carry\(key,info\.point/);
  assert.match(compact, /L\.dragSurface\.carry\(key,info\.point/);
  assert.match(strip, /L\.dragSurface\.end\(key,Boolean\(split\)\)/, 'a drop on a zone hands the chip to the pane morph at once');
  assert.match(app, /dropOrigin\([^)]*\), CARRIED_SIZE, CARRIED_SIZE\)|CARRIED_SIZE, CARRIED_SIZE\)/, 'the pane morph starts from the chip\'s box');
  assert.match(css, /\.tab-drag-preview>:not\(:first-child\)\{opacity:max\(0,calc\(1 - var\(--chip-p,0\) \* 2\.4\)\)\}/, 'the title and close button leave first, the icon stays');
});

test('single-tab drag (founder 26 Oct): with one tab the carried chip still follows the pointer in 2D in the strip, the compact strip and the sidebar; only the split needs two tabs', () => {
  const strip = fs.readFileSync(path.resolve('src/components/BrowserTabsHorizontal.tsx'), 'utf8'), compact = fs.readFileSync(path.resolve('src/components/CompactTabs.tsx'), 'utf8');
  const sidebar = fs.readFileSync(path.resolve('src/components/sidebar/AciraSidebar.tsx'), 'utf8'), surface = fs.readFileSync(path.resolve('src/ui/useTabDragSurface.ts'), 'utf8');
  for (const [name, source] of [['strip', strip], ['compact', compact]] as const) {
    const carry = source.match(/L\.dragSurface\.carry\([^;]*\);/)?.[0] ?? '';
    assert.ok(carry, `${name} carries the dragged tab`);
    assert.doesNotMatch(carry, /length>1|length>=2/, `${name}: the chip is not gated on the tab count (a lone tab was pinned to a vertical track)`);
  }
  assert.match(strip, /moveSplitDrag\(tab\.id,info\.point,!L\.dragCancelled\.current&&L\.props\.state\.tabs\.length>1\)/, 'the split picker still needs a second tab');
  assert.match(sidebar, /current\.rowPreview\?\?=carrySidebarRow\(/, 'a sidebar row has a full-row/icon carry surface, whatever the tab count');
  assert.match(sidebar, /current\.chip\?\.end\(Boolean\(split\)\)/, 'a split drop hands the sidebar chip to the pane morph at once');
  assert.match(surface, /export function carryChip\(/);
  assert.match(surface, /carriedBeyondEdge\(state\.target===1,point\.x,edge,side\)/, 'the sidebar chip forms 10px past the sidebar edge, with the strip chip\'s hysteresis');
  assert.match(surface, /side==='right'\?carriedState\(was,-x,-edge\):carriedState\(was,x,edge\)/, 'on the left it is carriedState itself; on the right the same hysteresis mirrored');
  assert.equal(carriedState(false, 300, 288), true, 'x past the sidebar edge by more than 10px: chip');
  assert.equal(carriedState(true, 289, 288), false, 'back at the edge: home');
});
