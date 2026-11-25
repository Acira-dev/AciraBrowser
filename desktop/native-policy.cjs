'use strict';
function pageOwner(pages,contents){return [...pages].find(([,entry])=>entry.view.webContents===contents)?.[0];}
function overlayId(overlay){return Number.isSafeInteger(overlay?.id)&&overlay.id>0?overlay.id:0;}
function createOverlayGuard(){let dismissed=0;return{get dismissed(){return dismissed;},dismiss(id){if(Number.isSafeInteger(id)&&id>0)dismissed=Math.max(dismissed,id);},accept(incoming,current){const id=overlayId(incoming);return id&&id<=dismissed?current:incoming;}};}
/** What a change of the window itself closes (a resize, losing focus to another app or window, a minimise or hide, a move): the open
 * menu or popup, left pointing at a place that moved or at a window the person turned away from. Not the toast stack (founder, 2 Nov):
 * the interface places it on the page's bottom edge again after the change, and it is there when the person comes back. A click in
 * the page still dismisses it, an error still waits to be read. */
/* Beta 14: the one-time Welcome stays through all of it (it fills the window and frosts it: a resize, losing focus, a minimise or a move is not a click away); the interface re-lays the frame (window - 24 by window - 120) a frame after a resize. */
/* 17 Nov (the laptop on -3): a question card (dialog, prompt) waits for the person's answer: turning to another window and back, a move, a minimise or a resize is not one (the old card view stayed too). The interface re-lays it a frame after a resize. */
function closesOnWindowChange(overlay){return Boolean(overlay)&&overlay.kind!=='toast'&&overlay.kind!=='welcome'&&overlay.kind!=='dialog'&&overlay.kind!=='prompt';}
/** The page menu on screen that was opened over this very page (`menu.owner` is the page's webContents id): what that page loading another document, crashing or going away closes.
 * Not another page's menu, not any other popup. Pure. */
function pageMenuOf(overlay,menu,owner){return Boolean(overlay&&overlay.kind==='page-context'&&menu&&owner!==undefined&&menu.owner===owner);}
/** The page menu on screen when it was opened over a Link preview's page: what a press in the preview, or the preview going away, closes. Pure. */
function previewMenuUp(overlay,menu){return Boolean(overlay&&overlay.kind==='page-context'&&menu&&menu.preview===true);}
function viewSet(layout){return layout.visible===false?'':layout.views.map(view=>view.tabId).join('|');}
function unionBounds(rectangles){if(!rectangles.length)return null;const left=Math.min(...rectangles.map(r=>r.x)),top=Math.min(...rectangles.map(r=>r.y)),right=Math.max(...rectangles.map(r=>r.x+r.width)),bottom=Math.max(...rectangles.map(r=>r.y+r.height));return{x:left,y:top,width:right-left,height:bottom-top};}
/** The overlay a live resize keeps (closesOnWindowChange): the toast stack, which rests centred on the page's bottom edge, so it moves with
 * that edge (half the width change, the whole height change) until the interface sends its exact place a frame later. A menu or popup
 * is closed by then. Without this the resize's own layout dropped the stack, main retired its id without a word, and no toast showed again. */
function keptThroughResize(overlay,dx,dy){
 if(!overlay||closesOnWindowChange(overlay))return undefined;
 if(overlay.kind==='dialog'||overlay.kind==='prompt')return overlay;/* a question card stays where it is until the interface sends its new place, a frame later */
 if(overlay.kind==='welcome'){/* its frame is window - 24 by window - 120, centred: it grows and shrinks with the window until the interface sends its exact place */const grow=box=>box&&{...box,y:Math.round(box.y+dy/2),width:Math.max(0,box.width+dx),height:Math.max(0,box.height+dy)};return {...overlay,bounds:grow(overlay.bounds)};}
 const shift=box=>box&&{...box,x:Math.round(box.x+dx/2),y:Math.round(box.y+dy)};
 return {...overlay,bounds:shift(overlay.bounds),...(overlay.anchor?{anchor:shift(overlay.anchor)}:{})};
}
function resizeLayout(layout,previous,size){
 const dx=size[0]-previous[0],dy=size[1]-previous[1],card=layout.pageBounds||unionBounds(layout.views.map(v=>v.bounds));
 const views=layout.views.map(view=>{const b=view.bounds,span=Math.max(1,(card?.width||b.width)-(layout.views.length>1||card&&b.width<card.width-10?6:0)),fraction=Math.min(1,b.width/span),offset=card?Math.max(0,(b.x-card.x-(b.x>card.x?6:0))/span):0;return{...view,bounds:{...b,x:Math.round(b.x+dx*offset),width:Math.max(0,Math.round(b.width+dx*fraction)),height:Math.max(0,b.height+dy)}};});
 return{...layout,pageImmediate:true,viewport:{width:size[0],height:size[1]},views,...(layout.pageBounds?{pageBounds:{...layout.pageBounds,width:Math.max(0,layout.pageBounds.width+dx),height:Math.max(0,layout.pageBounds.height+dy)}}:{}),...(layout.assistant?{assistant:{...layout.assistant,immediate:true,bounds:{...layout.assistant.bounds,x:layout.assistant.bounds.x+dx,height:Math.max(0,layout.assistant.bounds.height+dy)}}}:{}),overlay:keptThroughResize(layout.overlay,dx,dy)};
}
function clampWindowBounds(saved,workArea,minWidth=900,minHeight=600){const width=Math.max(Math.min(minWidth,workArea.width),Math.min(workArea.width,Number(saved?.width)||1440)),height=Math.max(Math.min(minHeight,workArea.height),Math.min(workArea.height,Number(saved?.height)||960)),x=Math.max(workArea.x,Math.min(workArea.x+workArea.width-width,Number.isFinite(saved?.x)?saved.x:workArea.x+(workArea.width-width)/2)),y=Math.max(workArea.y,Math.min(workArea.y+workArea.height-height,Number.isFinite(saved?.y)?saved.y:workArea.y+(workArea.height-height)/2));return{x:Math.round(x),y:Math.round(y),width:Math.round(width),height:Math.round(height)};}
function tolerateClosedPipe(stream){stream?.on('error',error=>{if(error?.code!=='EPIPE')throw error;});}
module.exports={pageOwner,overlayId,createOverlayGuard,closesOnWindowChange,pageMenuOf,previewMenuUp,keptThroughResize,viewSet,unionBounds,resizeLayout,clampWindowBounds,tolerateClosedPipe};
