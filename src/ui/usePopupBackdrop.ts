import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {runtime} from '../runtime/client';
import type {PopupBackdropSource,Rectangle} from '../runtime/types';
import {freezePopupVideo,waitForPopupVideo} from './popupMedia';
import {createPopupCaptureLifetime,stopPopupCapture} from './popupCaptureLifetime';
import {canRetainClosingMaterial,createPopupMaterialDeadline} from './popupMaterial';
import {decodePopupSnapshot} from './popupSnapshot';

export interface BackdropVideo {source:PopupBackdropSource&{sourceBounds?:Rectangle};video?:HTMLVideoElement;stream?:MediaStream;frame?:HTMLCanvasElement}
type BackdropState={status:'pending'|'live'|'native';videos:BackdropVideo[];opaque:boolean};
type CaptureRequest={id:number;key:string;source:PopupBackdropSource;cancelled:boolean;videos:BackdropVideo[];controller:AbortController;staged:BackdropVideo[];lifetime:ReturnType<typeof createPopupCaptureLifetime>;ready?:Promise<void>};
declare global {interface Window {__aciraPopupCapture?:(id:number,key:string)=>Promise<void>}}
const stop=(videos:BackdropVideo[])=>{for(const item of videos){if(item.stream)stopPopupCapture(item.stream);if(item.video){item.video.srcObject=null;item.video.remove();}item.frame?.remove();}};
const cancel=(request:CaptureRequest)=>{request.cancelled=true;request.lifetime.close();request.controller.abort();stop(request.videos);};

/** Streams never leave this trusted renderer and exist only for an open popup.
 * Acquisition starts on mount, independently of the formation clock. The sheet
 * primes its first visible glass frame from decoded sources, never from an
 * opaque plate that switches to glass when the animation ends. */
export function usePopupBackdrop({id,enabled,closing,context}:{id?:number;enabled:boolean;closing:boolean;context:string}) {
  const [state,setState]=useState<BackdropState>({status:enabled?'pending':'live',videos:[],opaque:!enabled});
  const published=useRef<BackdropVideo[]>([]),request=useRef<CaptureRequest|null>(null),previous=useRef({context,enabled});
  useLayoutEffect(()=>{
    const changedContext=previous.current.context!==context,changedEnabled=previous.current.enabled!==enabled;
    if(changedContext&&canRetainClosingMaterial({closing,enabled,previousEnabled:previous.current.enabled,frames:published.current})){
      // Keep only this old surface's frozen pixels through its visible exit.
      // Do not advance context: reopening must discard, never reuse, them.
      if(request.current){cancel(request.current);request.current=null;}
      return;
    }
    previous.current={context,enabled};if(!changedContext&&!changedEnabled)return;
    if(changedContext||!enabled){stop(published.current);published.current=[];if(request.current){cancel(request.current);request.current=null;}}
    // Retain a fully painted opaque material while a live source warms. Never
    // advertise partial/undecoded videos as a visible translucent provider.
    setState({status:enabled?'pending':'live',videos:[],opaque:true});
  },[context,enabled,closing]);
  useLayoutEffect(()=>{
    const receive=async(id:number,key:string)=>{
      const current=request.current;
      if(!current||current.cancelled||current.id!==id||current.key!==key)throw new Error('Stale material request');
      const stream=await navigator.mediaDevices.getDisplayMedia({audio:false,video:{frameRate:{max:30},width:{max:1280},height:{max:1280}}});
      if(!current.lifetime.adopt(stream))throw new Error('Material request cancelled');
      if(current.cancelled||request.current!==current){current.lifetime.release(stream);throw new Error('Material request cancelled');}
      const video=document.createElement('video');video.muted=true;video.playsInline=true;video.setAttribute('aria-hidden','true');video.srcObject=stream;
      current.videos.push({source:current.source,video,stream});
      // Mount the owned video before playback. The native one-shot grant ends
      // when acquisition succeeds; waiting for paint must not retain that grant.
      setState(previous=>({status:'pending',opaque:previous.opaque,videos:[...published.current,...current.staged,...current.videos]}));
      current.ready=waitForPopupVideo(video,current.controller.signal);
      void current.ready.catch(()=>{});
    };
    window.__aciraPopupCapture=receive;
    return()=>{if(window.__aciraPopupCapture===receive)delete window.__aciraPopupCapture;};
  },[]);
  useEffect(()=>()=>{if(request.current)cancel(request.current);stop(published.current);published.current=[];},[]);
  useEffect(()=>{
    if(!enabled){stop(published.current);published.current=[];setState({status:'live',videos:[],opaque:true});return;}
    if(closing||id===undefined)return;
    let cancelled=false,ownedRequest:typeof request.current=null;
    const snapshotController=new AbortController();
    const lifetime=createPopupCaptureLifetime();
    const created:BackdropVideo[]=[],acquired:CaptureRequest[]=[];
    // Timeout/failure fixes this generation to native glass. A late decoder
    // cannot turn glass on after the animation or keep a stream alive.
    const fallback=()=>{
      if(cancelled)return;cancelled=true;deadline.cancel();lifetime.close();snapshotController.abort();
      for(const pending of acquired)pending.controller.abort();
      if(ownedRequest){cancel(ownedRequest);if(request.current===ownedRequest)request.current=null;}
      stop(created);stop(published.current);published.current=[];
      setState({status:'native',videos:[],opaque:false});
    };
    // Snapshot decode and legacy acquisition have separate bounded budgets.
    // A late result cannot change an already-visible fallback generation.
    let deadline=createPopupMaterialDeadline(fallback,runtime.popupBackdropSnapshot?300:undefined);
    const prepare=async()=>{
      try{
        if(!published.current.length)setState(previous=>({...previous,status:'pending',opaque:previous.opaque||previous.status==='native'}));
        if(cancelled)return;
        if(runtime.popupBackdropSnapshot){
          try{
            // A popup of a measured kind lays out twice (its estimated height, then its measured one) and the broker
            // discards a frame that straddled the second layout: ask once more against the settled layout.
            let snapshot=await runtime.popupBackdropSnapshot(id);
            if(!cancelled&&!snapshot.sources.length)snapshot=await runtime.popupBackdropSnapshot(id);
            if(cancelled)return;
            if(snapshot.id===id&&snapshot.sources.length){
              const decoded=await Promise.all(snapshot.sources.map(async source=>({source:{key:source.key,bounds:source.bounds,radius:source.radius,sourceBounds:source.sourceBounds},frame:await decodePopupSnapshot(source,snapshotController.signal)})));
              if(cancelled){stop(decoded);return;}
              if(!deadline.accept()){stop(decoded);return;}
              const retired=published.current;published.current=decoded;setState({status:'live',videos:decoded,opaque:false});stop(retired);return;
            }
          }catch(error){snapshotController.abort();if(cancelled)return;if(import.meta.env.DEV)console.warn('Popup snapshot unavailable; trying one-shot media',error);}
          deadline.cancel();if(cancelled)return;deadline=createPopupMaterialDeadline(fallback);
        }
        const descriptor=await runtime.popupBackdrop?.(id);
        if(cancelled)return;
        if(descriptor?.id!==id)throw new Error('Material descriptor unavailable');
        if(!descriptor.sources.length)throw new Error('No material source');
        // An interrupted close retains only frozen pixels, with every track
        // already ended. Reuse only within this mounted popup/context.
        const previous=published.current;
        if(previous.length===descriptor.sources.length&&previous.every((item,index)=>item.source.key===descriptor.sources[index].key&&JSON.stringify(item.source)===JSON.stringify(descriptor.sources[index])&&item.frame&&item.frame.width>0&&item.frame.height>0)){if(deadline.accept())setState({status:'live',videos:previous,opaque:false});return;}
        // Acquisitions are serial (one grant at a time), but each first frame is awaited together: a page popup needs
        // the chrome and the page, and waiting for each frame in turn made its frost miss the sheet's reveal.
        for(const source of descriptor.sources){
          if(cancelled)break;
          const pending:CaptureRequest={id,key:source.key,source,cancelled:false,videos:[],controller:new AbortController(),staged:created,lifetime};request.current=pending;ownedRequest=pending;
          // False: main dropped the request (the popup moved on, or the capture failed) and holds no grant; even a stream that arrived is not used.
          const started=await runtime.startPopupCapture?.(id,source.key);
          if(!started||!pending.ready)throw new Error('Material acquisition did not complete');
          const item=pending.videos[0];if(!item)throw new Error('Material stream unavailable');
          item.source=source;created.push(item);acquired.push(pending);if(request.current===pending)request.current=null;
        }
        await Promise.all(acquired.map(pending=>pending.ready));
        if(cancelled||acquired.some(pending=>pending.cancelled))throw new Error('Material request cancelled');
        if(cancelled){stop(created);return;}
        // Freeze before publishing: a paused video still owns live capture
        // tracks. Canvas pixels can carry the entire formation and its reversal
        // after the exact one-shot capture has already ended.
        for(const item of created){if(!item.video)throw new Error('Popup video unavailable');item.frame=freezePopupVideo(item.video);}
        for(const item of created){if(item.stream)lifetime.release(item.stream);if(item.video){item.video.srcObject=null;item.video.remove();}}
        if(!deadline.accept()){stop(created);return;}
        const retired=published.current;published.current=created;setState({status:'live',videos:created,opaque:false});stop(retired);
      }catch(error){
        lifetime.close();
        if(import.meta.env.DEV)console.warn('Live popup material unavailable',error);
        stop(created);
        if(ownedRequest){cancel(ownedRequest);if(request.current===ownedRequest)request.current=null;}
        if(!cancelled)fallback();
      }
    };
    void prepare();
    return()=>{cancelled=true;deadline.cancel();lifetime.close();snapshotController.abort();for(const pending of acquired)pending.controller.abort();if(ownedRequest&&request.current===ownedRequest){cancel(ownedRequest);request.current=null;}if(published.current!==created)stop(created);};
  },[id,enabled,closing,context]);
  return state;
}
