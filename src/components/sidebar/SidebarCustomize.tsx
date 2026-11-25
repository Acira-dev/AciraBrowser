import { animate } from 'motion/react';
import { useEffect,useLayoutEffect,useMemo,useRef,useState,type CSSProperties,type KeyboardEvent,type PointerEvent,type ReactNode } from 'react';
import { Bookmark,BookOpen,Download,History as HistoryGlyph,Minus,Package,PanelRight,PanelTop,Pin,Plus,Star,UserRound,type LucideIcon } from '../AppIcons';
import { PreviewIcon } from '../PreviewIcon';
import { SECTION_NAMES,type SectionLayout } from '../../ui/sidebarSections';
import { arrangeOf,canSit,ghostAt,homeIndex,homeOf,isEdge,locate,moveBlock,placementOf,slotAt,stepBlock,type Arrange,type ArrangeContext,type BlockId,type Measured,type Zone } from '../../ui/customizeModel';
import { animateSpring,glideBy,motionSpeed,pauseGlide,springNow } from '../../ui/sharedMotion';
import { motionScale,morphSpring } from '../../ui/splitMotion';
import { t,translateText } from '../../i18n';
import './customize.css';

/** Customize sidebar (Beta 14): every section is a collapsed block (icon, name, a small preview of what it holds); drag one to another place, or into the Off tray to turn it off.
 * The middle blocks reorder freely; Favorites and the icon row are edge blocks, which sit at the top or the bottom edge and never in the middle. A drag starts 3px from the press, holds the
 * pointer (setPointerCapture), carries a glass ghost under it and shows the gap it will land in (a quiet inset well); the other blocks make room. Esc cancels. From the keyboard: Space lifts a block,
 * the arrows move it, Space drops it, Esc cancels.
 *
 * The motion is the tab drag's (ui/sidebarTabDrag.ts) and the sidebar's own: the ghost is placed in the pointer event itself (no lag); the blocks that make room glide on `reorder.move` (the same retargetable
 * glide the sidebar's rows use, sharedMotion.glideBy); the ghost's morph into a chip over the Off tray runs on `tab.split` / `tab.merge`, as the tab's chip does; the drop settles on `reorder.release`
 * (one small overshoot). Premium, Fast and None follow the Motion setting (motionSpeed): at None nothing travels, the pointer still carries the ghost. While carrying, only transforms and opacity change
 * (the tray morph also sizes the ghost, one small box, as the tab drag's chip does). Nothing here runs outside Customize mode. */
const name=(id:BlockId)=>id==='footer'?t("sidebarcustomize.iconRow"):translateText(SECTION_NAMES[id]);
  const chipName=(id:BlockId)=>id==='pinned'?t("sidebarcustomize.pinnedChip"):name(id);   // Off, Pinned tabs also holds pinned folders: its chip says "Pinned"
const ICONS:Record<BlockId,LucideIcon>={favorites:Star,pinned:Pin,tabs:PanelTop,bookmarks:Bookmark,downloads:Download,history:HistoryGlyph,reading:BookOpen,extensions:Package,sidepanel:PanelRight,footer:UserRound};
const note=(id:BlockId)=>id==='tabs'?t("sidebarcustomize.tabsNote"):id==='footer'?t("sidebarcustomize.iconRowNote"):undefined;
const THRESHOLD=3,BAND=28;
const GRIP=[0,1,2,3,4,5].map(at=><i key={at} className="sb-cz-gd"/>);
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t,clamp=(v:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,v));
const rtl=()=>typeof document!=='undefined'&&getComputedStyle(document.documentElement).direction==='rtl';
/** THE HAND (reported 19 Nov): the blocks and chips show the open hand at rest (customize.css); from the PRESS to the release the whole interface shows the closed one. A shield over the window (one element, taken
 * away at the release) makes every element under the pointer, a title, the Done button, a gap, the page's edge, answer with the same cursor, so no arrow or beam can flicker through while a block is carried. */
let shield:HTMLElement|null=null;
const grab=(on:boolean)=>{if(typeof document==='undefined')return;if(on&&!shield){shield=document.createElement('div');shield.className='sb-cz-shield';shield.setAttribute('aria-hidden','true');document.body.appendChild(shield);}else if(!on&&shield){shield.remove();shield=null;}};

export interface CustomizePreviews{favorites:{icon?:string;title:string}[];pinned:{favicon?:string;title:string}[]}
/** What a row shows on its right: only the user's OWN icons, the Favorites' tiles and the pinned tabs' favicons (the abstract line/bar drawings of the other sections are gone: a row is a row). */
function Preview({id,previews}:{id:BlockId;previews:CustomizePreviews}){
 switch(id){
  case 'favorites':return <span className="sb-cz-pv sb-cz-pv-tiles">{(previews.favorites.length?previews.favorites.slice(0,4):[{title:''},{title:''},{title:''}]).map((app,at)=><i key={at} className="sb-cz-tile" style={app.icon?{backgroundImage:`url("${app.icon}")`}:undefined}/>)}</span>;
  case 'pinned':return <span className="sb-cz-pv sb-cz-pv-tiles">{(previews.pinned.length?previews.pinned.slice(0,4):[{title:''},{title:''}]).map((tab,at)=><i key={at} className="sb-cz-dot" style={tab.favicon?{backgroundImage:`url("${tab.favicon}")`}:undefined}/>)}</span>;
  default:return null;
 }
}

interface Drag{id:BlockId;lift:'pointer'|'key';w?:number;h?:number}
/** The pointer drag in flight: everything that changes every frame lives here, never in state. */
interface Run{id:BlockId;root:{left:number;top:number};bw:number;home:{left:number;top:number;w:number;h:number};press:{x:number;y:number};grab:{x:number;y:number};pos:{x:number;y:number};chip:{w:number;h:number};p:number;cur:{x:number;y:number;w:number;h:number};w:number;h:number;stop?:()=>void;settling:boolean}

export function SidebarCustomize({layout,onChange,onDone,favoritesPlace='top',onFavoritesPlace,shelf=false,sidePanel=false,extensionsPlace='sidebar',glow,size,previews}:{layout:SectionLayout;onChange:(next:SectionLayout)=>void;onDone:()=>void;favoritesPlace?:'top'|'bottom';onFavoritesPlace?:(place:'top'|'bottom')=>void;/** The Shelf (Top + sidebar) has no tab list, so Tabs and Pinned tabs are not blocks of it. */shelf?:boolean;/** The profile has side panel sites (that block exists only then). */sidePanel?:boolean;/** Where the pinned extensions' icons are drawn in this layout (ui/pinnedExtensionPlace.ts): the block has a say only where it is the sidebar. */extensionsPlace?:'toolbar'|'sidebar'|'none';/** The active tab's glow colour (the one its row wears, ui/ownPageGlow.ts rowGlowColour): the carried block takes the active tab's own glow, tokens and strength (styles/tab-glow.css), which follow Site color. */glow?:string;/** The sidebar's size (runtime/sidebarSizes.ts): at Narrow the blocks give their room to the titles (no previews) */size?:'narrow'|'standard'|'wide';previews:CustomizePreviews}){
 const root=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null),ghost=useRef<HTMLDivElement>(null);
 const ctx:ArrangeContext={shelf,favoritesPlace,sidePanel};
 const base=useMemo<Arrange>(()=>arrangeOf(layout,ctx),[]);// eslint-disable-line react-hooks/exhaustive-deps -- one customize session: the arrangement is this component's, and what it changes is written out as it goes
 const [arr,setArr]=useState<Arrange>(base),[live,setLive]=useState<Arrange|null>(null),[drag,setDrag]=useState<Drag|null>(null),[settle,setSettle]=useState<{commit:boolean}|null>(null);
 const shown=live??arr,liveRef=useRef<Arrange|null>(null);liveRef.current=live;
 const press=useRef<{id:BlockId;x:number;y:number;pointer:number;ox:number;oy:number;rect:DOMRect}|null>(null),run=useRef<Run|null>(null),frame=useRef(0),scrolling=useRef(0),pointer=useRef({x:0,y:0});
 const [status,setStatus]=useState('');
 // Written out as it goes (the old Customize's way): the order of the list, what is off, the two edges and where Favorites sit.
 const write=(next:Arrange)=>{
  const placed=placementOf(next,layout,ctx);
  if(JSON.stringify(placed)!==JSON.stringify({order:layout.order,hidden:layout.hidden,edges:layout.edges}))onChange(placed);
  const fav=next.top.includes('favorites')?'top':next.bottom.includes('favorites')?'bottom':null;if(fav&&fav!==favoritesPlace)onFavoritesPlace?.(fav);
 };

 // The blocks that make room, and the zones they sit in, glide to their new places on `reorder.move` (the sidebar rows' glide: a second change mid-flight carries on from where the block is drawn and how fast it moves).
 // Blocks are measured inside their zone and zones inside the body, by layout offsets (a translate never moves them), so a zone that glides does not carry its blocks' glide twice.
 const places=useRef(new Map<string,{x:number;y:number}>());
 useLayoutEffect(()=>{
  const box=body.current;if(!box)return;
  const nodes=[...box.querySelectorAll<HTMLElement>('[data-zone],[data-block]')],now=performance.now(),carried=new Map<HTMLElement,ReturnType<typeof pauseGlide>>();
  for(const node of nodes){const state=pauseGlide(node,now);if(state)carried.set(node,state);}
  const next=new Map<string,{x:number;y:number}>(),spec=motionSpeed()==='off'?null:springNow('reorder.move',true),before=places.current;
  for(const node of nodes){
   const key=node.dataset.block?`b:${node.dataset.block}@${node.closest<HTMLElement>('[data-zone]')?.dataset.zone}`:`z:${node.dataset.zone}`,place={x:node.offsetLeft,y:node.offsetTop},was=before.get(key);next.set(key,place);
   if(!spec)continue;
   const state=carried.get(node)??null;
   if(was&&(Math.abs(was.x-place.x)>.5||Math.abs(was.y-place.y)>.5))glideBy(node,{x:was.x-place.x,y:was.y-place.y},spec,state);
   else if(state)glideBy(node,{x:0,y:0},spec,state);
  }
  places.current=next;
 },[shown,drag?.id,settle]);

 // Layout positions (offsets), not painted ones: blocks that are still gliding must not shuffle the target, and a drop must land where the block WILL be, not where a glide still has it.
 const layoutRect=(node:HTMLElement)=>{
  const box=body.current!,origin=box.getBoundingClientRect(),area=node.closest<HTMLElement>('[data-zone]'),inside=area&&area!==node;
  const left=origin.left+(inside?area.offsetLeft+node.offsetLeft:node.offsetLeft)-box.scrollLeft,top=origin.top+(inside?area.offsetTop+node.offsetTop:node.offsetTop)-box.scrollTop;
  return {left,top,right:left+node.offsetWidth,bottom:top+node.offsetHeight};
 };
 const measure=():Measured=>{
  const box=body.current!,zones:Measured['zones']={},items:Measured['items']=[];
  for(const area of box.querySelectorAll<HTMLElement>('[data-zone]')){
   const which=area.dataset.zone as Zone;zones[which]=layoutRect(area);
   for(const node of area.querySelectorAll<HTMLElement>('[data-block]'))items.push({id:node.dataset.block as BlockId,zone:which,rect:layoutRect(node)});
  }
  return {zones,items};
 };
 const aim=(x:number,y:number)=>{
  const id=run.current?.id??drag?.id;if(!id||run.current?.settling)return;const slot=slotAt(measure(),id,x,y,rtl());if(!slot)return;
  const next=moveBlock(liveRef.current??arr,id,slot.zone,slot.index);if(next!==(liveRef.current??arr)){liveRef.current=next;setLive(next);}
 };
 // The ghost: placed straight from the pointer event. In the list it keeps to its column (a little sway, as the tab drag's row); over the Off tray it is a chip centred on the pointer (`p`, 0..1, on the tab chip's springs).
 const place=()=>{
  const r=run.current,g=ghost.current;if(!r||!g)return;
  const at=ghostAt({home:r.home,press:r.press,grab:r.grab,root:r.root,chip:r.chip},r.pos,r.p),m=clamp(r.p,0,1);
  // the chip it becomes follows the pointer anywhere: its glass (the lift's scale included) and the rim stay inside the sidebar's clip (the block itself keeps its column)
  const room=6+at.w*.0125,x=lerp(at.x,clamp(at.x,room,Math.max(room,r.bw-at.w-room)),m);
  r.cur={...at,x};g.style.transform=`translate3d(${x}px,${at.y}px,0)`;
  if(at.w!==r.w||at.h!==r.h){r.w=at.w;r.h=at.h;g.style.width=at.w+'px';g.style.height=at.h+'px';}
  g.style.setProperty('--cz-chip',String(Math.round(m*1000)/1000));
 };
 const unpress=()=>{press.current=null;grab(false);};   // the press is over: the open hand again (or the arrow) from the next frame
 useEffect(()=>()=>grab(false),[]);   // Customize left in the middle of a press
 const begin=(event:PointerEvent<HTMLDivElement>)=>{
  if(event.button!==0||(event.target as HTMLElement).closest('button'))return;
  const node=(event.target as HTMLElement).closest<HTMLElement>('[data-block]');if(!node||node.hasAttribute('data-still')||settle||run.current||drag&&drag.lift!=='key')return;
  if(drag){liveRef.current=null;setLive(null);setDrag(null);}   // a keyboard lift is let go (nothing moved yet is kept) when the mouse takes over
  press.current={id:node.dataset.block as BlockId,x:event.clientX,y:event.clientY,pointer:event.pointerId,ox:event.clientX-node.getBoundingClientRect().left,oy:event.clientY-node.getBoundingClientRect().top,rect:node.getBoundingClientRect()};
  grab(true);try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* the window listeners below carry the drag whether or not the surface holds the pointer */}
 };
 const edgeScroll=(y:number)=>{
  const zone=body.current;if(!zone)return;const r=zone.getBoundingClientRect();
  const speed=y<r.top+BAND?-Math.min(14,(r.top+BAND-y)/2):y>r.bottom-BAND?Math.min(14,(y-(r.bottom-BAND))/2):0;
  cancelAnimationFrame(scrolling.current);if(!speed)return;
  const tick=()=>{zone.scrollTop+=speed;aim(pointer.current.x,pointer.current.y);scrolling.current=requestAnimationFrame(tick);};scrolling.current=requestAnimationFrame(tick);
 };
 const lift=(p:NonNullable<typeof press.current>,x:number,y:number)=>{
  const box=root.current!.getBoundingClientRect(),r=p.rect;
  const fromTray=locate(liveRef.current??arr,p.id)?.zone==='off';   // lifted from the Off tray: the ghost is the chip from its first frame
  run.current={id:p.id,root:{left:box.left,top:box.top},bw:box.width,home:{left:r.left-box.left,top:r.top-box.top,w:r.width,h:r.height},press:{x:p.x,y:p.y},grab:{x:p.ox,y:p.oy},pos:{x,y},chip:fromTray?{w:r.width,h:r.height}:{w:0,h:0},p:fromTray?1:0,cur:{x:r.left-box.left,y:r.top-box.top,w:r.width,h:r.height},w:r.width,h:r.height,settling:false};
  setDrag({id:p.id,lift:'pointer',w:r.width,h:r.height});setStatus(t("sidebarcustomize.lifted",{name:name(p.id)}));
 };
 const move=(event:{pointerId:number;clientX:number;clientY:number;buttons?:number})=>{
  const p=press.current;if(!p||event.pointerId!==p.pointer)return;
  pointer.current={x:event.clientX,y:event.clientY};
  const r=run.current;
  if(event.buttons===0){if(r)finish(false);else unpress();return;}   // the release was lost (a native dialog, Cmd-Tab): a hover never carries a block
  if(!r){if(!settle&&Math.hypot(event.clientX-p.x,event.clientY-p.y)>=THRESHOLD)lift(p,event.clientX,event.clientY);return;}
  if(r.settling)return;
  r.pos={x:event.clientX,y:event.clientY};place();edgeScroll(event.clientY);
  cancelAnimationFrame(frame.current);const x=event.clientX,y=event.clientY;frame.current=requestAnimationFrame(()=>aim(x,y));
 };
 const finish=(commit:boolean)=>{
  cancelAnimationFrame(frame.current);cancelAnimationFrame(scrolling.current);
  const r=run.current;unpress();if(!r||r.settling)return;
  r.settling=true;r.stop?.();if(!commit){liveRef.current=null;setLive(null);}
  setSettle({commit});
 };
 const up=(event:{pointerId:number})=>{if(press.current&&event.pointerId===press.current.pointer){if(!run.current){unpress();return;}finish(true);}};
 const cancel=()=>{if(press.current||run.current){if(run.current?.settling){unpress();return;}finish(false);}};
 // The drag is followed from the window, not from the surface: the surface holds the pointer too (setPointerCapture), but a press whose capture is lost at once (seen with Reduce motion on) must still carry the block, and a drag that leaves the sidebar must still end.
 const hands=useRef({move,up,cancel});hands.current={move,up,cancel};
 useEffect(()=>{
  const moved=(event:globalThis.PointerEvent)=>hands.current.move(event),upped=(event:globalThis.PointerEvent)=>hands.current.up(event),cancelled=()=>hands.current.cancel();
  window.addEventListener('pointermove',moved);window.addEventListener('pointerup',upped);window.addEventListener('pointercancel',cancelled);window.addEventListener('blur',cancelled);
  return()=>{window.removeEventListener('pointermove',moved);window.removeEventListener('pointerup',upped);window.removeEventListener('pointercancel',cancelled);window.removeEventListener('blur',cancelled);};
 },[]);
 // The chip morph: the ghost becomes a chip while its place is in the Off tray, and a block again when it leaves.
 const zone=drag&&locate(shown,drag.id)?.zone,liftId=drag?.lift==='pointer'?drag.id:null;
 useLayoutEffect(()=>{
  const r=run.current;if(!r||drag?.lift!=='pointer'||r.settling)return;
  const chip=zone==='off',gap=body.current?.querySelector<HTMLElement>('[data-gap]');
  if(chip&&gap)r.chip={w:gap.offsetWidth,h:gap.offsetHeight};
  const target=chip?1:0;if(r.p===target&&!r.stop){place();return;}
  r.stop?.();r.stop=undefined;
  const scale=motionScale();
  if(!scale){r.p=target;place();return;}
  const controls=animate(r.p,target,{...morphSpring(target?'tab.split':'tab.merge',scale),onUpdate:value=>{r.p=value;place();}});r.stop=()=>controls.stop();
 },[zone,drag?.lift]);// eslint-disable-line react-hooks/exhaustive-deps
 // The ghost is in the page in the commit that lifts it: placed before the first paint, then it rises (glass and shadow form on the effects spring, the card on the lift's).
 useLayoutEffect(()=>{
  const g=ghost.current;if(!g||!run.current||drag?.lift!=='pointer')return;
  place();
  const lift=g.querySelector('.sb-cz-glass'),surface=g.querySelector('.sb-cz-surface'),shadow=g.querySelector('.sb-cz-shadow');
  if(lift)animateSpring(lift,[{scale:1},{scale:1.025}],'hover.lift',{},true);
  for(const el of [surface,shadow])if(el)animateSpring(el,[{opacity:0},{opacity:1}],'materialize');
 },[liftId]);// eslint-disable-line react-hooks/exhaustive-deps
 // The drop: the ghost settles into the gap on `reorder.release` (one small overshoot at most), its glass and shadow let go as it lands, and the block takes its place under it.
 useLayoutEffect(()=>{
  if(!settle)return;
  const r=run.current,g=ghost.current,gap=body.current?.querySelector<HTMLElement>('[data-gap]');
  const done=()=>{const next=settle.commit?liveRef.current:null;run.current=null;setSettle(null);setDrag(null);setLive(null);if(next){setArr(next);write(next);setStatus(t("sidebarcustomize.placed",{name:name(drag!.id)}));}else if(drag)setStatus(t("sidebarcustomize.stays",{name:name(drag.id)}));};
  if(!r||!g||!gap){done();return;}
  const scale=motionScale(),box=root.current!.getBoundingClientRect(),gb=layoutRect(gap),goal={x:gb.left-box.left,y:gb.top-box.top,w:gb.right-gb.left,h:gb.bottom-gb.top},from={...r.cur};
  const chip0=clamp(r.p,0,1),chip1=locate(shown,r.id)?.zone==='off'?1:0;
  const apply=(s:number)=>{
   const x=lerp(from.x,goal.x,s),y=lerp(from.y,goal.y,s),w=lerp(from.w,goal.w,s),h=lerp(from.h,goal.h,s);
   g.style.setProperty('--cz-chip',String(Math.round(lerp(chip0,chip1,clamp(s,0,1))*1000)/1000));
   g.style.transform=`translate3d(${x}px,${y}px,0)`;if(Math.abs(w-r.w)>.01||Math.abs(h-r.h)>.01){r.w=w;r.h=h;g.style.width=w+'px';g.style.height=h+'px';}
   g.style.setProperty('--cz-let',String(Math.round(clamp((s-.15)/.7,0,1)*1000)/1000));
  };
  root.current!.dataset.settling='';
  if(!scale){apply(1);done();return;}
  // the card sets back down to its size as it lands (the lift's scale returns on the same spring), so the block that takes its place is exactly the ghost's size
  const glass=g.querySelector('.sb-cz-glass');if(glass)animateSpring(glass,[{scale:1.025},{scale:1}],'reorder.release');
  const controls=animate(0,1,{...morphSpring('reorder.release',scale*.75),onUpdate:apply,onComplete:()=>{apply(1);done();}});
  return()=>controls.stop();
 },[settle]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(!settle&&root.current)delete root.current.dataset.settling;},[settle]);
 useEffect(()=>{
  if(!drag)return;const key=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(drag.lift==='key'){refocus.current=drag.id;setLive(null);setDrag(null);setStatus(t("sidebarcustomize.stays",{name:name(drag.id)}));}else finish(false);}};
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[drag]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>()=>{cancelAnimationFrame(frame.current);cancelAnimationFrame(scrolling.current);run.current?.stop?.();},[]);
 // Keyboard: Space lifts a block, the arrows move it through the places it may sit, Space drops it, Esc cancels.
 const refocus=useRef<BlockId|null>(null);
 const keys=(event:KeyboardEvent<HTMLDivElement>,id:BlockId)=>{
  if(event.target!==event.currentTarget||press.current||run.current)return;
  if(event.key===' '||event.key==='Enter'){
   event.preventDefault();
   if(drag?.lift==='key'&&drag.id===id){const next=liveRef.current;refocus.current=id;setDrag(null);setLive(null);if(next){setArr(next);write(next);}setStatus(t("sidebarcustomize.placed",{name:name(id)}));}
   else if(!drag&&!settle){setDrag({id,lift:'key'});setLive(arr);liveRef.current=arr;setStatus(t("sidebarcustomize.liftedKeys",{name:name(id)}));}
   return;
  }
  if(event.key!=='ArrowUp'&&event.key!=='ArrowDown'&&event.key!=='ArrowLeft'&&event.key!=='ArrowRight'||!(drag?.lift==='key'&&drag.id===id))return;
  event.preventDefault();const dir:-1|1=event.key==='ArrowUp'?-1:event.key==='ArrowDown'?1:(event.key==='ArrowLeft'?-1:1)*(rtl()?-1:1) as -1|1;
  const next=stepBlock(liveRef.current??arr,id,dir);
  if(next!==liveRef.current){liveRef.current=next;setLive(next);const at=locate(next,id);setStatus(at?.zone==='off'?t("sidebarcustomize.nowOff",{name:name(id)}):at?.zone==='top'?t("sidebarcustomize.nowTop",{name:name(id)}):at?.zone==='bottom'?t("sidebarcustomize.nowBottom",{name:name(id)}):t("sidebarcustomize.nowPosition",{name:name(id),n:(at?.index??0)+1}));}
 };
 // A block that changes zone is a new element (a new parent), so focus would fall to the page: it is given back to the lifted block after every step, and to the dropped one.
 useLayoutEffect(()=>{
  const node=drag?.lift==='key'?body.current?.querySelector<HTMLElement>(`[data-block="${drag.id}"]`):!drag&&refocus.current?body.current?.querySelector<HTMLElement>(`[data-block="${refocus.current}"]`):null;
  if(!drag)refocus.current=null;
  if(node){node.focus({preventScroll:true});node.scrollIntoView({block:'nearest'});}
 },[shown,drag?.lift,drag?.id]);// eslint-disable-line react-hooks/exhaustive-deps
 const turnOff=(id:BlockId)=>{if(drag||settle)return;const next=moveBlock(arr,id,'off',arr.off.length);if(next!==arr){setArr(next);write(next);}};
 // Favorites come back to the edge the Favorites store (Settings) keeps them on
 const turnOn=(id:BlockId)=>{if(drag||settle)return;const to=id==='favorites'?favoritesPlace:homeOf(id);const next=moveBlock(arr,id,to,homeIndex(arr,id,to));if(next!==arr){setArr(next);write(next);}};
 const noteOf=(id:BlockId)=>id==='extensions'&&extensionsPlace!=='sidebar'?t("sidebarcustomize.extensionsInToolbar"):note(id);
 const face=(id:BlockId,room=false)=><><span className="sb-cz-grip" aria-hidden="true">{GRIP}</span><span className="sb-cz-icon"><PreviewIcon icon={ICONS[id]} size={16}/></span><span className="sb-cz-name" title={noteOf(id)?name(id)+". "+noteOf(id):name(id)}><span className="sb-cz-title">{name(id)}</span>{noteOf(id)&&<span className="sb-cz-note">{noteOf(id)}</span>}</span><Preview id={id} previews={previews}/>{room&&canSit(id,'off')&&<i className="sb-cz-off-room" aria-hidden="true"/>}</>;
 const block=(id:BlockId,zone:Zone):ReactNode=>{
  const gap=drag?.id===id&&drag.lift==='pointer',lifted=drag?.id===id&&drag.lift==='key';
  if(zone==='off')return <div key={id} className="sb-cz-chip" data-block={id} data-gap={gap||undefined} data-lifted={lifted||undefined} tabIndex={0} role="listitem" aria-roledescription="sortable" aria-label={t("sidebarcustomize.chipLabel",{name:chipName(id)})} onKeyDown={event=>keys(event,id)}>
   <span className="sb-cz-chip-icon"><PreviewIcon icon={ICONS[id]} size={14}/></span><span className="sb-cz-chip-name">{chipName(id)}</span>
   <button type="button" className="sb-cz-chip-on" aria-label={t("sidebarcustomize.turnOnName",{name:chipName(id)})} title={t("sidebarcustomize.turnOn")} onClick={()=>turnOn(id)}><PreviewIcon icon={Plus} size={12}/></button></div>;
  const edge=isEdge(id),canOff=canSit(id,'off'),still=!(['top','middle','off','bottom'] as Zone[]).some(z=>z!==zone&&canSit(id,z))&&shown[zone].length<2;   // nowhere to go and no neighbour to swap with (Tabs alone in the list): not draggable, no hand
  return <div key={id} className="sb-cz-block" data-block={id} data-edge={edge||undefined} data-fixed={!canOff||undefined} data-still={still||undefined} data-gap={gap||undefined} data-lifted={lifted||undefined} tabIndex={0} role="listitem" aria-roledescription="sortable"
   aria-label={noteOf(id)?t("sidebarcustomize.blockLabelNote",{name:name(id),note:noteOf(id)!}):t("sidebarcustomize.blockLabel",{name:name(id)})} onKeyDown={event=>keys(event,id)}>
   {face(id)}
   {canOff&&<button type="button" className="sb-cz-off" aria-label={t("sidebarcustomize.turnOffName",{name:name(id)})} title={t("sidebarcustomize.turnOff")} onClick={()=>turnOff(id)}><PreviewIcon icon={Minus} size={12}/></button>}
  </div>;
 };
 // A place lights softly while the carried block may sit in it (the one the pointer is in a little more); the others stay quiet.
 const aimAt=(z:Zone)=>drag&&canSit(drag.id,z)||undefined,overAt=(z:Zone)=>drag&&zone===z||undefined;
 const slot=(z:'top'|'bottom',label:string)=>{
  const blocks=shown[z];
  return <div className="sb-cz-edge" data-zone={z} data-aim={aimAt(z)} data-over={overAt(z)} role="list" aria-label={label}>
   <span className="sb-cz-cap" aria-hidden="true">{label}</span>{blocks.map(id=>block(id,z))}
   {!blocks.length&&<span className="sb-cz-empty">{drag&&canSit(drag.id,z)?t("sidebarcustomize.dropHere"):t("sidebarcustomize.nothingHere")}</span>}</div>;
 };
 const lifting=liftId;
 return <div ref={root} className="sb-cz" role="group" aria-label={t("sidebarcustomize.customizeSidebar")} data-dragging={lifting?'':undefined} data-lift={drag?.id&&(isEdge(drag.id)?'edge':'mid')||undefined} data-glow={glow?'':undefined} data-size={size} style={glow?{'--site':glow} as CSSProperties:undefined}
  onPointerDown={begin}>
  <div className="sb-cz-head"><span className="sb-cz-head-name">{t("sidebarcustomize.customizeSidebar")}</span><button type="button" className="sb-custom-done" onClick={onDone}>{t("favoriteeditor.done")}</button></div>
  <div ref={body} className="sb-cz-body">
   {slot('top',t("sidebarcustomize.topEdge"))}
   <div className="sb-cz-mid" data-zone="middle" data-aim={aimAt('middle')} data-over={overAt('middle')} role="list" aria-label={t("sidebarcustomize.sections")}>{shown.middle.map(id=>block(id,'middle'))}</div>
   <div className="sb-cz-tray" data-zone="off" data-aim={aimAt('off')} data-over={overAt('off')} data-refuse={drag&&!canSit(drag.id,'off')||undefined} role="list" aria-label={t("sidebarcustomize.off")}>
    <span className="sb-cz-cap" aria-hidden="true">{t("sidebarcustomize.off")}</span>
    {drag&&!canSit(drag.id,'off')&&<span className="sb-cz-refuse" aria-hidden="true">{t("sidebarcustomize.thisOneStays")}</span>}
    {shown.off.map(id=>block(id,'off'))}
    {!shown.off.length&&<span className="sb-cz-empty">{drag&&!canSit(drag.id,'off')?t("sidebarcustomize.thisOneStays"):t("sidebarcustomize.offHint")}</span>}
   </div>
   {slot('bottom',t("sidebarcustomize.bottomEdge"))}
  </div>
  {lifting&&<div ref={ghost} className="sb-cz-ghost" style={{width:drag?.w,height:drag?.h}} aria-hidden="true">
   <div className="sb-cz-glass"><span className="sb-cz-letgo"><i className="sb-cz-shadow"/><i className="sb-cz-surface"/></span>
    <div className="sb-cz-face sb-cz-face-block" data-edge={isEdge(lifting)||undefined}>{face(lifting,true)}</div>
    <div className="sb-cz-face sb-cz-face-chip"><span className="sb-cz-chip-icon"><PreviewIcon icon={ICONS[lifting]} size={14}/></span><span className="sb-cz-chip-name">{chipName(lifting)}</span><span className="sb-cz-chip-on"><PreviewIcon icon={Plus} size={12}/></span></div>
   </div></div>}
  <span className="sb-cz-live" aria-live="polite" role="status">{status}</span>
 </div>;
}
