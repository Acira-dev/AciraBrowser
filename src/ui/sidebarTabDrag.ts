import { animate } from 'motion/react';
import type { BrowserAction } from '../runtime/types';
import { fillChipIcon } from './chipIcon';
import { liquidChip,liquidFork,liquidTargets,type LiquidTarget } from './liquidSnap';
import { motionPace } from './sharedMotion';
import { motionScale, morphSpring } from './splitMotion';
import './sidebarTabDrag.css';

type Point = {x:number;y:number};
/** A visual order only: the real tab order changes once, on release. */
export function previewTabOrder(ids:readonly string[],from:string,to:string,position:'before'|'after') {
  if(from===to||!ids.includes(from)||!ids.includes(to))return [...ids];
  const result=ids.filter(id=>id!==from),at=result.indexOf(to)+(position==='after'?1:0);
  result.splice(at,0,from);return result;
}

/** Full row inside the list/bookmarks, glass site icon everywhere else. Native page contents never resize. */
export function carrySidebarRow(row:HTMLElement,root:HTMLElement,grab:Point,activeWorkspace:string){
  const home=row.getBoundingClientRect(),scroll=row.closest<HTMLElement>('.sb-scroll'),scrollTop=scroll?.scrollTop??0,sidebar=row.closest<HTMLElement>('.acira-sidebar');
  const rows=[...root.querySelectorAll<HTMLElement>('.sb-tab:not(.sb-flip-ghost)')].filter(node=>node.getBoundingClientRect().height>0);
  // What makes room, each as one piece: a tab row, a split card (its panes go with it), a group's header, New tab. Only the rows
  // moved before, so a split card stood still while the rows and Bookmarks slid past it (founder, 30 Oct: "Split view" under "Bookmarks").
  const pieces=[...root.querySelectorAll<HTMLElement>('.sb-tab,.sb-split-group,.sb-group>.sb-group-header,.sb-new-tab')].filter(node=>node!==row&&!node.closest('.sb-flip-ghosts')&&!node.classList.contains('sb-flip-ghost')&&!(node.classList.contains('sb-tab')&&node.parentElement?.closest('.sb-split-group'))&&node.getBoundingClientRect().height>0);
  const following=scroll?[...scroll.children].filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==root&&!node.contains(root)&&node.getBoundingClientRect().top>=root.getBoundingClientRect().bottom-1):[];
  const boxes=new Map([row,...rows,...pieces,...following].map(node=>[node,node.getBoundingClientRect()]));
  // One row's room: its height and the space to the next piece.
  const pitch=(()=>{const tops=pieces.map(node=>boxes.get(node)!);const after=tops.filter(box=>box.top>home.top+1).sort((a,b)=>a.top-b.top)[0];if(after)return after.top-home.top;const before=tops.filter(box=>box.bottom<=home.top+1).sort((a,b)=>b.bottom-a.bottom)[0];return before?home.bottom-before.bottom:home.height;})();
  const moves=new Map<HTMLElement,{animation?:Animation;offset:number}>();
  const preview=document.createElement('div'),gap=document.createElement('div'),icon=document.createElement('span'),title=document.createElement('span');
  preview.className='tab-drag-preview sidebar-tab-drag-preview';preview.setAttribute('aria-hidden','true');preview.inert=true;
  gap.className='sidebar-tab-drag-gap';gap.setAttribute('aria-hidden','true');gap.inert=true;
  // Over the saved pages the tab's own place stays open as an empty slot (founder, 31 Oct): the copy that goes home recreates the
  // tab there, instead of being laid over a row that is still showing.
  const homeSlot=document.createElement('div');homeSlot.className='sidebar-tab-drag-gap sidebar-tab-home-slot';homeSlot.setAttribute('aria-hidden','true');homeSlot.inert=true;
  icon.className='sidebar-drag-icon';icon.append((row.querySelector('.sb-tab-icon')??row).cloneNode(true));
  title.className='sidebar-drag-title';title.textContent=row.querySelector('.sb-tab-title')?.textContent??row.getAttribute('aria-label')??'';
  preview.append(icon,title);fillChipIcon(preview,row.dataset.tabId);
  const host=row.closest<HTMLElement>('.app')??document.body,paint=getComputedStyle(row);
  const card=getComputedStyle(host);
  preview.style.color=host.dataset.appearance==='light'?(card.getPropertyValue('--tab-carry-fg').trim()||paint.color):paint.color;
  preview.style.setProperty('--surface',card.getPropertyValue('--tab-carry-bg').trim()||card.getPropertyValue('--surface'));
  preview.style.setProperty('--carry-font',paint.font);
  host.append(gap,homeSlot,preview);row.dataset.sidebarDragSource='';
  let pointer=grab,p=0,target=0,stop:(()=>void)|undefined,ended=false,projected:BrowserAction|null=null,bookmarkZone:HTMLElement|null=null,before:string|null=null,forkFrame:((now:number)=>void)|undefined,forkTargets:(()=>LiquidTarget[])|undefined;
  const delta=()=>scrollTop-(scroll?.scrollTop??0);
  const bounds=(node:HTMLElement)=>{const box=boxes.get(node);return box?new DOMRect(box.x,box.y+delta(),box.width,node.classList.contains('sb-tab')?box.height:node.getBoundingClientRect().height):laid(node);};
  // Where a node lies out, without the room this drag gave it: its own translate and its section's (a section still gliding back
  // put the slot that far off).
  const laid=(node:HTMLElement)=>{const box=node.getBoundingClientRect();let y=0;for(let at:HTMLElement|null=node;at&&at!==sidebar;at=at.parentElement){const t=getComputedStyle(at).translate;if(t!=='none')y+=parseFloat(t.split(' ').at(-1)!)||0;}return new DOMRect(box.x,box.y-y,box.width,box.height);};
  const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
  const liquid=liquidChip(preview,{exclude:row.dataset.tabId,targets:()=>forkTargets?forkTargets():liquidTargets(document,row.dataset.tabId),only:item=>item.node?.dataset.ws!==activeWorkspace,beforeFrame:now=>forkFrame?.(now),onFrame:()=>{if(!ended)place();}});
  const place=()=>{
    const mix=Math.max(0,Math.min(1,p)),lean=liquid.offset(),width=lerp(home.width,28,mix),height=lerp(home.height,28,mix);
    // The carried row stays under the grab point; the rows open their room around it.
    const rowY=pointer.y-(grab.y-home.top);
    const x=lerp(home.left+Math.max(-10,Math.min(10,pointer.x-grab.x)),pointer.x+lean.x-width/2,mix),y=lerp(rowY,pointer.y+lean.y-height/2,mix);
    Object.assign(preview.style,{width:width+'px',height:height+'px',transform:`translate3d(${x}px,${y}px,0)`});
    preview.style.setProperty('--chip-p',String(mix));preview.style.setProperty('--row-p',String(1-mix));
  };
  const shift=(node:HTMLElement,offset:number)=>{
    const previous=moves.get(node);if(previous?.offset===offset)return;
    if(!previous&&!offset)return;
    const from=getComputedStyle(node).translate;previous?.animation?.cancel();
    const duration=motionScale()?180*motionPace():0;
    const animation=node.animate([{translate:from==='none'?'0px 0px':from},{translate:`0px ${offset}px`}],{duration,easing:'cubic-bezier(.22,1,.36,1)',fill:'both'});
    moves.set(node,{animation,offset});node.dataset.dragRoom='';
  };
  // The slot glides with the rows that open it; it appears in place.
  const showGap=(box:{left:number;top:number;width:number;height:number}|null)=>{
    if(!box){gap.style.opacity='0';return;}
    const glide=gap.style.opacity==='1'&&motionScale()>0;
    gap.style.transition=glide?'transform 180ms cubic-bezier(.22,1,.36,1),width 180ms cubic-bezier(.22,1,.36,1)':'none';
    Object.assign(gap.style,{width:box.width+'px',height:box.height+'px',transform:`translate3d(${box.left}px,${box.top}px,0)`,opacity:'1'});
  };
  /** Saving a copy over Bookmarks: the tab list stays as it is, the row back in its place, and the saved pages open a slot under the pointer. */
  const projectBookmark=(zone:HTMLElement)=>{
    row.dataset.sidebarDragSource='';
    const own=bounds(row);Object.assign(homeSlot.style,{width:own.width+'px',height:own.height+'px',transform:`translate3d(${own.left}px,${own.top}px,0)`,opacity:'1'});
    const want=new Map<HTMLElement,number>([...moves.keys()].map(node=>[node,0]));
    const marks=[...zone.querySelectorAll<HTMLElement>('.sb-bookmark[data-bookmark-key]')].filter(node=>!node.closest('.sb-flip-ghosts')&&getComputedStyle(node).getPropertyValue('--sb-level').trim()==='0'&&node.offsetHeight>0);
    before=null;
    if(marks.length){
      const more=[...zone.querySelectorAll<HTMLElement>('.sb-bookmark-more')],zoneBottom=laid(zone).bottom;
      const after=scroll?[...scroll.children].filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==zone&&!node.contains(zone)&&laid(node).top>=zoneBottom-1):[];
      const boxesNow=marks.map(laid),room=boxesNow.length>1?boxesNow[1].top-boxesNow[0].top:boxesNow[0].height+2;
      const at=boxesNow.findIndex(box=>pointer.y<box.top+box.height/2),index=at<0?marks.length:at;
      before=index<marks.length?(marks[index].dataset.flip||'').replace(/^b:/,'')||null:null;
      marks.forEach((node,i)=>want.set(node,i>=index?room:0));
      for(const node of [...more,...after])want.set(node,room);
      const edge=index<marks.length?boxesNow[index].top:boxesNow[marks.length-1].top+room;
      showGap({left:boxesNow[0].left,top:edge,width:boxesNow[0].width,height:boxesNow[0].height});
    }
    // An empty Bookmarks section draws its own landing slot.
    else showGap(null);
    for(const [node,offset] of want)shift(node,offset);
  };
  const project=(action:BrowserAction|null)=>{
    projected=action;
    if(bookmarkZone){projectBookmark(bookmarkZone);return;}
    row.dataset.sidebarDragSource='';before=null;homeSlot.style.opacity='0';
    // The saved pages close their slot again.
    for(const [node] of [...moves])if(!pieces.includes(node)&&!following.includes(node))shift(node,0);
    const to=action?.type==='tab.drop'&&action.to?rows.find(node=>node.dataset.tabId===action.to):null;
    const anchor=to?(to.parentElement?.closest<HTMLElement>('.sb-split-group')??to):null;
    const own=!!anchor&&(anchor===row||anchor.contains(row));
    const box=anchor&&!own?bounds(anchor):null,homeTop=bounds(row).top;
    const after=action?.type==='tab.drop'&&action.position==='after';
    // Pieces after the row close up behind it; pieces from the drop line on open the row's room there. The two cancel out for
    // whatever lies past both, Bookmarks included, so nothing is left lying over anything.
    const line=box?(after?box.top+1:box.top):Infinity;
    for(const node of [...pieces,...following]){
      if(own){shift(node,0);continue;}
      const top=bounds(node).top;let offset=0;
      if(top>homeTop+1&&!node.contains(row))offset-=pitch;
      if(box&&top>=line&&(node===anchor||!node.contains(anchor!)))offset+=pitch;
      shift(node,offset);
    }
    if(!box){showGap(null);return;}
    const edge=(after?box.bottom+pitch-home.height:box.top)-((after?box.bottom:box.top)>homeTop+1?pitch:0);
    showGap({left:box.left,top:edge,width:box.width,height:home.height});
  };
  /** The layout of the list as laid out (no translate): it changes once the new order is in the page. */
  const layoutKey=()=>[row,...pieces].map(node=>node.isConnected?`${node.offsetTop}`:'x').join(',');
  /** The room this drag gave goes: the layout has it now. Each piece glides from where it is drawn to its laid-out place (a card's own
   *  margin is not a row's, so the room could be a few pixels off), and the sidebar's own slide of a moved row is dropped: it would
   *  have started from where the row was before this drag's room. */
  /** Where each moved piece was last drawn (settleInto notes it every frame): by the time the new order is in the page, its rect
   *  already has the new layout under this drag's room. */
  const painted=new Map<HTMLElement,number>();
  const notePainted=()=>{for(const node of moves.keys())if(node.isConnected)painted.set(node,node.getBoundingClientRect().top);};
  const settleRoom=()=>{
    const drawn=[...moves.keys()].map(node=>[node,painted.get(node)??node.getBoundingClientRect().top] as const);
    for(const [node,move] of moves){move.animation?.cancel();delete node.dataset.dragRoom;for(const animation of node.getAnimations())if(animation.id==='sb-flip')animation.cancel();}
    moves.clear();gap.remove();
    if(!motionScale())return;
    for(const [node,top] of drawn){if(!node.isConnected)continue;const d=top-node.getBoundingClientRect().top;if(Math.abs(d)>.5)node.animate([{translate:`0px ${d}px`},{translate:'0px 0px'}],{duration:140*motionPace(),easing:'cubic-bezier(.22,1,.36,1)'});}
  };
  const restoreRoom=()=>{for(const [node,move] of moves){move.animation?.cancel();delete node.dataset.dragRoom;if(move.offset)node.animate([{translate:`0px ${move.offset}px`},{translate:'0px 0px'}],{duration:motionScale()?180*motionPace():0,easing:'cubic-bezier(.22,1,.36,1)'});}moves.clear();gap.remove();};
  /** The carried row settles into `slot`. The frame the change is in the page (`ready`), the room goes (`onReady`: kept longer, it came
   *  on top of the new layout and the rows below slid on and snapped back) and the carried row heads for the real row's place
   *  (`goal`); once it is there, the real row takes over (`onDone`). */
  const settleInto=(slot:DOMRect,ready:()=>boolean,onReady:()=>void,goal:()=>DOMRect|null|undefined,onDone:()=>void,onTimeout:()=>void)=>{
    const scale=motionScale(),began=performance.now();let landed=!scale,done=false,flight:Animation|null=null;
    const fly=(to:DOMRect,duration:number)=>{
      const shown=getComputedStyle(preview),from={transform:shown.transform,width:shown.width,height:shown.height},end={transform:`translate3d(${to.left}px,${to.top}px,0)`,width:to.width+'px',height:to.height+'px'};
      flight?.cancel();Object.assign(preview.style,end);
      if(!scale||duration<=0){landed=true;return;}
      landed=false;const mine=preview.animate([from,end],{duration,easing:'cubic-bezier(.22,1,.36,1)'});flight=mine;
      mine.finished.then(()=>{if(flight===mine)landed=true;},()=>{});
    };
    preview.style.setProperty('--chip-p','0');preview.style.setProperty('--row-p','1');
    fly(slot,200);
    const finish=(ok:boolean)=>{if(done)return;done=true;
      // The real row is drawn from the next frame: the carried one stays over it until then.
      if(ok){onDone();requestAnimationFrame(()=>requestAnimationFrame(()=>preview.remove()));return;}
      // Nothing changed (the drop left the list as it was, or never arrived): the rows close the room and the row glides home.
      onTimeout();const back=row.getBoundingClientRect();fly(back,160);
      const home=()=>{delete row.dataset.sidebarDragSource;requestAnimationFrame(()=>preview.remove());};
      if(flight&&!landed)flight.finished.then(home,home);else home();};
    let readyAt=0;
    // The new order is taken over in the same task that puts it in the page, before it is ever drawn under this drag's room.
    const take=()=>{if(done||readyAt||!ready())return;readyAt=performance.now();observer.disconnect();onReady();const to=goal();if(to&&to.height>0&&(Math.abs(to.top-slot.top)>.5||Math.abs(to.left-slot.left)>.5||Math.abs(to.width-slot.width)>.5))fly(to,Math.max(90,200-(readyAt-began)));};
    const observer=new MutationObserver(take);observer.observe(sidebar??document.body,{childList:true,subtree:true});
    notePainted();
    const watch=()=>{if(done)return;
      take();if(!readyAt)notePainted();
      if(readyAt&&landed){finish(true);return;}
      if(performance.now()-began>(readyAt?1500:700)){observer.disconnect();finish(Boolean(readyAt));return;}
      requestAnimationFrame(watch);};
    requestAnimationFrame(watch);
  };
  place();
  return {
    bounds,
    /** The saved page this drop goes before (null: after the last one). */
    bookmarkBefore:()=>before,
    /** A bookmark is a copy, and the copy is made as liquid (founder, 31 Oct: "split down the middle", "each part turns into just the icon",
     *  "each icon, asynchronously, goes back to its place and expands"). The carried row splits down its middle as split view's glass does
     *  (liquidFork: the browser's gooey union of two rounded shapes, the neck stretching and letting go; the springs are the carried
     *  chip's own row -> chip morph, `tab.split`). Each half gives up its text and is the tab's icon on a small glass chip; one floats up
     *  to the tab's empty place and the other to the new saved row, a little apart in time, and each opens into its full row there
     *  (`tab.merge`). The real rows take over from the next frame. The glass is one WebGL layer (exact every frame); the icons and titles
     *  ride crisp above it, moved by transforms and opacity only. */
    bookmark(destination:()=>HTMLElement|null,onSettled:()=>void){
      if(ended)return;ended=true;stop?.();liquid.dispose();forkFrame=undefined;forkTargets=undefined;
      const scale=motionScale(),began=performance.now(),start=preview.getBoundingClientRect(),slot=gap.style.opacity==='1'?gap.getBoundingClientRect():start;
      const home=homeSlot.style.opacity==='1'?homeSlot.getBoundingClientRect():row.getBoundingClientRect();
      row.dataset.sidebarDragSource='';
      let arrived=false,cleaned=false,frameId=0,settledAt=0;
      const clocks:{stop():void}[]=[],faces:HTMLElement[]=[];
      // The saved row is in the page: the room made for it goes, and it is scrolled to if it lies out of sight.
      const arrive=()=>{const saved=destination();if(arrived||!saved)return;arrived=true;observer.disconnect();settleRoom();for(const animation of saved.getAnimations())animation.cancel();saved.scrollIntoView({block:'nearest'});};
      const observer=new MutationObserver(arrive);observer.observe(sidebar??document.body,{childList:true,subtree:true});
      let material:ReturnType<typeof liquidFork>=null;
      const clean=()=>{if(cleaned)return;cleaned=true;cancelAnimationFrame(frameId);observer.disconnect();for(const clock of clocks)clock.stop();if(!arrived)restoreRoom();onSettled();delete row.dataset.sidebarDragSource;material?.dispose();preview.remove();for(const node of faces)node.remove();homeSlot.remove();gap.remove();};
      // Motion off: the saved row simply appears, the tab row stays.
      if(!scale){clean();return;}
      // The same material as split view, resolved against this sidebar's tone.
      const tones=getComputedStyle(row),canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const ctx=canvas.getContext('2d');let fill='#2b2c30';
      if(ctx){for(const value of [tones.getPropertyValue('--sidebar-rgb').trim()||tones.getPropertyValue('--chrome-rgb').trim(),tones.backgroundColor,'rgb(255 255 255 / .04)']){ctx.fillStyle=/^\d/.test(value)?`rgb(${value.replace(/,/g,' ')})`:value;ctx.fillRect(0,0,1,1);}const c=ctx.getImageData(0,0,1,1).data;fill=`rgb(${c[0]} ${c[1]} ${c[2]})`;}
      material=liquidFork(host,fill);
      const W=start.width,H=start.height,CHIP=28;
      type Rect={left:number;top:number;width:number;height:number};
      type Half={node:HTMLElement;glyph:HTMLElement;text:HTMLElement};
      /** Where the real row keeps its icon and title (a saved row is nested: its icon sits further in), so the handoff changes nothing. */
      type Inner={icon:number;title:number;width:number};
      const inner=(el:HTMLElement|null|undefined,r:Rect):Inner=>{const icon=el?.querySelector('.sb-tab-icon')?.getBoundingClientRect(),title=el?.querySelector('.sb-tab-title')?.getBoundingClientRect();return {icon:icon&&icon.width?icon.left-r.left+(icon.width-16)/2:8,title:title&&title.width?title.left-r.left:32,width:title&&title.width?title.width:Math.max(0,r.width-40)};};
      const half=(width:number):Half=>{
        const node=preview.cloneNode(true) as HTMLElement;node.classList.add('sidebar-bookmark-copy','sidebar-split-face');
        node.getAnimations().forEach(a=>a.cancel());node.style.setProperty('--chip-p','0');node.style.setProperty('--row-p','1');
        // fillChipIcon may have put its picture in front of the copied icon: one icon only.
        if(!node.firstElementChild?.classList.contains('sidebar-drag-icon'))node.querySelector('.sidebar-drag-icon')?.remove();
        const glyph=node.firstElementChild as HTMLElement,text=node.querySelector<HTMLElement>('.sidebar-drag-title')!;
        Object.assign(text.style,{width:(width-40)+'px',height:H+'px',lineHeight:H+'px'});
        if(material)node.classList.add('sidebar-liquid-face');
        host.append(node);faces.push(node);return {node,glyph,text};
      };
      const first=half(W),second=half(W);
      preview.style.visibility='hidden';
      const ease=(value:number)=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
      const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
      const box=(r:Rect)=>({left:r.left,top:r.top,right:r.left+r.width,bottom:r.top+r.height});
      // One clock per movement, all on the motion system's own curves: the split and the collapse are the carried row's row -> chip
      // spring (tab.split), the open is its chip -> row spring (tab.merge), the flights glide on the drag family's expo-out. Each icon
      // has its own delay, so the two are never in step.
      const P={split:0,fold:0,flyA:0,flyB:0,openA:0,openB:0};
      const pace=Math.min(scale,1.4),spring=(token:'tab.split'|'tab.merge')=>morphSpring(token,scale),glide={duration:.34*pace,ease:[.22,1,.36,1] as [number,number,number,number]};
      const run=(key:keyof typeof P,options:object,delay:number)=>{clocks.push(animate(0,1,{...options,delay:delay*pace,onUpdate:value=>{P[key]=value;},onComplete:()=>{P[key]=1;}}));};
      run('split',spring('tab.split'),0);run('fold',spring('tab.split'),.05);
      run('flyA',glide,.15);run('flyB',glide,.22);
      run('openA',spring('tab.merge'),.36);run('openB',spring('tab.merge'),.43);
      const grown={a:false,b:false};let endA:Inner|null=null,endB:Inner|null=null,inked=false;
      // Where one half is this frame: its chip (the half shrunk about its own centre, flown to its landing) opened into its row.
      const draw=(part:Half,late:boolean,from:{x:number;y:number},at:Rect,end:Inner,fly:number,fold:number,open:number,grow:'a'|'b')=>{
        const land={x:at.left+end.icon+8,y:at.top+at.height/2},wide=lerp(W/2,CHIP,fold),tall=lerp(H,CHIP,fold);
        const lift=Math.sin(Math.PI*Math.max(0,Math.min(1,fly)))*9,cx=lerp(from.x,land.x,fly),cy=lerp(from.y,land.y,fly)-lift;
        const r:Rect={left:lerp(cx-wide/2,at.left,open),top:lerp(cy-tall/2,at.top,open),width:lerp(wide,at.width,open),height:lerp(tall,at.height,open)};
        if(open>0&&!grown[grow]){grown[grow]=true;part.text.style.width=end.width+'px';}
        const base=late?(wide-16)/2:lerp(8,(wide-16)/2,fold);
        Object.assign(part.node.style,{transform:`translate3d(${r.left.toFixed(3)}px,${r.top.toFixed(3)}px,0)`,width:r.width.toFixed(3)+'px',height:r.height.toFixed(3)+'px',opacity:'1'});
        part.glyph.style.transform=`translate3d(${lerp(base,end.icon,open).toFixed(3)}px,${((r.height-16)/2).toFixed(3)}px,0)`;
        part.glyph.style.opacity=late?String(ease((fold-.15)/.5)):'1';
        // Before the open the title is the half of the row the cut left; after it, the row's own.
        const shown=open>0?ease((open-.4)/.5):1-Math.max(0,Math.min(1,fold*2.5));
        part.text.style.transform=`translate3d(${open>0?end.title:late?32-W/2:32}px,${((r.height-H)/2).toFixed(3)}px,0)`;part.text.style.opacity=String(shown);
        return r;
      };
      const frame=(now:number)=>{
        if(cleaned)return;arrive();
        const saved=destination(),to=saved&&saved.getBoundingClientRect().width?saved.getBoundingClientRect():slot,tab=row.isConnected&&row.offsetHeight?row.getBoundingClientRect():home;
        const mid=start.top+H/2,apart=7*P.split;
        // Measured every frame: a saved row's nesting settles as its section opens, and the handoff must land on where it ends up.
        endA=inner(row.isConnected?row:null,tab);endB=inner(saved,to);
        // A page that is open in a tab reads at full ink in its saved row: the copy takes that ink as it arrives.
        if(saved&&!inked){inked=true;const ink=getComputedStyle(saved).getPropertyValue('--sb-fg').trim();if(ink&&saved.hasAttribute('data-open')){second.node.style.transition='color 220ms';second.node.style.color=ink;}}
        const a=draw(first,false,{x:start.left+W/4-apart,y:mid},tab,endA!,P.flyA,P.fold,P.openA,'a');
        const b=draw(second,true,{x:start.left+W*3/4+apart,y:mid},to,endB!,P.flyB,P.fold,P.openB,'b');
        const done=P.openA>=.985&&P.openB>=.985;if(done&&!settledAt)settledAt=now;
        material?.draw(box(a),box(b),1-ease((P.split-.12)/.7),settledAt?1-ease((now-settledAt)/(140*scale)):1);
        if(settledAt&&now-settledAt>=140*scale&&arrived){clean();return;}
        if(now-began>(2.2*scale+1.5)*1000){clean();return;}
        frameId=requestAnimationFrame(frame);
      };
      frame(performance.now());
    },
    move(point:Point,full:boolean,action:BrowserAction|null,bookmarks:HTMLElement|null=null){
      if(ended)return;pointer=point;
      // Between the list and the saved pages (a separator, a section's edge) nothing changes: re-arranging there moved the sections
      // under the pointer and back.
      if(!full||action||bookmarks){bookmarkZone=full?bookmarks:null;project(full?action:null);}
      const next=full?0:1;liquid.point(point,!full);
      if(next!==target){target=next;stop?.();const scale=motionScale();if(!scale)p=next;else{const controls=animate(p,next,{...morphSpring(next?'tab.split':'tab.merge',scale),onUpdate:value=>{p=value;place();}});stop=()=>controls.stop();}}
      place();
    },
    end(destination?:HTMLElement|null,committed=false,handOver=false){
      if(ended)return;ended=true;stop?.();homeSlot.remove();
      liquid.end(Boolean(destination));
      const clean=()=>{preview.remove();delete row.dataset.sidebarDragSource;};
      // A drop in the list: the rows keep the room they made until the new order is laid out, then the layout has it (no snap back
      // to the old order while the change travels, founder, 30 Oct: "a delay when dropping").
      if(committed&&!destination&&!handOver&&gap.style.opacity==='1'){
        const slot=gap.getBoundingClientRect(),was=layoutKey();
        settleInto(slot,()=>layoutKey()!==was,settleRoom,()=>row.isConnected?row.getBoundingClientRect():null,()=>{delete row.dataset.sidebarDragSource;},restoreRoom);
        return projected;
      }
      if(committed&&!destination&&!handOver&&moves.size){
        // The tab leaves the list (another workspace, Favorites): the rows hold their closed-up places until it is gone.
        const was=layoutKey();liquid.dispose();gap.remove();
        const watch=(began:number)=>{if(layoutKey()!==was){settleRoom();return;}if(performance.now()-began>1500){restoreRoom();return;}requestAnimationFrame(()=>watch(began));};
        requestAnimationFrame(()=>watch(performance.now()));
      }
      else restoreRoom();
      if(handOver){clean();return projected;}
      requestAnimationFrame(()=>{
        if(!preview.isConnected)return;
        // The row is gone when its sidebar hid during the drag: the icon fades where it was dropped instead of flying to a place that is no longer there.
        const gone=!destination&&!row.isConnected,rect=destination?.getBoundingClientRect()??(gone?preview.getBoundingClientRect():row.getBoundingClientRect()),small=Boolean(destination),scale=motionScale();
        const animation=preview.animate([{transform:preview.style.transform,width:preview.style.width,height:preview.style.height,opacity:1},{transform:`translate3d(${rect.left+(small?(rect.width-28)/2:0)}px,${rect.top+(small?(rect.height-28)/2:0)}px,0) scale(${small?.35:1})`,width:(small?28:rect.width)+'px',height:(small?28:rect.height)+'px',opacity:small||gone?0:1}],{duration:scale?small?200:160:0,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'});
        animation.finished.then(clean,clean);
        if(destination&&scale){const glyph=destination.querySelector('.sb-ws-icon')??destination;glyph.animate([{transform:'scale(1) rotate(0deg)'},{transform:'scale(1.14) rotate(-5deg)',offset:.3},{transform:'scale(.96) rotate(3deg)',offset:.62},{transform:'scale(1.03) rotate(-1deg)',offset:.82},{transform:'scale(1) rotate(0deg)'}],{duration:380*motionPace(),easing:'ease-out'});}
      });
      return projected;
    },
  };
}

/** Empty space below Bookmarks is travel space, even when it is still inside the sidebar. */
export function sidebarRowArea(point:Point,sidebar:HTMLElement|null,wasFull=true,measure:(node:HTMLElement)=>DOMRect=node=>node.getBoundingClientRect()){
  if(!sidebar)return false;
  const edge=sidebar.getBoundingClientRect(),zones=[...sidebar.querySelectorAll<HTMLElement>('.sb-tabs,[data-zone=bookmarks],.sb-bookmarks-peek,.sb-apps')].map(measure).filter(box=>box.height>0);
  const bottom=Math.max(edge.top,...zones.map(box=>box.bottom)),pad=wasFull?8:0;
  return point.x>=edge.left-pad&&point.x<=edge.right+pad&&point.y>=edge.top&&point.y<=bottom+pad;
}
