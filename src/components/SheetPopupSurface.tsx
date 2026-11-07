import {motion,usePresence} from 'motion/react';
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type CSSProperties} from 'react';
import type {PopupSurfaceProps} from './PopupSurface';
import {runtime} from '../runtime/client';
import {designTokens} from '../ui/designSystem';
import {popupMorphMilliseconds} from '../ui/popupTransition';
import {formationDialogMs,formationFrames,formationLayerFrames,formationLayerPaint,formationOpenMs,restingFormation,type FormationPaint} from '../ui/sheetFormation';
import {tabViewerTokens} from '../ui/theme';
import {frequentScale,kick,motionScaleOf,motionSpeed,springEasing,springFor,springNow,type MotionTokenId} from '../ui/sharedMotion';
import {usePopupBackdrop,type BackdropVideo} from '../ui/usePopupBackdrop';
import {keyboardInput} from '../ui/inputModality';
import {popupMaterialProvider} from '../ui/popupMaterial';
import {pickRowFor} from './popupPick';
import {centreOutDelays,centreOutPull,springCurve,tabViewerOrigin,tabViewerScale} from '../ui/tabViewerMotion';
import '../styles/popup-sheet.css';

function BackdropSources({videos}:{videos:BackdropVideo[]}) {
  const root=useRef<HTMLDivElement>(null);
  const mounted=useRef(new Set<HTMLVideoElement|HTMLCanvasElement>());
  useLayoutEffect(()=>{
    const node=root.current;if(!node)return;
    const wanted=new Set(videos.map(item=>item.frame??item.video).filter(Boolean));
    for(const video of mounted.current)if(!wanted.has(video)){video.remove();mounted.current.delete(video);}
    for(const item of videos){
      const {source}=item,video=item.frame??item.video;if(!video)continue;
      video.className='popup-backdrop-video';
      video.dataset.popupSource=JSON.stringify(source);video.dataset.popupSourceBounds=JSON.stringify(source.bounds);video.dataset.popupSourceFrame=item.frame?'frozen':'decoding';
      Object.assign(video.style,{left:`calc(${source.bounds.x}px - var(--popup-x) + 64px)`,top:`calc(${source.bounds.y}px - var(--popup-y) + 64px)`,width:`${source.bounds.width}px`,height:`${source.bounds.height}px`,borderRadius:`${source.sourceBounds?0:source.radius}px`});
      // Preserve the same frozen canvas while closing/reversing. A decoding
      // video stays connected until its local canvas replaces it.
      if(video.parentNode!==node)node.append(video);mounted.current.add(video);
    }
  },[videos]);
  useLayoutEffect(()=>()=>{for(const video of mounted.current)video.remove();mounted.current.clear();},[]);
  return <div className="popup-backdrop-sources" ref={root}/>;
}

// Frequent popups (right-click menus, palette, Ctrl+Tab, suggestions, find, zoom) and keyboard-opened ones skip the haze,
// never the motion (founder rule: quick but beautiful, never zero): the glass settles in 110ms from the input frame and the
// rows run the short cascade (below). Reduced motion (Animation speed None) is a cut, no fade; closes finish within the native retirement budget.
const quickOpenMs=110,reducedOpenMs=0,closeMs=130;   // None (Reduce motion) opens at once: 0 (it was a 90ms fade until 6 Nov)
// R4-17: the tab viewer (Alt+T or its toolbar button) keeps a visible formation at every speed except Off (Premium ≈325 /
// 240 ms perceptual, Fast ≈0.6× of that); the glass is dense from the input frame. Founder, 27 Oct ("let it open from center
// outwards"; tabViewerMotion.ts): no aperture and no top-down cascade any more. The plane scales up from 96% around the
// sheet's centre on the `tabViewer.open` spring (with the launch kick), whatever opened it, while the rows form from the
// middle outwards; the close scales back into the centre on `tabViewer.close`. The plan lasts as long as the spring settles.
const tabViewerSpring=(opening:boolean)=>{const speed=motionSpeed(),spec=springFor(opening?'tabViewer.open':'tabViewer.close',speed);return spec?springCurve(spec,opening?kick[speed]*Math.PI*2/spec.duration:0):null;};
const instantPopupKinds=new Set(["switcher","palette","suggestions","find","zoom","tab-context","group-context","split-context","strip-context","bookmark-context","toolbar-context","group-preview"]);
// A native glass sheet primes its decoded still before the first visible frame.
// Acquisition is independent of motion; cold acquisition latency is measured
// separately from the formation, never disguised as an opaque opening plate.
// A fresh sheet also waits (bounded) for its measured height to reach the layout, so it never opens at an estimate and
// resizes a frame later. Exact estimates make this wait zero; it only absorbs drift and content that loads its data.
const sizeWaitMs=120;
/** One reversible lifecycle restores the original blur-to-focus foreground. */
// A pointer pick on a menu row (founder videos, 25 Oct; the macOS pattern): the row blinks its highlight for 80ms, then
// its action runs and the menu fades out in 100ms ease-out. Rows that expand, toggle or open a submenu are not picks.
const pickHoldMs=80;
const replaying=new WeakSet<Element>();
// The signature open (round 2, founder: "things could load sequentially ... this vapor type thing ... fast enough for it
// not to be slow"; 26 Oct: "a bit slower maybe, smoother, not clippy"). On the input frame the glass condenses (the
// formation: veil from .7, scale from .985, the frost thickening out of the material's mist); the rows then form one
// after another away from the anchor, each resolving out of its own haze: a copy of the row with a fixed 4px blur fades
// out as the sharp row fades in and rises 3px into place, 120ms each, on a 14ms stagger whose whole cascade is capped at
// 90ms however long the list, so the first row reads by ~40ms and the menu is settled by ~220ms. Nothing is ever clipped:
// the sheet keeps its full silhouette from the first frame. Separators and section labels ride with the row below them.
// Frequent and keyboard-opened popups run the short cascade (8ms, capped at 60ms, 100ms rows) without the haze. GPU only:
// every row animates its own opacity and transform, and a haze row is a small layer whose blur is fixed, never animated
// (bible §3.9); the copy is removed when the cascade ends.
const cascadeTiming={signature:{stagger:14,cap:90,row:120},quick:{stagger:8,cap:60,row:100}},hazeBlurPx=4,cascadeRise=3,cascadeEase='cubic-bezier(.16,1,.3,1)';
const rowLike='button,a,input,select,textarea,label,details,hr,h1,h2,h3,h4,p,[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=separator],.menu-row,.acira-menu-row,.tab-result-row,.palette-row';
const riders='hr,[role=separator],.acira-menu-sep,.menu-sep,.acira-sep,.palette-section,[class*=section-label],[class*=menu-label]';
/** A popup's rows in reading order: its header and search, then its body flattened through wrappers and groups. A
 * separator or section label joins the row after it (a trailing one joins the last row). */
function cascadeRows(contents:HTMLElement,footer=false):HTMLElement[][]{
  const groups:HTMLElement[][]=[],pending:HTMLElement[]=[];
  const shown=(el:Element):el is HTMLElement=>el instanceof HTMLElement&&!el.hasAttribute('data-motion-skip')&&el.getClientRects().length>0;
  const add=(el:HTMLElement)=>{if(el.matches(riders)&&!el.querySelector(rowLike)){pending.push(el);return;}groups.push([...pending.splice(0),el]);};
  const walk=(el:HTMLElement,depth:number)=>{for(const child of el.children){if(groups.length>=40)return;if(!shown(child))continue;if(depth<5&&!child.matches(rowLike)&&child.querySelector(rowLike))walk(child,depth+1);else add(child);}};
  for(const fixed of contents.querySelectorAll<HTMLElement>('.popup-header,.popup-fixed-search'))if(shown(fixed))add(fixed);
  const body=contents.querySelector<HTMLElement>('.popup-body-content');if(body)walk(body,0);
  // The tab viewer's centre-out formation also brings in its fixed footer (New tab), on the edge's delay.
  if(footer)for(const fixed of contents.querySelectorAll<HTMLElement>('.popup-fixed-footer'))if(shown(fixed))add(fixed);
  if(pending.length){if(groups.length)groups[groups.length-1].push(...pending);else groups.push(pending.splice(0));}
  return groups;
}
// The first haze in a renderer pays for its blurred layers while the cold open is already busy (first layout, material
// decode): measured cold worst frame 53–120ms with it, 40–53ms without. So the cold open runs the cascade without the
// haze, and once it has settled a tiny invisible blurred layer warms that path while the menu is read; every later open
// has the full vapor at no extra frame cost.
let hazeWarm=false;
function warmHaze(plane:HTMLElement){if(hazeWarm||plane.closest('[data-popup-warmup]'))return;/* the overlay's idle dry run (App.tsx OverlayWarmup) is never painted, so it must not mark the blurred-layer path warm */hazeWarm=true;const dot=document.createElement('div');dot.setAttribute('aria-hidden','true');dot.style.cssText=`position:absolute;left:30px;top:30px;width:12px;height:12px;background:currentColor;filter:blur(${hazeBlurPx}px);opacity:.01;pointer-events:none`;plane.append(dot);dot.animate([{opacity:.01},{opacity:.02}],{duration:48}).finished.then(()=>dot.remove(),()=>dot.remove());}
// centreOut (the tab viewer, tabViewerMotion.ts): each row's delay grows with its distance from the sheet's centre and it
// starts a little nearer the centre, so the rows bloom outwards from the middle; never top to bottom.
function cascade(plane:HTMLElement,{haze:wanted,quick,upward,scale=1,centreOut=false}:{haze:boolean;quick:boolean;upward:boolean;scale?:number;centreOut?:boolean}):()=>void{
  const haze=wanted&&hazeWarm;
  const sharp=plane.querySelector<HTMLElement>(':scope > .popup-contents:not([data-vapor-layer])');if(!sharp)return()=>{};
  const base=quick?cascadeTiming.quick:cascadeTiming.signature,timing={stagger:base.stagger*scale,cap:base.cap*scale,row:base.row*scale},order=(groups:HTMLElement[][])=>upward?groups.reverse():groups;
  const rows=centreOut?cascadeRows(sharp,true):order(cascadeRows(sharp));if(!rows.length)return()=>{};
  const step=rows.length>1?Math.min(timing.stagger,timing.cap/(rows.length-1)):0,lift=`translateY(${cascadeRise}px)`,animations:Animation[]=[];
  let delays=rows.map((_,i)=>Math.round(i*step)),lifts=rows.map(()=>lift);
  if(centreOut){
    const box=sharp.getBoundingClientRect(),middle=box.top+box.height/2;
    const offsets=rows.map(group=>{let top=Infinity,bottom=-Infinity;for(const el of group){const rect=el.getBoundingClientRect();top=Math.min(top,rect.top);bottom=Math.max(bottom,rect.bottom);}return Number.isFinite(top)?(top+bottom)/2-middle:0;});
    delays=centreOutDelays(offsets,box.height/2,timing.cap);lifts=offsets.map(offset=>`translateY(${centreOutPull(offset)}px)`);
  }
  // While the rows form, the plane says so: their rise (and the haze copy) briefly overflow the list, and the menu's
  // scroll cue must not read that as a list that scrolls (panels.css).
  plane.dataset.forming='';
  rows.forEach((group,i)=>{for(const el of group)animations.push(el.animate([{opacity:0,transform:lifts[i]},{opacity:1,transform:'none'}],{duration:timing.row,delay:delays[i],easing:cascadeEase,fill:'backwards'}));});
  // The input frame carries only the glass and the rows' start; the haze copy is built one frame later, its rows in step
  // with the sharp ones (negative delays), so the first frame presents as early as it can.
  let copy:HTMLElement|null=null,frame=0,ended=false;const startedAt=performance.now();
  const end=()=>{if(ended)return;ended=true;cancelAnimationFrame(frame);for(const animation of animations)animation.cancel();copy?.remove();delete plane.dataset.forming;if(wanted&&plane.isConnected)warmHaze(plane);};
  const settle=()=>{Promise.all(animations.map(animation=>animation.finished)).then(end,end);};
  const addHaze=()=>{
    if(ended||!sharp.isConnected)return;
    // The haze is a copy pinned to the sharp content's own box, so every haze row sits exactly on its row.
    copy=sharp.cloneNode(true) as HTMLElement;copy.dataset.vaporLayer='';copy.classList.add('popup-vapor');copy.setAttribute('aria-hidden','true');copy.inert=true;
    copy.style.cssText+=`;position:absolute;left:${sharp.offsetLeft}px;top:${sharp.offsetTop}px;width:${sharp.offsetWidth}px;height:${sharp.offsetHeight}px`;
    for(const el of copy.querySelectorAll('[id],[autofocus],[tabindex],a,button,input,textarea,select')){el.removeAttribute('id');el.removeAttribute('autofocus');el.setAttribute('tabindex','-1');}
    sharp.after(copy);
    const elapsed=performance.now()-startedAt;
    (centreOut?cascadeRows(copy,true):order(cascadeRows(copy))).forEach((group,i)=>{if(i>=delays.length)return;for(const el of group){el.style.filter=`blur(${hazeBlurPx}px)`;animations.push(el.animate([{opacity:.7,transform:lifts[i]},{opacity:0,transform:'none'}],{duration:timing.row,delay:Math.round(delays[i]-elapsed),easing:cascadeEase,fill:'both'}));}});
    settle();
  };
  if(haze)frame=requestAnimationFrame(addHaze);else settle();
  return end;
}
// The aperture (R3-26, research §5.4): a pointer-opened panel grows out of the corner nearest its trigger as a rounded clip
// that widens on the `menu.grow` / `popover.grow` spring (Premium ×1.7, with the launch kick), and closes back into it on
// `menu.shrink`. The material and the text stay at their final size, never scaled; the glass condense and the row vapor run
// as before inside it. The clip is relative to the plane (the panel plus 24px on every side) and ends 80px beyond it, so the
// panel's own shadow, which reaches further than the plane, is revealed as the aperture passes the panel's edge and never
// cut. Opening continues from a running close (and the other way round) from the clip as it is drawn.
// `pad` is how far the clipped element's box reaches around the panel: 24px for the plane, 0 for a local sheet's glass, text and
// mist, which clip themselves (the plane of a local sheet must stay unclipped, see the formation effect).
const apertureSeed=28,apertureRadius=8,apertureReach=104;
function apertureAnimation(node:HTMLElement,{width,height,origin,opening,centered,previous,tabViewer=false,pad=24}:{width:number;height:number;origin:{x:number;y:number};opening:boolean;centered:boolean;previous:Animation|null;tabViewer?:boolean;pad?:number}):Animation|null{
  const speed=motionSpeed(),token:MotionTokenId=tabViewer?(opening?'tabViewer.open':'tabViewer.close'):opening?(centered?'popover.grow':'menu.grow'):'menu.shrink',spec=springFor(token,speed);
  if(!spec)return null;
  const W=width+2*pad,H=height+2*pad,cx=pad+origin.x*width,cy=pad+origin.y*height,half=apertureSeed/2,px=(value:number)=>`${Math.round(value*100)/100}px`,reach=px(pad-apertureReach);
  const seed=`inset(${px(cy-half)} ${px(W-cx-half)} ${px(H-cy-half)} ${px(cx-half)} round ${apertureRadius}px)`,apertureEnd=`inset(${reach} ${reach} ${reach} ${reach} round ${apertureRadius}px)`;
  const running=previous&&previous.playState==='running'?getComputedStyle(node).clipPath:'none';
  const from=running&&running!=='none'?running:opening?seed:apertureEnd,to=opening?apertureEnd:seed;
  const velocity=opening?kick[speed]*Math.PI*2/spec.duration:0,{duration,easing}=springEasing(spec,1,velocity);
  return node.animate([{clipPath:from},{clipPath:to}],{duration,easing,fill:'both'});
}
export function SheetPopupSurface({geometry,state,sceneKey,native=false,closing=false,overlayId,appearance,sizePending=false,keyboard=false,from,children}:PopupSurfaceProps) {
  // Selection can publish a new page context before the host close arrives.
  // Record departure before the callback so this frozen glass can finish exiting.
  const [departingScene,setDepartingScene]=useState<string>();
  const [sharpOnly,setSharpOnly]=useState(()=>matchMedia('(forced-colors: active), (prefers-contrast: more)').matches);
  useEffect(()=>{const media=matchMedia('(forced-colors: active), (prefers-contrast: more)'),update=()=>setSharpOnly(media.matches);media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const [present,safeToRemove]=usePresence(),inactive=closing||!present||departingScene===sceneKey,reduced=state.settings.reducedMotion||sharpOnly;
  const root=useRef<HTMLDivElement>(null),plane=useRef<HTMLDivElement>(null),material=useRef<HTMLDivElement>(null),mist=useRef<HTMLDivElement>(null),formed=useRef(false),lastScene=useRef(sceneKey),phase=useRef<'hidden'|'opening'|'open'|'closing'>('hidden'),finish=useRef(()=>{}),vapor=useRef(()=>{}),painted=useRef<FormationPaint>({}),apertureRef=useRef<Animation|null>(null);
  const pendingPick=useRef<{row:HTMLElement;timer:ReturnType<typeof setTimeout>}|null>(null),pickContext=useRef({inactive,sceneKey});
  pickContext.current={inactive,sceneKey};
  const cancelPick=useCallback(()=>{const pending=pendingPick.current;if(!pending)return;clearTimeout(pending.timer);delete pending.row.dataset.picked;pendingPick.current=null;if(root.current)delete root.current.dataset.pick;},[]);
  useLayoutEffect(()=>{if(inactive)cancelPick();return cancelPick;},[inactive,sceneKey,cancelPick]);
  useEffect(()=>{if(!present&&reduced)safeToRemove?.();},[present,reduced,safeToRemove]);
  useEffect(()=>()=>vapor.current(),[]);
  const [ready,setReady]=useState(false),[interactive,setInteractive]=useState(false),[settled,setSettled]=useState(false);
  const context=[state.activeBrowserProfileId,state.activeTabId,state.windowUi.split?.tabIds.join(','),state.settings.interfaceScale].join(':');
  const primedContext=useRef(context),contextPrimed=primedContext.current===context,visibleReady=ready&&(contextPrimed||inactive);
  const backdrop=usePopupBackdrop({id:overlayId,enabled:native&&!state.settings.reducedTransparency,closing:inactive,context});
  const provider=popupMaterialProvider({native,reducedTransparency:state.settings.reducedTransparency,status:backdrop.status,opaque:backdrop.opaque,visible:visibleReady});
  useLayoutEffect(()=>{
    if(contextPrimed||inactive)return;
    // A new context cannot display the old frozen pixels or an opaque warming
    // plate. Re-prime before its first visible frame; an old close may finish.
    primedContext.current=context;vapor.current();formed.current=false;painted.current={};phase.current='hidden';setReady(false);setInteractive(false);setSettled(false);
  },[context,contextPrimed,inactive]);
  const [sizeLate,setSizeLate]=useState(false);
  useEffect(()=>{setSizeLate(false);if(!sizePending||inactive)return;const timer=setTimeout(()=>setSizeLate(true),sizeWaitMs);return()=>clearTimeout(timer);},[sizePending,inactive,overlayId]);
  const materialReady=(contextPrimed||inactive)&&provider!=='pending'&&(ready||!sizePending||sizeLate);
  useLayoutEffect(()=>{
    if(inactive||!materialReady)return;
    let cancelled=false,frame=0;
    const waitForBox=()=>new Promise<void>(resolve=>{let frames=0;const check=()=>{const node=root.current;if(cancelled||!node||frames++>=3||Math.abs(node.offsetHeight-geometry.bounds.height)<1&&Math.abs(node.offsetWidth-geometry.bounds.width)<1)resolve();else frame=requestAnimationFrame(check);};check();});
    const prepare=async()=>{
      const layer=provider==='native'?'native':'renderer';
      // Captured renderer material has already decoded and frozen. Native
      // fallback still primes its material/content handshake before reveal.
      // A local sheet must also wait for Motion to commit its measured box;
      // otherwise its first visible frame still has the old estimate.
      if(layer==='renderer'){if(!native&&!ready)await waitForBox();if(cancelled)return;setReady(true);if(native&&overlayId!==undefined)void(async()=>{if(await runtime.overlayReady?.(overlayId,'material',layer))await runtime.overlayReady?.(overlayId,'content',layer);})();return;}
      if(native&&overlayId!==undefined&&!await runtime.overlayReady?.(overlayId,'material',layer))return;
      if(cancelled)return;
      if(native&&overlayId!==undefined&&!await runtime.overlayReady?.(overlayId,'content',layer))return;
      // motion applies a new box a frame after the layout arrives: reveal once the sheet is drawn at that size (a few frames at most).
      if(!ready)await waitForBox();
      if(!cancelled)setReady(true);
    };
    void prepare();
    return()=>{cancelled=true;cancelAnimationFrame(frame);};
  },[native,overlayId,inactive,materialReady,provider,geometry.bounds.x,geometry.bounds.y,geometry.bounds.width,geometry.bounds.height]);
  useLayoutEffect(()=>{
    const node=plane.current;if(!node)return;
    // Rows resolve away from the anchor: downward menus top-first, upward ones bottom-first.
    const found=[...node.querySelectorAll<HTMLElement>('.popup-header,.popup-fixed-search,.popup-body-content>*')].slice(0,48),items=geometry.origin.y===1?found.reverse():found;
    items.forEach(item=>{item.dataset.sheetItem='';});
    return()=>items.forEach(item=>{delete item.dataset.sheetItem;});
  },[sceneKey,geometry.origin.y]);
  useLayoutEffect(()=>{
    const node=plane.current,surface=material.current,haze=mist.current;if(!node||!surface||!haze||!visibleReady)return;
    const switching=lastScene.current!==sceneKey&&formed.current&&!inactive,reversing=phase.current==='closing'&&!inactive;lastScene.current=sceneKey;
    const start:FormationPaint={...restingFormation,...painted.current};
    // Design bible §3.9: keyboard-paced and 100x/day surfaces (right-click menus, tab search, palette, suggestions,
    // find, zoom) get the short open; toolbar popups condense from their anchor. Keyboard-dismissed popups leave at once;
    // a picked row's menu fades on the close curve.
    const kind=sceneKey.split(":").pop()||"",tabViewer=kind==='tabs'&&!reduced,instant=instantPopupKinds.has(kind),pick=root.current?.dataset.pick,keyed=!tabViewer&&(inactive?keyboardInput()&&pick!=='pointer'&&pick!=='selection':keyboard),quiet=reduced||instant||keyed||!tabViewer&&inactive&&pick==='pointer';
    if(!inactive&&root.current)delete root.current.dataset.pick;
    // A local sheet's glass is dense and frosted from the input frame, so its rows must read at once too: an empty frosted plate
    // growing from the trigger for the length of the signature cascade (stretched by the animation speed) read as a glitch.
    const centered=geometry.origin.x===.5&&geometry.origin.y===.5,quick=!inactive&&!reduced&&(instant||keyed||provider==='css');
    // The animation-speed setting (R3-17) stretches every duration here: Premium 1.7x, Fast 1x (the timings from before the
    // setting), Off is the reduced path. Frequent and keyboard-opened popups take only part of the stretch: they must never feel slow.
    const speed=reduced?1:motionScaleOf(state.settings),stretch=instant||keyed?frequentScale(speed):speed;
    // A toast host leaves at once: its cards have already left on their own spring, and the bare host holds no material to fade.
    const viewerSpring=tabViewer?tabViewerSpring(!inactive):null;
    const duration=tabViewer?viewerSpring?.duration??reducedOpenMs:(inactive?(keyed||sceneKey.endsWith(':toast')?0:closeMs):reduced?reducedOpenMs:quick?quickOpenMs:centered?formationDialogMs:formationOpenMs)*(reduced?1:stretch);
    // The signature open (cascade, above): the glass is on screen from the input frame (.7, scale .985, its frost
    // thickening out of the mist) and the rows form on their own clock; reduced motion is a cut (a zero-length plan paints its last frame at once).
    // Keyboard, 100x/day and centred panels (Alt+T) open dense: dark from their first frame in dark, never a grey plate.
    const glassFloor=quick||centered&&!inactive?1:0;
    const signature=!inactive&&!switching&&!reversing&&!reduced&&!sceneKey.endsWith(':toast');
    const lift=quick?3:4,plan=formationFrames({start,closing:inactive,switching,reversing,continuing:phase.current==='opening'||phase.current==='open',reduced:inactive?quiet:reduced,duration,firstDelay:0,enterOpacity:reduced?0:glassFloor?.9:quick?.8:.7,rowStart:1,stagger:0,count:0,blur:0,enterScale:tabViewer?tabViewerScale:.985,exitScale:tabViewer?tabViewerScale:.98,exitBlur:0,...(viewerSpring?{curve:viewerSpring.at}:{}),rise:centered?0:geometry.origin.y>.5?lift:-lift,exitRise:centered?0:geometry.origin.y>.5?2:-2});
    phase.current=inactive?'closing':'opening';setInteractive(!inactive);setSettled(false);
    // A local backdrop-filter must sample outside its parent: for the CSS provider the plate itself carries the glass
    // progress, never its wrapper. Captured and native material ride the wrapper with the frozen frost inside it.
    const glass=provider==='css'?surface.querySelector<HTMLElement>('.popup-material')??surface:surface;
    // That backdrop-filter sees nothing through an ancestor that is partly transparent or clipped (a backdrop root), so while a local
    // sheet forms its plane only moves: the plane's opacity and the aperture ride on the text and the mist beside the glass, and the
    // glass itself is dense from the input frame (it fades only with the sheet, on close or in reduced motion).
    const contents=provider==='css'?node.querySelector<HTMLElement>('.popup-contents'):null,frost=!!contents&&!inactive&&!reduced;
    const layered=(layers:ReturnType<typeof formationLayerPaint>)=>!contents?layers:{plane:{opacity:1,transform:'none'},material:{...layers.material,opacity:frost?1:layers.material.opacity*layers.plane.opacity,transform:`${layers.plane.transform} ${layers.material.transform}`},mist:{...layers.mist,opacity:layers.mist.opacity*layers.plane.opacity}};
    const paint=(value:FormationPaint,rest=false)=>{painted.current=value;const base=formationLayerPaint(value,glassFloor),layers=layered(base);Object.assign(node.style,layers.plane);if(contents){contents.style.opacity=String(base.plane.opacity);contents.style.transform=rest?'none':base.plane.transform;}Object.assign(glass.style,layers.material);Object.assign(haze.style,layers.mist);if(rest){node.style.transform='none';glass.style.transform='none';}};
    // The plane's own motion (the rise and the 1.5% condense) rides on the glass and the text instead, about the same corner: a running transform on an
    // ancestor of the glass keeps its backdrop-filter from sampling the page until it ends (the sharp page showed through for ~300ms, then the frost came).
    if(contents)contents.style.transformOrigin=glass.style.transformOrigin=`${(from??geometry.origin).x*100}% ${(from??geometry.origin).y*100}%`;
    const startedAt=performance.now();
    let cancelled=false,done=false,timer:ReturnType<typeof setTimeout>|undefined;
    const complete=()=>{if(done||cancelled)return;done=true;clearTimeout(timer);paint(plan.final,!inactive);formed.current=!inactive;phase.current=inactive?'hidden':'open';setSettled(!inactive);if(inactive){vapor.current();if(!present)safeToRemove?.();}else root.current?.dispatchEvent(new Event('acira-popup-ready',{bubbles:true}));};
    paint(plan.at(0));
    if(signature){vapor.current();vapor.current=cascade(node,{haze:!quick,quick,upward:geometry.origin.y===1,scale:stretch,centreOut:tabViewer});}else if(reduced||inactive)vapor.current();
    if(!plan.duration){complete();return()=>{cancelled=true;};}
    const layers=formationLayerFrames(plan,glassFloor),options={duration:plan.duration,easing:'linear',fill:'forwards' as const};
    const origin=from??geometry.origin,opening=!inactive;
    const previousAperture=apertureRef.current,apertureFor=(el:HTMLElement,pad:number)=>apertureAnimation(el,{width:geometry.bounds.width,height:geometry.bounds.height,origin,opening,centered:geometry.origin.x===.5&&geometry.origin.y===.5,previous:previousAperture,tabViewer,pad});
    const aperture=!quiet&&!switching&&!tabViewer&&provider!=='native'&&!sceneKey.endsWith(':toast')?(contents?apertureFor(glass,0):apertureFor(node,24)):null;
    apertureRef.current=aperture;
    const followers=aperture&&contents?[contents,haze].flatMap(el=>{const follow=apertureFor(el,0);return follow?[follow]:[];}):[];
    const planeFrames=layers.plane,materialFrames=contents?layers.material.map((frame,i)=>({...frame,opacity:frost?1:frame.opacity*layers.plane[i].opacity,transform:`${layers.plane[i].transform} ${frame.transform}`})):layers.material,mistFrames=contents?layers.mist.map((frame,i)=>({...frame,opacity:frame.opacity*layers.plane[i].opacity})):layers.mist;
    const animations=[...(contents?[]:[node.animate(planeFrames,options)]),glass.animate(materialFrames,options),haze.animate(mistFrames,options),...(contents?[contents.animate(layers.plane.map(({offset,opacity,transform})=>({offset,opacity,transform})),options)]:[]),...(aperture?[aperture]:[]),...followers];
    const hold=Math.max(plan.duration,Number(aperture?.effect?.getComputedTiming().endTime)||0);
    finish.current=()=>{complete();animations.forEach(animation=>animation.cancel());vapor.current();};timer=setTimeout(()=>{complete();animations.forEach(animation=>animation.cancel());},hold+16);
    return()=>{if(!done)paint(plan.at(Math.min(plan.duration,performance.now()-startedAt)));cancelled=true;clearTimeout(timer);animations.forEach(animation=>animation.cancel());finish.current=()=>{};};
  },[visibleReady,inactive,reduced,sceneKey]);
  const centered=geometry.origin.x===.5&&geometry.origin.y===.5,formationOrigin=sceneKey.endsWith(':tabs')?tabViewerOrigin:from??geometry.origin;
  const x=geometry.bounds.x,y=geometry.bounds.y,morphSpeed=motionScaleOf(state.settings),morph=formed.current?popupMorphMilliseconds(reduced,morphSpeed>0?1/morphSpeed:1)/1000:0;
  // R3-70: preserve upstream popover spring while retaining the existing identity material.
  const plateSpring=springNow('popover.grow');
  const identity=/(?:^|:)(?:profile|extensions)$/.test(sceneKey);
  const popupSettings=identity?{...state.settings,glassOpacity:Math.max(state.settings.glassOpacity??64,designTokens.material.identityTint*100)}:state.settings;
  const popupDark=appearance?appearance==='dark':state.settings.appearance==='dark'||state.settings.appearance==='system'&&matchMedia('(prefers-color-scheme: dark)').matches;
  const appearanceTokens=appearance||identity?tabViewerTokens(popupSettings,popupDark):{};
  return <motion.div ref={root} className={`popup-surface acira-popup-surface sheet-popup ${centered?'centered-tab-surface ':''}${native?'native-popup-surface':'local-popup'}`}
    data-identity-material={identity||undefined} data-material-warming={backdrop.status==='pending'||undefined} data-material-priming={!formed.current||undefined} data-formation-ready={settled||undefined} data-bare={sceneKey.endsWith(':toast')||undefined} data-size-pending={!visibleReady&&sizePending||undefined} data-popup-appearance={appearance} data-material-provider={provider} data-material-frame={provider==='live'?'frozen':undefined} data-sheet-origin={centered?'center':`${geometry.origin.y>.5?'bottom':'top'}-${geometry.origin.x>.5?'right':'left'}`} data-preparing={!visibleReady||undefined}
    inert={inactive||!visibleReady||!interactive||undefined} style={{...appearanceTokens,position:'absolute',visibility:!visibleReady?'hidden':undefined,pointerEvents:inactive||!interactive?'none':undefined,'--popup-x':`${x}px`,'--popup-y':`${y}px`} as CSSProperties}
    initial={false} animate={{left:x,top:y,width:geometry.bounds.width,height:geometry.bounds.height}} transition={morph>0&&plateSpring?{type:'spring',duration:plateSpring.duration,bounce:0}:{duration:0}}
    onUpdate={value=>{if(typeof value.left==='number')root.current?.style.setProperty('--popup-x',`${value.left}px`);if(typeof value.top==='number')root.current?.style.setProperty('--popup-y',`${value.top}px`);}}
    onClickCapture={event=>{
      if(pendingPick.current){event.preventDefault();event.stopPropagation();return;}
      const selection=(event.target as Element).closest?.('.tab-result[data-tab-id]');
      if(native&&sceneKey.endsWith(':tabs')&&selection&&root.current?.contains(selection)){
        // Enter's synthesized click uses this path too; the tab-close button does
        // not. Preserve the existing selection, close IPC and focus order.
        root.current.dataset.pick='selection';setDepartingScene(sceneKey);
      }
      // A control inside the row (a switch, a button, a link) owns its own click: only a click on the row itself blinks and replays (popupPick.ts).
      const row=pickRowFor(event.target as Element,root.current) as HTMLElement|null;
      if(row&&root.current&&event.detail>0&&!reduced&&!replaying.has(row)){
        event.preventDefault();event.stopPropagation();finish.current();
        row.dataset.picked='';root.current.dataset.pick='pointer';
        const timer=setTimeout(()=>{const pending=pendingPick.current;if(pending?.timer!==timer)return;pendingPick.current=null;delete row.dataset.picked;if(pickContext.current.inactive||pickContext.current.sceneKey!==sceneKey||!row.isConnected||!root.current?.contains(row)||row.matches(':disabled,[aria-disabled="true"]'))return;replaying.add(row);try{row.click();}finally{replaying.delete(row);}},pickHoldMs);
        pendingPick.current={row,timer};
        return;
      }
      finish.current();
    }} onKeyDownCapture={event=>{cancelPick();if(event.key!=='Escape')finish.current();}}
    onMouseDown={event=>event.stopPropagation()}>
    <div ref={plane} className="popup-sheet-plane" style={{'--formation-origin':`calc(24px + (100% - 48px) * ${formationOrigin.x}) calc(24px + (100% - 48px) * ${formationOrigin.y})`} as CSSProperties}>
      <div ref={mist} className="popup-sheet-mist" aria-hidden="true"/>
      <div ref={material} className="popup-sheet-material" aria-hidden="true">{(provider==='live'||provider==='opaque'||provider==='pending')&&<div className="popup-backdrop-clip" aria-hidden="true"><div className="popup-backdrop-base"/><div className="popup-captured-material" data-shown={backdrop.status==='live'&&!backdrop.opaque||undefined}><BackdropSources videos={backdrop.videos}/><div className="popup-backdrop-tint"/></div></div>}
      <div className="popup-material" aria-hidden="true" style={{inset:24}}/></div>
      <div className="popup-contents" style={{position:'absolute',inset:24,height:'auto'}}><div data-popup-scene={sceneKey} style={{position:'absolute',inset:0,width:geometry.bounds.width,height:geometry.bounds.height}}>{children}</div></div>
    </div>
  </motion.div>;
}
