import { useSyncExternalStore } from 'react';
import type { SidebarSide } from '../runtime/types';
import { SIDEBAR_SIZES, sizeOf, steppedSize, type SidebarSize } from '../runtime/sidebarSizes';
export { SIDEBAR_SIZES, SIDEBAR_SIZE_BREAKS, SIDEBAR_SIZE_ORDER, sizeOf, snapSidebarWidth, steppedSize, favoriteColumns, FAVORITES_LIMIT, type SidebarSize } from '../runtime/sidebarSizes';
/** Sidebar width is the native `settings.sidebarWidth` (validated 168–320 in main, shared by every window). It is always one of the three sizes
 * (runtime/sidebarSizes.ts: Narrow 168, Standard 240, Wide 312); the reducer snaps whatever it is given. The range below is the drag's: the edge follows the
 * pointer between Narrow and Wide and rubber-bands past them, then settles on the nearest size.
 * While dragging, `--sidebar-width` on the document root previews the width without a round trip. */
export const SIDEBAR_WIDTH={min:SIDEBAR_SIZES.narrow,max:SIDEBAR_SIZES.wide,initial:SIDEBAR_SIZES.standard};
export const clampSidebarWidth=(value:number)=>Math.round(Math.max(SIDEBAR_WIDTH.min,Math.min(SIDEBAR_WIDTH.max,Number.isFinite(value)?value:SIDEBAR_WIDTH.initial)));
/** Past min/max the edge keeps following the pointer with growing resistance (at most 24px), then springs back. */
export function rubberBandWidth(raw:number){
 const limit=raw>SIDEBAR_WIDTH.max?SIDEBAR_WIDTH.max:raw<SIDEBAR_WIDTH.min?SIDEBAR_WIDTH.min:null;if(limit===null)return raw;
 const over=raw-limit;return limit+Math.sign(over)*24*(1-Math.exp(-Math.abs(over)/80));
}
/** The width the pointer gives the sidebar while its edge is dragged: the grip is on the sidebar's page-side edge, so on the left it follows the pointer
 * to the right and on the right to the left (the same drag, mirrored). Left stays `startWidth + clientX - startX`, as it always was. */
export const draggedSidebarWidth=(side:SidebarSide,startWidth:number,startX:number,clientX:number)=>side==='right'?startWidth+startX-clientX:startWidth+clientX-startX;
/** The width an arrow key on the grip asks for (null: not a resize key). An arrow goes to the next smaller or larger size. Home is Narrow, End is Wide and Enter
 * is Standard (the default), on both sides. ArrowLeft/ArrowRight move the edge the way they point, so on the right ArrowLeft widens the sidebar (the edge goes
 * left) and ArrowRight narrows it. */
export function sidebarKeyWidth(side:SidebarSide,key:string,width:number):number|null{
 const toward=key==='ArrowLeft'?-1:key==='ArrowRight'?1:0;
 if(toward)return SIDEBAR_SIZES[steppedSize(sizeOf(width),(side==='right'?-toward:toward) as -1|1)];
 return key==='Home'?SIDEBAR_SIZES.narrow:key==='End'?SIDEBAR_SIZES.wide:key==='Enter'?SIDEBAR_SIZES.standard:null;
}
/** The sidebar's page-side edge, as a drag measures it: the x where the sidebar ends and the page begins, the one number `overSidebar` and the carried
 * chip (ui/useTabDragSurface carryChip) work from. A left sidebar ends at its right edge; a right sidebar begins at its left edge. With no sidebar on
 * screen the edge lies where nothing is ever over the sidebar (0 on the left, infinity on the right). */
export const sidebarEdgeOf=(box:{left:number;right:number}|null|undefined,side:SidebarSide)=>side==='right'?box?.left??Infinity:box?.right??0;
/** Whether a pointer at `x` is still over the sidebar, for the edge above: the sidebar is the region up to the edge on the left (`x <= edge`, the test the
 * drag has always made) and from the edge on the right (`x >= edge`). */
export const overSidebar=(x:number,edge:number,side:SidebarSide)=>side==='right'?x>=edge:x<=edge;
/** The width the edge is being dragged to, for the parts of the sidebar that change with the size while it is dragged (the Favorites grid). The snapshot is
 * the size, not the width, so a listener re-renders only when the edge crosses a midpoint. */
let previewed:SidebarSize|null=null;const listeners=new Set<()=>void>();
const subscribePreview=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
const readPreview=()=>previewed;
function setPreviewedSize(next:SidebarSize|null){if(previewed===next)return;previewed=next;listeners.forEach(listener=>listener());}
/** The size the sidebar is showing: the one the edge is being dragged towards while it is dragged, otherwise the one the setting holds. */
export function useSidebarSize(width:number):SidebarSize{
 const live=useSyncExternalStore(subscribePreview,readPreview,readPreview);
 return live??sizeOf(width);
}
/** `resizing` turns off the grid transition so the edge tracks the pointer; releasing lets it ease to rest. */
export function previewSidebarWidth(width:number|null,resizing=true){
 const root=document.documentElement;
 if(width===null){root.style.removeProperty('--sidebar-width');root.removeAttribute('data-sidebar-resizing');setPreviewedSize(null);return;}
 root.style.setProperty('--sidebar-width',Math.round(width*10)/10+'px');
 if(resizing)root.setAttribute('data-sidebar-resizing','');else root.removeAttribute('data-sidebar-resizing');
 setPreviewedSize(sizeOf(width));
}
