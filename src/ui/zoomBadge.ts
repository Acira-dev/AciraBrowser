import {useEffect,useState} from 'react';
/** The zoom level in the address field (13.6): a figure ("110%") for two seconds after the page's zoom changes, then a small magnifier that still opens the
 * zoom controls. The figure is feedback for a change the person just made, so it shows for that and nothing else; a person who has hidden the magnifier
 * (Customize toolbar, Settings, right-click > Hide) still sees the figure for those two seconds. At 100% nothing rests in the field. */
export const ZOOM_TEXT_MS=2000;
export type ZoomSeen={id:string;url:string;zoom:number};
/** A change the person made: the same tab, on the same address, at another zoom. Switching tabs, navigating, a new window or a restart is not one
 * (the zoom bubble in App.tsx opens on the same rule). */
export const zoomChanged=(before:ZoomSeen,after:ZoomSeen)=>before.id===after.id&&before.url===after.url&&before.zoom!==after.zoom;
/** The three looks of the zoom control in the field: the figure, the resting magnifier, or nothing (the person hid the magnifier and the figure's two seconds are over;
 * the control stays in the page, collapsed, only while the zoom bubble hangs from it). */
export type ZoomState='text'|'glyph'|'away';
export function zoomState(input:{zoom:number;recent:boolean;iconShown:boolean;bubbleOpen:boolean}):ZoomState{
 if(input.zoom!==100)return input.recent?'text':input.iconShown?'glyph':'away';
 return input.bubbleOpen?'text':'away';
}
export type ZoomTextState=ZoomSeen&{text:boolean};
/** What the figure's state is for the tab as drawn now: unchanged, or (the tab, its address or its zoom differs from the last render) the new look: the figure
 * only when the SAME tab on the SAME address changed zoom. */
export function nextZoomText(seen:ZoomTextState,tab:ZoomSeen):ZoomTextState{
 if(seen.id===tab.id&&seen.url===tab.url&&seen.zoom===tab.zoom)return seen;
 return {id:tab.id,url:tab.url,zoom:tab.zoom,text:zoomChanged(seen,tab)};
}
/** Whether the figure is showing: true from the render in which the zoom of the same tab changed (no frame of the magnifier first) until ZOOM_TEXT_MS later; a
 * further change starts the two seconds again, a tab switch or a navigation ends them. */
export function useZoomText(tab:ZoomSeen,ms=ZOOM_TEXT_MS):boolean{
 const [seen,setSeen]=useState<ZoomTextState>({id:tab.id,url:tab.url,zoom:tab.zoom,text:false});
 const current=nextZoomText(seen,tab);
 if(current!==seen)setSeen(current);
 useEffect(()=>{if(!current.text)return;const timer=setTimeout(()=>setSeen(now=>({...now,text:false})),ms);return()=>clearTimeout(timer);},[current.id,current.url,current.zoom,current.text,ms]);
 return current.text;
}
