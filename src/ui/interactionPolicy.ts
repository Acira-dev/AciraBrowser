export function documentIdentity(url:string){try{const value=new URL(url);return value.origin+'//'+value.host+value.pathname;}catch{return url.split(/[?#]/,1)[0];}}
export function deferCollapse(input:{addressFocused:boolean;pendingEdit:boolean;editableFocused:boolean;headerHovered:boolean;panelHovered:boolean;busy:boolean;overlayKind:string|null}){return input.addressFocused||input.pendingEdit||input.editableFocused||input.headerHovered||input.panelHovered||input.busy||Boolean(input.overlayKind&&input.overlayKind!=='suggestions');}
export function nextFloating(current:boolean,width:number,split:boolean){return split?false:current?width<1060:width<1020;}
export function panelLimit(width:number,sidebar:number){return Math.max(320,Math.min(520,width-sidebar-480-24));}
export function clampPanel(width:number,windowWidth:number,sidebar:number){return Math.max(320,Math.min(panelLimit(windowWidth,sidebar),Math.round(width)));}
/** R4-22 (founder: "whenever I click away I want the menu to close ... fix it for all menus"): what an open popup outlives when
 * the tab changes under it. Only the tab viewer (it is the way you switch tabs) and the address suggestions while
 * that tab's field is being edited; every menu and panel (main menu, profile, accounts, extensions ...) closes. */
export const overlayOutlivesTabChange=(kind:string|null,editingSameTab=false):boolean=>kind==='tabs'||kind==='suggestions'&&editingSameTab;
/** Layout controls stay mounted during live previews, even when their toolbar moves. Tab navigation still dismisses them. */
export const overlayOutlivesLayoutChange=(kind:string|null):boolean=>kind==='menu'||kind==='more-tools'||kind==='toolbar-context'||kind==='suggestions'||overlayOutlivesTabChange(kind);
export function overlayPointerDismiss(input:{popup:boolean;trigger:boolean;address:boolean;suggestions:boolean}){return !input.popup&&!input.trigger&&!(input.address&&input.suggestions);}
let overlaySequence=Date.now()*1000;
export const nextOverlayId=()=>++overlaySequence;
/** Two popup layouts are the same popup only when both carry an id and it is the same one. A popup without an id is the leftover of a
 *  close (its id was cleared while its kind was still in state): `undefined===undefined` must never count as a match, or the echo of that
 *  stale layout is written back into the live layout, which then re-sends the closed popup (the New workspace form stayed open). */
export const sameOverlayId=(a:{id?:number}|undefined,b:{id?:number}|undefined):boolean=>a?.id!==undefined&&a.id===b?.id;

const NON_TEXT_INPUTS=new Set(['checkbox','radio','range','color','button','submit','reset','image','file']);
/** On a Mac Option+letter types a character in a field that takes text (Option+T is "†"), so the tab viewer key leaves such a field alone.
 *  A checkbox, radio, slider or colour well takes no text: after a click in Settings it keeps focus, and Option+T must still open the viewer. */
export const takesTypedText=(target:EventTarget|null):boolean=>{
 const field=(target as Element|null)?.closest?.('input,textarea,[contenteditable=true]') as (Element&{type?:string})|null|undefined;
 return !!field&&!(field.tagName==='INPUT'&&NON_TEXT_INPUTS.has(String(field.type).toLowerCase()));
};

/** A native union host can receive a click over an exposed shell/assistant trigger. */
export function activatePopupTriggerAt(point:{x:number;y:number},scope:HTMLElement|null=null):boolean{
 const doc=scope?.ownerDocument||document,trigger=doc.elementFromPoint(point.x,point.y)?.closest<HTMLElement>('[data-popup-trigger]');
 if(!trigger||scope&&!scope.contains(trigger)||trigger.closest('[inert]')||trigger.matches(':disabled'))return false;
 trigger.focus({preventScroll:true});trigger.click();return true;
}
