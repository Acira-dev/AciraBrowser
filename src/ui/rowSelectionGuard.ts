/** A press-and-drag on a tab row never leaves text selected (coordinator, 27 Oct). Rows in the sidebar (tabs, split cards, group
 *  headers, pinned tabs, favourites, bookmarks) and in the horizontal and compact strips are things you grab, not text: from the
 *  pointerdown that lands on one until the pointer is released, the browser may not start a selection, and any selection already
 *  on the page is cleared. Inline rename fields and other real text inputs stay fully selectable. */
export const DRAG_ROW_AREAS='.acira-sidebar, .tabs-strip, .acira-compact-tabs';
export const EDITABLE='input, textarea, select, [contenteditable]:not([contenteditable="false"])';

type Closest={closest:(selector:string)=>unknown};
/** True when a press on `target` arms the guard: it is inside a row area and not inside a text field. */
export function armsRowGuard(target:unknown):boolean{
 const node=target as Partial<Closest>|null;
 if(!node||typeof node.closest!=='function')return false;
 return !!node.closest(DRAG_ROW_AREAS)&&!node.closest(EDITABLE);
}

const installed=new WeakSet<Document>();
export function installRowSelectionGuard(doc:Document|undefined=typeof document==='undefined'?undefined:document):void{
 if(!doc||installed.has(doc))return;installed.add(doc);
 let armed=false;
 doc.addEventListener('pointerdown',event=>{
  armed=event.button===0&&armsRowGuard(event.target);
  if(!armed)return;
  // A drag starting here clears any selection left on the page (but never the one inside a focused text field).
  const selection=doc.getSelection();if(selection&&!selection.isCollapsed&&!armsEditable(doc))selection.removeAllRanges();
 },true);
 doc.addEventListener('selectstart',event=>{if(armed&&!(event.target as Partial<Closest>)?.closest?.(EDITABLE))event.preventDefault();},true);
 const disarm=()=>{armed=false;};
 doc.addEventListener('pointerup',disarm,true);doc.addEventListener('pointercancel',disarm,true);
}
function armsEditable(doc:Document):boolean{const active=doc.activeElement as Partial<Closest>|null;return !!active?.closest?.(EDITABLE);}
