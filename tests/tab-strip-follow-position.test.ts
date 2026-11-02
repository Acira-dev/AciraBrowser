import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const strip=readFileSync(new URL('../src/components/BrowserTabsHorizontal.tsx',import.meta.url),'utf8');

test('Strip drag: the order follows where the dragged tab is, not how fast it moves (framer Reorder only swaps with velocity toward the neighbour)',()=>{
  const body=/function followPosition\(([^)]*)\)\{([\s\S]*?)\n\}\n/.exec(strip)?.[2]??'';
  assert.ok(body,'followPosition exists');
  assert.doesNotMatch(body,/velocity/,'no velocity in the decision');
  assert.match(body,/offsetLeft\+node\.offsetWidth\/2/,'neighbours are read at their laid-out middles');
  assert.match(body,/getBoundingClientRect/,'the dragged tab is read where it is drawn');
  assert.match(body,/L\.reordered\.current===ids\.join\(\)/,'a swap already asked for (Reorder\'s or ours) is not asked for twice');
  assert.match(body,/canLiveReorder\(id,ids\[to\]/,'the pinned, profile and group partitions still hold');
  assert.match(body,/splitGroups\?\.some/,'a pane chip stays in its split tray');
  assert.match(body,/\(!release&&to>from\)/,'while dragging it moves one slot at a time, like Reorder; on release as many as were passed');
});

test('Strip drag: it runs on every move that is still in the strip, and once more on release when the drop is a plain placement',()=>{
  assert.match(strip,/moveSplitDrag\(tab\.id,info\.point,[^;]*\);if\(!L\.dragCancelled\.current&&info\.point\.y<\(L\.viewport\.current\?\.getBoundingClientRect\(\)\.bottom\?\?0\)\+16\)followPosition\(L,tab\.id,false\)/,'not while the pointer is down in the page (split view intent)');
  assert.match(strip,/else if\(drop\)dispatch\(drop\);else if\(raw&&!L\.dragCancelled\.current\)followPosition\(L,tab\.id,true\)/,'a release outside the strip stays a cancel');
  assert.match(strip,/L\.dragged\.current=key;L\.dragCancelled\.current=false;L\.reordered\.current=''/,'each drag starts clean');
  assert.match(strip,/reordered\.current=ids\.join\(\);dispatch\(\{type:'tab\.reorder',from,to:target\}\)/,'Reorder\'s own swap is recorded too');
});
