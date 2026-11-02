import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import type { BrowserAction } from '../runtime/types';
import { createBufferedDraft } from './bufferedDraft';

/** Flush across blur, tab changes and docked/native renderer hand-offs. */
export function useBufferedDraft(tabId:string,remote:string,dispatch:(action:BrowserAction)=>void,field:'searchDraft'='searchDraft'){
 const sender=useRef(dispatch);sender.current=dispatch;
 const make=(id:string,value:string)=>createBufferedDraft(value,next=>sender.current({type:'tab.update',id,patch:{[field]:next}}));
 const current=useRef({id:tabId,buffer:make(tabId,remote)}),focused=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 const [value,setValue]=useState(remote);
 const flush=()=>{clearTimeout(timer.current);timer.current=undefined;return current.current.buffer.flush();};
 useLayoutEffect(()=>{if(current.current.id!==tabId){flush();current.current={id:tabId,buffer:make(tabId,remote)};focused.current=false;}setValue(current.current.buffer.receive(remote,focused.current));},[tabId,remote]);
 useEffect(()=>{const blur=()=>{focused.current=false;flush();};window.addEventListener('blur',blur);window.addEventListener('acira-flush-drafts',blur);return()=>{flush();window.removeEventListener('blur',blur);window.removeEventListener('acira-flush-drafts',blur);};},[]);
 const edit=(next:string)=>{setValue(current.current.buffer.edit(next));clearTimeout(timer.current);timer.current=setTimeout(flush,180);};
 return{value,edit,flush,onFocus:()=>{focused.current=true;},onBlur:()=>{focused.current=false;flush();}};
}
