import {dismissOnEscape,ToastLead,toastRowSize} from './transient/Toast';
import {useCallback,useEffect,useRef,useState} from 'react';
import {TOAST_RESUME_GRACE} from '../ui/toastTimers';
import {undoWorkspaceArtwork,useNewTabPreferences,type ArtworkUndo} from '../ui/newTabPreferences';

import { t } from '../i18n';
/** A toast with an action stays 8s (bible §4 Transient surfaces); it pauses while the pointer or focus is inside. It is the
 * shared toast card in the shared bottom-centre slot; leaving takes 160ms (opacity + scale .98, ease-in). */
const lifetime=8000,exit=160;

/** Copy rule (bible §4): noun + past participle, the way back is Undo. */
const message='Artwork hidden';

export function ArtworkToast({profileId,privateMode=false}:{profileId:string;privateMode?:boolean}){
 const [notice,setNotice]=useState<ArtworkUndo|null>(null),[closing,setClosing]=useState(false),root=useRef<HTMLDivElement>(null),leaving=useRef<ReturnType<typeof setTimeout>>(undefined),[preferences]=useNewTabPreferences(profileId,privateMode);
 /** Starts the exit; the toast is removed once it has finished. Safe to call twice. */
 const dismiss=useCallback(()=>{if(leaving.current!==undefined)return;setClosing(true);leaving.current=setTimeout(()=>{
  leaving.current=undefined;
  // Undo and Dismiss retire their focused button. Keep keyboard position in the workspace, unless focus already moved elsewhere.
  if(root.current?.contains(document.activeElement)){
   const page=root.current.closest('.app')?.querySelector('.nt-page');
   const target=page?.querySelector<HTMLInputElement>('.nt-search input')||page?.querySelector<HTMLButtonElement>('[aria-label="Hide workspace cover"],[aria-label="Show workspace cover"]');
   if(target?.isConnected&&!target.closest('[inert]'))target.focus({preventScroll:true});
  }
  setClosing(false);setNotice(null);
 },exit);},[]);
 const clear=useCallback(()=>{clearTimeout(leaving.current);leaving.current=undefined;setClosing(false);setNotice(null);},[]);
 useEffect(()=>()=>clearTimeout(leaving.current),[]);
 useEffect(()=>{const receive=(event:Event)=>{const undo=(event as CustomEvent<ArtworkUndo>).detail;if(undo?.profile===profileId&&undo.privateMode===privateMode){clearTimeout(leaving.current);leaving.current=undefined;setClosing(false);setNotice(undo);}};window.addEventListener('acira:artwork-hidden',receive);return()=>window.removeEventListener('acira:artwork-hidden',receive);},[profileId,privateMode]);
 useEffect(()=>clear(),[profileId,privateMode,clear]);
 useEffect(()=>{if(notice&&notice.version!==preferences.version)dismiss();},[notice,preferences.version,dismiss]);
 useEffect(()=>{
  const node=root.current;if(!notice||!node)return;let remaining=lifetime,started=0,timer:ReturnType<typeof setTimeout>|undefined;const pauses=new Set<string>();
  const stop=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;remaining=Math.max(TOAST_RESUME_GRACE,remaining-(performance.now()-started));}};
  const resume=()=>{if(pauses.size||timer!==undefined)return;started=performance.now();timer=setTimeout(dismiss,remaining);};
  const enter=()=>{pauses.add('pointer');stop();},leave=()=>{pauses.delete('pointer');resume();},focus=()=>{pauses.add('focus');stop();},blur=(event:FocusEvent)=>{if(node.contains(event.relatedTarget as Node))return;pauses.delete('focus');resume();};
  node.addEventListener('pointerenter',enter);node.addEventListener('pointerleave',leave);node.addEventListener('focusin',focus);node.addEventListener('focusout',blur);if(node.matches(':hover'))pauses.add('pointer');if(node.contains(document.activeElement))pauses.add('focus');resume();
  return()=>{stop();node.removeEventListener('pointerenter',enter);node.removeEventListener('pointerleave',leave);node.removeEventListener('focusin',focus);node.removeEventListener('focusout',blur);};
 },[notice,dismiss]);
 if(!notice)return null;
 return <div className="t-solo"><div className="t-toast" ref={root} role="status" data-artwork-toast data-closing={closing||undefined} style={{width:toastRowSize({key:0,text:message,actionLabel:t("toast.undo")}).width}} onKeyDown={event=>dismissOnEscape(event,dismiss)}><ToastLead onDismiss={dismiss}/><span className="t-text">{message}</span><button type="button" className="toast-action" onClick={()=>{undoWorkspaceArtwork(notice,profileId);dismiss();}}>{t("toast.undo")}</button></div></div>;
}
