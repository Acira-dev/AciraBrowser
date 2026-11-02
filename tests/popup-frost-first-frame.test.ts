import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// The glass must be there on a popup's first revealed frame. Two things kept it away (workspace cover picker, workspace popups):
//  1. A local (css-provider) sheet animated a transform on its plane, the ancestor of the glass. While that ran, the glass's backdrop-filter did not
//     sample the page: the sharp page showed through for ~300ms and the frost came when the animation ended. The motion now rides on the glass and
//     on the text, never on their common ancestor.
//  2. The overlay popups' page snapshot was discarded as stale when a measured popup laid out a second time, so the first one fell back to the
//     slow native glass. The snapshot context no longer carries the layout object's identity, and the renderer asks once more.
const sheet = fs.readFileSync('src/components/SheetPopupSurface.tsx', 'utf8');
const main = fs.readFileSync('desktop/main.cjs', 'utf8');
const backdrop = fs.readFileSync('src/ui/usePopupBackdrop.ts', 'utf8');

test('a local sheet never animates a transform on the plane that holds its glass', () => {
  assert.ok(sheet.includes("plane:{opacity:1,transform:'none'}"), 'the plane is resting for a local sheet');
  assert.ok(sheet.includes('...(contents?[]:[node.animate(planeFrames,options)])'), 'the plane is only animated for native and captured sheets');
  assert.ok(sheet.includes('transform:`${layers.plane[i].transform} ${frame.transform}`'), "the plane's motion is carried by the glass");
  assert.ok(sheet.includes('contents.animate(layers.plane.map(({offset,opacity,transform})=>({offset,opacity,transform}))'), "and by the text");
  assert.ok(sheet.includes("contents.style.transform=rest?'none':base.plane.transform"), 'and the text rests untransformed');
});

test("the glass and the text move about the plane's own corner", () => {
  assert.ok(sheet.includes('contents.style.transformOrigin=glass.style.transformOrigin=`${(from??geometry.origin).x*100}% ${(from??geometry.origin).y*100}%`'));
});

test('the popup snapshot context identifies a popup by its id, not by the layout object that carries it', () => {
  assert.ok(main.includes('generation:overlayId(overlay),context:state.activeTabId'));
  assert.ok(!main.includes('generation:overlay,'));
});

test('a snapshot discarded by a second layout is asked for once more before the slower glass', () => {
  assert.ok(backdrop.includes('let snapshot=await runtime.popupBackdropSnapshot(id);'));
  assert.ok(backdrop.includes('if(!cancelled&&!snapshot.sources.length)snapshot=await runtime.popupBackdropSnapshot(id);'));
});
