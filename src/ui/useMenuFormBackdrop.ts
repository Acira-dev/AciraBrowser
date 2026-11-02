import { useLayoutEffect, useRef, type RefObject } from 'react';
import { runtime } from '../runtime/client';
import type { BrowserLayout, Rectangle } from '../runtime/types';
import { menuFrameBounds, menuFrameCoverage, menuFormOwnerRetired, menuFormSnapshotAdmitted } from './menuFormBackdrop';
import { decodePopupSnapshot } from './popupSnapshot';

const padding=64,warmingBudget=600;
type Frame={element:HTMLCanvasElement|HTMLVideoElement;key:string;bounds:Rectangle;radius:number;sourceBounds?:Rectangle};
const clear=(frames:Frame[])=>{for(const frame of frames)if(frame.element instanceof HTMLCanvasElement){frame.element.width=0;frame.element.height=0;}};

/** Reuse primary pixels first. An uncovered child gets one guarded snapshot
 * attempt after native has accepted this exact geometry and context. */
export function useMenuFormBackdrop({trigger,panel,canvas,open,host,bounds,onRetire}:{
  trigger:RefObject<HTMLButtonElement|null>;panel:RefObject<HTMLDivElement|null>;canvas:RefObject<HTMLCanvasElement|null>;
  open:boolean;host:Element|null;bounds?:Rectangle;onRetire:()=>void;
}) {
  const layout=useRef<BrowserLayout|null>(null),cache=useRef<{id?:number;frames:Frame[]}>({frames:[]}),serialRequest=useRef<Promise<void>|null>(null);
  const retiredCallback=useRef(onRetire);retiredCallback.current=onRetire;
  useLayoutEffect(()=>{let alive=true;void runtime.getBrowserLayout().then(value=>{if(alive)layout.current=value;});const unsubscribe=runtime.subscribeLayout(value=>{layout.current=value;});return()=>{alive=false;unsubscribe();clear(cache.current.frames);cache.current={frames:[]};};},[]);
  useLayoutEffect(()=>{if(!open){clear(cache.current.frames);cache.current={frames:[]};}},[open]);
  useLayoutEffect(()=>{
    const root=panel.current,target=canvas.current,owner=trigger.current?.closest<HTMLElement>('.popup-surface');
    if(!open||!root||!target||!owner||!bounds)return;
    if(!host?.classList.contains('native-popup-stage')){root.dataset.formMaterial='css';return;}
    const controller=new AbortController(),sample={x:bounds.x-padding,y:bounds.y-padding,width:bounds.width+padding*2,height:bounds.height+padding*2};
    let retired=false,alive=true,requested=false,pending=false,failed=false,shown=false,animation:Animation|undefined;
    const empty=()=>{target.width=0;target.height=0;};
    const warm=()=>{root.dataset.formMaterial='warming';root.style.visibility='hidden';root.inert=true;root.style.animation='none';empty();shown=false;};
    const reveal=(material:'captured'|'opaque')=>{
      if(!alive||retired)return;
      root.dataset.formMaterial=material;root.style.visibility='';root.inert=false;
      if(!shown){shown=true;root.style.animation='none';const reduced=root.closest('.app')?.getAttribute('data-reduced-motion')==='true'||matchMedia('(prefers-reduced-motion: reduce)').matches;if(!reduced)animation=root.animate([{opacity:0,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:160,easing:'cubic-bezier(.16,1,.3,1)',fill:'both'});root.dispatchEvent(new Event('acira-menu-form-ready'));}
    };
    const fallback=()=>{empty();reveal('opaque');};
    const checkRetirement=()=>{
      if(retired)return true;
      const overlay=layout.current?.overlay;
      if(!menuFormOwnerRetired({preparing:owner.hasAttribute('data-preparing'),inactive:owner.inert,hidden:owner.style.visibility==='hidden',ownerScene:owner.querySelector<HTMLElement>('[data-popup-scene]')?.dataset.popupScene,currentScene:overlay?`${overlay.id}:${overlay.kind}`:undefined}))return false;
      retired=true;controller.abort();animation?.cancel();root.style.visibility='hidden';root.inert=true;empty();clear(cache.current.frames);cache.current={frames:[]};
      window.dispatchEvent(new CustomEvent('acira-menu-form-bounds',{detail:{id:root.id,bounds:null}}));retiredCallback.current();return true;
    };
    const paint=(frames:Frame[])=>{
      const current=layout.current;
      if(!current||!menuFrameCoverage(sample,frames,current.views,{x:0,y:0,width:innerWidth,height:innerHeight}))return false;
      const ratio=Math.min(2,devicePixelRatio||1);target.width=Math.ceil(sample.width*ratio);target.height=Math.ceil(sample.height*ratio);
      const context=target.getContext('2d');if(!context)return false;context.scale(ratio,ratio);
      try{for(const frame of frames){const b=frame.bounds;context.save();if(!frame.sourceBounds){context.beginPath();context.roundRect(b.x-sample.x,b.y-sample.y,b.width,b.height,frame.radius);context.clip();}context.drawImage(frame.element,b.x-sample.x,b.y-sample.y,b.width,b.height);context.restore();}reveal('captured');return true;}catch{empty();return false;}
    };
    const primaryFrames=()=>{
      const frames:Frame[]=[];
      if(owner.dataset.materialProvider!=='live'||owner.dataset.materialFrame!=='frozen')return frames;
      for(const element of owner.querySelectorAll<HTMLCanvasElement|HTMLVideoElement>('.popup-sheet-material .popup-backdrop-sources [data-popup-source][data-popup-source-frame="frozen"]')){
        if(!(element instanceof HTMLCanvasElement)&&!(element instanceof HTMLVideoElement))continue;
        if(element instanceof HTMLCanvasElement?element.width<=0||element.height<=0:element.readyState<2)continue;
        try{const source=JSON.parse(element.dataset.popupSource||'null');if(typeof source?.key==='string'&&menuFrameBounds(source.bounds)&&Number.isFinite(source.radius)&&source.radius>=0&&(!source.sourceBounds||menuFrameBounds(source.sourceBounds)))frames.push({element,key:source.key,bounds:source.bounds,radius:source.radius,...(source.sourceBounds?{sourceBounds:source.sourceBounds}:{})});}catch{/* Incomplete frames cannot qualify this child. */}
      }
      return frames;
    };
    const draw=()=>{
      if(!alive||checkRetirement())return;
      if(root.closest('.opaque-glass')||matchMedia('(forced-colors: active)').matches){fallback();return;}
      const current=layout.current,id=current?.overlay?.id;
      if(failed){fallback();return;}
      if(cache.current.id===id&&paint(cache.current.frames)||paint(primaryFrames()))return;
      if(pending||requested){warm();return;}
      warm();
      if(!runtime.popupBackdropSnapshot){failed=true;fallback();return;}
      if(!current||!menuFormSnapshotAdmitted(id,current.overlay,bounds))return;
      requested=true;pending=true;
      const previous=serialRequest.current;
      const attempt=(async()=>{
        const decoded:Frame[]=[];
        try{
          await previous;
          if(!alive||controller.signal.aborted||checkRetirement()||!menuFormSnapshotAdmitted(id,layout.current?.overlay,bounds))return;
          const snapshot=await runtime.popupBackdropSnapshot!(id!);
          if(!alive||controller.signal.aborted||snapshot.id!==id||checkRetirement())return;
          if(!snapshot.sources.length)throw new Error('Child material snapshot unavailable');
          for(const source of snapshot.sources){const element=await decodePopupSnapshot(source,controller.signal);decoded.push({element,key:source.key,bounds:source.bounds,radius:source.radius,sourceBounds:source.sourceBounds});}
          if(!alive||controller.signal.aborted||checkRetirement()||!menuFormSnapshotAdmitted(id,layout.current?.overlay,bounds))return;
          if(!menuFrameCoverage(sample,decoded,layout.current!.views,{x:0,y:0,width:innerWidth,height:innerHeight}))throw new Error('Child snapshot coverage incomplete');
          clear(cache.current.frames);cache.current={id,frames:decoded.splice(0)};
        }catch{failed=true;}finally{clear(decoded);pending=false;if(alive&&!retired){if(!cache.current.frames.length)failed=true;draw();}}
      })();
      serialRequest.current=attempt;
    };
    warm();draw();
    const deadline=setTimeout(()=>{if(alive&&!retired&&!shown){failed=true;controller.abort();pending=false;fallback();}},warmingBudget);
    const changes=new MutationObserver(draw);changes.observe(owner,{subtree:true,childList:true,attributes:true,attributeFilter:['data-material-provider','data-material-frame','data-popup-source-frame','data-popup-source']});
    const ownership=new MutationObserver(checkRetirement);ownership.observe(owner,{attributes:true,attributeFilter:['data-preparing','inert','style']});
    const unsubscribe=runtime.subscribeLayout(value=>{layout.current=value;draw();});
    return()=>{alive=false;clearTimeout(deadline);controller.abort();animation?.cancel();changes.disconnect();ownership.disconnect();unsubscribe();empty();};
  },[open,host,bounds?.x,bounds?.y,bounds?.width,bounds?.height]);
}
