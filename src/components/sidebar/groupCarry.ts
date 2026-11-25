import { canNest,groupForTab } from '../../runtime/tabGroups';
import type { BrowserAction,BrowserSnapshot,TabGroup } from '../../runtime/types';
import { t } from '../../i18n';
import { motionPace } from '../../ui/sharedMotion';
import { motionScale } from '../../ui/splitMotion';
import { folderMarkup } from './folderGlyph';
import { drawConnector } from './nestRail';
import { foldDrawn,foldedSpan,landingDeadline } from './groupCarryReady';

/** Beta 14, section AE: a tab group carried by its header in the sidebar's list. Ported from the approved sample (item24 round 2, groupNestDrag.ts `carryGroupRow`): every
 *  value, timing and order of phases is the sample's; what differs is named below. Pure behaviour of the sample, in short:
 *  - Pick-up: an open group folds (the sidebar's own fold); what follows the pointer is ONE compact chip (frosted glass, the folder, the name, a quiet count). The header row
 *    morphs into it over 180 ms x pace (ease-out cubic), the grab point staying under the pointer (scaled with the box).
 *  - The rows open a gap of one header row where the group would land and close its old place, each moving on a 180 ms x pace `cubic-bezier(.22,1,.36,1)` translate (a tab drag's own
 *    ease); guide lines and connectors move with their rows.
 *  - Over another top-level group (below the top 35% of its header, or anywhere in its rows) the gap opens inside it, 21px in, that group's header takes a soft wash of its colour,
 *    its folder opens and its line gains an elbow into the gap. Moving away plays that back. One level only.
 *  - Release: the chip turns back into a row and settles into the gap (180 ms x pace), the drop is sent, and the frame the new order is in the page the real header takes over
 *    (a 140 ms x pace slide of what is left of the difference); then the group unfolds again if it was open. Esc or a drop that changes nothing: the pick-up played back.
 *  Hit-testing runs on the layout (offsets: a running slide never moves it) with the carried row's place closed, so the opening gap never moves the targets under the pointer.
 *
 *  Differences from the sample (each one the brief's text asks for, or a repair of a flaw the brief names):
 *  - a group may be nested into a COLLAPSED group (the sample could not): its header is a target like any open group's, its gap closes the list at the group's bottom;
 *  - the chip is clamped to the sidebar's edge over the page (the sample did this too, but still dropped there): over the page the drop is a cancel (`suspend`);
 *  - a group can still be carried onto a workspace's icon, as in 13.7 (`suspend` hides this chip then; AciraSidebar draws the workspace chip);
 *  - the group that holds the current tab folds like any other (the current tab stays under its header, Arc's rule), the carry waits for that layout;
 *  - the drop is one `tab.group.move` (the model's own action) instead of the sample's `tab.drop` with `wholeGroup`. */
type Point={x:number;y:number};
type Inner={top:number;bottom:number;id:string};
type Entry={el:HTMLElement;top:number;bottom:number;first:string;last:string;group?:TabGroup;head?:number;inners?:Inner[];/** Pinned folders: the entry stands in the Pinned block. */pinned?:boolean};
export type GroupSlot={line:number;parent:string|null;action:BrowserAction;noop:boolean};
const EASE='cubic-bezier(.22,1,.36,1)';
/** A nested group sits this far right of a top-level one (the parent's rail 13 + 2 + 6, sidebar.css --sb-group-indent). */
const nestX=()=>window.devicePixelRatio>=1.4&&window.devicePixelRatio<=1.6?21.3333:21;

const homeParentEarly=(block:HTMLElement)=>block.matches('[data-nested-group]')?block.parentElement?.closest<HTMLElement>('.sb-group')??null:null;
export interface GroupCarry{
 move(point:Point):void;
 /** Release. `commit` dispatches the drop; `reopen` unfolds the group again; `settled` runs when the motion is over. */
 land(commitIt:boolean,commit:(action:BrowserAction)=>void,reopen:()=>void,settled:()=>void):void;
 /** The pointer is somewhere the group has no drop in the list (over the page, over a workspace's icon): the room closes, the drop is a cancel. `hidden`: the chip is not drawn (another chip is). */
 suspend(on:boolean,hidden?:boolean):void;
 /** The chip follows the pointer over the page too (the page yields to it, App); off: it rests inside the sidebar. */
 free(on:boolean):void;
 /** End at once, no landing (the group went elsewhere: a workspace). */
 abort(reopen:()=>void,settled:()=>void):void;
}
export function carryGroupRow(o:{block:HTMLElement;list:HTMLElement;/** Pinned folders: the Pinned block (a sibling of the list in the sidebar's scroll region), when there is one. */pinned?:HTMLElement|null;grab:Point;group:TabGroup;state:BrowserSnapshot;wasOpen:boolean;/** The sidebar's edges: the chip stays inside them. */bounds?:()=>{left:number;right:number}|undefined}):GroupCarry{
 const {block,list,group,state}=o,scroll=list.closest<HTMLElement>('.sb-scroll')!,header=block.querySelector<HTMLElement>(':scope>.sb-group-header')!;
 // The blocks the rows live in: the Pinned block (if any) and the list, in the order they stand.
 const blocks=[o.pinned,list].filter((node):node is HTMLElement=>!!node).sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
 const inBlocks=<T extends Element>(selector:string)=>blocks.flatMap(node=>[...node.querySelectorAll<T>(selector)]);
 const pace=()=>motionScale()?motionPace():0;
 /** Where a node lies out in the viewport, from offsets (a running slide or fold does not move it). */
 const lay=(node:HTMLElement)=>{let top=0,left=0;for(let at:HTMLElement|null=node;at&&at!==scroll;at=at.offsetParent as HTMLElement|null){top+=at.offsetTop;left+=at.offsetLeft;}const frame=scroll.getBoundingClientRect();return {top:frame.top+top-scroll.scrollTop,left:frame.left+left,width:node.offsetWidth,height:node.offsetHeight};};
 const toContent=(y:number)=>y-scroll.getBoundingClientRect().top+scroll.scrollTop;
 const start=header.getBoundingClientRect(),grabDy=o.grab.y-start.top,wasNested=!!group.parentGroupId;
 const own=(g:TabGroup)=>state.tabs.filter(tab=>groupForTab(state,tab)?.id===g.id);
 const family=(g:TabGroup)=>state.tabs.filter(tab=>{const x=groupForTab(state,tab);return !!x&&(x.id===g.id||x.parentGroupId===g.id);});
 const byId=(id?:string)=>state.tabGroups.find(g=>g.id===id);
 const holdsGroups=state.tabGroups.some(g=>g.parentGroupId===group.id);

 // ---- the carried chip (round 2b): a compact glass chip with the folder, the name and a quiet count, centred; it morphs out of the
 //      header row (same place, same icon and name) into the chip, and back into a row where it lands ----
 const host=list.closest<HTMLElement>('.app')??document.body;
 const folder=header.querySelector<HTMLElement>('.sb-group-folder'),name=header.querySelector<HTMLElement>('.sb-group-name');
 const row=document.createElement('div');row.className='ng-chip';row.setAttribute('aria-hidden','true');row.inert=true;
 const icon=document.createElement('span');icon.className='ng-chip-icon';icon.innerHTML=folderMarkup();
 const title=document.createElement('span');title.className='ng-chip-title';title.textContent=group.name||t('acirasidebar.unnamedGroup');
 const count=document.createElement('span');count.className='ng-chip-count';count.textContent=String(family(group).length);
 row.append(icon,title,count);
 row.style.setProperty('--ng-gc',folder?getComputedStyle(folder).color:'currentColor');
 row.style.setProperty('--ng-gn',name?getComputedStyle(name).color:getComputedStyle(header).color);
 row.style.setProperty('--group-color',getComputedStyle(block).getPropertyValue('--group-color'));
 row.style.font=getComputedStyle(name??header).font;
 // An open group's folder closes on the chip as the group folds (the folder's own morph).
 const glyph=icon.querySelector<HTMLElement>('.fg');
 if(o.wasOpen&&glyph){glyph.setAttribute('data-open','');requestAnimationFrame(()=>requestAnimationFrame(()=>glyph.removeAttribute('data-open')));}
 host.append(row);
 // The chip's own size: content + 12px each side, at most 200px (the name ellipsises).
 const PAD_ROW=6,CHIP_H=30;row.style.width='auto';row.style.paddingInline='12px';
 const chipW=Math.min(200,Math.ceil(row.getBoundingClientRect().width));row.style.paddingInline='';
 header.dataset.sidebarDragSource='';
 // E9: the group's remainder (the current tab's row and the group's line, Arc's rule) is part of what is lifted: it is hidden with the header, never left behind for the rows that close up to slide over.
 block.dataset.ngLift='';
 /** p: 0 = the header row, 1 = the chip. The grab point stays under the pointer (scaled with the box). */
 let free=false,p=0,pointerNow=o.grab,landing:null|{from:{x:number;y:number};to:{x:number;y:number;w:number};t0:number;dur:number;p0:number;done:()=>void}=null,suspended=false;
 const gx=o.grab.x-start.left,gy=o.grab.y-start.top;
 const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
 const ease=(t:number)=>1-Math.pow(1-t,3);
 const paint=(x:number,y:number,w:number,h:number,q:number)=>{
  const pad=lerp(PAD_ROW,12,q);
  Object.assign(row.style,{width:w+'px',height:h+'px',paddingLeft:pad+'px',transform:`translate3d(${x}px,${y}px,0)`});
  row.style.setProperty('--g',String(q));
 };
 const place=()=>{
  const w=lerp(start.width,chipW,p),h=lerp(start.height,CHIP_H,p);
  // The page is a separate native view above this interface. Over it the page yields (App takes its native views out for stills, the way the split picker does) and the chip, drawn here, follows
  // the pointer anywhere in the window with its glass intact (the sample's flaw 1); otherwise it rests inside the sidebar, against its edge.
  const raw=pointerNow.x-gx*(w/start.width),window_=host.getBoundingClientRect();
  const side=free?null:o.bounds?.()??list.closest<HTMLElement>('.acira-sidebar')?.getBoundingClientRect();
  const x=side?Math.max(side.left+4,Math.min(side.right-w-6,raw)):Math.max(window_.left+2,Math.min(window_.right-w-2,raw));
  return {x,y:Math.max(window_.top+2,Math.min(window_.bottom-h-2,pointerNow.y-gy*(h/start.height))),w,h};
 };
 let raf=0,t0=performance.now();const MORPH=180;
 const tick=(now:number)=>{
  if(landing){
   const t=landing.dur?Math.min(1,(now-landing.t0)/landing.dur):1,e=ease(t),q=landing.p0*(1-e);
   const ww=lerp(landing.to.w,chipW,q),hh=lerp(start.height,CHIP_H,q);
   paint(lerp(landing.from.x,landing.to.x,e),lerp(landing.from.y,landing.to.y,e),ww,hh,q);
   if(t<1){raf=requestAnimationFrame(tick);return;}
   landing.done();return;
  }
  const dur=MORPH*pace();p=dur?Math.min(1,ease(Math.min(1,(now-t0)/dur))):1;
  const r=place();paint(r.x,r.y,r.w,r.h,p);
  if(p<1)raf=requestAnimationFrame(tick);
 };
 paint(start.left,start.top,start.width,start.height,0);raf=requestAnimationFrame(tick);
 /** Fly the chip back into a row at (x,y,w), the pick-up played back. */
 const settleChip=(to:{x:number;y:number;w:number},done:()=>void)=>{cancelAnimationFrame(raf);const r=place();landing={from:{x:r.x,y:r.y},to,t0:performance.now(),dur:MORPH*pace(),p0:p,done};raf=requestAnimationFrame(tick);};
 // The gap: the carried tab's slot.
 const gap=document.createElement('div');gap.className='sidebar-tab-drag-gap';gap.setAttribute('aria-hidden','true');gap.inert=true;host.append(gap);
 for(const node of blocks)node.dataset.ngCarry='';
 // A carried inner group leaves its parent's line at once: its elbow fades out where it was.
 if(homeParentEarly(block))drawConnector(homeParentEarly(block)!,{lifted:{el:block,shown:false}});

 // ---- the model, measured once the group has folded (the folded layout is in the page at once; only its picture still moves) ----
 type Model={homeTop:number;H:number;/** the group's folded height: the room the rows close up by and the gap that opens where it lands (E9) */B:number;left:number;width:number;entries:Entry[];/** Pinned folders: the Pinned block's and the list's boxes (top, bottom) with the carried folder's place closed. A drop pins when the pointer is nearer the Pinned block: the two blocks can stand anywhere in the sidebar (Customize), so no line between them is assumed. null: no Pinned block. */pinnedBox:{top:number;bottom:number}|null;listBox:{top:number;bottom:number}|null;base:Map<HTMLElement,{top:number;height:number}>;rails:Set<HTMLElement>;tops:HTMLElement[]};
 let model:Model|null=null;
 // E9: measured only once the fold is fully drawn (no ghost left in the list, no animation on the group still running), at most FOLD_WAIT_MS after it began.
 let foldedAt=0;
 const ready=()=>{
  if(!o.wasOpen)return true;
  if(!block.hasAttribute('data-collapsed'))return false;
  const now=performance.now();if(!foldedAt)foldedAt=now;
  return foldDrawn(scroll.querySelectorAll('.sb-flip-ghost').length,block.getAnimations({subtree:true}).map(animation=>({running:animation.playState==='running'||animation.pending,finite:Number.isFinite(animation.effect?.getComputedTiming().endTime as number)})),now-foldedAt);
 };
 const build=():Model=>{
  const home=lay(header),H=home.height,homeTop=home.top;
  // E9: the rows after the group close up by its whole folded height (header + the current tab's row), not by the header alone: the tab that stays under the header is lifted with it.
  const bodyOf=list.querySelector<HTMLElement>('[data-zone=tabs] .sb-zone-body')??list.querySelector<HTMLElement>('.sb-zone-body');
  const pinnedBlock=o.pinned??null,sequence=[...(pinnedBlock?[...pinnedBlock.children] as HTMLElement[]:[]),...(bodyOf?[...bodyOf.children] as HTMLElement[]:[])];
  // The rows that close up are the ones after the group in ITS OWN block: the last folder of the Pinned block has none (what follows it is another block).
  const pool=pinnedBlock&&block.parentElement===pinnedBlock?[...pinnedBlock.children] as HTMLElement[]:bodyOf?[...bodyOf.children] as HTMLElement[]:[];
  const nextEl=pool.find((el):el is HTMLElement=>el instanceof HTMLElement&&el!==block&&!!(block.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)&&el.matches('.sb-tab,.sb-split-group,.sb-group')&&el.offsetHeight>0);
  const B=foldedSpan(homeTop,nextEl?lay(nextEl).top:null,lay(block).height,H),v=(y:number)=>y>homeTop+.5?y-B:y;
  const tabsOf=(el:HTMLElement):string[]=>{
   if(el.matches('.sb-group')){const g=byId(el.dataset.groupId);return g?family(g).map(tab=>tab.id):[];}
   if(el.matches('.sb-split-group')){const ids=new Set([...el.querySelectorAll<HTMLElement>('[data-tab-id]')].map(node=>node.dataset.tabId!));return state.tabs.filter(tab=>ids.has(tab.id)).map(tab=>tab.id);}
   return el.dataset.tabId?[el.dataset.tabId]:[];
  };
  const body=list.querySelector<HTMLElement>('[data-zone=tabs] .sb-zone-body')??list.querySelector<HTMLElement>('.sb-zone-body'),entries:Entry[]=[];
  for(const el of sequence){
   if(el===block||!el.matches('.sb-tab,.sb-split-group,.sb-group'))continue;
   const box=lay(el),ids=tabsOf(el);if(!box.height)continue;
   const g=el.matches('.sb-group')?byId(el.dataset.groupId):undefined;
   if(!ids.length&&!g)continue;
   const entry:Entry={el,top:v(box.top),bottom:v(box.top+box.height),first:ids[0]??'',last:ids.at(-1)??'',...(pinnedBlock?.contains(el)?{pinned:true}:{})};
   if(g&&canNest(state,group,g)){
    const head=lay(el.querySelector<HTMLElement>(':scope>.sb-group-header')!);
    entry.group=g;entry.head=v(head.top)+head.height;
    entry.inners=[...el.querySelectorAll<HTMLElement>(':scope>.sb-group-members>.sb-group')].filter(node=>node!==block&&node.offsetHeight>0&&!node.hasAttribute('data-hidden')).flatMap(node=>{
     const inner=byId(node.dataset.groupId);if(!inner)return [];
     const r=lay(node);return [{top:v(r.top),bottom:v(r.top+r.height),id:inner.id}];});
   }
   entries.push(entry);
  }
  // What makes room: rows (what a folded carried group still shows, the current tab, closes up with them), headers, split cards, New tab, the lines of groups (a plain line is the members' `::before`, moved by top and height; a parent's connector is
  // drawn from the layout and the room, nestRail.ts), and whatever follows the list.
  const pieces=inBlocks<HTMLElement>('.sb-tab,.sb-split-group,.sb-group>.sb-group-header,.sb-new-tab')
   .filter(node=>node!==header&&!block.contains(node)&&!node.closest('.sb-flip-ghosts')&&!(node.classList.contains('sb-tab')&&node.parentElement?.closest('.sb-split-group'))&&node.offsetHeight>0);
  const rails=new Set([...inBlocks<HTMLElement>('.sb-group>.sb-group-members')].filter(node=>!block.contains(node)&&!node.closest('.sb-flip-ghosts')&&!node.parentElement!.hasAttribute('data-has-inner')&&node.offsetHeight>0));
  // Whatever the scroll region holds outside the two blocks and below the first of them (the line between the blocks, Bookmarks, History...) moves with the room.
  const firstBottom=lay(blocks[0]).top+blocks[0].offsetHeight;
  const following=[...scroll.children].filter((node):node is HTMLElement=>node instanceof HTMLElement&&!blocks.includes(node)&&!blocks.some(blockNode=>node.contains(blockNode))&&lay(node).top>=firstBottom-1);
  const base=new Map([...pieces,...rails,...following].map(node=>{const r=lay(node);return [node,{top:r.top,height:r.height}] as const;}));
  const tops=[...(pinnedBlock?[...pinnedBlock.querySelectorAll<HTMLElement>(':scope>.sb-group')]:[]),...(body??list).querySelectorAll<HTMLElement>(':scope>.sb-group')].filter(node=>node!==block);
  const boxOf=(node:HTMLElement|null|undefined)=>{if(!node||!node.offsetHeight)return null;const r=lay(node);return {top:v(r.top),bottom:v(r.top+r.height)};};
  const pinnedBox=boxOf(pinnedBlock),listBox=boxOf(bodyOf);
  return {homeTop,H,B,left:home.left,width:home.width,entries,pinnedBox,listBox,base,rails,tops};
 };
 const slotAt=(m:Model,cy:number):GroupSlot|null=>{
  // Pinned folders: the block nearest the pointer decides, and the move says so (a folder dropped among the pinned ones pins, one dropped in the list unpins).
  const gap=(b:{top:number;bottom:number})=>Math.max(b.top-cy,cy-b.bottom,0),inPinned=!!m.pinnedBox&&(!m.listBox||gap(m.pinnedBox)<=gap(m.listBox)),pins=m.pinnedBox?{pinned:inPinned}:{};
  const act=(parent:string|null,ref?:{to?:string;toTab?:string},position?:'before'|'after'):BrowserAction=>({type:'tab.group.move',id:group.id,parentId:parent,...(parent?{}:pins),...(ref?.to?{to:ref.to}:ref?.toTab?{toTab:ref.toTab}:{}),...(position?{position}:{})} as BrowserAction);
  const slot=(line:number,parent:string|null,action:BrowserAction):GroupSlot=>({line,parent,action,noop:Math.abs(line-m.homeTop)<1.5&&parent===(group.parentGroupId??null)});
  const refOf=(e:Entry,p:'before'|'after')=>e.el.matches('.sb-group')?{to:e.el.dataset.groupId!}:{toTab:p==='before'?e.first:e.last};
  const top=(e:Entry,p:'before'|'after')=>slot(p==='before'?e.top:e.bottom,null,act(null,refOf(e,p),p));
  const nest=(e:Entry,k:number)=>{const ins=e.inners!,at=ins[k],last=ins.at(-1),parent=e.group!.id;
   return at?slot(at.top,parent,act(parent,{to:at.id},'before')):slot(last?last.bottom:e.bottom,parent,act(parent));};
  for(const e of [...m.entries].sort((a,b)=>a.top-b.top)){
   // In the Pinned block past its last entry: the end of the Pinned block, not the top of the list.
   if(inPinned&&!e.pinned){const lastPinned=m.entries.filter(x=>x.pinned).sort((a,b)=>a.bottom-b.bottom).at(-1);return lastPinned?top(lastPinned,'after'):top(e,'before');}
   if(!inPinned&&m.pinnedBox&&e.pinned)continue;
   if(cy<e.top)return top(e,'before');
   if(cy>e.bottom)continue;
   if(e.group){
    if(cy<e.top+(e.head!-e.top)*.35)return top(e,'before');
    const ins=e.inners!;let k=0;while(k<ins.length&&(ins[k].top+ins[k].bottom)/2<=cy)k++;
    return nest(e,k);
   }
   return cy<e.top+Math.min(16,(e.bottom-e.top)/2)?top(e,'before'):top(e,'after');
  }
  const last=m.entries.filter(x=>!m.pinnedBox||!!x.pinned===inPinned).sort((x,y)=>x.bottom-y.bottom).at(-1);return last?top(last,'after'):null;
 };

 // ---- the room ----
 const moves=new Map<HTMLElement,{animation:Animation;dy:number;dh:number}>();
 const shift=(m:Model,node:HTMLElement,dy:number,dh=0)=>{
  const previous=moves.get(node);if(previous?previous.dy===dy&&previous.dh===dh:!dy&&!dh)return;
  const rail=m.rails.has(node),shown=getComputedStyle(node,rail?'::before':null),box=m.base.get(node)!;previous?.animation.cancel();
  // A line moves by top and stretches by height (paint only, as the sidebar draws it); rows by translate.
  if(!rail)node.dataset.ngRoom='';
  const animation=rail?node.animate([{top:shown.top,height:shown.height,bottom:'auto'},{top:dy+'px',height:Math.max(0,box.height+dh)+'px',bottom:'auto'}],{duration:180*pace(),easing:EASE,fill:'both',pseudoElement:'::before'})
   :node.animate([{translate:shown.translate==='none'?'0px 0px':shown.translate},{translate:`0px ${dy}px`}],{duration:180*pace(),easing:EASE,fill:'both'});
  moves.set(node,{animation,dy,dh});
 };
 let target:HTMLElement|null=null;
 const homeParent=wasNested?block.parentElement?.closest<HTMLElement>('.sb-group')??null:null;
 const room=(m:Model,s:GroupSlot|null,returning=false)=>{
  const line=s?s.line:m.homeTop,v=(y:number)=>y>m.homeTop+.5?y-m.B:y,shiftOf=(y:number)=>s?(y>m.homeTop+.5?-m.B:0)+(v(y)>=line-.5?m.B:0):0;
  for(const [node,box] of m.base){
   if(!m.rails.has(node)){shift(m,node,shiftOf(box.top));continue;}
   const dy=shiftOf(box.top),bottom=shiftOf(box.top+box.height-1);shift(m,node,dy,bottom-dy);
  }
  // The nest target: its header's wash and open folder (CSS on data-nest-target), and its line's elbow into the gap.
  const next=s?.parent?m.tops.find(node=>node.dataset.groupId===s.parent)??null:null;
  if(target&&target!==next)delete target.dataset.nestTarget;
  if(next)next.dataset.nestTarget='';
  const frame=scroll.getBoundingClientRect(),inContent=(y:number)=>shiftOf(y+frame.top-scroll.scrollTop);
  for(const node of m.tops)drawConnector(node,{shift:inContent,preview:node===next&&s?toContent(s.line+m.H/2):null,lifted:node===homeParent?{el:block,shown:returning}:null});
  target=next;
  if(!s){gap.style.opacity='0';return;}
  const glide=gap.style.opacity==='1'&&pace()>0,dx=(s.parent?nestX():0)-(wasNested?nestX():0);
  gap.style.transition=glide?`transform 180ms ${EASE},width 180ms ${EASE}`:'none';
  Object.assign(gap.style,{width:(m.width-dx)+'px',height:m.B+'px',transform:`translate3d(${m.left+dx}px,${s.line}px,0)`,opacity:'1'});
 };

 let pointer=o.grab,current:GroupSlot|null=null,y=start.top,frame=0;
 const update=()=>{
  pointerNow=pointer;if(!landing&&p>=1){const r=place();paint(r.x,r.y,r.w,r.h,1);}y=pointer.y-grabDy;
  if(!model){if(!ready())return;model=build();}
  if(suspended)return;
  const next=slotAt(model,y+model.H/2);
  if(JSON.stringify(next)===JSON.stringify(current))return;
  current=next;room(model,next&&!next.noop?next:null);
 };
 // Until the fold is in the page, check each frame (the pointer may rest).
 const wait=()=>{if(model)return;update();if(!model)frame=requestAnimationFrame(wait);};frame=requestAnimationFrame(wait);
 const move=(point:Point)=>{pointer=point;update();};
 const suspend=(on:boolean,hidden=false)=>{
  row.style.visibility=on&&hidden?'hidden':'';
  if(on===suspended)return;suspended=on;
  if(on){current=null;if(model)room(model,null);}else update();
 };

 /** Tidy up: cancel the room, drop the wash, remove the chip and the gap, redraw every connector from the layout. */
 let finished=false;
 const wrapUp=(reopen:()=>void,settled:()=>void)=>{
  if(finished)return;finished=true;
  for(const [node,m] of moves){m.animation.cancel();delete node.dataset.ngRoom;}moves.clear();
  if(target){delete target.dataset.nestTarget;target=null;}
  for(const node of blocks)delete node.dataset.ngCarry;delete header.dataset.sidebarDragSource;delete block.dataset.ngLift;
  gap.remove();row.remove();
  for(const node of inBlocks<HTMLElement>('[data-zone=tabs] .sb-zone-body>.sb-group,:scope>.sb-group'))drawConnector(node);
  settled();if(o.wasOpen)reopen();
 };
 const land=(commitIt:boolean,commit:(action:BrowserAction)=>void,reopen:()=>void,settled:()=>void)=>{
  cancelAnimationFrame(frame);
  const s=commitIt&&!suspended&&current&&!current.noop?current:null,ms=180*pace();
  if(!s&&model)room(model,null,true);
  else if(!s&&homeParent)drawConnector(homeParent,{lifted:{el:block,shown:true}});
  const toY=s?s.line:(model?model.homeTop:lay(header).top),dx=s?((s.parent?nestX():0)-(wasNested?nestX():0)):0;
  const toX=(model?.left??start.left)+dx,toW=(model?.width??start.width)-dx;
  // The chip turns back into a row and settles into its place (the pick-up played back).
  const fly={finished:new Promise<void>(resolve=>settleChip({x:toX,y:toY,w:toW},resolve))};void ms;
  const finish=()=>wrapUp(reopen,settled);
  // E9: the landing never depends on animation frames or on a mutation that may not come: this timer ends it whatever happened (a frame-less window, an order that never changed).
  window.setTimeout(()=>{if(finished)return;if(model)room(model,null);finish();},landingDeadline(ms));
  if(!s){fly.finished.then(finish,finish);return;}
  fly.finished.then(()=>{
   const parentBefore=block.parentElement;let done=false;
   const take=()=>{
    const real=blocks.map(node=>node.querySelector<HTMLElement>(`.sb-group[data-group-id="${CSS.escape(group.id)}"]`)).find(Boolean)??null;
    if(done||!real||real===block&&real.parentElement===parentBefore&&Math.abs(lay(real).top-(model?.homeTop??0))<.5)return;
    done=true;observer.disconnect();
    const realHeader=real.querySelector<HTMLElement>(':scope>.sb-group-header')!,was=row.getBoundingClientRect();
    finish();
    const now=realHeader.getBoundingClientRect(),dy=was.top-now.top,dxx=was.left-now.left;
    if(Math.abs(dy)>.5||Math.abs(dxx)>.5)real.animate([{translate:`${dxx}px ${dy}px`},{translate:'0px 0px'}],{duration:140*pace(),easing:EASE});
   };
   const observer=new MutationObserver(take);observer.observe(list,{childList:true,subtree:true,attributes:true,attributeFilter:['data-nested-group','style']});
   commit(s.action);
   window.setTimeout(()=>{if(done)return;done=true;observer.disconnect();if(model)room(model,null);window.setTimeout(finish,ms);},1500);
  },finish);
 };
 const abort=(reopen:()=>void,settled:()=>void)=>{cancelAnimationFrame(frame);cancelAnimationFrame(raf);wrapUp(reopen,settled);};
 return {move,land,suspend,abort,free:on=>{free=on;}};
}
