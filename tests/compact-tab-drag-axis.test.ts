import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureTabDrag, releaseTabDrag, tabDragRollback, tabDropAtPoint } from '../src/components/tabGroupDrag';
import { makeTab } from '../src/runtime/core';
import { decideAxis, rowPoint, type DragAxis } from '../src/ui/tabDragAxis';

/** The compact strip (Compact and Focus views, and Seamless's revealed bar) gets the top strip's axis lock (ui/tabDragAxis, 3d34bc66):
 * a drag that starts sideways is a reorder until the button comes up. Its tabs sit in the toolbar's 40px row, so a hand drifting
 * 20px up or down while it carried a tab sideways cancelled the reorder (a release outside the strip's box rolls it back), turned the
 * tab into a chip over the page, or armed the split picker. */
const strip = readFileSync(new URL('../src/components/CompactTabs.tsx', import.meta.url), 'utf8');

/** Three 120px compact tabs in a 30px-tall viewport at y 5..35 (the toolbar row), as the drop code reads it. */
function compactOf(ids: string[]) {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }) as DOMRect;
  const tabs = ids.map((id, index) => ({ dataset: { tabId: id }, hasAttribute: () => false, getBoundingClientRect: () => box(300 + index * 124, 6, 420 + index * 124, 34) }));
  const doc = { querySelectorAll: () => [], elementFromPoint: () => null };
  const root = { ownerDocument: doc, getBoundingClientRect: () => box(300, 5, 300 + ids.length * 124, 35), querySelectorAll: (selector: string) => (selector === '[data-tab-id]' ? tabs : []) };
  return root as unknown as HTMLElement;
}

test('Compact root cause: a sideways release a little above or below the strip rolled the reorder back; read on the row it is a placement', () => {
  const tabs = ['a', 'b', 'c'].map(id => makeTab(id)), root = compactOf(['a', 'b', 'c']), origin = captureTabDrag('a', tabs, []);
  const carried = [tabs[1], tabs[2], tabs[0]];// Reorder already moved a past b and c
  for (const y of [-12, 52, 70]) {
    const raw = tabDropAtPoint(root, { x: 600, y }, 'a', carried, [], false, null);
    assert.equal(raw, null, `y=${y}: outside the strip's box`);
    assert.deepEqual(releaseTabDrag(raw, origin, carried, []), tabDragRollback(origin, carried, []), 'was a rollback to where the tab started');
    const locked = tabDropAtPoint(root, rowPoint({ x: 600, y }, { top: 5, bottom: 35 }), 'a', carried, [], false, null);
    assert.ok(locked && locked.type === 'tab.drop', `y=${y}: on the row it lands at the slot under the pointer`);
    assert.equal(releaseTabDrag(locked, origin, carried, []), null, 'and the carried order stays');
  }
  let axis: DragAxis | null = null;
  for (const offset of [{ x: 3, y: 1 }, { x: 8, y: 2 }, { x: 60, y: 28 }, { x: 140, y: -30 }]) axis = decideAxis(axis, offset);
  assert.equal(axis, 'x', 'a wobble of the hand after a sideways start never makes it vertical');
});

test('Compact strip: the axis is decided from the travel since the pointer went down; a sideways drag reads every pointer on the row and pins its tab there', () => {
  assert.match(strip, /import \{ decideAxis,rowPoint,type DragAxis \} from '\.\.\/ui\/tabDragAxis'/);
  assert.match(strip, /const stripPoint=\(L:CompactLive,point:\{x:number;y:number\}\)=>\{const row=L\.axis\.current==='x'\?L\.viewport\.current\?\.getBoundingClientRect\(\):null;return row\?rowPoint\(point,row\):point;\}/);
  assert.match(strip, /onDrag=\{\(_event,moved\)=>\{const L=live\.current,was=L\.axis\.current,axis=L\.axis\.current=decideAxis\(was,moved\.offset\);if\(axis==='x'&&was!=='x'\)L\.dragSurface\.pin\(key\);/);
  assert.match(strip, /const info=axis==='x'\?\{\.\.\.moved,point:stripPoint\(L,moved\.point\)\}:moved;/);
});

test('Compact strip: a sideways reorder never forms the chip or reaches the split picker\'s page zone; a vertical drag still does', () => {
  assert.match(strip, /moveSplitDrag\(tab\.id,info\.point,!L\.dragCancelled\.current&&!!L\.props\.onGroupAction&&L\.props\.tabs\.length>1\)/, 'the picker reads the row point');
  assert.match(strip, /L\.dragSurface\.carry\(key,info\.point,L\.viewport\.current\?\.getBoundingClientRect\(\)\.bottom\?\?0,!L\.dragCancelled\.current&&axis!=='x'\)/, 'no chip while sideways');
});

test('Compact strip: the release of a sideways drag is read on the row, and every drag starts and ends undecided', () => {
  assert.match(strip, /onDragEnd=\{\(_event,released\)=>\{const L=live\.current,\{tabs,activeTabId,onGroupAction\}=L\.props,groups=L\.groups,info=L\.axis\.current==='x'\?\{\.\.\.released,point:stripPoint\(L,released\.point\)\}:released(?:,scrolled=!!L\.edge\.current\?\.scrolled)?;L\.axis\.current=null;/);
  assert.match(strip, /tabDropAtPoint\(L\.viewport\.current,info\.point,tab\.id,tabs,groups,false,L\.stripDrag\.current\?\.intent\)/, 'the drop is resolved from the row point');
  assert.match(strip, /L\.dragCancelled\.current=false;L\.axis\.current=null;L\.stripDrag\.current=\{id:tab\.id,point:info\.point/, 'each drag starts undecided');
  assert.match(strip, /L\.dragSurface\.end\(key\);L\.dragCancelled\.current=true;L\.axis\.current=null;/, 'a cancelled pointer ends the lock too');
});
