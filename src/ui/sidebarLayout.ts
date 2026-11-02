/** Sidebar width is the native `settings.sidebarWidth` (validated 220–320 in main, shared by every window).
 * While dragging, `--sidebar-width` on the document root previews the width without a round trip. */
export const SIDEBAR_WIDTH={min:220,max:320,initial:240,step:8};
export const clampSidebarWidth=(value:number)=>Math.round(Math.max(SIDEBAR_WIDTH.min,Math.min(SIDEBAR_WIDTH.max,Number.isFinite(value)?value:SIDEBAR_WIDTH.initial)));
/** Past min/max the edge keeps following the pointer with growing resistance (at most 24px), then springs back. */
export function rubberBandWidth(raw:number){
 const limit=raw>SIDEBAR_WIDTH.max?SIDEBAR_WIDTH.max:raw<SIDEBAR_WIDTH.min?SIDEBAR_WIDTH.min:null;if(limit===null)return raw;
 const over=raw-limit;return limit+Math.sign(over)*24*(1-Math.exp(-Math.abs(over)/80));
}
/** `resizing` turns off the grid transition so the edge tracks the pointer; releasing lets it ease to rest. */
export function previewSidebarWidth(width:number|null,resizing=true){
 const root=document.documentElement;
 if(width===null){root.style.removeProperty('--sidebar-width');root.removeAttribute('data-sidebar-resizing');return;}
 root.style.setProperty('--sidebar-width',Math.round(width*10)/10+'px');
 if(resizing)root.setAttribute('data-sidebar-resizing','');else root.removeAttribute('data-sidebar-resizing');
}
