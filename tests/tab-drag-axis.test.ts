import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { captureTabDrag, releaseTabDrag, tabDragRollback, tabDropAtPoint } from '../src/components/tabGroupDrag';
import { makeTab } from '../src/runtime/core';
import { AXIS_DEAD_ZONE, decideAxis, rowPoint, type DragAxis } from '../src/ui/tabDragAxis';

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const strip = read('src/components/BrowserTabsHorizontal.tsx'), surface = read('src/ui/useTabDragSurface.ts');

test('Axis lock: no direction is decided inside the dead zone, then the dominant one is (a tie is the strip\'s own, sideways)', () => {
  assert.ok(AXIS_DEAD_ZONE >= 4 && AXIS_DEAD_ZONE <= 6, 'a small dead zone, 4 to 6 px');
  assert.equal(decideAxis(null, { x: 0, y: 0 }), null);
  assert.equal(decideAxis(null, { x: 3, y: 3 }), null, '4.2px of travel is still inside the dead zone');
  assert.equal(decideAxis(null, { x: -4.9, y: 0 }), null);
  assert.equal(decideAxis(null, { x: 5, y: 0 }), 'x');
  assert.equal(decideAxis(null, { x: -6, y: 2 }), 'x', 'sideways to the left');
  assert.equal(decideAxis(null, { x: 1, y: 6 }), 'y', 'vertical down');
  assert.equal(decideAxis(null, { x: -2, y: -9 }), 'y', 'vertical up');
  assert.equal(decideAxis(null, { x: 4, y: 4 }), 'x', 'a tie is sideways');
  assert.equal(decideAxis(null, { x: 5, y: 3 }), 'x', 'a slanted start that is mostly sideways is sideways');
});

test('Axis lock: once decided the axis never changes until the drag ends, whatever the pointer does next', () => {
  let axis: DragAxis | null = null;
  for (const offset of [{ x: 2, y: 1 }, { x: 6, y: 1 }]) axis = decideAxis(axis, offset);
  assert.equal(axis, 'x');
  for (const offset of [{ x: 40, y: 90 }, { x: 0, y: 400 }, { x: -200, y: -300 }, { x: 0, y: 0 }]) assert.equal(decideAxis(axis, offset), 'x', `vertical wobble ${JSON.stringify(offset)} does not switch a sideways drag`);
  let vertical: DragAxis | null = null;
  for (const offset of [{ x: 0, y: 2 }, { x: 1, y: 8 }]) vertical = decideAxis(vertical, offset);
  assert.equal(vertical, 'y');
  for (const offset of [{ x: 300, y: 8 }, { x: -300, y: 0 }]) assert.equal(decideAxis(vertical, offset), 'y', 'a vertical start stays vertical (today\'s behaviour)');
});

test('Axis lock: a sideways pointer is read on the middle of the strip row, keeping its x', () => {
  assert.deepEqual(rowPoint({ x: 412, y: 61 }, { top: 0, bottom: 36 }), { x: 412, y: 18 });
  assert.deepEqual(rowPoint({ x: -30, y: -40 }, { top: 10, bottom: 46 }), { x: -30, y: 28 });
});

/** A strip of three 200px tabs, 36px tall at the top of the window (the measured top strip), as the drop code reads it. */
function stripOf(ids: string[]) {
  const box = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top }) as DOMRect;
  const tabs = ids.map((id, index) => ({ dataset: { tabId: id }, hasAttribute: () => false, getBoundingClientRect: () => box(122 + index * 200, 3, 322 + index * 200, 33) }));
  const doc = { querySelectorAll: () => [], elementFromPoint: () => null };
  const root = { ownerDocument: doc, getBoundingClientRect: () => box(122, 0, 122 + ids.length * 200, 36), querySelectorAll: (selector: string) => (selector === '[data-tab-id]' ? tabs : []) };
  return root as unknown as HTMLElement;
}

test('Root cause: a sideways release a little above or below the 36px strip cancelled the reorder; read on the row it is a plain placement', () => {
  const tabs = ['a', 'b', 'c'].map(id => makeTab(id)), root = stripOf(['a', 'b', 'c']), origin = captureTabDrag('a', tabs, []);
  // The tab was already carried to the right of b (Reorder or followPosition swapped it: the state is b, c, a).
  const swapped = [tabs[1], tabs[2], tabs[0]];
  for (const y of [-7, 43, 61]) {
    const raw = tabDropAtPoint(root, { x: 560, y }, 'a', swapped, [], false, null);
    assert.equal(raw, null, `y=${y}: outside the strip's own box is a cancelled drop...`);
    assert.deepEqual(releaseTabDrag(raw, origin, swapped, []), tabDragRollback(origin, swapped, []), '...which rolls the live reorder back to where the tab started');
    assert.ok(tabDragRollback(origin, swapped, []), 'and there is a rollback to apply');
    const locked = tabDropAtPoint(root, rowPoint({ x: 560, y }, { top: 0, bottom: 36 }), 'a', swapped, [], false, null);
    assert.ok(locked && locked.type === 'tab.drop', `y=${y}: on the row it is a drop at the slot under the pointer`);
    assert.equal(releaseTabDrag(locked, origin, swapped, []), null, 'a plain placement inside the partition is left to the live reorder: the order stays as carried');
  }
});

test('Strip: the drag decides its axis from the pointer\'s travel since it went down, and a sideways one reads every pointer on the strip row', () => {
  assert.match(strip, /import \{ decideAxis,rowPoint,type DragAxis \} from '\.\.\/ui\/tabDragAxis'/);
  assert.match(strip, /onDrag=\{\(_event,moved\)=>\{const L=live\.current,was=L\.axis\.current,axis=L\.axis\.current=decideAxis\(was,moved\.offset\)/, 'the offset is the travel since the pointer went down');
  assert.match(strip, /if\(axis==='x'&&was!=='x'\)L\.dragSurface\.pin\(key\)/, 'the carried tab is pinned to its row the moment the drag is sideways');
  assert.match(strip, /const info=axis==='x'\?\{\.\.\.moved,point:stripPoint\(L,moved\.point\)\}:moved/, 'a vertical (or undecided) drag keeps the real point');
  assert.match(strip, /const stripPoint=\(L:StripLive,point:\{x:number;y:number\}\)=>\{const row=L\.axis\.current==='x'\?L\.viewport\.current\?\.getBoundingClientRect\(\):null;return row\?rowPoint\(point,row\):point;\}/);
});

test('Strip: a sideways reorder never forms the chip, reaches the split picker\'s page zone, or hovers the bookmarks bar; a vertical one still does', () => {
  assert.match(strip, /moveSplitDrag\(tab\.id,info\.point,!L\.dragCancelled\.current&&L\.props\.state\.tabs\.length>1\)/, 'the split picker gets the row point: its page zone (below the strip) is out of reach, and the strip\'s split-group highlight follows the pointer as before');
  assert.match(strip, /L\.dragSurface\.carry\(key,info\.point,[^;]*,!L\.dragCancelled\.current&&axis!=='x'\)/, 'no chip while sideways');
  assert.match(strip, /markBookmarksBar\(L\.dragCancelled\.current\|\|axis==='x'\?null:bookmarksBarAt\(info\.point\)\)/, 'the bookmarks bar is a vertical drop');
  assert.match(strip, /if\(!L\.dragCancelled\.current&&info\.point\.y<\(L\.viewport\.current\?\.getBoundingClientRect\(\)\.bottom\?\?0\)\+16\)followPosition\(L,tab\.id,false\)/, 'the live reorder runs on every move of a sideways drag (its row point is in the strip)');
});

test('Strip: the release of a sideways reorder is read on the row: a placement, never a cancel, a bookmark or a tear-off by height; leaving the window sideways still tears off', () => {
  assert.match(strip, /onDragEnd=\{\(_event,released\)=>\{const L=live\.current,\{state,dispatch\}=L\.props,info=L\.axis\.current==='x'\?\{\.\.\.released,point:stripPoint\(L,released\.point\)\}:released,/);
  assert.match(strip, /\}:released,current=state\.tabs\.find\(item=>item\.id===tab\.id\)\?\?tab;L\.axis\.current=null;L\.release\.current\?\.\(\)/, 'the axis is released with the drag');
  assert.match(strip, /torn=!L\.dragCancelled\.current&&!bar&&outsideWindow\(info\.point\)&&state\.tabs\.length>1/, 'the tear-off test reads the same point: only x can leave the window now');
  assert.match(strip, /tabDropAtPoint\(L\.viewport\.current,info\.point,tab\.id,/, 'the drop is resolved from the row point');
  assert.match(strip, /L\.dragOrigin\.current=captureTabDrag\(tab\.id,state\.tabs,state\.tabGroups\);L\.suppressClick\.current=true/, 'each drag still starts clean');
  assert.match(strip, /L\.reordered\.current='';L\.axis\.current=null;L\.stripDrag\.current=/, 'each drag starts undecided');
  assert.match(strip, /L\.dragSurface\.end\(key\);L\.dragCancelled\.current=true;L\.axis\.current=null;/, 'a cancelled pointer ends the lock too');
});

test('Drag surface: a pinned preview keeps the row\'s height (and only that: x and the chip morph are untouched)', () => {
  assert.match(surface, /const natural=surface\.row\?origin\.top\+node\.offsetTop:box\.top/, 'the row\'s height is where the tab rests in the track');
  assert.match(surface, /left=pointer&&p>0\?lerp\(box\.left,pointer\.x\+lean\.x-width\/2,p\):box\.left,top=pointer&&p>0\?lerp\(natural,pointer\.y\+lean\.y-height\/2,p\):natural/, 'x follows the tab; a chip (vertical drag) still follows the pointer');
  assert.match(surface, /const pin=useCallback\(\(id:string\)=>\{const surface=surfaces\.current\.get\(id\);if\(surface\)surface\.row=true;\},\[\]\)/);
  assert.match(surface, /return \{start,end,project,carry,pin\}/);
});

test('The sidebar is not part of the axis lock (the compact strip is since 2 Nov: tests/compact-tab-drag-axis.test.ts)', () => {
  for (const file of ['src/components/sidebar/AciraSidebar.tsx', 'src/components/BrowserTabs.tsx']) assert.doesNotMatch(read(file), /tabDragAxis|dragSurface\.pin/, `${file} keeps its own drag`);
});

test('Strip: a swap asked for is pending only until the order changes, and Reorder\'s late callbacks no longer move the tab back (fast flicks over many narrow tabs)', () => {
  assert.match(strip, /useLayoutEffect\(\(\)=>\{reordered\.current='';\},\[ids\.join\(\)\]\)/, 'a changed order clears the pending swap: followPosition is never left blocked for the rest of the drag');
  assert.match(strip, /if\(reordered\.current===ids\.join\(\)\|\|orderNow\.current!==ids\.join\(\)\)return;[^;]*reordered\.current=ids\.join\(\);dispatch\(\{type:'tab\.reorder',from,to:target\}\)/, 'Reorder does not repeat a swap followPosition already asked for, nor one computed from an order the strip has left');
  assert.match(strip, /spacing=stripSpacing\(entries\);orderNow\.current=ids\.join\(\)/, 'the strip\'s latest order is kept for that comparison');
});
